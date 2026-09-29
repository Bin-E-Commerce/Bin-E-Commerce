// Điều phối discovery shop, lập plan quota, crawl detail và ghi staging JSONL.
// Service này không import database trực tiếp; nó tạo snapshot có checkpoint để
// operator kiểm tra trước khi dùng import-product-service ghi vào product-service.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ProductSourceAdapter } from '../adapters/product-source.adapter';
import { ProductMapper } from '../mappers/product.mapper';
import type { SourceProductListItem } from '../types/source-product.type';
import type {
    BatchCheckpointEntry,
    ShopCandidate,
    ShopListingCandidate,
    ShopProductBatchCheckpoint,
    ShopProductBatchManifest,
    ShopProductBatchOptions,
} from '../types/shop-product-batch.type';
import { validateProductGraph } from '../validators/product-import.validator';
import { buildCanonicalGroupKey, getListingKey } from '../utils/listing-key';
import { sleep } from '../utils/sleep';
import { ShopProductBatchPlannerService } from './shop-product-batch-planner.service';
import type { CrawlerLogger } from '../loggers/crawler.logger';
import { ConsoleCrawlerLogger } from '../loggers/crawler.logger';

interface DiscoveryScope {
    categoryExternalId?: string;
    keyword?: string;
}

export interface ShopProductBatchCrawlerDependencies {
    source: ProductSourceAdapter;
    planner?: ShopProductBatchPlannerService;
    mapper?: ProductMapper;
    logger?: CrawlerLogger;
}

export interface ShopProductBatchRunResult {
    manifest: ShopProductBatchManifest;
    checkpoint: ShopProductBatchCheckpoint;
}

export class ShopProductBatchCrawlerService {
    private readonly planner: ShopProductBatchPlannerService;
    private readonly mapper: ProductMapper;
    private readonly logger: CrawlerLogger;

    constructor(private readonly deps: ShopProductBatchCrawlerDependencies) {
        this.planner = deps.planner ?? new ShopProductBatchPlannerService();
        this.mapper = deps.mapper ?? new ProductMapper();
        this.logger = deps.logger ?? new ConsoleCrawlerLogger();
    }

    // Chạy trọn batch theo thứ tự discovery → planning → detail → manifest, giữ checkpoint sau từng listing.
    // Resume chỉ bỏ qua listing đã succeeded; listing failed có thể được chạy lại mà không tạo product duplicate
    // vì external_product_id là composite listing key và writer chỉ append khi trạng thái chưa thành công.
    async crawl(
        options: ShopProductBatchOptions,
    ): Promise<ShopProductBatchRunResult> {
        this.validateOptions(options);
        const outputDir = resolve(options.outputDir);
        await mkdir(outputDir, { recursive: true });
        if (!options.resume) {
            await writeFile(resolve(outputDir, 'products.jsonl'), '', 'utf8');
            await writeFile(resolve(outputDir, 'failed.jsonl'), '', 'utf8');
        }

        const checkpointPath = resolve(options.checkpointFile);
        const checkpoint = await this.loadCheckpoint(
            checkpointPath,
            options.resume,
        );
        const crawlRunId = checkpoint?.crawlRunId ?? `tiki-batch-${Date.now()}`;
        const initialCheckpoint: ShopProductBatchCheckpoint = checkpoint ?? {
            crawlRunId,
            stage: 'discovery',
            entries: {},
            updatedAt: new Date().toISOString(),
        };
        await this.persistCheckpoint(checkpointPath, initialCheckpoint);

        const candidates = await this.discoverCandidates(
            options,
            initialCheckpoint,
            checkpointPath,
        );
        if (candidates.length === 0) {
            throw new Error(
                'Tiki discovery returned no candidates; source may be rate-limited or returning HTML/captcha.',
            );
        }
        const plan = this.planner.buildPlan(candidates, options);
        initialCheckpoint.stage = 'planning';
        await this.persistCheckpoint(checkpointPath, initialCheckpoint);

        await this.writeJsonLines(
            resolve(outputDir, 'shops.jsonl'),
            plan.selectedShops.map((shop) => this.serializeShop(shop, plan)),
        );
        await this.writeJsonLines(
            resolve(outputDir, 'listings.jsonl'),
            plan.selectedListings,
        );

        if (plan.shortfall > 0) {
            this.logger.warn('batch target shortfall', {
                targetListings: options.targetListings,
                selectedListings: plan.selectedListings.length,
                shortfall: plan.shortfall,
            });
        }

        const manifest: ShopProductBatchManifest = {
            crawlRunId,
            targetListings: options.targetListings,
            discoveredShops: new Set(
                candidates.map((candidate) => candidate.sellerExternalId),
            ).size,
            selectedShops: plan.selectedShops.length,
            discoveredListings: candidates.length,
            selectedListings: plan.selectedListings.length,
            crawledListings: 0,
            validListings: 0,
            failedListings: 0,
            skippedListings: 0,
            eligibleGroups: plan.eligibleGroups,
            groupCoverage: plan.groupCoverage,
            productsPerShop: plan.productsPerShop,
            categoryDistribution: this.countByCategory(plan.selectedListings),
            shortfall: plan.shortfall,
        };

        initialCheckpoint.stage = 'details';
        await this.persistCheckpoint(checkpointPath, initialCheckpoint);
        await this.crawlDetails(
            plan.selectedListings,
            options,
            outputDir,
            initialCheckpoint,
            checkpointPath,
            manifest,
        );

        this.syncManifestCounters(manifest, initialCheckpoint);
        manifest.completedAt = new Date().toISOString();
        initialCheckpoint.stage = 'completed';
        initialCheckpoint.updatedAt = manifest.completedAt;
        await this.persistCheckpoint(checkpointPath, initialCheckpoint);
        await writeFile(
            resolve(outputDir, 'manifest.json'),
            `${JSON.stringify(manifest, null, 2)}\n`,
            'utf8',
        );

        this.logger.info('shop product batch completed', { ...manifest });
        return { manifest, checkpoint: initialCheckpoint };
    }

    // Discover seller/listing từ nhiều category hoặc keyword, nhưng chỉ giữ listing có seller ID để lập quota.
    private async discoverCandidates(
        options: ShopProductBatchOptions,
        checkpoint: ShopProductBatchCheckpoint,
        checkpointPath: string,
    ): Promise<ShopListingCandidate[]> {
        const scopes =
            checkpoint.discoveryScopes ?? (await this.resolveScopes(options));
        if (!checkpoint.discoveryScopes) {
            checkpoint.discoveryScopes = scopes;
            await this.persistCheckpoint(checkpointPath, checkpoint);
        }
        const discovered = new Map<string, ShopListingCandidate>(
            (checkpoint.discoveryCandidates ?? []).map((candidate) => [
                candidate.listingKey,
                candidate,
            ]),
        );
        const processedScopes = new Set(
            checkpoint.discoveryProcessedScopes ?? [],
        );

        if (
            checkpoint.discoveryStage !== 'shops' &&
            checkpoint.discoveryStage !== 'completed'
        ) {
            checkpoint.discoveryStage = 'categories';
            await this.persistDiscoveryState(
                checkpoint,
                checkpointPath,
                discovered,
            );

            for (const scope of scopes) {
                const scopeKey = this.getDiscoveryScopeKey(scope);
                if (processedScopes.has(scopeKey)) continue;

                for (let page = 1; page <= options.discoveryPages; page += 1) {
                    let result;
                    try {
                        result = await this.deps.source.listProducts({
                            categoryExternalId: scope.categoryExternalId,
                            keyword: scope.keyword,
                            page,
                            limit: options.discoveryLimit,
                        });
                    } catch (error) {
                        if (this.isSourceChallengeError(error)) {
                            await this.persistDiscoveryState(
                                checkpoint,
                                checkpointPath,
                                discovered,
                            );
                            throw this.createSourceChallengeError(
                                `category ${scopeKey} page ${page}`,
                                error,
                            );
                        }
                        this.logger.warn('category listing discovery failed', {
                            categoryExternalId: scope.categoryExternalId,
                            keyword: scope.keyword,
                            page,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                        break;
                    }
                    if (result.items.length === 0) break;

                    for (const item of result.items) {
                        const candidate = this.toCandidate(item);
                        if (candidate)
                            discovered.set(candidate.listingKey, candidate);
                    }

                    await this.persistDiscoveryState(
                        checkpoint,
                        checkpointPath,
                        discovered,
                    );

                    if (
                        result.lastPage !== null &&
                        result.currentPage >= result.lastPage
                    ) {
                        break;
                    }
                    await this.waitBetweenRequests(options);
                }

                processedScopes.add(scopeKey);
                checkpoint.discoveryProcessedScopes = [...processedScopes];
                await this.persistDiscoveryState(
                    checkpoint,
                    checkpointPath,
                    discovered,
                );
            }

            checkpoint.discoveryStage = 'shops';
            await this.persistDiscoveryState(
                checkpoint,
                checkpointPath,
                discovered,
            );
        }

        const shopEnrichedCandidates = await this.discoverShopListings(
            discovered,
            options,
            checkpoint,
            checkpointPath,
        );

        checkpoint.discoveryStage = 'completed';
        await this.persistDiscoveryState(
            checkpoint,
            checkpointPath,
            shopEnrichedCandidates,
        );

        this.logger.info('shop listing discovery completed', {
            scopes: scopes.length,
            discoveredListings: shopEnrichedCandidates.size,
            discoveredShops: new Set(
                [...shopEnrichedCandidates.values()].map(
                    (candidate) => candidate.sellerExternalId,
                ),
            ).size,
        });
        return [...shopEnrichedCandidates.values()];
    }

    // Sau khi có seller từ category/keyword, đọc lại listing theo từng shop để
    // planner có đủ 20–30 sản phẩm/shop và có cơ hội tìm cùng mặt hàng ở nhiều shop.
    // Một shop lỗi không làm hỏng toàn bộ batch; checkpoint/detail vẫn xử lý được các shop còn lại.
    private async discoverShopListings(
        discovered: Map<string, ShopListingCandidate>,
        options: ShopProductBatchOptions,
        checkpoint: ShopProductBatchCheckpoint,
        checkpointPath: string,
    ): Promise<Map<string, ShopListingCandidate>> {
        if (checkpoint.discoveryStage === 'completed') return discovered;

        const shopSeeds = new Map<string, ShopListingCandidate[]>();
        for (const candidate of discovered.values()) {
            const listings = shopSeeds.get(candidate.sellerExternalId) ?? [];
            listings.push(candidate);
            shopSeeds.set(candidate.sellerExternalId, listings);
        }

        const orderedShops = [...shopSeeds.entries()].sort(
            ([leftSeller, leftListings], [rightSeller, rightListings]) =>
                rightListings.length - leftListings.length ||
                leftSeller.localeCompare(rightSeller),
        );
        const shopsToProcess = options.maxDiscoveryShops
            ? orderedShops.slice(0, options.maxDiscoveryShops)
            : orderedShops;

        const processedSellerIds = new Set(
            checkpoint.discoveryProcessedShops ?? [],
        );
        let processedShops = processedSellerIds.size;
        for (const [sellerExternalId, seedListings] of shopsToProcess) {
            if (processedSellerIds.has(sellerExternalId)) continue;

            const seed = seedListings[0];
            if (!seed) continue;

            try {
                for (let page = 1; page <= options.discoveryPages; page += 1) {
                    const result = await this.deps.source.listProducts({
                        categoryExternalId: seed.sourceItem.categoryExternalId,
                        sellerExternalId,
                        sellerName: seed.sellerName,
                        page,
                        limit: Math.max(
                            options.discoveryLimit,
                            options.maxProductsPerShop,
                        ),
                    });

                    for (const item of result.items) {
                        const candidate = this.toCandidate(item);
                        if (candidate)
                            discovered.set(candidate.listingKey, candidate);
                    }

                    // Chỉ cần đủ quota tối đa của một shop; không lấy dư hàng trăm listing.
                    if (result.items.length >= options.maxProductsPerShop)
                        break;
                    if (
                        result.items.length === 0 ||
                        (result.lastPage !== null &&
                            result.currentPage >= result.lastPage)
                    ) {
                        break;
                    }
                    await this.waitBetweenRequests(options);
                }
            } catch (error) {
                if (this.isSourceChallengeError(error)) {
                    await this.persistDiscoveryState(
                        checkpoint,
                        checkpointPath,
                        discovered,
                    );
                    throw this.createSourceChallengeError(
                        `shop ${sellerExternalId}`,
                        error,
                    );
                }
                this.logger.warn('shop listing discovery failed', {
                    sellerExternalId,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }

            processedSellerIds.add(sellerExternalId);
            checkpoint.discoveryProcessedShops = [...processedSellerIds];
            processedShops += 1;
            if (processedShops % 10 === 0) {
                await this.persistDiscoveryState(
                    checkpoint,
                    checkpointPath,
                    discovered,
                );
            }
            if (
                processedShops % 25 === 0 ||
                processedShops === orderedShops.length
            ) {
                this.logger.info('shop listing discovery progress', {
                    processedShops,
                    totalShops: shopsToProcess.length,
                    discoveredListings: discovered.size,
                });
            }

            await this.waitBetweenRequests(options);
        }

        await this.persistDiscoveryState(
            checkpoint,
            checkpointPath,
            discovered,
        );

        // Khi operator giới hạn số shop cho pilot, planner chỉ được thấy các shop
        // đã được chọn và crawl lại; giữ candidate của toàn bộ discovery sẽ làm
        // planner dồn quota vào một shop đầu tiên và làm sai mục tiêu pilot.
        if (options.maxDiscoveryShops) {
            const selectedSellerIds = new Set(
                shopsToProcess.map(([sellerExternalId]) => sellerExternalId),
            );
            return new Map(
                [...discovered.entries()].filter(([, candidate]) =>
                    selectedSellerIds.has(candidate.sellerExternalId),
                ),
            );
        }

        return discovered;
    }

    // Tạo khóa ổn định cho scope để resume không gọi lại category/keyword đã hoàn tất.
    private getDiscoveryScopeKey(scope: DiscoveryScope): string {
        return `category=${scope.categoryExternalId ?? ''}&keyword=${scope.keyword ?? ''}`;
    }

    // Nhận diện response HTML challenge của Tiki trước khi crawler tiếp tục gửi request.
    // Challenge được coi là lỗi cấp nguồn, không phải lỗi riêng của một seller, nên phải dừng để bảo vệ IP và checkpoint.
    private isSourceChallengeError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        const normalized = message.toLowerCase();
        return (
            normalized.includes('text/html') ||
            normalized.includes('captcha') ||
            normalized.includes('challenge') ||
            normalized.includes('inspecting your current network environment')
        );
    }

    // Đổi lỗi nguồn thành thông báo operator có context để lần chạy resume biết nên chờ cooldown,
    // không nhầm challenge với lỗi dữ liệu hoặc lỗi seller đơn lẻ.
    private createSourceChallengeError(context: string, error: unknown): Error {
        const message = error instanceof Error ? error.message : String(error);
        return new Error(`Tiki source challenge tại ${context}: ${message}`);
    }

    // Giãn request bằng delay cơ sở cộng jitter để tránh nhịp gọi tuần hoàn dễ kích hoạt anti-bot.
    private async waitBetweenRequests(
        options: ShopProductBatchOptions,
    ): Promise<void> {
        const jitter =
            options.delayJitterMs > 0
                ? Math.floor(Math.random() * (options.delayJitterMs + 1))
                : 0;
        const delay = options.delayMs + jitter;
        if (delay > 0) await sleep(delay);
    }

    // Ghi candidate và cursor discovery định kỳ để resume không mất toàn bộ tiến độ khi nguồn bị challenge.
    private async persistDiscoveryState(
        checkpoint: ShopProductBatchCheckpoint,
        checkpointPath: string,
        discovered: Map<string, ShopListingCandidate>,
    ): Promise<void> {
        checkpoint.discoveryCandidates = [...discovered.values()];
        checkpoint.stage = 'discovery';
        checkpoint.updatedAt = new Date().toISOString();
        await this.persistCheckpoint(checkpointPath, checkpoint);
    }

    // Chọn category truyền vào, nếu không có thì dùng root category public của Tiki; keyword được chạy thêm như scope độc lập.
    private async resolveScopes(
        options: ShopProductBatchOptions,
    ): Promise<DiscoveryScope[]> {
        const scopes: DiscoveryScope[] = [];
        const categoryIds =
            options.categoryIds && options.categoryIds.length > 0
                ? options.categoryIds
                : (await this.deps.source.listRootCategories()).map(
                      (category) => category.externalId,
                  );

        for (const categoryExternalId of categoryIds) {
            scopes.push({ categoryExternalId });
        }
        for (const keyword of options.keywords ?? []) {
            if (keyword.trim()) scopes.push({ keyword: keyword.trim() });
        }

        if (scopes.length === 0) scopes.push({});
        return scopes;
    }

    // Chuẩn hóa item từ adapter thành candidate đủ thông tin để dedupe và cân bằng shop/group.
    private toCandidate(
        item: SourceProductListItem,
    ): ShopListingCandidate | null {
        const sellerExternalId = item.sellerExternalId;
        if (!sellerExternalId) return null;

        const catalogExternalId = item.catalogExternalId ?? item.externalId;
        const listingKey = getListingKey(item);
        return {
            listingKey,
            catalogExternalId,
            sellerExternalId,
            sellerProductExternalId: item.sellerProductExternalId,
            sellerName: item.sellerName,
            productName: item.name,
            brandName: item.brandName,
            categoryName: item.categoryName,
            canonicalGroupKey:
                item.canonicalGroupKey ??
                buildCanonicalGroupKey({
                    catalogExternalId,
                    brandName: item.brandName,
                    name: item.name,
                    categoryName: item.categoryName,
                }),
            sourceUrl: item.sourceUrl,
            sourceItem: item,
        };
    }

    // Crawl detail tuần tự để giữ rate limit an toàn, xác minh seller và ghi graph hợp lệ vào products.jsonl.
    private async crawlDetails(
        listings: ShopListingCandidate[],
        options: ShopProductBatchOptions,
        outputDir: string,
        checkpoint: ShopProductBatchCheckpoint,
        checkpointPath: string,
        manifest: ShopProductBatchManifest,
    ): Promise<void> {
        const productsPath = resolve(outputDir, 'products.jsonl');
        const failedPath = resolve(outputDir, 'failed.jsonl');

        for (const listing of listings) {
            const existing = checkpoint.entries[listing.listingKey];
            if (options.resume && existing?.status === 'succeeded') continue;

            this.updateCheckpoint(checkpoint, listing, 'crawling');
            await this.persistCheckpoint(checkpointPath, checkpoint);
            manifest.crawledListings += 1;

            try {
                const detail = this.deps.source.getProductDetailForListing
                    ? await this.deps.source.getProductDetailForListing(
                          listing.sourceItem,
                      )
                    : await this.deps.source.getProductDetail(
                          listing.catalogExternalId,
                      );

                if (
                    detail.shop?.externalId &&
                    detail.shop.externalId !== listing.sellerExternalId
                ) {
                    throw new Error(
                        `seller mismatch: expected ${listing.sellerExternalId}, got ${detail.shop.externalId}`,
                    );
                }

                if (options.includeReviews) {
                    const reviews = await this.deps.source.getProductReviews(
                        listing.catalogExternalId,
                        options.reviewLimit,
                    );
                    // Review ID của Tiki có thể dùng chung cho cùng catalog product; namespace theo listing
                    // để review của shop này không ghi đè review của shop khác khi import vào bảng unique.
                    detail.reviews = reviews.map((review) => ({
                        ...review,
                        externalId: `${listing.listingKey}:review:${review.externalId}`,
                    }));
                }

                detail.metadata = {
                    ...(detail.metadata ?? {}),
                    crawlRunId: checkpoint.crawlRunId,
                    listingKey: listing.listingKey,
                };
                const graph = this.mapper.mapToImportGraph(detail);
                const validation = validateProductGraph(graph);
                if (!validation.valid) {
                    manifest.skippedListings += 1;
                    await this.appendJsonLine(failedPath, {
                        listingKey: listing.listingKey,
                        shopId: listing.sellerExternalId,
                        status: 'skipped',
                        reasons: validation.reasons,
                    });
                    this.updateCheckpoint(
                        checkpoint,
                        listing,
                        'skipped',
                        validation.reasons.join(', '),
                    );
                } else {
                    manifest.validListings += 1;
                    await this.appendJsonLine(productsPath, graph);
                    this.updateCheckpoint(checkpoint, listing, 'succeeded');
                }
            } catch (error) {
                manifest.failedListings += 1;
                const message =
                    error instanceof Error ? error.message : String(error);
                await this.appendJsonLine(failedPath, {
                    listingKey: listing.listingKey,
                    shopId: listing.sellerExternalId,
                    status: 'failed',
                    error: message,
                });
                this.updateCheckpoint(checkpoint, listing, 'failed', message);
                this.logger.error('batch listing crawl failed', {
                    listingKey: listing.listingKey,
                    error: message,
                });
            }

            await this.persistCheckpoint(checkpointPath, checkpoint);
            await this.waitBetweenRequests(options);
        }
    }

    // Ghi candidate shop thành JSONL, bao gồm số listing và coverage để audit trước khi import.
    private serializeShop(
        shop: ShopCandidate,
        plan: ReturnType<ShopProductBatchPlannerService['buildPlan']>,
    ): Record<string, unknown> {
        const groups = [
            ...new Set(
                shop.listings.map((listing) => listing.canonicalGroupKey),
            ),
        ];
        return {
            sellerExternalId: shop.sellerExternalId,
            sellerName: shop.sellerName,
            sourceUrl: shop.sourceUrl,
            listingCount: shop.listings.length,
            canonicalGroups: groups.map((groupKey) => ({
                groupKey,
                shopCount: plan.groupCoverage[groupKey] ?? 0,
            })),
        };
    }

    // Đếm phân bổ listing theo category để phát hiện batch bị lệch một ngành hàng.
    private countByCategory(
        listings: ShopListingCandidate[],
    ): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const listing of listings) {
            const category = listing.categoryName?.trim() || 'unknown';
            counts[category] = (counts[category] ?? 0) + 1;
        }
        return counts;
    }

    // Cập nhật trạng thái listing trong checkpoint để resume không crawl lại item đã hoàn tất.
    private updateCheckpoint(
        checkpoint: ShopProductBatchCheckpoint,
        listing: ShopListingCandidate,
        status: BatchCheckpointEntry['status'],
        error?: string,
    ): void {
        checkpoint.entries[listing.listingKey] = {
            listingKey: listing.listingKey,
            shopId: listing.sellerExternalId,
            status,
            updatedAt: new Date().toISOString(),
            ...(error ? { error } : {}),
        };
        checkpoint.updatedAt = new Date().toISOString();
    }

    // Đọc checkpoint cũ khi resume; file hỏng được coi là chưa có checkpoint để không làm job crash mù.
    private async loadCheckpoint(
        path: string,
        resume: boolean,
    ): Promise<ShopProductBatchCheckpoint | null> {
        if (!resume) return null;
        try {
            return JSON.parse(
                await readFile(path, 'utf8'),
            ) as ShopProductBatchCheckpoint;
        } catch {
            return null;
        }
    }

    // Persist toàn bộ checkpoint nguyên tử ở mức file để process dừng giữa request vẫn có thể resume.
    private async persistCheckpoint(
        path: string,
        checkpoint: ShopProductBatchCheckpoint,
    ): Promise<void> {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(
            path,
            `${JSON.stringify(checkpoint, null, 2)}\n`,
            'utf8',
        );
    }

    // Ghi một danh sách JSONL và thay thế file cũ, dùng cho artifact discovery/planning deterministic.
    private async writeJsonLines(
        path: string,
        values: unknown[],
    ): Promise<void> {
        await mkdir(dirname(path), { recursive: true });
        const content = values.map((value) => JSON.stringify(value)).join('\n');
        await writeFile(path, content ? `${content}\n` : '', 'utf8');
    }

    // Append từng graph sau khi validate để lỗi của một listing không làm mất các listing trước đó.
    private async appendJsonLine(path: string, value: unknown): Promise<void> {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8');
    }

    // Đồng bộ số liệu từ checkpoint để manifest resume phản ánh toàn bộ batch, không chỉ lượt chạy cuối.
    private syncManifestCounters(
        manifest: ShopProductBatchManifest,
        checkpoint: ShopProductBatchCheckpoint,
    ): void {
        const entries = Object.values(checkpoint.entries);
        manifest.crawledListings = entries.filter((entry) =>
            ['succeeded', 'skipped', 'failed'].includes(entry.status),
        ).length;
        manifest.validListings = entries.filter(
            (entry) => entry.status === 'succeeded',
        ).length;
        manifest.skippedListings = entries.filter(
            (entry) => entry.status === 'skipped',
        ).length;
        manifest.failedListings = entries.filter(
            (entry) => entry.status === 'failed',
        ).length;
    }

    // Kiểm tra cấu hình batch trước khi tạo request lớn hoặc tạo artifact khó giải thích.
    private validateOptions(options: ShopProductBatchOptions): void {
        if (options.discoveryPages <= 0 || options.discoveryLimit <= 0) {
            throw new Error(
                'discovery pages and limit must be greater than zero',
            );
        }
        if (options.delayMs < 0)
            throw new Error('delayMs must be non-negative');
        if (
            options.maxDiscoveryShops !== undefined &&
            options.maxDiscoveryShops <= 0
        ) {
            throw new Error('maxDiscoveryShops must be greater than zero');
        }
        if (options.maxProductsPerShop < options.minProductsPerShop) {
            throw new Error('invalid products-per-shop quota');
        }
        if (options.maxShopsPerGroup < options.minShopsPerGroup) {
            throw new Error('invalid shops-per-group quota');
        }
    }
}

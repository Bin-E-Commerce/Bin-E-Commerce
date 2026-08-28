import { sleep } from '../../utils/sleep';
import type { CrawlerLogger } from '../../loggers/crawler.logger';
import { TikiBrandClient } from '../clients/tiki-brand.client';
import { FileBrandCheckpointStore } from '../checkpoints/file-brand-checkpoint.store';
import { BrandCatalogMapper } from '../mappers/brand-catalog.mapper';
import type {
    BrandCrawlCatalog,
    BrandCrawlQualityIssue,
    BrandCrawlSummary,
    MutableBrandRecord,
} from '../types/brand-catalog.type';
import type { BrandCrawlCheckpoint } from '../types/brand-crawl-checkpoint.type';
import type { BrandCrawlOptions } from '../types/brand-crawl-options.type';
import type { BrandCrawlResult } from '../types/brand-crawl-result.type';
import type {
    TikiBrandProductSample,
    TikiMenuCategory,
} from '../types/tiki-brand-source.type';

export interface BrandCrawlerDependencies {
    client: TikiBrandClient;
    checkpoint: FileBrandCheckpointStore;
    mapper: BrandCatalogMapper;
    logger: CrawlerLogger;
}

export class BrandCrawlerService {
    constructor(private readonly dependencies: BrandCrawlerDependencies) {}

    // Điều phối hai pha discovery và enrichment, sau đó tạo catalog cùng quality report độc lập với Catalog Service.
    async crawl(options: BrandCrawlOptions): Promise<BrandCrawlResult> {
        const checkpoint = await this.loadOrCreateCheckpoint(options);
        const brandRecords = new Map(
            checkpoint.brands.map((brand) => [brand.externalBrandId, brand]),
        );
        const requestFailureCountBeforeDiscovery = this.countRequestFailures(
            checkpoint,
        );

        await this.discoverBrands(checkpoint, brandRecords, options);
        const discoveryFailed =
            this.countRequestFailures(checkpoint) >
            requestFailureCountBeforeDiscovery;
        const discoveryScopeCompleted = this.isDiscoveryScopeCompleted(
            checkpoint,
            brandRecords,
            options,
        );

        // Khi nguồn vừa giới hạn discovery, không tiếp tục phát hàng nghìn request detail; checkpoint phải được resume sau cooldown trước khi enrichment bắt đầu.
        if (!discoveryFailed && discoveryScopeCompleted) {
            await this.enrichBrands(checkpoint, brandRecords, options);
        } else {
            this.dependencies.logger.warn(
                'brand enrichment deferred until discovery can resume',
                {
                    pendingCategories: checkpoint.pendingCategories.length,
                    discoveredBrands: brandRecords.size,
                    discoveryFailed,
                },
            );
        }

        const generatedAt = new Date().toISOString();
        const finalized = [...brandRecords.values()]
            .map((record) => this.dependencies.mapper.finalize(record))
            .sort((left, right) => left.brand.name.localeCompare(right.brand.name, 'vi'));
        const qualityIssues = finalized
            .map((item) => item.issue)
            .filter((issue): issue is BrandCrawlQualityIssue => issue !== null);
        const summary = this.buildSummary(checkpoint, finalized.map((item) => item.brand));
        const completed = this.isCrawlCompleted(checkpoint, brandRecords, options);

        if (completed) {
            await this.dependencies.checkpoint.clear();
        }
        return {
            catalog: {
                schemaVersion: 1,
                sourcePlatform: 'tiki',
                sourceMode: 'public-taxonomy',
                generatedAt,
                completed,
                summary,
                brands: finalized.map((item) => item.brand),
            },
            report: {
                generatedAt,
                summary,
                issues: [...checkpoint.issues, ...qualityIssues],
            },
        };
    }

    // Khôi phục checkpoint khi bật resume; nếu không có thì lấy menu public mới nhất làm queue BFS ban đầu.
    private async loadOrCreateCheckpoint(
        options: BrandCrawlOptions,
    ): Promise<BrandCrawlCheckpoint> {
        const saved = options.resume
            ? await this.dependencies.checkpoint.load()
            : null;
        if (saved) {
            this.dependencies.logger.info('brand crawl checkpoint restored', {
                processedCategories: saved.processedCategoryIds.length,
                discoveredBrands: saved.brands.length,
                nextBrandIndex: saved.nextBrandIndex,
            });
            return saved;
        }

        const roots = await this.resolveRootCategories(options.categoryIds);
        return {
            schemaVersion: 1,
            startedAt: new Date().toISOString(),
            rootCategoryCount: roots.length,
            pendingCategories: roots,
            processedCategoryIds: [],
            brands: [],
            enrichedBrandIds: [],
            nextBrandIndex: 0,
            issues: [],
        };
    }

    // Duyệt cây category chỉ để đọc aggregation brand; không gọi API ghi và không kết nối database catalog.
    private async discoverBrands(
        checkpoint: BrandCrawlCheckpoint,
        brandRecords: Map<string, MutableBrandRecord>,
        options: BrandCrawlOptions,
    ): Promise<void> {
        const processed = new Set(checkpoint.processedCategoryIds);

        while (checkpoint.pendingCategories.length > 0) {
            if (
                options.maxCategories !== undefined &&
                processed.size >= options.maxCategories
            ) {
                break;
            }
            if (
                options.maxBrands !== undefined &&
                brandRecords.size >= options.maxBrands
            ) {
                break;
            }

            const category = checkpoint.pendingCategories.shift();
            if (!category || processed.has(category.id)) continue;
            let shouldPauseDiscovery = false;

            try {
                const discovery = await this.dependencies.client.discoverCategory(
                    category,
                );
                const observedAt = new Date().toISOString();

                for (const brand of discovery.brands) {
                    if (
                        options.maxBrands !== undefined &&
                        !brandRecords.has(brand.externalBrandId) &&
                        brandRecords.size >= options.maxBrands
                    ) {
                        break;
                    }

                    const merged = this.dependencies.mapper.mergeDiscovery(
                        brandRecords.get(brand.externalBrandId),
                        brand,
                        category,
                        observedAt,
                    );
                    brandRecords.set(brand.externalBrandId, merged);
                }

                this.enqueueChildren(
                    checkpoint.pendingCategories,
                    discovery.childCategories,
                    processed,
                );
                this.dependencies.logger.info('brand category discovered', {
                    categoryId: category.id,
                    categoryName: category.name,
                    childCategories: discovery.childCategories.length,
                    brands: discovery.brands.length,
                    totalBrands: brandRecords.size,
                });
            } catch (error) {
                this.recordRequestFailure(checkpoint, error, {
                    categoryId: String(category.id),
                    details: `Không đọc được aggregation category ${category.name}.`,
                });
                // Giữ category lỗi ở đầu queue và kết thúc pha discovery để lần --resume không bỏ sót node nguồn.
                checkpoint.pendingCategories.unshift(category);
                shouldPauseDiscovery = true;
            } finally {
                if (!shouldPauseDiscovery) processed.add(category.id);
                checkpoint.processedCategoryIds = [...processed];
                checkpoint.brands = [...brandRecords.values()];
                await this.dependencies.checkpoint.save(checkpoint);
                await sleep(options.discoveryDelayMs);
            }

            // Tạm dừng cả pha thay vì lặp ngay category đang bị nguồn giới hạn và tạo thêm request thất bại.
            if (shouldPauseDiscovery) break;
        }
    }

    // Lấy product detail mẫu theo category có nhiều sản phẩm nhất để thu bằng chứng quốc gia và logo của brand.
    private async enrichBrands(
        checkpoint: BrandCrawlCheckpoint,
        brandRecords: Map<string, MutableBrandRecord>,
        options: BrandCrawlOptions,
    ): Promise<void> {
        if (!options.includeCountryEvidence || options.sampleProductsPerBrand === 0) {
            checkpoint.nextBrandIndex = brandRecords.size;
            return;
        }

        const brands = [...brandRecords.values()].sort((left, right) =>
            left.externalBrandId.localeCompare(right.externalBrandId),
        );
        const enrichedBrandIds = new Set(checkpoint.enrichedBrandIds ?? []);

        for (let index = 0; index < brands.length; index += 1) {
            const brand = brands[index];
            if (!brand || enrichedBrandIds.has(brand.externalBrandId)) continue;
            let shouldPauseEnrichment = false;

            try {
                const samples = await this.fetchSamplesAcrossCategories(
                    brand,
                    options.sampleProductsPerBrand,
                );
                this.dependencies.mapper.mergeSamples(
                    brand,
                    samples,
                    new Date().toISOString(),
                );
                this.dependencies.logger.info('brand evidence enriched', {
                    externalBrandId: brand.externalBrandId,
                    brandName: brand.names[0],
                    samples: samples.length,
                    progress: `${index + 1}/${brands.length}`,
                });
                enrichedBrandIds.add(brand.externalBrandId);
            } catch (error) {
                this.recordRequestFailure(checkpoint, error, {
                    externalBrandId: brand.externalBrandId,
                    brandName: brand.names[0],
                    details: 'Không lấy được product detail mẫu cho brand.',
                });
                // Dừng ngay ở lỗi nguồn đầu tiên để tránh biến rate limit tạm thời thành hàng nghìn request thất bại.
                shouldPauseEnrichment = true;
            } finally {
                checkpoint.nextBrandIndex = index + 1;
                checkpoint.enrichedBrandIds = [...enrichedBrandIds];
                checkpoint.brands = brands;
                await this.dependencies.checkpoint.save(checkpoint);
                await sleep(options.enrichmentDelayMs);
            }

            if (shouldPauseEnrichment) break;
        }
    }

    // Thử tối đa ba category có độ phủ cao nhất; dừng ngay khi thu đủ số sample để giảm request tới nguồn.
    private async fetchSamplesAcrossCategories(
        brand: MutableBrandRecord,
        sampleLimit: number,
    ): Promise<TikiBrandProductSample[]> {
        const samples: TikiBrandProductSample[] = [];
        const categories = [...brand.categories]
            .sort((left, right) => right.productCount - left.productCount)
            .slice(0, 3);

        for (const category of categories) {
            const remaining = sampleLimit - samples.length;
            if (remaining <= 0) break;

            const categorySamples = await this.dependencies.client.fetchBrandSamples(
                brand.externalBrandId,
                Number(category.externalCategoryId),
                remaining,
            );
            samples.push(...categorySamples);
        }

        return samples;
    }

    // Dùng category ID do operator truyền nếu có; nếu không thì đọc toàn bộ root menu public tại thời điểm chạy.
    private async resolveRootCategories(
        categoryIds: number[] | undefined,
    ): Promise<TikiMenuCategory[]> {
        if (categoryIds?.length) {
            return [...new Set(categoryIds)].map((id) => ({
                id,
                name: `Tiki category ${id}`,
                url: `https://tiki.vn/c${id}`,
                iconUrl: null,
                parentId: null,
            }));
        }

        return this.dependencies.client.fetchRootCategories();
    }

    // Chỉ enqueue category chưa xử lý/chưa chờ để tránh vòng lặp khi aggregation lặp node cha ở nhiều nhánh.
    private enqueueChildren(
        pending: TikiMenuCategory[],
        children: TikiMenuCategory[],
        processed: Set<number>,
    ): void {
        const queued = new Set(pending.map((category) => category.id));
        for (const child of children) {
            if (processed.has(child.id) || queued.has(child.id)) continue;
            pending.push(child);
            queued.add(child.id);
        }
    }

    // Ghi request failure vào report/checkpoint và log nguyên nhân mà không làm mất toàn bộ tiến độ job.
    private recordRequestFailure(
        checkpoint: BrandCrawlCheckpoint,
        error: unknown,
        context: Omit<BrandCrawlQualityIssue, 'type'>,
    ): void {
        const message = error instanceof Error ? error.message : String(error);
        checkpoint.issues.push({
            type: 'request_failed',
            ...context,
            details: `${context.details} ${message}`,
        });
        this.dependencies.logger.error('brand crawl request failed', {
            ...context,
            error: message,
        });
    }

    // Đếm riêng lỗi request để quyết định có nên tiếp tục pha enrichment trong chính lần chạy hiện tại hay không.
    private countRequestFailures(checkpoint: BrandCrawlCheckpoint): number {
        return checkpoint.issues.filter((issue) => issue.type === 'request_failed')
            .length;
    }

    // Full crawl phải hết queue; pilot được phép chuyển pha khi đạt giới hạn category hoặc brand do operator cấu hình.
    private isDiscoveryScopeCompleted(
        checkpoint: BrandCrawlCheckpoint,
        brandRecords: Map<string, MutableBrandRecord>,
        options: BrandCrawlOptions,
    ): boolean {
        if (checkpoint.pendingCategories.length === 0) return true;

        const reachedCategoryLimit =
            options.maxCategories !== undefined &&
            checkpoint.processedCategoryIds.length >= options.maxCategories;
        const reachedBrandLimit =
            options.maxBrands !== undefined &&
            brandRecords.size >= options.maxBrands;

        return reachedCategoryLimit || reachedBrandLimit;
    }

    // Tổng hợp số liệu từ kết quả cuối thay vì cộng dồn thủ công để resume không làm sai thống kê.
    private buildSummary(
        checkpoint: BrandCrawlCheckpoint,
        brands: BrandCrawlCatalog['brands'],
    ): BrandCrawlSummary {
        const discoveredCategoryIds = new Set([
            ...checkpoint.processedCategoryIds,
            ...checkpoint.pendingCategories.map((category) => category.id),
        ]);

        return {
            rootCategoryCount: checkpoint.rootCategoryCount,
            discoveredCategoryCount: discoveredCategoryIds.size,
            processedCategoryCount: checkpoint.processedCategoryIds.length,
            discoveredBrandCount: brands.length,
            enrichedBrandCount: brands.filter(
                (brand) => brand.countryEvidence.length > 0,
            ).length,
            resolvedCountryCount: brands.filter(
                (brand) => brand.country.status === 'resolved',
            ).length,
            conflictCountryCount: brands.filter(
                (brand) => brand.country.status === 'conflict',
            ).length,
            unknownCountryAliasCount: brands.filter(
                (brand) => brand.country.status === 'unknown_alias',
            ).length,
            missingCountryCount: brands.filter(
                (brand) => brand.country.status === 'missing',
            ).length,
            failedRequestCount: checkpoint.issues.filter(
                (issue) => issue.type === 'request_failed',
            ).length,
        };
    }

    // Chỉ xóa checkpoint khi không còn category chờ và mọi brand đã enrichment thành công hoặc operator chủ động bỏ qua country.
    private isCrawlCompleted(
        checkpoint: BrandCrawlCheckpoint,
        brandRecords: Map<string, MutableBrandRecord>,
        options: BrandCrawlOptions,
    ): boolean {
        if (checkpoint.pendingCategories.length > 0) return false;
        if (!options.includeCountryEvidence || options.sampleProductsPerBrand === 0) {
            return true;
        }

        const enrichedBrandIds = new Set(checkpoint.enrichedBrandIds ?? []);
        return [...brandRecords.keys()].every((brandId) =>
            enrichedBrandIds.has(brandId),
        );
    }
}

import type { ProductSourceAdapter } from '../adapters/product-source.adapter';
import type { CheckpointStore } from '../checkpoints/checkpoint.store';
import { ProductMapper } from '../mappers/product.mapper';
import type { ProductImportRepository } from '../repositories/product-import.repository';
import type { ProductCrawlOptions } from '../types/product-crawl-options.type';
import type { ImportProductGraph } from '../types/import-product.type';
import { validateProductGraph } from '../validators/product-import.validator';
import type { CrawlerLogger, CrawlStats } from '../loggers/crawler.logger';
import { ConsoleCrawlerLogger } from '../loggers/crawler.logger';
import { sleep } from '../utils/sleep';

export interface ProductCrawlerServiceDependencies {
    source: ProductSourceAdapter;
    checkpoint: CheckpointStore;
    repository?: ProductImportRepository;
    mapper?: ProductMapper;
    logger?: CrawlerLogger;
}

export interface ProductCrawlerRunResult {
    products: ImportProductGraph[];
    stats: CrawlStats;
}

export class ProductCrawlerService {
    private readonly mapper: ProductMapper;
    private readonly logger: CrawlerLogger;

    constructor(private readonly deps: ProductCrawlerServiceDependencies) {
        this.mapper = deps.mapper ?? new ProductMapper();
        this.logger = deps.logger ?? new ConsoleCrawlerLogger();
    }

    // Crawl theo category hoặc keyword, validate dữ liệu và import nếu có repository.
    // Crawl theo category, keyword hoặc seller; reviews-only loại product không có review thật trước khi tăng crawled count.
    // Quy tắc này giữ dataset recommendation có dữ liệu đánh giá thực tế thay vì chỉ dựa vào reviewCount trên listing.
    async crawl(options: ProductCrawlOptions): Promise<ProductCrawlerRunResult> {
        const stats: CrawlStats = {
            crawled: 0,
            imported: 0,
            skipped: 0,
            failed: 0,
        };
        const products: ImportProductGraph[] = [];
        const categoryIds = await this.resolveCategoryIds(options);
        const checkpoint = options.resume ? await this.deps.checkpoint.load() : null;

        for (const categoryExternalId of categoryIds) {
            const startPage =
                checkpoint?.categoryExternalId === categoryExternalId
                    ? checkpoint.page
                    : 1;

            for (let page = startPage; page <= options.pages; page += 1) {
                const pageResult = await this.deps.source.listProducts({
                    categoryExternalId: categoryExternalId ?? undefined,
                    sellerExternalId: options.sellerId,
                    sellerName: options.sellerName,
                    sellerSlug: options.sellerSlug,
                    keyword: options.keyword,
                    page,
                    limit: options.limit,
                });

                if (pageResult.items.length === 0) break;

                for (const item of pageResult.items) {
                    if (
                        options.maxProducts !== undefined &&
                        stats.crawled >= options.maxProducts
                    ) {
                        this.logger.stats(stats);
                        return { products, stats };
                    }

                    try {
                        const detail = await this.deps.source.getProductDetail(
                            item.externalId,
                        );

                        // Listing filter của Tiki có thể trả product nhiều nhà bán; chỉ giữ detail có current seller
                        // đúng seller được yêu cầu để snapshot không trộn shop và dữ liệu shop không bị sai lệch.
                        if (
                            options.sellerId &&
                            detail.shop?.externalId !== options.sellerId
                        ) {
                            stats.skipped += 1;
                            this.logger.warn('skip product from another seller', {
                                externalId: item.externalId,
                                expectedSellerId: options.sellerId,
                                actualSellerId: detail.shop?.externalId ?? null,
                            });
                            continue;
                        }

                        if (options.includeReviews) {
                            detail.reviews = await this.deps.source.getProductReviews(
                                item.externalId,
                                options.reviewLimit,
                            );
                        }
                        // Chỉ giữ product có review đã lấy được từ endpoint review; reviewCount trên listing
                        // có thể không đồng nhất với dữ liệu chi tiết nên không dùng nó làm điều kiện duy nhất.
                        if (options.requireReviews && detail.reviews.length === 0) {
                            stats.skipped += 1;
                            this.logger.warn('skip product without reviews', {
                                externalId: item.externalId,
                            });
                            continue;
                        }

                        const graph = this.mapper.mapToImportGraph(detail);
                        const validation = validateProductGraph(graph);

                        if (!validation.valid) {
                            stats.skipped += 1;
                            this.logger.warn('skip invalid product', {
                                externalId: item.externalId,
                                reasons: validation.reasons,
                            });
                            continue;
                        }

                        stats.crawled += 1;
                        products.push(graph);

                        if (options.importToDatabase) {
                            if (!this.deps.repository) {
                                throw new Error(
                                    'Missing repository for database import',
                                );
                            }
                            const importResult =
                                await this.deps.repository.upsertProductGraph(
                                    graph,
                                );

                            // Repository có thể bỏ qua product hợp lệ ở nguồn crawl nhưng chưa map được category nội bộ.
                            if (importResult.insertedOrUpdated) {
                                stats.imported += 1;
                            } else {
                                stats.skipped += 1;
                            }
                        }

                        await this.deps.checkpoint.save({
                            sourcePlatform: this.deps.source.platform,
                            categoryExternalId: categoryExternalId ?? null,
                            keyword: options.keyword ?? null,
                            page,
                            productExternalId: item.externalId,
                            updatedAt: new Date().toISOString(),
                        });
                    } catch (error) {
                        stats.failed += 1;
                        this.logger.error('crawl product failed', {
                            externalId: item.externalId,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    }

                    if (options.delayMs > 0) await sleep(options.delayMs);
                }

                if (
                    pageResult.lastPage !== null &&
                    pageResult.currentPage >= pageResult.lastPage
                ) {
                    break;
                }
            }
        }

        await this.deps.checkpoint.clear();
        this.logger.stats(stats);
        return { products, stats };
    }

    // Xác định danh sách category cần crawl; nếu không truyền category thì chạy keyword/global search.
    private async resolveCategoryIds(
        options: ProductCrawlOptions,
    ): Promise<Array<string | null>> {
        if (options.categoryIds && options.categoryIds.length > 0) {
            return options.categoryIds;
        }
        if (options.categoryId !== undefined) return [String(options.categoryId)];
        return [null];
    }
}

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
                        if (options.includeReviews) {
                            detail.reviews = await this.deps.source.getProductReviews(
                                item.externalId,
                                options.reviewLimit,
                            );
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

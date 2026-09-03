import {
    DEFAULT_PAGE_LIMIT,
    DEFAULT_REQUEST_DELAY_MS,
} from './config/tiki.config';
import { TikiSourceAdapter } from './adapters/tiki-source.adapter';
import { FileCheckpointStore } from './checkpoints/file-checkpoint.store';
import { PostgresClient } from './database/postgres-client';
import { writeProductsToJson } from './exporters/json-product.exporter';
import { ConsoleCrawlerLogger } from './loggers/crawler.logger';
import { ProductMapper } from './mappers/product.mapper';
import { ProductServiceImportRepository } from './repositories/product-service-import.repository';
import { ProductCrawlerService } from './services/product-crawler.service';
import type { ProductCrawlOptions } from './types/product-crawl-options.type';
import type { ImportProductGraph } from './types/import-product.type';
import { validateProductGraph } from './validators/product-import.validator';
import { readFile } from 'node:fs/promises';

const DEFAULT_OUTPUT_FILE = 'data/tiki-product-service-import.json';
const DEFAULT_CHECKPOINT_FILE = 'data/tiki-product-service-checkpoint.json';

interface ProductServiceImportOptions extends ProductCrawlOptions {
    inputFile?: string;
}

// Đọc tham số CLI tối giản để chạy crawl/import thử từ Tiki vào product-service.
function parseArgs(argv: string[]): ProductServiceImportOptions {
    const args = new Map<string, string | boolean>();

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token?.startsWith('--')) continue;

        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args.set(key, true);
            continue;
        }

        args.set(key, next);
        index += 1;
    }

    return {
        keyword: getStringArg(args, 'keyword') ?? 'laptop',
        categoryId: getNumberArg(args, 'category'),
        categoryIds: getCsvArg(args, 'category-ids'),
        sellerId: getStringArg(args, 'seller-id'),
        sellerName: getStringArg(args, 'seller-name'),
        sellerSlug: getStringArg(args, 'seller-slug'),
        pages: getNumberArg(args, 'pages') ?? 10,
        limit: getNumberArg(args, 'limit') ?? DEFAULT_PAGE_LIMIT,
        maxProducts: getNumberArg(args, 'max') ?? 200,
        includeDetails: true,
        includeReviews: args.get('reviews') === true,
        requireReviews: args.get('reviews-only') === true,
        reviewLimit: getNumberArg(args, 'review-limit') ?? 5,
        delayMs: getNumberArg(args, 'delay') ?? DEFAULT_REQUEST_DELAY_MS,
        outputFile: getStringArg(args, 'output') ?? DEFAULT_OUTPUT_FILE,
        checkpointFile:
            getStringArg(args, 'checkpoint') ?? DEFAULT_CHECKPOINT_FILE,
        importToDatabase: true,
        resume: args.get('resume') === true,
        inputFile: getStringArg(args, 'input'),
    };
}

// Lấy string arg từ Map và bỏ qua flag boolean.
function getStringArg(
    args: Map<string, string | boolean>,
    key: string,
): string | undefined {
    const value = args.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Lấy danh sách CSV từ CLI, ví dụ --category-ids 1789,1882.
function getCsvArg(
    args: Map<string, string | boolean>,
    key: string,
): string[] | undefined {
    const value = getStringArg(args, key);
    if (!value) return undefined;
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

// Lấy number arg từ Map, trả undefined nếu người dùng nhập thiếu hoặc sai số.
function getNumberArg(
    args: Map<string, string | boolean>,
    key: string,
): number | undefined {
    const value = args.get(key);
    if (typeof value !== 'string') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

// Chạy crawler Tiki rồi import sang product-service DB; catalog DB chỉ dùng để đọc category có sẵn.
async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const logger = new ConsoleCrawlerLogger();
    const productDatabaseUrl =
        process.env['PRODUCT_DATABASE_URL'] ??
        'postgres://bin_ecommerce:changeme_postgres@localhost:5432/bin_ecommerce_product';
    const catalogDatabaseUrl =
        process.env['CATALOG_DATABASE_URL'] ??
        'postgres://bin_ecommerce:changeme_postgres@localhost:5432/bin_ecommerce_catalog';

    const productDb = new PostgresClient(productDatabaseUrl);
    const catalogDb = new PostgresClient(catalogDatabaseUrl);

    await productDb.connect();
    await catalogDb.connect();

    try {
        const repository = new ProductServiceImportRepository(
            productDb,
            catalogDb,
        );
        if (options.inputFile) {
            await importFromJsonFile(options.inputFile, repository, logger);
            return;
        }

        const crawler = new ProductCrawlerService({
            source: new TikiSourceAdapter(),
            checkpoint: new FileCheckpointStore(options.checkpointFile),
            repository,
            mapper: new ProductMapper(),
            logger,
        });
        const result = await crawler.crawl(options);
        const outputPath = await writeProductsToJson(
            result.products,
            options.outputFile,
        );

        logger.info('product-service import output saved', { outputPath });
    } finally {
        await Promise.all([productDb.close(), catalogDb.close()]);
    }
}

// Import lại từ file JSON đã crawl để có thể seed DB ngay cả khi public API Tiki tạm trả HTML hoặc rate-limit.
async function importFromJsonFile(
    inputFile: string,
    repository: ProductServiceImportRepository,
    logger: ConsoleCrawlerLogger,
): Promise<void> {
    const raw = await readFile(inputFile, 'utf8');
    const products = JSON.parse(raw) as ImportProductGraph[];
    const stats = {
        crawled: products.length,
        imported: 0,
        skipped: 0,
        failed: 0,
    };

    for (const product of products) {
        try {
            const validation = validateProductGraph(product);
            if (!validation.valid) {
                stats.skipped += 1;
                logger.warn('skip invalid product from file', {
                    externalId: product.product.externalId,
                    reasons: validation.reasons,
                });
                continue;
            }

            const result = await repository.upsertProductGraph(product);
            if (result.insertedOrUpdated) {
                stats.imported += 1;
            } else {
                stats.skipped += 1;
            }
        } catch (error) {
            stats.failed += 1;
            logger.error('import product from file failed', {
                externalId: product.product.externalId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    logger.stats(stats);
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});

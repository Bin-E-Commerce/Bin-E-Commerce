import {
    DEFAULT_OUTPUT_FILE,
    DEFAULT_PAGE_LIMIT,
    DEFAULT_REQUEST_DELAY_MS,
} from './config/tiki.config';
import { TikiSourceAdapter } from './adapters/tiki-source.adapter';
import { FileCheckpointStore } from './checkpoints/file-checkpoint.store';
import { PostgresClient } from './database/postgres-client';
import { writeProductsToJson } from './exporters/json-product.exporter';
import { ConsoleCrawlerLogger } from './loggers/crawler.logger';
import { ProductMapper } from './mappers/product.mapper';
import { PostgresProductImportRepository } from './repositories/postgres-product-import.repository';
import { ProductCrawlerService } from './services/product-crawler.service';
import type { ProductCrawlOptions } from './types/product-crawl-options.type';

const DEFAULT_CHECKPOINT_FILE = 'data/tiki-checkpoint.json';

// Đọc tham số CLI dạng --key value hoặc flag boolean để chạy crawler không cần thêm thư viện CLI.
function parseArgs(argv: string[]): ProductCrawlOptions {
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
        keyword: getStringArg(args, 'keyword'),
        categoryId: getNumberArg(args, 'category'),
        categoryIds: getCsvArg(args, 'category-ids'),
        sellerId: getStringArg(args, 'seller-id'),
        sellerName: getStringArg(args, 'seller-name'),
        sellerSlug: getStringArg(args, 'seller-slug'),
        pages: getNumberArg(args, 'pages') ?? 1,
        limit: getNumberArg(args, 'limit') ?? DEFAULT_PAGE_LIMIT,
        maxProducts: getNumberArg(args, 'max'),
        includeDetails: args.get('details') !== false,
        includeReviews: args.get('reviews') === true,
        requireReviews: args.get('reviews-only') === true,
        reviewLimit: getNumberArg(args, 'review-limit') ?? 10,
        delayMs: getNumberArg(args, 'delay') ?? DEFAULT_REQUEST_DELAY_MS,
        outputFile: getStringArg(args, 'output') ?? DEFAULT_OUTPUT_FILE,
        checkpointFile:
            getStringArg(args, 'checkpoint') ?? DEFAULT_CHECKPOINT_FILE,
        importToDatabase: args.get('import') === true,
        resume: args.get('resume') === true,
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

// Tạo repository import nếu CLI bật --import, còn không chỉ crawl và xuất JSON.
async function createRepository(options: ProductCrawlOptions): Promise<{
    repository?: PostgresProductImportRepository;
    close: () => Promise<void>;
}> {
    if (!options.importToDatabase) {
        return { close: async () => undefined };
    }

    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
        throw new Error('DATABASE_URL is required when using --import');
    }

    const client = new PostgresClient(databaseUrl);
    await client.connect();
    return {
        repository: new PostgresProductImportRepository(client),
        close: () => client.close(),
    };
}

// Chạy crawler/importer từ CLI và luôn ghi file JSON để kiểm tra dữ liệu mapping.
async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const logger = new ConsoleCrawlerLogger();
    const { repository, close } = await createRepository(options);

    try {
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

        logger.info('crawl output saved', { outputPath });
    } finally {
        await close();
    }
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});

export { ProductCrawlerService } from './services/product-crawler.service';
export { TikiSourceAdapter } from './adapters/tiki-source.adapter';
export { TikiProductClient } from './clients/tiki-product.client';
export { ProductMapper } from './mappers/product.mapper';
export { PostgresProductImportRepository } from './repositories/postgres-product-import.repository';
export type { ProductCrawlOptions } from './types/product-crawl-options.type';
export type { ImportProductGraph } from './types/import-product.type';
export type { SourceProductDetail } from './types/source-product.type';

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
import { appendFile, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const DEFAULT_OUTPUT_FILE = 'data/tiki-product-service-import.json';
const DEFAULT_CHECKPOINT_FILE = 'data/tiki-product-service-checkpoint.json';

// Bắt buộc nhận connection string từ môi trường để crawler không rơi về credential mặc định.
function requireDatabaseUrl(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required to run the crawler.`);
    return value;
}

interface ProductServiceImportOptions extends ProductCrawlOptions {
    inputFile?: string;
    dryRun: boolean;
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
        dryRun: args.get('dry-run') === true,
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
    if (options.inputFile && options.dryRun) {
        await validateImportFile(options.inputFile, logger);
        return;
    }

    const productDatabaseUrl = requireDatabaseUrl('PRODUCT_DATABASE_URL');
    const catalogDatabaseUrl = requireDatabaseUrl('CATALOG_DATABASE_URL');

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
            await importFromJsonFile(
                options.inputFile,
                repository,
                logger,
                options.resume,
            );
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
    resume: boolean,
): Promise<void> {
    const importedCheckpoint = `${inputFile}.imported.jsonl`;
    const importedIds = resume
        ? await loadImportedIds(importedCheckpoint)
        : new Set<string>();
    const stats = {
        crawled: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
    };

    for await (const product of readProductGraphs(inputFile)) {
        stats.crawled += 1;
        if (resume && importedIds.has(product.product.externalId)) {
            stats.skipped += 1;
            continue;
        }
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
                await appendFile(
                    importedCheckpoint,
                    `${JSON.stringify({ externalId: product.product.externalId })}\n`,
                    'utf8',
                );
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

// Đọc cả JSON array cũ và JSONL staging mới để importer giữ tương thích với các batch trước đây.
async function* readProductGraphs(
    inputFile: string,
): AsyncGenerator<ImportProductGraph> {
    if (!inputFile.toLowerCase().endsWith('.jsonl')) {
        const raw = await readFile(inputFile, 'utf8');
        const products = JSON.parse(raw) as ImportProductGraph[];
        for (const product of products) yield product;
        return;
    }

    const lines = createInterface({
        input: createReadStream(inputFile, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });
    for await (const line of lines) {
        if (!line.trim()) continue;
        yield JSON.parse(line) as ImportProductGraph;
    }
}

// Đọc các external ID đã import thành công để resume không gửi lại product đã commit.
async function loadImportedIds(path: string): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
        const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
        for (const line of lines) {
            if (!line.trim()) continue;
            const value = JSON.parse(line) as { externalId?: unknown };
            if (typeof value.externalId === 'string') ids.add(value.externalId);
        }
    } catch {
        // Chưa có checkpoint import nghĩa là bắt đầu từ đầu.
    }
    return ids;
}

// Validate toàn bộ staging mà không cần kết nối database, dùng trước khi import batch lớn.
async function validateImportFile(
    inputFile: string,
    logger: ConsoleCrawlerLogger,
): Promise<void> {
    let total = 0;
    let valid = 0;
    let invalid = 0;

    for await (const product of readProductGraphs(inputFile)) {
        total += 1;
        const result = validateProductGraph(product);
        if (result.valid) valid += 1;
        else {
            invalid += 1;
            logger.warn('dry-run invalid product', {
                externalId: product.product.externalId,
                reasons: result.reasons,
            });
        }
    }

    logger.info('dry-run import validation completed', {
        total,
        valid,
        invalid,
    });
    if (invalid > 0) {
        throw new Error(`dry-run found ${invalid} invalid product graphs`);
    }
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});

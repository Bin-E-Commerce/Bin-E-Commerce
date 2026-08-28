import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { TikiBrandClient } from './brands/clients/tiki-brand.client';
import { TikiOpenApiBrandClient } from './brands/clients/tiki-open-api-brand.client';
import { parseBrandCliOptions } from './brands/cli/brand-cli-options.parser';
import { FileBrandCheckpointStore } from './brands/checkpoints/file-brand-checkpoint.store';
import { writeBrandCrawlOutput } from './brands/exporters/brand-catalog.exporter';
import { BrandCatalogMapper } from './brands/mappers/brand-catalog.mapper';
import { ProductServiceBrandRepository } from './brands/repositories/product-service-brand.repository';
import { BrandCrawlerService } from './brands/services/brand-crawler.service';
import { OfficialBrandCrawlerService } from './brands/services/official-brand-crawler.service';
import type { BrandCrawlCatalog } from './brands/types/brand-catalog.type';
import type { BrandCrawlOptions } from './brands/types/brand-crawl-options.type';
import type { BrandCrawlResult } from './brands/types/brand-crawl-result.type';
import { assertBrandCatalog } from './brands/validators/brand-catalog.validator';
import { PostgresClient } from './database/postgres-client';
import { ConsoleCrawlerLogger } from './loggers/crawler.logger';

// Nạp file .env của package khi chạy local; biến môi trường do CI hoặc runtime inject luôn được ưu tiên.
function loadLocalEnvironment(): void {
    const candidates = [
        resolve(__dirname, '../.env'),
        resolve(process.cwd(), '.env'),
    ];

    for (const file of new Set(candidates)) {
        if (!existsSync(file)) continue;
        loadEnvFile(file);
        return;
    }
}

// Đọc catalog JSON đã crawl để có thể import lại mà không gửi request tới Tiki lần nữa.
async function readCatalog(inputFile: string): Promise<BrandCrawlCatalog> {
    const content = await readFile(inputFile, 'utf8');
    const parsed: unknown = JSON.parse(content);
    assertBrandCatalog(parsed);
    return parsed;
}

// Chọn adapter theo CLI; official dùng Open API, storefront chỉ giữ cho pilot thu bằng chứng từ sản phẩm public.
async function crawlCatalog(
    options: BrandCrawlOptions,
    checkpoint: FileBrandCheckpointStore,
    logger: ConsoleCrawlerLogger,
): Promise<BrandCrawlResult> {
    const mapper = new BrandCatalogMapper();
    if (options.source === 'official') {
        const token = process.env['TIKI_API_TOKEN']?.trim() ?? '';
        const crawler = new OfficialBrandCrawlerService({
            client: new TikiOpenApiBrandClient(token),
            mapper,
            logger,
        });
        return crawler.crawl(options);
    }

    const crawler = new BrandCrawlerService({
        client: new TikiBrandClient(),
        checkpoint,
        mapper,
        logger,
    });
    return crawler.crawl(options);
}

// Upsert catalog vào database của Product Service và đóng connection kể cả khi import lỗi.
async function importCatalog(
    catalog: BrandCrawlCatalog,
    logger: ConsoleCrawlerLogger,
): Promise<void> {
    const databaseUrl =
        process.env['PRODUCT_DATABASE_URL'] ??
        'postgres://bin_ecommerce:changeme_postgres@localhost:5432/bin_ecommerce_product';
    const database = new PostgresClient(databaseUrl);
    await database.connect();

    try {
        const repository = new ProductServiceBrandRepository(database);
        const result = await repository.upsertCatalog(catalog);
        logger.info('brand catalog imported', { ...result });
        if (result.failures.length > 0) {
            logger.warn('brand import contains failures', {
                failures: result.failures.slice(0, 20),
            });
        }
    } finally {
        await database.close();
    }
}

// Điều phối chế độ crawl hoặc đọc file, xuất report và chỉ import catalog hoàn chỉnh theo mặc định.
async function main(): Promise<void> {
    loadLocalEnvironment();
    const options = parseBrandCliOptions(process.argv.slice(2));
    const logger = new ConsoleCrawlerLogger();
    let catalog: BrandCrawlCatalog;

    if (options.inputFile) {
        catalog = await readCatalog(options.inputFile);
        logger.info('brand catalog loaded from file', {
            inputFile: options.inputFile,
            brands: catalog.brands.length,
        });
    } else {
        const checkpoint = new FileBrandCheckpointStore(options.checkpointFile);
        await checkpoint.acquireLock();
        try {
            const result = await crawlCatalog(options, checkpoint, logger);
            catalog = result.catalog;
            const paths = await writeBrandCrawlOutput(
                result.catalog,
                result.report,
                options.outputFile,
                options.reportFile,
            );
            logger.info('brand crawl output saved', {
                ...paths,
                source: options.source,
                completed: result.catalog.completed,
                ...result.catalog.summary,
            });
        } finally {
            await checkpoint.releaseLock();
        }
    }

    if (!options.importToDatabase) return;

    // Catalog pilot hoặc bị gián đoạn không được xem là bộ brand đầy đủ nếu operator chưa chủ động cho phép.
    if (!catalog.completed && !options.allowPartialImport) {
        throw new Error(
            'Catalog thương hiệu chưa hoàn tất. Hãy chạy lại không giới hạn hoặc chỉ dùng --allow-partial cho pilot có chủ đích.',
        );
    }
    await importCatalog(catalog, logger);
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});

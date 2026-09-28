// CLI chạy batch crawl theo shop và ghi staging JSONL, không import database trực tiếp.
// Operator dùng output/manifest để kiểm tra quota, coverage và lỗi trước khi gọi importer.

import { TikiSourceAdapter } from './adapters/tiki-source.adapter';
import { ConsoleCrawlerLogger } from './loggers/crawler.logger';
import { ShopProductBatchCrawlerService } from './services/shop-product-batch-crawler.service';
import type { ShopProductBatchOptions } from './types/shop-product-batch.type';

// Đọc flag CLI dạng --key value hoặc --flag để batch có thể chạy không cần thêm thư viện.
function parseArgs(argv: string[]): ShopProductBatchOptions {
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

    const outputDir = getString(args, 'output-dir') ?? 'data/tiki-batch/latest';
    return {
        targetListings: getNumber(args, 'target') ?? 10_000,
        minProductsPerShop: getNumber(args, 'min-products-per-shop') ?? 20,
        maxProductsPerShop: getNumber(args, 'max-products-per-shop') ?? 30,
        minShopsPerGroup: getNumber(args, 'min-shops-per-group') ?? 5,
        maxShopsPerGroup: getNumber(args, 'max-shops-per-group') ?? 10,
        uniqueCatalogProducts: args.get('unique-catalog-products') === true,
        categoryIds: getCsv(args, 'category-ids'),
        keywords: getCsv(args, 'keywords'),
        discoveryPages: getNumber(args, 'discovery-pages') ?? 5,
        discoveryLimit: getNumber(args, 'discovery-limit') ?? 100,
        maxDiscoveryShops: getNumber(args, 'max-shops'),
        delayMs: getNumber(args, 'delay') ?? 2_000,
        delayJitterMs: getNumber(args, 'delay-jitter') ?? 1_000,
        outputDir,
        checkpointFile:
            getString(args, 'checkpoint') ?? `${outputDir}/checkpoint.json`,
        resume: args.get('resume') === true,
        includeReviews: args.get('reviews') === true,
        reviewLimit: getNumber(args, 'review-limit') ?? 5,
    };
}

// Đọc string flag có nội dung; flag boolean hoặc chuỗi rỗng bị coi là không truyền.
function getString(
    args: Map<string, string | boolean>,
    key: string,
): string | undefined {
    const value = args.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Đọc danh sách CSV cho category/keyword và bỏ phần tử rỗng để request không bị lặp vô nghĩa.
function getCsv(
    args: Map<string, string | boolean>,
    key: string,
): string[] | undefined {
    const value = getString(args, key);
    if (!value) return undefined;
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

// Đọc số dương từ CLI; giá trị sai sẽ rơi về default ở caller thay vì tạo batch lỗi nửa chừng.
function getNumber(
    args: Map<string, string | boolean>,
    key: string,
): number | undefined {
    const value = args.get(key);
    if (typeof value !== 'string') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

// Khởi chạy discovery/planning/detail crawl và trả exit code lỗi để CI/operator nhận biết batch thất bại.
async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const crawler = new ShopProductBatchCrawlerService({
        source: new TikiSourceAdapter(),
        logger: new ConsoleCrawlerLogger(),
    });
    await crawler.crawl(options);
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});

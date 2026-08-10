import type {
    BrandCrawlOptions,
    BrandCrawlSource,
} from '../types/brand-crawl-options.type';

const DEFAULT_OUTPUT_FILE = 'data/tiki-brands.json';
const DEFAULT_REPORT_FILE = 'data/tiki-brands.report.json';
const DEFAULT_CHECKPOINT_FILE = 'data/tiki-brands.checkpoint.json';

// Parse cặp --key value và flag --name thành Map để CLI không phụ thuộc thêm thư viện ngoài.
export function parseBrandCliOptions(argv: string[]): BrandCrawlOptions {
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

    // --delay vẫn được giữ để các lệnh cũ chạy được; hai flag chuyên biệt có độ ưu tiên cao hơn.
    const sharedDelayMs = getNonNegativeNumber(args, 'delay');

    return {
        source: getSource(args),
        categoryIds: getNumberList(args, 'category-ids'),
        maxCategories: getPositiveNumber(args, 'max-categories'),
        maxBrands: getPositiveNumber(args, 'max-brands'),
        sampleProductsPerBrand: getNonNegativeNumber(args, 'sample-products') ?? 1,
        includeCountryEvidence: args.get('skip-country') !== true,
        discoveryDelayMs:
            getNonNegativeNumber(args, 'discovery-delay') ?? sharedDelayMs ?? 350,
        enrichmentDelayMs:
            getNonNegativeNumber(args, 'enrichment-delay') ?? sharedDelayMs ?? 1_500,
        outputFile: getString(args, 'output') ?? DEFAULT_OUTPUT_FILE,
        reportFile: getString(args, 'report') ?? DEFAULT_REPORT_FILE,
        checkpointFile:
            getString(args, 'checkpoint') ?? DEFAULT_CHECKPOINT_FILE,
        resume: args.get('resume') === true,
        importToDatabase: args.get('import') === true,
        allowPartialImport: args.get('allow-partial') === true,
        inputFile: getString(args, 'input'),
    };
}

// Chọn adapter nguồn; official là mặc định vì đây là API được Tiki công bố và có contract ổn định hơn storefront.
function getSource(args: Map<string, string | boolean>): BrandCrawlSource {
    const value = getString(args, 'source') ?? 'official';
    if (value !== 'official' && value !== 'storefront') {
        throw new Error('--source chỉ nhận official hoặc storefront.');
    }
    return value;
}

// Đọc string đã trim và bỏ qua boolean flag.
function getString(
    args: Map<string, string | boolean>,
    key: string,
): string | undefined {
    const value = args.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Đọc số không âm cho delay/sample; giá trị âm hoặc không phải số được xem là CLI không hợp lệ.
function getNonNegativeNumber(
    args: Map<string, string | boolean>,
    key: string,
): number | undefined {
    const value = getString(args, key);
    if (value === undefined) return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--${key} phải là số không âm.`);
    }
    return parsed;
}

// Đọc số nguyên dương cho giới hạn category/brand để tránh vòng lặp chạy với ngưỡng vô nghĩa.
function getPositiveNumber(
    args: Map<string, string | boolean>,
    key: string,
): number | undefined {
    const parsed = getNonNegativeNumber(args, key);
    if (parsed === undefined) return undefined;
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${key} phải là số nguyên dương.`);
    }
    return parsed;
}

// Chuyển CSV category ID thành danh sách số nguyên dương và loại trùng trước khi gửi request.
function getNumberList(
    args: Map<string, string | boolean>,
    key: string,
): number[] | undefined {
    const value = getString(args, key);
    if (!value) return undefined;

    const ids = value.split(',').map((item) => Number(item.trim()));
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        throw new Error(`--${key} chỉ nhận danh sách ID nguyên dương phân cách bằng dấu phẩy.`);
    }
    return [...new Set(ids)];
}

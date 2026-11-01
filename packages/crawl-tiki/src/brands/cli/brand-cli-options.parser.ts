import type { BrandCrawlOptions } from '../types/brand-crawl-options.type';

const DEFAULT_OUTPUT_FILE = 'data/tiki-brands.json';
const DEFAULT_REPORT_FILE = 'data/tiki-brands.report.json';

// Parse cặp --key value và flag --name để CLI import thương hiệu không cần thư viện ngoài.
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

    return {
        maxBrands: getPositiveNumber(args, 'max-brands'),
        outputFile: getString(args, 'output') ?? DEFAULT_OUTPUT_FILE,
        reportFile: getString(args, 'report') ?? DEFAULT_REPORT_FILE,
        importToDatabase: args.get('import') === true,
        allowPartialImport: args.get('allow-partial') === true,
        inputFile: getString(args, 'input'),
    };
}

// Đọc chuỗi không rỗng sau khi trim và bỏ qua các flag boolean.
function getString(
    args: Map<string, string | boolean>,
    key: string,
): string | undefined {
    const value = args.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Giới hạn pilot phải là số nguyên dương để tránh vô tình xuất catalog rỗng.
function getPositiveNumber(
    args: Map<string, string | boolean>,
    key: string,
): number | undefined {
    const value = getString(args, key);
    if (value === undefined) return undefined;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${key} phải là số nguyên dương.`);
    }
    return parsed;
}

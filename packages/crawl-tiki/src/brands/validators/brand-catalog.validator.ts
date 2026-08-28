import type {
    BrandCrawlCatalog,
    CrawledBrand,
} from '../types/brand-catalog.type';

// Kiểm tra contract cấp catalog trước khi import để file JSON sai schema không ghi dữ liệu dở dang vào database.
export function assertBrandCatalog(value: unknown): asserts value is BrandCrawlCatalog {
    if (!isRecord(value)) {
        throw new Error('Brand catalog phải là một JSON object.');
    }
    if (value['schemaVersion'] !== 1 || value['sourcePlatform'] !== 'tiki') {
        throw new Error('Brand catalog không đúng schemaVersion hoặc sourcePlatform.');
    }
    if (!Array.isArray(value['brands'])) {
        throw new Error('Brand catalog thiếu mảng brands.');
    }

    for (const brand of value['brands']) {
        assertBrand(brand);
    }
}

// Kiểm tra các khóa idempotency và field hiển thị bắt buộc của từng brand.
function assertBrand(value: unknown): asserts value is CrawledBrand {
    if (!isRecord(value)) {
        throw new Error('Mỗi brand phải là một JSON object.');
    }

    const requiredFields = ['externalBrandId', 'name', 'normalizedName', 'slug'];
    for (const field of requiredFields) {
        if (typeof value[field] !== 'string' || !value[field].trim()) {
            throw new Error(`Brand thiếu field bắt buộc: ${field}.`);
        }
    }

    if (!Array.isArray(value['aliases']) || !Array.isArray(value['categories'])) {
        throw new Error(`Brand ${value['externalBrandId']} có aliases/categories không hợp lệ.`);
    }
    if (!isRecord(value['country'])) {
        throw new Error(`Brand ${value['externalBrandId']} thiếu dữ liệu country.`);
    }
}

// Thu hẹp unknown thành object indexable mà không dùng ép kiểu any trong validator runtime.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

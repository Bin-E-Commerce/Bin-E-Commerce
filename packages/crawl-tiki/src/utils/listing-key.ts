// Chuẩn hóa định danh listing Tiki và khóa nhóm mặt hàng cho batch crawl.
// File này chỉ chứa pure helper, không gọi HTTP hoặc ghi database; các lớp crawl
// dùng cùng một contract để tránh trùng hoặc ghi đè listing giữa nhiều shop.

import type { SourceProductListItem } from '../types/source-product.type';

// Tạo khóa ổn định cho một listing theo product Tiki và seller, giữ mỗi shop là một product riêng.
export function buildTikiListingKey(
    catalogExternalId: string,
    sellerExternalId?: string,
    sellerProductExternalId?: string,
): string {
    const sellerKey = sellerExternalId ?? sellerProductExternalId ?? 'unknown';
    return `tiki:${catalogExternalId}:seller:${sellerKey}`;
}

// Chuẩn hóa text để nhóm những listing có cùng tên/brand/category mà không dùng fuzzy merge nguy hiểm.
export function normalizeGroupText(value: string | undefined): string {
    return (value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

// Tạo khóa nhóm ưu tiên product ID, sau đó mới dùng brand + tên + category làm fallback.
export function buildCanonicalGroupKey(
    listing: Pick<
        SourceProductListItem,
        'catalogExternalId' | 'brandName' | 'name' | 'categoryName'
    >,
): string {
    if (listing.catalogExternalId) {
        return `tiki-product:${listing.catalogExternalId}`;
    }

    return [
        normalizeGroupText(listing.brandName) || 'unknown-brand',
        normalizeGroupText(listing.name) || 'unknown-product',
        normalizeGroupText(listing.categoryName) || 'unknown-category',
    ].join('|');
}

// Trả về listing key ổn định cho cả dữ liệu cũ chưa có seller context.
export function getListingKey(listing: SourceProductListItem): string {
    return (
        listing.listingKey ??
        buildTikiListingKey(
            listing.catalogExternalId ?? listing.externalId,
            listing.sellerExternalId,
            listing.sellerProductExternalId,
        )
    );
}

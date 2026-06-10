// Tạo slug ổn định từ tên để chống trùng brand/category/shop/product khi nguồn không có slug.
export function slugify(value: string): string {
    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || 'unknown';
}

// Gắn external id vào slug để product từ nguồn crawl ít va chạm với product local.
export function sourceSlug(name: string, externalId?: string | null): string {
    const base = slugify(name);
    return externalId ? `${base}-${externalId}` : base;
}

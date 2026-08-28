export type SourcePlatform = 'tiki' | 'shopee' | 'lazada' | 'sendo';

export interface SourceCategory {
    externalId: string;
    name: string;
    slug?: string;
    parentExternalId?: string | null;
    level: number;
    sortOrder: number;
    sourceUrl?: string | null;
}

export interface SourceProductListItem {
    externalId: string;
    name: string;
    sourceUrl: string;
}

export interface SourceProductImage {
    url: string;
    altText?: string | null;
}

export interface SourceProductOption {
    name: string;
    values: string[];
}

export interface SourceProductVariant {
    externalId?: string | null;
    sku?: string | null;
    name?: string | null;
    price: number;
    originalPrice?: number | null;
    stockQuantity?: number | null;
    weight?: number | null;
    imageUrl?: string | null;
    optionValues: Record<string, string>;
}

export interface SourceProductAttribute {
    name: string;
    value: string;
    unit?: string | null;
    dataType?: 'text' | 'number' | 'boolean';
    isFilterable?: boolean;
}

export interface SourceProductReview {
    externalId: string;
    rating: number;
    content: string | null;
    images: string[];
    createdAt: string;
}

export interface SourceProductDetail {
    platform: SourcePlatform;
    externalId: string;
    sku?: string | null;
    name: string;
    slug?: string;
    sourceUrl: string;
    description?: string | null;
    shortDescription?: string | null;
    totalSold?: number | null;
    ratingAverage?: number | null;
    reviewCount?: number | null;
    viewCount?: number | null;
    brand?: {
        externalId?: string | null;
        name: string;
        slug?: string;
        logoUrl?: string | null;
        description?: string | null;
    } | null;
    shop?: {
        externalId?: string | null;
        name: string;
        slug?: string;
        avatarUrl?: string | null;
        description?: string | null;
    } | null;
    categories: SourceCategory[];
    images: SourceProductImage[];
    options: SourceProductOption[];
    variants: SourceProductVariant[];
    attributes: SourceProductAttribute[];
    reviews: SourceProductReview[];
}

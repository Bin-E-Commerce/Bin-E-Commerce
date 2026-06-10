import type { SourcePlatform } from './source-product.type';

export interface ImportCategory {
    externalId: string;
    sourcePlatform: SourcePlatform;
    sourceUrl: string | null;
    parentExternalId: string | null;
    name: string;
    slug: string;
    level: number;
    sortOrder: number;
    isActive: boolean;
}

export interface ImportBrand {
    externalId: string | null;
    sourcePlatform: SourcePlatform;
    name: string;
    slug: string;
    logoUrl: string | null;
    description: string | null;
    isActive: boolean;
}

export interface ImportShop {
    externalId: string | null;
    sourcePlatform: SourcePlatform;
    name: string;
    slug: string;
    avatarUrl: string | null;
    description: string | null;
    status: 'active' | 'inactive';
}

export interface ImportProduct {
    externalId: string;
    sourcePlatform: SourcePlatform;
    sourceUrl: string;
    name: string;
    slug: string;
    description: string | null;
    shortDescription: string | null;
    status: 'active' | 'draft' | 'inactive';
    totalSold: number;
    ratingAverage: number | null;
    reviewCount: number;
    viewCount: number;
}

export interface ImportProductImage {
    externalId: string | null;
    imageUrl: string;
    altText: string | null;
    sortOrder: number;
    isThumbnail: boolean;
    variantExternalId: string | null;
}

export interface ImportProductOption {
    name: string;
    position: number;
    values: Array<{
        value: string;
        position: number;
    }>;
}

export interface ImportProductVariant {
    externalId: string | null;
    sku: string;
    name: string;
    price: number;
    originalPrice: number | null;
    stockQuantity: number;
    weight: number | null;
    status: 'active' | 'inactive';
    imageUrl: string | null;
    optionValues: Record<string, string>;
}

export interface ImportInventory {
    variantSku: string;
    quantityAvailable: number;
    quantityReserved: number;
    quantitySold: number;
    lowStockThreshold: number;
}

export interface ImportAttribute {
    externalId: string | null;
    name: string;
    slug: string;
    dataType: 'text' | 'number' | 'boolean';
    unit: string | null;
    isFilterable: boolean;
    isRequired: boolean;
    valueText: string | null;
    valueNumber: number | null;
    valueBoolean: boolean | null;
}

export interface ImportReview {
    externalId: string;
    rating: number;
    content: string | null;
    images: string[];
    status: 'approved' | 'pending' | 'hidden';
    createdAt: string;
    variantExternalId: string | null;
}

export interface ImportProductGraph {
    categoryChain: ImportCategory[];
    brand: ImportBrand | null;
    shop: ImportShop | null;
    product: ImportProduct;
    images: ImportProductImage[];
    options: ImportProductOption[];
    variants: ImportProductVariant[];
    inventories: ImportInventory[];
    attributes: ImportAttribute[];
    reviews: ImportReview[];
}

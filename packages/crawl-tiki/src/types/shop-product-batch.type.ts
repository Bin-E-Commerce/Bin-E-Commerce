// Contract của batch crawl theo shop, tách discovery/planning khỏi crawler sản phẩm đơn lẻ.
// Các type này chỉ mô tả dữ liệu staging và quota; việc gọi Tiki nằm ở batch service.

import type { ImportProductGraph } from './import-product.type';
import type { SourceProductListItem } from './source-product.type';

export interface ShopListingCandidate {
    listingKey: string;
    catalogExternalId: string;
    sellerExternalId: string;
    sellerProductExternalId?: string;
    sellerName?: string;
    productName: string;
    brandName?: string;
    categoryName?: string;
    canonicalGroupKey: string;
    sourceUrl: string;
    sourceItem: SourceProductListItem;
}

export interface ShopCandidate {
    sellerExternalId: string;
    sellerName: string;
    sourceUrl: string | null;
    listings: ShopListingCandidate[];
}

export interface ShopProductBatchOptions {
    targetListings: number;
    minProductsPerShop: number;
    maxProductsPerShop: number;
    minShopsPerGroup: number;
    maxShopsPerGroup: number;
    uniqueCatalogProducts?: boolean;
    categoryIds?: string[];
    keywords?: string[];
    discoveryPages: number;
    discoveryLimit: number;
    maxDiscoveryShops?: number;
    delayMs: number;
    delayJitterMs: number;
    outputDir: string;
    checkpointFile: string;
    resume: boolean;
    includeReviews: boolean;
    reviewLimit: number;
}

export interface ShopProductBatchPlan {
    selectedListings: ShopListingCandidate[];
    selectedShops: ShopCandidate[];
    eligibleGroups: number;
    groupCoverage: Record<string, number>;
    productsPerShop: Record<string, number>;
    shortfall: number;
}

export interface BatchCheckpointEntry {
    listingKey: string;
    shopId: string;
    status: 'pending' | 'crawling' | 'succeeded' | 'skipped' | 'failed';
    updatedAt: string;
    error?: string;
}

export interface ShopProductBatchCheckpoint {
    crawlRunId: string;
    stage: 'discovery' | 'planning' | 'details' | 'completed';
    entries: Record<string, BatchCheckpointEntry>;
    discoveryStage?: 'categories' | 'shops' | 'completed';
    discoveryScopes?: Array<{
        categoryExternalId?: string;
        keyword?: string;
    }>;
    discoveryCandidates?: ShopListingCandidate[];
    discoveryProcessedScopes?: string[];
    discoveryProcessedShops?: string[];
    updatedAt: string;
}

export interface ShopProductBatchManifest {
    crawlRunId: string;
    targetListings: number;
    discoveredShops: number;
    selectedShops: number;
    discoveredListings: number;
    selectedListings: number;
    crawledListings: number;
    validListings: number;
    failedListings: number;
    skippedListings: number;
    eligibleGroups: number;
    groupCoverage: Record<string, number>;
    productsPerShop: Record<string, number>;
    categoryDistribution: Record<string, number>;
    shortfall: number;
    completedAt?: string;
}

export interface BatchProductResult {
    listing: ShopListingCandidate;
    graph: ImportProductGraph;
}

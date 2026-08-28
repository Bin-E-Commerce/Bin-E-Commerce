export type BrandCountryResolutionStatus =
    | 'resolved'
    | 'conflict'
    | 'unknown_alias'
    | 'missing';

export interface BrandCategoryObservation {
    externalCategoryId: string;
    categoryName: string;
    productCount: number;
}

export interface BrandCountryEvidence {
    externalProductId: string;
    productName: string;
    sourceUrl: string;
    brandCountryRaw: string | null;
    productOriginRaw: string | null;
}

export interface CrawledBrandCountry {
    code: string | null;
    name: string | null;
    status: BrandCountryResolutionStatus;
    confidence: number;
    rawValues: string[];
}

export interface CrawledBrand {
    sourcePlatform: 'tiki';
    externalBrandId: string;
    name: string;
    normalizedName: string;
    slug: string;
    aliases: string[];
    logoUrl: string | null;
    sourceUrl: string | null;
    country: CrawledBrandCountry;
    categories: BrandCategoryObservation[];
    countryEvidence: BrandCountryEvidence[];
    observedProductCount: number;
    firstObservedAt: string;
    lastObservedAt: string;
}

export interface BrandCrawlSummary {
    rootCategoryCount: number;
    discoveredCategoryCount: number;
    processedCategoryCount: number;
    discoveredBrandCount: number;
    enrichedBrandCount: number;
    resolvedCountryCount: number;
    conflictCountryCount: number;
    unknownCountryAliasCount: number;
    missingCountryCount: number;
    failedRequestCount: number;
}

export interface BrandCrawlCatalog {
    schemaVersion: 1;
    sourcePlatform: 'tiki';
    sourceMode: 'official-open-api' | 'public-taxonomy';
    generatedAt: string;
    completed: boolean;
    summary: BrandCrawlSummary;
    brands: CrawledBrand[];
}

export interface BrandCrawlQualityIssue {
    type:
        | 'country_conflict'
        | 'country_alias_unknown'
        | 'country_missing'
        | 'request_failed';
    externalBrandId?: string;
    brandName?: string;
    categoryId?: string;
    details: string;
}

export interface BrandCrawlQualityReport {
    generatedAt: string;
    summary: BrandCrawlSummary;
    issues: BrandCrawlQualityIssue[];
}

export interface MutableBrandRecord {
    externalBrandId: string;
    names: string[];
    sourceUrls: string[];
    logoUrls: string[];
    categories: BrandCategoryObservation[];
    countryEvidence: BrandCountryEvidence[];
    firstObservedAt: string;
    lastObservedAt: string;
}

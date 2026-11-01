export interface CrawledBrand {
    sourcePlatform: 'tiki';
    externalBrandId: string;
    name: string;
    normalizedName: string;
    slug: string;
    aliases: string[];
    logoUrl: string | null;
    sourceUrl: string | null;
    firstObservedAt: string;
    lastObservedAt: string;
}

export interface BrandCrawlSummary {
    discoveredBrandCount: number;
    failedRequestCount: number;
}

export interface BrandCrawlCatalog {
    schemaVersion: 1;
    sourcePlatform: 'tiki';
    sourceMode: 'official-open-api';
    generatedAt: string;
    completed: boolean;
    summary: BrandCrawlSummary;
    brands: CrawledBrand[];
}

export interface BrandCrawlQualityIssue {
    type: 'request_failed';
    externalBrandId?: string;
    brandName?: string;
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
    firstObservedAt: string;
    lastObservedAt: string;
}

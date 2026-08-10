export type BrandCrawlSource = 'official' | 'storefront';

export interface BrandCrawlOptions {
    source: BrandCrawlSource;
    categoryIds?: number[];
    maxCategories?: number;
    maxBrands?: number;
    sampleProductsPerBrand: number;
    includeCountryEvidence: boolean;
    discoveryDelayMs: number;
    enrichmentDelayMs: number;
    outputFile: string;
    reportFile: string;
    checkpointFile: string;
    resume: boolean;
    importToDatabase: boolean;
    allowPartialImport: boolean;
    inputFile?: string;
}

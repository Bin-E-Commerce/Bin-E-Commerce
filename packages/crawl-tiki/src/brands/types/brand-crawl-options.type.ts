export interface BrandCrawlOptions {
    maxBrands?: number;
    outputFile: string;
    reportFile: string;
    importToDatabase: boolean;
    allowPartialImport: boolean;
    inputFile?: string;
}

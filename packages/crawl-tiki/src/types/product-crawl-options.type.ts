export interface ProductCrawlOptions {
    keyword?: string;
    categoryId?: number;
    categoryIds?: string[];
    pages: number;
    limit: number;
    maxProducts?: number;
    includeDetails: boolean;
    includeReviews: boolean;
    reviewLimit: number;
    delayMs: number;
    outputFile: string;
    checkpointFile: string;
    importToDatabase: boolean;
    resume: boolean;
}

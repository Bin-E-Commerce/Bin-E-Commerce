export interface ProductCrawlOptions {
    keyword?: string;
    categoryId?: number;
    categoryIds?: string[];
    sellerId?: string;
    sellerName?: string;
    sellerSlug?: string;
    pages: number;
    limit: number;
    maxProducts?: number;
    includeDetails: boolean;
    includeReviews: boolean;
    requireReviews: boolean;
    reviewLimit: number;
    delayMs: number;
    outputFile: string;
    checkpointFile: string;
    importToDatabase: boolean;
    resume: boolean;
}

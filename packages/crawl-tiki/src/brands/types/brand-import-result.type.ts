export interface BrandImportFailure {
    externalBrandId: string;
    brandName: string;
    reason: string;
}

export interface BrandImportResult {
    total: number;
    inserted: number;
    updated: number;
    skipped: number;
    failed: number;
    failures: BrandImportFailure[];
}

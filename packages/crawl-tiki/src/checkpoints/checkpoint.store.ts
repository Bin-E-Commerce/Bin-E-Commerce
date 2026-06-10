export interface CrawlCheckpoint {
    sourcePlatform: string;
    categoryExternalId: string | null;
    keyword: string | null;
    page: number;
    productExternalId: string | null;
    updatedAt: string;
}

export interface CheckpointStore {
    load(): Promise<CrawlCheckpoint | null>;
    save(checkpoint: CrawlCheckpoint): Promise<void>;
    clear(): Promise<void>;
}

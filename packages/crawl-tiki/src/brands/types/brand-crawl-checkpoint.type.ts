import type {
    BrandCrawlQualityIssue,
    MutableBrandRecord,
} from './brand-catalog.type';
import type { TikiMenuCategory } from './tiki-brand-source.type';

export interface BrandCrawlCheckpoint {
    schemaVersion: 1;
    startedAt: string;
    rootCategoryCount: number;
    pendingCategories: TikiMenuCategory[];
    processedCategoryIds: number[];
    brands: MutableBrandRecord[];
    enrichedBrandIds: string[];
    nextBrandIndex: number;
    issues: BrandCrawlQualityIssue[];
}

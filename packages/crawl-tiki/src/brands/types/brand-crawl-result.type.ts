import type {
    BrandCrawlCatalog,
    BrandCrawlQualityReport,
} from './brand-catalog.type';

export interface BrandCrawlResult {
    catalog: BrandCrawlCatalog;
    report: BrandCrawlQualityReport;
}

import type { CrawlerLogger } from '../../loggers/crawler.logger';
import { TikiOpenApiBrandClient } from '../clients/tiki-open-api-brand.client';
import { BrandCatalogMapper } from '../mappers/brand-catalog.mapper';
import type {
    BrandCrawlQualityIssue,
    BrandCrawlSummary,
    MutableBrandRecord,
} from '../types/brand-catalog.type';
import type { BrandCrawlOptions } from '../types/brand-crawl-options.type';
import type { BrandCrawlResult } from '../types/brand-crawl-result.type';

export interface OfficialBrandCrawlerDependencies {
    client: TikiOpenApiBrandClient;
    mapper: BrandCatalogMapper;
    logger: CrawlerLogger;
}

export class OfficialBrandCrawlerService {
    constructor(
        private readonly dependencies: OfficialBrandCrawlerDependencies,
    ) {}

    // Lấy toàn bộ trang catalog brand chính thức, chuẩn hóa và tạo quality report mà không đọc hoặc ghi category.
    async crawl(options: BrandCrawlOptions): Promise<BrandCrawlResult> {
        const sourceBrands = await this.dependencies.client.fetchAllBrands();
        const selectedBrands =
            options.maxBrands === undefined
                ? sourceBrands
                : sourceBrands.slice(0, options.maxBrands);
        const generatedAt = new Date().toISOString();
        const records = new Map<string, MutableBrandRecord>();

        for (const source of selectedBrands) {
            const merged = this.dependencies.mapper.mergeOfficialBrand(
                records.get(source.externalBrandId),
                source,
                generatedAt,
            );
            records.set(source.externalBrandId, merged);
        }

        const finalized = [...records.values()]
            .map((record) => this.dependencies.mapper.finalize(record))
            .sort((left, right) =>
                left.brand.name.localeCompare(right.brand.name, 'vi'),
            );
        const issues = finalized
            .map((item) => item.issue)
            .filter((issue): issue is BrandCrawlQualityIssue => issue !== null);
        const completed = selectedBrands.length === sourceBrands.length;
        const summary = this.buildSummary(finalized, issues);

        this.dependencies.logger.info('official Tiki brand catalog fetched', {
            sourceBrands: sourceBrands.length,
            selectedBrands: selectedBrands.length,
            completed,
        });
        return {
            catalog: {
                schemaVersion: 1,
                sourcePlatform: 'tiki',
                sourceMode: 'official-open-api',
                generatedAt,
                completed,
                summary,
                brands: finalized.map((item) => item.brand),
            },
            report: {
                generatedAt,
                summary,
                issues,
            },
        };
    }

    // Tính số liệu từ catalog đã chuẩn hóa; giới hạn pilot chỉ làm catalog chưa hoàn tất.
    private buildSummary(
        finalized: Array<ReturnType<BrandCatalogMapper['finalize']>>,
        issues: BrandCrawlQualityIssue[],
    ): BrandCrawlSummary {
        return {
            discoveredBrandCount: finalized.length,
            failedRequestCount: issues.filter(
                (issue) => issue.type === 'request_failed',
            ).length,
        };
    }
}

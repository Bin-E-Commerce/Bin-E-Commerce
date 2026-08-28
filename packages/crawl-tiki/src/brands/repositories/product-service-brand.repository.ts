import type { DatabaseExecutor } from '../../repositories/postgres-product-import.repository';
import type { BrandCrawlCatalog, CrawledBrand } from '../types/brand-catalog.type';
import type { BrandImportResult } from '../types/brand-import-result.type';

interface ExistingBrandRow {
    id: string;
}

const REQUIRED_COLUMNS = [
    'normalized_name',
    'country_code',
    'country_name',
    'aliases',
    'source_metadata',
    'last_crawled_at',
] as const;

export class ProductServiceBrandRepository {
    constructor(private readonly database: DatabaseExecutor) {}

    // Import toàn bộ catalog trong một transaction nhưng cô lập từng brand bằng savepoint để record lỗi không chặn phần còn lại.
    async upsertCatalog(catalog: BrandCrawlCatalog): Promise<BrandImportResult> {
        await this.assertSchemaReady();
        const result: BrandImportResult = {
            total: catalog.brands.length,
            inserted: 0,
            updated: 0,
            skipped: 0,
            failed: 0,
            failures: [],
        };

        await this.database.query('BEGIN');
        try {
            for (let index = 0; index < catalog.brands.length; index += 1) {
                const brand = catalog.brands[index];
                if (!brand) {
                    result.skipped += 1;
                    continue;
                }

                const savepoint = `brand_${index}`;
                await this.database.query(`SAVEPOINT ${savepoint}`);
                try {
                    const existed = await this.upsertBrand(brand);
                    result[existed ? 'updated' : 'inserted'] += 1;
                    await this.database.query(`RELEASE SAVEPOINT ${savepoint}`);
                } catch (error) {
                    await this.database.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                    result.failed += 1;
                    result.failures.push({
                        externalBrandId: brand.externalBrandId,
                        brandName: brand.name,
                        reason: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            await this.database.query('COMMIT');
            return result;
        } catch (error) {
            await this.database.query('ROLLBACK');
            throw error;
        }
    }

    // Xác nhận migration đã chạy trước khi import để báo lỗi rõ ràng thay vì thất bại giữa batch.
    private async assertSchemaReady(): Promise<void> {
        const queryResult = await this.database.query<{ column_name: string }>(
            `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'brands'
            `,
        );
        const availableColumns = new Set(
            queryResult.rows.map((row) => row.column_name),
        );
        const missingColumns = REQUIRED_COLUMNS.filter(
            (column) => !availableColumns.has(column),
        );

        if (missingColumns.length > 0) {
            throw new Error(
                `Bảng brands chưa được migrate các cột: ${missingColumns.join(', ')}.`,
            );
        }
    }

    // Tìm theo external ID trước, fallback slug để hợp nhất brand đã được product crawler tạo từ trước.
    private async findExistingBrand(brand: CrawledBrand): Promise<string | null> {
        const queryResult = await this.database.query<ExistingBrandRow>(
            `
            SELECT id
            FROM brands
            WHERE (source_platform = $1 AND external_brand_id = $2)
               OR slug = $3
            ORDER BY
                CASE
                    WHEN source_platform = $1 AND external_brand_id = $2 THEN 0
                    ELSE 1
                END
            LIMIT 1
            `,
            [brand.sourcePlatform, brand.externalBrandId, brand.slug],
        );

        return queryResult.rows[0]?.id ?? null;
    }

    // Upsert một brand; chỉ ghi country khi đã resolve, đồng thời giữ logo/mô tả admin nếu crawler không có giá trị mới.
    private async upsertBrand(brand: CrawledBrand): Promise<boolean> {
        const existingId = await this.findExistingBrand(brand);
        const countryCode =
            brand.country.status === 'resolved' ? brand.country.code : null;
        const countryName =
            brand.country.status === 'resolved' ? brand.country.name : null;
        const sourceMetadata = JSON.stringify({
            tiki: {
                externalBrandId: brand.externalBrandId,
                sourceUrl: brand.sourceUrl,
                observedProductCount: brand.observedProductCount,
                categories: brand.categories,
                country: brand.country,
                countryEvidence: brand.countryEvidence,
                firstObservedAt: brand.firstObservedAt,
                lastObservedAt: brand.lastObservedAt,
            },
        });

        if (!existingId) {
            await this.database.query(
                `
                INSERT INTO brands (
                    source_platform, external_brand_id, name, normalized_name,
                    slug, country_code, country_name, aliases, logo_url,
                    description, source_metadata, last_crawled_at, is_active
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
                    NULL, $10::jsonb, $11, true
                )
                `,
                [
                    brand.sourcePlatform,
                    brand.externalBrandId,
                    brand.name,
                    brand.normalizedName,
                    brand.slug,
                    countryCode,
                    countryName,
                    JSON.stringify(brand.aliases),
                    brand.logoUrl,
                    sourceMetadata,
                    brand.lastObservedAt,
                ],
            );
            return false;
        }

        await this.database.query(
            `
            UPDATE brands
            SET
                source_platform = COALESCE(source_platform, $2),
                external_brand_id = COALESCE(external_brand_id, $3),
                name = CASE WHEN source_platform IS NULL THEN name ELSE $4 END,
                normalized_name = CASE
                    WHEN source_platform IS NULL THEN COALESCE(normalized_name, $5)
                    ELSE $5
                END,
                country_code = COALESCE($6, country_code),
                country_name = COALESCE($7, country_name),
                aliases = (
                    SELECT COALESCE(jsonb_agg(DISTINCT value), '[]'::jsonb)
                    FROM jsonb_array_elements_text(aliases || $8::jsonb)
                        AS source_alias(value)
                ),
                logo_url = COALESCE($9, logo_url),
                source_metadata = source_metadata || $10::jsonb,
                last_crawled_at = $11,
                updated_at = NOW()
            WHERE id = $1
            `,
            [
                existingId,
                brand.sourcePlatform,
                brand.externalBrandId,
                brand.name,
                brand.normalizedName,
                countryCode,
                countryName,
                JSON.stringify(brand.aliases),
                brand.logoUrl,
                sourceMetadata,
                brand.lastObservedAt,
            ],
        );
        return true;
    }
}

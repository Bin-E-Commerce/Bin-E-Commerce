import { slugify } from '../../utils/slug';
import { BrandCountryMapper } from './brand-country.mapper';
import type {
    BrandCategoryObservation,
    BrandCrawlQualityIssue,
    CrawledBrand,
    MutableBrandRecord,
} from '../types/brand-catalog.type';
import type {
    TikiBrandFilterValue,
    TikiBrandProductSample,
    TikiMenuCategory,
    TikiOpenApiBrandValue,
} from '../types/tiki-brand-source.type';

export class BrandCatalogMapper {
    constructor(private readonly countries = new BrandCountryMapper()) {}

    // Gộp một brand vừa quan sát vào record theo external ID để cùng brand xuất hiện ở nhiều category không bị nhân bản.
    mergeDiscovery(
        current: MutableBrandRecord | undefined,
        source: TikiBrandFilterValue,
        category: TikiMenuCategory,
        observedAt: string,
    ): MutableBrandRecord {
        const record = current ?? this.createRecord(source.externalBrandId, observedAt);
        record.names = this.unique([...record.names, source.name]);
        record.sourceUrls = this.unique([
            ...record.sourceUrls,
            ...(source.sourceUrl ? [source.sourceUrl] : []),
        ]);
        record.categories = this.mergeCategory(record.categories, {
            externalCategoryId: String(category.id),
            categoryName: category.name,
            productCount: source.productCount,
        });
        record.lastObservedAt = observedAt;
        return record;
    }

    // Gộp brand từ Tiki Open API theo external ID; endpoint chính thức không có category nên chỉ lưu dữ liệu nguồn thực sự trả về.
    mergeOfficialBrand(
        current: MutableBrandRecord | undefined,
        source: TikiOpenApiBrandValue,
        observedAt: string,
    ): MutableBrandRecord {
        const record =
            current ?? this.createRecord(source.externalBrandId, observedAt);
        record.names = this.unique([...record.names, source.name]);
        record.sourceUrls = this.unique([
            ...record.sourceUrls,
            ...(source.sourceUrl ? [source.sourceUrl] : []),
        ]);
        record.logoUrls = this.unique([
            ...record.logoUrls,
            ...(source.logoUrl ? [source.logoUrl] : []),
        ]);
        record.lastObservedAt = observedAt;
        return record;
    }

    // Bổ sung tên/logo/evidence từ product detail; evidence luôn giữ cả brand country và Made in để audit được nguồn.
    mergeSamples(
        record: MutableBrandRecord,
        samples: TikiBrandProductSample[],
        observedAt: string,
    ): MutableBrandRecord {
        for (const sample of samples) {
            const brand = sample.detail.brand ?? sample.listItem.brand;
            if (brand?.name) record.names = this.unique([...record.names, brand.name]);
            if (brand?.logo) {
                record.logoUrls = this.unique([...record.logoUrls, brand.logo]);
            }

            const evidence = this.countries.toEvidence(sample);
            const exists = record.countryEvidence.some(
                (item) => item.externalProductId === evidence.externalProductId,
            );
            if (!exists) record.countryEvidence.push(evidence);
        }

        record.lastObservedAt = observedAt;
        return record;
    }

    // Chuyển record mutable thành contract xuất/import ổn định và tạo issue để operator xử lý dữ liệu quốc gia chưa chắc chắn.
    finalize(record: MutableBrandRecord): {
        brand: CrawledBrand;
        issue: BrandCrawlQualityIssue | null;
    } {
        const name = this.chooseCanonicalName(
            record.names,
            record.externalBrandId,
        );
        const generatedSlug = slugify(name);
        const country = this.countries.resolve(record.countryEvidence);
        const brand: CrawledBrand = {
            sourcePlatform: 'tiki',
            externalBrandId: record.externalBrandId,
            name,
            normalizedName: this.normalizeName(name),
            slug: generatedSlug || `tiki-brand-${record.externalBrandId}`,
            aliases: record.names.filter((alias) => alias !== name).sort(),
            logoUrl: record.logoUrls[0] ?? null,
            sourceUrl: record.sourceUrls[0] ?? null,
            country,
            categories: [...record.categories].sort(
                (left, right) =>
                    right.productCount - left.productCount ||
                    left.categoryName.localeCompare(right.categoryName, 'vi'),
            ),
            countryEvidence: record.countryEvidence,
            observedProductCount: Math.max(
                0,
                ...record.categories.map((category) => category.productCount),
            ),
            firstObservedAt: record.firstObservedAt,
            lastObservedAt: record.lastObservedAt,
        };

        return { brand, issue: this.toQualityIssue(brand) };
    }

    // Tạo record trống duy nhất tại một chỗ để checkpoint luôn có shape nhất quán.
    private createRecord(
        externalBrandId: string,
        observedAt: string,
    ): MutableBrandRecord {
        return {
            externalBrandId,
            names: [],
            sourceUrls: [],
            logoUrls: [],
            categories: [],
            countryEvidence: [],
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
        };
    }

    // Với cùng brand/category chỉ giữ productCount lớn nhất vì aggregation ở các lần quét có thể thay đổi theo thời gian.
    private mergeCategory(
        categories: BrandCategoryObservation[],
        incoming: BrandCategoryObservation,
    ): BrandCategoryObservation[] {
        const existing = categories.find(
            (category) =>
                category.externalCategoryId === incoming.externalCategoryId,
        );
        if (!existing) return [...categories, incoming];

        existing.categoryName = incoming.categoryName;
        existing.productCount = Math.max(existing.productCount, incoming.productCount);
        return categories;
    }

    // Ưu tiên tên xuất hiện nhiều nhất; nếu hòa thì chọn tên ngắn hơn rồi sắp chữ để kết quả không phụ thuộc thứ tự request.
    private chooseCanonicalName(
        names: string[],
        externalBrandId: string,
    ): string {
        const counts = new Map<string, number>();
        for (const name of names.map((value) => value.trim()).filter(Boolean)) {
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }

        return (
            [...counts.entries()].sort(
                ([leftName, leftCount], [rightName, rightCount]) =>
                    rightCount - leftCount ||
                    leftName.length - rightName.length ||
                    leftName.localeCompare(rightName),
            )[0]?.[0] ?? `Tiki Brand ${externalBrandId}`
        );
    }

    // Chuẩn hóa tên không dấu nhưng không biến nó thành slug để phục vụ tìm kiếm và đối chiếu alias sau này.
    private normalizeName(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Chuyển trạng thái quốc gia thành issue máy đọc được mà không loại brand khỏi catalog.
    private toQualityIssue(brand: CrawledBrand): BrandCrawlQualityIssue | null {
        if (brand.country.status === 'resolved') return null;

        const typeByStatus = {
            conflict: 'country_conflict',
            unknown_alias: 'country_alias_unknown',
            missing: 'country_missing',
        } as const;

        return {
            type: typeByStatus[brand.country.status],
            externalBrandId: brand.externalBrandId,
            brandName: brand.name,
            details:
                brand.country.status === 'missing'
                    ? 'Không tìm thấy field xuất xứ thương hiệu trong các sản phẩm mẫu.'
                    : `Giá trị nguồn: ${brand.country.rawValues.join(', ')}`,
        };
    }

    // Loại trùng chuỗi sau khi trim nhưng vẫn giữ thứ tự quan sát đầu tiên.
    private unique(values: string[]): string[] {
        return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    }
}

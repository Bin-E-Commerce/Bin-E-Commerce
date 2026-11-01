import { slugify } from '../../utils/slug';
import type {
    BrandCrawlQualityIssue,
    CrawledBrand,
    MutableBrandRecord,
} from '../types/brand-catalog.type';
import type { TikiOpenApiBrandValue } from '../types/tiki-brand-source.type';

export class BrandCatalogMapper {
    // Chuẩn hóa dữ liệu thương hiệu do Tiki Open API cung cấp; mapper không đọc sản phẩm mẫu.
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

    // Tạo contract brand ổn định, chỉ chứa dữ liệu từ endpoint chính thức.
    finalize(record: MutableBrandRecord): {
        brand: CrawledBrand;
        issue: BrandCrawlQualityIssue | null;
    } {
        const name = this.chooseCanonicalName(
            record.names,
            record.externalBrandId,
        );
        const brand: CrawledBrand = {
            sourcePlatform: 'tiki',
            externalBrandId: record.externalBrandId,
            name,
            normalizedName: this.normalizeName(name),
            slug: slugify(name) || `tiki-brand-${record.externalBrandId}`,
            aliases: record.names.filter((alias) => alias !== name).sort(),
            logoUrl: record.logoUrls[0] ?? null,
            sourceUrl: record.sourceUrls[0] ?? null,
            firstObservedAt: record.firstObservedAt,
            lastObservedAt: record.lastObservedAt,
        };

        return { brand, issue: null };
    }

    // Khởi tạo record tại một chỗ để các lần gộp cùng một brand có shape nhất quán.
    private createRecord(
        externalBrandId: string,
        observedAt: string,
    ): MutableBrandRecord {
        return {
            externalBrandId,
            names: [],
            sourceUrls: [],
            logoUrls: [],
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
        };
    }

    // Ưu tiên tên phổ biến; khi hòa chọn tên ngắn hơn để kết quả không phụ thuộc thứ tự API.
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

    // Chuẩn hóa tên không dấu để database có khóa tìm kiếm nhất quán.
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

    // Loại chuỗi trùng sau khi trim nhưng giữ thứ tự xuất hiện đầu tiên.
    private unique(values: string[]): string[] {
        return [
            ...new Set(values.map((value) => value.trim()).filter(Boolean)),
        ];
    }
}

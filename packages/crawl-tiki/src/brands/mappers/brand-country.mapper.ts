import { COUNTRY_ALIASES } from '../constants/country-aliases.constant';
import type {
    BrandCountryEvidence,
    BrandCountryResolutionStatus,
    CrawledBrandCountry,
} from '../types/brand-catalog.type';
import type { TikiBrandProductSample } from '../types/tiki-brand-source.type';

interface CountryVote {
    code: string;
    name: string;
    count: number;
}

export class BrandCountryMapper {
    // Trích riêng xuất xứ thương hiệu và nơi sản xuất để không gán nhầm “Made in” thành quốc gia của brand.
    toEvidence(sample: TikiBrandProductSample): BrandCountryEvidence {
        const attributes = (sample.detail.specifications ?? []).flatMap(
            (group) => group.attributes ?? [],
        );
        const brandCountry = attributes.find((attribute) =>
            this.isBrandCountryField(attribute.name),
        );
        const productOrigin = attributes.find((attribute) =>
            this.isProductOriginField(attribute.name),
        );

        return {
            externalProductId: String(sample.detail.id),
            productName: sample.detail.name?.trim() || `Tiki #${sample.detail.id}`,
            sourceUrl: this.toProductUrl(
                sample.detail.url_path ?? sample.listItem.url_path,
                sample.detail.id,
            ),
            brandCountryRaw: brandCountry?.value?.trim() || null,
            productOriginRaw: productOrigin?.value?.trim() || null,
        };
    }

    // Tổng hợp nhiều bằng chứng; nếu các sản phẩm trả quốc gia khác nhau thì giữ trạng thái conflict để kiểm duyệt.
    resolve(evidence: BrandCountryEvidence[]): CrawledBrandCountry {
        const rawValues = this.unique(
            evidence
                .map((item) => item.brandCountryRaw?.trim())
                .filter((value): value is string => Boolean(value)),
        );
        const votes = new Map<string, CountryVote>();

        for (const rawValue of rawValues) {
            for (const country of this.findCountries(rawValue)) {
                const current = votes.get(country.code);
                votes.set(country.code, {
                    ...country,
                    count: (current?.count ?? 0) + 1,
                });
            }
        }

        if (votes.size === 0) {
            return this.emptyResolution(
                rawValues.length > 0 ? 'unknown_alias' : 'missing',
                rawValues,
            );
        }

        const ranked = [...votes.values()].sort(
            (left, right) => right.count - left.count || left.code.localeCompare(right.code),
        );
        const winner = ranked[0];
        const totalVotes = ranked.reduce((total, item) => total + item.count, 0);

        return {
            code: winner?.code ?? null,
            name: winner?.name ?? null,
            status: ranked.length > 1 ? 'conflict' : 'resolved',
            confidence: winner ? Number((winner.count / totalVotes).toFixed(4)) : 0,
            rawValues,
        };
    }

    // Tìm tất cả quốc gia được nhắc trong một giá trị để nhận diện trường hợp nguồn ghi “Mỹ/Trung Quốc”.
    private findCountries(rawValue: string): Array<{ code: string; name: string }> {
        const normalized = this.normalize(rawValue);
        const matches = Object.entries(COUNTRY_ALIASES)
            .sort(([left], [right]) => right.length - left.length)
            .filter(([alias]) => this.containsAlias(normalized, alias))
            .map(([, country]) => country);

        return [...new Map(matches.map((country) => [country.code, country])).values()];
    }

    // So khớp alias theo ranh giới từ để alias ngắn như “Ý”, “Bỉ”, “Mỹ” không khớp nhầm vào từ dài hơn.
    private containsAlias(value: string, alias: string): boolean {
        return new RegExp(`(^|[^a-z0-9])${this.escapeRegex(alias)}([^a-z0-9]|$)`).test(
            value,
        );
    }

    // Chỉ coi field nói rõ “thương hiệu” là nguồn xác định quốc gia brand.
    private isBrandCountryField(name: string | undefined): boolean {
        const normalized = this.normalize(name ?? '');
        return (
            normalized.includes('xuat xu thuong hieu') ||
            normalized.includes('quoc gia thuong hieu') ||
            normalized.includes('brand origin')
        );
    }

    // “Made in” và nơi sản xuất được giữ riêng để dùng cho product, không tham gia bỏ phiếu quốc gia brand.
    private isProductOriginField(name: string | undefined): boolean {
        const normalized = this.normalize(name ?? '');
        return (
            normalized.includes('made in') ||
            normalized.includes('noi san xuat') ||
            (normalized.includes('xuat xu') && !normalized.includes('thuong hieu'))
        );
    }

    // Chuẩn hóa tiếng Việt không dấu và khoảng trắng để so khớp ổn định giữa nhiều cách viết của nguồn.
    private normalize(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Tạo URL sản phẩm đầy đủ từ url_path public; fallback theo ID nếu nguồn không trả path.
    private toProductUrl(urlPath: string | undefined, productId: number): string {
        if (!urlPath) return `https://tiki.vn/p${productId}.html`;
        return urlPath.startsWith('http')
            ? urlPath
            : `https://tiki.vn/${urlPath.replace(/^\//, '')}`;
    }

    // Trả kết quả rỗng có trạng thái rõ ràng để report phân biệt thiếu dữ liệu và alias chưa hỗ trợ.
    private emptyResolution(
        status: Extract<BrandCountryResolutionStatus, 'missing' | 'unknown_alias'>,
        rawValues: string[],
    ): CrawledBrandCountry {
        return { code: null, name: null, status, confidence: 0, rawValues };
    }

    // Loại giá trị lặp nhưng vẫn giữ thứ tự xuất hiện đầu tiên để file audit dễ đọc.
    private unique(values: string[]): string[] {
        return [...new Set(values)];
    }

    // Escape alias trước khi đưa vào biểu thức chính quy để dữ liệu cấu hình không làm hỏng pattern.
    private escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

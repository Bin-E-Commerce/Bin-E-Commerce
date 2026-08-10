import { RetryableHttpClient } from '../../clients/retryable-http.client';
import { TikiProductClient } from '../../clients/tiki-product.client';
import { TIKI_BROWSER_USER_AGENT } from '../../config/tiki.config';
import type {
    TikiProductFilter,
    TikiProductFilterValue,
} from '../../types/tiki-product.type';
import type {
    TikiBrandFilterValue,
    TikiBrandProductSample,
    TikiCategoryDiscovery,
    TikiMenuCategory,
} from '../types/tiki-brand-source.type';

const TIKI_MENU_URL =
    'https://api.tiki.vn/raiden/v2/menu-config?platform=desktop';

interface TikiMenuResponse {
    menu_block?: {
        items?: Array<{
            text?: string;
            icon_url?: string;
            link?: string;
        }>;
    };
}

export class TikiBrandClient {
    constructor(
        private readonly products = new TikiProductClient(),
        private readonly http = new RetryableHttpClient({
            retries: 4,
            baseDelayMs: 1_000,
            maxDelayMs: 60_000,
            nonJsonDelayMs: 30_000,
            referer: 'https://tiki.vn/',
            userAgent: TIKI_BROWSER_USER_AGENT,
        }),
    ) {}

    // Đọc menu desktop public để lấy taxonomy gốc hiện tại thay vì hard-code category ID dễ lỗi thời.
    async fetchRootCategories(): Promise<TikiMenuCategory[]> {
        const response = await this.http.getJson<TikiMenuResponse>(
            new URL(TIKI_MENU_URL),
        );

        return (response.menu_block?.items ?? [])
            .map((item) => this.mapMenuItem(item))
            .filter((item): item is TikiMenuCategory => item !== null);
    }

    // Đọc aggregation của một category để lấy category con và brand public mà không tải toàn bộ sản phẩm.
    async discoverCategory(
        category: TikiMenuCategory,
    ): Promise<TikiCategoryDiscovery> {
        const response = await this.products.fetchProductPage({
            categoryId: category.id,
            page: 1,
            limit: 1,
        });
        const filters = response.filters ?? [];

        return {
            category,
            childCategories: this.mapChildCategories(
                filters.find((filter) => filter.code === 'category'),
                category.id,
            ),
            brands: this.mapBrands(
                filters.find((filter) => filter.code === 'brand'),
            ),
        };
    }

    // Lấy sản phẩm đại diện đúng brand/category rồi tải detail để thu thập bằng chứng quốc gia thương hiệu.
    async fetchBrandSamples(
        externalBrandId: string,
        categoryId: number,
        limit: number,
    ): Promise<TikiBrandProductSample[]> {
        const response = await this.products.fetchProductPage({
            categoryId,
            brandId: externalBrandId,
            page: 1,
            limit,
        });
        const samples: TikiBrandProductSample[] = [];

        for (const listItem of response.data ?? []) {
            const detail = await this.products.fetchProductDetail(listItem.id);
            samples.push({ listItem, detail, categoryId });
        }

        return samples;
    }

    // Chuyển item menu thành category seed và bỏ item không có ID dạng /c123 trong URL.
    private mapMenuItem(
        item: NonNullable<
            NonNullable<TikiMenuResponse['menu_block']>['items']
        >[number],
    ): TikiMenuCategory | null {
        const id = this.extractCategoryId(item.link);
        const name = item.text?.trim();
        if (!id || !name || !item.link) return null;

        return {
            id,
            name,
            url: item.link,
            iconUrl: item.icon_url?.trim() || null,
            parentId: null,
        };
    }

    // Map filter category thành queue BFS; parentId chỉ là bằng chứng cây nguồn và không được ghi vào Catalog Service.
    private mapChildCategories(
        filter: TikiProductFilter | undefined,
        parentId: number,
    ): TikiMenuCategory[] {
        return (filter?.values ?? []).reduce<TikiMenuCategory[]>(
            (categories, value) => {
                const id = this.toPositiveInteger(value.query_value);
                const name = value.display_value?.trim();
                if (!id || !name || id === parentId) return categories;

                categories.push({
                    id,
                    name,
                    url: value.url_key
                        ? `https://tiki.vn/${value.url_key}`
                        : `https://tiki.vn/c${id}`,
                    iconUrl: value.logo?.trim() || null,
                    parentId,
                });
                return categories;
            },
            [],
        );
    }

    // Map filter brand thành record nguồn tối thiểu, giữ external ID làm khóa idempotency ổn định.
    private mapBrands(
        filter: TikiProductFilter | undefined,
    ): TikiBrandFilterValue[] {
        return (filter?.values ?? [])
            .map((value) => this.mapBrand(value))
            .filter((brand): brand is TikiBrandFilterValue => brand !== null);
    }

    // Loại brand rỗng hoặc thiếu external ID vì các bản ghi đó không thể upsert an toàn khi crawl lại.
    private mapBrand(
        value: TikiProductFilterValue,
    ): TikiBrandFilterValue | null {
        const externalBrandId = String(value.query_value ?? '').trim();
        const name = value.display_value?.trim();
        if (!externalBrandId || !name) return null;

        return {
            externalBrandId,
            name,
            sourceUrl: value.url_key
                ? `https://tiki.vn/${value.url_key}`
                : null,
            productCount: Math.max(0, value.count ?? 0),
        };
    }

    // Trích category ID từ URL menu Tiki, hỗ trợ cả link có query string hoặc dấu gạch cuối.
    private extractCategoryId(url: string | undefined): number | null {
        const match = url?.match(/\/c(\d+)(?:[/?#]|$)/i);
        return match?.[1] ? Number(match[1]) : null;
    }

    // Chuẩn hóa query_value thành số nguyên dương trước khi đưa vào queue category.
    private toPositiveInteger(value: string | number | undefined): number | null {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }
}

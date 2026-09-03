import {
    TIKI_API_BASE_URL,
    TIKI_BASE_URL,
    TIKI_BROWSER_USER_AGENT,
    TIKI_PRODUCT_DETAIL_API_URL,
    TIKI_PRODUCT_LISTING_API_URL,
} from '../config/tiki.config';
import { RetryableHttpClient } from './retryable-http.client';
import { getCrawlerNumber } from '../utils/crawler-config';
import type {
    TikiCategoryResponse,
    TikiProductDetailResponse,
    TikiProductListResponse,
    TikiReviewResponse,
} from '../types/tiki-product.type';

export interface TikiProductPageParams {
    keyword?: string;
    categoryId?: number;
    urlKey?: string;
    sellerId?: string;
    brandId?: string;
    page: number;
    limit: number;
}

export class TikiProductClient {
    constructor(
        private readonly http = new RetryableHttpClient({
            retries: getCrawlerNumber('TIKI_CRAWLER_RETRIES', 4),
            baseDelayMs: 1_000,
            maxDelayMs: 60_000,
            nonJsonDelayMs: getCrawlerNumber(
                'TIKI_CRAWLER_NON_JSON_DELAY_MS',
                30_000,
            ),
            referer: `${TIKI_BASE_URL}/`,
            userAgent: TIKI_BROWSER_USER_AGENT,
        }),
    ) {}

    // Lấy danh mục gốc từ endpoint public; nếu endpoint thay đổi thì adapter vẫn có thể nhận category id từ CLI.
    async fetchRootCategories(): Promise<TikiCategoryResponse[]> {
        const url = new URL(`${TIKI_API_BASE_URL}/categories`);
        url.searchParams.set('parent_id', '2');
        const response = await this.http.getJson<
            TikiCategoryResponse[] | { data?: TikiCategoryResponse[] }
        >(url);
        return Array.isArray(response) ? response : response.data ?? [];
    }

    // Lấy danh mục con theo parent/category id khi nguồn public trả dữ liệu dạng cây.
    async fetchChildCategories(categoryId: number): Promise<TikiCategoryResponse[]> {
        const url = new URL(`${TIKI_API_BASE_URL}/categories`);
        url.searchParams.set('parent_id', String(categoryId));
        const response = await this.http.getJson<
            TikiCategoryResponse[] | { data?: TikiCategoryResponse[] }
        >(url);
        return Array.isArray(response) ? response : response.data ?? [];
    }

    // Lấy url_key của category để listing endpoint không bị Tiki từ chối request category.
    async fetchCategoryUrlKey(categoryId: number): Promise<string | undefined> {
        const url = new URL(`${TIKI_API_BASE_URL}/categories/${categoryId}`);
        const category = await this.http.getJson<TikiCategoryResponse>(url);
        return category.url_key?.trim() || undefined;
    }

    // Lấy một trang danh sách sản phẩm từ endpoint public của Tiki theo keyword, category hoặc seller.
    // Seller filter giúp batch crawl giữ cùng một shop thay vì trộn nhiều nhà bán trong một category.
    async fetchProductPage(
        params: TikiProductPageParams,
    ): Promise<TikiProductListResponse> {
        const url = new URL(TIKI_PRODUCT_LISTING_API_URL);
        url.searchParams.set('limit', String(params.limit));
        url.searchParams.set('page', String(params.page));
        url.searchParams.set('include', 'advertisement');
        url.searchParams.set('aggregations', '2');

        if (params.keyword) url.searchParams.set('q', params.keyword);
        if (params.categoryId) {
            url.searchParams.set('category', String(params.categoryId));
            const urlKey =
                params.urlKey ??
                (await this.fetchCategoryUrlKey(params.categoryId));
            if (urlKey) url.searchParams.set('urlKey', urlKey);
        }
        if (params.sellerId) {
            url.searchParams.set('seller', params.sellerId);
        }
        if (params.brandId) {
            url.searchParams.set('brand', params.brandId);
        }

        return this.http.getJson<TikiProductListResponse>(url);
    }

    // Lấy chi tiết sản phẩm để bổ sung ảnh, mô tả, thông số, seller và variant nếu Tiki trả về.
    async fetchProductDetail(
        id: number,
        sourceUrl?: string,
    ): Promise<TikiProductDetailResponse> {
        // Cho phép batch lớn đọc SSR trực tiếp khi detail API bị rate-limit liên tục nhưng product page vẫn public.
        if (process.env['TIKI_CRAWLER_PAGE_ONLY'] === '1') {
            return this.fetchProductDetailFromPage(id, sourceUrl);
        }

        const url = new URL(`${TIKI_PRODUCT_DETAIL_API_URL}/${id}`);
        try {
            return await this.http.getJson<TikiProductDetailResponse>(url);
        } catch (error) {
            // Product page thường vẫn có dữ liệu SSR khi detail API bị giới hạn, nên dùng nó làm fallback đọc-only.
            try {
                return await this.fetchProductDetailFromPage(id, sourceUrl);
            } catch {
                throw error;
            }
        }
    }

    // Lấy review public nếu endpoint cho phép; caller có thể bỏ qua khi API không trả dữ liệu.
    async fetchProductReviews(id: number, limit: number): Promise<TikiReviewResponse> {
        const url = new URL(`${TIKI_API_BASE_URL}/reviews`);
        url.searchParams.set('product_id', String(id));
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('page', '1');
        return this.http.getJson<TikiReviewResponse>(url);
    }

    // Đọc product detail được nhúng trong __NEXT_DATA__ để không bỏ toàn bộ product hợp lệ khi API JSON tạm lỗi.
    private async fetchProductDetailFromPage(
        id: number,
        sourceUrl?: string,
    ): Promise<TikiProductDetailResponse> {
        const html = await this.http.getText(
            new URL(sourceUrl ?? `${TIKI_BASE_URL}/p${id}.html`),
        );
        const match = html.match(
            /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
        );
        if (!match?.[1]) {
            throw new Error(`Không tìm thấy SSR product data cho ${id}.`);
        }

        const nextData = JSON.parse(match[1]) as {
            props?: {
                initialState?: {
                    desktop?: {
                        productData?: {
                            response?: { data?: TikiProductDetailResponse };
                        };
                    };
                    productv2?: {
                        productData?: {
                            response?: { data?: TikiProductDetailResponse };
                        };
                    };
                };
            };
        };
        const state = nextData.props?.initialState;
        const detail =
            state?.productv2?.productData?.response?.data ??
            state?.desktop?.productData?.response?.data;
        if (!detail) throw new Error(`SSR product data rỗng cho ${id}.`);
        return detail;
    }
}

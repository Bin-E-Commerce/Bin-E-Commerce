import {
    TIKI_API_BASE_URL,
    TIKI_BASE_URL,
    TIKI_BROWSER_USER_AGENT,
    TIKI_PRODUCT_DETAIL_API_URL,
    TIKI_PRODUCT_LISTING_API_URL,
} from '../config/tiki.config';
import { RetryableHttpClient } from './retryable-http.client';
import type {
    TikiCategoryResponse,
    TikiProductDetailResponse,
    TikiProductListResponse,
    TikiReviewResponse,
} from '../types/tiki-product.type';

export interface TikiProductPageParams {
    keyword?: string;
    categoryId?: number;
    brandId?: string;
    page: number;
    limit: number;
}

export class TikiProductClient {
    constructor(
        private readonly http = new RetryableHttpClient({
            retries: 4,
            baseDelayMs: 1_000,
            maxDelayMs: 60_000,
            nonJsonDelayMs: 30_000,
            referer: `${TIKI_BASE_URL}/`,
            userAgent: TIKI_BROWSER_USER_AGENT,
        }),
    ) {}

    // Lấy danh mục gốc từ endpoint public; nếu endpoint thay đổi thì adapter vẫn có thể nhận category id từ CLI.
    async fetchRootCategories(): Promise<TikiCategoryResponse[]> {
        const url = new URL(`${TIKI_API_BASE_URL}/categories`);
        const response = await this.http.getJson<
            TikiCategoryResponse[] | { data?: TikiCategoryResponse[] }
        >(url);
        return Array.isArray(response) ? response : response.data ?? [];
    }

    // Lấy danh mục con theo parent/category id khi nguồn public trả dữ liệu dạng cây.
    async fetchChildCategories(categoryId: number): Promise<TikiCategoryResponse[]> {
        const url = new URL(`${TIKI_API_BASE_URL}/categories/${categoryId}`);
        const response = await this.http.getJson<TikiCategoryResponse>(url);
        return response.children ?? [];
    }

    // Lấy một trang danh sách sản phẩm từ endpoint public của Tiki theo keyword hoặc category.
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
        }
        if (params.brandId) {
            url.searchParams.set('brand', params.brandId);
        }

        return this.http.getJson<TikiProductListResponse>(url);
    }

    // Lấy chi tiết sản phẩm để bổ sung ảnh, mô tả, thông số, seller và variant nếu Tiki trả về.
    async fetchProductDetail(id: number): Promise<TikiProductDetailResponse> {
        const url = new URL(`${TIKI_PRODUCT_DETAIL_API_URL}/${id}`);
        return this.http.getJson<TikiProductDetailResponse>(url);
    }

    // Lấy review public nếu endpoint cho phép; caller có thể bỏ qua khi API không trả dữ liệu.
    async fetchProductReviews(id: number, limit: number): Promise<TikiReviewResponse> {
        const url = new URL(`${TIKI_API_BASE_URL}/reviews`);
        url.searchParams.set('product_id', String(id));
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('page', '1');
        return this.http.getJson<TikiReviewResponse>(url);
    }
}

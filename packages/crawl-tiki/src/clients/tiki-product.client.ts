import { TIKI_API_BASE_URL } from '../config/tiki.config';
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
    page: number;
    limit: number;
}

export class TikiProductClient {
    constructor(
        private readonly http = new RetryableHttpClient({
            retries: 3,
            baseDelayMs: 500,
            userAgent: 'Mozilla/5.0 (compatible; BinEcommerceCrawler/1.0)',
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
        const url = new URL(`${TIKI_API_BASE_URL}/products`);
        url.searchParams.set('limit', String(params.limit));
        url.searchParams.set('page', String(params.page));
        url.searchParams.set('include', 'advertisement');
        url.searchParams.set('aggregations', '2');

        if (params.keyword) url.searchParams.set('q', params.keyword);
        if (params.categoryId) {
            url.searchParams.set('category', String(params.categoryId));
        }

        return this.http.getJson<TikiProductListResponse>(url);
    }

    // Lấy chi tiết sản phẩm để bổ sung ảnh, mô tả, thông số, seller và variant nếu Tiki trả về.
    async fetchProductDetail(id: number): Promise<TikiProductDetailResponse> {
        const url = new URL(`${TIKI_API_BASE_URL}/products/${id}`);
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

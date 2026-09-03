import type {
    SourceCategory,
    SourceProductDetail,
    SourceProductListItem,
    SourcePlatform,
} from '../types/source-product.type';

export interface ProductPageRequest {
    categoryExternalId?: string;
    sellerExternalId?: string;
    sellerName?: string;
    sellerSlug?: string;
    keyword?: string;
    page: number;
    limit: number;
}

export interface ProductPageResult {
    items: SourceProductListItem[];
    currentPage: number;
    lastPage: number | null;
}

export interface ProductSourceAdapter {
    readonly platform: SourcePlatform;
    listRootCategories(): Promise<SourceCategory[]>;
    listChildCategories(parentExternalId: string): Promise<SourceCategory[]>;
    listProducts(request: ProductPageRequest): Promise<ProductPageResult>;
    getProductDetail(externalId: string): Promise<SourceProductDetail>;
    getProductReviews(externalId: string, limit: number): Promise<SourceProductDetail['reviews']>;
}

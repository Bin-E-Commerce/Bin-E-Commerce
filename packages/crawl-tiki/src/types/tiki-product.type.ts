export interface TikiProductListResponse {
    data?: TikiProductListItem[];
    filters?: TikiProductFilter[];
    paging?: {
        current_page?: number;
        last_page?: number;
        per_page?: number;
        total?: number;
    };
}

export interface TikiProductFilter {
    code?: string;
    display_name?: string;
    values?: TikiProductFilterValue[];
}

export interface TikiProductFilterValue {
    display_value?: string;
    count?: number;
    logo?: string;
    query_value?: string | number;
    url_key?: string;
}

export interface TikiProductListItem {
    id: number;
    sku?: string;
    name?: string;
    url_path?: string;
    short_description?: string;
    thumbnail_url?: string;
    price?: number;
    original_price?: number;
    discount?: number;
    discount_rate?: number;
    rating_average?: number;
    review_count?: number;
    quantity_sold?: {
        text?: string;
        value?: number;
    };
    brand?: {
        id?: number;
        name?: string;
        slug?: string;
        logo?: string;
    };
    seller_id?: number;
    seller_product_id?: number;
    visible_impression_info?: {
        amplitude?: {
            primary_category_name?: string;
            category_l1_name?: string;
            category_l2_name?: string;
            category_l3_name?: string;
        };
    };
}

export interface TikiProductDetailResponse extends TikiProductListItem {
    short_description?: string;
    description?: string;
    images?: Array<{
        base_url?: string;
        large_url?: string;
        medium_url?: string;
        small_url?: string;
    }>;
    categories?: {
        id?: number;
        name?: string;
        is_leaf?: boolean;
    };
    breadcrumbs?: Array<{
        category_id?: number;
        name?: string;
        url?: string;
    }>;
    specifications?: Array<{
        name?: string;
        attributes?: Array<{
            code?: string;
            name?: string;
            value?: string;
        }>;
    }>;
    current_seller?: {
        id?: number;
        name?: string;
        logo?: string;
        link?: string;
    };
    configurable_options?: Array<{
        code?: string;
        name?: string;
        position?: number;
        values?: Array<{
            label?: string;
            value?: string;
        }>;
    }>;
    configurable_products?: Array<{
        id?: number;
        sku?: string;
        name?: string;
        price?: number;
        original_price?: number;
        inventory_status?: string;
        thumbnail_url?: string;
        option1?: string;
        option2?: string;
        option3?: string;
        configurable_product_options?: Array<{
            name?: string;
            value?: string;
        }>;
    }>;
}

export interface TikiCategoryResponse {
    id?: number;
    name?: string;
    url_key?: string;
    url_path?: string;
    level?: number;
    parent_id?: number;
    children?: TikiCategoryResponse[];
}

export interface TikiReviewResponse {
    data?: Array<{
        id?: number;
        rating?: number;
        title?: string;
        content?: string;
        created_at?: number;
        images?: Array<{
            full_path?: string;
            thumbnail_url?: string;
        }>;
    }>;
}

export interface CrawledProduct {
    source: 'tiki';
    sourceId: number;
    sku: string | null;
    name: string;
    url: string;
    thumbnailUrl: string | null;
    imageUrls: string[];
    brandName: string | null;
    sellerName: string | null;
    price: number;
    originalPrice: number | null;
    discount: number | null;
    discountRate: number | null;
    ratingAverage: number | null;
    reviewCount: number;
    soldCount: number | null;
    shortDescription: string | null;
    description: string | null;
    categories: string[];
    specifications: Record<string, string>;
    crawledAt: string;
}

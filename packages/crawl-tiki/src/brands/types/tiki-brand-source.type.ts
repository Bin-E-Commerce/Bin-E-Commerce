import type {
    TikiProductDetailResponse,
    TikiProductListItem,
} from '../../types/tiki-product.type';

export interface TikiMenuCategory {
    id: number;
    name: string;
    url: string;
    iconUrl: string | null;
    parentId: number | null;
}

export interface TikiBrandFilterValue {
    externalBrandId: string;
    name: string;
    sourceUrl: string | null;
    productCount: number;
}

export interface TikiOpenApiBrandValue {
    externalBrandId: string;
    name: string;
    sourceUrl: string | null;
    logoUrl: string | null;
    position: number | null;
}

export interface TikiCategoryDiscovery {
    category: TikiMenuCategory;
    childCategories: TikiMenuCategory[];
    brands: TikiBrandFilterValue[];
}

export interface TikiBrandProductSample {
    listItem: TikiProductListItem;
    detail: TikiProductDetailResponse;
    categoryId: number;
}

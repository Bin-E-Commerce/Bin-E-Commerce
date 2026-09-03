import { TIKI_BASE_URL } from '../config/tiki.config';
import { TikiProductClient } from '../clients/tiki-product.client';
import {
    TikiShopClient,
    type TikiShopProfile,
} from '../clients/tiki-shop.client';
import type {
    ProductPageRequest,
    ProductPageResult,
    ProductSourceAdapter,
} from './product-source.adapter';
import type {
    SourceCategory,
    SourceProductDetail,
    SourceProductListItem,
    SourceProductReview,
    SourceProductVariant,
} from '../types/source-product.type';
import type {
    TikiCategoryResponse,
    TikiProductDetailResponse,
    TikiProductListItem,
} from '../types/tiki-product.type';
import { toNullableNumber } from '../utils/number';
import { slugify, sourceSlug } from '../utils/slug';
import { buildTikiProductUrl } from '../utils/tiki-url';

export class TikiSourceAdapter implements ProductSourceAdapter {
    readonly platform = 'tiki' as const;
    private readonly productSourceUrls = new Map<string, string>();
    private readonly productListItems = new Map<string, TikiProductListItem>();
    private sellerContext: { id: string; name: string; slug?: string } | null = null;
    private readonly shopProfilePromises = new Map<
        string,
        Promise<TikiShopProfile>
    >();

    constructor(
        private readonly client = new TikiProductClient(),
        private readonly shopClient = new TikiShopClient(),
    ) {}

    // Lấy danh mục gốc từ Tiki và chuẩn hóa về SourceCategory.
    async listRootCategories(): Promise<SourceCategory[]> {
        const categories = await this.client.fetchRootCategories();
        return categories.map((category, index) =>
            this.mapCategory(category, null, index),
        );
    }

    // Lấy danh mục con của một category Tiki nếu endpoint public đang hỗ trợ.
    async listChildCategories(parentExternalId: string): Promise<SourceCategory[]> {
        const categories = await this.client.fetchChildCategories(
            Number(parentExternalId),
        );
        return categories.map((category, index) =>
            this.mapCategory(category, parentExternalId, index),
        );
    }

    // Lấy một trang sản phẩm theo keyword hoặc category id rồi map item tối giản cho crawler.
    async listProducts(request: ProductPageRequest): Promise<ProductPageResult> {
        if (request.sellerExternalId && request.sellerName) {
            this.sellerContext = {
                id: request.sellerExternalId,
                name: request.sellerName,
                slug: request.sellerSlug,
            };
        }

        const response = await this.client.fetchProductPage({
            keyword: request.keyword,
            categoryId: request.categoryExternalId
                ? Number(request.categoryExternalId)
                : undefined,
            sellerId: request.sellerExternalId,
            page: request.page,
            limit: request.limit,
        });

        const items = (response.data ?? []).map((item) => {
            const mappedItem = this.mapListItem(item);
            this.productListItems.set(mappedItem.externalId, item);
            this.productSourceUrls.set(mappedItem.externalId, mappedItem.sourceUrl);
            return mappedItem;
        });

        return {
            items,
            currentPage: response.paging?.current_page ?? request.page,
            lastPage: response.paging?.last_page ?? null,
        };
    }

    // Lấy chi tiết product và chuẩn hóa về contract chung để mapper không phụ thuộc raw Tiki.
    async getProductDetail(externalId: string): Promise<SourceProductDetail> {
        let detail: TikiProductDetailResponse;
        try {
            detail = await this.client.fetchProductDetail(
                Number(externalId),
                this.productSourceUrls.get(externalId),
            );
        } catch (error) {
            const listItem = this.productListItems.get(externalId);
            if (!listItem || !this.sellerContext) throw error;
            detail = this.mapListItemToDetail(listItem, this.sellerContext);
        }
        const shopProfile = await this.fetchShopProfile(detail.current_seller);
        return this.mapDetail(detail, [], shopProfile);
    }

    // Lấy profile shop một lần rồi tái sử dụng cho các product cùng seller để giảm request và giữ metric đồng nhất.
    // Nếu trang shop tạm lỗi, vẫn trả fallback từ product detail để product không mất seller name/avatar/sourceUrl.
    private async fetchShopProfile(
        seller: TikiProductDetailResponse['current_seller'],
    ): Promise<TikiShopProfile | null> {
        if (!seller?.id || !seller.name) return null;

        const externalId = String(seller.id);
        const cached = this.shopProfilePromises.get(externalId);
        if (cached) return cached;

        const slug = sourceSlug(seller.name, externalId);
        const fallback: TikiShopProfile = {
            externalId,
            name: seller.name,
            slug,
            avatarUrl: seller.logo ?? null,
            description: null,
            sourceUrl: seller.link ?? `${TIKI_BASE_URL}/cua-hang/${slug}`,
            ratingAverage: null,
            reviewCount: null,
            followerCount: null,
        };
        const profilePromise = this.shopClient
            .fetchShopProfile(fallback.sourceUrl, {
                externalId,
                name: seller.name,
                slug,
                avatarUrl: seller.logo ?? null,
            })
            .then((profile) => profile ?? fallback)
            .catch(() => fallback);

        this.shopProfilePromises.set(externalId, profilePromise);
        return profilePromise;
    }

    // Lấy review public của Tiki; nếu request fail thì để crawler ghi nhận lỗi ở cấp product.
    async getProductReviews(
        externalId: string,
        limit: number,
    ): Promise<SourceProductReview[]> {
        const response = await this.client.fetchProductReviews(
            Number(externalId),
            limit,
        );

        return (response.data ?? []).map((review) => ({
            externalId: String(review.id ?? `${externalId}-${review.created_at}`),
            rating: toNullableNumber(review.rating) ?? 0,
            content: review.content ?? review.title ?? null,
            images:
                review.images
                    ?.map((image) => image.full_path ?? image.thumbnail_url)
                    .filter((url): url is string => Boolean(url)) ?? [],
            createdAt: review.created_at
                ? new Date(review.created_at * 1000).toISOString()
                : new Date().toISOString(),
        }));
    }

    // Chuẩn hóa raw category của Tiki thành category chung có slug và external id.
    private mapCategory(
        category: TikiCategoryResponse,
        parentExternalId: string | null,
        sortOrder: number,
    ): SourceCategory {
        const externalId = String(category.id ?? category.url_path ?? sortOrder);
        const name = category.name ?? `Tiki category ${externalId}`;

        return {
            externalId,
            name,
            slug: sourceSlug(name, externalId),
            parentExternalId,
            level: category.level ?? (parentExternalId ? 1 : 0),
            sortOrder,
            sourceUrl: this.buildTikiUrl(category.url_path),
        };
    }

    // Chuẩn hóa item danh sách để crawler biết product id và URL trước khi lấy detail.
    private mapListItem(item: TikiProductListItem): SourceProductListItem {
        return {
            externalId: String(item.id),
            name: item.name ?? `Tiki product ${item.id}`,
            sourceUrl: buildTikiProductUrl(item.url_path),
        };
    }

    // Dựng detail tối thiểu từ listing khi endpoint detail bị giới hạn, vẫn giữ seller/giá/rating/lượt bán thật.
    private mapListItemToDetail(
        item: TikiProductListItem,
        seller: { id: string; name: string; slug?: string },
    ): TikiProductDetailResponse {
        const amplitude = item.visible_impression_info?.amplitude;
        const categoryNames = [
            amplitude?.category_l1_name,
            amplitude?.category_l2_name,
            amplitude?.category_l3_name,
            amplitude?.primary_category_name,
        ]
            .filter((name): name is string => Boolean(name?.trim()))
            .map((name) => this.normalizeListingCategory(name))
            .filter((name, index, names) => names.indexOf(name) === index);
        const categoryName = categoryNames.at(-1) ?? 'Sản phẩm khác';

        return {
            ...item,
            short_description: item.short_description,
            images: item.thumbnail_url
                ? [{
                      base_url: item.thumbnail_url,
                      large_url: item.thumbnail_url,
                      medium_url: item.thumbnail_url,
                      small_url: item.thumbnail_url,
                  }]
                : [],
            categories: { name: categoryName },
            breadcrumbs: categoryNames.map((name, index) => ({
                category_id: index + 1,
                name,
            })),
            specifications: [],
            current_seller: {
                id: Number(seller.id),
                name: seller.name,
                link: `${TIKI_BASE_URL}/cua-hang/${seller.slug ?? slugify(seller.name)}`,
            },
            configurable_options: [],
            configurable_products: [],
        };
    }

    // Chuẩn hóa nhãn taxonomy riêng của Tiki về category tương đương đã tồn tại trong catalog nội bộ.
    private normalizeListingCategory(name: string): string {
        const normalized = name.trim().toLowerCase();
        if (normalized === 'ngon') return 'Thực phẩm và đồ uống';
        if (
            normalized.includes('điều khiển từ xa') ||
            normalized.includes('phụ kiện tivi') ||
            normalized.includes('phụ kiện, linh kiện máy lạnh')
        ) {
            return 'Thiết bị điều khiển từ xa';
        }
        return name.trim();
    }

    // Map chi tiết Tiki thành SourceProductDetail, bao gồm ảnh, variant, option, brand, shop và thông số kỹ thuật.
    private mapDetail(
        detail: TikiProductDetailResponse,
        reviews: SourceProductReview[],
        shopProfile: TikiShopProfile | null = null,
    ): SourceProductDetail {
        const name = detail.name ?? `Tiki product ${detail.id}`;
        const options = this.collectOptions(detail);
        const variants = this.collectVariants(detail, options);

        return {
            platform: this.platform,
            externalId: String(detail.id),
            sku: detail.sku ?? null,
            name,
            slug: sourceSlug(name, String(detail.id)),
            sourceUrl: buildTikiProductUrl(detail.url_path),
            description: detail.description ?? null,
            shortDescription: detail.short_description ?? null,
            totalSold: toNullableNumber(detail.quantity_sold?.value),
            ratingAverage: toNullableNumber(detail.rating_average),
            reviewCount: toNullableNumber(detail.review_count),
            viewCount: null,
            brand: detail.brand?.name
                ? {
                      externalId: detail.brand.id
                          ? String(detail.brand.id)
                          : null,
                      name: detail.brand.name,
                      slug:
                          detail.brand.slug ??
                          sourceSlug(detail.brand.name, String(detail.brand.id ?? '')),
                      logoUrl: detail.brand.logo ?? null,
                      description: null,
                  }
                : null,
            shop: detail.current_seller?.name
                ? {
                      externalId: detail.current_seller.id
                          ? String(detail.current_seller.id)
                          : null,
                      name: detail.current_seller.name,
                      slug: sourceSlug(
                          detail.current_seller.name,
                          String(detail.current_seller.id ?? ''),
                      ),
                      avatarUrl: detail.current_seller.logo ?? null,
                      description: null,
                      sourceUrl:
                          shopProfile?.sourceUrl ??
                          detail.current_seller.link ??
                          null,
                      ratingAverage: shopProfile?.ratingAverage ?? null,
                      reviewCount: shopProfile?.reviewCount ?? null,
                      followerCount: shopProfile?.followerCount ?? null,
                  }
                : null,
            categories: this.collectCategories(detail),
            images: this.collectImages(detail, name),
            options,
            variants,
            attributes: this.collectAttributes(detail),
            reviews,
        };
    }

    // Lấy options từ configurable_options; đây là nơi Tiki mô tả màu sắc, dung lượng, size.
    private collectOptions(detail: TikiProductDetailResponse) {
        return (
            detail.configurable_options?.map((option) => ({
                name: option.name ?? option.code ?? 'Phân loại',
                values:
                    option.values
                        ?.map((value) => value.label ?? value.value)
                        .filter((value): value is string => Boolean(value)) ??
                    [],
            })) ?? []
        );
    }

    // Nếu Tiki không trả variant, tạo một default variant để product luôn có SKU bán hàng.
    private collectVariants(
        detail: TikiProductDetailResponse,
        options: Array<{ name: string; values: string[] }>,
    ): SourceProductVariant[] {
        const configurableProducts = detail.configurable_products ?? [];
        if (configurableProducts.length === 0) {
            return [
                {
                    externalId: String(detail.id),
                    sku: detail.sku ?? `tiki-${detail.id}`,
                    name: detail.name ?? `Tiki product ${detail.id}`,
                    price: toNullableNumber(detail.price) ?? 0,
                    originalPrice: toNullableNumber(detail.original_price),
                    stockQuantity: 0,
                    weight: null,
                    imageUrl: detail.thumbnail_url ?? null,
                    optionValues: {},
                },
            ];
        }

        return configurableProducts.map((variant) => ({
            externalId: variant.id ? String(variant.id) : variant.sku ?? null,
            sku: variant.sku ?? `tiki-${detail.id}-${variant.id ?? 'variant'}`,
            name: variant.name ?? detail.name ?? `Tiki variant ${variant.id}`,
            price: toNullableNumber(variant.price) ?? toNullableNumber(detail.price) ?? 0,
            originalPrice:
                toNullableNumber(variant.original_price) ??
                toNullableNumber(detail.original_price),
            stockQuantity:
                variant.inventory_status === 'available' ? 999 : 0,
            weight: null,
            imageUrl: variant.thumbnail_url ?? detail.thumbnail_url ?? null,
            optionValues: this.collectVariantOptionValues(variant, options),
        }));
    }

    // Gắn option value cho variant từ configurable_product_options hoặc fallback option1/2/3 của Tiki.
    private collectVariantOptionValues(
        variant: NonNullable<TikiProductDetailResponse['configurable_products']>[number],
        options: Array<{ name: string; values: string[] }>,
    ): Record<string, string> {
        const explicitValues =
            variant.configurable_product_options?.reduce<Record<string, string>>(
                (acc, option) => {
                    if (option.name && option.value) acc[option.name] = option.value;
                    return acc;
                },
                {},
            ) ?? {};

        if (Object.keys(explicitValues).length > 0) return explicitValues;

        return options.reduce<Record<string, string>>((acc, option, index) => {
            const rawValue = [variant.option1, variant.option2, variant.option3][index];
            if (rawValue) acc[option.name] = rawValue;
            return acc;
        }, {});
    }

    // Gom ảnh detail của Tiki thành danh sách ảnh product, giữ thứ tự gốc để chọn thumbnail.
    private collectImages(detail: TikiProductDetailResponse, productName: string) {
        const urls =
            detail.images?.flatMap((image) => [
                image.large_url,
                image.base_url,
                image.medium_url,
                image.small_url,
            ]) ?? [];

        const uniqueUrls = Array.from(
            new Set(
                [detail.thumbnail_url, ...urls].filter(
                    (url): url is string => Boolean(url),
                ),
            ),
        );

        return uniqueUrls.map((url) => ({
            url,
            altText: productName,
        }));
    }

    // Gom breadcrumb/category thành category chain từ cha tới con để importer upsert theo cấp.
    private collectCategories(detail: TikiProductDetailResponse): SourceCategory[] {
        const breadcrumbs = (detail.breadcrumbs ?? []).filter(
            (breadcrumb) => breadcrumb.category_id || breadcrumb.name,
        );
        if (breadcrumbs.length > 0) {
            return breadcrumbs.map((breadcrumb, index) => {
                const externalId = String(
                    breadcrumb.category_id ??
                        sourceSlug(breadcrumb.name ?? 'category', String(index)),
                );
                const name = breadcrumb.name ?? `Tiki category ${externalId}`;
                return {
                    externalId,
                    name,
                    slug: sourceSlug(name, externalId),
                    parentExternalId:
                        index > 0
                            ? String(breadcrumbs[index - 1]?.category_id ?? '')
                            : null,
                    level: index,
                    sortOrder: index,
                    sourceUrl: this.buildTikiUrl(breadcrumb.url),
                };
            });
        }

        if (!detail.categories?.name) return [];
        const externalId = String(detail.categories.id ?? detail.id);
        return [
            {
                externalId,
                name: detail.categories.name,
                slug: sourceSlug(detail.categories.name, externalId),
                parentExternalId: null,
                level: 0,
                sortOrder: 0,
                sourceUrl: null,
            },
        ];
    }

    // Chuyển specifications của Tiki thành attributes để importer tạo attributes và product_attribute_values.
    private collectAttributes(detail: TikiProductDetailResponse) {
        return (
            detail.specifications?.flatMap((group) =>
                (group.attributes ?? []).map((attribute) => ({
                    name: attribute.name ?? attribute.code ?? 'Thông số',
                    value: attribute.value ?? '',
                    unit: null,
                    dataType: 'text' as const,
                    isFilterable: true,
                })),
            ) ?? []
        ).filter((attribute) => attribute.value);
    }

    // Chuẩn hóa URL Tiki vì API có lúc trả path tương đối, có lúc trả full URL.
    private buildTikiUrl(url?: string): string | null {
        if (!url) return null;
        if (url.startsWith('http')) return url;
        return `${TIKI_BASE_URL}/${url.replace(/^\/+/, '')}`;
    }
}

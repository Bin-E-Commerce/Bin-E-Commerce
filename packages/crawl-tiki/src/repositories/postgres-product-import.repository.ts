import type {
    ImportAttribute,
    ImportBrand,
    ImportCategory,
    ImportInventory,
    ImportProductGraph,
    ImportProductImage,
    ImportProductOption,
    ImportProductVariant,
    ImportReview,
    ImportShop,
} from '../types/import-product.type';
import type {
    ProductImportRepository,
    ProductImportResult,
} from './product-import.repository';

export interface QueryResult<T extends object> {
    rows: T[];
}

export interface DatabaseExecutor {
    query<T extends object = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
    ): Promise<QueryResult<T>>;
}

export class PostgresProductImportRepository implements ProductImportRepository {
    constructor(private readonly db: DatabaseExecutor) {}

    // Upsert toàn bộ graph trong một transaction để product không bị ghi dở giữa chừng.
    async upsertProductGraph(
        graph: ImportProductGraph,
    ): Promise<ProductImportResult> {
        await this.db.query('BEGIN');
        try {
            const categoryIds = await this.upsertCategoryChain(graph.categoryChain);
            const brandId = graph.brand
                ? await this.upsertBrand(graph.brand)
                : null;
            const shopId = graph.shop ? await this.upsertShop(graph.shop) : null;
            const categoryId = categoryIds.at(-1) ?? null;
            const productId = await this.upsertProduct(
                graph,
                shopId,
                categoryId,
                brandId,
            );

            await this.upsertImages(productId, graph.images, new Map());
            const optionValueIds = await this.upsertOptions(
                productId,
                graph.options,
            );
            const variantIds = await this.upsertVariants(
                productId,
                graph.variants,
                optionValueIds,
            );
            await this.upsertInventories(graph.inventories, variantIds);
            await this.upsertAttributes(productId, categoryId, graph.attributes);
            await this.upsertReviews(productId, graph.reviews, variantIds);
            await this.db.query('COMMIT');

            return { productId, insertedOrUpdated: true };
        } catch (error) {
            await this.db.query('ROLLBACK');
            throw error;
        }
    }

    // Upsert category theo thứ tự chain để category con lấy đúng parent_id vừa tạo.
    private async upsertCategoryChain(
        categories: ImportCategory[],
    ): Promise<string[]> {
        const ids: string[] = [];
        const externalToId = new Map<string, string>();

        for (const category of categories) {
            const parentId = category.parentExternalId
                ? externalToId.get(category.parentExternalId) ?? null
                : null;
            const id = await this.upsertCategory(category, parentId);
            externalToId.set(category.externalId, id);
            ids.push(id);
        }

        return ids;
    }

    // Upsert category chống trùng theo slug; external fields giúp trace về nguồn crawl.
    private async upsertCategory(
        category: ImportCategory,
        parentId: string | null,
    ): Promise<string> {
        const result = await this.db.query<{ id: string }>(
            `
            INSERT INTO categories (
                parent_id, name, slug, level, sort_order, is_active,
                source_platform, external_category_id, source_url
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (slug)
            DO UPDATE SET
                parent_id = EXCLUDED.parent_id,
                name = EXCLUDED.name,
                level = EXCLUDED.level,
                sort_order = EXCLUDED.sort_order,
                is_active = EXCLUDED.is_active,
                source_platform = EXCLUDED.source_platform,
                external_category_id = EXCLUDED.external_category_id,
                source_url = EXCLUDED.source_url
            RETURNING id
            `,
            [
                parentId,
                category.name,
                category.slug,
                category.level,
                category.sortOrder,
                category.isActive,
                category.sourcePlatform,
                category.externalId,
                category.sourceUrl,
            ],
        );
        return this.firstId(result, 'category');
    }

    // Upsert brand theo slug để không tạo trùng thương hiệu giữa các lần crawl.
    private async upsertBrand(brand: ImportBrand): Promise<string> {
        const result = await this.db.query<{ id: string }>(
            `
            INSERT INTO brands (
                name, slug, logo_url, description, is_active,
                source_platform, external_brand_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (slug)
            DO UPDATE SET
                name = EXCLUDED.name,
                logo_url = EXCLUDED.logo_url,
                description = EXCLUDED.description,
                is_active = EXCLUDED.is_active,
                source_platform = EXCLUDED.source_platform,
                external_brand_id = EXCLUDED.external_brand_id
            RETURNING id
            `,
            [
                brand.name,
                brand.slug,
                brand.logoUrl,
                brand.description,
                brand.isActive,
                brand.sourcePlatform,
                brand.externalId,
            ],
        );
        return this.firstId(result, 'brand');
    }

    // Upsert shop theo source_platform + external_shop_id nếu có, fallback slug nếu nguồn thiếu id.
    private async upsertShop(shop: ImportShop): Promise<string> {
        const result = await this.db.query<{ id: string }>(
            `
            INSERT INTO shops (
                owner_id, name, slug, avatar_url, description, status,
                source_platform, external_shop_id
            )
            VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (slug)
            DO UPDATE SET
                name = EXCLUDED.name,
                avatar_url = EXCLUDED.avatar_url,
                description = EXCLUDED.description,
                status = EXCLUDED.status,
                source_platform = EXCLUDED.source_platform,
                external_shop_id = EXCLUDED.external_shop_id
            RETURNING id
            `,
            [
                shop.name,
                shop.slug,
                shop.avatarUrl,
                shop.description,
                shop.status,
                shop.sourcePlatform,
                shop.externalId,
            ],
        );
        return this.firstId(result, 'shop');
    }

    // Upsert product theo source_platform + external_product_id để chống trùng mạnh hơn slug.
    private async upsertProduct(
        graph: ImportProductGraph,
        shopId: string | null,
        categoryId: string | null,
        brandId: string | null,
    ): Promise<string> {
        const prices = graph.variants.map((variant) => variant.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const product = graph.product;
        const result = await this.db.query<{ id: string }>(
            `
            INSERT INTO products (
                shop_id, category_id, brand_id, name, slug, description,
                short_description, status, min_price, max_price, total_sold,
                rating_avg, review_count, view_count, source_platform,
                external_product_id, source_url
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17
            )
            ON CONFLICT (source_platform, external_product_id)
            DO UPDATE SET
                shop_id = EXCLUDED.shop_id,
                category_id = EXCLUDED.category_id,
                brand_id = EXCLUDED.brand_id,
                name = EXCLUDED.name,
                slug = EXCLUDED.slug,
                description = EXCLUDED.description,
                short_description = EXCLUDED.short_description,
                status = EXCLUDED.status,
                min_price = EXCLUDED.min_price,
                max_price = EXCLUDED.max_price,
                total_sold = EXCLUDED.total_sold,
                rating_avg = EXCLUDED.rating_avg,
                review_count = EXCLUDED.review_count,
                view_count = EXCLUDED.view_count,
                source_url = EXCLUDED.source_url,
                updated_at = NOW()
            RETURNING id
            `,
            [
                shopId,
                categoryId,
                brandId,
                product.name,
                product.slug,
                product.description,
                product.shortDescription,
                product.status,
                minPrice,
                maxPrice,
                product.totalSold,
                product.ratingAverage,
                product.reviewCount,
                product.viewCount,
                product.sourcePlatform,
                product.externalId,
                product.sourceUrl,
            ],
        );
        return this.firstId(result, 'product');
    }

    // Upsert ảnh sản phẩm theo product_id + image_url, ảnh đầu tiên được đánh thumbnail.
    private async upsertImages(
        productId: string,
        images: ImportProductImage[],
        variantIds: Map<string, string>,
    ): Promise<void> {
        for (const image of images) {
            const variantId = image.variantExternalId
                ? variantIds.get(image.variantExternalId) ?? null
                : null;
            await this.db.query(
                `
                INSERT INTO product_images (
                    product_id, variant_id, image_url, alt_text,
                    sort_order, is_thumbnail, external_image_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (product_id, image_url)
                DO UPDATE SET
                    variant_id = EXCLUDED.variant_id,
                    alt_text = EXCLUDED.alt_text,
                    sort_order = EXCLUDED.sort_order,
                    is_thumbnail = EXCLUDED.is_thumbnail
                `,
                [
                    productId,
                    variantId,
                    image.imageUrl,
                    image.altText,
                    image.sortOrder,
                    image.isThumbnail,
                    image.externalId,
                ],
            );
        }
    }

    // Upsert option và value, trả map optionName::value sang id để link với variants.
    private async upsertOptions(
        productId: string,
        options: ImportProductOption[],
    ): Promise<Map<string, string>> {
        const optionValueIds = new Map<string, string>();

        for (const option of options) {
            const optionResult = await this.db.query<{ id: string }>(
                `
                INSERT INTO product_options (product_id, name, position)
                VALUES ($1, $2, $3)
                ON CONFLICT (product_id, name)
                DO UPDATE SET position = EXCLUDED.position
                RETURNING id
                `,
                [productId, option.name, option.position],
            );
            const optionId = this.firstId(optionResult, 'product option');

            for (const value of option.values) {
                const valueResult = await this.db.query<{ id: string }>(
                    `
                    INSERT INTO product_option_values (option_id, value, position)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (option_id, value)
                    DO UPDATE SET position = EXCLUDED.position
                    RETURNING id
                    `,
                    [optionId, value.value, value.position],
                );
                optionValueIds.set(
                    this.optionValueKey(option.name, value.value),
                    this.firstId(valueResult, 'product option value'),
                );
            }
        }

        return optionValueIds;
    }

    // Upsert variants và link variant-option values theo bảng nối.
    private async upsertVariants(
        productId: string,
        variants: ImportProductVariant[],
        optionValueIds: Map<string, string>,
    ): Promise<Map<string, string>> {
        const variantIds = new Map<string, string>();

        for (const variant of variants) {
            const result = await this.db.query<{ id: string }>(
                `
                INSERT INTO product_variants (
                    product_id, sku, name, price, original_price,
                    stock_quantity, weight, status, image_url,
                    external_variant_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (sku)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    price = EXCLUDED.price,
                    original_price = EXCLUDED.original_price,
                    stock_quantity = EXCLUDED.stock_quantity,
                    weight = EXCLUDED.weight,
                    status = EXCLUDED.status,
                    image_url = EXCLUDED.image_url,
                    external_variant_id = EXCLUDED.external_variant_id
                RETURNING id
                `,
                [
                    productId,
                    variant.sku,
                    variant.name,
                    variant.price,
                    variant.originalPrice,
                    variant.stockQuantity,
                    variant.weight,
                    variant.status,
                    variant.imageUrl,
                    variant.externalId,
                ],
            );
            const variantId = this.firstId(result, 'variant');
            variantIds.set(variant.externalId ?? variant.sku, variantId);
            variantIds.set(variant.sku, variantId);

            for (const [optionName, value] of Object.entries(variant.optionValues)) {
                const optionValueId = optionValueIds.get(
                    this.optionValueKey(optionName, value),
                );
                if (!optionValueId) continue;
                await this.db.query(
                    `
                    INSERT INTO product_variant_option_values (
                        variant_id, option_value_id
                    )
                    VALUES ($1, $2)
                    ON CONFLICT (variant_id, option_value_id) DO NOTHING
                    `,
                    [variantId, optionValueId],
                );
            }
        }

        return variantIds;
    }

    // Upsert inventory theo variant sku để đồng bộ tồn kho với variant vừa import.
    private async upsertInventories(
        inventories: ImportInventory[],
        variantIds: Map<string, string>,
    ): Promise<void> {
        for (const inventory of inventories) {
            const variantId = variantIds.get(inventory.variantSku);
            if (!variantId) continue;
            await this.db.query(
                `
                INSERT INTO inventories (
                    variant_id, quantity_available, quantity_reserved,
                    quantity_sold, low_stock_threshold
                )
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (variant_id)
                DO UPDATE SET
                    quantity_available = EXCLUDED.quantity_available,
                    quantity_reserved = EXCLUDED.quantity_reserved,
                    quantity_sold = EXCLUDED.quantity_sold,
                    low_stock_threshold = EXCLUDED.low_stock_threshold
                `,
                [
                    variantId,
                    inventory.quantityAvailable,
                    inventory.quantityReserved,
                    inventory.quantitySold,
                    inventory.lowStockThreshold,
                ],
            );
        }
    }

    // Upsert attributes theo category + slug rồi ghi product_attribute_values cho product.
    private async upsertAttributes(
        productId: string,
        categoryId: string | null,
        attributes: ImportAttribute[],
    ): Promise<void> {
        if (!categoryId) return;

        for (const attribute of attributes) {
            const attrResult = await this.db.query<{ id: string }>(
                `
                INSERT INTO attributes (
                    category_id, name, slug, data_type, unit,
                    is_filterable, is_required, external_attribute_id
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (category_id, slug)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    data_type = EXCLUDED.data_type,
                    unit = EXCLUDED.unit,
                    is_filterable = EXCLUDED.is_filterable,
                    is_required = EXCLUDED.is_required,
                    external_attribute_id = EXCLUDED.external_attribute_id
                RETURNING id
                `,
                [
                    categoryId,
                    attribute.name,
                    attribute.slug,
                    attribute.dataType,
                    attribute.unit,
                    attribute.isFilterable,
                    attribute.isRequired,
                    attribute.externalId,
                ],
            );
            const attributeId = this.firstId(attrResult, 'attribute');

            await this.db.query(
                `
                INSERT INTO product_attribute_values (
                    product_id, attribute_id, value_text,
                    value_number, value_boolean
                )
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (product_id, attribute_id)
                DO UPDATE SET
                    value_text = EXCLUDED.value_text,
                    value_number = EXCLUDED.value_number,
                    value_boolean = EXCLUDED.value_boolean
                `,
                [
                    productId,
                    attributeId,
                    attribute.valueText,
                    attribute.valueNumber,
                    attribute.valueBoolean,
                ],
            );
        }
    }

    // Upsert reviews nếu source public cho phép lấy review.
    private async upsertReviews(
        productId: string,
        reviews: ImportReview[],
        variantIds: Map<string, string>,
    ): Promise<void> {
        for (const review of reviews) {
            const variantId = review.variantExternalId
                ? variantIds.get(review.variantExternalId) ?? null
                : null;
            await this.db.query(
                `
                INSERT INTO reviews (
                    user_id, product_id, variant_id, rating, content,
                    images, status, created_at, source_platform,
                    external_review_id
                )
                VALUES (NULL, $1, $2, $3, $4, $5::jsonb, $6, $7, 'tiki', $8)
                ON CONFLICT (source_platform, external_review_id)
                DO UPDATE SET
                    rating = EXCLUDED.rating,
                    content = EXCLUDED.content,
                    images = EXCLUDED.images,
                    status = EXCLUDED.status
                `,
                [
                    productId,
                    variantId,
                    review.rating,
                    review.content,
                    JSON.stringify(review.images),
                    review.status,
                    review.createdAt,
                    review.externalId,
                ],
            );
        }
    }

    // Tạo key ổn định để map option value từ variant sang product_option_values.
    private optionValueKey(optionName: string, value: string): string {
        return `${optionName}::${value}`;
    }

    // Lấy id đầu tiên từ RETURNING, ném lỗi rõ ràng nếu query không trả id.
    private firstId(result: QueryResult<{ id: string }>, entityName: string): string {
        const id = result.rows[0]?.id;
        if (!id) throw new Error(`Missing id after upserting ${entityName}`);
        return id;
    }
}

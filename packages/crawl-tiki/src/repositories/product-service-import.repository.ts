import type { ImportProductGraph } from '../types/import-product.type';
import { slugify } from '../utils/slug';
import type { DatabaseExecutor } from './postgres-product-import.repository';
import type {
    ProductImportRepository,
    ProductImportResult,
} from './product-import.repository';

interface CategoryCandidate {
    id: string;
    name: string;
    slug: string;
    path: string | null;
    is_leaf: boolean;
}

export class ProductServiceImportRepository implements ProductImportRepository {
    constructor(
        private readonly productDb: DatabaseExecutor,
        private readonly catalogDb: DatabaseExecutor,
    ) {}

    // Import product crawl vào product-service; category chỉ được resolve từ catalog DB có sẵn, tuyệt đối không tạo category mới.
    async upsertProductGraph(
        graph: ImportProductGraph,
    ): Promise<ProductImportResult> {
        const categoryId = await this.resolveInternalCategoryId(graph);
        if (!categoryId) {
            return { productId: '', insertedOrUpdated: false };
        }

        await this.productDb.query('BEGIN');
        try {
            const externalShopId = graph.shop
                ? await this.upsertExternalShop(graph)
                : null;
            const brandId = graph.brand ? await this.upsertBrand(graph) : null;
            const productId = await this.upsertProduct(
                graph,
                categoryId,
                brandId,
                externalShopId,
            );
            const optionValueIds = await this.upsertOptions(productId, graph);
            const variantIds = await this.upsertVariants(
                productId,
                graph,
                optionValueIds,
            );

            await this.upsertImages(productId, graph, variantIds);
            await this.upsertInventories(graph, variantIds);
            await this.upsertAttributeValues(productId, categoryId, graph);
            await this.upsertReviews(productId, graph, variantIds);
            await this.productDb.query('COMMIT');

            return { productId, insertedOrUpdated: true };
        } catch (error) {
            await this.productDb.query('ROLLBACK');
            throw error;
        }
    }

    // Match breadcrumb Tiki với category nội bộ theo tên, ưu tiên leaf category vì product phải gắn vào node bán hàng cuối cùng.
    private async resolveInternalCategoryId(
        graph: ImportProductGraph,
    ): Promise<string | null> {
        const names = [...graph.categoryChain]
            .reverse()
            .map((category) => category.name.trim())
            .filter(Boolean);

        for (const name of names) {
            const result = await this.catalogDb.query<CategoryCandidate>(
                `
                SELECT id, name, slug, path, is_leaf
                FROM categories
                WHERE is_active = true
                  AND lower(name) = lower($1)
                ORDER BY is_leaf DESC, level DESC, sort_order ASC
                LIMIT 1
                `,
                [name],
            );

            const category = result.rows[0];
            if (category) return category.id;
        }

        const fallback = await this.findCategoryByNormalizedName(names);
        if (fallback) return fallback.id;

        const sourceFallback = await this.findSourceRootFallbackCategory(graph);
        if (sourceFallback) return sourceFallback;

        const sourceAliasFallback =
            await this.findSourceRootAliasCategory(graph);
        if (sourceAliasFallback) return sourceAliasFallback;

        return this.findLaptopFallbackCategory(graph);
    }

    // Fallback dùng slug không dấu để xử lý trường hợp Tiki và catalog khác nhau dấu câu hoặc hậu tố id.
    private async findCategoryByNormalizedName(
        names: string[],
    ): Promise<CategoryCandidate | null> {
        const normalizedNames = names.map((name) => slugify(name));
        if (normalizedNames.length === 0) return null;

        const result = await this.catalogDb.query<CategoryCandidate>(
            `
            SELECT id, name, slug, path, is_leaf
            FROM categories
            WHERE is_active = true
              AND regexp_replace(slug, '-[0-9]+$', '') = ANY($1::text[])
            ORDER BY is_leaf DESC, level DESC, sort_order ASC
            LIMIT 1
            `,
            [normalizedNames],
        );

        return result.rows[0] ?? null;
    }

    // Map source root "nha sach" ve category Sach da co trong catalog khi breadcrumb chi tiet khac ten.
    // Fallback nay chi doc catalog va khong tao/chinh sua master data cua catalog-service.
    private async findSourceRootFallbackCategory(
        graph: ImportProductGraph,
    ): Promise<string | null> {
        const rootCategory = graph.categoryChain.at(0);
        if (!rootCategory?.slug.toLowerCase().includes('nha-sach')) {
            return null;
        }

        const result = await this.catalogDb.query<{ id: string }>(
            `
            SELECT id
            FROM categories
            WHERE is_active = true
              AND level = 1
              AND lower(slug) LIKE 'sach-%'
            ORDER BY is_leaf DESC, sort_order ASC
            LIMIT 1
            `,
        );

        return result.rows[0]?.id ?? null;
    }

    // Ánh xạ root taxonomy của nguồn về nhóm cấp cao đã có trong catalog khi tên danh mục chi tiết không đồng nhất.
    // Fallback chỉ đọc category hiện hữu, giúp dữ liệu crawl vẫn import được mà không làm phình master data catalog.
    private async findSourceRootAliasCategory(
        graph: ImportProductGraph,
    ): Promise<string | null> {
        const sourceRoot = graph.categoryChain.at(0)?.name.toLowerCase() ?? '';
        const productText = graph.product.name.toLowerCase();
        const targetName = this.resolveSourceRootAlias(
            sourceRoot,
            productText,
        );
        if (!targetName) return null;

        const result = await this.catalogDb.query<{ id: string }>(
            `
            SELECT id
            FROM categories
            WHERE is_active = true
              AND level = 0
              AND lower(name) = lower($1)
            LIMIT 1
            `,
            [targetName],
        );

        if (result.rows[0]?.id) return result.rows[0].id;

        // Một vài nhóm dùng chung như "Khác" nằm ở level khác trong catalog nên vẫn cần resolve theo tên.
        const fallbackResult = await this.catalogDb.query<{ id: string }>(
            `
            SELECT id
            FROM categories
            WHERE is_active = true
              AND lower(name) = lower($1)
            ORDER BY level ASC, sort_order ASC
            LIMIT 1
            `,
            [targetName],
        );

        return fallbackResult.rows[0]?.id ?? null;
    }

    // Chọn nhóm catalog gần nhất theo root nguồn và tên sản phẩm để giữ phân loại đủ đúng khi hai taxonomy khác nhau.
    private resolveSourceRootAlias(
        sourceRoot: string,
        productText: string,
    ): string | null {
        if (sourceRoot.includes('balo và vali')) return 'Du lịch & Hành lý';
        if (sourceRoot.includes('túi thời trang nam')) return 'Túi Ví Nam';
        if (sourceRoot.includes('túi thời trang nữ')) return 'Túi Ví Nữ';
        if (sourceRoot.includes('thời trang nam')) return 'Thời Trang Nam';
        if (sourceRoot.includes('thời trang nữ')) return 'Thời Trang Nữ';
        if (sourceRoot.includes('giày - dép nam')) return 'Giày Dép Nam';
        if (sourceRoot.includes('giày - dép nữ')) return 'Giày Dép Nữ';
        if (sourceRoot.includes('đồng hồ và trang sức')) return 'Đồng Hồ';
        if (sourceRoot.includes('chăm sóc nhà cửa')) {
            return 'Nhà cửa & Đời sống';
        }
        if (sourceRoot.includes('máy ảnh - máy quay phim')) {
            return 'Cameras & Flycam';
        }
        if (sourceRoot.includes('điện gia dụng')) {
            return 'Thiết Bị Điện Gia Dụng';
        }
        if (sourceRoot.includes('điện tử - điện lạnh')) {
            return 'Thiết Bị Điện Gia Dụng';
        }
        if (
            sourceRoot.includes('điện thoại - máy tính bảng') ||
            sourceRoot.includes('thiết bị số - phụ kiện số')
        ) {
            return 'Điện Thoại & Phụ Kiện';
        }
        if (sourceRoot.includes('cross border') && productText.includes('sữa')) {
            return 'Mẹ & Bé';
        }
        if (sourceRoot.includes('làm đẹp - sức khỏe')) {
            const beautyKeywords = [
                'mỹ phẩm',
                'kem',
                'serum',
                'son ',
                'nước hoa',
                'dầu gội',
            ];
            return beautyKeywords.some((keyword) =>
                productText.includes(keyword),
            )
                ? 'Sắc Đẹp'
                : 'Sức Khỏe';
        }
        if (sourceRoot.includes('ô tô - xe máy - xe đạp')) {
            return productText.includes('ô tô') ||
                productText.includes('honda')
                ? 'Ô tô'
                : 'Mô tô, xe máy';
        }
        if (sourceRoot.includes('voucher - dịch vụ')) return 'Khác';
        if (sourceRoot.includes('sách')) return 'Sách & Tạp Chí';

        return null;
    }

    // Fallback riêng cho batch laptop: nếu nguồn crawl có chữ laptop nhưng taxonomy chi tiết không khớp, gắn vào category Laptop có sẵn.
    private async findLaptopFallbackCategory(
        graph: ImportProductGraph,
    ): Promise<string | null> {
        const searchableText = [
            graph.product.name,
            graph.product.slug,
            ...graph.categoryChain.flatMap((category) => [
                category.name,
                category.slug,
            ]),
        ]
            .join(' ')
            .toLowerCase();

        if (!searchableText.includes('laptop')) return null;

        const result = await this.catalogDb.query<{ id: string }>(
            `
            SELECT id
            FROM categories
            WHERE is_active = true
              AND lower(name) = 'laptop'
            ORDER BY is_leaf DESC, level DESC, sort_order ASC
            LIMIT 1
            `,
        );

        return result.rows[0]?.id ?? null;
    }

    // Lưu shop từ nguồn ngoài để product crawl vẫn có thông tin người bán mà không cần tạo seller nội bộ.
    private async upsertExternalShop(
        graph: ImportProductGraph,
    ): Promise<string> {
        const shop = graph.shop;
        if (!shop?.externalId) {
            throw new Error('External shop id is required for crawled shop');
        }

        const result = await this.productDb.query<{ id: string }>(
            `
            INSERT INTO external_shops (
                source_platform, external_shop_id, name, slug, avatar_url,
                description, source_url, rating_avg, review_count,
                follower_count, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb)
            ON CONFLICT (source_platform, external_shop_id)
            DO UPDATE SET
                name = EXCLUDED.name,
                slug = EXCLUDED.slug,
                avatar_url = EXCLUDED.avatar_url,
                description = EXCLUDED.description,
                source_url = EXCLUDED.source_url,
                rating_avg = EXCLUDED.rating_avg,
                review_count = EXCLUDED.review_count,
                follower_count = EXCLUDED.follower_count,
                updated_at = NOW()
            RETURNING id
            `,
            [
                shop.sourcePlatform,
                shop.externalId,
                shop.name,
                shop.slug,
                shop.avatarUrl,
                shop.description,
                shop.sourceUrl,
                shop.ratingAverage,
                shop.reviewCount,
                shop.followerCount,
            ],
        );

        return this.firstId(result, 'external shop');
    }

    // Brand dùng slug làm khóa chống trùng vì nhiều nguồn có thể cùng trả về một thương hiệu phổ biến.
    private async upsertBrand(graph: ImportProductGraph): Promise<string> {
        const brand = graph.brand;
        if (!brand) throw new Error('Brand is required');

        const result = await this.productDb.query<{ id: string }>(
            `
            INSERT INTO brands (
                source_platform, external_brand_id, name, slug,
                normalized_name, logo_url, description, is_active
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (slug)
            DO UPDATE SET
                name = EXCLUDED.name,
                normalized_name = EXCLUDED.normalized_name,
                source_platform = COALESCE(brands.source_platform, EXCLUDED.source_platform),
                external_brand_id = COALESCE(brands.external_brand_id, EXCLUDED.external_brand_id),
                logo_url = COALESCE(EXCLUDED.logo_url, brands.logo_url),
                description = COALESCE(EXCLUDED.description, brands.description),
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
            RETURNING id
            `,
            [
                brand.sourcePlatform,
                brand.externalId,
                brand.name,
                brand.slug,
                slugify(brand.name).replace(/-/g, ' '),
                brand.logoUrl,
                brand.description,
                brand.isActive,
            ],
        );

        return this.firstId(result, 'brand');
    }

    // Product external gắn category nội bộ đã resolve và shop external đã upsert, giúp listing đọc một schema thống nhất.
    private async upsertProduct(
        graph: ImportProductGraph,
        categoryId: string,
        brandId: string | null,
        externalShopId: string | null,
    ): Promise<string> {
        const prices = graph.variants.map((variant) => variant.price);
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const maxPrice = prices.length ? Math.max(...prices) : 0;

        const result = await this.productDb.query<{ id: string }>(
            `
            INSERT INTO products (
                origin_type, seller_shop_id, external_shop_id, category_id,
                brand_id, name, slug, description, short_description, status,
                min_price, max_price, total_sold, rating_avg, review_count,
                view_count, source_platform, external_product_id, source_url,
                metadata
            )
            VALUES (
                'EXTERNAL', NULL, $1, $2, $3, $4, $5, $6, $7, 'ACTIVE',
                $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
            )
            ON CONFLICT (source_platform, external_product_id)
            WHERE source_platform IS NOT NULL AND external_product_id IS NOT NULL
            DO UPDATE SET
                external_shop_id = EXCLUDED.external_shop_id,
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
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            RETURNING id
            `,
            [
                externalShopId,
                categoryId,
                brandId,
                graph.product.name,
                graph.product.slug,
                graph.product.description,
                graph.product.shortDescription,
                minPrice,
                maxPrice,
                graph.product.totalSold,
                graph.product.ratingAverage,
                graph.product.reviewCount,
                graph.product.viewCount,
                graph.product.sourcePlatform,
                graph.product.externalId,
                graph.product.sourceUrl,
                JSON.stringify({
                    sourceCategoryChain: graph.categoryChain,
                    rawAttributeCount: graph.attributes.length,
                }),
            ],
        );

        return this.firstId(result, 'product');
    }

    // Tách option/value trước để mỗi variant chỉ cần link tới lựa chọn chuẩn, không lặp chữ Màu sắc/Dung lượng nhiều lần.
    private async upsertOptions(
        productId: string,
        graph: ImportProductGraph,
    ): Promise<Map<string, string>> {
        const optionValueIds = new Map<string, string>();

        for (const option of graph.options) {
            const optionResult = await this.productDb.query<{ id: string }>(
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
                const valueResult = await this.productDb.query<{ id: string }>(
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
                    `${option.name}:${value.value}`,
                    this.firstId(valueResult, 'product option value'),
                );
            }
        }

        return optionValueIds;
    }

    // Product không có phân loại vẫn có một default variant để các luồng giá, kho, giỏ hàng dùng chung một chuẩn.
    private async upsertVariants(
        productId: string,
        graph: ImportProductGraph,
        optionValueIds: Map<string, string>,
    ): Promise<Map<string, string>> {
        const variantIds = new Map<string, string>();

        for (const variant of graph.variants) {
            const result = await this.productDb.query<{ id: string }>(
                `
                INSERT INTO product_variants (
                    product_id, sku, name, price, original_price,
                    stock_quantity, weight, status, image_url, external_variant_id
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
                    external_variant_id = EXCLUDED.external_variant_id,
                    updated_at = NOW()
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
                    variant.status.toUpperCase(),
                    variant.imageUrl,
                    variant.externalId,
                ],
            );
            const variantId = this.firstId(result, 'variant');
            variantIds.set(variant.externalId ?? variant.sku, variantId);
            variantIds.set(variant.sku, variantId);

            await this.productDb.query(
                'DELETE FROM product_variant_option_values WHERE variant_id = $1',
                [variantId],
            );

            for (const [optionName, value] of Object.entries(
                variant.optionValues,
            )) {
                const optionValueId = optionValueIds.get(`${optionName}:${value}`);
                if (!optionValueId) continue;

                await this.productDb.query(
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

    // Ảnh được upsert sau variant để có thể gắn variant_id khi nguồn crawl trả ảnh theo SKU.
    private async upsertImages(
        productId: string,
        graph: ImportProductGraph,
        variantIds: Map<string, string>,
    ): Promise<void> {
        for (const image of graph.images) {
            const variantId = image.variantExternalId
                ? variantIds.get(image.variantExternalId) ?? null
                : null;

            await this.productDb.query(
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
                    is_thumbnail = EXCLUDED.is_thumbnail,
                    external_image_id = EXCLUDED.external_image_id
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

    // Inventory tách khỏi variant để sau này đặt hàng có thể reserve/sold mà không sửa trực tiếp metadata sản phẩm.
    private async upsertInventories(
        graph: ImportProductGraph,
        variantIds: Map<string, string>,
    ): Promise<void> {
        for (const inventory of graph.inventories) {
            const variantId = variantIds.get(inventory.variantSku);
            if (!variantId) continue;

            await this.productDb.query(
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
                    low_stock_threshold = EXCLUDED.low_stock_threshold,
                    updated_at = NOW()
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

    // Attribute crawl chỉ map vào attribute đã có của catalog; không tạo attribute mới để tránh làm rác taxonomy.
    private async upsertAttributeValues(
        productId: string,
        categoryId: string,
        graph: ImportProductGraph,
    ): Promise<void> {
        for (const attribute of graph.attributes) {
            const attributeId = await this.resolveCategoryAttributeId(
                categoryId,
                attribute.name,
            );
            if (!attributeId) continue;

            await this.productDb.query(
                `
                INSERT INTO product_attribute_values (
                    product_id, category_attribute_id, value_text,
                    value_number, value_boolean, metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (product_id, category_attribute_id)
                DO UPDATE SET
                    value_text = EXCLUDED.value_text,
                    value_number = EXCLUDED.value_number,
                    value_boolean = EXCLUDED.value_boolean,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                `,
                [
                    productId,
                    attributeId,
                    attribute.valueText,
                    attribute.valueNumber,
                    attribute.valueBoolean,
                    JSON.stringify({
                        sourceAttributeId: attribute.externalId,
                        sourceName: attribute.name,
                    }),
                ],
            );
        }
    }

    // Tìm attribute theo slug hoặc tên hiển thị trong đúng category đã match cho product.
    private async resolveCategoryAttributeId(
        categoryId: string,
        attributeName: string,
    ): Promise<string | null> {
        const normalized = slugify(attributeName);
        const result = await this.catalogDb.query<{ id: string }>(
            `
            SELECT id
            FROM category_attributes
            WHERE category_id = $1
              AND (
                slug = $2
                OR lower(display_name) = lower($3)
                OR lower(name) = lower($3)
              )
            LIMIT 1
            `,
            [categoryId, normalized, attributeName],
        );

        return result.rows[0]?.id ?? null;
    }

    // Review public nếu có thì lưu theo external_review_id để chạy lại crawler không bị trùng review.
    private async upsertReviews(
        productId: string,
        graph: ImportProductGraph,
        variantIds: Map<string, string>,
    ): Promise<void> {
        for (const review of graph.reviews) {
            const variantId = review.variantExternalId
                ? variantIds.get(review.variantExternalId) ?? null
                : null;

            await this.productDb.query(
                `
                INSERT INTO product_reviews (
                    user_id, product_id, variant_id, rating, content,
                    images, status, source_platform, external_review_id,
                    created_at
                )
                VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (source_platform, external_review_id)
                WHERE source_platform IS NOT NULL AND external_review_id IS NOT NULL
                DO UPDATE SET
                    rating = EXCLUDED.rating,
                    content = EXCLUDED.content,
                    images = EXCLUDED.images,
                    status = EXCLUDED.status,
                    updated_at = NOW()
                `,
                [
                    productId,
                    variantId,
                    review.rating,
                    review.content,
                    JSON.stringify(review.images),
                    review.status,
                    graph.product.sourcePlatform,
                    review.externalId,
                    review.createdAt,
                ],
            );
        }
    }

    // Helper gom xử lý lỗi thiếu RETURNING id để từng hàm upsert không phải lặp cùng một đoạn kiểm tra.
    private firstId(
        result: { rows: Array<{ id: string }> },
        entityName: string,
    ): string {
        const id = result.rows[0]?.id;
        if (!id) throw new Error(`Missing id after upserting ${entityName}`);
        return id;
    }
}

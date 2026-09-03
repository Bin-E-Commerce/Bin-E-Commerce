import type {
    ImportAttribute,
    ImportInventory,
    ImportProductGraph,
    ImportProductImage,
    ImportProductOption,
    ImportProductVariant,
} from '../types/import-product.type';
import type {
    SourceProductDetail,
    SourceProductVariant,
} from '../types/source-product.type';
import { slugify, sourceSlug } from '../utils/slug';
import { toNullableNumber } from '../utils/number';

export class ProductMapper {
    // Map product detail đã chuẩn hóa từ source adapter sang graph đủ để upsert vào các bảng e-commerce.
    mapToImportGraph(source: SourceProductDetail): ImportProductGraph {
        const variants = this.mapVariants(source);
        const minPrice = Math.min(...variants.map((variant) => variant.price));
        const maxPrice = Math.max(...variants.map((variant) => variant.price));
        const productSlug = source.slug ?? sourceSlug(source.name, source.externalId);

        return {
            categoryChain: source.categories.map((category, index) => ({
                externalId: category.externalId,
                sourcePlatform: source.platform,
                sourceUrl: category.sourceUrl ?? null,
                parentExternalId: category.parentExternalId ?? null,
                name: category.name,
                slug: category.slug ?? sourceSlug(category.name, category.externalId),
                level: category.level,
                sortOrder: category.sortOrder ?? index,
                isActive: true,
            })),
            brand: source.brand
                ? {
                      externalId: source.brand.externalId ?? null,
                      sourcePlatform: source.platform,
                      name: source.brand.name,
                      slug:
                          source.brand.slug ??
                          sourceSlug(source.brand.name, source.brand.externalId),
                      logoUrl: source.brand.logoUrl ?? null,
                      description: source.brand.description ?? null,
                      isActive: true,
                  }
                : null,
            shop: source.shop
                ? {
                      externalId: source.shop.externalId ?? null,
                      sourcePlatform: source.platform,
                      name: source.shop.name,
                      slug:
                          source.shop.slug ??
                          sourceSlug(source.shop.name, source.shop.externalId),
                      avatarUrl: source.shop.avatarUrl ?? null,
                      description: source.shop.description ?? null,
                      sourceUrl: source.shop.sourceUrl ?? null,
                      ratingAverage: source.shop.ratingAverage ?? null,
                      reviewCount: source.shop.reviewCount ?? 0,
                      followerCount: source.shop.followerCount ?? 0,
                      status: 'active',
                  }
                : null,
            product: {
                externalId: source.externalId,
                sourcePlatform: source.platform,
                sourceUrl: source.sourceUrl,
                name: source.name,
                slug: productSlug,
                description: source.description ?? null,
                shortDescription: source.shortDescription ?? null,
                status: 'active',
                totalSold: source.totalSold ?? this.sumSoldFromVariants(variants),
                ratingAverage: source.ratingAverage ?? null,
                reviewCount: source.reviewCount ?? source.reviews.length,
                viewCount: source.viewCount ?? 0,
            },
            images: this.mapImages(source),
            options: this.mapOptions(source),
            variants,
            inventories: this.mapInventories(variants),
            attributes: this.mapAttributes(source),
            reviews: source.reviews.map((review) => ({
                externalId: review.externalId,
                rating: review.rating,
                content: review.content,
                images: review.images,
                status: 'approved',
                createdAt: review.createdAt,
                variantExternalId: null,
            })),
        };
    }

    // Map ảnh product, ảnh đầu tiên luôn là thumbnail chính để UI và import catalog có ảnh đại diện.
    private mapImages(source: SourceProductDetail): ImportProductImage[] {
        return source.images.map((image, index) => ({
            externalId: `${source.externalId}-image-${index}`,
            imageUrl: image.url,
            altText: image.altText ?? source.name,
            sortOrder: index,
            isThumbnail: index === 0,
            variantExternalId: null,
        }));
    }

    // Map option như màu sắc/size/dung lượng và giữ position để tái tạo thứ tự chọn phân loại.
    private mapOptions(source: SourceProductDetail): ImportProductOption[] {
        return source.options.map((option, index) => ({
            name: option.name,
            position: index,
            values: option.values.map((value, valueIndex) => ({
                value,
                position: valueIndex,
            })),
        }));
    }

    // Map variants; nếu source không có variant thì tạo default variant theo rule nghiệp vụ.
    private mapVariants(source: SourceProductDetail): ImportProductVariant[] {
        const variants =
            source.variants.length > 0
                ? source.variants
                : [this.createDefaultSourceVariant(source)];

        return variants.map((variant, index) => ({
            externalId: variant.externalId ?? `${source.externalId}-${index}`,
            sku:
                variant.sku ??
                `${source.platform}-${source.externalId}-${index + 1}`,
            name: variant.name ?? source.name,
            price: Math.max(0, variant.price),
            originalPrice: variant.originalPrice ?? null,
            stockQuantity: variant.stockQuantity ?? 0,
            weight: variant.weight ?? null,
            status: variant.price > 0 ? 'active' : 'inactive',
            imageUrl: variant.imageUrl ?? source.images[0]?.url ?? null,
            optionValues: variant.optionValues,
        }));
    }

    // Tạo default source variant khi product không có phân loại, đảm bảo bảng variants luôn có dòng bán hàng.
    private createDefaultSourceVariant(
        source: SourceProductDetail,
    ): SourceProductVariant {
        return {
            externalId: source.externalId,
            sku: source.sku ?? `${source.platform}-${source.externalId}`,
            name: source.name,
            price: 0,
            originalPrice: null,
            stockQuantity: 0,
            weight: null,
            imageUrl: source.images[0]?.url ?? null,
            optionValues: {},
        };
    }

    // Tạo inventory tương ứng mỗi variant để tách tồn kho khỏi thông tin bán hàng.
    private mapInventories(variants: ImportProductVariant[]): ImportInventory[] {
        return variants.map((variant) => ({
            variantSku: variant.sku,
            quantityAvailable: variant.stockQuantity,
            quantityReserved: 0,
            quantitySold: 0,
            lowStockThreshold: 5,
        }));
    }

    // Map thông số kỹ thuật thành attributes và product_attribute_values.
    private mapAttributes(source: SourceProductDetail): ImportAttribute[] {
        return source.attributes.map((attribute) => {
            const numberValue = toNullableNumber(attribute.value);
            const booleanValue = this.parseBoolean(attribute.value);
            const dataType =
                attribute.dataType ??
                (booleanValue !== null
                    ? 'boolean'
                    : numberValue !== null
                      ? 'number'
                      : 'text');

            return {
                externalId: `${source.platform}-${slugify(attribute.name)}`,
                name: attribute.name,
                slug: slugify(attribute.name),
                dataType,
                unit: attribute.unit ?? null,
                isFilterable: attribute.isFilterable ?? true,
                isRequired: false,
                valueText: dataType === 'text' ? attribute.value : null,
                valueNumber: dataType === 'number' ? numberValue : null,
                valueBoolean: dataType === 'boolean' ? booleanValue : null,
            };
        });
    }

    // Chuyển chuỗi boolean phổ biến về boolean thật để lưu đúng data_type.
    private parseBoolean(value: string): boolean | null {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'có'].includes(normalized)) return true;
        if (['false', 'no', 'không'].includes(normalized)) return false;
        return null;
    }

    // Tổng sold từ variant nếu source không có total_sold ở cấp product.
    private sumSoldFromVariants(_variants: ImportProductVariant[]): number {
        return 0;
    }
}

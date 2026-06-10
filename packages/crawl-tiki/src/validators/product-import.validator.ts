import type { ImportProductGraph } from '../types/import-product.type';

export interface ProductValidationResult {
    valid: boolean;
    reasons: string[];
}

// Kiểm tra dữ liệu bắt buộc trước khi insert để tránh ghi product rác vào database.
export function validateProductGraph(
    graph: ImportProductGraph,
): ProductValidationResult {
    const reasons: string[] = [];

    if (!graph.product.externalId) reasons.push('missing external product id');
    if (!graph.product.name.trim()) reasons.push('missing product name');
    if (!graph.product.slug.trim()) reasons.push('missing product slug');
    if (graph.variants.length === 0) reasons.push('missing product variant');
    if (graph.variants.some((variant) => variant.price < 0)) {
        reasons.push('variant price must be non-negative');
    }
    if (graph.variants.some((variant) => !variant.sku.trim())) {
        reasons.push('missing variant sku');
    }

    return {
        valid: reasons.length === 0,
        reasons,
    };
}

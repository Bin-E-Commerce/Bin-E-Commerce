import type { ImportProductGraph } from '../types/import-product.type';

export interface ProductImportResult {
    productId: string;
    insertedOrUpdated: boolean;
}

export interface ProductImportRepository {
    upsertProductGraph(graph: ImportProductGraph): Promise<ProductImportResult>;
}

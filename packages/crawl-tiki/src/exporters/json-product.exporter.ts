import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ImportProductGraph } from '../types/import-product.type';

// Ghi danh sách sản phẩm đã crawl ra JSON, tự tạo thư mục output nếu chưa tồn tại.
export async function writeProductsToJson(
    products: ImportProductGraph[],
    outputFile: string,
): Promise<string> {
    const absolutePath = resolve(outputFile);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${JSON.stringify(products, null, 2)}\n`, {
        encoding: 'utf8',
    });
    return absolutePath;
}

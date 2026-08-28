import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
    BrandCrawlCatalog,
    BrandCrawlQualityReport,
} from '../types/brand-catalog.type';

// Ghi catalog và quality report thành hai file riêng để dữ liệu hợp lệ không bị trộn với hàng chờ kiểm duyệt.
export async function writeBrandCrawlOutput(
    catalog: BrandCrawlCatalog,
    report: BrandCrawlQualityReport,
    outputFile: string,
    reportFile: string,
): Promise<{ outputPath: string; reportPath: string }> {
    const outputPath = resolve(outputFile);
    const reportPath = resolve(reportFile);
    await Promise.all([
        mkdir(dirname(outputPath), { recursive: true }),
        mkdir(dirname(reportPath), { recursive: true }),
    ]);
    await Promise.all([
        writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8'),
        writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    ]);

    return { outputPath, reportPath };
}

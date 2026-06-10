import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CheckpointStore, CrawlCheckpoint } from './checkpoint.store';

export class FileCheckpointStore implements CheckpointStore {
    constructor(private readonly filePath = 'data/tiki-checkpoint.json') {}

    // Đọc checkpoint gần nhất để crawler có thể chạy tiếp sau khi bị dừng giữa chừng.
    async load(): Promise<CrawlCheckpoint | null> {
        try {
            const content = await readFile(resolve(this.filePath), 'utf8');
            return JSON.parse(content) as CrawlCheckpoint;
        } catch {
            return null;
        }
    }

    // Lưu checkpoint sau mỗi product/page để giảm lượng dữ liệu phải crawl lại khi job lỗi.
    async save(checkpoint: CrawlCheckpoint): Promise<void> {
        const absolutePath = resolve(this.filePath);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, `${JSON.stringify(checkpoint, null, 2)}\n`, {
            encoding: 'utf8',
        });
    }

    // Xóa checkpoint khi job hoàn tất toàn bộ để lần sau bắt đầu từ đầu.
    async clear(): Promise<void> {
        await rm(resolve(this.filePath), { force: true });
    }
}

import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BrandCrawlCheckpoint } from '../types/brand-crawl-checkpoint.type';

export class FileBrandCheckpointStore {
    constructor(private readonly filePath: string) {}

    // Tạo lock theo PID để chỉ một crawler được phép ghi cùng checkpoint tại một thời điểm.
    async acquireLock(): Promise<void> {
        const lockPath = this.resolveLockPath();
        await mkdir(dirname(lockPath), { recursive: true });

        try {
            await this.createLockFile(lockPath);
        } catch (error) {
            if (!this.isFileExistsError(error)) throw error;

            const ownerPid = await this.readLockOwnerPid(lockPath);
            if (ownerPid !== null && this.isProcessRunning(ownerPid)) {
                throw new Error(
                    `Checkpoint đang được crawler PID ${ownerPid} sử dụng: ${resolve(this.filePath)}.`,
                );
            }

            // Lock không còn process sở hữu được xem là stale và chỉ được thay thế một lần.
            await rm(lockPath, { force: true });
            await this.createLockFile(lockPath);
        }
    }

    // Giải phóng lock trong finally để lần resume tiếp theo không bị chặn sau khi job kết thúc bình thường.
    async releaseLock(): Promise<void> {
        await rm(this.resolveLockPath(), { force: true });
    }

    // Đọc checkpoint đúng schema để job có thể tiếp tục sau khi process bị dừng hoặc request nguồn lỗi tạm thời.
    async load(): Promise<BrandCrawlCheckpoint | null> {
        try {
            const content = await readFile(resolve(this.filePath), 'utf8');
            const checkpoint = JSON.parse(content) as BrandCrawlCheckpoint;
            return checkpoint.schemaVersion === 1 ? checkpoint : null;
        } catch {
            return null;
        }
    }

    // Ghi atomically qua file tạm để tránh checkpoint JSON bị cắt dở nếu process dừng đúng lúc đang ghi.
    async save(checkpoint: BrandCrawlCheckpoint): Promise<void> {
        const absolutePath = resolve(this.filePath);
        const temporaryPath = `${absolutePath}.tmp`;
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(
            temporaryPath,
            `${JSON.stringify(checkpoint, null, 2)}\n`,
            'utf8',
        );
        await rm(absolutePath, { force: true });
        await rename(temporaryPath, absolutePath);
    }

    // Xóa checkpoint sau khi hoàn tất toàn bộ phạm vi crawl để lần chạy mới bắt đầu bằng taxonomy mới nhất.
    async clear(): Promise<void> {
        await rm(resolve(this.filePath), { force: true });
        await rm(`${resolve(this.filePath)}.tmp`, { force: true });
    }

    // Ghi PID và thời điểm bắt đầu để lỗi lock hiển thị đủ thông tin phục vụ vận hành.
    private async createLockFile(lockPath: string): Promise<void> {
        const handle = await open(lockPath, 'wx');
        try {
            await handle.writeFile(
                `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
                'utf8',
            );
        } finally {
            await handle.close();
        }
    }

    // Đọc PID của lock cũ; file hỏng được xem là stale thay vì khóa job vĩnh viễn.
    private async readLockOwnerPid(lockPath: string): Promise<number | null> {
        try {
            const content = await readFile(lockPath, 'utf8');
            const parsed = JSON.parse(content) as { pid?: unknown };
            return typeof parsed.pid === 'number' && Number.isInteger(parsed.pid)
                ? parsed.pid
                : null;
        } catch {
            return null;
        }
    }

    // process.kill(pid, 0) chỉ kiểm tra sự tồn tại của process và không gửi tín hiệu kết thúc.
    private isProcessRunning(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    // Thu hẹp lỗi filesystem theo code để chỉ xử lý riêng trường hợp lock đã tồn tại.
    private isFileExistsError(error: unknown): boolean {
        return (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'EEXIST'
        );
    }

    // Đặt lock cạnh checkpoint để mỗi output scope có khóa độc lập và dễ dọn khi vận hành.
    private resolveLockPath(): string {
        return `${resolve(this.filePath)}.lock`;
    }
}

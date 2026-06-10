export interface CrawlStats {
    crawled: number;
    imported: number;
    skipped: number;
    failed: number;
}

export interface CrawlerLogger {
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    stats(stats: CrawlStats): void;
}

export class ConsoleCrawlerLogger implements CrawlerLogger {
    // Ghi log thông tin ngắn gọn cho từng bước crawl/import.
    info(message: string, meta?: Record<string, unknown>): void {
        console.log(this.format('info', message, meta));
    }

    // Ghi log cảnh báo khi dữ liệu bị skip hoặc nguồn trả thiếu field.
    warn(message: string, meta?: Record<string, unknown>): void {
        console.warn(this.format('warn', message, meta));
    }

    // Ghi log lỗi khi request hoặc import thất bại.
    error(message: string, meta?: Record<string, unknown>): void {
        console.error(this.format('error', message, meta));
    }

    // In thống kê tổng kết để operator biết số lượng thành công/thất bại.
    stats(stats: CrawlStats): void {
        this.info('crawl stats', { ...stats });
    }

    // Format log dạng JSON line để dễ grep hoặc ship vào logging system.
    private format(
        level: string,
        message: string,
        meta?: Record<string, unknown>,
    ): string {
        return JSON.stringify({
            level,
            message,
            ...meta,
            timestamp: new Date().toISOString(),
        });
    }
}

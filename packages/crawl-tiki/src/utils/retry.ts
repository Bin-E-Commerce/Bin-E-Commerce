import { sleep } from './sleep';

export interface RetryOptions {
    retries: number;
    baseDelayMs: number;
    maxDelayMs?: number;
    resolveDelayMs?: (error: unknown, attempt: number) => number | undefined;
}

// Chạy lại tác vụ lỗi với exponential backoff và jitter để nhiều request không đồng loạt retry vào cùng thời điểm.
export async function retry<T>(
    task: () => Promise<T>,
    options: RetryOptions,
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= options.retries; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            lastError = error;
            if (attempt >= options.retries) break;

            // Cho HTTP client ưu tiên Retry-After hoặc cooldown riêng khi nguồn trả HTML chống tải.
            const strategyDelay = options.resolveDelayMs?.(error, attempt);
            const exponentialDelay = options.baseDelayMs * 2 ** attempt;
            const cappedDelay = Math.min(
                strategyDelay ?? exponentialDelay,
                options.maxDelayMs ?? 60_000,
            );
            const jitter = Math.floor(Math.random() * Math.max(100, cappedDelay * 0.2));
            await sleep(cappedDelay + jitter);
        }
    }

    throw lastError;
}

import { sleep } from './sleep';

export interface RetryOptions {
    retries: number;
    baseDelayMs: number;
}

// Chạy lại tác vụ lỗi tạm thời với backoff đơn giản để giảm fail khi API public chập chờn.
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
            await sleep(options.baseDelayMs * (attempt + 1));
        }
    }

    throw lastError;
}

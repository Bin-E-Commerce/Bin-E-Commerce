import { retry } from '../utils/retry';

export interface RetryableHttpClientOptions {
    retries: number;
    baseDelayMs: number;
    userAgent: string;
}

export class RetryableHttpClient {
    constructor(private readonly options: RetryableHttpClientOptions) {}

    // Gọi JSON API có retry để adapter không phải lặp lại logic chống lỗi mạng.
    async getJson<T>(url: URL): Promise<T> {
        return retry(
            async () => {
                const response = await fetch(url, {
                    headers: {
                        accept: 'application/json, text/plain, */*',
                        'user-agent': this.options.userAgent,
                    },
                });

                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}: ${url.toString()}`,
                    );
                }

                return (await response.json()) as T;
            },
            {
                retries: this.options.retries,
                baseDelayMs: this.options.baseDelayMs,
            },
        );
    }
}

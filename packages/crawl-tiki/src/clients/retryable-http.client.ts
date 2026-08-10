import { retry } from '../utils/retry';

export interface RetryableHttpClientOptions {
    retries: number;
    baseDelayMs: number;
    userAgent: string;
    maxDelayMs?: number;
    nonJsonDelayMs?: number;
    referer?: string;
    acceptLanguage?: string;
}

export class RetryableHttpError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly retryAfterMs: number | null,
        readonly responseKind: 'http_error' | 'non_json',
    ) {
        super(message);
        this.name = 'RetryableHttpError';
    }
}

export class RetryableHttpClient {
    constructor(private readonly options: RetryableHttpClientOptions) {}

    // Gọi JSON API có retry và phát hiện trang HTML chống tải để không nhầm response đó thành dữ liệu nguồn.
    async getJson<T>(
        url: URL,
        requestHeaders: Record<string, string> = {},
    ): Promise<T> {
        return retry(
            async () => {
                const response = await fetch(url, {
                    headers: {
                        accept: 'application/json, text/plain, */*',
                        'accept-language':
                            this.options.acceptLanguage ?? 'vi-VN,vi;q=0.9,en;q=0.8',
                        ...(this.options.referer
                            ? { referer: this.options.referer }
                            : {}),
                        'user-agent': this.options.userAgent,
                        ...requestHeaders,
                    },
                });

                if (!response.ok) {
                    throw new RetryableHttpError(
                        `HTTP ${response.status}: ${url.toString()}`,
                        response.status,
                        this.parseRetryAfter(response.headers.get('retry-after')),
                        'http_error',
                    );
                }

                const contentType = response.headers.get('content-type') ?? '';
                const body = await response.text();
                if (!contentType.toLowerCase().includes('json')) {
                    throw new RetryableHttpError(
                        `Nguồn trả ${contentType || 'unknown content-type'} thay vì JSON cho ${url.toString()}.`,
                        response.status,
                        null,
                        'non_json',
                    );
                }

                try {
                    return JSON.parse(body) as T;
                } catch {
                    throw new RetryableHttpError(
                        `JSON không hợp lệ từ ${url.toString()}.`,
                        response.status,
                        null,
                        'non_json',
                    );
                }
            },
            {
                retries: this.options.retries,
                baseDelayMs: this.options.baseDelayMs,
                maxDelayMs: this.options.maxDelayMs,
                resolveDelayMs: (error) => this.resolveRetryDelay(error),
            },
        );
    }

    // Ưu tiên thời gian server yêu cầu; response HTML nhận cooldown dài hơn lỗi mạng thông thường.
    private resolveRetryDelay(error: unknown): number | undefined {
        if (!(error instanceof RetryableHttpError)) return undefined;
        if (error.retryAfterMs !== null) return error.retryAfterMs;
        if (error.responseKind === 'non_json') {
            return this.options.nonJsonDelayMs ?? 30_000;
        }
        return error.status === 429 || error.status === 403
            ? this.options.nonJsonDelayMs ?? 30_000
            : undefined;
    }

    // Chuyển Retry-After dạng số giây hoặc HTTP date thành milliseconds để tôn trọng giới hạn của nguồn.
    private parseRetryAfter(value: string | null): number | null {
        if (!value) return null;

        const seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

        const timestamp = Date.parse(value);
        return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
    }
}

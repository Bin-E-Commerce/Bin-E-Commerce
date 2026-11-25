// Bootstrap HTTP observability dùng chung cho NestJS service.
// File sở hữu request ID, RED metrics và structured access log; không xác thực quyền,
// không đọc request body và không thay thế guard/authentication của từng service.

import { randomUUID } from 'crypto';
import { MetricsRegistry } from './metrics-registry';

const KNOWN_HTTP_METHODS = new Set([
    'CONNECT',
    'DELETE',
    'GET',
    'HEAD',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
    'TRACE',
]);

// Chỉ mô tả phần contract mà observability cần từ Nest để package common không
// phải kéo dependency framework vào mọi Docker build compile trực tiếp source này.
interface NestLoggerLike {
    log(message: unknown, context?: string): void;
    warn(message: unknown, context?: string): void;
    error(message: unknown, trace?: string, context?: string): void;
    debug(message: unknown, context?: string): void;
    verbose(message: unknown, context?: string): void;
}

// Giữ boundary bootstrap tối thiểu để shared package không phụ thuộc declaration
// của Nest; ứng dụng Nest thật vẫn tương thích nhờ structural typing của TypeScript.
interface NestApplicationLike {
    getHttpAdapter(): { getInstance(): unknown };
    useLogger(logger: NestLoggerLike): void;
}

interface HttpRequest {
    method?: string;
    path?: string;
    originalUrl?: string;
    route?: { path?: string };
    headers?: Record<string, string | string[] | undefined>;
    user?: Record<string, unknown>;
    requestId?: string;
}

interface HttpResponse {
    statusCode?: number;
    setHeader(name: string, value: string): void;
    once(event: 'finish' | 'close', callback: () => void): void;
    end(body?: string): void;
}

interface HttpAdapterInstance {
    use(
        handler: (
            request: HttpRequest,
            response: HttpResponse,
            next: () => void,
        ) => void,
    ): void;
    get(
        path: string,
        handler: (request: HttpRequest, response: HttpResponse) => void,
    ): void;
}

// Chỉ nhận request ID có dạng an toàn để tránh header làm phình log hoặc chèn nội dung điều khiển.
function resolveRequestId(request: HttpRequest): string {
    const value = request.headers?.['x-request-id'];
    const candidate = Array.isArray(value) ? value[0] : value;
    return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)
        ? candidate
        : randomUUID();
}

// Che email theo cách ổn định để operator vẫn tìm được log mà không lưu PII đầy đủ.
function maskEmail(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const [localPart, domain] = value.trim().toLowerCase().split('@', 2);
    if (!localPart || !domain) return undefined;
    return `${localPart.slice(0, 1)}***@${domain}`;
}

// Lấy identity đã được guard gắn vào request, không tin user ID/email từ header client.
function resolveSafeIdentity(request: HttpRequest): Record<string, string> {
    const user = request.user;
    const userId = user?.sub ?? user?.userId ?? user?.id;
    const email = user?.email;
    return {
        ...(typeof userId === 'string' ? { userId } : {}),
        ...(maskEmail(email) ? { email: maskEmail(email)! } : {}),
    };
}

// Chỉ dùng route template của Express; URL lạ được gom vào nhãn cố định để client không tạo series tùy ý.
// Route template giữ placeholder động như `:id`, không chứa giá trị thực từ request.
// Giới hạn độ dài cuối cùng để cấu hình route sai không phình metrics hoặc structured log.
function resolveRoute(request: HttpRequest): string {
    const route = request.route?.path ?? 'unmatched';
    const [path = 'unknown'] = route.split('?', 1);
    const normalized = path
        .split('/')
        .map((segment) =>
            /^[0-9]+$/.test(segment) ||
            /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
            segment.length > 48
                ? ':id'
                : segment,
        )
        .join('/');
    return normalized.slice(0, 160) || 'unknown';
}

// Chuẩn hóa method về tập hữu hạn để HTTP method mở rộng không làm tăng cardinality metrics.
function resolveMethod(method: string | undefined): string {
    const normalized = method?.toUpperCase() ?? 'UNKNOWN';
    return KNOWN_HTTP_METHODS.has(normalized) ? normalized : 'OTHER';
}

// Chuẩn hóa Error thành tên/message trước khi lọc secret và che email để log không rơi thành `{}`.
function sanitizeMessage(message: unknown): string {
    let text: string | undefined;
    if (message instanceof Error) {
        text = `${message.name}: ${message.message}`;
    } else if (typeof message === 'string') {
        text = message;
    } else {
        try {
            text = JSON.stringify(message);
        } catch {
            text = '[UNSERIALIZABLE]';
        }
    }
    return (text || '')
        .replace(
            /(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s,;]+/gi,
            '$1=[REDACTED]',
        )
        .replace(
            /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
            '$1***@$2',
        );
}

// Sanitize field tự do trước khi ghi JSON; field nhạy cảm bị loại giá trị và chuỗi email được che một phần.
function sanitizeFields(
    fields: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!fields) return {};
    return Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
            key,
            /authorization|cookie|password|token|secret/i.test(key)
                ? '[REDACTED]'
                : sanitizeMessage(value),
        ]),
    );
}

// Logger JSON tối giản tương thích LoggerService của Nest và không in stack/secret ngoài ý muốn.
export class StructuredLogger implements NestLoggerLike {
    constructor(
        private readonly service: string,
        private readonly environment = process.env.NODE_ENV ?? 'development',
    ) {}

    // Ghi log mức info với schema ổn định để Loki/Grafana parse được mà không cần regex.
    log(message: unknown, context?: string): void {
        this.write('info', message, context);
    }

    // Ghi cảnh báo vận hành; caller chỉ truyền safe context, không truyền raw payload.
    warn(message: unknown, context?: string): void {
        this.write('warn', message, context);
    }

    // Ghi message Error đã redact; nếu Nest không truyền stack riêng thì chỉ bổ sung stack ở development.
    error(message: unknown, trace?: string, context?: string): void {
        const safeTrace =
            trace ??
            (this.environment === 'development' && message instanceof Error
                ? message.stack
                : undefined);
        this.write('error', message, context, safeTrace);
    }

    // Ghi debug khi service chạy development; production vẫn có schema giống các level khác.
    debug(message: unknown, context?: string): void {
        this.write('debug', message, context);
    }

    // Ghi verbose theo interface Nest để không làm hỏng logger của framework hoặc test.
    verbose(message: unknown, context?: string): void {
        this.write('verbose', message, context);
    }

    // Ghi một event access/audit có field bounded, tách khỏi chuỗi message tự do của Nest.
    logEvent(
        event: string,
        fields: Record<string, unknown>,
        level = 'info',
    ): void {
        this.write(level, event, undefined, undefined, { event, ...fields });
    }

    // Chuẩn hóa toàn bộ output thành JSON line để Alloy thu thập mà không cần parser riêng.
    private write(
        level: string,
        message: unknown,
        context?: string,
        trace?: string,
        fields?: Record<string, unknown>,
    ): void {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.service,
            environment: this.environment,
            ...(context ? { context } : {}),
            message: sanitizeMessage(message),
            ...(trace ? { trace: sanitizeMessage(trace) } : {}),
            ...sanitizeFields(fields),
        };
        process.stdout.write(`${JSON.stringify(entry)}\n`);
    }
}

// Gắn request ID và RED metrics mà không chạm business code.
// `finish` ghi status/latency một lần; `close` chỉ ghi counter hủy nếu response chưa hoàn tất.
// Cả hai listener cùng dùng release idempotent để gauge luôn khớp request còn mở.
export function setupHttpObservability(
    app: NestApplicationLike,
    service: string,
): MetricsRegistry {
    const registry = new MetricsRegistry();
    const logger = new StructuredLogger(service);
    const http = app.getHttpAdapter().getInstance() as HttpAdapterInstance;
    app.useLogger(logger);

    http.get('/metrics', (_request, response) => {
        const body = registry.render();
        response.setHeader(
            'content-type',
            'text/plain; version=0.0.4; charset=utf-8',
        );
        response.statusCode = 200;
        response.setHeader('content-length', String(Buffer.byteLength(body)));
        response.end(body);
    });

    http.use((request, response, next) => {
        const startedAt = process.hrtime.bigint();
        const requestId = resolveRequestId(request);
        request.requestId = requestId;
        response.setHeader('x-request-id', requestId);
        registry.addGauge('http_requests_in_flight', 1, { service });

        let responseFinished = false;
        let inFlightReleased = false;
        // Listener finish và close có thể cùng chạy; release idempotent giữ gauge không âm hoặc tăng giả.
        const releaseInFlight = (): void => {
            if (inFlightReleased) return;
            inFlightReleased = true;
            registry.addGauge('http_requests_in_flight', -1, { service });
        };

        response.once('finish', () => {
            responseFinished = true;
            try {
                const durationSeconds =
                    Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
                const route = resolveRoute(request);
                const method = resolveMethod(request.method);
                const statusCode = response.statusCode ?? 0;
                const statusClass = `${Math.floor(statusCode / 100)}xx`;
                registry.increment('http_requests_total', {
                    service,
                    method,
                    route,
                });
                registry.observeHistogram(
                    'http_request_duration_seconds',
                    durationSeconds,
                    {
                        service,
                        method,
                        route,
                        status_class: statusClass,
                    },
                );
                registry.increment('http_responses_total', {
                    service,
                    method,
                    route,
                    status_class: statusClass,
                });

                const isHealthRequest =
                    route.includes('health') || route === '/metrics';
                if (
                    !isHealthRequest ||
                    statusCode >= 400 ||
                    durationSeconds >= 0.5
                ) {
                    logger.logEvent(
                        'http.request.completed',
                        {
                            requestId,
                            method,
                            route,
                            statusCode,
                            durationMs: Math.round(durationSeconds * 1000),
                            ...resolveSafeIdentity(request),
                        },
                        statusCode >= 500
                            ? 'error'
                            : statusCode >= 400
                              ? 'warn'
                              : 'info',
                    );
                }
            } finally {
                // Metrics hoặc logger lỗi cũng không được giữ gauge tăng sau response hoàn tất.
                releaseInFlight();
            }
        });

        response.once('close', () => {
            // close sau finish là vòng đời bình thường; chỉ đếm và giải phóng khi response chưa hoàn tất.
            if (responseFinished) return;
            try {
                registry.increment('http_requests_aborted_total', {
                    service,
                    method: resolveMethod(request.method),
                    route: resolveRoute(request),
                });
            } finally {
                // Metrics lỗi không được giữ lại gauge của response đã đóng.
                releaseInFlight();
            }
        });

        next();
    });

    return registry;
}

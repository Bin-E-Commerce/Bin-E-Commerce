// Bootstrap HTTP observability dùng chung cho NestJS service.
// File sở hữu request ID, RED metrics và structured access log; không xác thực quyền,
// không đọc request body và không thay thế guard/authentication của từng service.

import { randomUUID } from "crypto";
import type { INestApplication, LoggerService } from "@nestjs/common";
import { MetricsRegistry } from "./metrics-registry";

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
  on(event: "finish", callback: () => void): void;
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
  const value = request.headers?.["x-request-id"];
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

// Che email theo cách ổn định để operator vẫn tìm được log mà không lưu PII đầy đủ.
function maskEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const [localPart, domain] = value.trim().toLowerCase().split("@", 2);
  if (!localPart || !domain) return undefined;
  return `${localPart.slice(0, 1)}***@${domain}`;
}

// Lấy identity đã được guard gắn vào request, không tin user ID/email từ header client.
function resolveSafeIdentity(request: HttpRequest): Record<string, string> {
  const user = request.user;
  const userId = user?.sub ?? user?.userId ?? user?.id;
  const email = user?.email;
  return {
    ...(typeof userId === "string" ? { userId } : {}),
    ...(maskEmail(email) ? { email: maskEmail(email)! } : {}),
  };
}

// Chuẩn hóa route template để metrics không tạo series riêng cho từng ID động.
function resolveRoute(request: HttpRequest): string {
  const route =
    request.route?.path ?? request.path ?? request.originalUrl ?? "unknown";
  const [path = "unknown"] = route.split("?", 1);
  const normalized = path
    .split("/")
    .map((segment) =>
      /^[0-9]+$/.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
      segment.length > 48
        ? ":id"
        : segment,
    )
    .join("/");
  return normalized.slice(0, 160) || "unknown";
}

// Escape nội dung log có thể chứa secret phổ biến trước khi ghi ra stdout và chuyển sang Loki.
function sanitizeMessage(message: unknown): string {
  let text: string | undefined;
  if (typeof message === "string") {
    text = message;
  } else {
    try {
      text = JSON.stringify(message);
    } catch {
      text = "[UNSERIALIZABLE]";
    }
  }
  return (text || "")
    .replace(
      /(authorization|cookie|password|token|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
      "$1***@$2",
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
        ? "[REDACTED]"
        : sanitizeMessage(value),
    ]),
  );
}

// Logger JSON tối giản tương thích LoggerService của Nest và không in stack/secret ngoài ý muốn.
export class StructuredLogger implements LoggerService {
  constructor(
    private readonly service: string,
    private readonly environment = process.env.NODE_ENV ?? "development",
  ) {}

  // Ghi log mức info với schema ổn định để Loki/Grafana parse được mà không cần regex.
  log(message: unknown, context?: string): void {
    this.write("info", message, context);
  }

  // Ghi cảnh báo vận hành; caller chỉ truyền safe context, không truyền raw payload.
  warn(message: unknown, context?: string): void {
    this.write("warn", message, context);
  }

  // Ghi lỗi cùng stack tùy chọn, giữ message đã redact trước khi gửi stdout.
  error(message: unknown, trace?: string, context?: string): void {
    this.write("error", message, context, trace);
  }

  // Ghi debug khi service chạy development; production vẫn có schema giống các level khác.
  debug(message: unknown, context?: string): void {
    this.write("debug", message, context);
  }

  // Ghi verbose theo interface Nest để không làm hỏng logger của framework hoặc test.
  verbose(message: unknown, context?: string): void {
    this.write("verbose", message, context);
  }

  // Ghi một event access/audit có field bounded, tách khỏi chuỗi message tự do của Nest.
  logEvent(
    event: string,
    fields: Record<string, unknown>,
    level = "info",
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

// Gắn request ID, access log và RED metrics vào HTTP adapter mà không đụng vào controller/business code.
export function setupHttpObservability(
  app: INestApplication,
  service: string,
): MetricsRegistry {
  const registry = new MetricsRegistry();
  const logger = new StructuredLogger(service);
  const http = app.getHttpAdapter().getInstance() as HttpAdapterInstance;
  app.useLogger(logger);

  http.get("/metrics", (_request, response) => {
    const body = registry.render();
    response.setHeader(
      "content-type",
      "text/plain; version=0.0.4; charset=utf-8",
    );
    response.statusCode = 200;
    response.setHeader("content-length", String(Buffer.byteLength(body)));
    response.end(body);
  });

  http.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId = resolveRequestId(request);
    request.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    registry.addGauge("http_requests_in_flight", 1, { service });

    response.on("finish", () => {
      const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      const route = resolveRoute(request);
      const method = request.method ?? "UNKNOWN";
      const statusCode = response.statusCode ?? 0;
      const statusClass = `${Math.floor(statusCode / 100)}xx`;
      registry.increment("http_requests_total", {
        service,
        method,
        route,
      });
      registry.observeHistogram(
        "http_request_duration_seconds",
        durationSeconds,
        {
          service,
          method,
          route,
          status_class: statusClass,
        },
      );
      registry.increment("http_responses_total", {
        service,
        method,
        route,
        status_class: statusClass,
      });
      registry.addGauge("http_requests_in_flight", -1, { service });

      const isHealthRequest = route.includes("health") || route === "/metrics";
      if (!isHealthRequest || statusCode >= 400 || durationSeconds >= 0.5) {
        logger.logEvent(
          "http.request.completed",
          {
            requestId,
            method,
            route,
            statusCode,
            durationMs: Math.round(durationSeconds * 1000),
            ...resolveSafeIdentity(request),
          },
          statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
        );
      }
    });

    next();
  });

  return registry;
}

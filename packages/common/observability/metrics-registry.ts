// Registry Prometheus tối giản dùng chung cho các service Node.js.
// File chỉ quản lý metric vận hành có label giới hạn, không sở hữu business rule,
// không lưu request body, token, email đầy đủ hoặc định danh người dùng.

export type MetricLabels = Record<string, string | number | undefined>;

type NormalizedLabels = Record<string, string>;

interface MetricSample {
    labels: NormalizedLabels;
    value: number;
}

interface HistogramSample extends MetricSample {
    buckets: number[];
    bucketCounts: number[];
    sum: number;
    count: number;
}

const DEFAULT_HISTOGRAM_BUCKETS = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

// Chuẩn hóa label trước khi đưa vào key để metric không sinh series do thứ tự label khác nhau.
function normalizeLabels(labels: MetricLabels | undefined): NormalizedLabels {
    return Object.fromEntries(
        Object.entries(labels ?? {})
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)])
            .sort(([left = ''], [right = '']) => left.localeCompare(right)),
    );
}

// Tạo key ổn định cho một bộ label và bảo vệ registry khỏi việc ghi đè sample khác series.
function labelsKey(labels: NormalizedLabels): string {
    return JSON.stringify(labels);
}

// Escape giá trị label theo Prometheus text exposition format mà không làm hỏng dấu xuống dòng.
function escapeLabelValue(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n');
}

// Render tên metric và label thành một dòng hợp lệ cho Prometheus.
function renderMetricName(name: string, labels: NormalizedLabels): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return name;
    const rendered = entries
        .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
        .join(',');
    return `${name}{${rendered}}`;
}

// Registry lưu metric trong process, phù hợp single-process container và không tạo thêm dependency runtime.
export class MetricsRegistry {
    private readonly startedAt = process.hrtime.bigint();
    private readonly counters = new Map<string, Map<string, MetricSample>>();
    private readonly gauges = new Map<string, Map<string, MetricSample>>();
    private readonly histograms = new Map<
        string,
        Map<string, HistogramSample>
    >();

    // Tăng counter với label bounded; caller không được truyền user ID, email hoặc request ID vào label.
    increment(name: string, labels?: MetricLabels, amount = 1): void {
        const normalized = normalizeLabels(labels);
        const key = labelsKey(normalized);
        const samples =
            this.counters.get(name) ?? new Map<string, MetricSample>();
        const current = samples.get(key) ?? { labels: normalized, value: 0 };
        current.value += amount;
        samples.set(key, current);
        this.counters.set(name, samples);
    }

    // Ghi gauge cho trạng thái hiện tại như in-flight request hoặc dependency availability.
    setGauge(name: string, value: number, labels?: MetricLabels): void {
        const normalized = normalizeLabels(labels);
        const samples =
            this.gauges.get(name) ?? new Map<string, MetricSample>();
        samples.set(labelsKey(normalized), { labels: normalized, value });
        this.gauges.set(name, samples);
    }

    // Cộng hoặc trừ gauge nguyên tử trong cùng event loop để không làm mất số request đồng thời.
    addGauge(name: string, amount: number, labels?: MetricLabels): void {
        const normalized = normalizeLabels(labels);
        const key = labelsKey(normalized);
        const samples =
            this.gauges.get(name) ?? new Map<string, MetricSample>();
        const current = samples.get(key) ?? { labels: normalized, value: 0 };
        current.value = Math.max(0, current.value + amount);
        samples.set(key, current);
        this.gauges.set(name, samples);
    }

    // Cộng dồn latency vào histogram để Grafana tính p50/p95 mà không cần lưu raw request data.
    observeHistogram(
        name: string,
        value: number,
        labels?: MetricLabels,
        buckets = DEFAULT_HISTOGRAM_BUCKETS,
    ): void {
        const normalized = normalizeLabels(labels);
        const key = labelsKey(normalized);
        const samples =
            this.histograms.get(name) ?? new Map<string, HistogramSample>();
        const current = samples.get(key) ?? {
            labels: normalized,
            value: 0,
            buckets: [...buckets].sort((left, right) => left - right),
            bucketCounts: buckets.map(() => 0),
            sum: 0,
            count: 0,
        };
        const safeValue = Number.isFinite(value) && value >= 0 ? value : 0;
        current.sum += safeValue;
        current.count += 1;
        current.bucketCounts = current.buckets.map((bucket, index) =>
            safeValue <= bucket
                ? (current.bucketCounts[index] ?? 0) + 1
                : (current.bucketCounts[index] ?? 0),
        );
        samples.set(key, current);
        this.histograms.set(name, samples);
    }

    // Xuất snapshot metrics cùng process memory/CPU để Prometheus scrape mà không gọi dependency ngoài.
    render(): string {
        const lines: string[] = [
            '# HELP process_uptime_seconds Process uptime in seconds.',
            '# TYPE process_uptime_seconds gauge',
            `process_uptime_seconds ${Number(process.hrtime.bigint() - this.startedAt) / 1_000_000_000}`,
            '# HELP process_resident_memory_bytes Resident process memory in bytes.',
            '# TYPE process_resident_memory_bytes gauge',
            `process_resident_memory_bytes ${process.memoryUsage().rss}`,
        ];

        for (const [name, samples] of this.counters) {
            lines.push(`# TYPE ${name} counter`);
            for (const sample of samples.values()) {
                lines.push(
                    `${renderMetricName(name, sample.labels)} ${sample.value}`,
                );
            }
        }

        for (const [name, samples] of this.gauges) {
            lines.push(`# TYPE ${name} gauge`);
            for (const sample of samples.values()) {
                lines.push(
                    `${renderMetricName(name, sample.labels)} ${sample.value}`,
                );
            }
        }

        for (const [name, samples] of this.histograms) {
            lines.push(`# TYPE ${name} histogram`);
            for (const sample of samples.values()) {
                for (let index = 0; index < sample.buckets.length; index += 1) {
                    lines.push(
                        `${renderMetricName(`${name}_bucket`, {
                            ...sample.labels,
                            le: String(sample.buckets[index] ?? '+Inf'),
                        })} ${sample.bucketCounts[index] ?? 0}`,
                    );
                }
                lines.push(
                    `${renderMetricName(`${name}_bucket`, {
                        ...sample.labels,
                        le: '+Inf',
                    })} ${sample.count}`,
                );
                lines.push(
                    `${renderMetricName(`${name}_sum`, sample.labels)} ${sample.sum}`,
                );
                lines.push(
                    `${renderMetricName(`${name}_count`, sample.labels)} ${sample.count}`,
                );
            }
        }

        return `${lines.join('\n')}\n`;
    }
}

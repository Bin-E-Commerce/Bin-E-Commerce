// Ép dữ liệu số không ổn định từ API về number hoặc null để mapper dễ xử lý.
export function toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.replace(/[^\d.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

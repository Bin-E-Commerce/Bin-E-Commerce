// Đọc một cấu hình số tùy chọn của crawler và giữ giá trị mặc định an toàn khi biến môi trường không hợp lệ.
export function getCrawlerNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

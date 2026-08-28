// Tạm dừng giữa các request để crawler không gọi API quá dồn dập.
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

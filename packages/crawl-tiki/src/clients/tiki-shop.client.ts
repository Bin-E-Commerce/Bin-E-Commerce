// Client này lấy hồ sơ shop public của Tiki để product graph giữ được thông tin seller đầy đủ.
// Client chỉ đọc dữ liệu nguồn; việc chuẩn hóa và lưu database thuộc adapter/import repository.

import { TIKI_BASE_URL, TIKI_BROWSER_USER_AGENT } from '../config/tiki.config';
import { RetryableHttpClient } from './retryable-http.client';
import { getCrawlerNumber } from '../utils/crawler-config';

export interface TikiShopFallback {
    externalId: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
}

export interface TikiShopProfile {
    externalId: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
    description: string | null;
    sourceUrl: string;
    ratingAverage: number | null;
    reviewCount: number | null;
    followerCount: number | null;
}

interface TikiSellerProfilePayload {
    name?: unknown;
    logo?: unknown;
    icon?: unknown;
    url?: unknown;
    description?: unknown;
    meta_description?: unknown;
    avg_rating_point?: unknown;
    review_count?: unknown;
    total_follower?: unknown;
    stats?: unknown;
}

export class TikiShopClient {
    private readonly http: RetryableHttpClient;

    constructor(
        http = new RetryableHttpClient({
            retries: getCrawlerNumber('TIKI_CRAWLER_RETRIES', 4),
            baseDelayMs: 1_000,
            maxDelayMs: 60_000,
            nonJsonDelayMs: getCrawlerNumber(
                'TIKI_CRAWLER_NON_JSON_DELAY_MS',
                30_000,
            ),
            referer: `${TIKI_BASE_URL}/`,
            userAgent: TIKI_BROWSER_USER_AGENT,
        }),
    ) {
        this.http = http;
    }

    // Đọc sellerProfile được nhúng trong HTML shop và chuẩn hóa về contract shop dùng chung của crawler.
    // Tiki không cung cấp toàn bộ metric shop trong product detail, nên profile page là nguồn chính cho rating/follower.
    async fetchShopProfile(
        shopUrl: string,
        fallback: TikiShopFallback,
    ): Promise<TikiShopProfile | null> {
        const html = await this.http.getText(new URL(shopUrl));
        const payload = this.extractSellerProfile(html);
        if (!payload) return null;

        const resolvedUrl = this.readString(payload.url) ?? shopUrl;
        return {
            externalId: fallback.externalId,
            name: this.readString(payload.name) ?? fallback.name,
            slug: this.extractSlug(resolvedUrl, fallback.slug),
            avatarUrl:
                this.readString(payload.logo) ??
                this.readString(payload.icon) ??
                fallback.avatarUrl,
            description:
                this.readString(payload.description) ??
                this.readString(payload.meta_description),
            sourceUrl: resolvedUrl,
            ratingAverage:
                this.readNumber(payload.avg_rating_point) ??
                this.extractRating(payload.stats),
            reviewCount: this.readNumber(payload.review_count),
            followerCount: this.readNumber(payload.total_follower),
        };
    }

    // Lấy object sellerProfile từ HTML bằng cách đếm brace thay vì regex greedy, tránh cắt sai khi mô tả có ký tự đặc biệt.
    private extractSellerProfile(html: string): TikiSellerProfilePayload | null {
        const marker = '"sellerStoreInfo":';
        let searchFrom = 0;

        while (searchFrom < html.length) {
            const markerIndex = html.indexOf(marker, searchFrom);
            if (markerIndex < 0) return null;

            const objectStart = html.indexOf('{', markerIndex + marker.length);
            if (objectStart < 0) return null;

            let depth = 0;
            let inString = false;
            let escaped = false;

            for (let index = objectStart; index < html.length; index += 1) {
                const character = html[index];

                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (character === '\\') {
                        escaped = true;
                    } else if (character === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (character === '"') {
                    inString = true;
                } else if (character === '{') {
                    depth += 1;
                } else if (character === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        try {
                            const payload = JSON.parse(
                                html.slice(objectStart, index + 1),
                            ) as TikiSellerProfilePayload;
                            if (
                                payload.review_count !== undefined ||
                                payload.total_follower !== undefined ||
                                Array.isArray(payload.stats)
                            ) {
                                return payload;
                            }
                        } catch {
                            // Bỏ qua candidate lỗi và tiếp tục tìm sellerProfile tiếp theo.
                        }

                        searchFrom = index + 1;
                        break;
                    }
                }
            }
        }

        return null;
    }

    // Đọc rating từ stat title dạng "4.7 / 5"; metric khác không được dùng nhầm làm điểm shop.
    private extractRating(stats: unknown): number | null {
        if (!Array.isArray(stats)) return null;

        const ratingStat = stats.find(
            (stat) =>
                typeof stat === 'object' &&
                stat !== null &&
                (stat as { type?: unknown }).type === 'review' &&
                this.readString((stat as { title?: unknown }).title)?.includes(
                    '/ 5',
                ),
        );
        if (!ratingStat || typeof ratingStat !== 'object') return null;

        const title = this.readString((ratingStat as { title?: unknown }).title);
        const rating = title?.match(/\d+(?:\.\d+)?/)?.[0];
        return rating ? this.readNumber(rating) : null;
    }

    // Chuyển dữ liệu số không ổn định từ HTML sang number nullable để không ghi NaN vào read model.
    private readNumber(value: unknown): number | null {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    // Đọc string an toàn từ payload không có schema TypeScript đáng tin cậy.
    private readString(value: unknown): string | null {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    // Giữ slug ổn định từ URL profile, fallback về slug đã chuẩn hóa ở product detail nếu URL thiếu.
    private extractSlug(url: string, fallback: string): string {
        try {
            const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1);
            return slug || fallback;
        } catch {
            return fallback;
        }
    }
}

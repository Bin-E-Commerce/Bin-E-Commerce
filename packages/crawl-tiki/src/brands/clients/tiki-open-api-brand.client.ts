import { RetryableHttpClient } from '../../clients/retryable-http.client';
import type { TikiOpenApiBrandValue } from '../types/tiki-brand-source.type';

const TIKI_BRAND_ATTRIBUTE_ID = 603;
const TIKI_OPEN_API_BASE_URL = 'https://api.tiki.vn/integration/v2';
const TIKI_OPEN_API_PAGE_SIZE = 100;
const TIKI_OPEN_API_MAX_PAGE_COUNT = 1_000;

interface TikiOpenApiBrandPage {
    values: unknown[];
    currentPage: number | null;
    lastPage: number | null;
    total: number | null;
    perPage: number | null;
}

export class TikiOpenApiBrandClient {
    constructor(
        private readonly token: string,
        private readonly http = new RetryableHttpClient({
            retries: 4,
            baseDelayMs: 1_000,
            maxDelayMs: 30_000,
            nonJsonDelayMs: 30_000,
            userAgent: 'BinEcommerceBrandCrawler/1.0',
        }),
    ) {
        if (!token.trim()) {
            throw new Error(
                'Thiếu TIKI_API_TOKEN. Hãy tạo seller token hợp lệ trên Tiki Open API trước khi crawl toàn bộ thương hiệu.',
            );
        }
    }

    // Đọc tuần tự mọi trang của thuộc tính Brand (ID 603) và chỉ kết thúc khi metadata hoặc trang rỗng xác nhận đã hết dữ liệu.
    async fetchAllBrands(): Promise<TikiOpenApiBrandValue[]> {
        const brands: TikiOpenApiBrandValue[] = [];
        const observedPageSignatures = new Set<string>();
        let fetchedValueCount = 0;
        let completed = false;

        for (let page = 1; page <= TIKI_OPEN_API_MAX_PAGE_COUNT; page += 1) {
            const response = await this.fetchPage(page);
            const pageData = this.extractPage(response);

            // Trang rỗng là tín hiệu kết thúc an toàn khi response không cung cấp metadata phân trang.
            if (pageData.values.length === 0) {
                completed = true;
                break;
            }

            const pageBrands = pageData.values
                .map((value) => this.mapBrand(value))
                .filter((brand): brand is TikiOpenApiBrandValue => brand !== null);

            if (pageBrands.length === 0) {
                throw new Error(
                    `Trang thương hiệu Tiki ${page} có dữ liệu nhưng không khớp schema ID/tên được hỗ trợ.`,
                );
            }

            // Nếu API bỏ qua query page và trả lại cùng một trang, dừng bằng lỗi thay vì tạo job chạy vô hạn hoặc catalog thiếu.
            const pageSignature = pageBrands
                .map((brand) => brand.externalBrandId)
                .sort()
                .join('|');
            if (observedPageSignatures.has(pageSignature)) {
                throw new Error(
                    `Tiki Open API trả lại dữ liệu trùng hoàn toàn ở trang ${page}; không thể xác nhận catalog thương hiệu đã đầy đủ.`,
                );
            }

            observedPageSignatures.add(pageSignature);
            brands.push(...pageBrands);
            fetchedValueCount += pageData.values.length;

            if (this.hasReachedLastPage(page, fetchedValueCount, pageData)) {
                completed = true;
                break;
            }
        }

        if (!completed) {
            throw new Error(
                `Crawler đã chạm giới hạn an toàn ${TIKI_OPEN_API_MAX_PAGE_COUNT} trang nhưng Tiki chưa xác nhận hết dữ liệu thương hiệu.`,
            );
        }

        if (brands.length === 0) {
            throw new Error(
                'Tiki Open API không trả về thương hiệu hợp lệ cho thuộc tính Brand 603.',
            );
        }

        return this.deduplicate(brands);
    }

    // Gọi đúng một trang để vòng lặp điều phối có thể kiểm soát page, limit và trạng thái hoàn thành.
    private async fetchPage(page: number): Promise<unknown> {
        const url = new URL(
            `${TIKI_OPEN_API_BASE_URL}/attributes/${TIKI_BRAND_ATTRIBUTE_ID}/values`,
        );
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', String(TIKI_OPEN_API_PAGE_SIZE));

        return this.http.getJson<unknown>(url, {
            'tiki-api': this.token,
        });
    }

    // Chuẩn hóa các envelope data/paging phổ biến của Tiki về một contract phân trang duy nhất cho crawler.
    private extractPage(response: unknown): TikiOpenApiBrandPage {
        if (!this.isRecord(response)) return this.emptyPage();

        const data = response['data'];
        const values = Array.isArray(data)
            ? data
            : this.isRecord(data) && Array.isArray(data['data'])
              ? data['data']
              : [];
        const pagination = this.extractPagination(response, data);

        return {
            values,
            ...pagination,
        };
    }

    // Tìm metadata ở cả root và data vì các phiên bản Open API có thể đặt paging ở vị trí khác nhau.
    private extractPagination(
        response: Record<string, unknown>,
        data: unknown,
    ): Omit<TikiOpenApiBrandPage, 'values'> {
        const dataRecord = this.isRecord(data) ? data : null;
        const candidates = [
            response['paging'],
            response['pagination'],
            response['meta'],
            dataRecord?.['paging'],
            dataRecord?.['pagination'],
            dataRecord?.['meta'],
            dataRecord,
        ];
        const metadata = candidates.find((candidate) =>
            this.isPaginationRecord(candidate),
        );

        if (!this.isRecord(metadata)) {
            return {
                currentPage: null,
                lastPage: null,
                total: null,
                perPage: null,
            };
        }

        return {
            currentPage: this.optionalPositiveInteger(
                metadata['current_page'] ?? metadata['currentPage'] ?? metadata['page'],
            ),
            lastPage: this.optionalPositiveInteger(
                metadata['last_page'] ?? metadata['lastPage'] ?? metadata['total_pages'],
            ),
            total: this.optionalNonNegativeInteger(
                metadata['total'] ?? metadata['total_count'],
            ),
            perPage: this.optionalPositiveInteger(
                metadata['per_page'] ?? metadata['perPage'] ?? metadata['limit'],
            ),
        };
    }

    // Xác định trang cuối bằng metadata đáng tin cậy; khi metadata vắng mặt crawler sẽ gọi tiếp đến khi gặp trang rỗng.
    private hasReachedLastPage(
        requestedPage: number,
        fetchedValueCount: number,
        pageData: TikiOpenApiBrandPage,
    ): boolean {
        const currentPage = pageData.currentPage ?? requestedPage;
        if (pageData.lastPage !== null) {
            return currentPage >= pageData.lastPage;
        }
        if (pageData.total !== null) {
            return fetchedValueCount >= pageData.total;
        }
        if (pageData.perPage !== null) {
            return pageData.values.length < pageData.perPage;
        }
        return false;
    }

    // Tạo page rỗng rõ nghĩa để response sai envelope được xử lý giống nguồn không có dữ liệu.
    private emptyPage(): TikiOpenApiBrandPage {
        return {
            values: [],
            currentPage: null,
            lastPage: null,
            total: null,
            perPage: null,
        };
    }

    // Chỉ nhận brand có ID và tên thật; các field tùy chọn được đọc phòng trường hợp API bổ sung logo hoặc URL.
    private mapBrand(value: unknown): TikiOpenApiBrandValue | null {
        if (!this.isRecord(value)) return null;

        const externalBrandId = String(value['id'] ?? '').trim();
        const nameValue = value['value'] ?? value['name'];
        const name = typeof nameValue === 'string' ? nameValue.trim() : '';
        if (!externalBrandId || !name) return null;

        return {
            externalBrandId,
            name,
            sourceUrl: this.optionalString(value['url']),
            logoUrl: this.optionalString(value['logo_url'] ?? value['logo']),
            position: this.optionalNumber(value['position']),
        };
    }

    // Loại trùng theo external ID và giữ thứ tự position từ Tiki để output ổn định giữa các lần chạy.
    private deduplicate(brands: TikiOpenApiBrandValue[]): TikiOpenApiBrandValue[] {
        const unique = new Map<string, TikiOpenApiBrandValue>();
        for (const brand of brands) {
            if (!unique.has(brand.externalBrandId)) {
                unique.set(brand.externalBrandId, brand);
            }
        }

        return [...unique.values()].sort(
            (left, right) =>
                (left.position ?? Number.MAX_SAFE_INTEGER) -
                    (right.position ?? Number.MAX_SAFE_INTEGER) ||
                left.name.localeCompare(right.name, 'vi'),
        );
    }

    // Chuẩn hóa field chuỗi tùy chọn thành null để contract đầu ra không lẫn undefined.
    private optionalString(value: unknown): string | null {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    // Chuẩn hóa position tùy chọn và loại giá trị không hữu hạn.
    private optionalNumber(value: unknown): number | null {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    // Chỉ nhận số nguyên dương cho page/limit để metadata lỗi không làm crawler kết thúc sớm.
    private optionalPositiveInteger(value: unknown): number | null {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    // Total có thể bằng 0 nên dùng bộ chuẩn hóa riêng với page và limit.
    private optionalNonNegativeInteger(value: unknown): number | null {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    }

    // Chỉ chọn object thực sự chứa khóa phân trang để không bỏ qua paging hợp lệ nằm sau một meta object khác.
    private isPaginationRecord(value: unknown): value is Record<string, unknown> {
        if (!this.isRecord(value)) return false;

        return [
            'current_page',
            'currentPage',
            'page',
            'last_page',
            'lastPage',
            'total_pages',
            'total',
            'total_count',
            'per_page',
            'perPage',
            'limit',
        ].some((key) => key in value);
    }

    // Thu hẹp unknown thành object có thể đọc khóa mà không dùng any.
    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
}

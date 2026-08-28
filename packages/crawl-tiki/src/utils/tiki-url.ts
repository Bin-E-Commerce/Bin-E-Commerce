import { TIKI_BASE_URL } from '../config/tiki.config';

// Ghép URL sản phẩm đầy đủ từ url_path của Tiki để dữ liệu output mở được trực tiếp.
export function buildTikiProductUrl(urlPath?: string): string {
    if (!urlPath) return TIKI_BASE_URL;
    if (urlPath.startsWith('http')) return urlPath;
    return `${TIKI_BASE_URL}/${urlPath.replace(/^\/+/, '')}`;
}

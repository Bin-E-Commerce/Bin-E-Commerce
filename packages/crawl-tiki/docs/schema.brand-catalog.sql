-- Mở rộng bảng brand để lưu catalog thương hiệu đã chuẩn hóa từ nguồn public.
ALTER TABLE brands
    ADD COLUMN IF NOT EXISTS normalized_name varchar(180),
    ADD COLUMN IF NOT EXISTS country_code char(2),
    ADD COLUMN IF NOT EXISTS country_name varchar(120),
    ADD COLUMN IF NOT EXISTS aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS last_crawled_at timestamptz;

-- Hỗ trợ tra cứu không phân biệt hoa thường khi seller tìm thương hiệu trong form sản phẩm.
CREATE INDEX IF NOT EXISTS idx_brands_normalized_name
    ON brands (normalized_name);

-- Hỗ trợ lọc thương hiệu theo quốc gia mà không phải đọc JSON metadata.
CREATE INDEX IF NOT EXISTS idx_brands_country_code
    ON brands (country_code)
    WHERE country_code IS NOT NULL;

# Product Crawler / Importer

Module này crawl/import dữ liệu product từ nguồn public hợp lệ, hiện có adapter cho Tiki và được thiết kế để mở rộng sang Shopee, Lazada, Sendo.

## Kiến trúc

- `adapters/`: Source Adapter, chuyển API từng sàn về contract chung `SourceProductDetail`.
- `clients/`: HTTP client có retry, user-agent rõ ràng và không bypass captcha/login.
- `services/`: `ProductCrawlerService` điều phối category, product page, detail, reviews, checkpoint và import.
- `mappers/`: `ProductMapper` map source data sang graph database gồm product, images, variants, options, inventory, brand, shop, attributes, reviews.
- `repositories/`: `PostgresProductImportRepository` upsert dữ liệu vào database.
- `checkpoints/`: lưu tiến độ crawl để resume nếu job dừng giữa chừng.
- `validators/`: kiểm tra dữ liệu bắt buộc trước khi insert.
- `loggers/`: log dạng JSON line, có thống kê crawled/imported/skipped/failed.

## Flow crawl

1. Nhận `--category`, `--category-ids` hoặc `--keyword`.
2. Lấy danh sách product theo page.
3. Với mỗi product, lấy detail.
4. Nếu bật `--reviews`, lấy reviews public nếu nguồn cho phép.
5. Adapter chuẩn hóa raw data về source contract.
6. `ProductMapper` tạo import graph.
7. Validator loại product thiếu dữ liệu bắt buộc.
8. Nếu bật `--import`, repository upsert theo transaction.
9. Lưu checkpoint sau từng product.
10. Ghi output JSON để audit dữ liệu đã mapping.

## Schema bổ sung đề xuất

Các bảng crawl từ nguồn ngoài nên có thêm cột external/source để chống trùng và trace dữ liệu:

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_product_id varchar(100),
  ADD COLUMN IF NOT EXISTS source_url text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_source_external
  ON products (source_platform, external_product_id)
  WHERE source_platform IS NOT NULL AND external_product_id IS NOT NULL;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_category_id varchar(100),
  ADD COLUMN IF NOT EXISTS source_url text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_slug ON categories (slug);

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_brand_id varchar(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_brands_slug ON brands (slug);

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_shop_id varchar(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shops_slug ON shops (slug);

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS external_variant_id varchar(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_sku ON product_variants (sku);

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS external_image_id varchar(150);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_images_product_url
  ON product_images (product_id, image_url);

ALTER TABLE product_options
  ADD CONSTRAINT uq_product_options_product_name UNIQUE (product_id, name);

ALTER TABLE product_option_values
  ADD CONSTRAINT uq_product_option_values_option_value UNIQUE (option_id, value);

ALTER TABLE product_variant_option_values
  ADD CONSTRAINT uq_variant_option_values UNIQUE (variant_id, option_value_id);

ALTER TABLE inventories
  ADD CONSTRAINT uq_inventories_variant UNIQUE (variant_id);

ALTER TABLE attributes
  ADD COLUMN IF NOT EXISTS slug varchar(160),
  ADD COLUMN IF NOT EXISTS external_attribute_id varchar(150);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attributes_category_slug
  ON attributes (category_id, slug);

ALTER TABLE product_attribute_values
  ADD CONSTRAINT uq_product_attribute_values_product_attribute UNIQUE (product_id, attribute_id);

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS source_platform varchar(30),
  ADD COLUMN IF NOT EXISTS external_review_id varchar(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_source_external
  ON reviews (source_platform, external_review_id)
  WHERE source_platform IS NOT NULL AND external_review_id IS NOT NULL;
```

## Chạy crawl JSON

```bash
npm run crawl -w @bin-ecommerce/crawl-tiki -- --keyword "điện thoại" --pages 1 --limit 10 --details --output data/tiki-products.json
```

## Chạy import database

```bash
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/bin_ecommerce"
npm run crawl -w @bin-ecommerce/crawl-tiki -- --category 1789 --pages 1 --limit 5 --details --reviews --import --resume
```

## Test với category nhỏ

```bash
npm run crawl -w @bin-ecommerce/crawl-tiki -- --category 1789 --pages 1 --limit 3 --max 3 --details --delay 1000 --output data/test-category.json
```

Mở file output để kiểm tra `categoryChain`, `product`, `variants`, `images`, `attributes` trước khi bật `--import`.

## Ví dụ raw Tiki rút gọn

```json
{
  "id": 123,
  "name": "Điện thoại Demo",
  "price": 3990000,
  "brand": { "id": 10, "name": "Demo Brand" },
  "current_seller": { "id": 99, "name": "Demo Shop" },
  "images": [{ "large_url": "https://..." }],
  "configurable_options": [
    { "name": "Màu sắc", "values": [{ "label": "Đen" }] }
  ],
  "configurable_products": [
    { "id": 1, "sku": "SKU-BLACK", "price": 3990000, "option1": "Đen" }
  ],
  "specifications": [
    { "attributes": [{ "name": "RAM", "value": "8 GB" }] }
  ]
}
```

## Ví dụ mapped graph rút gọn

```json
{
  "product": {
    "externalId": "123",
    "sourcePlatform": "tiki",
    "name": "Điện thoại Demo",
    "slug": "dien-thoai-demo-123"
  },
  "brand": { "externalId": "10", "name": "Demo Brand" },
  "shop": { "externalId": "99", "name": "Demo Shop" },
  "options": [{ "name": "Màu sắc", "values": [{ "value": "Đen" }] }],
  "variants": [{ "sku": "SKU-BLACK", "price": 3990000 }],
  "attributes": [{ "name": "RAM", "valueText": "8 GB" }]
}
```

## Nguyên tắc an toàn

- Chỉ dùng API public hoặc nguồn được cấp phép.
- Không bypass captcha, login, rate-limit hoặc cơ chế bảo vệ.
- Luôn đặt `--delay` khi crawl nhiều.
- Chạy thử với `--limit 3 --max 3` trước khi import số lượng lớn.

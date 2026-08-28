# Tiki Brand Catalog Crawler

Module này thu thập danh mục thương hiệu từ Tiki Open API, chuẩn hóa dữ liệu và upsert idempotent vào database của Product Service. Crawler không tạo hoặc cập nhật category trong Catalog Service.

## Nguồn dữ liệu

Luồng mặc định dùng endpoint chính thức:

```text
GET https://api.tiki.vn/integration/v2/attributes/603/values
Header: tiki-api: <seller-token>
```

Attribute `603` là danh mục thương hiệu do Tiki cung cấp cho quy trình tạo sản phẩm. Token phải được cấu hình cục bộ trong `TIKI_API_TOKEN`; không ghi token vào source code, log hoặc file JSON đầu ra.

Tiki Open API trả về ID và tên thương hiệu nhưng không bảo đảm có quốc gia thương hiệu. Vì vậy:

- `countryCode` và `countryName` được để `null` khi nguồn không cung cấp bằng chứng.
- Không suy đoán quốc gia từ tên thương hiệu, tên miền hoặc nơi sản xuất.
- Quốc gia chỉ được bổ sung khi product detail có trường nguồn rõ ràng như `Xuất xứ thương hiệu`.
- Category Tiki chỉ là dữ liệu khám phá nguồn; crawler thương hiệu không ghi vào Catalog Service.

## Kiến trúc

```text
Tiki Open API
  -> TikiOpenApiBrandClient
  -> BrandCatalogMapper
  -> BrandCatalogValidator
  -> JSON catalog + quality report
  -> ProductServiceBrandRepository
  -> product-service.brands
```

Các thành phần chính:

- `TikiOpenApiBrandClient`: gọi endpoint thương hiệu chính thức và cô lập token ở request cần thiết.
- `OfficialBrandCrawlerService`: điều phối crawl toàn bộ catalog chính thức.
- `TikiBrandClient`: adapter storefront dự phòng, chỉ dùng cho pilot nhỏ khi nguồn public hoạt động.
- `BrandCatalogMapper`: chuẩn hóa, gộp và chống trùng theo `sourcePlatform + externalBrandId`.
- `BrandCountryMapper`: ánh xạ bằng chứng quốc gia hợp lệ về ISO 3166-1 alpha-2.
- `BrandCatalogExporter`: ghi catalog và báo cáo chất lượng bằng thao tác thay file an toàn.
- `FileBrandCheckpointStore`: khóa theo PID và lưu checkpoint cho luồng storefront dài.
- `ProductServiceBrandRepository`: upsert duy nhất vào bảng `brands` của Product Service.

## Cấu hình

Tạo file môi trường cục bộ từ mẫu:

```powershell
Copy-Item packages/crawl-tiki/.env.example packages/crawl-tiki/.env
```

Điền seller token vào file vừa tạo:

```env
TIKI_API_TOKEN=your-local-tiki-seller-token
PRODUCT_DATABASE_URL=postgres://bin_ecommerce:changeme_postgres@localhost:5432/bin_ecommerce_product
```

Không gửi token qua chat và không commit file `.env`.

## Lệnh chạy

Crawl toàn bộ thương hiệu từ Open API:

```powershell
npm run crawl:brands:official -w @bin-ecommerce/crawl-tiki
```

Sau khi kiểm tra report, import vào Product Service:

```powershell
npm run import:brands -w @bin-ecommerce/crawl-tiki
```

Crawl và import trong cùng một lần chạy:

```powershell
npm run crawl:brands -w @bin-ecommerce/crawl-tiki -- --source official --import
```

Chạy pilot storefront có giới hạn:

```powershell
npm run crawl:brands:sample -w @bin-ecommerce/crawl-tiki
```

Nếu storefront trả WAF hoặc CAPTCHA, dừng pilot và dùng Open API. Không bypass CAPTCHA, giả cookie đăng nhập hoặc xoay proxy.

## File đầu ra

- `data/tiki-brands.json`: catalog canonical dùng để import.
- `data/tiki-brands.report.json`: thống kê crawl và vấn đề chất lượng.
- `data/tiki-brands.checkpoint.json`: checkpoint cho job có thể tiếp tục.

Catalog chưa hoàn tất bị chặn import mặc định. `--allow-partial` chỉ dành cho kiểm thử có chủ đích, không dùng cho dữ liệu production.

## Chống trùng và cập nhật

Khóa nghiệp vụ là `source_platform + external_brand_id`. Chạy import nhiều lần sẽ cập nhật cùng bản ghi thay vì tạo thương hiệu mới. `slug` là dữ liệu hiển thị và không được dùng thay cho external ID vì tên thương hiệu có thể đổi.

Migration bổ sung metadata nguồn cho Product Service:

```powershell
Get-Content packages/crawl-tiki/docs/schema.brand-catalog.sql -Raw | docker exec -i bin_postgres psql -U bin_ecommerce -d bin_ecommerce_product
```

## Kiểm tra database

Đếm thương hiệu đã import:

```powershell
docker exec bin_postgres psql -U bin_ecommerce -d bin_ecommerce_product -c "SELECT COUNT(*) AS total_brands FROM brands;"
```

Kiểm tra chống trùng theo nguồn:

```powershell
docker exec bin_postgres psql -U bin_ecommerce -d bin_ecommerce_product -c "SELECT source_platform, external_brand_id, COUNT(*) FROM brands WHERE external_brand_id IS NOT NULL GROUP BY source_platform, external_brand_id HAVING COUNT(*) > 1;"
```

Xem các thương hiệu còn thiếu bằng chứng quốc gia:

```powershell
docker exec bin_postgres psql -U bin_ecommerce -d bin_ecommerce_product -c "SELECT name, external_brand_id FROM brands WHERE source_platform = 'tiki' AND country_code IS NULL ORDER BY name LIMIT 50;"
```

Xác nhận crawler không thay đổi category:

```powershell
docker exec bin_postgres psql -U bin_ecommerce -d bin_ecommerce_catalog -c "SELECT COUNT(*) AS total_categories FROM categories;"
```

## Quy tắc vận hành

- Chạy typecheck và pilot trước khi đổi mapper hoặc repository.
- Chỉ import catalog hoàn chỉnh khi chạy dữ liệu thật.
- Không ghi category từ nguồn Tiki vào Catalog Service.
- Không suy đoán quốc gia thương hiệu khi không có bằng chứng nguồn.
- Không ghi secret, header xác thực hoặc raw response nhạy cảm vào log.
- Theo dõi `request_failed`, `country_missing` và số bản ghi bị skip trong quality report.

# Tiki Brand Catalog

Luồng này chỉ đồng bộ danh mục thương hiệu từ Tiki Open API; không đọc product
detail, không crawl shop và không ghi dữ liệu vào bảng sản phẩm.

## Nguồn

```text
GET https://api.tiki.vn/integration/v2/attributes/603/values
Header: tiki-api: <TIKI_API_TOKEN>
```

Endpoint trả ID, tên và một số metadata thương hiệu. Không suy đoán quốc gia hoặc
thuộc tính khác nếu API không cung cấp.

## Thành phần

```text
TikiOpenApiBrandClient
  -> OfficialBrandCrawlerService
  -> BrandCatalogMapper + BrandCatalogValidator
  -> JSON catalog/report
  -> ProductServiceBrandRepository
  -> Product Service.brands
```

`source_platform + external_brand_id` là khóa idempotent; slug chỉ dùng hiển thị
và fallback để hợp nhất với brand đã tồn tại. Import chạy trong transaction,
mỗi brand có savepoint để lỗi một record không làm mất các record hợp lệ.

## Chạy

```powershell
npm run crawl:brands:official -w @bin-ecommerce/crawl-tiki
npm run import:brands -w @bin-ecommerce/crawl-tiki
npm run import:brands:official -w @bin-ecommerce/crawl-tiki
```

Không commit token hoặc file `.env`. Crawler không dùng storefront, cookie đăng
nhập, product sample hay logic crawl sản phẩm.

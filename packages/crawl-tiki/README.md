# Tiki Brand Catalog Importer

Package này chỉ lấy danh mục thương hiệu từ Tiki Open API và có thể import
thương hiệu vào Product Service. Package không crawl, lưu hoặc import sản phẩm.

## Cấu hình

Tạo `packages/crawl-tiki/.env` từ `.env.example`, sau đó điền:

```env
TIKI_API_TOKEN=
PRODUCT_DATABASE_URL=
```

Không commit file `.env` hoặc ghi token vào log/source code.

## Lệnh

Lấy danh mục thương hiệu ra JSON và quality report:

```powershell
npm run crawl:brands:official -w @bin-ecommerce/crawl-tiki
```

Import file đã kiểm tra vào Product Service:

```powershell
npm run import:brands -w @bin-ecommerce/crawl-tiki
```

Lấy danh mục rồi import trong một lần:

```powershell
npm run import:brands:official -w @bin-ecommerce/crawl-tiki
```

Có thể giới hạn số brand để kiểm tra luồng:

```powershell
npm run crawl:brands -w @bin-ecommerce/crawl-tiki -- --max-brands 20
```

Catalog giới hạn được đánh dấu chưa hoàn tất và không được import nếu không
chủ động truyền `--allow-partial`.

## Luồng dữ liệu

```text
Tiki Open API -> chuẩn hóa brand -> JSON/report -> Product Service.brands
```

Thương hiệu là danh mục dùng chung khi seller đăng sản phẩm; đây không phải
sản phẩm crawl và không tạo bản ghi trong bảng `products`.

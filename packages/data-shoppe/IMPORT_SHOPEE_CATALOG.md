# Import Shopee Catalog

CLI này nhập trực tiếp package ZIP hoặc thư mục catalog Shopee đã giải nén vào các bảng:

- `categories`
- `category_attributes`
- `category_attribute_options`

Importer giữ nguyên UUID ổn định trong package, chạy theo đúng thứ tự quan hệ và có thể chạy lại.
Record đã tồn tại theo UUID sẽ được cập nhật; record chưa tồn tại sẽ được thêm mới. Import không xóa
record không còn xuất hiện trong package.

## Kiểm tra package

```powershell
npm run import:shopee-catalog -- "C:\path\to\shopee-simple-db-import.zip" --validate-only
```

Nguồn dữ liệu đã giải nén dùng cho development nằm tại `data/shopee-catalog`:

```powershell
npm run import:shopee-catalog -- data/shopee-catalog --validate-only
```

Lệnh kiểm tra schema version, source platform, referential integrity, file bắt buộc, record count và
kiểu input attribute mà không kết nối database.

## Import

```powershell
npm run import:shopee-catalog -- "C:\path\to\shopee-simple-db-import.zip"
```

Import dữ liệu development được bundle trong repository:

```powershell
npm run import:shopee-catalog:bundled
```

CLI dùng configuration của product-service và ghi theo thứ tự:

1. Category theo level cha trước, con sau.
2. Root attribute.
3. Root attribute option.
4. Conditional attribute.
5. Conditional attribute option.

Mỗi nhóm được ghi trong transaction riêng. Nếu một nhóm thất bại, transaction của nhóm đó rollback
và CLI dừng; sửa nguyên nhân rồi chạy lại package để tiếp tục an toàn.

## Database development cũ

Product-service đang dùng `synchronize=true` trong giai đoạn development. Database được tạo từ schema
cũ có thể không tự chuyển đổi được sang mô hình hiện tại trong `DATABASE.md`, đặc biệt bảng
`category_attributes`.

Hãy sao lưu dữ liệu cần giữ và reset database/schema development trước khi import. Không reset
database production; trước production phải dùng migration được review.

## Docker development

`docker-compose.yml` của product-service khai báo named volume ổn định
`product-service-postgres-data`. Job `catalog-import` tự chạy sau khi product-service tạo schema và
đạt healthcheck:

```powershell
docker compose up -d --build
```

Importer idempotent nên các lần khởi động tiếp theo không tạo record trùng.

# THIẾT KẾ DATABASE MODULE SẢN PHẨM  
## Phiên bản đơn giản hóa – Category có sẵn cho Seller tạo sản phẩm

## 1. Mục tiêu thiết kế

Thiết kế này phục vụ giai đoạn hiện tại của hệ thống:

- Admin chuẩn bị sẵn cây ngành hàng.
- Admin chuẩn bị sẵn thuộc tính và giá trị lựa chọn của từng ngành hàng.
- Seller không được tạo, sửa hoặc xóa ngành hàng.
- Seller chọn một ngành hàng lá khi tạo sản phẩm.
- Backend dựa vào ngành hàng đã chọn để trả về form thuộc tính động.
- Seller nhập thông tin sản phẩm, biến thể, tồn kho và thuộc tính.
- Chưa quản lý lịch sử file import, batch import, snapshot crawl hoặc đồng bộ nhiều phiên bản dữ liệu.
- Chưa cần tách `attribute_definition` và `category_attribute` thành hai lớp riêng.
- Vẫn giữ `external_*_id` để seed hoặc import lại dữ liệu category mà không tạo bản ghi trùng.

Mô hình ưu tiên sự đơn giản, dễ code bằng NestJS, TypeORM và PostgreSQL nhưng vẫn đủ để mở rộng sau này.

---

## 2. Công nghệ và quy ước

- Database: PostgreSQL 16.
- ORM: TypeORM.
- ID nội bộ: UUID.
- Timestamp: `timestamptz`.
- Tên bảng và cột: `snake_case`.
- Xóa mềm: dùng `deleted_at` cho bảng nghiệp vụ chính.
- Category, attribute và attribute option được quản lý bởi Admin.
- Seller chỉ có quyền đọc các dữ liệu cấu hình này.

### PostgreSQL extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

---

## 3. Enums

```text
shop_status:
- ACTIVE
- INACTIVE
- SUSPENDED

product_status:
- DRAFT
- ACTIVE
- HIDDEN
- DISCONTINUED
- ARCHIVED

variant_status:
- ACTIVE
- HIDDEN
- DISCONTINUED

attribute_input_type:
- TEXT
- TEXTAREA
- INTEGER
- DECIMAL
- BOOLEAN
- DATE
- DATETIME
- SINGLE_SELECT
- MULTI_SELECT

review_status:
- PENDING
- APPROVED
- REJECTED
- HIDDEN
```

Không nên giới hạn thuộc tính chỉ còn `TEXT`, `NUMBER`, `BOOLEAN` vì dữ liệu ngành hàng thực tế còn có ngày tháng, lựa chọn đơn và lựa chọn nhiều.

---

# 4. Sơ đồ quan hệ tổng quát

```text
shops
  └── products
        ├── product_images
        ├── product_variants
        │     ├── inventories
        │     └── product_variant_option_values
        ├── product_options
        │     └── product_option_values
        ├── product_attribute_values
        │     └── product_attribute_selected_options
        └── reviews

categories
  ├── categories
  ├── category_attributes
  │     └── category_attribute_options
  └── products

brands
  └── products
```

---

# 5. Shop

## 5.1. `shops`

Lưu shop của Seller trong hệ thống.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | ID người dùng sở hữu shop |
| `name` | varchar(255) | Not null |
| `slug` | varchar(300) | Not null |
| `avatar_url` | text nullable | |
| `description` | text nullable | |
| `status` | enum `shop_status` | Default `ACTIVE` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
UNIQUE (slug) WHERE deleted_at IS NULL;
INDEX (owner_id) WHERE deleted_at IS NULL;
INDEX (status) WHERE deleted_at IS NULL;
```

Không cần `source_platform` hoặc `external_shop_id` vì hệ thống hiện không import shop từ nền tảng khác.

---

# 6. Ngành hàng do Admin cung cấp

## 6.1. `categories`

Lưu cây ngành hàng nhiều cấp.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `parent_id` | uuid nullable | Self FK `categories.id` |
| `name` | varchar(255) | Not null |
| `slug` | varchar(300) | Not null |
| `level` | integer | Root = 0 |
| `path` | text nullable | Ví dụ `Thời trang > Nam > Áo` |
| `image_url` | text nullable | Ảnh đại diện category |
| `sort_order` | integer | Default 0 |
| `is_leaf` | boolean | Chỉ category lá được chọn khi tạo sản phẩm |
| `is_active` | boolean | Default true |
| `source_platform` | varchar(50) nullable | Ví dụ `shopee` |
| `external_category_id` | varchar(100) nullable | ID category trong dữ liệu nguồn |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
UNIQUE (source_platform, external_category_id)
WHERE external_category_id IS NOT NULL
  AND deleted_at IS NULL;

UNIQUE (parent_id, slug)
WHERE deleted_at IS NULL;

INDEX (parent_id, sort_order)
WHERE deleted_at IS NULL;

INDEX (level)
WHERE deleted_at IS NULL;

INDEX (is_leaf, is_active)
WHERE deleted_at IS NULL;
```

### Quy tắc nghiệp vụ

- Category root có `parent_id = NULL`.
- Chỉ category có `is_leaf = true` mới được Seller chọn khi tạo sản phẩm.
- Backend tự đồng bộ `is_leaf`: category có category con active là node cha; category không còn
  category con active là node lá.
- Khi xác nhận category, backend vẫn kiểm tra không có category con active để chống dữ liệu leaf sai.
- Seller không được tạo, cập nhật hoặc xóa category.
- Category không nên bị xóa cứng nếu đã có sản phẩm.
- Khi Admin ngừng sử dụng category, đặt `is_active = false`.
- `slug` không cần unique toàn hệ thống; chỉ cần unique trong cùng một parent.
- `external_category_id` chỉ dùng để import hoặc seed lại dữ liệu mà không tạo category trùng.

---

# 7. Thuộc tính động theo ngành hàng

Thiết kế đơn giản hóa: mỗi thuộc tính thuộc trực tiếp một category.

Không tách thành:

```text
attribute_definitions
category_attributes
```

vì trong giai đoạn hiện tại hệ thống chỉ cần lấy thuộc tính theo category để tạo form cho Seller.

## 7.1. `category_attributes`

Lưu các trường thông tin mà Seller phải hoặc có thể nhập khi chọn một category.

Ví dụ:

- Thương hiệu.
- Xuất xứ.
- Chất liệu.
- Giới tính.
- Ngày hết hạn.
- Dung tích.
- Loại bảo hành.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `category_id` | uuid | FK `categories.id` |
| `parent_attribute_id` | uuid nullable | Self FK, dùng cho thuộc tính con |
| `trigger_option_id` | uuid nullable | Option làm xuất hiện thuộc tính con |
| `external_attribute_id` | varchar(100) nullable | ID thuộc tính từ dữ liệu nguồn |
| `name` | varchar(255) | Tên dùng trong hệ thống |
| `display_name` | varchar(255) | Tên hiển thị cho Seller |
| `slug` | varchar(300) | Not null |
| `input_type` | enum `attribute_input_type` | Not null |
| `unit` | varchar(50) nullable | Ví dụ `ml`, `kg`, `cm` |
| `placeholder` | varchar(255) nullable | |
| `help_text` | text nullable | |
| `is_required` | boolean | Default false |
| `is_filterable` | boolean | Default false |
| `max_selections` | integer nullable | Dùng cho `MULTI_SELECT` |
| `min_value` | numeric nullable | |
| `max_value` | numeric nullable | |
| `validation_pattern` | text nullable | Regex nếu cần |
| `sort_order` | integer | Default 0 |
| `is_active` | boolean | Default true |
| `metadata` | jsonb | Default `{}` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
UNIQUE (category_id, slug)
WHERE deleted_at IS NULL;

UNIQUE (category_id, external_attribute_id)
WHERE external_attribute_id IS NOT NULL
  AND deleted_at IS NULL;

INDEX (category_id, sort_order)
WHERE deleted_at IS NULL;

INDEX (parent_attribute_id)
WHERE parent_attribute_id IS NOT NULL
  AND deleted_at IS NULL;

CHECK (
  max_selections IS NULL
  OR max_selections > 0
);

CHECK (
  min_value IS NULL
  OR max_value IS NULL
  OR max_value >= min_value
);
```

### Ý nghĩa của `parent_attribute_id` và `trigger_option_id`

Hai trường này chỉ cần dùng khi muốn giữ thuộc tính con có điều kiện.

Ví dụ:

```text
Sản phẩm đặt theo yêu cầu?
  ├── Không
  └── Có
       └── Nội dung người mua cần cung cấp
```

Trong trường hợp trên:

- `Sản phẩm đặt theo yêu cầu?` là thuộc tính cha.
- Option `Có` nằm trong `category_attribute_options`.
- `Nội dung người mua cần cung cấp` có:
  - `parent_attribute_id` trỏ đến thuộc tính cha.
  - `trigger_option_id` trỏ đến option `Có`.

Nếu giai đoạn đầu chưa làm giao diện thuộc tính điều kiện, backend có thể import các trường này nhưng chưa sử dụng.

---

## 7.2. `category_attribute_options`

Lưu danh sách lựa chọn cho thuộc tính `SINGLE_SELECT` hoặc `MULTI_SELECT`.

Ví dụ thuộc tính `Giới tính` có:

- Nam.
- Nữ.
- Unisex.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `attribute_id` | uuid | FK `category_attributes.id` |
| `external_value_id` | varchar(100) nullable | ID option từ dữ liệu nguồn |
| `value` | varchar(255) | Giá trị chuẩn |
| `display_value` | varchar(255) | Giá trị hiển thị |
| `sort_order` | integer | Default 0 |
| `is_active` | boolean | Default true |
| `metadata` | jsonb | Default `{}` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
UNIQUE (attribute_id, value)
WHERE deleted_at IS NULL;

UNIQUE (attribute_id, external_value_id)
WHERE external_value_id IS NOT NULL
  AND deleted_at IS NULL;

INDEX (attribute_id, sort_order)
WHERE deleted_at IS NULL;
```

### Quy tắc nghiệp vụ

- Thuộc tính `TEXT`, `TEXTAREA`, `INTEGER`, `DECIMAL`, `BOOLEAN`, `DATE`, `DATETIME` không cần option.
- Thuộc tính `SINGLE_SELECT` và `MULTI_SELECT` phải có ít nhất một option đang active.
- Seller không được tự tạo option mới trừ khi thuộc tính được thiết kế cho phép nhập tự do.
- Khi option đã được dùng trong sản phẩm, không xóa cứng; chỉ đặt `is_active = false`.

---

# 8. Thương hiệu

## 8.1. `brands`

Lưu danh sách thương hiệu do Admin cung cấp.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `name` | varchar(255) | Not null |
| `slug` | varchar(300) | Not null |
| `logo_url` | text nullable | |
| `description` | text nullable | |
| `is_active` | boolean | Default true |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
UNIQUE (slug)
WHERE deleted_at IS NULL;

INDEX (is_active)
WHERE deleted_at IS NULL;
```

Ở giai đoạn đầu, một brand có thể dùng cho mọi category. Khi cần giới hạn brand theo ngành hàng, bổ sung bảng `category_brands`.

---

# 9. Sản phẩm

## 9.1. `products`

Lưu thông tin chung của sản phẩm.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `shop_id` | uuid | FK `shops.id` |
| `category_id` | uuid | FK `categories.id` |
| `brand_id` | uuid nullable | FK `brands.id` |
| `name` | varchar(500) | Not null |
| `slug` | varchar(600) | Not null |
| `description` | text nullable | |
| `short_description` | text nullable | |
| `status` | enum `product_status` | Default `DRAFT` |
| `min_price` | numeric(14,2) | Default 0 |
| `max_price` | numeric(14,2) | Default 0 |
| `total_sold` | integer | Default 0 |
| `rating_avg` | numeric(3,2) nullable | |
| `review_count` | integer | Default 0 |
| `view_count` | integer | Default 0 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
INDEX (shop_id, status)
WHERE deleted_at IS NULL;

INDEX (category_id, status)
WHERE deleted_at IS NULL;

INDEX (brand_id, status)
WHERE brand_id IS NOT NULL
  AND deleted_at IS NULL;

INDEX (status, created_at DESC)
WHERE deleted_at IS NULL;

INDEX (slug)
WHERE deleted_at IS NULL;

CHECK (min_price >= 0);
CHECK (max_price >= 0);
CHECK (max_price >= min_price);
CHECK (total_sold >= 0);
CHECK (review_count >= 0);
CHECK (view_count >= 0);
CHECK (rating_avg IS NULL OR rating_avg BETWEEN 0 AND 5);
```

### Quy tắc nghiệp vụ

- Seller chỉ được chọn category `is_leaf = true` và `is_active = true`.
- Sản phẩm `DRAFT` có thể chưa đủ thuộc tính bắt buộc.
- Sản phẩm chỉ được chuyển sang `ACTIVE` khi:
  - Có category hợp lệ.
  - Category là category lá.
  - Có tên và mô tả hợp lệ.
  - Có ít nhất một ảnh.
  - Đã nhập đầy đủ thuộc tính bắt buộc.
  - Có ít nhất một variant hợp lệ.
  - Giá và tồn kho hợp lệ.
- Khi đổi category, backend phải kiểm tra và xóa hoặc vô hiệu hóa các `product_attribute_values` không còn thuộc category mới.
- Không cần lưu `source_platform`, `external_product_id` hoặc `source_url` nếu hệ thống chỉ quản lý sản phẩm do Seller tự tạo.

---

## 9.2. `product_images`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `product_id` | uuid | FK `products.id` |
| `variant_id` | uuid nullable | FK `product_variants.id` |
| `image_url` | text | Not null |
| `alt_text` | varchar(255) nullable | |
| `sort_order` | integer | Default 0 |
| `is_thumbnail` | boolean | Default false |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
UNIQUE (product_id)
WHERE is_thumbnail = true
  AND deleted_at IS NULL;

INDEX (product_id, sort_order)
WHERE deleted_at IS NULL;

INDEX (variant_id, sort_order)
WHERE variant_id IS NOT NULL
  AND deleted_at IS NULL;
```

---

# 10. Phân loại sản phẩm và tồn kho

`product_options` là phân loại bán hàng do Seller tạo, ví dụ:

- Màu sắc.
- Kích thước.

Không được nhầm với `category_attributes`, là thông tin mô tả do Admin cấu hình.

## 10.1. `product_options`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `product_id` | uuid | FK `products.id` |
| `name` | varchar(150) | Not null |
| `position` | integer | Default 0 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

```sql
UNIQUE (product_id, name)
WHERE deleted_at IS NULL;
```

---

## 10.2. `product_option_values`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `option_id` | uuid | FK `product_options.id` |
| `value` | varchar(150) | Not null |
| `position` | integer | Default 0 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

```sql
UNIQUE (option_id, value)
WHERE deleted_at IS NULL;
```

---

## 10.3. `product_variants`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `product_id` | uuid | FK `products.id` |
| `sku` | varchar(150) nullable | |
| `name` | varchar(500) | Not null |
| `price` | numeric(14,2) | Not null |
| `original_price` | numeric(14,2) nullable | |
| `weight` | numeric(12,3) nullable | |
| `status` | enum `variant_status` | Default `ACTIVE` |
| `image_url` | text nullable | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

Phương án đơn giản nhất trong giai đoạn đầu là SKU unique toàn hệ thống:

```sql
UNIQUE (sku)
WHERE sku IS NOT NULL
  AND deleted_at IS NULL;

INDEX (product_id, status)
WHERE deleted_at IS NULL;

CHECK (price >= 0);
CHECK (original_price IS NULL OR original_price >= 0);
```

Khi cần cho phép hai shop sử dụng cùng một SKU, có thể bổ sung `shop_id` vào `product_variants` hoặc kiểm tra uniqueness theo shop tại service.

---

## 10.4. `product_variant_option_values`

| Column | Type | Rule |
|---|---|---|
| `variant_id` | uuid | FK `product_variants.id` |
| `option_value_id` | uuid | FK `product_option_values.id` |

```sql
PRIMARY KEY (variant_id, option_value_id);
```

---

## 10.5. `inventories`

Không nên vừa lưu `stock_quantity` trong variant vừa lưu `quantity_available` trong inventory vì dễ lệch dữ liệu.

Phiên bản này chỉ lưu tồn kho tại `inventories`.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `variant_id` | uuid | FK `product_variants.id`, unique |
| `quantity_available` | integer | Default 0 |
| `quantity_reserved` | integer | Default 0 |
| `quantity_sold` | integer | Default 0 |
| `low_stock_threshold` | integer | Default 0 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Constraint:

```sql
UNIQUE (variant_id);

CHECK (quantity_available >= 0);
CHECK (quantity_reserved >= 0);
CHECK (quantity_sold >= 0);
CHECK (low_stock_threshold >= 0);
```

---

# 11. Giá trị thuộc tính của sản phẩm

## 11.1. `product_attribute_values`

Lưu giá trị do Seller nhập cho một thuộc tính của category.

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `product_id` | uuid | FK `products.id` |
| `attribute_id` | uuid | FK `category_attributes.id` |
| `value_text` | text nullable | |
| `value_integer` | bigint nullable | |
| `value_decimal` | numeric nullable | |
| `value_boolean` | boolean nullable | |
| `value_date` | date nullable | |
| `value_datetime` | timestamptz nullable | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Constraint/index:

```sql
UNIQUE (product_id, attribute_id);

INDEX (attribute_id);

CHECK (
  (CASE WHEN value_text IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN value_integer IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN value_decimal IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN value_boolean IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN value_date IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN value_datetime IS NOT NULL THEN 1 ELSE 0 END)
  <= 1
);
```

Đối với `SINGLE_SELECT` và `MULTI_SELECT`, các cột `value_*` để trống và lựa chọn được lưu trong bảng nối.

---

## 11.2. `product_attribute_selected_options`

Lưu option mà Seller chọn.

| Column | Type | Rule |
|---|---|---|
| `product_attribute_value_id` | uuid | FK `product_attribute_values.id` |
| `attribute_option_id` | uuid | FK `category_attribute_options.id` |
| `position` | integer | Default 0 |

```sql
PRIMARY KEY (
  product_attribute_value_id,
  attribute_option_id
);
```

### Quy tắc nghiệp vụ

- `SINGLE_SELECT`: chỉ được có tối đa một dòng option.
- `MULTI_SELECT`: số dòng không vượt quá `category_attributes.max_selections`.
- Option được chọn phải thuộc đúng attribute.
- Attribute phải thuộc category của sản phẩm.
- Seller không được gửi giá trị cho thuộc tính của category khác.
- Thuộc tính `is_required = true` phải có giá trị trước khi publish.

Các quy tắc này nên kiểm tra tại service trong cùng một transaction.

---

# 12. Reviews

## 12.1. `reviews`

| Column | Type | Rule |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid nullable | |
| `product_id` | uuid | FK `products.id` |
| `variant_id` | uuid nullable | FK `product_variants.id` |
| `rating` | integer | 1–5 |
| `content` | text nullable | |
| `images` | jsonb | Default `[]` |
| `status` | enum `review_status` | Default `PENDING` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `deleted_at` | timestamptz nullable | Soft delete |

Constraint/index:

```sql
INDEX (product_id, created_at DESC)
WHERE deleted_at IS NULL;

INDEX (variant_id, created_at DESC)
WHERE variant_id IS NOT NULL
  AND deleted_at IS NULL;

CHECK (rating BETWEEN 1 AND 5);
```

Không cần `source_platform` hoặc `external_review_id` nếu không import review từ hệ thống khác.

---

# 13. Luồng backend khi Seller tạo sản phẩm

## Bước 1: Lấy cây category

```http
GET /categories/tree
```

Chỉ trả category:

```text
is_active = true
deleted_at IS NULL
```

## Bước 2: Seller chọn category lá

Backend kiểm tra:

```text
category.is_leaf = true
category.is_active = true
```

## Bước 3: Lấy form thuộc tính

```http
GET /categories/:categoryId/attributes
```

Dữ liệu trả về gồm:

```json
[
  {
    "id": "uuid",
    "name": "gender",
    "displayName": "Giới tính",
    "inputType": "SINGLE_SELECT",
    "required": false,
    "maxSelections": 1,
    "options": [
      {
        "id": "uuid",
        "value": "male",
        "displayValue": "Nam"
      }
    ]
  }
]
```

## Bước 4: Seller gửi dữ liệu sản phẩm

```http
POST /seller/products
```

Payload nên tách:

```json
{
  "categoryId": "uuid",
  "brandId": "uuid",
  "name": "Tên sản phẩm",
  "description": "Mô tả",
  "attributes": [
    {
      "attributeId": "uuid",
      "value": "Nội dung chữ"
    },
    {
      "attributeId": "uuid",
      "optionIds": ["uuid"]
    }
  ],
  "options": [],
  "variants": [],
  "images": []
}
```

## Bước 5: Backend validate

Backend phải kiểm tra:

1. Category tồn tại, active và là category lá.
2. Attribute thuộc đúng category.
3. Attribute đang active.
4. Kiểu giá trị đúng với `input_type`.
5. Option thuộc đúng attribute.
6. Đủ các thuộc tính bắt buộc khi publish.
7. Không vượt `max_selections`.
8. Variant và tồn kho hợp lệ.

## Bước 6: Lưu transaction

Một lần tạo sản phẩm nên dùng transaction:

```text
products
→ product_images
→ product_options
→ product_option_values
→ product_variants
→ product_variant_option_values
→ inventories
→ product_attribute_values
→ product_attribute_selected_options
```

---

# 14. Mapping dữ liệu category JSON vào database

Không cần bảng quản lý file import.

Importer hoặc seed script chỉ cần xử lý trực tiếp:

| JSON nguồn | Database |
|---|---|
| `category_id` | `categories.external_category_id` |
| `category_name` | `categories.name` |
| `category_raw.path` | tạo cây `categories` |
| `category_path` | `categories.path` |
| `category_raw.images[0]` | `categories.image_url` |
| `attribute_tree[].attribute_id` | `category_attributes.external_attribute_id` |
| `attribute_tree[].display_name` | `category_attributes.display_name` |
| `attribute_tree[].name` | `category_attributes.name` |
| `attribute_tree[].mandatory` | `category_attributes.is_required` |
| `attribute_tree[].attribute_info.max_value_count` | `category_attributes.max_selections` |
| `attribute_tree[].children[].value_id` | `category_attribute_options.external_value_id` |
| `attribute_tree[].children[].name` | `category_attribute_options.value` |
| `attribute_tree[].children[].display_name` | `category_attribute_options.display_value` |

### Upsert key

```text
categories:
(source_platform, external_category_id)

category_attributes:
(category_id, external_attribute_id)

category_attribute_options:
(attribute_id, external_value_id)
```

Nhờ ba khóa trên, seed script có thể chạy lại nhiều lần mà không tạo dữ liệu trùng.

---

# 15. Cấu hình form bán hàng và vận chuyển

Các bảng sau phục vụ trực tiếp Seller Product Center:

- `category_product_policies`: giới hạn ảnh, tên, mô tả, option, variant và điều kiện publish theo category.
- `shipping_channels`: danh sách kênh vận chuyển hệ thống.
- `shop_shipping_channels`: kênh vận chuyển được bật cho từng shop.
- `product_selling_details`: GTIN, video, ảnh mô tả, size chart, tình trạng, preorder và kích thước đóng gói.
- `product_shipping_channels`: kênh vận chuyển được chọn cho product.

`product_selling_details.product_id` là unique và bị xóa cascade theo product.
`shop_shipping_channels` unique theo `(shop_id, channel_id)`.
`product_shipping_channels` unique theo `(product_id, channel_id)`.

Policy mặc định áp dụng khi category chưa có row riêng:

- `min_images = 3`, `max_images = 9`.
- `min_name_length = 25`, `max_name_length = 120`.
- `min_description_length = 100`.
- `max_option_groups = 2`, `max_variants = 100`.
- Bắt buộc condition, package và shipping channel khi `ACTIVE`.

---

# 16. Những bảng chưa cần trong giai đoạn hiện tại

Có thể chưa triển khai:

- `import_batches`.
- `import_category_snapshots`.
- `attribute_definitions`.
- `attribute_translations`.
- `attribute_value_definitions`.
- `attribute_value_translations`.
- `category_brands`.
- Lịch sử thay đổi category.
- Đồng bộ category tự động theo lịch.
- Versioning thuộc tính.

Chỉ thêm các bảng trên khi phát sinh yêu cầu nghiệp vụ thật sự.

---

# 17. Danh sách entity nên code

## Nhóm category

```text
Category
CategoryAttribute
CategoryAttributeOption
```

## Nhóm shop và catalog

```text
Shop
Brand
Product
ProductImage
```

## Nhóm variant và inventory

```text
ProductOption
ProductOptionValue
ProductVariant
ProductVariantOptionValue
Inventory
```

## Nhóm thuộc tính sản phẩm

```text
ProductAttributeValue
ProductAttributeSelectedOption
```

## Nhóm review

```text
Review
```

---

# 18. Thứ tự code đề xuất

```text
1. Category
2. CategoryAttribute
3. CategoryAttributeOption
4. Shop
5. Brand
6. Product
7. ProductImage
8. ProductOption
9. ProductOptionValue
10. ProductVariant
11. ProductVariantOptionValue
12. Inventory
13. ProductAttributeValue
14. ProductAttributeSelectedOption
15. Review
```

Sau khi hoàn thành ba entity đầu tiên, có thể viết seed/import category và xây API:

```text
GET /categories/tree
GET /categories/:id
GET /categories/:id/attributes
```

Sau đó mới xây luồng Seller tạo sản phẩm.

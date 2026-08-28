# Hướng dẫn import category vào database đơn giản hóa

## 1. Dữ liệu đã được chuẩn hóa

Bộ dữ liệu này được chuyển từ JSON Shopee sang đúng các bảng:

- `categories`
- `category_attributes`
- `category_attribute_options`

Tổng số bản ghi:

| Nhóm | Số lượng |
|---|---:|
| Categories | 1,593 |
| Thuộc tính cấp đầu | 15,355 |
| Option cấp đầu | 73,593 |
| Thuộc tính điều kiện | 52 |
| Option điều kiện | 161 |
| Tổng thuộc tính | 15,407 |
| Tổng option | 73,754 |

## 2. Thứ tự import bắt buộc

```text
01_categories.json
        ↓
02_category_attributes_root.json
        ↓
03_category_attribute_options_root.json
        ↓
04_category_attributes_conditional.json
        ↓
05_category_attribute_options_conditional.json
```

Không đổi thứ tự vì `parent_id`, `category_id`, `attribute_id`,
`parent_attribute_id` và `trigger_option_id` là khóa ngoại.

## 3. UUID

Các file đã có sẵn `id` UUID v5 ổn định.

Backend có thể insert/upsert trực tiếp các UUID này. Không cần sinh UUID mới
trong lúc import. Điều này giúp:

- Chạy lại import không tạo bản ghi trùng.
- Khóa ngoại luôn ổn định.
- Có thể import theo batch.
- Dễ dùng `repository.upsert()`.

## 4. TypeORM import mẫu

```ts
import { readFile } from 'node:fs/promises';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

type ImportFile<T> = {
  target_table: string;
  records: T[];
};

async function loadImportFile<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as ImportFile<T>;
  return parsed.records;
}

async function upsertInChunks<T extends ObjectLiteral>(
  dataSource: DataSource,
  entity: EntityTarget<T>,
  records: T[],
  conflictPaths: string[],
  chunkSize = 500,
): Promise<void> {
  const repository = dataSource.getRepository(entity);

  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);

    await repository.upsert(chunk, {
      conflictPaths,
      skipUpdateIfNoValuesChanged: true,
    });
  }
}
```

Cách gọi:

```ts
const categories = await loadImportFile(
  './data/01_categories.json',
);

await upsertInChunks(
  dataSource,
  Category,
  categories,
  ['sourcePlatform', 'externalCategoryId'],
);

const rootAttributes = await loadImportFile(
  './data/02_category_attributes_root.json',
);

await upsertInChunks(
  dataSource,
  CategoryAttribute,
  rootAttributes,
  ['categoryId', 'externalAttributeId'],
);

// Tiếp tục theo đúng thứ tự trong manifest.json.
```

## 5. Mapping tên cột

File JSON dùng `snake_case` giống tên cột PostgreSQL.

Nếu entity TypeORM dùng `camelCase`, hãy map trước khi gọi `upsert()`:

```ts
const entity = {
  id: row.id,
  categoryId: row.category_id,
  parentAttributeId: row.parent_attribute_id,
  triggerOptionId: row.trigger_option_id,
  externalAttributeId: row.external_attribute_id,
  displayName: row.display_name,
  inputType: row.input_type,
  isRequired: row.is_required,
  isFilterable: row.is_filterable,
  maxSelections: row.max_selections,
  sortOrder: row.sort_order,
  isActive: row.is_active,
  metadata: row.metadata,
};
```

## 6. Thuộc tính điều kiện

Dữ liệu nguồn có một số thuộc tính chỉ xuất hiện sau khi Seller chọn option.

Ví dụ:

```text
Sản phẩm đặt theo yêu cầu
└── Có
    └── Nội dung người mua cần cung cấp
```

Các thuộc tính này nằm trong:

```text
04_category_attributes_conditional.json
```

Chúng đã có:

- `parent_attribute_id`
- `trigger_option_id`

Do đó phải import file option cấp đầu trước file thuộc tính điều kiện.

## 7. Quy tắc upsert

```text
categories:
(source_platform, external_category_id)

category_attributes:
(category_id, external_attribute_id)

category_attribute_options:
(attribute_id, external_value_id)
```

Ngoài các khóa trên, có thể upsert theo `id` vì UUID đã ổn định.

## 8. Kiểm tra sau import

```sql
SELECT COUNT(*) FROM categories;
SELECT COUNT(*) FROM category_attributes;
SELECT COUNT(*) FROM category_attribute_options;
```

Kiểm tra khóa ngoại:

```sql
SELECT a.id
FROM category_attributes a
LEFT JOIN categories c ON c.id = a.category_id
WHERE c.id IS NULL;

SELECT o.id
FROM category_attribute_options o
LEFT JOIN category_attributes a ON a.id = o.attribute_id
WHERE a.id IS NULL;
```

Kiểm tra thuộc tính điều kiện:

```sql
SELECT id, display_name, parent_attribute_id, trigger_option_id
FROM category_attributes
WHERE parent_attribute_id IS NOT NULL;
```

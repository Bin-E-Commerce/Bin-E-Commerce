# Phase 2 — pipeline index ảnh catalog

## Trạng thái

Code pipeline đã được triển khai trong Product, Media, AI và Recommendation
Service. Worker mặc định tắt. Kiểm tra chỉ đọc ngày 25/11/2026 xác nhận AI local
đã nạp model đúng contract; alias ảnh Qdrant đang trỏ collection v1 một ảnh với
260 point. Source mới dùng v2 MaxSim tối đa năm ảnh/product nhưng chưa triển khai
hoặc backfill v2 trong lần review này. Không suy ra trạng thái runtime từ source.

Phase này chỉ ghi vector ảnh sản phẩm. API tìm ảnh cho khách, hợp nhất kết quả
ảnh + chữ, filter storefront và giao diện thuộc các phase tiếp theo.

## Dòng dữ liệu

1. Product phát `primaryImageMedia` trong event catalog tùy chọn; ảnh đại diện
   được chọn theo `sortOrder`, asset ưu tiên `aiAssetId`, sau đó `sourceAssetId`.
   Owner/asset được lấy từ Product DB, không suy ra từ URL CDN.
2. Consumer group
   `recommendation-product-image-index-v1` đọc cùng catalog topics nhưng có
   offset, retry và lifecycle riêng với text/catalog projection.
3. Mỗi event chỉ là tín hiệu. Recommendation đọc snapshot hiện tại từ Product,
   kiểm tra `ACTIVE` và revision dạng số, chọn tối đa năm asset gallery duy nhất
   theo `sortOrder`, rồi ID ảnh, tải asset qua Media bằng owner/asset ID,
   rồi gọi AI Service với raw image bytes.
4. AI xác thực MIME, magic bytes, decode, số pixel và ảnh động; PE-Core ONNX xử
   lý cùng preprocessing contract cho mọi ảnh và trả vector L2-normalized kèm
   `modelVersion`, `preprocessVersion` và dimension.
5. Recommendation chỉ ghi vector 512 chiều vào collection vật lý riêng của
   Qdrant với schema multivector `max_sim`. Mỗi truy vấn chỉ chứa một vector nên
   điểm product là cosine cao nhất trong gallery. Tombstone giữ revision và vector cho point đã tồn tại; event worker đọc
   snapshot Product mới nhất và dùng revision guard, nhưng đọc Product và ghi
   Qdrant không nguyên tử nên không bảo đảm loại mọi race giữa nhiều instance.
   API tìm kiếm ở Phase 3 phải xác minh lại revision candidate hiện hành trong
   Product trước khi trả kết quả.
6. Operator chạy backfill từng trang `1..25` bằng cursor. Trang chỉ được xác
   nhận sau khi mọi sản phẩm trong batch hoàn tất; gọi tiếp với `nextCursor`.

Vector chữ hiện tại 1536 chiều vẫn ở collection text riêng. Không so sánh hoặc
ghi chéo hai vector space.

## Internal contracts

### Product Service

- `GET /api/v1/internal/products/catalog-image-snapshot?limit=25&afterProductId=<uuid>`
  trả `{ items, nextCursor }`; `limit` tối đa 25.
- `GET /api/v1/internal/products/catalog-image-snapshot/:productId` trả trạng
  thái, `catalogRevision`, `images` (tối đa năm reference) và
  `primaryImageMedia` giữ tương thích contract cũ. Cả hai route dùng
  `x-internal-service-token` như internal Product routes hiện có.
- Contract bootstrap catalog offset cũ không đổi.

### AI Service

- `GET /api/v1/search-ranking/image-embedding/status` yêu cầu internal token và
  xác nhận `modelVersion`, `dimensions=512`, `preprocessVersion`.
- `POST /api/v1/search-ranking/image-embedding` nhận raw JPEG/PNG/WebP bytes, có
  `Content-Type` đúng và internal token; trả
  `{ modelVersion, dimensions, preprocessVersion, vector }`. Recommendation từ
  chối response sai model, preprocessing hoặc dimension.
- Tối đa 8 MiB và 20 triệu pixel; animation, MIME/magic mismatch, file lỗi,
  output sai chiều hoặc vector không hữu hạn bị từ chối.
- Model không có tại startup thì chỉ image embedding unavailable; AI text routes
  vẫn khởi động. Không tải model trong API startup.

### Recommendation Service

- `POST /api/v1/recommendation/catalog/image-index/backfill`
  yêu cầu internal token; body ví dụ:

    ```json
    { "limit": 25, "afterProductId": "10000000-0000-4000-8000-000000000001" }
    ```

- Worker và backfill chỉ hoạt động khi `IMAGE_SEARCH_ENABLED=true`, AI status khớp
  model/preprocessing contract và Qdrant physical collection đã sẵn sàng. Alias
  hiện có có thể tiếp tục trỏ collection phiên bản cũ trong khi backfill version
  mới.
- Backfill response gồm `processed`, `skipped`, `nextCursor`. Không đưa owner ID,
  asset ID, image bytes, URL hoặc product ID vào metrics/log.
- Event lỗi retry theo chính sách Kafka hiện tại; sau số lần retry hiện hành sẽ
  vào `recommendation.catalog.dlq.v1`. Chạy backfill lại để sửa lệch/incomplete.

## Model và artifact

Model dùng `timm/vit_pe_core_small_patch16_384.fb`, revision
`255fa76e26fdf8daa47e0d607da46b7051879045`; PE-Core S/16 công bố input 384px và
projection 512 chiều. Exporter tải checkpoint chỉ khi operator chạy thủ công:

```powershell
cd services/ai-service
python -m pip install -e ".[image-search-export]"
python scripts/export_image_search_model.py --output artifacts/image-search/pe-core-s16-384.onnx
```

Exporter tạo ONNX cùng sidecar `.meta.json`, bao gồm revision, checksum và
preprocessing fields. Cấp cả hai file vào AI Service ở vị trí read-only rồi đặt:

```text
IMAGE_SEARCH_MODEL_PATH=/path/to/pe-core-s16-384.onnx
IMAGE_SEARCH_MODEL_VERSION=pe-core-s16-384-r255fa76e
IMAGE_SEARCH_DIMENSIONS=512
IMAGE_SEARCH_IMAGE_SIZE=384
```

Không chạy lệnh exporter trong môi trường này vì nó tải model từ Hugging Face,
cần PyTorch và tạo artifact chưa được cấp cho runtime. Phải chọn cách cấp artifact
(image layer hoặc read-only volume) ở bước triển khai hạ tầng; repo chưa đổi
deployment config.

Recommendation dùng alias mặc định
`recommendation_product_image_embeddings_current`. Physical collection name là
`<alias>_v<version>_<spaceFingerprint>`, trong đó fingerprint là 12 ký tự đầu của
SHA-256 trên chuỗi `<modelVersion>:<preprocessVersion>:512`. Vì vậy model hoặc
preprocessing đổi thì collection đổi ngay cả khi operator quên tăng version.
Cấu hình mặc định dùng alias `recommendation_product_image_embeddings_current`
và version `2`. Indexer ghi/tombstone trên physical collection; alias chỉ được
tự tạo từ luồng indexing nếu chưa tồn tại. Request tìm kiếm không tạo collection,
index hoặc alias; chỉ đọc khi alias trỏ đúng collection physical đã cấu hình và
schema khớp Cosine/MaxSim 512 chiều. Nếu alias còn trỏ v1, source v2 trả lỗi
dependency để Product dùng text fallback khi có mô tả; image-only trả 503.
Khi nâng model/schema, worker backfill collection mới trong khi deployment cũ
phục vụ traffic. Sau khi xác minh coverage/event catch-up,
operator chuyển alias bằng một request Qdrant atomic. Ví dụ dưới đây giả sử
fingerprint của model/preprocess mới là `abc123456789`:

```http
POST /collections/aliases
Content-Type: application/json

{
  "actions": [
    { "delete_alias": { "alias_name": "recommendation_product_image_embeddings_current" } },
    {
      "create_alias": {
        "collection_name": "recommendation_product_image_embeddings_current_v2_abc123456789",
        "alias_name": "recommendation_product_image_embeddings_current"
      }
    }
  ]
}
```

Các biến Recommendation cần cấu hình:

```text
IMAGE_SEARCH_ENABLED=true
IMAGE_SEARCH_MODEL_VERSION=pe-core-s16-384-r255fa76e
IMAGE_QDRANT_COLLECTION_VERSION=2
IMAGE_SEARCH_MIN_SIMILARITY_SCORE=0.75
AI_SERVICE_URL=http://ai-service:3009
PRODUCT_SERVICE_URL=http://product-service:3008
MEDIA_SERVICE_URL=http://media-service:3004
INTERNAL_SERVICE_TOKEN=<shared internal token>
```

Sau khi model status sẵn sàng, collection vật lý đúng schema và catalog topics có
quyền consume, gọi batch endpoint liên tục cho đến `nextCursor=null`. Consumer
group mới subscribe với `fromBeginning=true`, nên có thể replay mọi event còn
trong thời gian retention trước khi bắt kịp hiện tại. Sau backfill, event consumer
tiếp tục xử lý thay ảnh, inactive và deleted. Lỗi hạ tầng đã hết lượt retry giữ
offset để Kafka phát lại. Event sai cú pháp hoặc schema chỉ tiến offset sau khi
ghi DLQ và được đếm riêng. Hiện chưa có partition lag metric hoặc barrier tự
động để chứng minh catch-up.

## Giới hạn tài nguyên và an toàn

- Recommendation giữ tối đa năm ảnh gallery/product, inference và backfill tuần tự;
  một batch tối đa 25 sản phẩm. Media và Recommendation cùng chặn object quá
  8 MiB; AI streaming HTTP body có cùng giới hạn. Ảnh chỉ nằm trong RAM để chạy
  request, không ghi file hoặc cache bytes.
- Gallery fingerprint không đổi thì vector được tái sử dụng; revision-only update
  chỉ cập nhật payload có điều kiện. Gallery thay đổi hiện tạo lại cả gallery tối
  đa năm ảnh; chưa có cache riêng từng asset. Asset 404, ảnh quá lớn, sai định
  dạng hoặc bị AI trả lỗi 422 được bỏ qua. Lỗi hạ tầng dừng batch để retry. Asset
  bị bỏ qua nhưng sau đó phục hồi cùng ID cần reindex chủ động vì fingerprint
  gallery không đổi.
- Qdrant point chỉ lưu product ID, revision, model/preprocess version, trạng thái
  index và SHA-256 fingerprint của owner/asset reference. Giá, tồn kho và thuộc
  tính storefront được đọc từ Product cho từng trang kết quả. Ứng viên của phiên
  đang mở vẫn hợp lệ khi chỉ đổi giá hoặc tồn kho. Product kiểm tra lại trạng
  thái và gallery hiện tại trước khi trả kết quả.
- Khi đổi model/preprocessing, export version mới, tạo physical collection mới,
  backfill và chỉ promote alias sau khi kiểm tra. Không ghi model mới vào collection
  cũ có dimension/space khác; alias đang chạy tiếp tục trỏ collection cũ trong
  suốt quá trình backfill.
- Một triệu vector float32 512 chiều cần khoảng 2.048 byte/vector thô (xấp xỉ
  1,91 GiB), chưa gồm payload/index/replica của Qdrant. Phí API model là $0; chi
  phí thực tế là CPU/RAM AI Service, lưu trữ Qdrant và hạ tầng hiện có.
- Cần đo RSS/p50/p95, thời gian index mỗi sản phẩm và coverage trước khi bật ở
  catalog lớn. Không có bộ ảnh/query được gán nhãn trong repo nên chưa có số
  Recall@10 hoặc NDCG@10; evaluator và đánh giá chất lượng thuộc bước sau.

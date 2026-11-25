# Kế hoạch và thiết kế tìm sản phẩm bằng hình ảnh

**Trạng thái:** Phase 1 đã được rà soát; Phase 2 có pipeline index nội bộ nhưng
mặc định chưa kích hoạt; Phase 3 backend và Phase 4 Web UI image search đã
triển khai. Trước khi chạy thật cần cấp PE-Core artifact cho AI Service, bật
`IMAGE_SEARCH_ENABLED`, backfill collection ảnh và đánh giá bằng query có nhãn.
Chi tiết pipeline Phase 2 nằm trong [phase-2-image-index.md](./phase-2-image-index.md).

## Mục tiêu và ranh giới dữ liệu

- Khách chọn một ảnh, xem preview trong trình duyệt và chủ động bấm tìm sản phẩm
  có hình ảnh tương tự.
- Có thể kết hợp query chữ và bộ lọc storefront như danh mục, shop, giá, đánh
  giá, còn hàng và sắp xếp.
- Chỉ Product Service quyết định sản phẩm public, giá và tồn kho. Recommendation
  chỉ đưa candidate IDs; Product Service kiểm tra lại `ACTIVE`, giá variant và
  lượng bán được hiện hành trong PostgreSQL trước mỗi response.
- Vector ảnh tách riêng khỏi vector chữ `text-embedding-3-small` 1536 chiều.
  Khi có mô tả chữ, Product chỉ giữ ứng viên ảnh khớp trực tiếp với dữ liệu
  catalog. Tìm bằng chữ thông thường giữ luồng xếp hạng riêng.
- Ảnh truy vấn chỉ đi trong request RAM, không ghi file. Phase 3 đã thêm cache
  vector RAM bounded theo SHA-256 bytes + MIME + model/preprocess version, tối đa
  256 vector float32 và TTL 10 phút; không giữ bytes ảnh. Cache miss, TTL/eviction
  hoặc model đổi thì encode lại; request cùng key được single-flight. Web UI
  POST khi khách chủ động tìm ảnh; đổi text/filter/page dùng GET cùng session,
  không upload ảnh lại. Recommendation Redis session lưu tối đa 500 candidate
  metadata trong 10 phút.
- Không thêm migration, API tính phí hoặc dịch vụ mới trong thiết kế hiện tại.
  Cần bổ sung tương thích ngược media reference vào event catalog và endpoint
  snapshot nội bộ; collection ảnh dùng Qdrant hiện có, model tự host dùng AI
  Service hiện có.

## Kết quả rà soát kiến trúc repo

- Web tìm kiếm nằm trong `web/src/features/product-search`; URL đang giữ query,
  filter, sort và page. Client catalog thuộc `web/src/services/product`.
- API Gateway public proxy ở
  `services/api-gateway/src/modules/product/product-proxy.controller.ts`.
  Proxy dùng `req.body`, vì vậy hai entrypoint Gateway và Product cần raw parser
  riêng, giới hạn body và giữ `Content-Type` ảnh.
- Trước Phase 2, catalog event chỉ có `imageUrl` và `catalogRevision`, thiếu
  `ownerId`/`assetId` có cấu trúc để Media download an toàn. Phase 2 đã thêm
  `primaryImageMedia` tùy chọn vào event và `catalog-image-snapshot` nội bộ, lấy
  owner từ `Product.sellerOwnerId` cùng asset ID đã xác minh. Ảnh đại diện chọn
  theo `sortOrder`, ưu tiên `aiAssetId`, rồi `sourceAssetId`; không suy ra asset từ
  URL. Event cũ thiếu reference được bỏ qua an toàn. Đây là contract nội bộ, không
  thêm cột hoặc migration DB.
- `catalogRevision` là PostgreSQL `bigint` nhưng được truyền dưới dạng chuỗi.
  Worker phải so sánh theo giá trị số (`BigInt` hoặc SQL `bigint`), không so
  chuỗi từ điển. Revision có thứ tự trong từng product, không phải watermark
  toàn cục cho các topic.
- Recommendation Service duy trì snapshot catalog PostgreSQL cho text projection
  và có adapter Qdrant, Redis, Media client. Riêng image indexer lấy snapshot mới
  trực tiếp từ Product để backfill/event processing.
- Recommendation catalog consumer xử lý projection chữ; image indexing dùng
  consumer group riêng để tải Media/AI không giữ offset projection. Consumer ảnh
  dùng `KafkaEventProcessor` và DLQ/retry policy hiện có, cùng hàng đợi tuần tự có
  giới hạn trong từng process; chưa có Redis lock hay retry policy riêng.
- Image indexer đọc snapshot authoritative trực tiếp từ Product qua
  `catalog-image-snapshot`; catalog bootstrap Recommendation không phải điều kiện
  của backfill ảnh. Bootstrap vẫn có thể cần cho text-search projection. Revision
  được kiểm tra ở Product và lưu trong Qdrant, nhưng đọc revision và ghi Qdrant
  không phải một transaction. Vì vậy đây là eventual consistency, không cam kết
  loại bỏ mọi race xuyên nhiều instance. Product image search so `catalogRevision`,
  trạng thái và fingerprint gallery với Product hiện tại trước khi ứng viên
  được xếp hạng. Ảnh stale bị loại tới khi index hội tụ.
- DTO storefront hiện có trường `status` tùy chọn. API image search public phải
  dùng allowlist filter, bỏ `status` và luôn áp `ProductStatus.ACTIVE` ở Product
  Service; không chuyển nguyên DTO này để người gọi yêu cầu sản phẩm ẩn.
- Tồn kho bán được nằm trong `inventories.quantity_available`; thao tác tồn kho
  lưu `product_variants.stock_quantity = quantity_available + quantity_reserved`,
  nên tổng vật lý có thể gồm toàn bộ hàng đang giữ chỗ. Sau review Phase 3, cả
  storefront search thông thường lẫn luồng ảnh/fallback đều lọc `inStock` bằng
  `quantity_available > 0` trên variant ACTIVE. Thiếu inventory row thì không đủ
  bằng chứng còn hàng và sản phẩm bị loại; không dùng `stock_quantity` hoặc cờ
  `isInStock` của Recommendation.
- Giá storefront đang lọc summary `products.min_price/max_price`, còn giá bán
  hiển thị lấy variant ACTIVE hiện hành. Summary được cập nhật trong luồng sửa
  variant price; image search phải giữ cùng semantics storefront trên Product DB:
  `maxPrice >= minPrice` và `minPrice <= maxPrice` theo summary hiện hành. Không
  lấy summary đã copy sang Recommendation/Qdrant; không âm thầm đổi sang predicate
  khác theo từng variant trong riêng luồng ảnh.
- AI Service Kubernetes hiện chưa cấu hình `IMAGE_SEARCH_MODEL_PATH`, volume hay
  artifact PE-Core. Model tự host chưa thể chạy chỉ bằng thay đổi code; cần đóng
  gói artifact vào image hoặc mount read-only trước rollout.
- Media original image upload giới hạn 5 MiB, còn output AI legacy có thể tới
  8 MiB. Phase 2 đã thêm cap 8 MiB ở Media trước khi materialize S3 body và giữ
  inference/backfill tuần tự trong mỗi Recommendation process. Phase 3 đã giới hạn
  query upload ở Nginx, Gateway và Product Service ở 5 MiB; nhiều instance vẫn
  nhân tổng RAM cap.
- Media Service có endpoint nội bộ tải asset theo asset ID, owner ID và
  `purpose=product_image`; Recommendation chỉ dựng URL cố định của Media từ
  owner/asset reference trong đường dẫn được quản lý. Không fetch URL do catalog
  tùy ý cung cấp.
- Giá gốc nằm trên `product_variants.price`; `products.min_price/max_price` là
  summary storefront được cập nhật khi variant price đổi. Tồn có thể bán nằm
  trên `inventories.quantity_available`; `product_variants.stock_quantity` là
  tổng vật lý gồm cả reserved, không đồng nghĩa hàng sẵn bán.
- Lần rà repo ban đầu chưa có labeled query hoặc evaluator image search. Phase 6
  đã thêm evaluator JSONL; dataset nhãn và model/index vẫn chưa sẵn sàng nên chưa
  thể báo Recall@10/NDCG@10 đại diện.

## Lựa chọn model và phương án

| Phương án                                                  | Nhận xét                                                                                    | Quyết định                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Tái dùng `text-embedding-3-small`                          | Model hiện tại tạo vector chữ 1536 chiều, không encode ảnh.                                 | Giữ cho text search; không dùng làm image vector.                                        |
| Tự host PE-Core-S16-384 qua ONNX CPU                       | Image encoder ứng viên; cấu hình công bố CLIP image projection 512 chiều; không có phí API. | Khuyến nghị cho prototype; production phụ thuộc export, benchmark và labeled evaluation. |
| Dịch vụ API mới: Gemini Embedding 2 (`gemini-embedding-2`) | Image và text embeddings dùng chung vector space; cần credential và gửi ảnh ra ngoài.       | Không chọn bản đầu; có chi phí theo token và phụ thuộc nhà cung cấp.                     |

PE-Core checkpoint dự kiến là `timm/vit_pe_core_small_patch16_384.fb`, revision
`255fa76e26fdf8daa47e0d607da46b7051879045`; model card ghi 23,8 triệu tham số
F32 và license Apache-2.0. Tài liệu PE-Core công bố CLIP dimension 512 cho S/16;
cấu hình `timm` đặt output projection `num_classes=512`. Chiều ONNX sau export,
preprocess và normalization cụ thể vẫn phải xác minh bằng artifact. Ảnh
query/catalog phải dùng đúng cùng model và pipeline.
[Model card](https://huggingface.co/timm/vit_pe_core_small_patch16_384.fb),
[bảng PE-Core chính thức](https://github.com/facebookresearch/perception_models/blob/main/apps/pe/README.md),
[cấu hình `timm`](https://github.com/huggingface/pytorch-image-models/blob/main/timm/models/eva.py).

Theo bảng giá Google Cloud đối chiếu ngày 2026-11-23, Gemini Embedding 2 có giá
$0.45/1M token online và $0.225/1M token batch. Tài liệu API hiện tính 258 token
mỗi ảnh; với giả định một ảnh mỗi request, 100.000 ảnh index tốn khoảng $11.61
online hoặc $5.805 batch; một triệu ảnh tốn khoảng $116.10 online hoặc $58.05
batch. 10.000 ảnh truy vấn/tháng tốn khoảng $1.161 online, chưa tính text tokens
cho truy vấn hỗn hợp. Model docs hiện đánh dấu `gemini-embedding-2` GA, trong khi
bảng giá vẫn ghi nhãn Unified Multimodal Preview; cần xác nhận model ID/region
trên tài khoản trước khi chọn phương án API. Các số trên chưa gồm Qdrant
storage/compute/network. [Tài liệu model](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/embedding-2),
[quy tắc token ảnh](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-multimodal-embeddings),
[bảng giá chính thức](https://cloud.google.com/model-garden/pricing).

## Luồng dữ liệu đề xuất

### Index ảnh catalog

1. Product event giữ `catalogRevision` và bổ sung `primaryImageMedia` có cấu trúc
   (`ownerId`, `assetId`, `purpose`) cho ảnh đại diện; fingerprint không nằm trong
   event mà được Recommendation tính từ reference. Endpoint Product nội bộ
   `catalog-image-snapshot` trả cùng reference khi chạy backfill, có phân trang
   keyset theo `afterProductId`. Không suy ra owner bằng URL hoặc gọi URL tùy ý.
   Nếu ảnh không có media reference được xác minh thì bỏ qua và đếm metric.
2. Image-index worker chạy trong consumer group riêng trên các topic catalog,
   không nằm trong consumer cập nhật text/catalog snapshot. Worker đọc Product
   snapshot mới nhất và kiểm tra lại sau encode. Hàng đợi hiện tuần tự trong từng
   process; Qdrant revision read và mutation không nguyên tử nên update/delete có
   thể chen giữa hai bước, nhất là khi có nhiều instance. Đây là đồng bộ eventual
   consistency. Phase 3 phải so `catalogRevision` candidate với Product hiện tại
   trước khi trả kết quả; candidate revision cũ bị loại cho tới khi index hội tụ.
3. Khóa tham chiếu media idempotent hiện là SHA-256 của `ownerId:assetId` với
   `purpose=product_image` cố định; đây là fingerprint reference, không phải hash
   nội dung file. Payload Qdrant lưu product ID, revision, model/preprocess
   version, trạng thái index và media fingerprint; không lưu giá, tồn kho, URL,
   owner ID hay bytes ảnh.
4. Recommendation tải ảnh bằng service token và owner scope từ Media, giới hạn
   8 MiB cho asset catalog, rồi gửi bytes trong bộ nhớ đến AI Service. Query
   upload public giữ giới hạn riêng 5 MiB. AI xác thực MIME, magic bytes, decode,
   loại ảnh động, giới hạn 20 triệu pixel và chuẩn hóa cùng một pipeline cho cả
   catalog và query: cùng resize/crop, normalization, L2-normalize vector, kiểm
   tra finite/non-zero và chiều 512. Media client/endpoint phải enforce byte cap
   trước khi materialize S3 body vào Buffer; cap sau khi response về không bảo vệ
   Media process khỏi object legacy quá lớn.
5. AI dùng ONNX CPU cục bộ. Model thiếu/sai artifact sẽ tắt riêng tính năng ảnh;
   text search vẫn hoạt động. Không tự tải model khi service khởi động.
6. Recommendation ghi một vector/product vào physical collection ảnh riêng, tách
   khỏi collection chữ. Tên collection gồm version vận hành và hash của
   `modelVersion`, preprocessing version, dimension; đổi model hoặc preprocess
   sẽ tạo physical collection khác ngay cả khi quên tăng version vận hành.
   Adapter xác minh cosine/512, chỉ tạo alias lần đầu và không tự chuyển alias
   khi rollout. Product inactive/deleted nhận tombstone `indexable=false`; vector
   vẫn được giữ để lưu revision, nên truy vấn phải lọc `indexable=true`. Cần có
   chính sách dọn tombstone/collection cũ sau khi không còn cần revision fence.
7. Backfill đọc Product `catalog-image-snapshot` theo cursor, tối đa 25 sản phẩm
   mỗi trang; không cần Recommendation catalog bootstrap cho image indexing.
   Event consumer và backfill cùng queue tuần tự trong mỗi process. Nếu một sản
   phẩm trong trang lỗi, request dừng và operator gọi lại cùng cursor; các điểm
   đã ghi trước đó được nhận diện idempotent.
8. Consumer group ảnh có offset riêng, commit sau processor và khi group mới sẽ
   replay phần topic còn retained (`fromBeginning=true`). Rollout cần theo dõi
   lượng replay/event lag, hoàn tất backfill/catch-up và kiểm tra coverage trước
   khi operator chuyển alias. Hiện chưa có lag metric theo partition hoặc barrier
   cutover tự động, nên alias không được promote chỉ vì collection đã sẵn sàng.
   Model mismatch hoặc collection không tương thích thì đánh dấu image search
   chưa sẵn sàng, không ảnh hưởng text search.

Một vector float32 512 chiều chiếm 2.048 byte thô. Với 100.000 ảnh catalog,
vector thô xấp xỉ 205 MB trước HNSW, payload, WAL và overhead Qdrant. Mỗi sản
phẩm hiện chỉ index ảnh đại diện đầu tiên; chưa index ảnh phụ/ảnh variant.

### Tìm kiếm và API Phase 3

| API                                                                                         | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/products/image-searches`                                                      | Public qua Gateway. Body raw JPEG/PNG/WebP tối đa 5 MiB; query params allowlist: `search`, `categoryId`, `sellerShopId`, `minPrice`, `maxPrice`, `minRating`, `inStock`, `sort`, `page`, `pageSize`. `page >= 1`, `pageSize` 1–100 (mặc định 20), theo DTO storefront hiện có. Không nhận `status`; Product luôn ép `ACTIVE`. `minPrice > maxPrice` trả 400. Trả `{ searchId, mode, items, total, page, pageSize, totalPages }`; `searchId` bắt buộc ở `IMAGE`/`IMAGE_AND_TEXT`, null ở `TEXT_FALLBACK`. |
| `GET /api/v1/products/image-searches/:searchId`                                             | Public qua Gateway. Cùng allowlist filter/page/sort; không gửi ảnh và không nhận `status`. `page >= 1`, `pageSize` 1–100 (mặc định 20). Session hết hạn sau 600 giây. Nếu hết hạn có text query, trả `TEXT_FALLBACK` với `searchId: null`; nếu image-only trả 410.                                                                                                                                                                                                                                       |
| `POST /api/v1/search-ranking/image-embedding`                                               | Internal route đã có ở Phase 2; raw image → `{ modelVersion, dimensions, preprocessVersion, vector }`. Service token bắt buộc; caller từ chối vector sai model/preprocess/dimension.                                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/recommendation/catalog/image-search/candidates`                               | Nội bộ Product → Recommendation; `{ modelVersion, preprocessVersion, vector, limit }`, vector đúng PE-Core 512 chiều → candidate IDs/rank/revision/fingerprint từ collection ảnh riêng. Product đọc lại Product DB và chỉ giữ candidate hiện ACTIVE, đúng revision và primary media reference.                                                                                                                                                                                                           |
| `POST /api/v1/recommendation/catalog/image-search/sessions` và `GET .../sessions/:searchId` | Nội bộ; lưu/đọc tối đa 500 candidate metadata trong Redis 10 phút; Redis miss khác với Redis outage.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `POST /api/v1/recommendation/catalog/image-index/backfill`                                  | Internal route đã có ở Phase 2; nhận `limit` 1–25 và `afterProductId` tùy chọn, trả `{ processed, skipped, nextCursor }`.                                                                                                                                                                                                                                                                                                                                                                                |

Giữ validation storefront hiện tại cho query/filter: search tối đa 120 ký tự,
category/shop là UUID, giá không âm tối đa 2 chữ số thập phân, rating 0–5,
`sort` theo enum và `inStock` là boolean; bổ sung kiểm tra chéo
`minPrice <= maxPrice`. Chỉ nhận một ảnh trong mỗi request.

Query text đi qua query string; Nginx tắt access log riêng cho POST/GET image
search, còn Gateway/Product telemetry dùng route template. Không log raw body,
bytes/hash ảnh, query, product ID hoặc session token.

Request đầu tiên tạo embedding ảnh một lần. Session giữ ID/rank/điểm cosine
trong 600 giây để đổi trang, bộ lọc hoặc mô tả chữ. Recommendation giữ ngưỡng
cosine tuyệt đối. Product xác minh ảnh và áp mô tả chữ cùng bộ lọc từ DB, rồi
giữ các ứng viên cách điểm tốt nhất còn hợp lệ tối đa 0,05 trước phân trang.
Không có ứng viên thỏa cả ảnh và chữ thì trả kết quả rỗng. Text fallback chỉ
chạy khi dependency ảnh lỗi hoặc session hết hạn và có mô tả chữ.
`relevance` giữ thứ tự theo ảnh. Các cách sắp xếp khác dùng dữ liệu Product
hiện hành và ID để phá hòa ổn định. Top-K có giới hạn và cần hiệu chỉnh bằng
evaluator. Filter giá giữ nguyên predicate storefront trên summary Product DB
hiện hành (`maxPrice >= minPrice`, `minPrice <= maxPrice`). `inStock` dùng
`inventories.quantity_available` của active variants; thiếu inventory thì loại
sản phẩm khỏi kết quả. Không dùng `stock_quantity` vì gồm hàng reserved. `total`
đếm kết quả hợp lệ trong pool; có thể trả ít hơn `pageSize` dù catalog còn
sản phẩm khác ngoài top-K.

Nếu AI/Qdrant/session Redis lỗi và có text query, trả `mode=TEXT_FALLBACK`,
`searchId=null` và trang từ endpoint storefront search hiện tại. Web dùng route
tìm chữ hiện hữu cho page/filter tiếp theo; không giả kết quả đó là image match.
Image-only lỗi hạ tầng trả 503, ảnh sai (bao gồm AI Service trả 422 khi xác thực
bytes) trả 400; session image-only hết TTL trả 410. `searchId` là token ngẫu
nhiên khó đoán, không chứa user ID; session chỉ lưu
candidate IDs và hết hạn sau 600 giây.

### Bảo mật, giới hạn và fallback

- Chỉ chấp nhận một ảnh JPEG, PNG hoặc WebP. Browser kiểm tra loại/kích thước sơ
  bộ; Product/Gateway giới hạn body 5 MiB; AI kiểm tra bytes thật, file hỏng,
  ảnh động, kích thước pixel và decompression bomb.
- Ảnh chỉ được giữ trong request RAM; UI preview dùng object URL và thu hồi khi
  xóa/đổi ảnh. Vector query chỉ được cache RAM bounded 10 phút ở AI Service; không
  ghi ảnh/vector ra đĩa hoặc Redis. Không ghi bytes, hash ảnh, tên file, URL ảnh,
  query text hoặc user ID vào image-search logs/metrics.
- Gateway áp rate limit POST ảnh 10 lần/phút/IP và giới hạn 2 upload đồng thời
  mỗi process bằng middleware chạy trước raw parser, nên request vượt ngưỡng bị
  từ chối trước khi body chiếm RAM. Nginx áp `limit_conn` 2/IP,
  `client_max_body_size 5m`, tắt access
  log cho image-search routes và `proxy_request_buffering off`; Gateway/Product
  raw parser cũng giới hạn 5 MiB. Kubernetes ingress và resource limits chưa đổi.
- AI HTTP middleware ghi route/status/latency; cache phát hit/miss/wait với label
  bounded; Recommendation ghi outcome/lỗi/queue depth/duration; Gateway/Product có
  HTTP observability. Phase 6 bổ sung evaluator JSONL và unit tests cho Recall@10,
  NDCG@10, filter compliance, p50/p95; dataset nhãn do người đánh giá chuẩn bị
  riêng. Báo cáo không lưu query, ảnh, user, product ID hoặc URL. Model chạy local
  không có phí provider; cần benchmark CPU/RAM và p50/p95 khi cấp artifact.
- Model/Qdrant/Redis lỗi trong POST có chữ trả `TEXT_FALLBACK` bằng storefront
  search hiện tại, `searchId=null`; Web tiếp tục phân trang qua route tìm chữ
  hiện hữu. Lỗi session GET cũng chuyển cùng mode khi còn query chữ. Image-only
  lỗi hạ tầng trả 503, session hết TTL trả 410, ảnh không hợp lệ trả 400. Không
  giả danh kết quả chữ là kết quả giống ảnh.
- Thẻ hiển thị sản phẩm catalog hiện hữu. Chỉ có nhãn trung tính cho mode
  image+text; không tạo lý do khớp, thuộc tính, giá hoặc tồn kho bằng AI.

## Chi phí và kế hoạch vận hành

- Phí API embedding/index/query: **$0** với model tự host đã chọn. Chi phí vận
  hành là CPU/RAM AI Service, model artifact, và dung lượng Qdrant hiện hữu.
- Với phương án API đối chứng Gemini Embedding 2, tài liệu hiện tính 258 image
  tokens/ảnh; theo bảng giá chính thức $0.45/1M token online và $0.225/1M token
  batch, 100.000 ảnh tương đương $11.61/$5.805, chưa tính text tokens. Model
  `gemini-embedding-2` được đánh dấu GA trong model docs, trong khi bảng giá còn
  hiển thị tên Unified Multimodal Preview; phải xác nhận model ID/region/account
  trước chọn nhà cung cấp. Dùng model tự host hiện tại thì phí API embedding là
  $0. Qdrant vẫn cần lưu vector (2.048 byte thô/ảnh ở 512 chiều) và compute; repo
  chưa có cấu hình node/giá hạ tầng để quy đổi phần đó sang USD.
- 23,8 triệu tham số F32 tương ứng khoảng 95 MB trọng số lý thuyết; kích thước
  ONNX thực tế chưa đo vì artifact chưa được export. AI Kubernetes hiện chưa có
  đường cấp artifact. Cần chọn rõ đóng gói artifact vào image (tăng image size,
  pin hash/revision) hoặc mount read-only (cần cấu hình volume/rollout); cả hai
  đều là deployment work chưa được làm. Cần cộng graph/runtime và RSS sau
  benchmark trên giới hạn 0.5 CPU/768 MiB hiện tại.
- AI Service hiện có Pillow, NumPy, ONNX Runtime production deps và optional
  `image-search-export` extra chứa `timm`, Torch và ONNX; runtime container chỉ
  cần artifact và ONNX Runtime. Extra/exporter đã được thêm ở Phase 2 nhưng chưa
  được cài hoặc chạy trong workspace, nên artifact/output và tải model vẫn chưa
  được xác minh.
- Cache query tối đa 256 vector × 512 float32 dùng khoảng 0,5 MiB dữ liệu vector
  thô mỗi AI process; digest, key/entry overhead và model RSS cần đo trên artifact.
  Cache miss vẫn chạy inference bình thường, nên cache không phải dependency correctness.
- Lưu vector thô: khoảng 2,05 GB cho một triệu ảnh. Không có con số catalog thực
  tế trong lần rà này, nên không suy đoán chi phí lưu trữ/compute theo danh mục.
- Khi thay model, blue/green collection có thể tạm thời giữ hai bộ vector; raw
  storage tăng gần gấp đôi trong thời gian backfill (khoảng 410 MB/100.000 ảnh
  cho hai phiên bản 512 chiều), chưa gồm overhead Qdrant. Giữ collection cũ tới
  khi alias mới được xác minh rồi mới lên lịch dọn.
- Nếu triển khai được chốt, model có thể được export thủ công trong AI Service:

    ```powershell
    python -m pip install -e ".[image-search-export]"
    python scripts/export_image_search_model.py --output artifacts/image-search/pe-core-s16-384.onnx
    ```

    Sau đó cấp artifact và sidecar `.meta.json` cho AI Service (hiện deployment
    Kubernetes chưa có volume mount tương ứng), cấu hình
    `IMAGE_SEARCH_MODEL_PATH`, `IMAGE_SEARCH_MODEL_VERSION` và
    `IMAGE_SEARCH_DIMENSIONS=512`. Export tải checkpoint từ Hugging Face; lệnh này
    chưa được chạy trong repo và không chạy tự động lúc startup.

- Khi AI readiness báo model/version/dimension/preprocess chính xác và Qdrant
  physical collection sẵn sàng, operator gọi backfill Recommendation từng lô với
  internal service token, truyền `nextCursor` làm `afterProductId`. Image
  backfill đọc trực tiếp Product snapshot nên không phụ thuộc Recommendation
  catalog bootstrap. Endpoint nội bộ không được mở ra browser.

## Tệp theo trạng thái

- `web/src/features/product-search`: panel, hook preview/session, ghép với trang
  tìm kiếm hiện có; `web/src/services/product`: raw upload, GET session, types.
- `services/api-gateway/src/modules/product` và `src/main.ts`: public proxy,
  throttling và raw parser.
- `services/product-service/src/modules/storefront`: public image endpoint, AI/
  Recommendation clients, lọc ứng viên theo ảnh và chữ, revision/media validation và
  authoritative filtering/hydration đã được thêm trong Phase 3. Phase 2 đã thêm
  internal `catalog-image-snapshot`; không đưa owner ID ra public response.
- `packages/common/kafka/events/recommendation.events.ts`: Phase 2 đã thêm field
  media reference tùy chọn, tương thích consumer event cũ.
- `services/recommendation-service/src/modules/catalog/image-index` và
  `src/kafka/consumers/catalog-image`: Phase 2 indexer, Media/AI/Qdrant adapters,
  revision/tombstone guard, backfill và tests đã có. Không có Redis lock; queue
  tuần tự chỉ bảo vệ trong từng process. Candidate/session API đã có ở Phase 3;
  evaluator có nhãn vẫn chưa có.
- `services/media-service/src/modules/media/application/services/assets/media-asset.service.ts`:
  Phase 2 đã thêm giới hạn byte cho internal download trước khi buffer hóa; không
  thay đổi storage format hay quyền sở hữu asset.
- `services/ai-service/app/modules/search_ranking/image_embedding` và
  `scripts/export_image_search_model.py`: Phase 2 ONNX provider, route,
  validation, settings/lifecycle và tests; `preprocessVersion` được kiểm tra
  xuyên suốt model sidecar, response và Recommendation client. Phase 3 đã thêm
  query-vector cache bounded; route public upload và Nginx privacy/rate limits đã có.

## Đánh giá, kiểm thử và giới hạn

- Phase 2 đã thêm tests cho AI image validation/route, Recommendation
  idempotency/backfill, Product snapshot/event và Media byte cap. Phase 3 đã thêm
  tests cho AI cache, lọc tương đồng, fallback, session và Qdrant retrieval. Phase 4
  có 5 component tests và 4 hook tests cho validation, upload/session GET,
  preview, pending, fallback, lỗi có retry và thu hồi object URL.
- Evaluator Phase 6 tại `services/recommendation-service/src/scripts/image-search-evaluation`
  nhận JSONL nhãn, chạy image-only/image+text và tính Recall@10, NDCG@10, filter
  compliance, p50/p95 latency. Hướng dẫn schema/chạy nằm trong
  `image-search-evaluation.md`. Repo hiện chưa có ảnh/query được gán nhãn, nên
  chưa thể báo metric chất lượng đại diện. Nhãn phải do người đánh giá tạo;
  không dùng vector hoặc ảnh gốc làm nhãn thay thế.
- Chưa benchmark ONNX inference trên giới hạn AI Service 0.5 CPU/768 MiB; chưa
  export artifact hoặc chạy backfill. Do đó chất lượng, latency, peak RAM và thời
  gian index catalog vẫn là việc vận hành cần đo trước khi bật cho khách.
- Media reference có cấu trúc đã được thêm; event cũ/ảnh ngoài Media không có
  reference đáng tin cậy tiếp tục bị bỏ qua. Không fetch `imageUrl` tùy ý hoặc đoán
  owner.
- Consumer image đọc Product snapshot mới nhất, so revision số và ghi tombstone.
  Product snapshot read và Qdrant write không nguyên tử; vì vậy đồng bộ là
  eventual consistency, không bảo đảm loại race qua nhiều instance. Phase 3
  xác minh lại `catalogRevision` và media fingerprint từ Product trước khi rank.
- Recommendation catalog bootstrap mặc định tắt nhưng không phải dependency của
  image backfill: backfill/event worker đọc `catalog-image-snapshot` trực tiếp từ
  Product. Model artifact, collection đúng vector space và permission consume
  topics vẫn là điều kiện vận hành chưa hoàn tất.
- Candidate pool giới hạn 500, chỉ index ảnh đại diện, vector mới đồng bộ bất
  đồng bộ theo event và product ngoài Media managed path bị bỏ qua.

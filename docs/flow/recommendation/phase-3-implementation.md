# Recommendation Phase 3 — Catalog Intelligence

## Mục tiêu

Phase 3 tạo thêm candidate chất lượng từ nội dung sản phẩm và quan hệ hành vi, nhưng chưa thay đổi công thức ranking của Phase 2. Vì vậy có thể bật/tắt từng source để so sánh coverage, latency và overlap trước khi Phase 4 đưa các feature mới vào ranking.

## Luồng semantic

```text
Product transaction
  -> catalogRevision tăng
  -> product.catalog.* event + semanticContent/contentHash
  -> Recommendation catalog read model
  -> embedding job PostgreSQL (unique product + contentHash + profile)
  -> dispatcher lease bằng FOR UPDATE SKIP LOCKED
  -> Kafka recommendation.product-embedding.requested.v1
  -> AI embedding-worker / OpenAI text-embedding-3-small
  -> generated event
  -> kiểm tra hash/model/dimension
  -> Qdrant alias current
```

`contentHash` chỉ phụ thuộc title, mô tả, brand, category path và attributes. Giá, tồn kho, rating, total sold, status và dữ liệu user không làm vector bị tạo lại. Khi chỉ đổi stock/status, Recommendation chỉ cập nhật payload Qdrant.

## Luồng co-behavior

Relation projector chạy consumer group riêng `recommendation-relations-v1`. Profile projection không bị block bởi pair generation.

- `CO_VIEW`: cùng session trong 30 phút, tối đa 20 sản phẩm.
- `CO_CART`: cùng session/user trong 7 ngày, tối đa 50 sản phẩm.
- `CO_PURCHASE`: các product trong cùng order completed, tối đa 50 sản phẩm.
- Return tạo negative correction; cancelled không tạo positive signal.
- Mỗi event có ledger `(eventId, projectionType)` và mỗi pair có unique key để redelivery an toàn.

## Candidate union

Semantic và relation sources trả `productId`, `rawScore`, `reasonCode`, `anchorProductId`, `modelVersion`. Candidate union deduplicate theo product, giữ source attribution và giới hạn pool tối đa 300 item. Product card vẫn hydrate từ PostgreSQL read model của Recommendation; không có request-time query sang Product/Order Service.

Nếu Qdrant, AI, relation query hoặc Kafka tạm thời lỗi, source tương ứng trả rỗng và các source Phase 2 tiếp tục phục vụ. Ba flag rollout mặc định `false`:

```env
CANDIDATE_PIPELINE_V3_ENABLED=false
SEMANTIC_CANDIDATES_ENABLED=false
CO_BEHAVIOR_CANDIDATES_ENABLED=false
```

## Backfill và rollback

- Product snapshot: `GET /api/v1/internal/products/catalog-snapshot?page=...` có service token.
- Purchase replay: `POST /api/v1/internal/recommendation/purchases/replay` có service token; chỉ phát order `COMPLETED` và event ID ổn định.
- Qdrant dùng alias `recommendation_product_embeddings_current`; model mới tạo collection vật lý mới, backfill xong mới đổi alias.
- Tắt `CANDIDATE_PIPELINE_V3_ENABLED` để quay về Phase 2 mà không xóa catalog/vector data.

## Boundary Phase 4

Phase 3 chưa cộng semantic/relation score vào `finalScore`. Phase 4 mới normalize các feature này, đưa vào weighted ranking/diversity và đánh giá bằng impression → click → cart → purchase.

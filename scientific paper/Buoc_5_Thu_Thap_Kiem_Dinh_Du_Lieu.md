# Bước 5 — Thu thập và kiểm định dữ liệu recommendation thực tế

**Trạng thái:** Đã cấu hình capture tắt ở Compose development, bật trong `.env.production`; Kubernetes production mặc định bật theo `NODE_ENV=production`, còn cấu hình tường minh vẫn là kill switch. Image đã build thành công. Service production chưa được deploy nên migration chưa xác nhận; cấu hình development/production đang dùng chung PostgreSQL host và user, còn audit chưa có URL chỉ đọc hoặc mốc bắt đầu. Chưa thu traffic pilot production.

**Ngày:** 20/11/2026.
**Phạm vi:** Thu log từ hệ thống recommendation đang phục vụ; không tạo thêm dữ liệu giả và chưa train model production.

## 1. Kết luận rà soát trước khi triển khai

Hệ thống đã ghi nhận `PRODUCT_IMPRESSED`, `PRODUCT_CLICKED` và các hành động tiếp theo như add-to-cart. Event recommendation mang request ID, item token có chữ ký, source, rank, surface và policy version; impression phía web chỉ được phát sau khi card hiển thị ít nhất 50% trong viewport.

Log cũ chưa đủ tạo LambdaRank query group đáng tin cậy: bảng interaction không chứa snapshot chín feature mà model đã nhận, toàn bộ candidate pool của request, phiên bản feature schema hoặc thời điểm feature được tính. Không thể khôi phục các trường đó chính xác từ catalog/profile hiện tại vì dữ liệu đã có thể thay đổi. Ngoài ra, impression queue phía browser gửi best-effort; request lỗi bị bỏ, do đó pilot phải đo tỷ lệ nối event và chưa được tự gán item không có impression thành negative.

## 2. Thay đổi đã triển khai

| Thành phần             | Thay đổi                                                                                                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recommendation serving | Tạo snapshot point-in-time cùng request ID với response, gồm candidate pool tối đa 300, feature, raw model score, thứ hạng sau diversity, source provenance, schema/model/policy version và thời điểm tính feature/phục vụ. |
| Recommendation cache   | Cache hit tạo request ID mới rồi copy snapshot gốc trong PostgreSQL; feature timestamp giữ nguyên vì đó là feature thực sự đã dùng để chấm slate.                                                                           |
| PostgreSQL             | Migration thêm `recommendation_training_snapshots`, unique theo request ID, có index theo thời gian và surface. Dữ liệu feature/provenance được lưu JSONB để giữ query group trọn vẹn.                                      |
| Dữ liệu và quyền truy cập | Snapshot không lưu trực tiếp user ID, session ID, tên/email, raw profile, văn bản sản phẩm, query, giá trị cart/order hoặc token attribution. Tuy vậy `requestId` nối được sang interaction có actor, nên dữ liệu vẫn có thể liên kết và cần giới hạn quyền đọc. |
| Serving resilience     | Ghi snapshot best-effort; nếu lần ghi mới thất bại thì vẫn trả recommendation nhưng không cache response đó để request sau có thể thử ghi lại. Lỗi có request ID và error type trong service log.                           |
| Pilot audit            | Thêm lệnh chỉ đọc báo cáo số snapshot production, độ đầy đủ của chín feature, consistency candidate/rank, tỷ lệ event nối được, click thiếu impression và độ trễ từ serving đến lúc API ghi nhận click. Báo cáo không xuất ID và không tạo label. |

Kubernetes production mặc định capture theo `NODE_ENV=production`; Compose development và cấu hình thiếu biến mặc định tắt. `RECOMMENDATION_TRAINING_SNAPSHOT_ENABLED=false` là kill switch rõ ràng. Khi capture tắt hoặc writer chưa đăng ký, cache dùng namespace riêng để bật capture lại sẽ tính request mới thay vì tái dùng slate không có snapshot. Trường `environment` lấy từ `NODE_ENV`; audit pilot chỉ tính snapshot có environment `production` để không trộn lượt chạy local với traffic production. Snapshot dùng chung chính sách raw-event retention: mặc định 90 ngày khi worker retention được bật bằng `RECOMMENDATION_RETENTION_ENABLED=true`.

## 3. Dữ liệu được ghi

Mỗi row tương ứng một lần recommendation response được phục vụ:

- Metadata request: request ID, `servedAt`, surface, page, strategy, ranking mode, model version, policy version và environment.
- Metadata point-in-time: `featuresComputedAt` riêng với `servedAt`; cache hit giữ nguyên feature timestamp của lần model đã tính.
- Source candidates: product ID theo thứ tự source trả về, số lượng gốc và cờ truncation; không lưu anchor product phát sinh từ lịch sử hành vi.
- Ranking candidates: product ID, 9 feature đầu vào, raw LambdaRank score, source set, rank sau diversity (null nếu không vào final slate), cờ diversity relaxation và category/brand/shop ID cho phân tích độ đa dạng.

`sourceCandidates` ghi kết quả của các source trước bước union; `candidates` ghi pool đã qua union/budget mà LambdaRank thực sự chấm. Đây là dữ liệu của output hiện hành, không phải toàn bộ catalog đủ điều kiện. Pool bị giới hạn 300 và final slate tối đa 180.

## 4. Quy tắc diễn giải nhãn

- Click có attribution token hợp lệ là outcome dương gắn với đúng request-item; pilot vẫn đo click có impression tương ứng hay không.
- Impression là proxy exposure theo rule card hiện ít nhất 50% trong viewport; nó không chứng minh người dùng đã chú ý hoặc đọc item.
- Item không có impression là **unobserved**, không phải negative.
- Impression không có click chỉ có thể thành negative tạm thời sau attribution window và kiểm định độ tin cậy của exposure; không coi đó là nhãn âm chắc chắn.
- Chưa chốt attribution window. `occurredAt` do API ghi nhận khi nhận event, không phải timestamp click trên browser; audit trả p50/p90/p95 độ trễ từ `servedAt` đến lúc API ghi nhận click, gồm thời gian chờ phía client, độ trễ mạng và sai số đồng hồ giữa instance. Dùng phân phối này như bằng chứng vận hành để chọn cửa sổ, không diễn giải là thời gian click chính xác.
- Chưa tạo nhãn tự động, dataset train hoặc model production. Click/cart/purchase cũng chưa được gộp thành relevance nhiều mức.
- Do thứ hạng hiện tại không được randomized, click offline chịu position bias; metric quan sát không chứng minh uplift nhân quả.

## 5. Chạy pilot sau khi triển khai service

Recommendation Service có `migrationsRun: true`; migration tạo bảng sẽ chạy khi service khởi động thành công với cấu hình PostgreSQL hợp lệ. Cần kiểm tra startup log cho migration `CreateRecommendationTrainingSnapshots1788036000000` trước khi bắt đầu thời gian quan sát.

Đặt một database URL chỉ có quyền `SELECT` vào biến `RECOMMENDATION_PILOT_DATABASE_URL`, sau đó chạy từ thư mục service:

```powershell
# Đặt RECOMMENDATION_PILOT_DATABASE_URL bằng URL read-only và mốc UTC đã chốt.
# Ví dụ RECOMMENDATION_PILOT_START_AT: 2026-11-21T00:00:00Z.
npm run ranking-data-pilot
```

Trước lệnh, đặt `RECOMMENDATION_PILOT_DATABASE_URL` và `RECOMMENDATION_PILOT_START_AT` trong môi trường chạy; audit mặc định dùng TLS có xác thực chứng chỉ, chỉ đặt `POSTGRES_SSL=false` cho database local không hỗ trợ TLS. Lệnh build script rồi mở transaction read-only. Báo cáo chỉ tổng hợp snapshot production từ mốc đã chốt; nếu không có snapshot, nhóm event matching và click ingestion delay sẽ rỗng nhưng event bị thiếu snapshot sau mốc vẫn được tính là unmatched. Không chạy audit bằng quyền ghi database.

Trong pilot, ghi lại khoảng thời gian thu thập và các giá trị tổng hợp của audit; không sửa split/label sau khi xem test result. Không train cho đến khi feature completeness đạt 100% trên row hợp lệ, schema/model được truy nguyên, attribution đủ để tách positive/exposed negative/unobserved, và lượng query group được xem xét cùng độ bất định theo request.

## 6. Giới hạn cần xử lý trước khi kết luận khoa học

1. Impression batching phía browser hiện best-effort, không có retry bền vững hoặc idempotency key ổn định cho lần gửi lại. Audit sẽ cho thấy độ thiếu exposure; tuyệt đối chưa dùng absence-of-click làm negative tự động.
2. Snapshot JSONB có thể tăng dung lượng theo số request và candidate; insert đồng bộ cộng độ trễ PostgreSQL cho cả cache miss lẫn cache hit. Retention worker xóa snapshot cùng mốc raw interaction (`RECOMMENDATION_RAW_RETENTION_DAYS`, mặc định 90 ngày) theo batch; trước khi bật lâu dài vẫn cần đo dung lượng/latency và chốt quyền truy cập, retention cùng partition nếu hạ tầng cần.
3. Source candidate list cho biết tập source đã trả về nhưng không chứa toàn bộ eligible catalog; Recall@300 cần định nghĩa positive target độc lập, đúng thời điểm và cùng eligibility rules.
4. Snapshot của cache hit là feature thực sự đã dùng để xếp hạng, không tái dựng feature như thể model chạy lại tại `servedAt`. Hai timestamp được lưu riêng để không tạo dữ liệu tương lai giả.
5. Pilot audit chưa chạy trên production DB trong bước này; chưa thể đưa ra tỷ lệ event nối, attribution window, số nhóm đủ label hay kết luận hệ thống có đủ dữ liệu train.

## 7. Cổng chuyển sang bước tiếp theo

Sau khi pilot chạy, cập nhật báo cáo tổng hợp và quyết định theo bằng chứng:

1. Xác nhận capture chỉ lấy `production` và feature schema có đủ 9 trường hợp lệ.
2. Đo missing snapshot, feature/candidate count, rank join, click không có impression và click có timestamp bất thường.
3. Chọn attribution window theo độ trễ quan sát, chốt định nghĩa nhãn và đóng băng protocol.
4. Kiểm tra số query có positive lẫn exposed negative; nếu chưa đủ thì tiếp tục thu thập.
5. Chỉ sau khi đạt cổng dữ liệu mới xây temporal split/export và chạy RQ1–RQ3; synthetic v3 tiếp tục chỉ là bootstrap kỹ thuật.

## Tệp triển khai liên quan

- `services/recommendation-service/src/modules/recommendation/application/services/query/recommendation-query.service.ts`
- `services/recommendation-service/src/modules/recommendation/infrastructure/repositories/recommendation-training-snapshot.repository.ts`
- `services/recommendation-service/src/database/recommendations/entities/recommendation-training-snapshot.entity.ts`
- `services/recommendation-service/src/database/migrations/1788036000000-create-recommendation-training-snapshots.ts`
- `services/recommendation-service/src/scripts/audit-recommendation-training-pilot.ts`

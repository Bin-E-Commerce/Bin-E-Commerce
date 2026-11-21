# Bước 5 — Thu thập và kiểm định dữ liệu recommendation thực tế

**Trạng thái:** Capture tắt ở Compose development và bật mặc định trong Kubernetes production theo `NODE_ENV=production`; cấu hình tường minh vẫn là kill switch. Release `3cd2510d488774ab163bea475bbdd009c3de184b` đã deploy thành công, K3s xác nhận rollout Recommendation Service hoàn tất lúc `2026-11-20T06:55:10Z`. Audit đầu ghi nhận 16 request production, chưa đủ để train model nội bộ. Theo quyết định mới, benchmark không chờ pilot này: dataset public Synerise đã chốt ở [Bước 4](Buoc_4_Chot_Nguon_Du_Lieu.md) và được audit/chuẩn hóa ở [Bước 6](Buoc_6_Kiem_Dinh_Chuan_Hoa_Du_Lieu.md).

**Ngày:** 20/11/2026.
**Phạm vi:** Ghi nhận và kiểm định log từ hệ thống đang phục vụ. Đây là nhánh kiểm chứng nội bộ về sau; benchmark nghiên cứu hiện tại dùng Synerise public data và không bị chặn bởi quy mô pilot production.

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
- Trong nhánh log production, chưa tạo nhãn tự động, tập train hay model production; click/cart/purchase chưa được gộp thành relevance nhiều mức. Benchmark Synerise có protocol nhãn riêng ở Bước 4.
- Do thứ hạng hiện tại không được randomized, click offline chịu position bias; metric quan sát không chứng minh uplift nhân quả.

## 5. Chạy pilot sau khi triển khai service

Recommendation Service có `migrationsRun: true`; migration tạo bảng chạy khi service khởi động. K3s báo rollout thành công và audit đọc được bảng snapshot sau mốc deploy, xác nhận schema sẵn sàng và dữ liệu mới đã được ghi.

Đặt một database URL chỉ có quyền `SELECT` vào biến `RECOMMENDATION_PILOT_DATABASE_URL`, sau đó chạy từ thư mục service:

```powershell
# Đặt RECOMMENDATION_PILOT_DATABASE_URL bằng URL read-only và mốc UTC đã chốt.
# Ví dụ RECOMMENDATION_PILOT_START_AT: 2026-11-21T00:00:00Z.
npm run ranking-data-pilot
```

Trước lệnh, đặt `RECOMMENDATION_PILOT_DATABASE_URL` và `RECOMMENDATION_PILOT_START_AT` trong môi trường chạy; audit mặc định dùng TLS có xác thực chứng chỉ, chỉ đặt `POSTGRES_SSL=false` cho database local không hỗ trợ TLS. Lệnh build script rồi mở transaction `READ ONLY`, với `migrationsRun=false` và `synchronize=false`. Báo cáo chỉ tổng hợp snapshot production từ mốc đã chốt; nếu không có snapshot, nhóm event matching và click ingestion delay sẽ rỗng nhưng event bị thiếu snapshot sau mốc vẫn được tính là unmatched. Nên dùng database role chỉ có quyền `SELECT` cho các lần audit tiếp theo.

### Kết quả audit pilot đầu tiên

- Mốc bắt đầu: `2026-11-20T06:55:10Z`, theo thời điểm K3s xác nhận rollout hoàn tất.
- Thời điểm audit: `2026-11-20T08:11:50Z`.
- Phạm vi: transaction `READ ONLY` trên database recommendation dùng chung; URL được ghép tạm trong process từ cấu hình local, không ghi vào file hoặc log.

| Kiểm tra | Kết quả |
| --- | ---: |
| Snapshot production / non-production | 16 / 0 |
| Candidate rows | 1.325 |
| Candidate đủ cả 9 feature / feature completeness | 1.325 / 100% |
| Candidate có score / có rank trong slate | 1.325 / 1.325 |
| Request thiếu model version / source bị truncate | 0 / 0 |
| Vi phạm timestamp / lệch candidate count | 0 / 0 |
| Impression và click có attribution | 7; khớp snapshot 7/7 (100%) |
| Click không có impression / lệch rank / trước serving | 0 / 0 / 0 |
| Request ID không khớp snapshot | 0 |
| Query group có ít nhất 2 impression và 1 click | 1 |
| Độ trễ ghi nhận click p50 / p90 / p95 | 5,92 / 5,92 / 5,92 giây |

Diễn giải: phần ghi snapshot và nối attribution hoạt động tốt trên mẫu đầu, nhưng chỉ có 16 request và một query group có click. Độ trễ click cũng chỉ dựa trên một click, nên chưa đủ để chọn attribution window. Kết quả này chỉ xác nhận luồng capture hoạt động ban đầu; chưa tạo label nội bộ, export tập train hay train model production.

## 6. Quyết định không chờ pilot để làm benchmark

Pilot production hiện chưa đủ mẫu và không thể trả lời các câu hỏi ranking. Ta chuyển thực nghiệm chính sang Synerise raw e-commerce dataset theo quyết định ở Bước 4 và audit ở Bước 6: purchase trong horizon 14 ngày là target offline; candidate generation, LambdaRank và category diversity được đánh giá trên split thời gian. Dataset public không có impression/slate nên không được diễn giải thành click ranking hoặc uplift.

Việc tiếp tục ghi snapshot production vẫn hữu ích để đánh giá riêng hệ thống recommendation này sau khi tích lũy đủ exposure/outcome. Hai nguồn không được gộp vào một tập train: schema, query group và semantics nhãn khác nhau. Gate về completeness/attribution dưới đây áp dụng cho model nội bộ, không cần đạt trước khi bắt đầu adapter Synerise.

Trong mọi nhánh, ghi lại khoảng thời gian thu thập và các giá trị audit tổng hợp; không sửa split/label sau khi xem test result. Public benchmark cần manifest, temporal split, target 14 ngày, eligibility và negative-sampling protocol được khóa trước khi mở test. Production model cần feature completeness, schema/model provenance, attribution đủ tách positive/exposed negative/unobserved và số query group đủ để ước lượng bất định.

## 7. Giới hạn cần xử lý trước khi kết luận khoa học

1. Impression batching phía browser hiện best-effort, không có retry bền vững hoặc idempotency key ổn định cho lần gửi lại. Audit sẽ cho thấy độ thiếu exposure; tuyệt đối chưa dùng absence-of-click làm negative tự động.
2. Snapshot JSONB có thể tăng dung lượng theo số request và candidate; insert đồng bộ cộng độ trễ PostgreSQL cho cả cache miss lẫn cache hit. Retention worker xóa snapshot cùng mốc raw interaction (`RECOMMENDATION_RAW_RETENTION_DAYS`, mặc định 90 ngày) theo batch; trước khi bật lâu dài vẫn cần đo dung lượng/latency và chốt quyền truy cập, retention cùng partition nếu hạ tầng cần.
3. Source candidate list cho biết tập source đã trả về nhưng không chứa toàn bộ eligible catalog; Recall@300 cần định nghĩa positive target độc lập, đúng thời điểm và cùng eligibility rules.
4. Snapshot của cache hit là feature thực sự đã dùng để xếp hạng, không tái dựng feature như thể model chạy lại tại `servedAt`. Hai timestamp được lưu riêng để không tạo dữ liệu tương lai giả.
5. Audit đầu tiên chỉ có 16 request và một query group có click; tỷ lệ đầy đủ hiện tại chưa đại diện cho traffic dài hạn, chưa đủ chọn attribution window hoặc kết luận hệ thống có đủ dữ liệu train.

## 8. Cổng chuyển tiếp cho dữ liệu nội bộ

Các mục dưới đây chỉ quyết định khi nào được huấn luyện/đánh giá bằng log production; không chặn công việc benchmark public:

1. Xác nhận capture chỉ lấy `production` và feature schema có đủ 9 trường hợp lệ.
2. Đo missing snapshot, feature/candidate count, rank join, click không có impression và click có timestamp bất thường.
3. Chọn attribution window theo độ trễ quan sát, chốt định nghĩa nhãn và đóng băng protocol.
4. Kiểm tra số query có positive lẫn exposed negative; nếu chưa đủ thì tiếp tục thu thập.
5. Khi đạt cổng, mới tạo temporal split/export và đánh giá click ranking nội bộ. Synthetic v3 tiếp tục chỉ là bootstrap kỹ thuật; benchmark Synerise có quy trình và dataset riêng.

## Tệp triển khai liên quan

- `services/recommendation-service/src/modules/recommendation/application/services/query/recommendation-query.service.ts`
- `services/recommendation-service/src/modules/recommendation/infrastructure/repositories/recommendation-training-snapshot.repository.ts`
- `services/recommendation-service/src/database/recommendations/entities/recommendation-training-snapshot.entity.ts`
- `services/recommendation-service/src/database/migrations/1788036000000-create-recommendation-training-snapshots.ts`
- `services/recommendation-service/src/scripts/audit-recommendation-training-pilot.ts`

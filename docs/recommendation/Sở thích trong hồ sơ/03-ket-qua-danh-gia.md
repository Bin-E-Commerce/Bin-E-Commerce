# 03. Kết quả đánh giá

## Phạm vi kết luận

Đã kiểm tra tính đúng của phép tính và chạy phép đo trên **dữ liệu mô phỏng có kiểm soát**. **Chưa có đánh giá trên log tương tác thật**, nên chưa thể khẳng định công thức mới làm hệ thống tốt hơn cho khách hàng.

## Kiểm tra công thức và triển khai

| Phép kiểm                 | Kết quả   |
| ------------------------- | --------- |
| Unit test liên quan       | 17/17 đạt |
| PostgreSQL tạm            | Đạt       |
| Type-check service và web | Đạt       |
| Build recommendation      | Đạt       |
| Lint recommendation       | Đạt       |
| Lint web                  | 0 lỗi     |

Unit test bao phủ ngưỡng từng chiều, tổng trọng số, half-life, điểm âm và truy vấn liên quan. Trên PostgreSQL tạm, migration khởi tạo hàng cũ; tổng dương/âm và timestamp của 600 event trên 100 actor khớp tổng trực tiếp từng event với sai số tối đa `1e-9`, kể cả khi event đến không theo thứ tự. Guest merge giữ đúng decay, không làm mới context cũ, không merge lặp; query chọn top theo điểm đã giảm và đọc nhóm âm riêng. Lint web còn 32 cảnh báo ở phần khác của dự án.

Phép thử PostgreSQL dùng database tạm `profile_affinity_test` ở localhost và đã dừng container sau khi đo. Có thể chạy lại bằng script [`verify-profile-projection-postgres.ts`](../../../services/recommendation-service/src/scripts/verify-profile-projection-postgres.ts). Đây là kiểm tra công thức trong code, không đo chất lượng gợi ý.

Từ thư mục `services/recommendation-service`, chạy lại phép đo mô phỏng bằng:

```bash
node -r ts-node/register -r tsconfig-paths/register src/scripts/evaluate-profile-affinity-synthetic.ts
```

Để chạy kiểm tra PostgreSQL, cung cấp `PROFILE_AFFINITY_TEST_DATABASE_URL` trỏ tới database **tạm** `profile_affinity_test` ở localhost rồi chạy script tương ứng với cùng lệnh `node -r ts-node/register -r tsconfig-paths/register`. Script từ chối database tên khác.

## Phép đo mô phỏng

Script [`evaluate-profile-affinity-synthetic.ts`](../../../services/recommendation-service/src/scripts/evaluate-profile-affinity-synthetic.ts) chạy seed `1..1000`, cố định thời điểm tham chiếu `2026-11-09T00:00:00Z`. Mỗi ca có hai sản phẩm: A có 1–4 lần mua cũ và một tín hiệu mới yếu; B có một tín hiệu mới mạnh. Chỉ điểm **sản phẩm** tham gia phép đo này. Hai phương án dùng cùng lịch sử và cùng cách phá hòa; metric là tỷ lệ chọn đúng sản phẩm đứng đầu (`accuracy@1`).

| Nhãn giả định của kịch bản                  |      Phiên bản cũ |     Công thức mới |   Chênh lệch |
| ------------------------------------------- | ----------------: | ----------------: | -----------: |
| Người dùng đã chuyển sang thích B: 1.000 ca | 293/1.000 = 29,3% | 774/1.000 = 77,4% | +48,1 điểm % |
| Người dùng vẫn thích A: 1.000 ca            | 707/1.000 = 70,7% | 226/1.000 = 22,6% | −48,1 điểm % |

**Diễn giải:** công thức mới phản ứng tốt hơn trong kịch bản sở thích thay đổi, nhưng kém hơn trong kịch bản sở thích ổn định. Đây là cùng một lịch sử với **hai nhãn do người tạo kịch bản gán**, nên không có căn cứ chọn một hàng làm kết luận chung. Kết quả cũng không đánh giá phần danh mục/thương hiệu, candidate retrieval, các feature ranking khác, NDCG hay doanh thu. Không dùng các số này để tuyên bố cải thiện thực tế hoặc để hiệu chỉnh `H`, `M` và `λ`.

## Việc còn cần để bảo vệ hiệu quả trước thầy cô

1. Thu thập impression và hành động sau impression có timestamp; chỉ dùng dữ liệu đã xảy ra trước thời điểm xếp hạng.
2. Chia train/validation/test theo thời gian. Chọn `H`, ba ngưỡng `M` và ba trọng số `λ` trên validation; khóa cấu hình trước khi xem test.
3. So sánh phiên bản cũ và mới trên cùng candidate set bằng `NDCG@10` và `Recall@10`, báo cáo số người dùng, số impression, nhãn, khoảng thời gian và độ bất định theo người dùng.
4. Nếu log cũ không còn timestamp từng event, không thể replay chính xác profile lịch sử từ `score` cộng dồn. Khi đó phải thu thập giai đoạn mới đủ dữ liệu trước khi kết luận.

**Câu trả lời hiện tại:** “Em chứng minh được các tính chất toán học và đã kiểm tra SQL với 600 event mô phỏng đến lệch thứ tự, cùng phép gộp hồ sơ khách. Thử nghiệm kịch bản cho thấy công thức mới có ưu và nhược điểm tùy hành vi người dùng. Em chưa có bằng chứng trên log khách hàng thật để khẳng định nó tăng chất lượng xếp hạng; bước tiếp theo là kiểm định theo thời gian với baseline và các metric đã định trước.”

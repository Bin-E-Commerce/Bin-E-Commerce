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

Từ thư mục `services/recommendation-service`, chạy lại phép chẩn đoán mô phỏng bằng:

```bash
node -r ts-node/register -r tsconfig-paths/register src/scripts/diagnose-profile-affinity-synthetic.ts
```

Để chạy kiểm tra PostgreSQL, cung cấp `PROFILE_AFFINITY_TEST_DATABASE_URL` trỏ tới database **tạm** `profile_affinity_test` ở localhost rồi chạy script tương ứng với cùng lệnh `node -r ts-node/register -r tsconfig-paths/register`. Script từ chối database tên khác.

## Chẩn đoán bằng dữ liệu dựng sẵn

Script [`diagnose-profile-affinity-synthetic.ts`](../../../services/recommendation-service/src/scripts/diagnose-profile-affinity-synthetic.ts) chạy seed `1..1000` cho **hai lịch sử riêng**. Cả hai có A được mua nhiều trong quá khứ; trường hợp ổn định cho A tín hiệu mới mạnh và B tín hiệu yếu, trường hợp đổi sở thích cho B tín hiệu mới mạnh và A tín hiệu yếu. Chỉ chiều sản phẩm được tính. Kết quả là **thứ tự điểm**, không phải `accuracy@1` hay chất lượng thực tế:

| Lịch sử dựng sẵn                         | Bản cũ: A / B / hòa | Công thức mới: A / B / hòa |
| ---------------------------------------- | ------------------: | -------------------------: |
| Sở thích ổn định, A có tín hiệu mới mạnh |       1.000 / 0 / 0 |              1.000 / 0 / 0 |
| Sở thích đổi, B có tín hiệu mới mạnh     |       485 / 0 / 515 |             206 / 741 / 53 |

Ở hàng thứ hai, bản cũ thường giữ A ở điểm tối đa hoặc hòa vì một tín hiệu mới yếu làm **cả tổng cũ** có timestamp mới; kết quả phụ thuộc cách phá hòa. Công thức mới giảm điểm từng event cũ nên ưu tiên B trong nhiều ca hơn. Hai lịch sử do người viết script dựng theo giả định của mình, nên kết quả này chỉ minh họa khác biệt cơ chế. Phiên bản cũ không phải phương pháp nghiên cứu đã xác nhận; thắng nó không chứng minh công thức mới tốt hơn.

## Kết quả so với phương pháp đã công bố

| Phương pháp                                                               | Trạng thái                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Time-aware item-only theo Stefanidis et al. (2012)                        | Chưa chạy trên log thật; hiện mới đối chiếu dạng decay.                 |
| Item + xác suất mua theo category của Ok et al. (2019), phương trình (10) | Chưa tái lập; cần log click/cart/order và triển khai cả `r_ui`, `p_uk`. |
| Công thức ba chiều của dự án                                              | Đã triển khai; chưa đánh giá trên log thật.                             |

Nghiên cứu của Ok et al. đánh giá phương pháp trong bối cảnh quần áo trực tuyến; kết quả đó không bảo đảm phương pháp tối ưu cho dự án này. Khi có dữ liệu, chạy được baseline nào thì báo cáo baseline đó cùng công thức dự án trên đúng cùng test. Không điền số cho phương pháp chưa được tái lập.

## Việc còn cần để bảo vệ hiệu quả trước thầy cô

1. Thu thập impression và hành động sau impression có timestamp; chỉ dùng dữ liệu đã xảy ra trước thời điểm xếp hạng.
2. Chia train/validation/test theo thời gian. Chọn `H`, ba ngưỡng `M` và ba trọng số `λ` trên validation; khóa cấu hình trước khi xem test.
3. Tái lập một baseline đã công bố phù hợp với log thực có. Nếu đủ click/cart/order, ưu tiên phương pháp item–category của Ok và cộng sự; ghi rõ mọi phần không thể tái lập nguyên bản.
4. So sánh baseline nghiên cứu và công thức dự án trên cùng candidate set bằng `NDCG@10` và `Recall@10`, báo cáo số người dùng, số impression, nhãn, khoảng thời gian và độ bất định theo người dùng. Giữ bản code cũ như đối chứng phụ nếu cần.
5. Nếu log cũ không còn timestamp từng event, không thể replay chính xác profile lịch sử từ `score` cộng dồn. Khi đó phải thu thập giai đoạn mới đủ dữ liệu trước khi kết luận.

**Câu trả lời hiện tại:** “Em chứng minh được các tính chất toán học và đã kiểm tra SQL với 600 event mô phỏng đến lệch thứ tự. Em không coi bản code cũ là công thức đã được chứng minh. Phần decay có nguồn nghiên cứu, còn công thức ba chiều là thiết kế riêng của đồ án. Để chứng minh chất lượng, em cần tái lập một phương pháp đã công bố trên cùng dữ liệu thật và so sánh ở tập test theo thời gian; việc đó hiện chưa hoàn thành.”

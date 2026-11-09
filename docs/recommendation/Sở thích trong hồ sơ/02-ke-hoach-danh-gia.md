# 02. Kế hoạch đánh giá

## Mục tiêu

Đo xem cách tính `profileAffinity` mới có xếp sản phẩm người dùng quan tâm cao hơn bản trước hay không. Phép thử chỉ thay công thức của tiêu chí này; candidate, các feature khác, trọng số ranking tổng và dữ liệu kiểm tra phải giữ giống nhau.

## Dữ liệu cần có

Mỗi bản ghi cần tối thiểu:

- ID đã khử định danh của người dùng hoặc phiên;
- sản phẩm được hiển thị (`impression`) và vị trí hiển thị;
- loại sự kiện như xem, nhấp, thêm giỏ, mua hoặc trả hàng;
- timestamp của sự kiện;
- thông tin sản phẩm để ánh xạ sang danh mục và thương hiệu.

Không coi sản phẩm người dùng chưa từng thấy là dislike. Nếu log impression không có, không thể biết người dùng đã có cơ hội tương tác với sản phẩm đó hay chưa; cần nêu rõ giới hạn này trong kết quả.

## Cách chia dữ liệu

Chia theo timeline, không xáo trộn ngẫu nhiên:

1. **Train:** giai đoạn cũ dùng để tạo hồ sơ và xác định phạm vi tham số.
2. **Validation:** giai đoạn kế tiếp dùng để chọn `H`, `M_d` và các trọng số `λ`.
3. **Test:** giai đoạn mới nhất, khóa lại cho lần báo cáo cuối.

Tại mỗi thời điểm dự đoán, chỉ dùng sự kiện đã xảy ra trước thời điểm đó. Điều này tránh dùng tương tác tương lai để tính hồ sơ quá khứ.

## Baseline và phương án so sánh

- **Baseline chính:** lưu score cộng dồn, giảm toàn bộ score theo timestamp cuối và ghép `clamp(P_product + 0.6 P_category + 0.4 P_brand)`; đây là **phiên bản cũ đã thay thế**, chỉ dùng để đối chiếu offline.
- **Phương án mới đang chạy:** decay từng sự kiện, chuẩn hóa từng chiều và ghép bằng `λ` có tổng bằng `1` như mô tả trong [`01-nguon-va-lap-luan.md`](01-nguon-va-lap-luan.md).
- **Baseline phụ tùy chọn:** xếp theo độ phổ biến, không dùng hồ sơ cá nhân.

Giữ nguyên candidate set và các thành phần ranking khác; chỉ thay cách tính `profileAffinity`. Nếu muốn đánh giá riêng tiêu chí, cũng có thể xếp hạng candidate chỉ theo profile score, nhưng phải ghi rõ đây là phép thử feature-level.

## Kiểm tra kỹ thuật trước khi đo hiệu quả

1. Unit test của feature builder xác nhận ngưỡng, trọng số, half-life và việc tách tổng dương/âm.
2. Script [`verify-profile-projection-postgres.ts`](../../../services/recommendation-service/src/scripts/verify-profile-projection-postgres.ts) chạy trên PostgreSQL tạm, so sánh SQL projection với tổng trực tiếp của từng event cho nhiều thứ tự đến khác nhau.
3. Script [`evaluate-profile-affinity-synthetic.ts`](../../../services/recommendation-service/src/scripts/evaluate-profile-affinity-synthetic.ts) đo hai kịch bản kiểm soát: sở thích đổi và sở thích ổn định. Nhãn do kịch bản đặt ra, nên đây chỉ là phép thử hành vi công thức, **không** là bằng chứng khách hàng thật thích công thức mới.

## Nhãn và chỉ số

Chọn nhãn chính trước khi chạy. Khuyến nghị dùng mua hoàn tất làm nhãn chính nếu đủ dữ liệu; thêm thêm-giỏ hoặc nhấp làm phân tích phụ. Không gộp các hành động thành một nhãn mà không ghi rõ cách gán mức liên quan.

- `NDCG@10`: chỉ số chính, đánh giá sản phẩm quan tâm có được xếp gần đầu danh sách không.
- `Recall@10`: chỉ số phụ, đánh giá danh sách top 10 tìm được bao nhiêu sản phẩm người dùng quan tâm trong kỳ test.

Tính chỉ số trên cùng tập người dùng/candidate cho cả baseline và phương án mới. Báo cáo số người dùng, impressions, sự kiện dương, khoảng thời gian, định nghĩa nhãn, tham số, metric hai phương án và mức chênh lệch. Nếu có điều kiện, tính khoảng tin cậy bằng bootstrap theo người dùng.

## Cách kết luận

- Nếu phương án mới tăng metric trên test đã khóa, có thể nói nó cải thiện xếp hạng **trên tập dữ liệu và giao thức đã thử**.
- Nếu metric không tăng hoặc giảm, không được tuyên bố công thức mới tốt hơn; cần xem lại tham số, cách chuẩn hóa hoặc giữ baseline.
- Đánh giá offline không chứng minh tác động nhân quả lên doanh thu. Muốn kết luận khách hàng mua nhiều hơn cần thử nghiệm A/B khi hệ thống được triển khai.

[Cañamares et al. (2020)](https://doi.org/10.1007/s10791-020-09371-3) chỉ ra cách chia train/test và chọn metric có thể làm thay đổi kết luận đánh giá offline. [Ji et al. (2020)](https://arxiv.org/abs/2010.11060) phân tích việc bỏ qua timeline có thể gây rò rỉ dữ liệu và làm sai lệch kết quả.

## Điều kiện trước khi chạy

- Xác nhận log có timestamp tương tác và exposure/impression phù hợp.
- Kiểm tra công thức mới chỉ dùng dữ liệu có trước thời điểm dự đoán.
- Chọn tham số trên validation; không điều chỉnh theo kết quả test.
- Lưu phiên bản code, cấu hình và truy vấn tạo tập dữ liệu để lần chạy có thể tái lập.
- Chỉ đưa số liệu tổng hợp đã khử định danh vào báo cáo; không commit raw event log chứa dữ liệu cá nhân.
- Nếu thay `H`, tái dựng aggregate từ event gốc trước khi so sánh. Bản ghi được migration chuyển từ `score` cũ chỉ là xấp xỉ khi không có timestamp từng event.

# 02. Kế hoạch đánh giá

## Mục tiêu

Đánh giá hai câu hỏi riêng: công thức trong code có thực hiện đúng các tính chất đã nêu không, và công thức dự án có xếp hạng tốt trên dữ liệu thực tế không. So với bản cũ chỉ cho biết tác động của thay đổi code, không phải bằng chứng khoa học cho công thức mới.

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

- **Baseline nghiên cứu A — time-aware item-only:** tái lập decay theo tuổi của từng preference từ [Stefanidis et al. (2012)](https://homepages.tuni.fi/konstantinos.stefanidis/docs/dexa12.pdf), không ghép category/brand. Bài báo dùng rating phim, nên khi áp dụng vào implicit e-commerce phải công khai cách đổi view/click/cart/purchase thành `q_e`; dùng cùng mapping với công thức dự án trong phép so sánh thành phần.
- **Baseline nghiên cứu B — item + category:** nếu log đủ click/cart/order, tái lập phương pháp của [Ok et al. (2019)](https://www.mdpi.com/2076-3417/9/13/2634), gồm cả `r_ui` từ các bước trước và xác suất category `p_uk` học từ log; phương trình (10) ghép chúng thành `s_ui = (1−α)r_ui + α p_uk`. Huấn luyện trên train, chọn `α` trên validation. Chỉ chép phương trình (10) rồi tự thay đầu vào không được gọi là tái lập toàn bộ phương pháp.
- **Phương án dự án:** công thức ba chiều sản phẩm/danh mục/thương hiệu tại [`01-nguon-va-lap-luan.md`](01-nguon-va-lap-luan.md). Dạng decay và tổ hợp có nguồn; ba ngưỡng và ba trọng số mặc định là lựa chọn riêng của dự án, chưa được nghiên cứu trên khách hàng của dự án xác nhận.
- **Đối chứng kỹ thuật phụ:** phiên bản code cũ và xếp theo độ phổ biến. Kết quả so với chúng chỉ mô tả tác động triển khai và mức cải thiện so với phương án đơn giản, không thay thế baseline nghiên cứu.

Giữ nguyên candidate set, mốc thời gian dự đoán và dữ liệu test cho cả baseline A, baseline B và công thức dự án. Báo cáo riêng đánh giá `profileAffinity` ở mức feature và đánh giá toàn hệ thống khi ghép với các feature khác. Nếu log không đủ để tái lập baseline B, chạy baseline A và đánh dấu B là chưa chạy; không tự gọi phiên bản code cũ là công thức đã được chứng minh. Bài báo đã công bố cũng không phải đáp án đúng cho mọi tập dữ liệu: kết quả chỉ cho biết phương pháp nào tốt hơn trong giao thức và dataset đang thử.

## Kiểm tra kỹ thuật trước khi đo hiệu quả

1. Unit test của feature builder xác nhận ngưỡng, trọng số, half-life và việc tách tổng dương/âm.
2. Script [`verify-profile-projection-postgres.ts`](../../../services/recommendation-service/src/scripts/verify-profile-projection-postgres.ts) chạy trên PostgreSQL tạm, so sánh SQL projection với tổng trực tiếp của từng event cho nhiều thứ tự đến khác nhau.
3. Script [`diagnose-profile-affinity-synthetic.ts`](../../../services/recommendation-service/src/scripts/diagnose-profile-affinity-synthetic.ts) dựng hai lịch sử khác nhau để xem công thức ưu tiên A, B hay hòa điểm. Đây là chẩn đoán hành vi công thức, **không** phải đánh giá độ chính xác hoặc so sánh với nghiên cứu.

## Nhãn và chỉ số

Chọn nhãn chính trước khi chạy. Khuyến nghị dùng mua hoàn tất làm nhãn chính nếu đủ dữ liệu; thêm thêm-giỏ hoặc nhấp làm phân tích phụ. Không gộp các hành động thành một nhãn mà không ghi rõ cách gán mức liên quan.

- `NDCG@10`: chỉ số chính, đánh giá sản phẩm quan tâm có được xếp gần đầu danh sách không.
- `Recall@10`: chỉ số phụ, đánh giá danh sách top 10 tìm được bao nhiêu sản phẩm người dùng quan tâm trong kỳ test.

Tính chỉ số trên cùng tập người dùng/candidate cho mỗi baseline đã chạy và phương án dự án. Báo cáo phiên bản code của mỗi phương pháp, số người dùng, impressions, sự kiện dương, khoảng thời gian, định nghĩa nhãn, tham số, metric và mức chênh lệch. Nếu có điều kiện, tính khoảng tin cậy bằng bootstrap theo người dùng.

## Cách kết luận

- Nếu phương án dự án tăng metric so với baseline nghiên cứu trên test đã khóa, có thể nói nó cải thiện xếp hạng **trên tập dữ liệu và giao thức đã thử**; không khẳng định phương pháp nghiên cứu sai hoặc công thức dự án đúng phổ quát.
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

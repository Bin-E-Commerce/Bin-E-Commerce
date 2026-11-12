# Tiêu chí 7 — Chất lượng và tồn kho (`quality`)

> **Mục tiêu:** đưa tín hiệu đánh giá sản phẩm vào vector đầu vào của LambdaRank. `quality` không phải xác suất mua, không phải điểm cuối cùng của sản phẩm, và cũng không phải một bộ phân loại nội dung đánh giá.

## 1. Công thức hiện tại

Với sản phẩm `i`, đặt:

- `rᵢ = ratingAvgᵢ`: số sao trung bình, thang 0–5;
- `nᵢ = reviewCountᵢ`: số lượt đánh giá;
- `aᵢ = 1` nếu còn hàng, ngược lại `aᵢ = 0`.

Code hiện tính:

$$
R_i=\operatorname{clamp}_{[0,1]}\left(\frac{r_i}{5}\right),\qquad
N_i=\operatorname{clamp}_{[0,1]}\left(\frac{\ln(1+\max(n_i,0))}{\ln(101)}\right),
$$

$$
Q_i=\operatorname{clamp}_{[0,1]}\left(0.55R_i+0.25N_i+0.20a_i\right).
$$

`clamp` giới hạn một giá trị trong `[0,1]`; giá trị không hữu hạn được đổi thành 0 theo helper hiện tại. Mẫu số `ln(101)` làm thành phần số lượt đánh giá đạt 1 ở `reviewCount=100`; từ 100 lượt trở lên phần này bão hòa. Ba hệ số `0.55`, `0.25`, `0.20` và ngưỡng 100 là lựa chọn cấu hình của dự án, không được suy ra từ định lý hay nguồn dưới đây.

## 2. Tính chất toán học của công thức

### 2.1. Miền giá trị

Nếu các đầu vào là hợp lệ, `Rᵢ`, `Nᵢ` và `aᵢ` đều thuộc `[0,1]`. Các hệ số không âm và có tổng bằng 1, nên tổng có trọng số là tổ hợp lồi:

$$
0\leq 0.55R_i+0.25N_i+0.20a_i\leq 0.55+0.25+0.20=1.
$$

Vì vậy `Qᵢ ∈ [0,1]`. Với miền hợp lệ, `clamp` cuối không đổi kết quả; nó là hàng rào bảo vệ dữ liệu ngoài miền.

### 2.2. Tác động của rating

Khi `0 ≤ rᵢ ≤ 5`, giữ các thành phần khác không đổi:

$$
\frac{\partial Q_i}{\partial r_i}=\frac{0.55}{5}=0.11
$$

điểm trên mỗi sao. Do đó tăng 1 sao làm thành phần rating tăng 0.11 cho đến khi chạm biên. Đây là tính chất của hệ số 0.55 do dự án chọn, không phải trọng số được một nghiên cứu chứng minh tối ưu.

### 2.3. Tác động của số lượt đánh giá

Với `0 < nᵢ < 100`, trước khi chạm trần:

$$
\frac{\partial Q_i}{\partial n_i}=\frac{0.25}{(1+n_i)\ln(101)}>0,
\qquad
\frac{\partial^2 Q_i}{\partial n_i^2}=-\frac{0.25}{(1+n_i)^2\ln(101)}<0.
$$

Số lượt đánh giá tăng thì điểm tăng, nhưng lợi ích biên giảm dần; từ 100 lượt trở lên, phần `Nᵢ` đứng yên ở 1. Điều này chứng minh code đang **thưởng cho số lượng đánh giá**. Nó tự nó không chứng minh rằng trung bình rating đã đáng tin hơn, vì công thức không xem độ phân tán rating, chất lượng người đánh giá, thời điểm đánh giá hay mức độ bất định của trung bình.

### 2.4. Tác động của tồn kho

Khi trạng thái thay đổi từ hết hàng sang còn hàng, `Qᵢ` tăng đúng 0.20 nếu các phần còn lại giữ nguyên. Phép cộng này đúng đại số nhưng chỉ có ý nghĩa xếp hạng nếu candidate pool có cả sản phẩm còn hàng lẫn hết hàng. Nếu bước truy hồi đã loại sản phẩm hết hàng thì `aᵢ=1` cho mọi candidate; thành phần này là hằng số trong mỗi danh sách và không phân biệt chất lượng.

## 3. Những gì công thức hiện tại chưa chứng minh

- `reviewCount` được cộng như một phần điểm dương riêng, nên một sản phẩm có nhiều đánh giá được cộng điểm kể cả rating thấp. Đây là **mức độ phổ biến của đánh giá**, không phải phép ước lượng độ tin cậy của rating.
- Khi số review tương quan với doanh số/độ phổ biến, `reviewCount` có thể tính lại một phần tín hiệu đã có ở `popularity`. Cần đo correlation giữa feature và ablation, không giả định chúng độc lập.
- Nếu mọi candidate đều còn hàng, `0.20` chỉ dịch feature quality của cả request; nó không cung cấp tín hiệu phân biệt item.
- Không có công thức nào ở trên đảm bảo NDCG, Recall, click hay doanh thu tăng. Tính đơn điệu của từng thành phần không đồng nghĩa LambdaRank sẽ xếp sản phẩm “tốt” theo cảm nhận của mọi người.
- Thiếu snapshot `ratingAvg`/`reviewCount` tại thời điểm request sẽ gây leakage nếu dùng số liệu hiện tại để đánh giá request lịch sử.

## 4. Nghiên cứu liên quan và giới hạn trích dẫn

1. **Xie & Lui (2015), “Mathematical Modeling and Analysis of Product Rating with Partial Information.”** Nghiên cứu mô hình hóa vấn đề đánh giá chất lượng khi mỗi người chỉ đánh giá một số ít sản phẩm; phân tích số rating tối thiểu để tạo chỉ báo đáng tin và ảnh hưởng của rating sai lệch. Nguồn này hỗ trợ việc phải xét độ đầy đủ/độ tin cậy của rating, nhưng **không đề xuất** trọng số 55/25/20 hoặc hàm `ln(1+n)/ln(101)` của dự án. [ACM Transactions on Knowledge Discovery from Data, DOI: 10.1145/2700386](https://doi.org/10.1145/2700386).
2. **Wilson (1927), “Probable Inference, the Law of Succession, and Statistical Inference.”** Wilson suy ra khoảng tin cậy cho tỷ lệ nhị thức. Cận dưới Wilson có thể dùng để xếp hạng tỷ lệ đánh giá tích cực nếu có `positiveCount` và `totalCount`, chẳng hạn số review 4–5 sao và tổng số review. Schema hiện tại chỉ cung cấp `ratingAvg` và `reviewCount`, nên **không đủ dữ liệu để tính Wilson score chính xác**. [Journal of the American Statistical Association, DOI: 10.1080/01621459.1927.10502953](https://doi.org/10.1080/01621459.1927.10502953).

Các bài nghiên cứu trên tạo cơ sở để xem xét độ tin cậy của rating khi thông tin ít. Chúng không chứng minh công thức hoặc các tham số cụ thể của dự án.

## 5. Công thức thay thế nên thử có điều kiện

Nếu mục tiêu là giảm việc cộng điểm tự động cho sản phẩm chỉ vì có nhiều review, có thể thử **trung bình rating co về prior**:

$$
Q_i^{EB}=\operatorname{clamp}_{[0,1]}\left(\frac{n_i\bar r_i+m\mu}{(n_i+m)\cdot 5}\right),
$$

trong đó `r̄ᵢ` là rating trung bình sản phẩm, `μ` là rating trung bình nền (toàn catalog hoặc theo danh mục) tính **chỉ từ dữ liệu có trước thời điểm request**, `nᵢ` là số rating và `m>0` là độ mạnh prior, tương đương số rating giả.

Với mô hình chuẩn có prior `θᵢ ~ Normal(μ, τ²)` và rating trung bình quan sát có phương sai `σ²/nᵢ`, kỳ vọng hậu nghiệm là trung bình có trọng số của `r̄ᵢ` và `μ`; đặt `m=σ²/τ²` thu được dạng trên. Khi ít rating, ước lượng gần mức nền; khi nhiều rating, ước lượng tiến gần `r̄ᵢ`. Cần ước lượng/khóa `μ,m` trên train/validation theo thời gian và kiểm tra giả định rating, không chọn chúng bằng test.

**Đây là ứng viên để thực nghiệm, chưa phải thay đổi đã chứng minh tốt hơn.** Code hiện không truyền `μ` hoặc `m` vào `RankingFeatureService`; cần bổ sung dữ liệu prior theo snapshot thời gian trước khi có thể áp dụng nhất quán. Nếu chỉ có số review dương và tổng review, có thể so thêm cận dưới Wilson; không được suy `positiveCount` từ `ratingAvg` nếu chưa biết phân phối star ratings.

Tồn kho nên nằm ở **điều kiện đủ tiêu chuẩn candidate**. Nếu có nghiệp vụ vẫn cần đề xuất sản phẩm hết hàng (ví dụ báo hàng về), hãy biểu diễn availability thành feature/chính sách riêng và đo theo use case đó; không gọi nó là chất lượng sản phẩm.

## 6. Tóm tắt trình bày

> “Code hiện kết hợp rating trung bình, số lượt đánh giá và còn hàng trong một điểm bị chặn 0–1. Em chứng minh được miền giá trị và chiều biến thiên theo từng đầu vào; em chưa thể nói các hệ số là tối ưu vì chúng là tham số dự án. Nghiên cứu về product rating chỉ ra cần xét số lượng và độ tin cậy của đánh giá, nhưng không xác nhận công thức này. Hơn nữa, pipeline hiện lọc candidate còn hàng, nên phần stock có thể là hằng số và không giúp phân biệt sản phẩm. Em sẽ so công thức hiện tại với rating trung bình và một ước lượng shrinkage trên cùng dữ liệu impression chia theo thời gian, sau đó đo model đầy đủ so với ablation bỏ feature. Chỉ dữ liệu lịch sử thật mới cho phép kết luận ranking của dự án.”

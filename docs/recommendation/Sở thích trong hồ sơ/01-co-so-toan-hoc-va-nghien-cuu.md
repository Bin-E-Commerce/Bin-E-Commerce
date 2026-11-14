# Tiêu chí 1 — Sở thích trong hồ sơ (profileAffinity)

> **Mục tiêu:** đo mức một sản phẩm phù hợp với sở thích dài hạn suy ra từ lịch sử tương tác của người dùng. Tài liệu này chỉ trình bày tiêu chí **profileAffinity**, không gộp bảy tiêu chí còn lại.

## 1. Phạm vi và ý nghĩa

Với một sản phẩm ứng viên, hệ thống đối chiếu ba khóa trong hồ sơ người dùng:

- **Sản phẩm:** người dùng từng quan tâm chính sản phẩm đó.
- **Danh mục:** người dùng từng quan tâm danh mục của sản phẩm.
- **Thương hiệu:** người dùng từng quan tâm thương hiệu của sản phẩm.

Mỗi chiều được tính riêng rồi kết hợp thành một feature trong khoảng [0, 1]. Đây là **độ phù hợp theo tín hiệu lịch sử**, không phải xác suất mua và cũng không phải điểm xếp hạng cuối. Model LambdaRank còn nhận các feature khác; trainer ràng buộc profileAffinity không làm giảm điểm khi các feature còn lại giữ nguyên.

Tín hiệu âm như hoàn trả được giữ riêng trong **negativePenalty**; nó **không bị trừ trực tiếp khỏi profileAffinity**. Vì vậy, bằng chứng tích cực không bị xóa chỉ vì người dùng đồng thời có tín hiệu âm.

## 2. Định nghĩa công thức

Ký hiệu:

- d ∈ {product, category, brand} là một chiều hồ sơ.
- x là khóa tương ứng: mã sản phẩm, mã danh mục hoặc mã thương hiệu.
- e là sự kiện tương tác có trọng số wₑ và thời điểm tₑ.
- wₑ⁺ = max(wₑ, 0) là phần tín hiệu tích cực.
- t là thời điểm cần chấm; H > 0 là half-life tính theo ngày.
- M_d > 0 là ngưỡng chuẩn hóa riêng của chiều d.
- λ_d ≥ 0 là trọng số kết hợp của chiều d, với tổng λ_d bằng 1.

Tổng tín hiệu dương đã suy giảm của khóa x tại thời điểm t được định nghĩa:

$$
A_{d,x}(t)=Σ_{e ∈ E(d,x)} wₑ⁺ × 2^{-max(0,t-tₑ)/H}.
$$

Tuổi sự kiện cần được đổi sang cùng đơn vị ngày với H. Điểm riêng của một chiều là:

$$
P_{d,x}(t)=min(1, A_{d,x}(t)/M_d).
$$

Với sản phẩm ứng viên i, lấy đúng khóa sản phẩm, danh mục và thương hiệu của nó:

$$
profileAffinity(u,i,t)=λ_p P_{productId(i)}(t)+λ_c P_{categoryId(i)}(t)+λ_b P_{brandId(i)}(t).
$$

Nếu hồ sơ không có khóa tương ứng thì điểm chiều đó bằng 0.

### Giá trị mặc định trong dự án

| Tham số      | Sản phẩm | Danh mục | Thương hiệu | Nguồn                                                       |
| ------------ | -------: | -------: | ----------: | ----------------------------------------------------------- |
| Ngưỡng M_d   |        8 |       16 |           8 | Mặc định cấu hình dự án                                     |
| Trọng số λ_d |      0.5 |      0.3 |         0.2 | Mặc định cấu hình dự án                                     |
| Half-life H  |   7 ngày |   7 ngày |      7 ngày | Chính sách cố định trong code; ENV chỉ được giữ ở giá trị 7 |

Trọng số và ngưỡng có thể cấu hình. Code chuẩn hóa ba trọng số về tổng 1; giá trị không hợp lệ quay về mặc định và tổng trọng số bằng 0 cũng dùng mặc định. Half-life được khóa ở 7 ngày vì code đã lưu aggregate sau khi decay; đổi H mà không replay lịch sử sẽ trộn hai chính sách. **Không bài báo nào được trích ở đây chứng minh các con số 8, 16, 8; 0.5, 0.3, 0.2 hoặc 7 ngày là tối ưu cho dữ liệu dự án.** Chúng là cấu hình ban đầu cần được đánh giá riêng.

## 3. Vì sao dùng suy giảm half-life?

Đây là lựa chọn mô hình hóa dựa trên giả định cụ thể: mức ảnh hưởng chỉ phụ thuộc tuổi a của sự kiện; suy giảm qua hai khoảng liên tiếp phải nhất quán với suy giảm tổng của cả khoảng:

$$
D(0)=1,  D(a+b)=D(a)D(b),  D(a)>0.
$$

Đặt g(a) = -ln D(a). Từ tính nhân ở trên:

$$
g(a+b)=-ln(D(a)D(b))=g(a)+g(b).
$$

Nếu hàm suy giảm liên tục, nghiệm của phương trình cộng này có dạng g(a)=ka; do đó D(a)=e^{-ka}. Half-life H được định nghĩa là tuổi tại đó tín hiệu còn một nửa:

$$
D(H)=1/2  ⇒  e^{-kH}=1/2  ⇒  k=ln(2)/H.
$$

Thay vào biểu thức D(a):

$$
D(a)=e^{-a ln(2)/H}=2^{-a/H}.
$$

Như vậy, **dạng mũ half-life là hệ quả toán học của giả định suy giảm liên tục, dương và nhất quán khi ghép các khoảng thời gian**. Đây không phải chứng minh rằng người dùng thực tế luôn quên sở thích theo hàm mũ; giả định đó và giá trị H vẫn cần được đánh giá bằng dữ liệu.

## 4. Các tính chất toán học có thể khẳng định

### 4.1. Đúng tính chất half-life

Tại a = H:

$$
D(H)=2^{-H/H}=1/2.
$$

Do đó, nếu không có sự kiện mới, tín hiệu của mỗi sự kiện giảm đúng một nửa sau H ngày. Nếu H = 7, một tín hiệu đơn lẻ 8 điểm sau 7 ngày còn 4 điểm trước khi chia ngưỡng và giới hạn trên.

### 4.2. Điểm thành phần nằm trong [0, 1]

Mỗi wₑ⁺ ≥ 0 và D(a) > 0, nên A_{d,x}(t) ≥ 0. Vì M_d > 0, tỷ số cũng không âm; phép min(1, ...) giới hạn nó trên bởi 1. Suy ra:

$$
0 ≤ P_{d,x}(t) ≤ 1.
$$

### 4.3. Điểm kết hợp nằm trong [0, 1]

Do λ_d ≥ 0 và tổng trọng số bằng 1, profileAffinity là tổ hợp lồi của ba điểm thành phần. Vì mỗi điểm thành phần thuộc [0,1]:

$$
0 ≤ Σ_d λ_d P_d(t) ≤ Σ_d λ_d × 1 = 1.
$$

### 4.4. Sự kiện cũ hơn không làm tín hiệu mạnh hơn

Với H > 0, đạo hàm của D theo tuổi a là:

$$
dD/da = -(ln 2/H) × 2^{-a/H} < 0.
$$

Vì thế, khi giữ nguyên sự kiện và tham số, tăng tuổi sự kiện không thể làm tổng tín hiệu hoặc điểm riêng tăng. Phép giới hạn trên có thể làm hai điểm khác nhau cùng bằng 1, nhưng không đảo chiều thứ tự.

### 4.5. Thêm tín hiệu tích cực không làm điểm giảm

Mỗi tín hiệu mới có wₑ⁺ ≥ 0, nên tổng A không giảm khi thêm tín hiệu đó. Chia cho ngưỡng dương rồi chặn trên bảo toàn tính không giảm. Sau khi thành phần đạt 1, tín hiệu bổ sung không làm thành phần vượt 1.

Những kết luận này là về **feature**. Chúng không có nghĩa rằng thay đổi feature nhất định sẽ đẩy sản phẩm lên trong kết quả cuối, vì LambdaRank không áp ràng buộc đơn điệu cho riêng profileAffinity.

## 5. Vì sao cập nhật cộng dồn trong code tương đương công thức tổng?

Nếu tổng cũ được lưu tại mốc T, sự kiện mới có trọng số w tại tₑ, đặt mốc mới:

$$
T'=max(T,tₑ).
$$

Tổng dương tại mốc mới được cập nhật:

$$
A⁺(T')=A⁺(T) × 2^{-(T'-T)/H}+max(w,0) × 2^{-(T'-tₑ)/H}.
$$

Công thức tương tự được áp dụng riêng cho tổng âm với max(-w,0). Tín hiệu cũ được chuyển từ T sang T'; sự kiện mới được chuyển từ thời điểm phát sinh sang T'. Vì:

$$
2^{-(a+b)/H}=2^{-a/H} × 2^{-b/H},
$$

mỗi đóng góp sau cập nhật bằng đúng đóng góp của sự kiện đó nếu tính trực tiếp tại T'. Bằng quy nạp theo số sự kiện, phép cập nhật lặp cho cùng kết quả với phép cộng các sự kiện đã suy giảm về cùng một mốc, miễn là dùng cùng H và lịch sử ban đầu đầy đủ.

Khi truy vấn ở thời điểm muộn hơn T', code tiếp tục suy giảm tổng từ **last_signal_at** đến thời điểm chấm. Ledger sự kiện có khóa duy nhất ngăn cùng một event bị cộng lại khi Kafka gửi lại.

## 6. Ví dụ số

Giả sử hồ sơ hiện tại có:

- Sản phẩm: 4 điểm, nên P_product = min(1, 4/8) = 0.5.
- Danh mục: 8 điểm, nên P_category = min(1, 8/16) = 0.5.
- Thương hiệu: 2 điểm, nên P_brand = min(1, 2/8) = 0.25.

Với trọng số mặc định:

$$
profileAffinity=0.5(0.5)+0.3(0.5)+0.2(0.25)=0.45.
$$

Nếu tín hiệu sản phẩm 16 điểm đã cũ đúng 7 ngày, H = 7 làm nó còn 16 × 1/2 = 8; điểm riêng sản phẩm là min(1, 8/8) = 1. Nếu danh mục hiện có 32 điểm, điểm riêng danh mục vẫn bị giới hạn ở 1. Với thương hiệu không có tín hiệu, điểm là 0; kết quả kết hợp là 0.5 + 0.3 = 0.8.

## 7. Nghiên cứu hỗ trợ điều gì?

- **Ardagelou và Arampatzis (2017)** đưa trọng số suy giảm exponential half-life vào mô hình recommender, diễn giải half-life là thời gian để mức ảnh hưởng còn một nửa và đánh giá trên MovieLens 100K. Giá trị tốt trong thí nghiệm của họ khoảng 150 ngày. Nghiên cứu hỗ trợ **họ phương pháp suy giảm half-life**; giá trị đó không thể chuyển thẳng thành 7 ngày cho thương mại điện tử của dự án. [Bài báo tại CEUR-WS, TDDL 2017](https://ceur-ws.org/Vol-2038/paper1.pdf).
- **Stefanidis và cộng sự (2012)** mô tả damped-window recommendation, trong đó preference lịch sử giảm dần bằng hàm exponential theo tuổi. Trên tập MovieLens họ dùng, phần decay thuần túy cho cải thiện rất nhỏ hoặc không đáng kể; đây là lời nhắc rằng phương pháp hợp lý về mặt mô hình hóa chưa chắc cải thiện mọi tập dữ liệu. [Bài báo DEXA 2012, trang 329–344](https://homepages.tuni.fi/konstantinos.stefanidis/docs/dexa12.pdf).
- **Sánchez-Moreno và cộng sự (2020)** nghiên cứu preference ngầm có dấu thời gian và đưa suy giảm exponential vào hệ thống gợi ý âm nhạc. Bài báo tham chiếu trường hợp implicit feedback, nhưng lĩnh vực âm nhạc khác hành vi mua sắm nên không thay thế đánh giá trên dữ liệu thương mại điện tử của dự án. [Applied Sciences, 10(15), 5324](https://doi.org/10.3390/app10155324).

**Kết luận về nguồn:** các nghiên cứu trên cho thấy suy giảm theo độ mới là lựa chọn đã được nghiên cứu. Chúng không chứng minh trực tiếp việc gộp ba chiều sản phẩm/danh mục/thương hiệu theo đúng công thức của dự án; không chứng minh H = 7, ngưỡng hoặc trọng số mặc định; và không chứng minh ranking của hệ thống này tốt hơn baseline.

## 8. Giới hạn cần nói rõ

1. Đây là heuristic có tính chất toán học rõ ràng, không phải công thức phổ quát đã được chứng minh tối ưu cho mọi shop hay mọi người dùng.
2. Việc chặn điểm tại 1 làm mất phân biệt giữa các tổng tín hiệu đã vượt ngưỡng M_d.
3. Projection chỉ tái dựng chính xác khi lịch sử event và timestamp được giữ đầy đủ, dùng cùng half-life. Migration hiện tại tách tổng cũ thành positive_score = max(score, 0) và negative_score = max(-score, 0) tại last_signal_at; nó không thể phục hồi chính xác cực tính và timestamp của event cũ. Order item cũ cũng chưa có brand snapshot. Muốn kiểm chứng chính xác phần lịch sử này phải replay event gốc; dữ liệu đã mất không thể suy ra từ aggregate. [Migration profile](../../../services/recommendation-service/src/database/migrations/1788035000000-add-profile-decayed-components.ts), [migration brand snapshot](../../../services/order-service/src/database/migrations/1794090000000-add-order-item-brand.ts).
4. **profileAffinity** chỉ áp dụng cho candidate đã được tạo. Nó không đảm bảo candidate từ sở thích hồ sơ sẽ xuất hiện trong candidate pool.

## 9. Câu trả lời ngắn khi giảng viên hỏi

> “Em chứng minh hai việc khác nhau. Về toán học, với giả định suy giảm liên tục và nhất quán theo thời gian, half-life cho hàm 2^(-age/H); từ công thức này em chứng minh điểm từng chiều và điểm kết hợp nằm trong [0,1], sở thích cũ không tăng điểm, và tín hiệu tích cực bổ sung không làm điểm giảm. Nghiên cứu trước hỗ trợ cách mô hình hóa theo thời gian, nhưng không chứng minh các tham số mặc định của dự án. Vì vậy em kiểm tra code bằng unit test, rồi đánh giá xem feature này có giúp LambdaRank trên log hiển thị thực tế hay không.”

## Tài liệu tham khảo

1. Panagiotis Ardagelou và Avi Arampatzis. 2017. “A Half-Life Decaying Model for Recommender Systems with Matrix Factorization.” _1st Workshop on Temporal Dynamics in Digital Libraries (TDDL 2017)_, CEUR Workshop Proceedings, Vol. 2038. [Bản toàn văn](https://ceur-ws.org/Vol-2038/paper1.pdf).
2. Kostas Stefanidis, Irene Ntoutsi, Kjetil Nørvåg và Hans-Peter Kriegel. 2012. “A Framework for Time-Aware Recommendations.” _Database and Expert Systems Applications (DEXA 2012)_, LNCS, Part II, tr. 329–344. [Bản toàn văn](https://homepages.tuni.fi/konstantinos.stefanidis/docs/dexa12.pdf).
3. David Sánchez-Moreno, Yanyi Zheng và María N. Moreno-García. 2020. “Time-Aware Music Recommender Systems: Modeling the Evolution of Implicit User Preferences and User Listening Habits in a Collaborative Filtering Approach.” _Applied Sciences_, 10(15), 5324. [DOI: 10.3390/app10155324](https://doi.org/10.3390/app10155324).

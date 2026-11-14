# Tiêu chí 6 — Độ mới của sản phẩm (`freshness`)

> **Mục tiêu:** đưa tuổi sản phẩm trong catalog thành một feature để LambdaRank cân nhắc khi xếp hạng. `freshness` đo thời gian từ lúc sản phẩm được tạo; nó không phải độ mới của tương tác, độ phổ biến gần đây, xác suất mua hay điểm cuối cùng.

## 1. Công thức hiện tại

Với sản phẩm `i`, thời điểm cần chấm `t`, ngày tạo `createdAtᵢ` và `D = 86.400.000` mili giây mỗi ngày, code tính tuổi:

$$
a_i(t)=\max\left(0,\frac{t-createdAt_i}{D}\right).
$$

Sau đó ánh xạ tuổi vào năm mức:

$$
F_{bucket}(a)=
\begin{cases}
1.00,&0\le a\le1,\\
0.80,&1<a\le7,\\
0.55,&7<a\le30,\\
0.30,&30<a\le90,\\
0.10,&a>90.
\end{cases}
$$

Ngày tạo trong tương lai được xem là tuổi `0`, nên nhận `1.00`. Trong vector ranking, feature này được giới hạn tự nhiên trong `[0.10,1.00]`; LambdaRank nhận nó cùng các feature khác. Không có phép nhân với “trọng số 8%” ở bước tạo feature hay ở đường xếp hạng AI hiện tại.

## 2. Tính chất toán học và điểm yếu của bucket

### 2.1. Bị chặn và không tăng theo tuổi

Mọi nhánh trả về một trong các hằng số `{0.10, 0.30, 0.55, 0.80, 1.00}`, nên `F_bucket(a) ∈ [0.10,1.00]`.

Nếu `a₁ ≤ a₂`, các khoảng tuổi được sắp theo thứ tự và mức điểm không tăng khi chuyển sang khoảng sau; vì vậy `F_bucket(a₁) ≥ F_bucket(a₂)`. Đây là tính đơn điệu **không tăng** theo tuổi sản phẩm.

### 2.2. Hàm gián đoạn tại các mốc

Điểm không thay đổi bên trong mỗi bucket, nhưng giảm đột ngột ngay sau mốc:

| Tuổi vừa đến mốc | Điểm tại mốc | Điểm ngay sau mốc | Mức nhảy xuống |
| ---------------: | -----------: | ----------------: | -------------: |
|           1 ngày |         1.00 |              0.80 |           0.20 |
|           7 ngày |         0.80 |              0.55 |           0.25 |
|          30 ngày |         0.55 |              0.30 |           0.25 |
|          90 ngày |         0.30 |              0.10 |           0.20 |

Ví dụ, sản phẩm 30 ngày tuổi nhận `0.55`; chỉ cần vượt 30 ngày rất ít là điểm thành `0.30`. Đây là đặc tính của bảng ngưỡng, không phải hành vi suy ra từ dữ liệu.

### 2.3. Điều chứng minh này không nói lên

- Điểm mới giảm theo tuổi không chứng minh khách hàng thực sự thích sản phẩm mới hơn.
- Tính đơn điệu của feature không đảm bảo sản phẩm mới hơn đứng trên sản phẩm khác trong kết quả cuối: LambdaRank còn sử dụng các feature khác, và freshness hiện không có ràng buộc đơn điệu trong trainer.
- Tuổi sản phẩm lấy từ `createdAt` cũng không đo xu hướng mua gần đây. Sản phẩm cũ vẫn có thể đang tăng nhu cầu; sản phẩm mới có thể ít liên quan hoặc chưa có đủ thông tin.

## 3. Cơ sở nghiên cứu và ranh giới áp dụng

Nghiên cứu xác nhận **yếu tố thời gian có thể ảnh hưởng tới recommendation**, nhưng không khẳng định “mới hơn luôn tốt hơn” hoặc bộ mốc `1/7/30/90` là tối ưu:

1. **Koren (KDD 2009), “Collaborative Filtering with Temporal Dynamics.”** Phân tích hơn 100 triệu rating Netflix và mô hình hóa biến động theo thời gian. Nghiên cứu quan sát rating trung bình thay đổi theo tuổi phim; trong dataset đó phim cũ còn có xu hướng nhận rating cao hơn phim mới. Tác giả dùng các hiệu ứng thời gian theo bin cho item bias và cho biết độ rộng bin cần cân bằng độ phân giải với số quan sát trong mỗi bin. Điều này ủng hộ việc đo ảnh hưởng thời gian theo dữ liệu; nó cảnh báo rằng tuổi item không có quan hệ phổ quát “càng mới càng tốt”. Nghiên cứu không xác nhận bucket của dự án. [Bài báo KDD 2009](https://doi.org/10.1145/1557019.1557072), [bản toàn văn](https://yuzhang-teaching.github.io/CSCE670-F25/Koren09.pdf).
   **Wu et al. (2010), “Time-aware Collaborative Filtering with the Piecewise Decay Function.”** Nhóm tác giả đo ảnh hưởng của các tương tác cũ trên dữ liệu Delicious, quan sát các pha suy giảm khác nhau, rồi xây hàm suy giảm từng đoạn và tối ưu tham số bằng hit-rate. Đây là bằng chứng rằng dạng piecewise có thể phù hợp khi được suy ra từ dữ liệu; nhưng biến họ suy giảm là ảnh hưởng của **tương tác theo tuổi**, không phải `createdAt` của sản phẩm. Các mốc của bài không thể chuyển thẳng sang bucket `freshness` này. [Bài báo và thí nghiệm](https://arxiv.org/abs/1010.3988).
   **Ding & Li (CIKM 2005), “Time Weight Collaborative Filtering.”** Đề xuất trọng số thời gian cho tương tác trong item-based collaborative filtering. Đây là nền tảng cho họ phương pháp time-decay của tín hiệu hành vi, không phải bằng chứng trực tiếp cho điểm “sản phẩm mới”. [DOI ACM](https://doi.org/10.1145/1099554.1099689).
   **Zhang, Liu & Zeng (2017), “Timeliness in recommender systems.”** Nghiên cứu vai trò tính kịp thời trong recommendation và đánh giá trên dữ liệu có trật tự thời gian. Kết quả hỗ trợ phải xét thời gian trong thiết kế đánh giá; không xác nhận các giá trị bucket của dự án. [DOI](https://doi.org/10.1016/j.eswa.2017.05.038).

**Kết luận về nguồn:** nghiên cứu hỗ trợ việc xem xét biến thời gian và đánh giá bằng protocol theo thời gian. Không nguồn nào ở trên chứng minh các ngưỡng `1, 7, 30, 90` hay các điểm `1.00, 0.80, 0.55, 0.30, 0.10` là tối ưu cho catalog này.

## 4. Công thức liên tục đáng đưa vào phép so sánh

Nếu muốn bỏ các cú nhảy nhân tạo nhưng vẫn giữ điểm sàn `m`, có thể so bucket với hàm suy giảm mũ:

$$
F_{exp}(a)=m+(1-m)\,2^{-a/H},\qquad a\ge0,\ H>0,
$$

trong đó `H` là half-life tính bằng ngày: phần điểm trên sàn giảm còn một nửa sau `H` ngày. Tương đương, `F_exp(a)=m+(1-m)e^{-\lambda a}` với `λ=ln(2)/H`.

Với `0≤m<1`, `H>0`, hàm liên tục, `F_exp(0)=1`, `m<F_exp(a)≤1`, và đạo hàm `F'_{exp}(a)=-(1-m)(ln2/H)2^{-a/H}<0`; do đó điểm giảm trơn, không tăng theo tuổi và tiến dần tới sàn `m`.

Hàm mũ có cơ sở như **một họ công thức suy giảm theo thời gian** trong nghiên cứu recommender; nó không phải công thức mà các bài trên đã chứng minh tối ưu cho tuổi sản phẩm. `H` và `m` vẫn phải được chọn trên validation. Vì vậy nên xem đây là ứng viên benchmark so với bucket, không tự ý ghi là bản tối ưu trước khi đo.

## 5. Ký hiệu và tham số

| Tham số              | Giá trị hiện tại               | Nguồn gốc                  | Cách diễn giải                                                            |
| -------------------- | ------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| Ngày trong mili giây | `86.400.000`                   | Quy đổi đơn vị             | Đổi tuổi từ mili giây sang ngày.                                          |
| Ngưỡng tuổi          | `1, 7, 30, 90` ngày            | Quy tắc khởi tạo của dự án | Chia tuổi sản phẩm thành bucket.                                          |
| Mức điểm             | `1.00, 0.80, 0.55, 0.30, 0.10` | Quy tắc khởi tạo của dự án | Gán điểm cố định cho từng bucket.                                         |
| `H`, `m` của hàm mũ  | Chưa dùng                      | Tham số benchmark đề xuất  | Chọn trên validation; không lấy từ paper như thể đã hiệu chuẩn cho dự án. |

Không gán cho LambdaRank trọng số tay theo phần trăm: `freshness` chỉ là một cột đầu vào. Nếu muốn chọn bucket/half-life dựa trên ranking, phải huấn luyện và đánh giá trên cùng protocol có tách validation/test; phép tính đại số chỉ chứng minh miền giá trị và chiều thay đổi của feature.

## Tài liệu tham khảo

1. Yehuda Koren. 2009. “Collaborative Filtering with Temporal Dynamics.” _Proceedings of the 15th ACM SIGKDD International Conference on Knowledge Discovery and Data Mining_, 447–456. [DOI](https://doi.org/10.1145/1557019.1557072), [PDF](https://yuzhang-teaching.github.io/CSCE670-F25/Koren09.pdf).
2. Pei Wu, Chi Ho Yeung, Weiping Liu, Cihang Jin & Yi-Cheng Zhang. 2010. “Time-aware Collaborative Filtering with the Piecewise Decay Function.” [Bài báo](https://arxiv.org/abs/1010.3988).
3. Yi Ding & Xue Li. 2005. “Time Weight Collaborative Filtering.” _Proceedings of CIKM 2005_, 485–492. [DOI](https://doi.org/10.1145/1099554.1099689).
4. Fuguo Zhang, Qihua Liu & An Zeng. 2017. “Timeliness in recommender systems.” _Expert Systems with Applications_, 85, 270–278. [DOI](https://doi.org/10.1016/j.eswa.2017.05.038).

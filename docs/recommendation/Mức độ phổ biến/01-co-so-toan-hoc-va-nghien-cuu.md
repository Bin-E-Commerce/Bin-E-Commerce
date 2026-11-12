# Tiêu chí 5 — Mức độ phổ biến (`popularity`)

> **Mục tiêu:** đưa mức phổ biến của sản phẩm vào vector đặc trưng để LambdaRank học cách sử dụng khi xếp hạng. `popularity` là feature trong `[0,1]`, không phải xác suất mua, điểm cuối cùng, hay thuật toán gợi ý độc lập.

## 1. Công thức đang có trong code

Với sản phẩm `i`, đặt `sᵢ = totalSoldᵢ`. Code chuẩn hóa riêng dữ liệu doanh số lỗi: đặt `xᵢ=max(0,sᵢ)` nếu `sᵢ` hữu hạn, còn nếu không thì `xᵢ=0`. Thành phần doanh số là:

$$
g(s_i)=\operatorname{clamp}_{[0,1]}\left(\frac{\ln(1+x_i)}{12}\right).
$$

Với một đóng góp từ nguồn `q` là `TRENDING` hoặc `BEST_SELLING`, có hạng `r` và kích thước danh sách `n`, điểm hạng là:

$$
h(r,n)=
\begin{cases}
1, & n=1\text{ và }r=1,\\
1-\dfrac{r-1}{n-1}, & n>1\text{ và }1\le r\le n,\\
0, & \text{còn lại.}
\end{cases}
$$

Lấy điểm hạng lớn nhất trong các đóng góp nguồn hợp lệ, ký hiệu `Rᵢ`; nếu không có đóng góp hợp lệ thì `Rᵢ=0`. Điểm hiện tại là:

$$
P_i=\operatorname{clamp}_{[0,1]}\bigl(\max(g(s_i),R_i)\bigr).
$$

Trong code, `Math.log1p` tính `ln(1+xᵢ)`; doanh số không hữu hạn được thay riêng bằng 0 để không xóa một hạng nguồn hợp lệ. `Rᵢ` chỉ đọc `sourceRank` và `sourceSize` của `TRENDING`/`BEST_SELLING`; nhiều đóng góp cùng loại được gộp bằng `max`.

### Hai hạng nguồn biểu thị dữ liệu khác nhau

- `BEST_SELLING` lấy danh sách theo `total_sold` giảm dần.
- `TRENDING` xếp theo điểm tương tác cuốn chiếu: lượt xem hôm nay `×0,1`, nhấp hôm nay `×0,5`, thêm giỏ trong 7 ngày `×2`, mua trong 30 ngày `×3`; sau đó dùng `total_sold` và mã sản phẩm làm khóa phụ.
- Candidate generation gắn hạng và kích thước của danh sách nguồn vào `contributions`. Các nguồn này có giới hạn kết quả và điều kiện loại trừ; `BEST_SELLING` được gọi ở chiến lược cold-start, `TRENDING` được gọi cho các request cá nhân hóa/phiên.

Do đó `Pᵢ` gộp doanh số tích lũy và vị trí trong danh sách truy hồi. Nó không phải một phép đo thuần nhất của “số người đã quan tâm”.

## 2. Tính chất toán học có thể chứng minh

### 2.1. Miền giá trị

Với `sᵢ` hữu hạn và không âm, `g(sᵢ) ≥ 0`; phép `clamp` bảo đảm `g(sᵢ) ≤ 1`. Hạng hợp lệ có `1 ≤ r ≤ n`, nên khi `n > 1`, `0 ≤ 1 − (r−1)/(n−1) ≤ 1`. Trường hợp `n=1` cho 1; đầu vào hạng thiếu hoặc sai cho 0. Vì `max` và `clamp` không đưa giá trị ra ngoài `[0,1]`, `Pᵢ ∈ [0,1]` trên miền dữ liệu hợp lệ.

### 2.2. Doanh số tăng thì điểm doanh số không giảm

Trước khi chạm trần, với `s ≥ 0`:

$$
g'(s)=\frac{1}{12(1+s)}>0,
\qquad
g''(s)=-\frac{1}{12(1+s)^2}<0.
$$

Vì vậy thành phần doanh số tăng theo `totalSold`, nhưng mức tăng biên giảm dần. Sau khi chạm 1, thành phần này bão hòa. Ngưỡng lý thuyết là `s ≥ e¹²−1`, tức khoảng **162.755 lượt bán** với số nguyên; sau ngưỡng đó, công thức không phân biệt thêm doanh số. Đây là tính chất của hệ số `/12`, không phải ngưỡng được một nghiên cứu bên ngoài xác nhận.

### 2.3. Hạng tốt hơn trong cùng một danh sách được điểm cao hơn

Giữ `n > 1` cố định. Với hai hạng hợp lệ `r₁ < r₂`:

$$
h(r_1,n)-h(r_2,n)=\frac{r_2-r_1}{n-1}>0.
$$

Hạng đầu nhận 1, hạng cuối nhận 0. Nếu `n=1`, item duy nhất nhận 1 theo nhánh riêng. Tính chất này chỉ so sánh được trong cùng danh sách có cùng `n`; nó không chứng minh hai hạng thuộc các nguồn hoặc request khác nhau có ý nghĩa tương đương.

### 2.4. Phép gộp chọn bằng chứng lớn nhất

`max(g,R)` không cộng hai nguồn bằng chứng. Nếu doanh số đã cho điểm cao hơn hạng nguồn, hạng nguồn không làm tăng thêm; nếu hạng nguồn lớn hơn, hạng nguồn thay thế giá trị doanh số. Phép gộp vẫn bị chặn trong `[0,1]`, nhưng hai đại lượng không được hiệu chuẩn cùng thang đo bởi một định lý hay nguồn nghiên cứu.

## 3. Ví dụ tính tay

Với `totalSold=10`, `g=ln(11)/12≈0,1998`.

| Đầu vào                    | Điểm hạng | `popularity` | Diễn giải                                               |
| -------------------------- | --------: | -----------: | ------------------------------------------------------- |
| Không có hạng nguồn hợp lệ |         0 |       0,1998 | Dùng điểm doanh số.                                     |
| `TRENDING`, hạng 2/5       |      0,75 |         0,75 | Hạng nguồn lớn hơn điểm doanh số.                       |
| Hạng 5/5                   |         0 |       0,1998 | Doanh số vẫn là bằng chứng còn lại.                     |
| Hạng 1/1                   |         1 |            1 | Một item duy nhất trong danh sách được xem là đứng đầu. |
| `totalSold ≥ 162.755`      |         — |            1 | Doanh số bão hòa; điểm hạng không thể làm vượt 1.       |

Đây là kết quả tính theo code hiện tại, không phải kết quả đo tương tác người dùng.

## 4. Nguồn nghiên cứu hỗ trợ điều gì?

1. **Ji, Sun, Zhang & Li (SIGIR 2020), “A Re-visit of the Popularity Baseline in Recommender Systems.”** Bài báo mô tả MostPop phổ biến là xếp item theo số tương tác trong tập huấn luyện; đồng thời đề xuất RecentPop theo tương tác trong cửa sổ gần nhất và DecayPop theo tổng tương tác có suy giảm mũ theo tháng. Trên MovieLens20M, protocol của bài báo cho thấy RecentPop/DecayPop vượt MostPop về HR/NDCG. Kết quả đó hỗ trợ việc có baseline popularity và tính thời điểm khi tái dựng popularity; **không chứng minh** `ln(1+totalSold)/12`, phép gộp `max`, hoặc source-rank của dự án là tối ưu. [Bản bài báo và định nghĩa ba phương pháp](https://arxiv.org/html/2005.13829v2), [DOI SIGIR](https://doi.org/10.1145/3397271.3401233).
2. **Steck (RecSys 2011), “Item Popularity and Recommendation Accuracy.”** Nghiên cứu định lượng quan hệ giữa popularity, độ chính xác và long tail, bao gồm thí nghiệm thực nghiệm và user study. Nó nhắc rằng việc ưu tiên độ chính xác/popular item đi kèm lựa chọn về độ phổ biến của item được đề xuất; không khẳng định một công thức popularity duy nhất phù hợp mọi hệ thống. [DOI ACM](https://doi.org/10.1145/2043932.2043957).

**Phân định bằng chứng:** các nguồn trên nghiên cứu thuật toán/baseline hoàn chỉnh trên dataset và protocol riêng. Chứng minh ở mục 2 chỉ xác nhận tính chất đại số của công thức dự án. Không có bài báo nào trong các nguồn này chứng minh hệ số 12, dùng lifetime sales, chuẩn hóa hạng theo kích thước danh sách, hay lấy `max` là lựa chọn tốt nhất cho dự án.

## 5. Phương pháp có thể so sánh

| Phương pháp           | Điểm/xếp hạng                                                                                                            | Quan hệ với code dự án                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MostPop**           | Xếp theo số tương tác đã biết tại thời điểm train/request; phải chốt loại tương tác và mốc dữ liệu.                      | Đối chứng đơn giản. `totalSold` chỉ là lượt bán tích lũy, còn bài báo định nghĩa theo tương tác; cần chọn cùng loại outcome hoặc ghi rõ khác biệt. |
| **RecentPop**         | Đếm tương tác trong cửa sổ `[t−Δt,t]`; bài Ji et al. dùng 1 tháng trên MovieLens.                                        | Có thể chuyển sang cửa sổ mua hàng của e-commerce; độ dài cửa sổ cần chọn trên validation.                                                         |
| **DecayPop**          | Cộng tương tác ở các khoảng thời gian với trọng số giảm theo tuổi; bài Ji et al. dùng 6 tháng và trọng số mũ theo tháng. | So với tín hiệu gần đây trong `TRENDING`; công thức dự án không phải DecayPop vì nó dùng điểm tổng hợp rolling và source rank.                     |
| **ProjectPopularity** | `max(log1p(totalSold)/12, validSourceRankScore)`                                                                         | Feature hiện tại, trộn sales tích lũy với thứ hạng nguồn. Hệ số 12 và cách gộp là quyết định riêng của dự án.                                      |

Không được trình bày RecentPop/DecayPop như công thức giống hệt `TRENDING`: `TRENDING` có trọng số view/click/cart/purchase khác nhau, dùng các cửa sổ khác nhau cho từng loại sự kiện, và candidate chỉ nhận source rank nếu lọt vào danh sách truy hồi.

## 6. Giới hạn cần nói rõ khi bảo vệ

- **Rank nguồn là proxy có điều kiện.** `sourceRank` chỉ là vị trí trong danh sách trả về (tối đa 80), không phải percentile trên toàn catalog. Sau khi áp dụng loại trừ sản phẩm/shop, kích thước và thứ hạng danh sách có thể đổi. Cùng một sản phẩm có thể nhận điểm `h(r,n)` khác giữa request nếu `n` khác; ví dụ hạng 10/80 cho khoảng 0,886 còn hạng 10/20 cho khoảng 0,526.
- **Các nguồn không cùng thang đo.** Hạng đầu `TRENDING` và hạng đầu `BEST_SELLING` đều bằng 1, dù một nguồn gộp tương tác ngắn hạn còn nguồn kia dựa trên doanh số tích lũy. `max` che khác biệt này và bỏ mất tín hiệu của nguồn còn lại.
- **Trường hợp một item cho điểm 1.** `n=1` nhận 1 dù danh sách có thể chỉ còn một kết quả sau loại trừ. Đây là quy tắc code, không suy ra item đó phổ biến nhất trong catalog.
- **Thời điểm snapshot là thiết yếu.** Tổng bán hiện tại hoặc điểm `TRENDING` ở hiện tại không thể dùng để chấm một request lịch sử. Phải dựng count/hạng chỉ từ dữ liệu có timestamp không muộn hơn thời điểm request; nếu không, giao dịch tương lai rò vào feature.
- **Không có định lý về chất lượng xếp hạng.** Miền `[0,1]` và tính đơn điệu không chứng minh LambdaRank học được trọng số hữu ích, NDCG/Recall tăng, hay doanh thu tăng. Những điều đó cần phép đo độc lập ở tài liệu 02.

## 7. Tóm tắt trả lời giảng viên

> “Popularity của em là một feature đầu vào cho LambdaRank. Nó lấy giá trị lớn hơn giữa log số lượt bán tích lũy đã chuẩn hóa và thứ hạng trong hai nguồn `TRENDING`/`BEST_SELLING`. Em chứng minh được feature bị chặn trong `[0,1]`, doanh số tăng thì thành phần log không giảm với lợi ích biên giảm dần, và hạng tốt hơn trong cùng danh sách nhận điểm cao hơn. Nghiên cứu hỗ trợ việc dùng popularity làm baseline và cảnh báo phải tính theo thời điểm; nghiên cứu không chứng minh hệ số 12 hay phép gộp của em tối ưu. Hiệu quả thực tế phải kiểm tra bằng log hiển thị thật, không thể suy ra từ tính chất toán học.”

## Tài liệu tham khảo

1. Yitong Ji, Aixin Sun, Jie Zhang, Chenliang Li. 2020. “A Re-visit of the Popularity Baseline in Recommender Systems.” _Proceedings of SIGIR 2020_. [Bản HTML toàn văn](https://arxiv.org/html/2005.13829v2), [DOI](https://doi.org/10.1145/3397271.3401233).
2. Harald Steck. 2011. “Item Popularity and Recommendation Accuracy.” _Proceedings of RecSys 2011_, 125–132. [DOI](https://doi.org/10.1145/2043932.2043957).

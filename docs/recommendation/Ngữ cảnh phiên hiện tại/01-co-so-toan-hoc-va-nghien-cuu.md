# Tiêu chí 2 — Ngữ cảnh phiên hiện tại (`sessionContext`)

> **Mục tiêu:** đo độ khớp giữa danh mục, thương hiệu của một sản phẩm ứng viên và những thuộc tính người dùng vừa chủ động tương tác trong phiên. Đây là **một feature đầu vào** của LambdaRank, không phải xác suất mua hay điểm xếp hạng cuối.

## 1. Vì sao thay công thức cũ?

Công thức cũ cộng `0,60` khi danh mục có mặt trong phiên, `0,25` khi thương hiệu có mặt và `0,15` khi ứng viên được tìm từ sản phẩm hiện tại. Nó không phân biệt thuộc tính vừa tương tác với thuộc tính cũ hơn; ba hệ số là quy ước dự án, không suy ra từ nghiên cứu. Phần `0,15` còn trộn **nguồn tạo ứng viên** với **mức khớp ngữ cảnh**: cùng một anchor không chứng minh ứng viên có danh mục hay thương hiệu phù hợp.

Công thức mới chỉ dùng thứ tự các danh mục và thương hiệu trong phiên. Đây là phép **chuyển ý tưởng trọng số vị trí** của nghiên cứu session-based recommendation sang hai thuộc tính mà hệ thống hiện có; không phải bản cài đặt đầy đủ của thuật toán trong bài báo.

## 2. Dữ liệu và ký hiệu

`SessionContextService` lưu hai danh sách khóa duy nhất, mới nhất đứng đầu:

- `C = [c₀, …, cₘ₋₁]`: các danh mục đã tương tác, độ dài `m`.
- `B = [b₀, …, bₙ₋₁]`: các thương hiệu đã tương tác, độ dài `n`.

Một tương tác chủ động với khóa đã có sẽ chuyển khóa đó lên đầu. `PRODUCT_IMPRESSED` thụ động không thay đổi hai danh sách. Độ dài tối đa mặc định là 30 khóa mỗi danh sách, có thể cấu hình từ 1 đến 100; Redis chỉ giữ context trong TTL của phiên (mặc định 24 giờ). Do danh sách đã loại trùng, **vị trí đo độ mới của lần xuất hiện cuối trong từng loại thuộc tính**, không đo tần suất và không bảo toàn thứ tự xen kẽ giữa danh mục với thương hiệu.

Với một khóa `x` và danh sách `L` có độ dài `N`, đặt `r_L(x)` là vị trí tính từ 0, bắt đầu ở mục mới nhất. Định nghĩa:

$$
w_L(x)=
\begin{cases}
\dfrac{N-r_L(x)}{N}, & N>0\text{ và }x\in L,\\
0, & \text{nếu không.}
\end{cases}
$$

Với sản phẩm `i` có danh mục `cat(i)` và thương hiệu `brand(i)`:

$$
sessionContext(i,C,B)=\frac{w_C(cat(i))+w_B(brand(i))}{2}.
$$

Nếu khóa danh mục hoặc thương hiệu của ứng viên thiếu, điểm chiều đó bằng 0. **Hệ số `1/2` là giả định đối xứng của dự án**, không phải hằng số tối ưu được bài báo chứng minh. Nó được giữ cố định để có một feature trong vector ranking; mức đóng góp của feature vào điểm cuối do model học.

## 3. Tính chất toán học

### 3.1. Điểm hữu hạn và thuộc `[0,1]`

Với khóa khớp, `0 ≤ r ≤ N−1`, nên `1 ≤ N−r ≤ N` và `1/N ≤ w_L(x) ≤ 1`. Khóa không khớp nhận 0. Vì cả hai thành phần thuộc `[0,1]`, trung bình của chúng cũng thuộc `[0,1]`. Không cần ép giá trị ngoài miền bằng một phép `clamp` sau đó.

### 3.2. Mục mới hơn được điểm cao hơn

Giữ cố định danh sách `L` dài `N`. Nếu `r₁ < r₂` thì:

$$
w(r₁)-w(r₂)=\frac{r₂-r₁}{N}>0.
$$

Do đó cùng một thuộc tính ở vị trí mới hơn nhận điểm riêng cao hơn. Mục đầu nhận 1; mục cuối nhận `1/N`. Đây là **tính đơn điệu theo vị trí trong cùng một danh sách**, không phải cam kết mọi tương tác mới đều cải thiện thứ hạng cuối của mọi sản phẩm.

### 3.3. Một khóa khác được thêm ở đầu sẽ giảm ảnh hưởng của khóa cũ

Nếu danh sách chưa chạm giới hạn có `N` mục, một khóa mới được thêm ở đầu, khóa cũ tại vị trí `r` chuyển thành `r+1`. Khi đó:

$$
w_{mới}=\frac{N-r}{N+1}<\frac{N-r}{N}=w_{cũ}.
$$

Nếu khóa cũ được tương tác lại, nó được chuyển lên vị trí 0 và nhận điểm 1. Khi danh sách đã đầy, mục cuối bị loại; các mục còn lại lùi một vị trí và giảm `1/N` điểm riêng. Đây là hệ quả của chính sách lưu trữ, không phải decay theo số giờ.

### 3.4. Nguồn tạo ứng viên không tự làm tăng điểm

`w_C` và `w_B` chỉ phụ thuộc khóa thuộc tính và danh sách phiên. Đổi `anchorProductId` hoặc nguồn truy hồi của cùng sản phẩm, trong khi giữ nguyên hai danh sách, không đổi `sessionContext`. Điều này tránh cộng điểm ngữ cảnh cho một ứng viên chỉ vì nó được truy hồi từ sản phẩm hiện tại.

## 4. Ví dụ có thể tính tay

Giả sử `C = [nồi, sách]`, `B = [A, B]`:

| Sản phẩm ứng viên               | Điểm danh mục | Điểm thương hiệu | `sessionContext` |
| ------------------------------- | ------------: | ---------------: | ---------------: |
| Nồi, thương hiệu A              |             1 |                1 |                1 |
| Nồi, thương hiệu B              |             1 |              1/2 |             0,75 |
| Sách, thương hiệu B             |           1/2 |              1/2 |              0,5 |
| Nồi, thương hiệu khác           |             1 |                0 |              0,5 |
| Danh mục khác, thương hiệu khác |             0 |                0 |                0 |

Đây là **golden case về phép tính và thứ tự kỳ vọng theo giả định độ mới**. Nó không phải thí nghiệm chứng minh người dùng thật sẽ chọn theo thứ tự này.

## 5. Nghiên cứu hỗ trợ đến đâu?

1. **Ludewig & Jannach (2018)**, _Evaluation of Session-based Recommendation Algorithms_, mô tả `v-sknn` dùng vector có trọng số **giảm tuyến tính theo vị trí** để tương tác gần đây có ảnh hưởng lớn hơn. Bài báo còn so nhiều phương pháp trên dữ liệu phiên thực. Nghiên cứu hỗ trợ nguyên tắc **thứ tự trong phiên có thể hữu ích** và dạng trọng số vị trí; nó **không chứng minh** phép lấy trung bình danh mục/thương hiệu hoặc tính hiệu quả của feature trong dự án. [Bản toàn văn, mục 3.2](https://arxiv.org/pdf/1803.09587).
2. **Rendle và cộng sự (2011)**, _Fast Context-aware Recommendations with Factorization Machines_, trình bày cách dùng biến ngữ cảnh, gồm thuộc tính item và thông tin tình huống, cho dự đoán gợi ý. Nghiên cứu hỗ trợ việc biểu diễn context dưới dạng feature; phương pháp của họ là Factorization Machines, **không phải công thức `sessionContext` của dự án**. [Bản tác giả, SIGIR 2011](https://www.ismll.uni-hildesheim.de/pub/pdfs/Rendle_et_al2011-Context_Aware.pdf).

**Phân định rõ:** các bài báo cung cấp cơ sở mô hình hóa. Các chứng minh ở mục 3 là chứng minh đại số cho **công thức cụ thể của dự án**. Không có nguồn nào ở đây chứng minh hệ số `1/2`, giới hạn 30 khóa hay TTL 24 giờ là tối ưu; hiệu quả xếp hạng phải đo riêng trên log thật.

## 6. So sánh với công thức đã nghiên cứu

### 6.1. Các công thức trong bài báo

| Phương pháp                         | Dạng công thức/nguyên lý trong nghiên cứu                                                                                                                       | Khác với feature của dự án                                                                                                                      | Điều kiện dữ liệu                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Binary session-kNN (`sKNN`)         | Biểu diễn phiên bằng vector nhị phân; tìm các phiên lịch sử gần bằng cosine/Jaccard; `score(i,s)=Σₙ sim(s,n)·1ₙ(i)`.                                            | Đây là thuật toán truy hồi và cộng điểm ứng viên từ các phiên láng giềng, không phải điểm khớp category/brand đơn lẻ.                           | Cần lịch sử các phiên, item IDs và chỉ mục láng giềng.                               |
| Vector session-kNN (`v-SKNN`)       | Mã hóa phiên hiện tại bằng vector có trọng số vị trí; mục gần cuối phiên nặng hơn; sau đó tính similarity với các phiên lịch sử và cộng evidence cho candidate. | Feature dự án chỉ chuyển ý tưởng vị trí sang hai danh sách metadata đã loại trùng rồi lấy trung bình; chưa làm bước neighbor search của V-SKNN. | Cần chuỗi tương tác theo thứ tự và lịch sử phiên để chạy đúng phương pháp gốc.       |
| Time-weight collaborative filtering | Gán tương tác tại tuổi `Δt` trọng số `f(Δt)=e^(−λΔt)`. Nếu đặt half-life `H=ln(2)/λ`, thì `f(Δt)=2^(−Δt/H)`.                                                    | Đây là trọng số theo thời gian thực dùng trong dự đoán collaborative filtering; nó không tự định nghĩa cách gộp category và brand.              | Cần timestamp từng tín hiệu; bài gốc còn học/chọn decay theo người dùng và cụm item. |

Ludewig & Jannach (2018) mô tả `sKNN` và `v-SKNN`; phần `v-SKNN` làm các tương tác mới hơn nặng hơn bằng trọng số vị trí giảm tuyến tính. Ding & Li (2005) định nghĩa time weighting bằng hàm mũ và chọn tham số half-life theo dữ liệu. Đây là các **phương pháp được nghiên cứu và đánh giá thực nghiệm**, không phải định lý khẳng định công thức sẽ đứng đầu trên mọi hệ thống.

### 6.2. Cùng một ví dụ, điểm từng công thức ra sao?

Để so cùng đại lượng, lấy phép khớp nhị phân hai chiều làm phiên bản rút gọn baseline: `S_bin=(I_category+I_brand)/2`. Với công thức hiện tại, mỗi danh sách có hai khóa `[mới nhất, cũ hơn]`. Với half-life, giả sử tín hiệu cũ hơn đúng `H` thời gian. Điểm exponential bên dưới là phép áp dụng trọng số nghiên cứu vào hai chiều category/brand, **không phải toàn bộ thuật toán collaborative filtering trong bài báo**.

| Ứng viên so với phiên                          | Khớp nhị phân `S_bin` | Vị trí tuyến tính hiện tại | Half-life nếu mục cũ hơn đúng `H` |
| ---------------------------------------------- | --------------------: | -------------------------: | --------------------------------: |
| Khớp danh mục mới nhất và thương hiệu mới nhất |                     1 |                          1 |                                 1 |
| Khớp danh mục mới nhất, thương hiệu cũ hơn     |                     1 |                       0,75 |                              0,75 |
| Khớp cả danh mục và thương hiệu cũ hơn         |                     1 |                        0,5 |                               0,5 |
| Chỉ khớp danh mục mới nhất                     |                   0,5 |                        0,5 |                               0,5 |
| Không khớp thuộc tính nào                      |                     0 |                          0 |                                 0 |

Ở danh sách hai mục và khoảng cách cũ đúng một half-life, linear và exponential cho cùng điểm. Với ba tín hiệu cách đều mỗi `H`, điểm vị trí tuyến tính của ba mục theo thứ tự mới nhất→cũ nhất là `1, 2/3, 1/3`; exponential là `1, 1/2, 1/4`. Linear vì vậy giảm đều theo **thứ hạng trong danh sách**; exponential giảm theo **thời gian thực**. Dữ liệu phiên hiện tại không giữ timestamp từng category/brand, nên chưa thể so exponential một cách đúng dữ liệu nếu không bổ sung timestamp.

### 6.3. Bài báo cho thấy phương pháp nào thắng?

Trong thí nghiệm của Ludewig & Jannach trên bốn bộ dữ liệu thương mại điện tử, V-SKNN không thắng SKNN ở mọi bộ dữ liệu và metric:

| Dataset | V-SKNN P@20 / R@20 | SKNN P@20 / R@20 | Kết quả của bộ dữ liệu đó         |
| ------- | -----------------: | ---------------: | --------------------------------- |
| RSC15   |      0,092 / 0,494 |    0,086 / 0,464 | V-SKNN cao hơn cả hai metric.     |
| TMALL   |      0,088 / 0,291 |    0,095 / 0,312 | SKNN cao hơn cả hai metric.       |
| ROCKET  |      0,055 / 0,462 |    0,056 / 0,478 | SKNN cao hơn nhẹ cả hai metric.   |
| ZALANDO |      0,076 / 0,207 |    0,074 / 0,202 | V-SKNN cao hơn nhẹ cả hai metric. |

Các số này là kết quả của **toàn bộ thuật toán** trên dataset và protocol của bài báo, không phải kết quả công thức `sessionContext` của dự án. Chúng chứng minh thực nghiệm rằng trọng số vị trí đáng để đem ra so; đồng thời cho thấy không thể suy ra V-SKNN hay công thức dự án luôn tốt nhất. [Bài báo, bảng P@20/R@20](https://arxiv.org/pdf/1803.09587).

### 6.4. Kết luận so sánh cho hệ thống hiện tại

- Khớp nhị phân đơn giản, sẵn dữ liệu, nhưng không phân biệt khóa vừa xảy ra với khóa cũ.
- Công thức tuyến tính hiện tại là lựa chọn sát `v-SKNN` nhất vì `SessionContext` đã lưu thứ tự khóa; nó không cần thêm timestamp hay neighbor index.
- Half-life có cơ sở nghiên cứu cho tín hiệu thời gian và có thể mô tả tuổi thật tốt hơn khi khoảng cách giữa sự kiện không đều; hiện cần đổi cấu trúc context để lưu thời gian cho từng khóa.
- Full `sKNN`/`v-SKNN` cần phiên lịch sử và candidate scoring theo neighbor; thay riêng feature hiện tại bằng cosine giữa hai danh sách category/brand sẽ **không** tái tạo đúng phương pháp trong bài báo.

Vì vậy, so sánh hợp lệ trước mắt trên cùng candidate set của dự án là **binary membership vs. linear position**. Half-life có thể làm đối chứng tiếp theo sau khi lưu timestamp. Chỉ log thật chia theo thời gian mới cho biết biến thể nào tốt hơn trong hệ thống này.

## 7. Giới hạn khi bảo vệ công thức

- Các danh sách là **khóa duy nhất** nên mười lần xem cùng danh mục không mạnh hơn một lần xem gần nhất; event type và khoảng thời gian thực giữa hai thao tác không tham gia công thức.
- Một phiên có nhiều khóa khác nhau tạo độ dài danh sách lớn hơn; cùng một vị trí `r` có thể nhận giá trị khác khi `N` khác. Đây là đặc trưng của chuẩn hóa theo độ dài danh sách, không phải trọng số thời gian tuyệt đối.
- Khi thiếu một chiều, điểm tối đa hiện tại là `0,5`. Việc này tránh suy đoán rằng chiều thiếu có mức khớp 1, nhưng có thể bất lợi cho catalog thiếu metadata. Cần đo trên dữ liệu thật trước khi đổi chính sách thiếu dữ liệu.
- `sessionContext` chỉ tính trên candidate đã được truy hồi và lọc; không bảo đảm sản phẩm phù hợp sẽ vào candidate pool. LambdaRank có thể học quan hệ phi tuyến với các feature khác, nên thứ tự của feature **không tự bảo đảm** thứ tự đầu ra của model.

## 8. Trả lời ngắn trước giảng viên

> “Em dùng thứ tự tương tác trong phiên theo nguyên tắc được nghiên cứu trong session-based recommendation: thuộc tính gần đây có trọng số cao hơn. Với danh sách dài N, khóa ở vị trí r tính từ 0 có điểm `(N-r)/N`; không khớp thì 0. Em lấy trung bình điểm danh mục và thương hiệu để thành một feature. Em chứng minh điểm nằm trong `[0,1]`, giảm khi một khóa bị đẩy về sau, và nguồn tạo ứng viên không tự tăng điểm. Đây là một phép chuyển ý tưởng nghiên cứu vào dữ liệu hiện có, không phải công thức gốc của bài báo và cũng chưa được chứng minh tối ưu về xếp hạng khi chưa đo trên log người dùng thật.”

## Tài liệu tham khảo

1. Malte Ludewig và Dietmar Jannach. 2018. “Evaluation of Session-based Recommendation Algorithms.” _User Modeling and User-Adapted Interaction_, 28, 331–390. [Bản toàn văn](https://arxiv.org/pdf/1803.09587), [DOI bài báo](https://doi.org/10.1007/s11257-018-9209-6).
2. Yi Ding và Xue Li. 2005. “Time Weight Collaborative Filtering.” _Proceedings of ACM CIKM 2005_, 485–492. [Bản toàn văn](https://cseweb.ucsd.edu/classes/fa17/cse291-b/reading/p485-ding.pdf), [DOI](https://doi.org/10.1145/1099554.1099689).
3. Steffen Rendle, Zeno Gantner, Christoph Freudenthaler và Lars Schmidt-Thieme. 2011. “Fast Context-aware Recommendations with Factorization Machines.” _SIGIR 2011_. [Bản tác giả](https://www.ismll.uni-hildesheim.de/pub/pdfs/Rendle_et_al2011-Context_Aware.pdf).

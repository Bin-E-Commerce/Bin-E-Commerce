# Tiêu chí 4 — Sản phẩm thường đi cùng nhau (`coBehavior`)

> **Mục tiêu:** tạo một feature biểu diễn mức liên hệ hành vi giữa sản phẩm ứng viên và các sản phẩm mốc của request, dựa trên lượt xem, thêm giỏ, mua chung và hoàn trả. `coBehavior` là một trong các đầu vào của LambdaRank; nó không phải xác suất mua hay điểm xếp hạng cuối.

## 1. Dữ liệu và ý nghĩa của công thức hiện tại

Hệ thống dựng quan hệ từ các cặp sản phẩm cùng xuất hiện trong một phạm vi hành vi:

| Loại quan hệ  | Cách tạo cặp trong code                                                                     |                  Mặc định ban đầu |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------------: |
| `CO_VIEW`     | Hai event xem, bấm hoặc hiển thị khác sản phẩm trong cùng session, cửa sổ đối xứng 30 phút. | Xem `1`, bấm `2`, hiển thị `0,05` |
| `CO_CART`     | Hai event thêm giỏ khác sản phẩm của cùng session hoặc user, cửa sổ 7 ngày.                 |                      Thêm giỏ `3` |
| `CO_PURCHASE` | Mọi cặp sản phẩm khác nhau trong cùng order đã hoàn tất; hoàn trả ghi phần hiệu chỉnh âm.   |      Mua chung `6`, hoàn trả `−6` |

Các trọng số trên là **điểm quy ước của dự án**, không phải số người hay xác suất. Cặp được lưu theo hai chiều để sản phẩm A có thể làm mốc gợi ý B và ngược lại. Pair ledger chống tính lại cùng cặp event khi xử lý lặp. Với event xem/bấm/hiển thị và thêm giỏ, `scoreDelta` hiện lấy trọng số của event đang được xử lý; cặp chỉ được claim một lần. Vì thế cặp `view + click` có thể nhận trọng số khác nhau nếu thứ tự Kafka đến khác nhau, dù pair timestamp được gán bằng thời điểm lớn hơn của hai event. Đây là điểm cần làm rõ nếu muốn replay cho kết quả bất biến theo thứ tự event. Cửa sổ, event type, phạm vi session/user và trọng số được cài trong [`relation-projection.service.ts`](../../../services/recommendation-service/src/modules/relations/application/services/projection/relation-projection.service.ts), còn rule mặc định được đọc ở [`recommendation-rule.service.ts`](../../../services/recommendation-service/src/modules/profiles/application/services/rules/recommendation-rule.service.ts).

Với request có tập sản phẩm mốc `A`, quan hệ `r` và sản phẩm ứng viên `i`, relation read model trả về các đóng góp `(a, r, s)` mà `a ∈ A`. `s` là `rawScore` sau phần giảm tuổi mà query hiện tại đã áp dụng. Mỗi đóng góp được đổi sang thang điểm hữu hạn:

$$
g_r(s)=\frac{\max(0,s)}{\max(0,s)+k_r}, \qquad k_r>0.
$$

Trong [`RankingFeatureService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts), feature của ứng viên là:

$$
coBehavior(i)=\max_{(a,r,s)\in C_i} g_r(s),
$$

trong đó `C_i` là các contribution có `source = CO_BEHAVIOR`; nếu không có contribution thì điểm bằng 0. Code chỉ lấy đóng góp lớn nhất sau chuẩn hóa, không cộng điểm từ nhiều anchor hay nhiều loại quan hệ.

Mặc định `k_CO_VIEW = 1`, `k_CO_CART = 3`, `k_CO_PURCHASE = 6`. Scale được cấu hình riêng. Các giá trị mặc định hiện trùng với trọng số một lần xem, thêm giỏ hoặc mua chung tương ứng; vì thế từng tín hiệu đơn lẻ có `s=k` và cho `0,5`. Đây là quan sát về cấu hình hiện có, không phải tham số đã được nghiên cứu xác nhận tối ưu hay bằng chứng về ý định chọn tham số.

### Lưu ý quan trọng về phần giảm theo thời gian

Query hiện tại áp dụng:

$$
s_{effective}=s_{stored}\times 2^{-(T-t_{last})/H_r},
$$

với `T` là thời điểm query, `t_last` là `last_signal_at`, và `H_r` mặc định 30 ngày. Nhưng `s_stored` trong repository là **tổng cộng dồn**; mỗi lần thêm cặp mới, code cộng delta vào tổng và cập nhật `last_signal_at` thành thời điểm mới nhất. Vì vậy, event mới có thể làm mới tuổi của cả phần tổng cũ. Cách này không tương đương với việc suy giảm từng event độc lập:

$$
\sum_j w_j2^{-(T-t_j)/H_r}
\quad\ne\quad
\left(\sum_jw_j\right)2^{-(T-\max_jt_j)/H_r}
$$

trừ những trường hợp đặc biệt. Projection chỉ kiểm tra timestamp có hợp lệ, không từ chối thời điểm tương lai; vì vậy nếu `last_signal_at > T`, số mũ âm và hệ số decay lớn hơn 1, làm score tăng thay vì giảm. Đây là trường hợp biên cần test/giới hạn timestamp. Do đó, tài liệu này chỉ khẳng định code giảm **aggregate relation score theo `last_signal_at` khi timestamp không ở tương lai**; không khẳng định mọi đóng góp cũ đang được decay riêng như công thức tổng từng event. Cần cân nhắc replay event gốc hoặc đổi cách lưu nếu mục tiêu là decay chính xác theo từng lần đồng xuất hiện.

## 2. Tính chất toán học có thể chứng minh

Các tính chất dưới đây áp dụng cho phép chuẩn hóa sau khi có `rawScore` và `scale` hợp lệ; chúng không chứng minh các sự kiện thật sự phản ánh sản phẩm phù hợp.

### 2.1. Điểm nằm trong `[0,1)`

Trên số thực, đặt `x=max(0,s)`, nên `x ≥ 0`. Vì `k>0`, mẫu `x+k` dương. Suy ra `g=x/(x+k) ≥ 0`. Đồng thời `x < x+k`, nên `g < 1`. Lấy maximum trên một tập hữu hạn các điểm thuộc `[0,1)` vẫn thuộc `[0,1)`; khi tập rỗng, code trả 0. Trong IEEE-754, kết quả vẫn nằm trong `[0,1]`, nhưng tỷ lệ cực lớn có thể được làm tròn thành đúng 1. Code dùng dạng chia tỷ số để tránh tràn mẫu; boundary test và giới hạn số học máy được ghi ở [tài liệu kiểm chứng](02-kiem-chung-code-va-xep-hang.md).

### 2.2. Điểm tăng theo bằng chứng quan hệ dương

Với `s ≥ 0`:

$$
g'_r(s)=\frac{k_r}{(s+k_r)^2}>0.
$$

Do đó nếu cùng loại quan hệ, cùng scale, và các điều kiện khác giữ nguyên, `rawScore` lớn hơn tạo feature contribution lớn hơn trên số thực. Khi tăng một contribution trong phép lấy maximum, giá trị `coBehavior` không giảm; thêm contribution vào tập cũng không thể làm maximum hiện tại giảm. Phát biểu đơn điệu là tính chất toán học của công thức; làm tròn IEEE-754 ở miền cực lớn là giới hạn riêng của cách triển khai.

### 2.3. Lợi ích tăng thêm giảm dần

$$
g''_r(s)=-\frac{2k_r}{(s+k_r)^3}<0.
$$

Hàm tăng nhưng lõm: thêm bằng chứng vào một relation score nhỏ thường làm điểm thay đổi nhiều hơn thêm cùng lượng vào relation score đã lớn. Đây là tính chất của phép biến đổi bão hòa; nó không tự cho biết mức bão hòa này phù hợp với người mua.

### 2.4. Scale điều khiển cách đổi điểm

$$
g_r(k_r)=\frac{k_r}{k_r+k_r}=0.5.
$$

Với `s>0`, tăng `k_r` làm điểm giảm vì:

$$
\frac{\partial g_r}{\partial k_r}=-\frac{s}{(s+k_r)^2}<0.
$$

Vì vậy `k` là mốc chuẩn hóa có diễn giải rõ; giá trị `1/3/6` vẫn cần được chọn bằng validation hoặc hiệu chỉnh nghiệp vụ, không thể suy ra là tối ưu từ phép chứng minh.

### 2.5. Negative correction không thành điểm gợi ý dương

Nếu hoàn trả làm relation score về 0 hoặc âm, `max(0,s)=0`, do đó contribution chuẩn hóa bằng 0. Các candidate query cũng loại relation có effective score không dương. Điều này chỉ bảo đảm phần âm không tạo điểm gợi ý dương; negative relation không được đưa thành một feature phạt riêng trong `coBehavior`.

### 2.6. Các kết luận phải giới hạn đúng phạm vi

- Điểm `0,5` **không** có nghĩa 50% người dùng mua sản phẩm.
- Điểm cao chỉ nói rằng một relation score dương sau chuẩn hóa cao hơn; không chứng minh quan hệ có ý nghĩa thống kê hay nhân quả.
- Vì dùng maximum, nhiều anchor cùng xác nhận một sản phẩm không mạnh hơn một anchor nếu contribution mạnh nhất giữ nguyên. Sự đồng thuận nhiều anchor bị bỏ qua ở feature này.
- `coBehavior` không bảo đảm ứng viên được tạo ra. Candidate retrieval trước đó lấy tối đa 10 anchor và tối đa 100 kết quả; candidate pool thiếu sản phẩm thì ranker không thể xếp sản phẩm đó.
- LambdaRank còn kết hợp feature khác. Quan hệ đơn điệu của `g(s)` không bảo đảm vị trí cuối của item tăng khi đổi dữ liệu ứng viên hoặc các feature khác.

## 3. Cơ sở nghiên cứu và phân biệt với công thức dự án

| Nghiên cứu                                                          | Phương pháp của nguồn                                                                                                                | Phần có thể hỗ trợ trong dự án                                                                               | Phần không được đồng nhất                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sarwar et al. (2001), item-based collaborative filtering            | Tạo ma trận người dùng–sản phẩm, tính độ tương tự giữa vector item (có cosine), sau đó dùng các item gần nhất để tính dự đoán/gợi ý. | Là cơ sở tham chiếu cho hướng dùng quan hệ item-item để sinh hoặc chấm sản phẩm liên quan.                   | `s/(s+k)` không phải cosine. Code dự án không dựng ma trận user-item, không chia tích vô hướng cho chuẩn hai vector, và không dùng dự đoán weighted-average đầy đủ của bài. [Bài WWW 2001, DOI](https://doi.org/10.1145/371920.372071), [bản bài báo](https://compjournalism.com/files/-dmsl/sarwar_2001.pdf).   |
| Agrawal, Imieliński & Swami (1993), association rules               | Khai thác basket transaction để tìm luật `X ⇒ Y` theo support và confidence.                                                         | Hỗ trợ việc nghiên cứu quan hệ sản phẩm từ basket/đơn mua và xác định các thống kê có thể tính từ giao dịch. | Dự án không khai thác luật frequent-itemset, không đặt ngưỡng support/confidence và không tính `xác suất có điều kiện của sản phẩm đích khi anchor xuất hiện`. [SIGMOD 1993, DOI](https://doi.org/10.1145/170035.170072), [bản bài báo](https://www.cs.cmu.edu/~natassa/courses/15-721/papers/p207-agrawal.pdf). |
| Brin, Motwani & Silverstein (1997), correlation rules               | Mở rộng association rules sang việc kiểm tra tương quan giữa itemsets; thảo luận cách xét cả sự hiện diện và vắng mặt item.          | Nhắc rằng chỉ đếm cặp xuất hiện chưa đủ để kết luận cặp có liên hệ vượt quá mức nền.                         | Dự án hiện chưa kiểm định tương quan hay độ bất định, và không tính lift/chi-square. [SIGMOD 1997, DOI](https://doi.org/10.1145/253260.253327), [bản bài báo](https://www2.cs.sfu.ca/CourseCentral/459/han/papers/brin97.pdf).                                                                                   |
| Ding & Li (2005), time-weight collaborative filtering               | Đưa trọng số thời gian vào CF để ảnh hưởng của dữ liệu cũ giảm.                                                                      | Cơ sở để thử nghiệm thời gian như yếu tố trong quan hệ hành vi.                                              | Bài báo không chứng minh half-life 30 ngày của dự án; code hiện giảm aggregate theo `last_signal_at`, không giữ và decay từng event riêng. [CIKM 2005, DOI](https://doi.org/10.1145/1099554.1099689), [bản bài báo](https://cseweb.ucsd.edu/classes/fa17/cse291-b/reading/p485-ding.pdf).                        |
| Linden, Smith & York (2003), item-to-item recommendation tại Amazon | Mô tả ứng dụng recommendation dựa trên liên hệ item-item ở quy mô thương mại điện tử.                                                | Tham chiếu thực tiễn cho kiến trúc “sản phẩm mốc → sản phẩm liên quan”.                                      | Đây là báo cáo ứng dụng, không phải chứng minh toán học cho các trọng số, scale, cửa sổ thời gian của dự án hoặc bảo đảm sẽ có cùng hiệu quả. [IEEE Internet Computing, DOI](https://doi.org/10.1109/MIC.2003.1167344), [bản bài báo](https://www.cs.umd.edu/~samir/498/Amazon-Recommendations.pdf).             |

### Kết luận về bằng chứng nghiên cứu

Các bài báo cho cơ sở để xây dựng **baseline có tên gọi, định nghĩa và cách tính có thể kiểm tra**: item-item cosine; confidence/lift trên basket; và time-weighted CF. Chúng không “chứng minh” hàm chuẩn hóa `s/(s+k)`, lấy maximum qua anchor, các weight `1/2/0,05/3/6`, cửa sổ `30 phút/7 ngày`, scale `1/3/6` hay half-life `30 ngày` là tối ưu cho dự án. Chứng minh toán học ở mục 2 chỉ xác nhận tính chất đại số của đúng phép biến đổi này.

## 4. Ví dụ tính tay

Giả sử một candidate có ba đóng góp đã decay: `CO_VIEW = 2` với `k=1`, `CO_CART = 3` với `k=3`, và `CO_PURCHASE = 1,5` với `k=6`:

| Quan hệ       | `s` | `k` |              `g(s)` |
| ------------- | --: | --: | ------------------: |
| `CO_VIEW`     |   2 |   1 |   `2/(2+1) = 0,667` |
| `CO_CART`     |   3 |   3 |     `3/(3+3) = 0,5` |
| `CO_PURCHASE` | 1,5 |   6 | `1,5/(1,5+6) = 0,2` |

Vì code lấy điểm contribution lớn nhất, `coBehavior = 0,667`. Đây là golden case số học của phép biến đổi, không phải phép đo chất lượng dự đoán.

## 5. Tham số và giả định riêng của dự án

| Giá trị                                                            | Nguồn hiện tại                               | Điều đã biết / điều chưa biết                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| View `1`, click `2`, impression `0,05`                             | Default config của relation projection       | Thể hiện giả định tín hiệu chủ động mạnh hơn impression; tỷ lệ giữa các mức chưa được kiểm chứng trên outcome thật. |
| Cart `3`, purchase `6`, return `−6`                                | Default config của relation projection       | Phân biệt hành vi mạnh/yếu và hiệu chỉnh hoàn trả; không phải xác suất.                                             |
| Cửa sổ `CO_VIEW` 30 phút; `CO_CART` 7 ngày                         | Hằng số trong projection                     | Cửa sổ theo nghiệp vụ; cần kiểm tra bằng validation dữ liệu theo thời gian.                                         |
| Half-life aggregate 30 ngày                                        | `RELATION_SCORE_HALF_LIFE_DAYS`, fallback 30 | Tham số query; test đổi/biên và decay từng contribution chưa đủ.                                                    |
| Scale `CO_VIEW=1`, `CO_CART=3`, `CO_PURCHASE=6`                    | `RECOMMENDATION_RELATION_SCALE_*`            | Mốc để `s=k` cho `0,5`; không có nguồn bên ngoài chứng minh tối ưu.                                                 |
| Tối đa 10 anchor, 100 candidate; lưu tối đa 100 target/anchor/type | Candidate/relation repository                | Giới hạn vận hành làm mất quan hệ ngoài top; cần đo recall candidate nếu đánh giá end-to-end.                       |

## 6. Lời giải thích ngắn trước giảng viên

> “Em dùng lịch sử các sản phẩm xuất hiện cùng trong một phiên, giỏ hàng hoặc đơn hàng để tạo quan hệ item-item. Với mỗi quan hệ, em đổi điểm dương `s` thành `s/(s+k)`, rồi lấy relation mạnh nhất làm feature `coBehavior`. Em chứng minh được feature không âm, nhỏ hơn 1, tăng theo điểm quan hệ và bão hòa dần. Nghiên cứu item-based CF và association rules là cơ sở để chọn các baseline so sánh, chứ không chứng minh hàm của em hay các tham số mặc định là tối ưu. Để nói tiêu chí này giúp xếp hạng, em cần đánh giá riêng trên lịch sử hiển thị thật.”

## Tài liệu tham khảo

1. Badrul Sarwar, George Karypis, Joseph Konstan và John Riedl. 2001. “Item-Based Collaborative Filtering Recommendation Algorithms.” _Proceedings of the 10th International Conference on World Wide Web (WWW ’01)_, 285–295. [DOI](https://doi.org/10.1145/371920.372071), [bản bài báo](https://compjournalism.com/files/-dmsl/sarwar_2001.pdf).
2. Rakesh Agrawal, Tomasz Imieliński và Arun Swami. 1993. “Mining Association Rules between Sets of Items in Large Databases.” _Proceedings of the 1993 ACM SIGMOD International Conference on Management of Data_, 207–216. [DOI](https://doi.org/10.1145/170035.170072), [bản bài báo](https://www.cs.cmu.edu/~natassa/courses/15-721/papers/p207-agrawal.pdf).
3. Sergey Brin, Rajeev Motwani và Craig Silverstein. 1997. “Beyond Market Baskets: Generalizing Association Rules to Correlations.” _Proceedings of the 1997 ACM SIGMOD International Conference on Management of Data_, 265–276. [DOI](https://doi.org/10.1145/253260.253327), [bản bài báo](https://www2.cs.sfu.ca/CourseCentral/459/han/papers/brin97.pdf).
4. Yi Ding và Xue Li. 2005. “Time Weight Collaborative Filtering.” _Proceedings of the 14th ACM International Conference on Information and Knowledge Management (CIKM ’05)_, 485–492. [DOI](https://doi.org/10.1145/1099554.1099689), [bản bài báo](https://cseweb.ucsd.edu/classes/fa17/cse291-b/reading/p485-ding.pdf).
5. Greg Linden, Brent Smith và Jeremy York. 2003. “Amazon.com Recommendations: Item-to-Item Collaborative Filtering.” _IEEE Internet Computing_, 7(1), 76–80. [DOI](https://doi.org/10.1109/MIC.2003.1167344), [bản bài báo](https://www.cs.umd.edu/~samir/498/Amazon-Recommendations.pdf).

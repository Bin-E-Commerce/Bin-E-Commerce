# Tiêu chí 8 — Khám phá sản phẩm mới (`exploration`)

> **Mục tiêu:** phân biệt công thức đang chạy với thuật toán exploration–exploitation được nghiên cứu. Tài liệu không gọi feature hiện tại là bandit, cũng không tuyên bố ngưỡng `0,4` đã tối ưu.

## 1. Công thức hiện tại trong dự án

Với candidate `i`, ký hiệu:

- `pᵢ ∈ [0,1]`: feature `profileAffinity` của candidate;
- `Sᵢ`: tập nguồn đã đóng góp candidate;
- `Eᵢ = 1` nếu `Sᵢ` chứa `EXPLORE` hoặc `NEWEST`, ngược lại `Eᵢ = 0`.

Feature mà `RankingFeatureService` tạo là:

$$
exploration_i = \mathbf{1}[p_i \le 0.4] \cdot E_i
$$

Tương đương:

$$
exploration_i =
\begin{cases}
1, & p_i \le 0.4 \text{ và } (EXPLORE \in S_i \text{ hoặc } NEWEST \in S_i),\\
0, & \text{các trường hợp còn lại.}
\end{cases}
$$

Đây là một **feature nhị phân** gửi vào LightGBM LambdaRank. Code không cộng `1` trực tiếp vào điểm cuối và cũng không bảo đảm item sẽ được đẩy lên đầu. Model nhận feature cùng các feature khác rồi tự dự đoán relevance score.

## 2. Tính chất toán học chứng minh được

### 2.1. Miền giá trị

Hai biến chỉ thị `1[pᵢ ≤ 0,4]` và `Eᵢ` đều thuộc `{0,1}`. Tích của chúng do đó cũng thuộc `{0,1}`:

$$
exploration_i \in \{0,1\} \subset [0,1].
$$

Không có phép chuẩn hóa xác suất hay ước lượng reward trong công thức này.

### 2.2. Hành vi theo độ phù hợp hồ sơ

Giữ nguyên nguồn candidate đủ điều kiện:

$$
f(p)=\mathbf{1}[p\leq0.4]
$$

Hàm này không tăng theo `p`: khi `p` tăng từ `0,4` lên lớn hơn `0,4`, feature đổi từ `1` sang `0`. Với nguồn không đủ điều kiện (`Eᵢ=0`), feature luôn bằng `0` dù profile affinity là bao nhiêu.

Hàm có bước nhảy tại `0,4`. Giá trị đúng bằng `0,4` vẫn được bật; chỉ khi `p>0,4` mới tắt. Vì vậy ngưỡng này là một quyết định nghiệp vụ có thể kiểm thử, nhưng không tự suy ra từ định lý hoặc nguồn nghiên cứu.

### 2.3. Ví dụ tính tay

| `profileAffinity` | Nguồn candidate         | `exploration` | Lý do                                      |
| ----------------: | ----------------------- | ------------: | ------------------------------------------ |
|            `0,40` | `EXPLORE`               |           `1` | Đúng ngưỡng và đúng nguồn.                 |
|            `0,41` | `NEWEST`                |           `0` | Hồ sơ vượt ngưỡng.                         |
|            `0,10` | `TRENDING`              |           `0` | Nguồn không phải `EXPLORE`/`NEWEST`.       |
|            `0,00` | `EXPLORE` và `TRENDING` |           `1` | Chỉ cần có ít nhất một nguồn đủ điều kiện. |

Các giá trị trên là suy luận trực tiếp từ công thức, không phải kết quả đo hành vi khách hàng.

## 3. So với exploration–exploitation trong nghiên cứu

Trong bài toán multi-armed bandit, một hệ thống chọn hành động, nhận reward sau hành động, cập nhật ước lượng và cân bằng reward hiện biết với thông tin chưa biết. Với contextual bandit, chính sách còn dùng context user/item để chọn hành động và cập nhật theo phản hồi. Ví dụ, UCB tăng ưu tiên cho lựa chọn có bất định cao; ε-greedy chủ động dành một phần lượt chọn cho exploration. Các thuật toán này cần lịch sử chọn item, reward, và — tùy phương pháp — số lần thử hoặc độ bất định.

**Feature hiện tại không có các thành phần đó:**

- không tung ngẫu nhiên hoặc tính xác suất chọn item;
- không ước lượng độ bất định/reward của item;
- không cập nhật chính sách từ feedback sau impression;
- không tối thiểu hóa regret tích lũy;
- không bảo đảm item có `exploration=1` thực sự được hiển thị nếu LambdaRank đặt nó thấp.

Code hiện chỉ đánh dấu candidate đến từ `EXPLORE`/`NEWEST` khi `profileAffinity` còn thấp. Tên `exploration` mô tả mục tiêu của feature, không chứng minh hệ thống đang chạy thuật toán bandit.

## 4. Nguồn nghiên cứu và phạm vi hỗ trợ

1. **Li, Chu, Langford & Schapire (WWW 2010), “A Contextual-Bandit Approach to Personalized News Article Recommendation.”** Bài toán được mô hình hóa thành chính sách tuần tự: dùng context user/article, chọn nội dung, nhận click feedback rồi thích nghi. Bài mô tả dành một phần traffic cho random exploration và các phương pháp như UCB; thí nghiệm offline dùng traffic ngẫu nhiên của Yahoo! Front Page. Đây là cơ sở để nhận diện các thành phần cần có của một phương pháp exploration thực sự, không phải bằng chứng cho cờ threshold của dự án. [Bài báo gốc và DOI](https://doi.org/10.1145/1772690.1772758), [toàn văn tác giả](https://www.schapire.net/papers/www10.pdf).
2. **Auer, Cesa-Bianchi & Fischer (Machine Learning 2002), “Finite-Time Analysis of the Multiarmed Bandit Problem.”** Phân tích regret cho chính sách bandit, bao gồm UCB1, dưới giả định reward bị chặn. Nền tảng toán học đó áp dụng cho chính sách chọn hành động và reward tuần tự; công thức `1[p≤0,4] × Eᵢ` không phải UCB1 và không thỏa điều kiện để kế thừa bảo đảm regret của bài báo. [Bài báo và DOI](https://doi.org/10.1023/A:1013689704352), [bản PDF](https://people.eecs.berkeley.edu/~russell/classes/cs294/s11/readings/Auer%2Bal%3A2002.pdf).
3. **Schnabel, Bennett, Dumais & Joachims (WSDM 2018), “Short-Term Satisfaction and Long-Term Coverage: Understanding How Users Tolerate Algorithmic Exploration.”** Nghiên cứu người dùng với hơn 600 người, thay đổi số item exploration được trộn vào danh sách và đo satisfaction cùng feedback. Kết quả cho thấy mức exploration có chi phí ngắn hạn và lượng feedback cũng thay đổi theo tỷ lệ mix-in. Điều này hỗ trợ đo cả trải nghiệm/reward và feedback, không chỉ độ chính xác top-K; không xác nhận ngưỡng `0,4` hoặc nguồn catalog của dự án. [Bài báo và DOI](https://doi.org/10.1145/3159652.3159700), [toàn văn](https://www.cs.cornell.edu/~tj/publications/schnabel_etal_18a.pdf).
4. **Parapar & Radlinski (WSDM 2021), “Diverse User Preference Elicitation with Multi-Armed Bandits.”** Nghiên cứu liên hệ việc thu thập preference với popularity bias và dùng bandit để đa dạng hóa preference được elicitation. Nguồn này gợi ý nên theo dõi coverage/bias khi khám phá, nhưng mô hình và chính sách của họ khác feature nhị phân hiện tại. [Trang bài báo của Google Research](https://research.google/pubs/diverse-user-preference-elicitation-with-multi-armed-bandits/).

### Giới hạn của bằng chứng

Các nghiên cứu trên cung cấp **họ phương pháp và protocol tham chiếu**. Chúng không chứng minh rằng:

- `0,4` là ngưỡng phù hợp với người mua trong dự án;
- `EXPLORE` hoặc `NEWEST` là những candidate tốt để khám phá;
- bật feature làm tăng thứ hạng, click, mua hàng, độ bao phủ hay sự hài lòng;
- một feature nhị phân có regret bound như UCB hoặc contextual bandit.

Ngưỡng cần được chọn trên validation, rồi kiểm tra một lần trên test được giữ riêng. Chỉ kết quả từ dữ liệu/phương pháp phù hợp mới cho phép kết luận hiệu quả; paper không thể thay cho phép đo dự án.

## 5. Hướng cải tiến nếu yêu cầu là exploration thật

Nếu phạm vi đề tài chỉ cần đánh dấu candidate cold-start để LambdaRank học từ phản hồi, nên mô tả tiêu chí là **“cờ candidate mới/khám phá khi hồ sơ yếu”**. Khi đó giữ công thức như feature được kiểm định, nhưng không gọi nó là bandit policy.

Nếu cần hệ thống thật sự khám phá, phải thêm chính sách hành động riêng thay vì chỉ đổi một hằng số trong feature. Hai baseline khả thi:

- **ε-greedy:** với xác suất `ε` chọn một candidate ngẫu nhiên từ tập eligible; nếu không, chọn item có reward estimate cao nhất. Cần ghi xác suất chọn để đánh giá offline và tránh cho random branch chọn item không eligible.
- **Contextual LinUCB:** với context vector `xₜ,ᵢ` cho request `t` và item `i`, có thể chấm:

    $$
    UCB_{t,i}=\hat\theta_t^\top x_{t,i}+\alpha\sqrt{x_{t,i}^\top A_t^{-1}x_{t,i}},
    \quad \hat\theta_t=A_t^{-1}b_t.
    $$

    Thành phần thứ nhất ước lượng reward; thành phần căn bậc hai là bonus do bất định. Cần định nghĩa state `Aₜ`, `bₜ`, reward sau impression, reset/versioning, cách chọn item và cập nhật. Cần kiểm tra các giả định contextual linear-bandit, an toàn catalog/tồn kho, độ trễ và traffic trước khi dùng. Đây là **phương án nghiên cứu để đánh giá**, không phải công thức hiện đang triển khai hoặc bảo đảm phù hợp dữ liệu này.

Không thể kết luận phương án nào tối ưu trước khi chọn mục tiêu (click, purchase, long-term coverage hoặc kết hợp), có impression/reward log đúng và đánh giá trên cùng workload.

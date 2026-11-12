# Tiêu chí 3 — Sản phẩm tương tự về nội dung (`semanticSimilarity`)

> **Mục tiêu:** tìm sản phẩm có nội dung gần với sản phẩm người dùng đang xem hoặc đã quan tâm, rồi đưa độ tương đồng vào feature vector của LambdaRank. Đây là phép truy hồi nội dung và một feature đầu vào; điểm này không phải xác suất mua, không phải điểm cuối, và không phải một mô hình embedding do dự án tự huấn luyện.

## 1. Phạm vi và đường đi dữ liệu

Hệ thống chuẩn hóa nội dung sản phẩm thành văn bản gồm tiêu đề, thương hiệu, đường dẫn danh mục, mô tả ngắn, mô tả và tối đa 50 thuộc tính. AI service dùng embedding model được cấu hình — mặc định `text-embedding-3-small` — để biến văn bản thành vector. Recommendation service lưu vector cùng `modelVersion` và `contentHash` trong Qdrant.

Khi tạo ứng viên, hệ thống lập tập anchor từ tối đa ba nguồn:

- Sản phẩm request hiện tại: trọng số `1`.
- Tối đa 5 sản phẩm gần đây: trọng số lấy từ tín hiệu phiên; mặc định của rule là view `1`, click `2`, thêm giỏ `4`. Tín hiệu không dương bị bỏ qua.
- Tối đa 5 `profileProductIds`: trọng số `0,5` mỗi sản phẩm.

ID trùng được gộp bằng cách cộng trọng số. Chỉ vector có nội dung còn mới theo `contentHash`, đúng `modelVersion`, cùng số chiều và gồm số hữu hạn mới được dùng. Nếu không có vector anchor hợp lệ, semantic source trả về danh sách rỗng.

Ở cấu hình mặc định `QDRANT_DISTANCE=Cosine`, Qdrant tìm tối đa 60 sản phẩm đang hoạt động, còn hàng, có embedding `READY` và cùng phiên bản model; các ID bị loại trừ không được trả về. Score nguồn semantic sau đó được chuyển thành feature `semanticSimilarity` bằng phép chặn trong `[0,1]`. LambdaRank nhận feature này cùng các feature khác và tự tạo điểm xếp hạng cuối.

## 2. Công thức đang có trong dự án

Gọi `A` là các anchor có vector hợp lệ. Với anchor `j`, `v_j` là embedding nội dung, `α_j > 0` là trọng số sau khi gộp ID trùng. Đặt `W = Σⱼ αⱼ`.

Vector truy vấn là centroid có trọng số:

$$
q = \frac{\sum_{j\in A} \alpha_j v_j}{\sum_{j\in A}\alpha_j},\qquad W>0.
$$

Với Qdrant metric `Cosine`, score nguồn của sản phẩm `i` là:

$$
s_i = \frac{q\cdot v_i}{\|q\|_2\,\|v_i\|_2},\qquad \|q\|_2>0,\ \|v_i\|_2>0.
$$

Feature mà ranker thực sự nhận là:

$$
semanticSimilarity(i)=
\begin{cases}
\max\limits_{c\in C_i}\min(1,\max(0,s_c)), & C_i\ne\varnothing,\\
0, & C_i=\varnothing,
\end{cases}
$$

trong đó `Cᵢ` là các contribution của nguồn `SEMANTIC_SIMILARITY` cho ứng viên đó. Công thức `max` chọn contribution semantic lớn nhất. Nguồn khác như `TRENDING` không được tính vào feature này.

**Phân biệt ba phép:** centroid tạo truy vấn; Qdrant cosine chọn ứng viên và trả score; `clamp`/`max` biến contribution thành feature cho ranker. LambdaRank mới quyết định thứ tự cuối, dựa trên toàn bộ vector feature.

## 3. Tính chất toán học có thể chứng minh

### 3.1. Centroid là tổ hợp lồi

Đặt `βⱼ = αⱼ/W`. Vì `αⱼ > 0` và `W = Σ αⱼ > 0`, ta có `βⱼ > 0` và `Σ βⱼ = 1`. Do đó:

$$
q=\sum_j \beta_j v_j.
$$

Centroid nằm trong bao lồi của các vector anchor. Nếu từng vector có chuẩn không quá 1, bất đẳng thức tam giác cho `||q||₂ ≤ Σ βⱼ||vⱼ||₂ ≤ 1`. Trọng số nhân đồng loạt với cùng hằng số dương không đổi centroid; chỉ tỷ lệ giữa các trọng số có ảnh hưởng.

Nếu tất cả anchor có cùng vector `v`, thì `q = v`. Đây là kiểm tra tay đơn giản cho phép tính centroid.

### 3.2. Cosine bị chặn và có nghĩa theo góc

Theo bất đẳng thức Cauchy–Schwarz, với hai vector khác vector không:

$$
|q\cdot v_i|\leq \|q\|_2\|v_i\|_2
\quad\Longrightarrow\quad -1\leq s_i\leq 1.
$$

Score `1` biểu thị cùng hướng, `0` vuông góc và `-1` ngược hướng. Qdrant ghi nhận cosine score theo miền `[-1,1]`; do đó phép chặn của dự án biến score âm thành `0` và score trên `1` thành `1`. Chặn này bảo đảm miền feature `[0,1]`, nhưng làm mất phân biệt giữa mọi score âm.

### 3.3. Feature cuối hữu hạn trong `[0,1]`

`clamp(x)=min(1,max(0,x))` luôn nằm trong `[0,1]` với `x` hữu hạn. Code đổi score không hữu hạn thành `0`. Giá trị lớn nhất của một tập số trong `[0,1]` vẫn thuộc `[0,1]`; nếu tập contribution rỗng, fallback là `0`. Vì vậy `semanticSimilarity` hữu hạn và bị chặn trong `[0,1]` theo triển khai hiện tại.

`clamp` không giảm khi score đầu vào tăng. Tuy vậy, phép lấy `max` và miền `[0,1]` không có nghĩa rằng feature tăng sẽ luôn làm sản phẩm lên trên trong thứ tự LambdaRank cuối: model còn thấy các feature khác và có thể học trọng số/quan hệ khác.

### 3.4. Những điều không suy ra được từ chứng minh

- Thêm một anchor **không bảo đảm** score của sản phẩm đang xét tăng. Ví dụ, truy vấn `q=(1,0)` khớp ứng viên `v=(1,0)` với cosine `1`; thêm anchor vuông góc với trọng số bằng nhau tạo `q=(0,5,0,5)`, làm cosine ứng viên đó còn `1/√2 ≈ 0,707`. Hệ thống đang tạo một truy vấn tổng hợp; nó không bảo đảm đồng thời gần với từng anchor.
- Nếu hai anchor đối hướng có trọng số triệt tiêu nhau, centroid có thể là vector không. Cosine khi đó không xác định. Code hiện tại loại centroid đúng bằng vector không trước khi gọi Qdrant; code chưa có ngưỡng epsilon cho centroid gần không, nên các trường hợp gần triệt tiêu vẫn cần kiểm thử độ ổn định số.
- Cosine đo gần nhau trong không gian mà embedding model tạo ra. Đại số không chứng minh không gian đó phản ánh đúng “sản phẩm thay thế” hay “sản phẩm liên quan” theo nghiệp vụ, cũng không chứng minh điểm cao làm tăng click/mua.
- Trọng số anchor `1`, event `1/2/4`, profile `0,5`, số lượng 5 và giới hạn top 60 là chính sách cấu hình/triển khai của dự án. Các tính chất cosine không chứng minh những con số này tối ưu.

## 4. Nghiên cứu hỗ trợ đến đâu?

| Nguồn gốc                                                                                                                                                                                                                           | Điều nghiên cứu hỗ trợ                                                                                                                                                                                                                                                       | Điều không thể gán cho công thức dự án                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reimers & Gurevych, [**Sentence-BERT**](https://arxiv.org/abs/1908.10084) (EMNLP 2019)                                                                                                                                              | Siamese embeddings cho phép so độ tương đồng ngữ nghĩa bằng cosine và truy hồi hiệu quả. Đây là cơ sở cho họ phương pháp embedding + cosine.                                                                                                                                 | Bài dùng SBERT; dự án đang cấu hình OpenAI `text-embedding-3-small`. Bài không đề xuất centroid anchor của dự án, không xác nhận trọng số, không chứng minh chất lượng sản phẩm của catalog này. |
| OpenAI, [**Vector embeddings guide**](https://developers.openai.com/api/docs/guides/embeddings) (tài liệu model)                                                                                                                    | Tài liệu mô tả embedding là biểu diễn mức liên quan của văn bản, liệt kê recommendations là ứng dụng, minh họa truy hồi cosine, và ghi embedding v3 được chuẩn hóa độ dài.                                                                                                   | Đây là tài liệu kỹ thuật của nhà cung cấp, không phải nghiên cứu độc lập đánh giá ranking của dự án.                                                                                             |
| Qdrant, [**Distance metrics**](https://qdrant.tech/course/essentials/day-1/distance-metrics/) và [**Diagnosing discrepancies**](https://qdrant.tech/documentation/migration-guidance/diagnosing-discrepancies/) (tài liệu kỹ thuật) | Định nghĩa cosine, mô tả score `1/0/-1`, và xác nhận Qdrant trả cosine trong `[-1,1]`.                                                                                                                                                                                       | Tài liệu xác nhận hành vi metric, không chứng minh semantic relevance hoặc hiệu quả mua hàng.                                                                                                    |
| Guo và cộng sự, [**Deep Learning-based Online Alternative Product Recommendations at Scale**](https://aclanthology.org/2020.ecnlp-1.3/) (ECNLP 2020)                                                                                | Nghiên cứu thương mại điện tử dùng tiêu đề/mô tả sản phẩm, embedding Siamese và hành vi co-compare làm nhãn; báo cáo đánh giá offline và A/B test. Đây là bằng chứng cho hướng dùng nội dung sản phẩm trong tìm sản phẩm thay thế và cho nhu cầu đánh giá bằng nhãn hành vi. | Họ huấn luyện embedding theo co-compare labels; dự án dùng embedding provider có sẵn và centroid cosine. Kết quả A/B của họ không phải kết quả của hệ thống này.                                 |
| Bendada và cộng sự, [**On the Consistency of Average Embeddings for Item Recommendation**](https://arxiv.org/abs/2308.12767) (2023)                                                                                                 | Phân tích lý thuyết và thử nghiệm cảnh báo rằng trung bình embedding có thể đại diện kém cho tập item trên embedding thực tế; mức phù hợp phụ thuộc giả định/phân phối embedding. Đây là lý do cần đo centroid bằng chính dữ liệu dự án.                                     | Thí nghiệm trên embedding cộng tác của dữ liệu nhạc không trực tiếp phủ định hoặc xác nhận embedding văn bản OpenAI của catalog này. Không thể lấy các tỷ lệ của bài làm kết quả dự án.          |

**Kết luận về cơ sở:** cosine trên embedding là phép so sánh có nguồn nghiên cứu/kỹ thuật rõ; centroid có trọng số là lựa chọn kỹ thuật hợp lý để gộp nhiều anchor nhưng không phải định lý bảo đảm chất lượng recommendation. Các nghiên cứu nói trên hỗ trợ phương pháp chung, không chứng minh trọng số cụ thể hay tính tối ưu của công thức đang chạy.

## 5. Tài liệu tham khảo

1. Nils Reimers và Iryna Gurevych. 2019. “Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks.” EMNLP-IJCNLP 2019. [Bài gốc trên arXiv](https://arxiv.org/abs/1908.10084).
2. OpenAI. “Vector embeddings.” [Tài liệu chính thức](https://developers.openai.com/api/docs/guides/embeddings).
3. Qdrant. “Distance Metrics.” [Tài liệu chính thức về cosine và score](https://qdrant.tech/course/essentials/day-1/distance-metrics/).
4. Mingming Guo và cộng sự. 2020. “Deep Learning-based Online Alternative Product Recommendations at Scale.” Proceedings of the 3rd Workshop on e-Commerce and NLP, 19–23. [ACL Anthology](https://aclanthology.org/2020.ecnlp-1.3/). DOI: [10.18653/v1/2020.ecnlp-1.3](https://doi.org/10.18653/v1/2020.ecnlp-1.3).
5. Walid Bendada và cộng sự. 2023. “On the Consistency of Average Embeddings for Item Recommendation.” [Bài gốc trên arXiv](https://arxiv.org/abs/2308.12767).

## 6. Cách trình bày với giảng viên

> “Tiêu chí này chuyển nội dung sản phẩm thành embedding. Với nhiều sản phẩm làm anchor, code gộp vector bằng trung bình có trọng số, rồi dùng cosine trong Qdrant để truy hồi sản phẩm gần nhất. Em chứng minh centroid là tổ hợp lồi khi trọng số dương, cosine nằm trong `[-1,1]`, và feature sau chặn nằm trong `[0,1]`. Nghiên cứu trước hỗ trợ embedding và cosine cho so sánh ngữ nghĩa, nhưng không chứng minh các trọng số hay centroid của dự án là tối ưu. Bài nghiên cứu về trung bình embedding còn cho thấy cần kiểm tra tính phù hợp trên dữ liệu thực tế. Vì vậy em tách chứng minh đại số, kiểm tra code và phép đo relevance thành ba bằng chứng riêng.”

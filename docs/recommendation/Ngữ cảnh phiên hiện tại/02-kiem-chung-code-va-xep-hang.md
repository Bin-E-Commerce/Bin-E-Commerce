# Tiêu chí 2 — Kiểm chứng code và xếp hạng (`sessionContext`)

> **Phạm vi:** xác nhận code tạo đúng feature theo [công thức và chứng minh toán học](01-co-so-toan-hoc-va-nghien-cuu.md), rồi xác định bằng chứng nào còn thiếu để nói feature giúp model AI xếp hạng tốt.

## 1. Đường đi của dữ liệu

| Bước                 | Code                                                                                                                                                                                                            | Điều cần kiểm tra                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Ghi context phiên    | [`SessionContextService`](../../../services/recommendation-service/src/modules/profiles/application/services/session/session-context.service.ts)                                                                | Tương tác chủ động đưa khóa danh mục/thương hiệu lên đầu, loại trùng và giới hạn số khóa; impression thụ động không đổi danh sách. |
| Tạo vector           | [`RankingFeatureService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts)                                                 | `sessionScore` lấy điểm vị trí riêng cho danh mục và thương hiệu, rồi chia 2. Không dùng `anchorProductId` cho feature này.        |
| Gửi model            | [`RecommendationMlRankingService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts)                                    | Feature nằm ở cột `sessionContext` của vector chín cột; request ghi `featureSchemaVersion = ranking-features-v3`.                  |
| Nạp và phục vụ model | [`model_registry.py`](../../../services/ai-service/app/modules/ranking/infrastructure/registry/model_registry.py), [`schemas.py`](../../../services/ai-service/app/modules/ranking/presentation/api/schemas.py) | Registry từ chối artifact không có schema v3; API từ chối request dùng schema cũ dù số cột vẫn bằng 9.                             |
| Sinh dữ liệu thử mới | [`RankingSimulationService`](../../../services/recommendation-service/src/modules/recommendation/application/services/offline/ranking-simulation.service.ts)                                                    | Row và manifest mới mang schema v3. Dataset v1/v2 đã sinh trước đây không tự được nâng cấp.                                        |

**Lưu ý triển khai:** thay đổi `sessionContext` làm đổi ý nghĩa một cột dù số cột giữ nguyên. Artifact và dataset `ranking-features-v2` **không tương thích**. Cần sinh/export lại feature từ log gốc, huấn luyện và đánh giá model v3 trước khi phục vụ. Chỉ đổi nhãn version của dataset cũ là sai vì giá trị cột vẫn được tính theo công thức cũ.

## 2. Golden cases cho công thức

Với `C = [category-1, category-2]`, `B = [brand-2, brand-1]` và ứng viên có `category-1`, `brand-1`:

$$
sessionContext=(1+1/2)/2=0,75.
$$

Các trường hợp kiểm thử ở [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts):

| Đầu vào                                                    | Kỳ vọng | Quy tắc bảo vệ                                    |
| ---------------------------------------------------------- | ------: | ------------------------------------------------- |
| Danh mục mới nhất, thương hiệu cũ hơn một vị trí           |    0,75 | Đúng công thức vị trí và trung bình hai chiều.    |
| Chỉ khớp danh mục mới nhất, danh sách thương hiệu rỗng     |     0,5 | Không tự suy ra khớp thương hiệu.                 |
| Chỉ có cùng `anchorProductId`, không khớp thuộc tính phiên |       0 | Nguồn truy hồi không làm giả bằng chứng ngữ cảnh. |
| Context bằng `null`                                        |       0 | Phiên mới không có bằng chứng.                    |

Các ca này xác nhận **triển khai khớp công thức ở những đầu vào kiểm soát được**. Chúng không kiểm tra tất cả trạng thái Redis, cũng không chứng minh người mua thật thích sản phẩm được điểm cao.

[`session-context.service.spec.ts`](../../../services/recommendation-service/src/modules/profiles/application/services/session/session-context.service.spec.ts) kiểm tra thêm rằng tương tác lặp đưa khóa lên đầu, cửa sổ giới hạn loại khóa cũ nhất và `PRODUCT_IMPRESSED` không đổi hai danh sách. Đây là tiền đề dữ liệu cho chứng minh về vị trí ở tài liệu 01.

### So sánh điểm trên cùng một tình huống

Giả sử danh mục và thương hiệu mỗi loại có `[mới nhất, cũ hơn]`. Baseline nhị phân là trung bình hai cờ match; half-life giả định mục cũ hơn đúng một `H`:

| Ứng viên                                   | Binary match | Vị trí tuyến tính v3 | Half-life theo thời gian |
| ------------------------------------------ | -----------: | -------------------: | -----------------------: |
| Khớp cả hai mục mới nhất                   |            1 |                    1 |                        1 |
| Khớp danh mục mới nhất, thương hiệu cũ hơn |            1 |                 0,75 |                     0,75 |
| Khớp cả hai mục cũ hơn                     |            1 |                  0,5 |                      0,5 |
| Chỉ khớp danh mục mới nhất                 |          0,5 |                  0,5 |                      0,5 |
| Không khớp                                 |            0 |                    0 |                        0 |

Đây là so sánh số học trên **cùng đầu vào**, không phải kết quả NDCG/Recall. Binary match không phân biệt độ mới. Linear và exponential trùng ở ví dụ hai mục khi khoảng cách đúng một half-life; với danh sách dài hơn hoặc khoảng cách thời gian không đều thì có thể khác. Context hiện tại không lưu timestamp theo khóa nên không thể tính baseline half-life từ lịch sử thực.

### Đối chiếu thực nghiệm đã công bố

Ludewig & Jannach so sánh toàn bộ SKNN với V-SKNN trên e-commerce và báo `P@20/R@20`: RSC15 `0,086/0,464` so với `0,092/0,494`; TMALL `0,095/0,312` so với `0,088/0,291`; ROCKET `0,056/0,478` so với `0,055/0,462`; ZALANDO `0,074/0,202` so với `0,076/0,207`. V-SKNN cao hơn ở RSC15 và ZALANDO, SKNN cao hơn ở TMALL và ROCKET. Đây là kết quả của hai thuật toán đầy đủ trong protocol bài báo, **không** phải phép đo feature v3 của dự án. [Bài báo và bảng kết quả](https://arxiv.org/pdf/1803.09587).

Ding & Li (2005) báo cáo cải thiện precision cho time-weighted item-based collaborative filtering so với biến thể không gán trọng số thời gian, đồng thời chọn half-life theo người dùng/cụm sản phẩm. Bài toán gốc dùng rating timestamped và collaborative item similarity; kết quả không thể chuyển thẳng sang sessionContext, nơi hiện chỉ có thứ tự khóa và không có timestamp riêng. [Bài báo Time Weight Collaborative Filtering](https://cseweb.ucsd.edu/classes/fa17/cse291-b/reading/p485-ding.pdf).

### Kết quả kiểm tra code (11/11/2026)

| Kiểm tra                                                   | Kết quả                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Recommendation: feature, simulator và AI adapter           | 26/26 unit test đạt.                                                  |
| Recommendation: thứ tự và impression của session context   | 2/2 unit test đạt.                                                    |
| Recommendation: type-check, lint, build                    | Đạt.                                                                  |
| AI: trainer, registry, baseline evaluator và route ranking | 18/18 test đạt bằng Python hệ thống; request schema v2 bị trả `422`.  |
| AI: Ruff, mypy phần đã đổi                                 | Đạt.                                                                  |
| Web: type-check, lint                                      | Đạt; lint toàn web còn 32 cảnh báo ở các file ngoài phạm vi thay đổi. |

`.venv` hiện thiếu package `redis`, nên pytest trong môi trường đó dừng ở bước import; kết quả test AI trên đây dùng Python 3.12 của máy với dependency đã có. Cần đồng bộ dependency môi trường trước khi lặp lại phép đo trong CI/deploy.

## 3. Đo lại các công thức bằng một lệnh

Từ thư mục gốc repository, chạy:

```bash
npm run recommendation:session-context-evaluate
```

Lệnh build recommendation-service rồi chạy [`evaluate-session-context-formulas.ts`](../../../services/recommendation-service/src/scripts/evaluate-session-context-formulas.ts). Seed cố định `20261111` giúp cùng code cho cùng kết quả. Script so sánh ba cách chấm **trên đúng cùng candidate pool**:

1. **Binary match:** trung bình hai cờ “danh mục từng xuất hiện” và “thương hiệu từng xuất hiện”. Đây là baseline đơn giản theo kiểu có/không; không phải cài đặt đầy đủ thuật toán SKNN.
2. **Production linear position:** gọi `RankingFeatureService.build()` để lấy đúng `sessionContext` đang gửi vào model.
3. **Exponential time decay:** trung bình `2^(-tuổi tín hiệu / H)`. Mỗi khóa có timestamp synthetic; một `H` chung được chọn trong `[0.5, 1, 2, 4, 8, 12, 24, 48]` giờ bằng NDCG@10 trên validation gộp của cả hai kịch bản. Cùng `H` được dùng cho cả hai tập test, để baseline không được biết trước request thuộc cohort nào. Dữ liệu session hiện tại của production chưa giữ timestamp riêng cho từng khóa, nên đây là đối chứng nghiên cứu, chưa phải công thức thay thế có thể bật ngay.

### Cách dựng dữ liệu và nhãn

- Mỗi kịch bản có 1.200 request và cùng catalog 192 sản phẩm, gồm đủ 16 danh mục × 12 thương hiệu. Mỗi request có lịch sử 8–14 event với khoảng thời gian giữa event ngẫu nhiên 15–90 phút.
- Chia theo thứ tự request: 720 development, 240 validation, 240 test. Development chưa dùng để chọn tham số; test chỉ được dùng sau khi đã chọn `H` trên validation.
- Có hai kịch bản trong **một phiên**. `stable-interest` thường xuyên phát sinh event từ cùng ý định hiện tại (xác suất 82%); `switching-interest` làm xác suất đó tăng từ 15% ở event cũ nhất đến 90% ở event mới nhất. Mỗi chiều danh mục/thương hiệu còn có 12% nhiễu. Các request được tạo độc lập, nên phép đo không mô phỏng một người dùng ổn định qua nhiều phiên.
- Nhãn click được sinh từ ý định ẩn, không đọc điểm của các công thức: xác suất click = `0.015 + 0.85 × (số chiều khớp ý định hiện tại / 2)`. Nhãn vẫn có nhiễu ngẫu nhiên để không biến dữ liệu thành đáp án tuyệt đối.
- `NDCG@10` lấy trung bình theo request; request không có click nhận NDCG bằng 0. `Recall@10` lấy trung bình trên request có ít nhất một click. Bộ dữ liệu này dùng kiểm tra evaluator và giả định, không phải log người mua.

### Kết quả test synthetic

| Kịch bản         | Công thức                  | H chọn trên validation | Validation NDCG@10 | Test NDCG@10 | Test Recall@10 |
| ---------------- | -------------------------- | ---------------------: | -----------------: | -----------: | -------------: |
| Sở thích ổn định | Binary match               |                      — |             0,2941 |       0,2934 |         0,1912 |
| Sở thích ổn định | Production linear position |                      — |             0,4154 |       0,4093 |         0,2446 |
| Sở thích ổn định | Exponential time decay     |                  1 giờ |             0,4447 |   **0,4330** |     **0,2628** |
| Đổi sở thích     | Binary match               |                      — |             0,2923 |       0,2853 |         0,1915 |
| Đổi sở thích     | Production linear position |                      — |             0,4350 |       0,4383 |         0,2560 |
| Đổi sở thích     | Exponential time decay     |                  1 giờ |             0,4704 |   **0,4717** |     **0,2826** |

Half-life chung được chọn trên 480 request validation gộp là **1 giờ**. Trong synthetic test này, linear position cao hơn binary match khoảng **39,5% / 53,7% NDCG@10 tương đối** ở hai kịch bản. Exponential cao hơn linear khoảng **5,8% / 7,6% NDCG@10 tương đối**. Đây là kết quả của đúng bộ sinh dữ liệu và giả định đã công khai ở trên; không chứng minh exponential tốt hơn với người mua thật, cũng không chứng minh model AI tổng thể được cải thiện. Không được dùng kết quả này thay cho đánh giá impression log thật.

## 4. Phép đo cần thực hiện trên log thật

1. Thu thập request/impression log gồm `requestId`, `sessionId`, thời điểm hiển thị, candidate đã **thực sự được hiển thị**, vị trí hiển thị, hai danh sách context **ngay trước request**, thời điểm hoặc thứ tự từng khóa trong hai danh sách, snapshot danh mục/thương hiệu sản phẩm và tương tác sau hiển thị trong một cửa sổ thời gian xác định. Nếu log cũ không lưu context/timestamp, replay event gốc theo thời gian; không dùng tương tác tương lai để dựng feature tại thời điểm request.
2. Chia các request **theo thời gian** thành train, validation và test; cùng một request không xuất hiện ở hai tập. Cố định định nghĩa nhãn, ví dụ click hoặc thêm giỏ/mua sau impression; báo từng loại nhãn nếu dữ liệu đủ.
3. Trên **cùng request và cùng tập ứng viên**, so feature-only bằng công thức vị trí v3 với phép khớp nhị phân danh mục/thương hiệu (không dùng anchor). Khi có timestamp từng khóa, thêm đối chứng half-life và chọn `H` chỉ trên validation. Phép so này hỏi liệu thứ tự hoặc tuổi tín hiệu có hữu ích hơn chỉ biết “đã xuất hiện trong phiên” hay không; giữ test nguyên vẹn.
4. Huấn luyện hai LambdaRank cùng cấu hình, cùng dữ liệu và seed: model đầy đủ v3 và model bỏ riêng `sessionContext`. Đo `NDCG@10` chính, `Recall@10` bổ trợ theo từng request, rồi báo trung bình, số request và khoảng tin cậy bootstrap theo request. Đây là phép đo đóng góp của feature vào **model AI**, khác với điểm feature-only.
5. Tách kết quả theo phiên ngắn/dài, có/không có thương hiệu, khách mới/khách quay lại. Nếu log hiển thị do ranker cũ tạo, nêu position/exposure bias; phép đo offline không chứng minh tác động nhân quả lên doanh thu. Muốn kết luận sản phẩm thực tế tốt hơn cần thử nghiệm trực tuyến có kiểm soát.

### Điều kiện để nói “công thức tốt”

- Code khớp công thức ở golden cases và test boundary; phép chứng minh miền giá trị/độ mới ở tài liệu 01 đúng theo giả định lưu context.
- Trên **test thật chưa dùng để chọn công thức**, feature v3 cải thiện metric so với khớp nhị phân; model đầy đủ cải thiện so với model bỏ `sessionContext`, có báo biến thiên và các phân nhóm quan trọng.
- Nếu hai phép đo không cải thiện, không gọi công thức “tốt hơn”. Khi đó phân tích độ dài phiên, dữ liệu thiếu, thiên lệch hiển thị và thử lại biến thể trên validation; không sửa nhãn hoặc chọn lại test để có kết quả đẹp.

## 5. Trạng thái bằng chứng

| Mệnh đề                                                                 | Bằng chứng hiện có                         | Kết luận cho phép                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Điểm thuộc `[0,1]`, mục gần hơn trong cùng danh sách có điểm lớn hơn    | Chứng minh đại số ở tài liệu 01            | Đúng với giả định dữ liệu đầu vào đã nêu.                                          |
| Code áp dụng công thức mới                                              | Unit test và đường đi code ở mục 1–2       | Đúng cho các trường hợp đã kiểm tra; cần test/quan sát khi tích hợp thật.          |
| Vị trí tuyến tính hoặc decay theo thời gian từng có kết quả thực nghiệm | Ludewig & Jannach (2018); Ding & Li (2005) | Có kết quả trên dataset/protocol bài báo; không xác định biến thể thắng cho dự án. |
| Feature v3 giúp LambdaRank xếp hạng tốt trên người mua thật             | Chưa có phép đo impression log thật hợp lệ | **Chưa kết luận được.**                                                            |

## 6. Câu trả lời ngắn trước giảng viên

> “Em tách ba mức chứng minh. Một là bài báo hỗ trợ việc ưu tiên tương tác mới trong phiên, nhưng không chứng minh công thức của em tối ưu. Hai là em tự chứng minh công thức của dự án nằm trong `[0,1]` và có thứ tự theo độ mới, rồi đối chiếu code bằng golden cases. Ba là hiệu quả xếp hạng phải đo trên log impression thật: so với khớp nhị phân trên cùng candidate pool và so LambdaRank đầy đủ với model bỏ feature. Phần thứ ba hiện chưa đủ dữ liệu nên em chưa khẳng định hệ thống xếp hạng tốt hơn.”

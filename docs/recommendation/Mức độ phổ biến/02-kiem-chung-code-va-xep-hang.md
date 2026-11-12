# Tiêu chí 5 — Kiểm chứng code và xếp hạng (`popularity`)

> **Phạm vi:** đối chiếu triển khai với [cơ sở toán học và nghiên cứu](01-co-so-toan-hoc-va-nghien-cuu.md), đo riêng khả năng xếp hạng của feature hiện tại, và nêu điều kiện cần để đánh giá trên dữ liệu người dùng thật.

## 1. Code hiện tại đang làm gì?

| Bước            | Code                                                                                                                                                                                | Vai trò                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đồng bộ catalog | [`catalog-product.repository.ts`](../../../services/recommendation-service/src/modules/catalog/infrastructure/repositories/catalog-product.repository.ts)                           | Lưu `total_sold`; `BEST_SELLING` xếp theo doanh số giảm dần; `TRENDING` tính điểm rolling từ view/click/cart/purchase rồi dùng doanh số làm khóa phụ.                               |
| Tạo candidate   | [`candidate-generation.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/candidates/generation/candidate-generation.service.ts) | Gắn `sourceRank` và `sourceSize`; `TRENDING` được gọi cho request cá nhân hóa/phiên, `BEST_SELLING` được thêm trong nhánh cold-start.                                               |
| Tính feature    | [`ranking-feature.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts)                | Tính `clamp(max(log1p(max(totalSold, 0))/12, sourceRankScore))`; chỉ nhận rank từ `TRENDING`/`BEST_SELLING`; dữ liệu lỗi được bỏ qua hoặc chuẩn hóa theo quy tắc trong tài liệu 01. |
| Kiểm tra đơn vị | [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts)      | Kiểm tra rank `2/5 → 0,75`, fallback sales khi thiếu `sourceSize`, và đầu vào sales không hữu hạn.                                                                                  |

Feature này là đầu vào cho LambdaRank. Đo ở tài liệu này xếp candidate trực tiếp theo feature để trả lời câu hỏi hẹp: **nếu chỉ dùng `popularity`, thứ tự sản phẩm có khớp nhãn của phép đo không?** Phép đo này không huấn luyện hoặc đánh giá LambdaRank.

## 2. Độ phủ kiểm chứng code

### Ca có unit spec

Với `totalSold=10`, thành phần sales bằng `ln(11)/12≈0,1998`:

- `TRENDING`, hạng `2/5`: `max(0,1998, 0,75)=0,75`.
- Rank có `rank=1` nhưng thiếu `sourceSize`: bỏ rank, dùng sales `≈0,1998`.
- `totalSold=NaN`, `+Infinity`, hoặc `-Infinity`: chuẩn hóa riêng sales về 0 và vẫn giữ rank nguồn hợp lệ.

Targeted `ranking-feature.service.spec.ts` đạt **41/41**; toàn bộ recommendation-service đạt **23 suite, 115/115** theo lần chạy được báo cáo trong task này.

### Golden và boundary cases

| Trường hợp                                                 |                  Kỳ vọng theo công thức | Đã có spec?                                                                        |
| ---------------------------------------------------------- | --------------------------------------: | ---------------------------------------------------------------------------------- |
| `totalSold=0`, không có rank                               |                                       0 | Chưa thấy.                                                                         |
| `totalSold=10`, không có rank hợp lệ                       |                      `ln(11)/12≈0,1998` | Có nhánh fallback khi thiếu `sourceSize`.                                          |
| Rank `1/5`                                                 |                                       1 | Chưa thấy.                                                                         |
| Rank `2/5`                                                 |                                    0,75 | Có.                                                                                |
| Rank `5/5`, `totalSold=0`                                  |                                       0 | Chưa thấy.                                                                         |
| Rank `1/1`                                                 |                                       1 | Chưa thấy; cần xác nhận quy tắc danh sách một item.                                |
| Rank thiếu, bằng 0, vượt `sourceSize`, hoặc `sourceSize≤0` |                Bỏ rank, dùng điểm sales | Hiện spec được rà soát có ca thiếu `sourceSize`; các trường hợp còn lại chưa thấy. |
| Source khác `TRENDING`/`BEST_SELLING`                      |                                 Bỏ rank | Chưa thấy.                                                                         |
| Nhiều rank hợp lệ                                          |                 Chọn điểm rank lớn nhất | Chưa thấy.                                                                         |
| `totalSold<0`                                              |                 Thành phần sales dùng 0 | Chưa thấy.                                                                         |
| Sales là `NaN`, `+Infinity`, `-Infinity`                   | Sales thành 0; rank hợp lệ vẫn được giữ | Có `it.each`, targeted spec đạt 41/41.                                             |

### Giới hạn ý nghĩa của `sourceRank`

`sourceRankScore` chuẩn hóa hạng theo kích thước của chính danh sách nguồn; nó không hiệu chuẩn các nguồn hoặc request thành cùng một đại lượng. Chẳng hạn, hạng `10/80` cho khoảng `0,886`, còn hạng `10/20` cho khoảng `0,526`. Lọc sản phẩm/shop có thể đổi cả hạng lẫn `sourceSize`, nên điểm của một sản phẩm có thể thay đổi dù doanh số không đổi. Danh sách một item cho rank `1/1` điểm 1.

Đây là proxy vị trí trong danh sách truy hồi, không phải xác suất mua hay percentile toàn catalog. Khi kiểm chứng trên log, cần lưu timestamp, request, source, `sourceRank`, `sourceSize`, và snapshot đầu vào để tái dựng feature đúng thời điểm.

## 3. Baseline nghiên cứu và phạm vi so sánh

Ji et al. mô tả **MostPop** theo số tương tác trong train, **RecentPop** theo tương tác trong cửa sổ gần nhất, và **DecayPop** theo tổng tương tác có suy giảm theo thời gian. Trên MovieLens20M, bài báo báo cáo RecentPop/DecayPop tốt hơn MostPop theo protocol của họ. Đây là cơ sở chọn các baseline và giữ snapshot theo thời gian; nó không chứng minh công thức project tối ưu. Xem [bài báo, định nghĩa và thí nghiệm](https://arxiv.org/html/2005.13829v2) và phần đối chiếu ở [tài liệu 01](01-co-so-toan-hoc-va-nghien-cuu.md).

| Phương pháp             | Cách xếp trong evaluator                                                                                 | Ý nghĩa / giới hạn                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **ProjectPopularity**   | Xếp giảm dần theo đúng `RankingFeatureService.build(...).popularity`.                                    | Đo feature code hiện tại khi đứng riêng.                                                                              |
| **MostPop-sales**       | Đếm `PURCHASE` tích lũy trước thời điểm request.                                                         | Baseline đếm thô cho e-commerce; gần `totalSold` nhưng không đồng nhất với MostPop theo mọi loại tương tác của paper. |
| **RecentPop-purchases** | Đếm đơn mua trong cửa sổ 7, 14, 30 hoặc 60 ngày trước request. Chọn cửa sổ bằng NDCG validation.         | Bản chuyển thể theo đơn mua; không tuyên bố là tái lập nguyên xi cửa sổ tháng của paper.                              |
| **DecayPop-purchases**  | Cộng đơn mua với trọng số `2^(−age/halfLife)`; thử half-life 7, 14, 30, 60 ngày và chọn bằng validation. | Bản suy giảm theo ngày cho e-commerce; không phải cấu hình tháng trong paper.                                         |

Baseline dùng cùng candidate pool, request, nhãn và tie-breaker với ProjectPopularity. Không gọi `TRENDING` là RecentPop/DecayPop: `TRENDING` hiện tại gộp nhiều loại sự kiện với cửa sổ và trọng số khác nhau, sau đó truyền rank của nguồn truy hồi.

## 4. Phép đo mô phỏng có thể chạy lại

Evaluator nằm ở [`evaluate-criterion-5-popularity.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-5-popularity.ts). Chạy từ thư mục gốc repository:

```bash
npm run recommendation:criterion-5-popularity-evaluate
```

Mỗi lần chạy dùng cùng seed nên tái tạo cùng kết quả. Script tạo 10 seed (`101–110`), 80 sản phẩm thuộc 10 danh mục, 16 impression/sản phẩm/ngày trong 90 ngày lịch sử, và 120 request cho mỗi split. Candidate pool của mọi phương pháp là cùng 80 sản phẩm. Request được chia theo thời gian: train `60–89`, validation `90–104`, test `105–119`; lịch sử popularity chỉ chứa sự kiện ngày `0–89` và mỗi snapshot loại sự kiện có `eventDay ≥ requestDay`. Outcome validation/test không được đưa ngược vào lịch sử.

Nhãn là click Bernoulli được sinh bằng RNG riêng, theo xác suất:

```text
P(click) = 0.03 + 0.50 × [danh mục sản phẩm khớp ý định request]
                  + 0.08 × demand ẩn của sản phẩm tại ngày request
```

Label generator không đọc feature, score, `sourceRank`, hay kết quả của các baseline. Lịch sử tương tác và click cùng phụ thuộc vào demand ẩn để mô hình hóa tín hiệu popularity có thể liên quan đến nhãn; phần khớp danh mục chiếm trọng số lớn hơn demand. Vì vậy đây là **kịch bản synthetic thiên mạnh về ý định danh mục**, không phải benchmark trung lập hoặc mô hình hành vi đã hiệu chỉnh từ người mua thật. Exposure được đặt bằng nhau cho mọi sản phẩm; kết quả không mô phỏng sai lệch vị trí/hiển thị của production. Không có model AI nào được train trong script.

NDCG@10 được lấy macro trên mọi request; request không click có NDCG bằng 0. Recall@10 được lấy macro trên request có ít nhất một click. Kết quả dưới đây có 1.200 test request và 1.200 positive request cho mỗi phương pháp. `± SD` là độ lệch chuẩn mẫu giữa 10 seed; `[min,max]` là khoảng quan sát giữa seed. Chênh lệch ghép cặp lấy `baseline − ProjectPopularity`; CI percentile 95% resample **10 paired seed-level means như 10 cluster** (2.000 lần), vì request trong cùng seed dùng chung catalog, demand ẩn và lịch sử. Với chỉ 10 cluster, CI này còn exploratory; không phải CI đại diện cho toàn bộ người dùng hoặc hệ thống production.

### Kết quả chạy

| Phương pháp         | Validation NDCG@10 mean ± SD | Test NDCG@10 mean ± SD [min,max] | Test Recall@10 mean ± SD [min,max] |
| ------------------- | ---------------------------: | -------------------------------: | ---------------------------------: |
| ProjectPopularity   |              0,1640 ± 0,0120 | 0,1634 ± 0,0077 [0,1530; 0,1802] |   0,1590 ± 0,0083 [0,1472; 0,1726] |
| MostPop-sales       |              0,1632 ± 0,0116 | 0,1619 ± 0,0095 [0,1483; 0,1778] |   0,1581 ± 0,0052 [0,1482; 0,1668] |
| RecentPop-purchases |              0,1694 ± 0,0106 | 0,1529 ± 0,0194 [0,1210; 0,1762] |   0,1504 ± 0,0176 [0,1244; 0,1716] |
| DecayPop-purchases  |              0,1703 ± 0,0099 | 0,1659 ± 0,0057 [0,1557; 0,1720] |   0,1622 ± 0,0072 [0,1523; 0,1750] |

### Kết quả từng seed

Mỗi ô ghi `NDCG@10 / Recall@10`; cửa sổ và half-life được chọn riêng theo validation của seed đó.

| Seed | RecentPop window | DecayPop half-life |         Project |         MostPop |       RecentPop |        DecayPop |
| ---: | ---------------: | -----------------: | --------------: | --------------: | --------------: | --------------: |
|  101 |          30 ngày |             7 ngày | 0,1553 / 0,1472 | 0,1605 / 0,1590 | 0,1497 / 0,1440 | 0,1716 / 0,1523 |
|  102 |          60 ngày |            30 ngày | 0,1675 / 0,1623 | 0,1483 / 0,1545 | 0,1613 / 0,1660 | 0,1599 / 0,1667 |
|  103 |          60 ngày |            14 ngày | 0,1607 / 0,1726 | 0,1681 / 0,1625 | 0,1703 / 0,1716 | 0,1658 / 0,1750 |
|  104 |          60 ngày |             7 ngày | 0,1689 / 0,1627 | 0,1604 / 0,1576 | 0,1587 / 0,1512 | 0,1680 / 0,1640 |
|  105 |          14 ngày |            30 ngày | 0,1530 / 0,1598 | 0,1593 / 0,1619 | 0,1290 / 0,1311 | 0,1694 / 0,1708 |
|  106 |          14 ngày |             7 ngày | 0,1615 / 0,1495 | 0,1541 / 0,1551 | 0,1318 / 0,1244 | 0,1720 / 0,1576 |
|  107 |          30 ngày |            14 ngày | 0,1591 / 0,1533 | 0,1505 / 0,1482 | 0,1586 / 0,1575 | 0,1591 / 0,1645 |
|  108 |          60 ngày |            30 ngày | 0,1636 / 0,1514 | 0,1678 / 0,1551 | 0,1722 / 0,1642 | 0,1681 / 0,1562 |
|  109 |          14 ngày |             7 ngày | 0,1640 / 0,1662 | 0,1717 / 0,1607 | 0,1210 / 0,1278 | 0,1557 / 0,1580 |
|  110 |          60 ngày |            60 ngày | 0,1802 / 0,1650 | 0,1778 / 0,1668 | 0,1762 / 0,1662 | 0,1693 / 0,1570 |

| Baseline trừ ProjectPopularity | Δ NDCG@10 [CI seed-cluster 95%] | Δ Recall@10 [CI seed-cluster 95%] |
| ------------------------------ | ------------------------------: | --------------------------------: |
| MostPop-sales                  |       −0,0015 [−0,0070; 0,0036] |         −0,0009 [−0,0048; 0,0033] |
| RecentPop-purchases            |      −0,0105 [−0,0208; −0,0011] |         −0,0086 [−0,0189; 0,0006] |
| DecayPop-purchases             |       +0,0025 [−0,0032; 0,0081] |         +0,0032 [−0,0007; 0,0070] |

RecentPop/DecayPop chọn cửa sổ hoặc half-life theo NDCG validation riêng cho từng seed. Test cho thấy trong mô phỏng này:

- MostPop-sales gần như không khác ProjectPopularity; CI của cả hai metric chứa 0.
- RecentPop-purchases có NDCG thấp hơn ProjectPopularity theo nhãn category-heavy (CI seed-cluster không chứa 0); CI của Recall vẫn chứa 0. Kết quả chỉ nói về giả định mô phỏng, không chứng minh ProjectPopularity tốt hơn nói chung.
- DecayPop-purchases nhỉnh hơn về số trung bình, nhưng CI của NDCG và Recall đều chứa 0; chưa có bằng chứng rõ về khác biệt trong mô phỏng này.

Các half-life/cửa sổ được chọn thay đổi giữa seed; xem phần output của evaluator khi cần kiểm tra lựa chọn từng seed. Không chọn tham số theo test. Các kết quả trên **không chứng minh công thức tối ưu**, không xác nhận hiệu quả cho LambdaRank, và không thay thế log thật. Evaluator cũng không dùng nhãn simulator hiện có có thành phần `totalSold`, tránh dùng popularity đầu vào làm utility target của chính phép đo.

## 5. Cách kiểm chứng trên dữ liệu lịch sử thật

### Dữ liệu cần lưu

- Request ID, timestamp, user/session đã ẩn danh, chiến lược request, context và phiên bản model/config.
- Candidate pool gửi vào ranker, slate thực sự render/hiển thị, vị trí mỗi item, source, feature values và score tại thời điểm request.
- Impression event theo từng item; click, add-to-cart, purchase hoặc outcome đã chọn, cùng cửa sổ quy kết được định nghĩa trước.
- Snapshot bất biến tại thời điểm request: `totalSold`, event counts, `sourceRank`, `sourceSize` và timestamp/mốc dữ liệu dùng để tính từng giá trị.

Chỉ có đơn hàng mà không có impression thì không biết sản phẩm nào người dùng có cơ hội nhìn thấy nhưng không chọn. Nếu chỉ có slate đã hiển thị, nhãn âm cho item không được hiển thị là **không biết**, không phải không quan tâm. Đánh giá các ranking mới trên candidate chưa từng được phơi bày cần log exposure/propensity phù hợp hoặc một thử nghiệm mới; không tự gán nhãn cho candidate chưa được hiển thị.

### Quy trình đo

1. Chia request theo thời gian thành train, validation, test. Với request tại thời điểm `t`, chỉ tính popularity từ event có timestamp trước `t`; kiểm tra rằng không có tương tác tương lai hoặc snapshot hiện tại bị dùng thay snapshot lịch sử.
2. Định nghĩa trước outcome chính, ví dụ purchase trong 7 ngày sau impression; báo riêng click/add-to-cart hoặc định nghĩa graded relevance từ trước. Không đổi nhãn sau khi xem metric.
3. Chạy ProjectPopularity, MostPop, RecentPop và DecayPop trên cùng request/candidate pool và cùng nhãn quan sát được. Chọn cửa sổ/half-life trên validation; khóa cấu hình rồi mới mở test.
4. Báo NDCG@10, Recall@10, số request/positive, khoảng tin cậy ghép cặp theo request và phân tầng head/tail, cold-start, guest/user nếu đủ dữ liệu. Báo riêng coverage và tỷ lệ candidate thực sự được hiển thị; xử lý exposure/position bias theo protocol đã chọn.
5. Để kiểm tra feature có giúp **model AI**, so sánh LambdaRank đầy đủ với cùng cấu hình đã bỏ riêng feature `popularity`. Fit/preprocess/tune chỉ bằng train/validation. Phép so feature đứng riêng ở mục 4 không trả lời được câu hỏi ablation này.
6. Nếu cần kết luận nhân quả về click, mua hoặc doanh thu, dùng controlled online experiment hoặc phương pháp counterfactual phù hợp với exposure/propensity log. Metric offline trên dữ liệu do ranker cũ thu thập chịu selection và position bias.

## 6. Bằng chứng hiện tại cho phép kết luận gì?

| Mệnh đề                                            | Bằng chứng hiện có                                                                    | Kết luận được phép                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Công thức có miền giá trị/đơn điệu như tài liệu 01 | Suy ra đại số từ `log1p`, chuẩn hóa rank, `max` và `clamp`                            | Chứng minh được tính chất toán học dưới điều kiện đầu vào nêu trong tài liệu 01; không suy ra ranking tốt.               |
| Code khớp các ví dụ đã kiểm tra                    | Unit spec có rank `2/5`, fallback khi thiếu `sourceSize`, và 3 ca sales không hữu hạn | Các ca đó có kiểm chứng; boundary coverage vẫn còn các hàng “chưa thấy” ở mục 2.                                         |
| ProjectPopularity hơn baseline trên synthetic      | 10 seed, nhãn category-heavy, kết quả và CI ở mục 4                                   | Gần MostPop; thấp hơn RecentPop và gần DecayPop theo độ bất định của kịch bản này. Không ngoại suy sang người dùng thật. |
| Feature cải thiện LambdaRank hoặc sản phẩm thật    | Chưa có ablation model trên log thật; chưa có impression log thật trong phép đo này   | **Chưa kết luận được.**                                                                                                  |
| Công thức tối ưu vì có nghiên cứu liên quan        | Nghiên cứu đo MostPop/RecentPop/DecayPop trên dataset/protocol riêng                  | Không được kết luận; các paper không xác nhận hệ số 12, phép gộp `max`, hay proxy `sourceRank` của dự án.                |

### Câu trả lời ngắn khi bảo vệ

> “Em kiểm tra code bằng unit spec và các ca biên, rồi đo feature hiện tại bên cạnh MostPop, RecentPop và DecayPop trên cùng candidate pool, cùng nhãn synthetic và chia thời gian. Trong mô phỏng có nhãn click thiên mạnh về ý định danh mục, MostPop gần như ngang feature của em; DecayPop nhỉnh nhẹ nhưng khoảng tin cậy vẫn chứa 0. Đây chỉ là kiểm tra evaluator và giả định synthetic, chưa chứng minh hiệu quả với người dùng thật hay đóng góp cho LambdaRank. Muốn kết luận hai điểm đó, em cần impression log lịch sử, test theo thời gian và phép ablation model.”

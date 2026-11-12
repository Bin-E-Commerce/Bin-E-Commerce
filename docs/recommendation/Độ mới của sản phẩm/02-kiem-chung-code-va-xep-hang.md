# Tiêu chí 6 — Kiểm chứng code và xếp hạng (`freshness`)

> **Mục tiêu:** kiểm tra code có tính đúng feature độ mới theo định nghĩa không, rồi đo cách feature đó sắp thứ tự trên một bộ dữ liệu được mô tả rõ. Hai việc này không chứng minh rằng người mua thật thích hàng mới hơn. Kết quả hiện tại là mô phỏng có kiểm soát, chưa phải đánh giá hiệu quả trên log thật.

## 1. Đường đi từ dữ liệu tới feature

| Bước                 | Code                                                                                                                                                                                                    | Vai trò                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog              | [`catalog-product.repository.ts`](../../../services/recommendation-service/src/modules/catalog/infrastructure/repositories/catalog-product.repository.ts)                                               | Trả `createdAt` của sản phẩm trong catalog snapshot.                                                                                                  |
| Tính feature         | [`ranking-feature.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts) — `build()` gọi `freshnessScore()` | Tính tuổi tại `referenceTime`, rồi ánh xạ vào điểm bucket `1.00/0.80/0.55/0.30/0.10`.                                                                 |
| Model xếp hạng       | [`recommendation-ml-ranking.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts)                      | Đưa `freshness` cùng các feature khác vào LambdaRank. Điểm freshness không được nhân riêng với “trọng số 8%”; model học cách kết hợp các cột đầu vào. |
| Giao diện giải thích | [`RankingWeightFreshnessDetails.tsx`](<../../../web/src/app/(public)/showcase/recommendation/components/ranking/criteria/RankingWeightFreshnessDetails.tsx>)                                            | Hiển thị các mốc bucket đang dùng.                                                                                                                    |
| Kiểm thử đơn vị      | [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts)                          | Kiểm tra các mốc, ngay sau mốc và ngày tạo trong tương lai.                                                                                           |
| Evaluator riêng      | [`evaluate-criterion-6-freshness.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-6-freshness.ts)                                                                           | Gọi feature builder production để lấy bucket thật; so với hàm mũ và baseline không freshness trên dữ liệu synthetic.                                  |

### Công thức code đang chạy

Với `D = 86.400.000` mili giây một ngày, code tính:

$$
a_i(t)=\max\left(0,\frac{t-createdAt_i}{D}\right)
$$

và ánh xạ:

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

`build(..., referenceTime)` nhận thời điểm tham chiếu từ caller; nếu caller bỏ qua đối số này thì code dùng giờ hiện tại. Khi đánh giá lịch sử phải truyền timestamp của từng request, không truyền giờ chạy evaluator. Tuổi âm do `createdAt` tương lai bị chặn thành `0` và nhận `1.00`. Ngày được tính theo khoảng 24 giờ, không phải ngày lịch. Ngày không hợp lệ chưa có hợp đồng riêng; phép tính thành `NaN` rồi rơi qua mọi nhánh và trả `0.10`, nên dữ liệu catalog phải được kiểm tra.

### Code và test hiện xác nhận điều gì

Spec kiểm tra tuổi `0`, `1`, `1.0001`, `7`, `7.0001`, `30`, `30.0001`, `90`, `90.0001` ngày và tuổi `-1` ngày. Điều đó kiểm tra đúng các điều kiện biên `<=` ở code và fallback cho ngày tạo trong tương lai. Nó chưa kiểm tra `Invalid Date`, toàn miền tuổi bằng property-based test, hay chất lượng ranking. Tính bị chặn và không tăng theo tuổi còn có thể chứng minh trực tiếp từ thứ tự các hằng số trong công thức; đó là chứng minh tính chất toán học của feature, không phải chứng minh người dùng thích sản phẩm mới.

## 2. Evaluator và thiết kế dữ liệu

Script tạo dữ liệu deterministic từ 12 seed. Mỗi seed có 600 request theo thứ tự thời gian, catalog 500 sản phẩm và 30 candidate được chọn không hoàn lại cho mỗi request. Candidate chỉ gồm sản phẩm có `createdAt <= requestTime`; các request và user ID không trùng giữa split. Catalog sản phẩm có thể xuất hiện qua nhiều split có chủ ý để tuổi của cùng sản phẩm tăng theo thời gian. Cùng một request, candidate và outcome được dùng cho mọi phương pháp trong cùng kịch bản.

| Phần       | Request mỗi seed | Toàn bộ 12 seed | Khoảng thời gian UTC                |
| ---------- | ---------------: | --------------: | ----------------------------------- |
| Train      |              360 |           4.320 | 01/01/2026 00:00 – 31/03/2026 18:00 |
| Validation |              120 |           1.440 | 01/04/2026 00:00 – 30/04/2026 18:00 |
| Test       |              120 |           1.440 | 01/05/2026 00:00 – 30/05/2026 18:00 |

Đây là chia theo timestamp: request, user và nhãn thuộc đúng một khoảng thời gian; sản phẩm được phép xuất hiện ở nhiều giai đoạn vì đây là cùng catalog phát triển theo thời gian. Split train chỉ làm rõ trục thời gian và quy mô dữ liệu; evaluator **không huấn luyện LambdaRank** và không dùng train để ước lượng tham số.

### Hai cơ chế tạo nhãn độc lập với score đang so

Mỗi candidate được coi là một impression synthetic. Click được sinh từ một số ngẫu nhiên cố định theo seed và xác suất sau; công thức tạo nhãn không gọi bucket hoặc hàm mũ đang được đánh giá:

$$
p(click)=\min\left(0.9,\;0.025+0.14q+0.25c+0.10b+0.35n(a)\right)
$$

Trong đó `q` là chất lượng latent được sinh độc lập với tuổi, `c` là khớp category với request, `b` là khớp brand, còn `n(a)=max(0,1-a/180)` là prior novelty tuyến tính được **đặt trước riêng cho kịch bản age-sensitive**. Kịch bản **age-neutral** bỏ hẳn hạng `0.35n(a)`. Outcome uniform, request, catalog và candidate pool được tái sử dụng giữa hai kịch bản; xác suất/nhãn khác nhau chỉ do hai giả thuyết tuổi khác nhau.

Đây là label mechanism độc lập với điểm bucket/exponential, nhưng vẫn là giả định do người viết đặt ra, có sử dụng tuổi thô ở kịch bản age-sensitive. Nó không phải log click thật, cũng không chứng minh prior novelty tuyến tính đúng với khách hàng. Kịch bản age-neutral là negative control: nếu tuổi không liên quan, freshness không nên thể hiện lợi ích ổn định. Candidate position không đi vào xác suất click; evaluator không mô phỏng position bias hoặc sửa exposure bằng propensity weighting.

### Các cách xếp hạng được so

1. **Bucket production:** feature lấy trực tiếp từ `RankingFeatureService.build()` với `referenceTime` của request, không sao chép điều kiện ngưỡng sang evaluator.
2. **Exponential decay:** `F_exp(a)=0.10+0.90×2^(−a/H)`, với `H` lấy từ lưới `[7, 14, 21, 30, 45, 60, 90, 120, 180, 240]` ngày. Floor `0.10` và lưới `H` là lựa chọn của benchmark, không phải hằng số đã được paper chứng minh tối ưu cho catalog này.
3. **No freshness:** mọi candidate có điểm `0`; thứ tự hòa được phá bằng hash ổn định của request/item. Đây là baseline không mang thông tin tuổi, không phải baseline độ phổ biến.

Mỗi phương pháp chỉ xếp candidate bằng một feature freshness (hoặc không có freshness); không cộng điểm từ các tiêu chí khác. Metric dùng nhãn click nhị phân:

$$
DCG@10=\sum_{r=1}^{10}\frac{rel_r}{\log_2(r+1)},\qquad NDCG@10=\frac{DCG@10}{IDCG@10}.
$$

`NDCG@10` là metric chính, đo việc click được đưa lên đầu danh sách; `Recall@10` là tỷ lệ click trong top 10 trên tổng click của request, chỉ lấy trung bình các request có ít nhất một click. Chỉ số NDCG bắt nguồn từ nghiên cứu đánh giá truy hồi của Järvelin & Kekäläinen (2002), [DOI](https://doi.org/10.1145/582415.582418). Kết quả được macro-average theo request; báo trung bình và độ lệch chuẩn qua 12 seed. Khoảng tin cậy paired 95% bootstrap lấy mẫu lại **12 seed** (2.000 lần), không lấy request làm đơn vị độc lập vì request trong cùng seed chia sẻ một catalog.

## 3. Kết quả mô phỏng có thể tái chạy

### Test set

| Kịch bản nhãn | Phương pháp       | `H` (ngày) | NDCG@10 trung bình ± SD | Recall@10 trung bình ± SD |
| ------------- | ----------------- | ---------: | ----------------------: | ------------------------: |
| Age-sensitive | Bucket production |          — |         0.4749 ± 0.0178 |           0.5072 ± 0.0235 |
| Age-sensitive | Exponential decay |         7* |         0.4853 ± 0.0186 |           0.5237 ± 0.0236 |
| Age-sensitive | Không freshness   |          — |         0.2984 ± 0.0140 |           0.3311 ± 0.0152 |
| Age-neutral   | Bucket production |          — |         0.2171 ± 0.0165 |           0.3261 ± 0.0310 |
| Age-neutral   | Exponential decay |         7* |         0.2131 ± 0.0167 |           0.3160 ± 0.0322 |
| Age-neutral   | Không freshness   |          — |         0.2172 ± 0.0170 |           0.3205 ± 0.0250 |

`*` Validation cho mọi `H` trong lưới cùng NDCG (age-sensitive `0.4851`, age-neutral `0.2310` khi làm tròn bốn chữ số). Lý do là với `H>0`, `F_exp(a)` giảm nghiêm ngặt theo tuổi; thay `H` đổi khoảng cách score nhưng **không đổi thứ tự candidate** khi chỉ xếp bằng freshness. Code chọn `H=7` như tie-break cố định cho kết quả chạy được, chứ dữ liệu validation không xác định được half-life tối ưu. Nếu cần chọn `H` có ý nghĩa, phải kiểm tra nó bên trong score tổng hợp/model ranker, nơi tương tác với feature khác có thể đổi thứ tự.

### Chênh lệch paired trên test

| Kịch bản                                | Chênh lệch NDCG@10 | Khoảng tin cậy 95% | Chênh lệch Recall@10 | Khoảng tin cậy 95% |
| --------------------------------------- | -----------------: | -----------------: | -------------------: | -----------------: |
| Age-sensitive: Bucket − không freshness |            +0.1765 | [+0.1649; +0.1876] |              +0.1761 | [+0.1601; +0.1905] |
| Age-sensitive: Exponential − bucket     |            +0.0105 | [+0.0061; +0.0148] |              +0.0165 | [+0.0107; +0.0229] |
| Age-neutral: Bucket − không freshness   |            −0.0001 | [−0.0120; +0.0134] |              +0.0056 | [−0.0155; +0.0288] |
| Age-neutral: Exponential − bucket       |            −0.0040 | [−0.0090; +0.0011] |              −0.0101 | [−0.0197; +0.0002] |

Ở thế giới giả lập đã cài sẵn quan hệ “mới hơn có ích”, cả hai công thức freshness tăng điểm ranking so với baseline ngẫu nhiên; exponential nhỉnh hơn bucket vì xếp được thứ tự chi tiết bên trong các vùng mà bucket cho hòa. Ở negative control age-neutral, khoảng tin cậy của chênh lệch NDCG so với baseline chứa 0; không có bằng chứng mô phỏng rằng freshness giúp khi nhãn không chứa tín hiệu tuổi. Các con số này mô tả hai giả định synthetic và kiểm tra evaluator hoạt động như thiết kế; không phải phép đo hiệu quả thực tế.

## 4. Cách chạy lại

Chạy từ thư mục gốc repository sau khi thay đổi evaluator:

```powershell
npm run recommendation:criterion-6-freshness-evaluate
```

Lệnh trên build và chạy evaluator. Có thể chạy cả nhóm tiêu chí 3–8 bằng `npm run recommendation:criteria-3-8-evaluate`.

Chạy thủ công theo từng bước:

```powershell
npm run build --workspace=@bin-ecommerce/recommendation-service
node services/recommendation-service/dist/services/recommendation-service/src/scripts/evaluate-criterion-6-freshness.js
```

Lần chạy được ghi trong tài liệu này: cả lệnh build và evaluator hoàn tất với exit code `0`. Script in bảng tóm tắt, khoảng bootstrap và JSON đầy đủ; toàn bộ giá trị có thể tái tạo từ seed cố định. Nó không đọc database, không gọi mạng và không sửa catalog thật.

## 5. Kết luận đúng với bằng chứng hiện có

| Câu hỏi                                                              | Kết luận                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code có áp dụng các bucket đúng đặc tả không?                        | Spec kiểm tra các boundary và `build()` nhận `referenceTime`; evaluator gọi chính builder production. Có thể xác nhận triển khai tại các ca đã test. Ngày không hợp lệ vẫn chưa có hợp đồng rõ.                                                   |
| Bucket có xếp hạng tốt trong mô phỏng không?                         | Có khi label được tạo với prior novelty; không cho thấy lợi ích rõ ở negative control tuổi trung tính. Đây chỉ là kiểm tra synthetic theo giả thuyết đã đặt.                                                                                      |
| Bucket có tốt hơn exponential không?                                 | Không trong age-sensitive synthetic: exponential cho NDCG cao hơn khoảng `0.0105`; kết quả ấy không chứng minh exponential tốt hơn trên hệ thống thật.                                                                                            |
| `H=7` có tối ưu không?                                               | Không thể kết luận. Với freshness-only ranking, NDCG không phân biệt các `H` dương vì chúng giữ cùng thứ tự.                                                                                                                                      |
| Có chứng minh freshness cải thiện LambdaRank hoặc hành vi mua không? | Chưa. Evaluator không huấn luyện model và không dùng impression log thật. Cần offline test trên dữ liệu production và ablation LambdaRank có/không freshness; nếu cần kết luận tác động nhân quả tới click/mua thì cần thử nghiệm online phù hợp. |

Nghiên cứu về temporal recommendation làm cơ sở để xem xét thời gian, không chứng minh bucket hay exponential này tối ưu. Xem [cơ sở toán học và nghiên cứu](./01-co-so-toan-hoc-va-nghien-cuu.md) để biết nguồn, giả định và giới hạn chuyển giao của từng bài.

### Trình bày ngắn với giảng viên

> “Em đã xác minh code tính tuổi theo `createdAt` tại timestamp request và gán đúng năm bucket; test kiểm tra từng mốc và giá trị ngay sau mốc. Em tạo evaluator deterministic với hai giả thuyết nhãn đối chứng: một giả định có novelty, một giả định tuổi không liên quan; cùng request/candidate/nhãn được dùng để so bucket, exponential decay và baseline bỏ freshness. Trên bộ synthetic, freshness chỉ cải thiện rõ ở kịch bản em chủ động đặt sẵn tác động tuổi; ở kịch bản trung tính không thấy cải thiện rõ. Do vậy đây là kiểm tra logic và độ nhạy của phương pháp, chưa phải bằng chứng khách hàng thật hay bằng chứng bucket tối ưu. Bước tiếp theo cần log impression thật chia theo thời gian và ablation model để kết luận cho hệ thống.”

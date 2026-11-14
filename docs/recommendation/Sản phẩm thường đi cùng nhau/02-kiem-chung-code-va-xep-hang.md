# Kiểm chứng code và xếp hạng tiêu chí `coBehavior`

> **Phạm vi:** đối chiếu đường dữ liệu hiện hành với định nghĩa trong [cơ sở toán học và nghiên cứu](01-co-so-toan-hoc-va-nghien-cuu.md), ghi rõ kiểm thử nào đang có, rồi thiết kế phép đo tái lập để đánh giá hiệu quả. Đúng code không đồng nghĩa với xếp hạng tốt; dữ liệu giả lập không chứng minh hiệu quả trên người mua thật.

## 1. Đường đi từ event đến feature

| Bước                              | Mã nguồn                                                                                                                                                                                                                                                                                                          | Hành vi cần đối chiếu                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ghi event và tạo cặp              | [`RelationProjectionService`](../../../services/recommendation-service/src/modules/relations/application/services/projection/relation-projection.service.ts)                                                                                                                                                      | Xem/bấm/impression được ghép trong cùng session ở cửa sổ đối xứng 30 phút; cart dùng cửa sổ 7 ngày và scope session/user; purchase tạo mọi cặp item phân biệt trong order. Return cộng hiệu chỉnh âm. |
| Chống event/cặp lặp và cộng score | [`RelationRepository`](../../../services/recommendation-service/src/modules/relations/infrastructure/repositories/relation.repository.ts)                                                                                                                                                                         | Ledger khóa event/pair; `addRelations` cộng `scoreDelta`, `positiveDelta`, `negativeDelta`, giữ thời điểm mới nhất rồi upsert.                                                                        |
| Lấy ứng viên liên quan            | [`RelationCandidateService`](../../../services/recommendation-service/src/modules/relations/application/services/candidates/relation-candidate.service.ts), [`RelationRepository.findTargets`](../../../services/recommendation-service/src/modules/relations/infrastructure/repositories/relation.repository.ts) | Query top relation theo tối đa 10 anchor, loại quan hệ self, lọc `effectiveScore > 0`, lấy nhiều nhất 100 candidate; lỗi kho relation trả danh sách rỗng.                                             |
| Gắn attribution cho candidate     | [`CandidateGenerationService`](../../../services/recommendation-service/src/modules/recommendation/application/services/candidates/generation/candidate-generation.service.ts)                                                                                                                                    | Giữ các contribution của nhiều anchor/loại relation. Gắn source `CO_BEHAVIOR`; xếp attribution để giải thích và gán sourceRank.                                                                       |
| Tạo feature                       | [`RankingFeatureService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts)                                                                                                                                                   | Lọc đúng source `CO_BEHAVIOR`, chuẩn hóa từng contribution bằng `max(0,s)/(max(0,s)+scale)`, lấy max; không dùng `sourceRank` làm `coBehavior`.                                                       |
| Gửi sang AI                       | [`RecommendationMlRankingService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts)                                                                                                                                      | Gửi cột thứ tư trong vector chín feature dưới schema `ranking-features-v3`; model trả relevance score, không trả xác suất.                                                                            |

### Đối chiếu quan trọng về decay

Query relation nhân **tổng `relation_score` đã cộng dồn** với `0.5^((now-last_signal_at)/H)`. Do `last_signal_at` được cập nhật lên thời điểm mới khi có pair mới, lần tương tác mới có thể làm mới tuổi của phần tổng cũ. Các tài liệu giải thích trên UI nói “điểm cũ giảm một nửa mỗi 30 ngày”; phát biểu này đúng cho tổng cố định khi không có event mới, nhưng không đúng với mô hình “mỗi event đóng góp được decay riêng” nếu các event đến ở nhiều thời điểm. Timestamp tương lai còn làm hệ số lớn hơn 1; projector chỉ từ chối timestamp không parse được, chưa kiểm tra timestamp vượt thời điểm hiện tại.

Để so code với công thức từng event, cần một test có ít nhất hai contribution cách xa nhau, rồi đối chiếu:

```text
decay từng event:  w1 × 0.5^(age1 / H) + w2 × 0.5^(age2 / H)
code hiện tại:     (w1 + w2) × 0.5^(age(last_signal_at) / H)
```

Hai giá trị nhìn chung khác nhau. Đây là giới hạn/mismatch cần quyết định rõ trước khi tuyên bố đúng với “decay từng tín hiệu”; tài liệu này không tự sửa code hay tái dựng lịch sử đã bị gộp.

## 2. Các unit spec hiện có và phạm vi bảo vệ

Đã chạy toàn bộ test recommendation-service: **23 suite, 115/115 test đạt**. Trong đó `ranking-feature.service.spec.ts` đạt **41/41**, bao gồm ca boundary `Number.MAX_VALUE` cho phép chuẩn hóa. Đây là xác nhận các test hiện hành chạy qua, không xác nhận mọi trường hợp SQL/event hoặc chất lượng xếp hạng ngoài production.

| Spec                                                                                                                                                                           | Trường hợp được bảo vệ                                                                                                                            | Chưa được bảo vệ trực tiếp                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts) | Source khác bị bỏ qua; scale `6` ra `0,5`; mixed relation lấy max sau chuẩn hóa; score âm/NaN/±Infinity về `0`; `Number.MAX_VALUE` không tràn.    | Scale sai hoặc scale riêng của đủ ba loại; query SQL/decay; event boundary và tie-break nhiều anchor chưa được kiểm chứng end-to-end. |
| [`relation-candidate.service.spec.ts`](../../../services/recommendation-service/src/modules/relations/application/services/candidates/relation-candidate.service.spec.ts)      | Source flag tắt thì không query; unique tối đa 10 anchor; query các relation type với giới hạn tối đa 100; exclusion; repository error fail-soft. | Độ đúng SQL score/decay, tie-break, query limit theo loại, cấu hình half-life và trường hợp candidate nhận nhiều attribution.         |
| [`relation-projection.service.spec.ts`](../../../services/recommendation-service/src/modules/relations/application/services/projection/relation-projection.service.spec.ts)    | Pair event đến sai thứ tự vẫn được ghi tối đa một lần; pair đã claim không cộng lại.                                                              | Ranh giới cửa sổ 30 phút/7 ngày, scope session/user, event types, trọng số từng loại, cùng order, return, event thiếu khóa/timestamp. |
| [`relation.repository.spec.ts`](../../../services/recommendation-service/src/modules/relations/infrastructure/repositories/relation.repository.spec.ts)                        | Duplicate directed pair trong batch được coalesce trước một lần upsert; score và các timestamp được gộp đúng trong fixture.                       | `findTargets` query, half-life fallback/validation, filter effective score, ranking/limit, decay aggregate-vs-per-event.              |

### Golden cases cần có khi xác minh triển khai

Các expected values dưới đây có thể được kiểm tra trực tiếp bằng `RankingFeatureService` với `referenceTime` cố định và rule mock có scale tương ứng. Chúng không cần dataset người mua:

| Đầu vào contribution của một candidate                      | Expected `coBehavior` | Lý do                                                      |
| ----------------------------------------------------------- | --------------------: | ---------------------------------------------------------- |
| Không có contribution hoặc chỉ có source khác `CO_BEHAVIOR` |                     0 | Feature không mượn điểm từ nguồn khác.                     |
| `CO_VIEW s=0`, `k=1`                                        |                     0 | Điểm không có bằng chứng.                                  |
| `CO_VIEW s=1`, `k=1`                                        |                   0,5 | `s=k ⇒ s/(s+k)=1/2`.                                       |
| `CO_VIEW s=2`, `k=1`                                        |                   2/3 | Tăng theo raw score.                                       |
| `CO_CART s=3`, `k=3` và `CO_PURCHASE s=6`, `k=6`            |                   0,5 | Kiểm tra scale độc lập của từng relation type.             |
| `CO_VIEW s=2, k=1`; `CO_CART s=3, k=3`                      |                   2/3 | Lấy `max` sau chuẩn hóa; không cộng thành `1` hay hơn `1`. |
| Contribution có `s<0`, `NaN` hoặc `Infinity`                |        0 contribution | Code đưa giá trị không hợp lệ/âm về 0.                     |
| Thêm một contribution có chuẩn hóa thấp hơn max hiện tại    |       Điểm giữ nguyên | Max không cộng consensus nhiều anchor.                     |

Đối với repository/projector, cần bổ sung golden boundary checks cho đúng ranh giới event-time (`30 phút`, `7 ngày`), event scope và relation score có return. Muốn khẳng định aggregate decay đúng theo code hiện tại, test phải nêu rõ đang kiểm tra `last_signal_at` trên tổng, không gắn nhãn là per-event decay.

Phép chứng minh ở tài liệu 01 diễn ra trên số thực. Code đã được đổi sang dạng chia tỷ số để tránh tràn mẫu `rawScore + scale`; unit test xác nhận `Number.MAX_VALUE` với cùng scale cho ra `0,5`. Với tỷ lệ cực lớn, IEEE-754 vẫn có thể làm tròn kết quả lên đúng `1`; vì vậy miền số học máy được diễn đạt là `[0,1]`, còn tính chất `<1` là kết quả trên số thực. Cấu hình scale vẫn cần là số hữu hạn dương; test biên bảo vệ ca tràn đã phát hiện.

## 3. Baseline nghiên cứu để so sánh

Không có một “công thức đúng duy nhất” thắng ở mọi dữ liệu. Các baseline bên dưới là các phương pháp đã có định nghĩa nghiên cứu và phù hợp câu hỏi “hai sản phẩm có thường đi cùng nhau không?”. Tất cả phải dùng cùng request, candidate set, dữ liệu đến trước request và nhãn tương tác sau impression.

Các baseline này chỉ dùng để đánh giá và giải thích bằng chứng; chúng không đề xuất thay AI ranker hiện tại bằng một standard/hybrid ranker.

### A. Raw weighted co-occurrence

Với một anchor `a`, item `i` và relation type `r`, dùng `s_eff(a,i,r)` mà production query trả về sau khi áp dụng cùng cửa sổ, trọng số và quy tắc decay:

$$
S_{raw}(a,i,r)=\max(0,s_{eff}(a,i,r)).
$$

Đây là raw weighted co-occurrence ablation: so `S_raw` với `g_r(s_eff)` trên đúng cùng anchor/type/item để biết phép bão hòa có ích hay chỉ đổi thang. Khi gộp nhiều anchor, dùng cùng reducer (ví dụ `max`) cho hai biến thể; không so một bên lấy max với một bên cộng tổng vì khi đó đang đổi hai quy tắc cùng lúc. Có thể bổ sung biến thể raw sum như một baseline riêng, ghi rõ nó thay cả cách gộp.

### B. Item-item cosine theo implicit co-occurrence

Tạo vector cho từng sản phẩm trên cùng một không gian scope (ví dụ session đối với view, user/session đối với cart, order đối với purchase), rồi tính:

$$
sim_{cos}(a,i)=\frac{\mathbf{x}_a\cdot\mathbf{x}_i}{\|\mathbf{x}_a\|_2\|\mathbf{x}_i\|_2}.
$$

Sarwar et al. (2001) mô tả item vectors và cosine trong item-based CF, cùng bước dùng quan hệ đó để tạo dự đoán. Nếu áp dụng cho implicit events của dự án, đây là **biến thể baseline phù hợp dữ liệu**, không phải tái hiện chính xác toàn bài CF dùng ratings. Dùng các vector train-only; không để transaction/scope sau thời điểm request lọt vào vector. Nguồn: [Sarwar et al., WWW 2001](https://doi.org/10.1145/371920.372071).

### C. Confidence và lift trên đơn hàng

Chỉ trên basket/order, đặt `N` là số transaction trong train, `n(a)`, `n(i)`, `n(a,i)` lần lượt là số transaction chứa anchor, item đích và cả hai:

$$
confidence(a\Rightarrow i)=\frac{n(a,i)}{n(a)},\qquad
lift(a,i)=\frac{confidence(a\Rightarrow i)}{n(i)/N}
=\frac{n(a,i)N}{n(a)n(i)}.
$$

Confidence trả lời “trong transaction có `a`, tỷ lệ bao nhiêu có `i`”; lift chuẩn hóa theo mức phổ biến nền của `i`. Đó là lý do nên đưa lift vào so sánh: một item bán chạy có thể có count/confidence cao chỉ vì nó phổ biến. Association-rule mining gốc dùng support/confidence; nghiên cứu correlation rules thảo luận kiểm tra liên hệ vượt quá đồng xuất hiện nền. Nguồn: [Agrawal et al., SIGMOD 1993](https://doi.org/10.1145/170035.170072), [Brin et al., SIGMOD 1997](https://doi.org/10.1145/253260.253327).

Các chỉ số confidence/lift không trực tiếp bao phủ view/cart; không trộn basket với session bằng một mẫu số tùy ý. Bắt đầu với purchase-only benchmark rõ ràng, hoặc định nghĩa riêng transaction/scope cho từng relation type.

Nếu anchor/target chưa xuất hiện trong train thì mẫu số bằng 0; baseline phải quy ước score 0 và báo coverage, thay vì âm thầm chia cho 0 hoặc dùng số liệu từ test. Ngưỡng support, nếu dùng, cũng chỉ được đặt từ train/validation.

### D. Công thức production `coBehavior`

Tính đúng `rawScore` mà production query trả về, map bằng scale theo loại quan hệ và lấy max qua contribution. Đây là phương án cần đo; nó không được gắn tên cosine, association rules, Amazon item-item hay một công thức paper nào.

### Mốc bổ trợ

Có thể báo `global popularity` để biết mức bài toán có thể giải bằng item phổ biến chung hay không, nhưng popularity không thay thế baseline item-item/cosine/confidence/lift cho chính tiêu chí sản phẩm đi cùng nhau. Nếu đánh giá riêng công thức này thì cần ít nhất raw weighted co-occurrence và một phương pháp item-item có normalization.

## 4. Quy trình đo xếp hạng có thể tái lập

### 4.1. Log cần có

- Một `requestId`, user/session scope và timestamp mỗi lần ranker trả response.
- Toàn bộ candidate pool trước khi chọn vị trí hiển thị, cùng tập item đã **thực sự được hiển thị**, vị trí, surface và impression timestamp; candidate chỉ được tạo nhưng không hiển thị không được coi là negative.
- Anchor product IDs ngay trước request, cùng relation type, effective raw score, `last_signal_at`, scale và feature vector `coBehavior` tại đúng thời điểm request.
- Catalog snapshot đủ để loại sản phẩm không khả dụng, chính sản phẩm mốc và exclusions; giữ lại candidate pool trước và sau filtering.
- Event outcome sau impression (click, add-to-cart, purchase, return) cùng thời điểm. Định nghĩa nhãn và cửa sổ attribution phải cố định trước khi xem test.
- Version của code, rule/config, dataset, feature schema, model artifact và seed; lưu candidate IDs, labels, scores để chạy lại NDCG/Recall từ file.

Nếu thiếu log impression hoặc feature snapshot thì có thể replay raw events theo thời gian để dựng feature, nhưng không được dùng tương tác sau request. Nếu log chỉ có item đã hiển thị, metric offline chỉ so được trong tập item đó; không thể suy ra nhãn cho candidate không được exposure. Muốn đánh giá danh sách mới có item chưa từng được hiển thị cần log exploration/propensity hoặc xác nhận bằng A/B test.

### 4.2. Chia tập và phép so

1. Sắp request theo thời gian thành train, validation, test; feature của request chỉ dùng event có thời điểm trước request. Giữ cùng requests, candidate pool và labels cho mọi phương pháp; ghi rõ candidate pool nào có outcome quan sát được.
2. So **feature-only**: production transform với raw weighted co-occurrence, item-item cosine và (cho basket) confidence/lift. Chạy trước theo một relation type hoặc cố định cùng quy tắc gộp anchor/loại relation cho mọi phương pháp; phép này đánh giá riêng sức sắp xếp của tín hiệu coBehavior.
3. Huấn luyện cùng một LambdaRank trên train với cùng candidate rows, label, seed và cấu hình: model đủ feature vs. model bỏ riêng `coBehavior`. Không được đổi candidate pool giữa hai model nếu mục tiêu là đo đóng góp feature; nếu coBehavior source cũng được tắt thì đó là thí nghiệm end-to-end riêng.
4. Chọn scale/half-life/weight hoặc biến thể trên validation. Sau khi chọn, đóng băng cấu hình và đánh giá test một lần. Không chọn lại tham số trên test.
5. Báo `NDCG@10` chính, `Recall@10` bổ trợ, số request, số positive, số candidate, tỷ lệ request không có positive, chênh lệch so baseline và khoảng tin cậy bootstrap theo request hoặc user. Tách thêm theo session/user mới, loại quan hệ, số anchor và độ phổ biến item đích.
6. Nếu baseline/feature mới ảnh hưởng exposure, log cũ phản ánh lựa chọn của ranker cũ và position bias. Báo đây là offline replay, không phải bằng chứng nhân quả; muốn khẳng định tác động mua hàng cần thử nghiệm trực tuyến có kiểm soát.

Chia dữ liệu theo thời gian cần được giữ cố định và mô tả rõ: nghiên cứu về các chiến lược chia tập cho recommendation cho thấy lựa chọn split có thể làm thay đổi thứ hạng tương đối giữa các mô hình. [Meng et al., RecSys 2020](https://doi.org/10.1145/3383313.3418479).

`NDCG@10` đo mức độ item có nhãn liên quan nằm cao trong top 10, phạt item liên quan nằm thấp hơn. `Recall@10` đo tỷ lệ item liên quan trong tập nhãn được tìm thấy ở top 10. Đây là metric đánh giá ranking, không phải thuật toán sinh `coBehavior` và không tự chứng minh doanh thu.

## 5. Trạng thái phép đo hiện tại

| Câu hỏi                                       | Bằng chứng trong repository đã kiểm tra                                                                                                             | Kết luận được phép                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Công thức chuẩn hóa có tính chất toán học gì? | Suy ra ở tài liệu 01; golden cases và test boundary số học đã chạy.                                                                                 | Bounded, monotone, concave theo contribution dương khi scale hợp lệ.                                                    |
| Code có các test trực tiếp cho feature?       | `ranking-feature.service.spec.ts`: 41/41; toàn service: 23 suite, 115/115.                                                                          | Có kiểm tra các đường chuẩn hóa; chưa bao phủ boundary SQL/event và toàn bộ lịch sử pair.                               |
| Code có chống duplicate relation event không? | Projector spec kiểm tra pair đến sai thứ tự và ledger.                                                                                              | Có kiểm tra hai nhánh đó; chưa xác nhận mọi loại event/window.                                                          |
| Đã đo ranking trên impression log thật chưa?  | Chưa tìm thấy report/log đánh giá thật cho tiêu chí này trong `docs/recommendation`.                                                                | **Chưa có cơ sở kết luận `coBehavior` xếp hạng tốt hơn baseline hoặc giúp LambdaRank.**                                 |
| Dữ liệu synthetic chứng minh được gì?         | Evaluator tổng hợp dưới đây chạy feature production và baseline trên cùng requests. Dataset AI hiện có schema v2, adapter production gửi schema v3. | Chỉ kiểm tra hành vi dưới giả định simulator và khả năng tái lập phép đo; không chứng minh hiệu quả với người mua thật. |

Dataset AI synthetic hiện có khai báo `featureSchemaVersion = ranking-features-v2` trong [manifest](../../../services/ai-service/data/ranking-synthetic/synthetic-catalog-500-1000u-5000s-seed42/manifest.json), trong khi adapter gửi `ranking-features-v3`. Không dùng row v2 để đại diện cho feature vector do code hiện tại tạo nếu chưa sinh lại/replay feature. Dù được sinh lại, kết quả vẫn chỉ kiểm tra giả định của simulator. Unit specs đã chạy như ghi ở trên xác nhận code path, không đo ranking.

### Phép đo synthetic có thể chạy lại

Script [`evaluate-criterion-4-cobehavior.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-4-cobehavior.ts) chấm trực tiếp `coBehavior` bằng `RankingFeatureService` hiện hành. Từ cùng 8 seed, mỗi lần sinh 600 basket huấn luyện, 80 request validation, 100 request test; catalog có 152 sản phẩm, mỗi request có 2 anchor và cùng 150 ứng viên cho tất cả phương pháp. Basket train nằm trong ngày 0–60; validation ở ngày 61–81 và test ở ngày 81–101. Script kiểm tra mọi basket được dùng xảy ra trước cutoff của từng request. Dữ liệu relation được tổng hợp train-only; baseline cosine dùng vector đồng xuất hiện binary trên basket positive, còn confidence/lift chỉ dùng order mua thành công, không tính order return.

Nhãn binary độc lập với score của mọi phương pháp: simulator lấy bundle ẩn làm intent, rồi sinh click với xác suất 0,42 cho item cùng bundle, 0,12 cho item hub phổ biến và 0,006 cho item ở bundle khác. Đây là giả định tạo tín hiệu kiểm soát, không phải log impression; kết quả tương tác được sinh cho toàn candidate pool. Metric là macro `NDCG@10` trên mọi request (request không có positive nhận 0), macro `Recall@10` chỉ trên request có positive; tie-break dựa hash ổn định theo request-item rồi product ID nên không phụ thuộc thứ tự candidate đầu vào. Báo cáo `mean ± sample SD` qua seed, không phải confidence interval.

Scale production mặc định được giữ riêng; một multiplier chung cho ba relation scale được chọn trong `{0,5; 0,75; 1; 1,5; 2}` bằng validation NDCG@10 từng seed. Test chỉ được chấm sau khi chọn và không dùng để chỉnh scale. Các baseline giữ nguyên định nghĩa, không tune trên test. Thí nghiệm là feature-only có candidate pool cố định; không huấn luyện AI/LambdaRank và không đo tác động lên exposure hay doanh thu.

Chạy từ thư mục service:

```powershell
npm run recommendation:criterion-4-cobehavior-evaluate
```

Lệnh trên chạy từ thư mục gốc repository và tự build trước khi đo. Có thể chạy cả sáu evaluator từ tiêu chí 3 đến 8 bằng `npm run recommendation:criteria-3-8-evaluate`.

```powershell
npm run build
node dist/services/recommendation-service/src/scripts/evaluate-criterion-4-cobehavior.js
```

Kết quả lần chạy hiện tại:

| Phương pháp                             | Validation NDCG@10 |    Test NDCG@10 |  Test Recall@10 | Độ phủ score ứng viên |  Độ phủ request |
| --------------------------------------- | -----------------: | --------------: | --------------: | --------------------: | --------------: |
| `coBehavior` production, scale mặc định |    0,5563 ± 0,0292 | 0,5500 ± 0,0170 | 0,6980 ± 0,0257 |       0,1301 ± 0,0058 | 1,0000 ± 0,0000 |
| `coBehavior`, scale chọn validation     |    0,5563 ± 0,0292 | 0,5500 ± 0,0170 | 0,6980 ± 0,0257 |       0,1301 ± 0,0058 | 1,0000 ± 0,0000 |
| Raw weighted co-occurrence              |    0,5409 ± 0,0203 | 0,5488 ± 0,0218 | 0,6983 ± 0,0236 |       0,1301 ± 0,0058 | 1,0000 ± 0,0000 |
| Item-item cosine, train-only            |    0,5603 ± 0,0287 | 0,5596 ± 0,0176 | 0,6984 ± 0,0242 |       0,1301 ± 0,0058 | 1,0000 ± 0,0000 |
| Purchase confidence, train-only         |    0,4752 ± 0,0236 | 0,4886 ± 0,0211 | 0,6112 ± 0,0179 |       0,0612 ± 0,0047 | 0,9850 ± 0,0298 |
| Purchase lift, train-only               |    0,4927 ± 0,0252 | 0,5019 ± 0,0149 | 0,6159 ± 0,0179 |       0,0612 ± 0,0047 | 0,9850 ± 0,0298 |

Trong 8 seed, bộ chọn validation giữ multiplier mặc định `1` ở cả 8 seed; trên simulator này chưa có lý do đổi scale. `coBehavior` đạt NDCG@10 test cao hơn raw weighted co-occurrence một chút, nhưng thấp hơn item-item cosine; Recall@10 gần như bằng nhau giữa hai phương pháp đầu. Chênh lệch nhỏ và độ lệch chuẩn qua seed chồng lấn; đây không phải kiểm định ý nghĩa thống kê. Vì vậy kết quả chỉ nói công thức có hành vi hợp lý trong simulator đã định nghĩa, chưa đủ để gọi công thức tối ưu hoặc tốt hơn baseline cho người dùng thật. Xếp hạng khác nhau cũng phụ thuộc nhãn giả định: simulator sinh nhãn từ cùng latent bundle intent, không từ kết quả quan sát thực tế.

## 6. Khi nào mới kết luận công thức tốt?

1. **Đúng phép tính:** golden/boundary tests khớp formula, scale và quy tắc max; chi tiết về event windows, duplicate và decay được test đúng như code thực thi.
2. **Có cơ sở so sánh:** production transform được so trên cùng request/candidate/label với raw co-occurrence và item-item cosine; purchase-only thêm confidence/lift. Các baseline được dựng chỉ từ train history.
3. **Có đóng góp cho AI model:** LambdaRank đủ feature cải thiện test so với model bỏ riêng `coBehavior`, cùng candidate rows và cùng config; chênh lệch có khoảng tin cậy và không chỉ do một nhóm session.
4. **Không dùng dữ liệu test để chọn:** mọi scale/half-life/weight được chọn ở validation; test giữ nguyên đến lần báo cáo cuối.
5. **Giới hạn được công khai:** nếu chỉ có synthetic hoặc click logs thiếu impressions thì kết luận đúng phạm vi dữ liệu đó, không nói đã chứng minh hiệu quả người dùng thật.

## 7. Câu trả lời ngắn trước giảng viên

> “Em kiểm tra công thức ở ba mức: chứng minh đại số cho phép đổi điểm `s/(s+k)`; golden test xác nhận code lọc source, scale và lấy relation mạnh nhất; rồi đo hiệu quả trên các sản phẩm thật sự được hiển thị. Baseline em chọn là raw co-occurrence và item-item cosine; với đơn hàng em bổ sung confidence/lift. Cuối cùng em so model có và bỏ riêng feature này trên cùng candidate pool, chia dữ liệu theo thời gian và dùng NDCG@10/Recall@10. Hiện em chưa có kết quả log thật để nói công thức xếp hạng tốt hơn. Em cũng cần làm rõ decay hiện tại áp dụng trên tổng theo lần cập nhật mới nhất, không phải từng event riêng.”

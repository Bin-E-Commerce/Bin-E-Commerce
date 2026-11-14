# Kiểm chứng tiêu chí 7 — Chất lượng và tồn kho (`quality`)

> **Phạm vi:** đối chiếu công thức với triển khai, ghi các ca kiểm tra tái lập được, rồi xác định bằng chứng nào mới cho phép kết luận feature giúp LambdaRank. Tính đúng phép tính và hiệu quả ranking là hai câu hỏi khác nhau.

## 1. Đường đi dữ liệu và code

| Bước                  | Vị trí                                                                                                                                                                                                                                                                                         | Hành vi                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catalog snapshot      | [`catalog-product.type.ts`](../../../services/recommendation-service/src/modules/catalog/application/types/catalog-product.type.ts), [`catalog-product.repository.ts`](../../../services/recommendation-service/src/modules/catalog/infrastructure/repositories/catalog-product.repository.ts) | Read model mang `ratingAvg: string \| null`, `reviewCount: number`, `isInStock: boolean`.                                                                                |
| Eligibility candidate | [`catalog-product.repository.ts`](../../../services/recommendation-service/src/modules/catalog/infrastructure/repositories/catalog-product.repository.ts)                                                                                                                                      | `findAvailable`, `findOrdered` và `findByIds` chỉ lấy sản phẩm `ACTIVE` và `isInStock=true`. Semantic candidate và relation candidate cũng được hydrate qua `findByIds`. |
| Tính feature          | [`ranking-feature.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts)                                                                                                                           | `qualityScore()` chuẩn hóa rating, chuẩn hóa log review count rồi tính `0.55×rating + 0.25×reviews + 0.20×stock`, sau đó clamp.                                          |
| Đưa vào model         | [`recommendation-ml-ranking.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts)                                                                                                             | `quality` là một cột trong feature vector của LambdaRank; không phải điểm xếp hạng cuối.                                                                                 |
| Unit spec             | [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts)                                                                                                                 | Có ca cực đại và các ca `reviewCount` NaN/±Infinity; count lỗi được đưa riêng về 0, không làm mất điểm rating/stock hợp lệ.                                              |

## 2. Đối chiếu phép tính bằng ca golden

Với cùng code hiện tại, các kết quả kỳ vọng là:

|          Rating | Reviews | Còn hàng | Tính tay                                | `quality` |
| --------------: | ------: | -------- | --------------------------------------- | --------: |
|             5.0 |     100 | Có       | `0.55×1 + 0.25×1 + 0.20`                |  `1.0000` |
|             4.5 |      25 | Có       | `0.55×0.9 + 0.25×ln(26)/ln(101) + 0.20` | `≈0.8715` |
|             5.0 |       0 | Có       | `0.55×1 + 0 + 0.20`                     |  `0.7500` |
| Không có rating |       0 | Có       | `0 + 0 + 0.20`                          |  `0.2000` |
|             5.0 |     100 | Không    | `0.55×1 + 0.25×1 + 0`                   |  `0.8000` |

Hàng cuối kiểm tra hành vi hàm với fixture hết hàng; theo truy vấn candidate hiện tại, loại sản phẩm này không nên đi đến ranker.

**Độ phủ test hiện có:** spec xác nhận ca cực đại `1.0`, golden case `4.5` sao/25 review và ba ca count không hữu hạn; chưa đủ xác nhận toàn miền hoặc công thức thay thế. Còn nên thêm assertion cho rating null/0/ngoài miền, review `0/1/>100` và negative count; kiểm tra tính đơn điệu; nếu giữ stock trong scorer, test stock bật/tắt. Nếu chuyển stock thành eligibility-only thì test đó thuộc repository/candidate policy.

> **Kết quả chạy test (11/11/2026):** `ranking-feature.service.spec.ts` đạt **41/41 test**; toàn bộ recommendation-service đạt **23 suite, 115/115 test**. Các test mới xác nhận golden formula và count NaN/±Infinity không xóa tín hiệu rating/stock hợp lệ; chúng chưa chứng minh hệ số quality tối ưu hoặc feature cải thiện ranking.

### Vấn đề code cần xử lý trước khi gọi đây là tiêu chí hiệu quả

- Các candidate source đang lọc `ACTIVE` và còn hàng. Do vậy `isInStock` trong `qualityScore()` thường bằng 1 cho mọi item của một request; phần `+0.20` là hằng số và không phân biệt các sản phẩm trong ranking. Tồn kho đang được xử lý đúng vai trò hơn ở eligibility query; nên bỏ stock ra khỏi `quality` hoặc chứng minh có đường candidate hết hàng cần được xếp hạng.
- `reviewCount` được cộng trực tiếp như điểm tích cực. Nó vừa có thể bù cho rating thấp, vừa tương quan với popularity; tên “độ tin cậy review” trong UI dễ khiến người đọc hiểu nhầm rằng code đang tính độ bất định. Code không tính confidence interval hay posterior rating.
- Đã sửa ca `reviewCount` NaN/±Infinity: count lỗi được quy về 0 riêng, nên rating/stock hợp lệ không bị mất. Unit tests mới bảo vệ ba giá trị này. Rating vẫn cần boundary tests riêng cho dữ liệu ngoài miền.
- Ngưỡng 100 và trọng số 55/25/20 không được chọn từ paper đã trích. Chúng là heuristic hiện hành, cần kiểm tra độ nhạy trên validation.

## 3. Baseline và thiết kế đánh giá

### Câu hỏi A — feature quality đứng riêng xếp theo nhãn như thế nào?

Trên cùng request, candidate pool đã hiển thị và outcome, so ít nhất:

1. `ProjectQuality`: sort theo feature `quality` hiện tại.
2. `MeanRating`: sort theo `ratingAvg` tại thời điểm request, không dùng rating hiện tại cho request cũ.
3. `ReviewCountOnly`: sort theo count tại thời điểm request để kiểm tra liệu phần count riêng đang hoạt động như popularity.
4. `EmpiricalBayesRating`: sort theo công thức shrinkage ở tài liệu 01, với prior chỉ fit từ train; chỉ làm khi snapshot và prior có sẵn.
5. `WilsonLowerBound`: có thể chạy nếu dữ liệu rating lưu `positiveCount`/`totalCount`; không dựng tỷ lệ tích cực từ mean star rating.

Các phương pháp phải nhận đúng cùng tập candidate. Nếu một baseline loại sản phẩm chưa có review nhưng phương pháp khác giữ lại, cần báo riêng coverage và nêu rõ policy.

### Câu hỏi B — quality có đóng góp cho model AI không?

Train cùng một LambdaRank cấu hình trên cùng train/validation requests, rồi đo trên cùng test requests:

- model đầy đủ có `quality`;
- model train lại sau khi bỏ riêng `quality`;
- ghi `featureOnly.quality` để xem chỉ feature quality xếp riêng ra sao.

Trong trainer hiện có, phần `featureOnly` tính metric từng cột và phần `withoutFeature` huấn luyện lại mô hình khi bỏ từng feature. Khi đã có dataset impression thật theo contract, lệnh từ `services/ai-service` là:

```powershell
npm run ranking-train -- --dataset-dir data/ranking-real/quality-evaluation-v1 --output artifacts/development/quality-evaluation-v1.txt --version quality-evaluation-v1 --seed 42
```

Lệnh chỉ hợp lệ khi thư mục dataset có `manifest.json`, `train.jsonl`, `validation.jsonl`, `test.jsonl`, feature schema v3, request groups nguyên vẹn và split thời gian hợp lệ. Dataset synthetic sẵn có **không** biến thành dữ liệu thật chỉ vì dùng cùng lệnh.

Evaluator synthetic riêng cho feature này có thể chạy từ thư mục gốc bằng `npm run recommendation:criterion-7-quality-evaluate`. Để chạy toàn bộ evaluator tiêu chí 3–8, dùng `npm run recommendation:criteria-3-8-evaluate`.

### Nhãn và metric

- Dùng impression thật: candidate phải được hiển thị; item chưa hiển thị không được tự gán là negative.
- Chốt outcome trước khi chạy, ví dụ click hoặc add-to-cart/mua trong cửa sổ đã định. Nếu nhiều outcome, báo từng outcome hoặc định nghĩa graded relevance từ trước.
- Dùng `NDCG@10` làm metric ranking chính và `Recall@10` bổ trợ. NDCG phạt item relevant nằm thấp; Recall đo tỷ lệ relevant được lấy vào top 10. Cũng báo số request, positive rate, candidate/query, và coverage.
- Tách train/validation/test theo thời gian; mọi `ratingAvg`, `reviewCount`, global prior và event count của request `t` chỉ được dựng từ dữ liệu có trước hoặc bằng `t`. Tune hệ số/prior trên validation, khóa lựa chọn trước test.
- Báo chênh lệch metric giữa full/ablation và khoảng tin cậy paired bootstrap theo request hoặc user. Nếu log do ranker cũ sinh, nêu exposure/position bias; offline NDCG không phải bằng chứng nhân quả về tăng doanh thu.
- Đánh giá định nghĩa “chất lượng” riêng nếu cần: so rating snapshot với rating/review outcome tương lai hoặc tỷ lệ hoàn trả/khiếu nại theo một protocol được chốt trước. Không thay nhãn ranking bằng `ratingAvg` hiện tại mà quên thời gian.

Nguồn metric: Järvelin & Kekäläinen định nghĩa discounted cumulative gain để xét cả relevance và vị trí trong thứ hạng; nghiên cứu không tuyên bố ngưỡng tăng metric nào là đủ cho hệ thống này. [“Cumulated gain-based evaluation of IR techniques”, ACM TOIS (2002)](https://doi.org/10.1145/582415.582418).

## 4. Giới hạn của simulator ranking có sẵn

`RankingSimulationService.hiddenUtility()` dùng chính `ratingAvg/5` với trọng số 0.16 để sinh utility; utility sau đó sinh click/cart/purchase label. Vì nhãn tổng hợp đã gắn rating vào quy tắc sinh, đo `quality` hoặc model trên các label này sẽ phản ánh giả định của simulator. Nó không độc lập với thành phần rating của feature. Review count và stock không được đưa vào hidden utility, nhưng đó cũng không chứng minh chúng vô dụng ngoài đời.

Chỉ dùng simulator để xác nhận pipeline/schema hoặc minh họa một giả định được khai báo. Không báo NDCG synthetic là bằng chứng model tốt với khách mua thật, không dùng để chọn hệ số “tối ưu” cho luận văn.

## 5. Phép đo synthetic riêng cho feature quality

Đã thêm evaluator tái lập tại [`evaluate-criterion-7-quality.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-7-quality.ts). Script gọi `RankingFeatureService.build()` thật để lấy điểm `quality` hiện tại; không sửa công thức production, không huấn luyện model và không gọi dịch vụ ngoài.

### Thiết kế

- Chạy 20 seed cố định (`101–120`), mỗi seed có 160 sản phẩm và 400 request theo ngày. Mỗi request có 80 candidate lấy mẫu không lặp.
- Chia request theo thời gian: 240 train, 80 validation, 80 test. Train chỉ dùng để ước lượng rating prior; validation chọn pseudo-count `m` trong `{1, 2, 5, 10, 20, 50, 100}` theo NDCG@10; test chỉ dùng một lần sau khi đã khóa `m`.
- Rating được sinh thành các review 1–5 sao có timestamp. Tại từng request, snapshot chỉ chứa review có `occurredAt ≤ requestAt`; do đó rating trung bình, số review và số đánh giá tích cực không nhìn thấy review tương lai.
- Nhãn liên quan là click nhị phân được lấy bằng RNG riêng từ xác suất dựa trên chất lượng tiềm ẩn của sản phẩm. Nhãn không được sao chép từ `quality`, rating trung bình, số review hay điểm của baseline. Rating và click vẫn có chung nguyên nhân tiềm ẩn theo giả định mô phỏng; đây không phải log người dùng độc lập.
- Mỗi phương pháp nhận cùng request, candidate pool, snapshot rating và nhãn. Hòa điểm được xử lý ổn định theo request/sản phẩm, không phụ thuộc thứ tự candidate đầu vào.
- Baseline: điểm `quality` production, trung bình rating thô, Bayesian average (normal-normal shrinkage) với prior từ train và `m` tune trên validation, cùng Wilson lower bound 95% từ số rating 4–5 sao / tổng rating. Wilson khả thi ở đây vì bộ synthetic có từng sự kiện rating; schema production hiện chỉ có `ratingAvg` và `reviewCount`, chưa đủ tính số đếm tích cực chính xác.
- Metric là binary relevance. NDCG@10 được tính từng request rồi lấy trung bình macro trên **mọi** request (request không có click nhận NDCG 0). Recall@10 cũng tính theo request, rồi lấy trung bình macro trên các request có ít nhất một click. Báo coverage request có positive và coverage candidate đã có rating.
- Bảng dưới báo trung bình, độ lệch chuẩn mẫu và min–max của 20 điểm test theo seed. Mỗi điểm seed là macro metric trên 80 request test; JSON cuối output script giữ metric từng seed, số request và coverage.

### Kết quả chạy lại được

Lệnh chạy từ thư mục recommendation-service:

```powershell
npm run build
node dist/services/recommendation-service/src/scripts/evaluate-criterion-7-quality.js
```

Kết quả chạy ngày 11/11/2026:

| Phương pháp               |   NDCG@10 trung bình ± SD [min, max] | Recall@10 trung bình ± SD [min, max] | Request có positive | Candidate có rating |
| ------------------------- | -----------------------------------: | -----------------------------------: | ------------------: | ------------------: |
| Điểm `quality` production |     0.2093 ± 0.0141 [0.1851, 0.2437] |     0.1652 ± 0.0085 [0.1508, 0.1824] |              100.0% |              89.92% |
| Trung bình rating         |     0.2072 ± 0.0160 [0.1872, 0.2357] |     0.1668 ± 0.0123 [0.1425, 0.1915] |              100.0% |              89.92% |
| Bayesian average          | **0.2106 ± 0.0109 [0.1866, 0.2350]** | **0.1678 ± 0.0099 [0.1475, 0.1848]** |              100.0% |              89.92% |
| Wilson lower bound 95%    |     0.2091 ± 0.0146 [0.1872, 0.2396] |     0.1657 ± 0.0078 [0.1470, 0.1819] |              100.0% |              89.92% |

Prior strength Bayesian average được chọn riêng trong mỗi seed chỉ bằng validation; 20 giá trị được chọn nằm trong `{1, 5, 10, 20, 50, 100}`, trung bình `m=33.90`. Trên mô phỏng này, Bayesian average có metric trung bình cao nhất; chênh lệch so với `quality` nhỏ (NDCG +0.00130, Recall +0.00259). Kết quả **không** chứng minh Bayesian average hoặc công thức production tốt hơn có ý nghĩa thống kê, cũng không chứng minh kết quả với khách hàng thật.

Để so trực tiếp trên cùng seed, evaluator còn tính chênh lệch `baseline − Project quality` theo từng seed và bootstrap paired các seed 10.000 lần (có hoàn lại, seed bootstrap cố định `0x7c51a39d`). Khoảng là percentile 2.5–97.5% của trung bình chênh lệch:

| Baseline − Project quality | Δ NDCG@10 trung bình [CI 95%] | Δ Recall@10 trung bình [CI 95%] |
| -------------------------- | ----------------------------: | ------------------------------: |
| Trung bình rating          |  -0.00212 [-0.00819, 0.00396] |    +0.00163 [-0.00298, 0.00619] |
| Bayesian average           |  +0.00130 [-0.00221, 0.00444] |    +0.00259 [+0.00005, 0.00531] |
| Wilson lower bound 95%     |  -0.00026 [-0.00333, 0.00283] |    +0.00046 [-0.00180, 0.00262] |

Trong giả định synthetic này, CI paired cho NDCG của cả ba baseline chứa 0; CI paired Recall của Bayesian average chỉ nhỉnh hơn 0 một lượng nhỏ. Đây là độ bất định qua **20 seed của generator**, không phải CI qua người dùng/cửa hàng thật và không loại bỏ sai lệch do giả định sinh dữ liệu. JSON của script giữ Δ của từng seed để kiểm tra từng cặp.

### Cách diễn giải đúng

Phép đo trả lời một câu hỏi hẹp: “Nếu rating noisy được sinh quanh một chất lượng tiềm ẩn, còn click có xác suất tăng theo cùng chất lượng tiềm ẩn, các cách xếp hạng rating này hoạt động ra sao trên request tổng hợp về sau?” Kết quả cho thấy Bayesian shrinkage là baseline đáng so tiếp; nó chưa chứng minh hệ số `0.55/0.25/0.20`, ngưỡng `100`, hoặc công thức nào là tối ưu.

Đây vẫn là synthetic data: mọi candidate được giả định có cơ hội hiển thị như nhau; toàn bộ sản phẩm còn hàng; sự kiện click độc lập theo request nhưng có xác suất theo latent quality; latent quality là giả định do evaluator đặt ra chứ không phải nhãn quan sát. Không có exposure/position bias, người dùng thật, hoàn trả, hay purchase. Vì vậy kết quả chỉ kiểm tra được phép chạy và hành vi dưới giả định generator. Nó không thay thế protocol impression thật ở phần tiếp theo.

### Kiểm tra và giới hạn triển khai

- Full `npm run build` đạt (`nest build && tsc-alias -p tsconfig.build.json`); script đã chạy từ output build bằng lệnh ở trên.
- Source production `qualityScore()` vẫn giữ công thức hiện tại. Không có thay đổi ở formula, schema, API hay model.
- Tồn kho là hằng số trong pool evaluator, khớp production retrieval đang chỉ cho candidate active/còn hàng. Điều này củng cố kết luận `+0.20` không phân biệt item trong pool hiện tại.
- `reviewCount` trong công thức production được cộng như một tín hiệu điểm dương, không phải confidence correction; Bayesian average chỉ được so làm baseline trong script. Wilson cũng chỉ có thể so vì evaluator lưu từng rating event; chưa thể tính từ hai trường production hiện hữu.
- Build không xác nhận hết các boundary case của công thức; giữ yêu cầu unit boundary tests đã nêu ở phần 2.

## 6. Trạng thái bằng chứng

| Mệnh đề                                                                                     | Bằng chứng hiện có                                                           | Kết luận được phép                                                                              |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Công thức hiện tại bị chặn trong `[0,1]` và tăng theo rating/count trong miền không bão hòa | Suy ra trực tiếp bằng đại số; unit spec có ca cực đại                        | Có thể chứng minh tính chất toán học của định nghĩa.                                            |
| Code khớp mọi ca của công thức                                                              | Chưa có boundary spec đủ rộng; có một ca cực đại                             | Chỉ xác nhận ca đã test sau khi chạy test; chưa bao phủ mọi đầu vào.                            |
| Stock giúp phân biệt candidate                                                              | Candidate query đang lọc active/stock trước ranker                           | Với pool hiện tại, thành phần stock dự kiến là hằng số; không phải bằng chứng xếp hạng hữu ích. |
| Nghiên cứu chứng minh hệ số 55/25/20 hoặc ngưỡng 100                                        | Không có                                                                     | Không được kết luận.                                                                            |
| Xếp hạng synthetic theo giả định generator                                                  | 20 seed, 80 request test/seed; macro NDCG/Recall và baseline trong bảng trên | Bayesian average nhỉnh hơn trong mô phỏng; không kết luận tối ưu hoặc hiệu quả thực tế.         |
| Quality cải thiện ranking thật                                                              | Chưa có kết quả test trên impression log thật và snapshot lịch sử            | **Chưa kết luận được.**                                                                         |

### Câu trả lời ngắn trước giảng viên

> “Em kiểm tra riêng định nghĩa toán học và hiệu quả. Công thức hiện tại là tổng có trọng số của rating, log số lượt đánh giá và trạng thái còn hàng; có thể chứng minh điểm thuộc 0–1 và đơn điệu theo rating/count trong miền hoạt động. Tuy nhiên, các hệ số là heuristic dự án chứ bài báo không chứng minh chúng tối ưu. Hơn nữa, candidate đã được lọc còn hàng nên stock không phân biệt item. Em sẽ đánh giá rating trung bình hiện tại, baseline shrinkage và feature của em trên cùng impression log chia theo thời gian, rồi so LambdaRank đầy đủ với model bỏ riêng quality bằng NDCG@10/Recall@10. Hiện chưa có log thật nên em chưa kết luận quality tốt hơn.”

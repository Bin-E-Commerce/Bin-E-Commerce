# Tiêu chí 8 — Kiểm chứng code và xếp hạng (`exploration`)

> **Phạm vi:** xác nhận code tạo cờ `exploration` đúng công thức, nêu giới hạn của feature trong LambdaRank và xác định phép đo phù hợp. Unit test công thức không đồng nghĩa chứng minh chính sách exploration hiệu quả.

## 1. Đường đi từ candidate đến model

| Bước                 | Code                                                                                                                                                                                                    | Hành vi hiện tại                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chọn nguồn candidate | [`candidate-generation.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/candidates/generation/candidate-generation.service.ts)                     | Chỉ thêm source `BEST_SELLING`, `NEWEST` và `EXPLORE` khi strategy là `COLD_START`. Các nguồn khác chạy theo request bình thường.                                                   |
| Tạo list `NEWEST`    | [`catalog-product.repository.ts`](../../../services/recommendation-service/src/modules/catalog/infrastructure/repositories/catalog-product.repository.ts)                                               | Sắp `created_at DESC`, tie-break bằng `product_id ASC`; chỉ sản phẩm active/còn hàng và không bị loại trừ.                                                                          |
| Tạo list `EXPLORE`   | Cùng repository                                                                                                                                                                                         | `findExplore` gọi `findOrdered('product.product_id', 'ASC', ...)`; đây là thứ tự ổn định theo ID, không bốc ngẫu nhiên và không tối đa hóa bất định.                                |
| Tính cờ feature      | [`ranking-feature.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts)                                    | `explorationScore()` trả 0 nếu `profileAffinity > 0.4`; nếu không, trả 1 khi `candidate.sources` có `EXPLORE` hoặc `NEWEST`, ngược lại 0.                                           |
| Tạo vector gửi AI    | [`recommendation-ml-ranking.service.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts)                      | `exploration` là cột thứ 8 trong vector 9 feature; model trả raw relevance score cuối cùng.                                                                                         |
| Huấn luyện           | [`lightgbm_trainer.py`](../../../services/ai-service/app/modules/ranking/infrastructure/training/lightgbm_trainer.py), [`models.py`](../../../services/ai-service/app/modules/ranking/domain/models.py) | Chỉ `profileAffinity` bị ràng buộc đơn điệu tăng và `negativePenalty` giảm. `exploration` không có monotone constraint; model có thể học tác động dương, âm hoặc không có tác động. |

**Hệ quả:** feature=1 chỉ báo “candidate này đến từ nguồn mới/khám phá trong khi hồ sơ yếu”. Nó không đảm bảo candidate được chọn, được hiển thị, hay được xếp cao hơn candidate cùng điểm feature=0. Việc ưu tiên cuối do LambdaRank học từ nhãn và các feature khác.

## 2. Đối chiếu công thức với unit test

Test hiện có trong [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts) dựng một candidate có source `EXPLORE`: khi chưa có preference, `exploration=1`; khi thêm preference đủ mạnh khiến `profileAffinity>0.4`, kỳ vọng `exploration=0`.

> **Kết quả chạy test (11/11/2026):** `ranking-feature.service.spec.ts` đạt **41/41 test**; toàn bộ recommendation-service đạt **23 suite, 115/115 test**. Có golden case đúng ngưỡng `profileAffinity=0,4`; test này xác nhận nhánh feature, không đo hiệu quả của chính sách chọn/hiển thị item explore.

Test này kiểm tra hai trường hợp, chưa xác nhận mọi nhánh của công thức. Nên bổ sung ca golden/boundary sau:

| Ca                                                          |             Kết quả kỳ vọng | Trạng thái spec hiện có                         |
| ----------------------------------------------------------- | --------------------------: | ----------------------------------------------- |
| `profileAffinity = 0,4`, source `EXPLORE`                   |                         `1` | Có test đúng ngưỡng.                            |
| `profileAffinity > 0,4`, source `EXPLORE`                   |                         `0` | Có gián tiếp qua preference mạnh.               |
| `profileAffinity < 0,4`, source `NEWEST`                    |                         `1` | Chưa thấy test `NEWEST`.                        |
| `profileAffinity < 0,4`, chỉ source `TRENDING`              |                         `0` | Chưa thấy test source không đủ điều kiện.       |
| Candidate có cả `EXPLORE` và source khác, hồ sơ yếu         |                         `1` | Chưa thấy test hợp nhất source.                 |
| Không có context/preference và không có source mới/khám phá |                         `0` | Chưa thấy ca âm tường minh.                     |
| Feature=1 so với feature=0 trong model                      | Không có bảo đảm chiều tăng | Trainer không đặt constraint cho `exploration`. |

Các ca unit test sẽ xác nhận code khớp indicator. Chúng không chứng minh threshold đúng về nghiệp vụ, cũng không chứng minh một candidate có relevance cao hơn.

## 3. Sai khác giữa feature hiện tại và bandit

Một thuật toán contextual bandit phải có ít nhất chính sách chọn item, reward quan sát được sau impression và cập nhật theo feedback; UCB/LinUCB còn dùng thông tin số lượt thử/độ bất định. Epsilon-greedy phải thật sự dành một xác suất traffic cho random choice. Những thành phần đó chưa xuất hiện trong code path tiêu chí này.

| Năng lực                   | Feature dự án hiện tại                                                                   | Contextual bandit tham chiếu                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Tạo biến thể explore       | `EXPLORE` là query deterministic theo `product_id ASC`; `NEWEST` theo `created_at DESC`. | Policy chọn/randomize candidate theo xác suất hoặc uncertainty.                      |
| Dùng độ không chắc chắn    | Không có estimate confidence/uncertainty.                                                | UCB/LinUCB dùng bonus theo uncertainty; Thompson sampling dùng posterior sampling.   |
| Học từ reward sau khi chọn | Cờ được tính trước response; không tự cập nhật policy.                                   | Click/reward sau action cập nhật model/chính sách theo thiết kế thuật toán.          |
| Kiểm soát mức exploration  | Một cutoff cứng `0,4`.                                                                   | Tham số policy như `ε`/`α` cùng objective và horizon.                                |
| Đảm bảo rank boost         | Không; feature không có monotone constraint.                                             | Policy trực tiếp chọn action, nhưng vẫn cần kiểm tra reward/user cost theo protocol. |

Nghiên cứu Li et al. (WWW 2010) mô tả contextual-bandit news recommendation, random exploration traffic, feedback cập nhật và offline evaluation bằng random traffic; UCB1/ε-greedy được nêu như chính sách lựa chọn. Bài Schnabel et al. (WSDM 2018) thử nghiệm nhiều mức mix-in exploration với hơn 600 người và đo satisfaction/feedback, cho thấy exploration có cả lợi ích thu thập thông tin lẫn chi phí trải nghiệm. Kết quả của họ là cơ sở chọn protocol, không phải hiệu quả của feature hiện tại. [Li et al.](https://doi.org/10.1145/1772690.1772758), [Schnabel et al.](https://doi.org/10.1145/3159652.3159700).

## 4. Không dùng simulator hiện tại để chứng minh tiêu chí

`RankingSimulationService.toCandidate()` hiện gắn source `EXPLORE` vào **mọi** synthetic candidate. Vì vậy, với candidate có `profileAffinity ≤ 0,4`, cột `exploration` thường bật cho cả nhóm, không tạo khác biệt giữa candidate explore và non-explore.

Nhãn synthetic được sinh trong `hiddenUtility()` từ `categoryFit`, `brandFit`, `priceFit`, `rating`, `popularity`, `positionBias` và noise. Nó không có một thành phần reward riêng cho source `EXPLORE`, “độ mới được khám phá”, hay lượng thông tin thu được sau khi thử item. Tuy nhiên `categoryFit`/`brandFit` có thể tương quan với `profileAffinity`, và `positionBias` ảnh hưởng outcome theo vị trí candidate. Do đó metric synthetic vừa không đánh giá hiệu quả của exploration policy, vừa có các tương quan/thiên lệch do simulator tạo ra.

Chỉ dùng dataset này để xác nhận schema, pipeline và khả năng tính feature. Không trích NDCG/Recall từ dataset synthetic làm bằng chứng rằng tiêu chí khám phá tốt cho người mua.

## 5. Đo hai câu hỏi tách biệt

### 5.1. Cờ hiện tại có giúp LambdaRank không?

Phép ablation offline trả lời câu hỏi hẹp hơn: feature có giúp dự đoán thứ tự click/mua trên các request đã được hiển thị không?

1. Cần impression log chứa `requestId`, user/session, timestamp, item thực sự hiển thị, vị trí, nguồn `NEWEST`/`EXPLORE`, `profileAffinity` và feature snapshot đúng lúc chấm; outcome sau impression và cửa sổ quy kết cũng phải được định nghĩa trước.
2. Chia train/validation/test theo thời gian. Mọi context/feature tại request `t` chỉ dùng dữ liệu đã có trước hoặc tại `t`; không dựng hồ sơ từ event tương lai.
3. Giữ nguyên request, candidate pool, nhãn, seed và cấu hình model. Train LambdaRank đầy đủ feature và LambdaRank ablation loại `exploration`; chọn hyperparameter chỉ trên validation.
4. Đánh giá một lần trên test bằng `NDCG@10` chính và `Recall@10` bổ trợ. Báo số request có đủ positive, chênh lệch paired theo request/user và confidence interval bootstrap.
5. Kết quả này chỉ nói feature cải thiện **xếp hạng theo outcome đã quan sát dưới policy cũ**. Nó không chứng minh cờ tạo ra exploration, khám phá sở thích mới, giảm popularity bias hoặc tăng lợi ích dài hạn.

### 5.2. Một policy exploration thật có hiệu quả không?

Nếu mục tiêu là chọn giữa greedy và một policy exploration, cần thí nghiệm policy riêng:

- **Baseline:** greedy LambdaRank không exploration; epsilon-greedy với các `ε` xác định trước; hoặc LinUCB nếu log đủ context/reward và giả định tuyến tính được bảo vệ.
- **Dữ liệu/log bắt buộc:** eligible candidate set, context tại request, item thực sự chọn/hiển thị, vị trí, policy/version, xác suất chọn (propensity), reward sau impression, timestamp và feedback window. Log hiện có source/rank attribution nhưng không ghi propensity của một random/bandit action.
- **Offline:** nếu có traffic được random hóa và propensity hợp lệ, dùng replay hoặc inverse-propensity weighting với giả định được nêu; không giả vờ rằng log của chính sách deterministic cho phép unbiased evaluation của item chưa được chọn. Li et al. dùng random traffic để đánh giá offline.
- **Online:** A/B test có kiểm soát, theo dõi click/giỏ/mua cùng satisfaction/complaint, novelty/catalog coverage và lượng feedback có ích. Giữ thời lượng đủ để quan sát reward về sau; khám phá có thể ảnh hưởng mục tiêu dài hạn lẫn trải nghiệm ngắn hạn.
- **An toàn:** chỉ randomize trong candidate đủ điều kiện (active, còn hàng, giá/chính sách hợp lệ); giới hạn tỷ lệ explore và theo dõi nhóm item/catalog/user để không tập trung traffic vô lý.

Không chọn `ε`, `α` hoặc threshold bằng cách xem test nhiều lần. Chọn trên validation hoặc thiết kế A/B trước; khóa policy trước test/experiment.

## 6. Kết luận bằng chứng hiện có

| Mệnh đề                                           | Bằng chứng hiện có                                                                                          | Kết luận có thể nói                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Code trả 0/1 theo ngưỡng và source                | Unit test có một ca bật với EXPLORE và một ca tắt khi hồ sơ mạnh; code dùng indicator đúng như tài liệu 01. | Khớp hai fixture đã test; cần thêm boundary/source tests để tăng coverage. |
| Feature bị chặn trong `[0,1]`                     | Suy ra trực tiếp từ tích hai biến chỉ thị.                                                                  | Có thể chứng minh toán học.                                                |
| Candidate EXPLORE ngẫu nhiên/đại diện uncertainty | Repository sắp theo `product_id ASC`; không có random policy/uncertainty.                                   | Không đúng với code hiện tại.                                              |
| Feature=1 làm model tăng điểm                     | Feature không có monotone constraint, LambdaRank phối hợp các feature.                                      | Không được đảm bảo.                                                        |
| Công thức nâng NDCG/Recall hoặc reward dài hạn    | Chưa có phép đo thật theo protocol trên. Synthetic labels không có exploration reward độc lập.              | **Chưa kết luận được.**                                                    |
| Nghiên cứu đã chứng minh ngưỡng `0,4` tối ưu      | Các nguồn nghiên cứu dùng policy/reward/protocol khác.                                                      | Không được kết luận.                                                       |

### Câu trả lời ngắn trước giảng viên

> “Code hiện tại dùng `exploration` như cờ đầu vào 0/1: chỉ bật nếu hồ sơ chưa vượt `0,4` và candidate đến từ `EXPLORE` hoặc `NEWEST`. Em chứng minh được miền giá trị và các nhánh của indicator, nhưng đây chưa phải contextual bandit: source `EXPLORE` hiện sắp ổn định theo ID, không chọn theo bất định hoặc cập nhật từ reward. Em sẽ kiểm tra code bằng boundary tests; để chứng minh nó cải thiện LambdaRank thì cần ablation trên impression log chia theo thời gian. Nếu muốn chứng minh một chính sách exploration thật, em cần log propensity và so policy như greedy với ε-greedy/LinUCB trên thí nghiệm phù hợp. Hiện em chưa có dữ liệu để nói ngưỡng `0,4` hay công thức này tối ưu.”

## 7. Mô phỏng policy tuần tự (synthetic, không phải đánh giá production)

Để minh họa đúng bài toán exploration/exploitation, script [`evaluate-criterion-8-exploration.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-8-exploration.ts) mô phỏng **chính sách chọn một item mỗi lượt**. Nó không coi cờ `exploration` là một ranker, không thay đổi code chấm điểm production và không dùng NDCG/Recall cho một action đơn lẻ.

### Thiết kế

- Mỗi kịch bản có 16 item, 4 context rời rạc và 2.000 lượt. Context được sinh độc lập, đồng phân phối; các policy không được nhận context khi chọn item.
- Xác suất reward Bernoulli tiềm ẩn được tạo trước khi chạy policy: `p(context,item) = min(0.95, quality(item) + preference(context,item))`. `quality` là một thành phần ngẫu nhiên; `preference` cao hơn nếu danh mục ẩn của item khớp context. Reward không được tạo từ điểm của bất cứ policy nào.
- Mỗi item có chung 20 quan sát warm-up cho cả policy. Sau warm-up so ba cách: greedy khai thác empirical mean; ε-greedy thỉnh thoảng chọn ngẫu nhiên; vanilla UCB1 dùng thống kê arm gộp. UCB1 không nhận context nên đây **không phải contextual UCB hoặc LinUCB**. Cách dùng UCB1 dựa trên giả định reward mỗi arm ổn định dưới hỗn hợp context đồng phân phối, phù hợp với mô hình synthetic của script; đó không phải giả định đã xác nhận cho traffic thật. UCB1 được phân tích cho stochastic multi-armed bandit bởi Auer et al. [nguồn nghiên cứu](https://doi.org/10.1023/A:1013689704352).
- Chọn ε từ `{0,02; 0,05; 0,1; 0,2; 0,3}` trên 20 validation seed (`501–520`); khóa ε rồi đánh giá trên 30 test seed khác (`1001–1030`). Mọi policy trên cùng seed nhận cùng warm-up, context và potential outcomes; policy chỉ cập nhật từ reward của item đã chọn.
- Đo reward trung bình mỗi lượt, pseudo-regret so với item cố định tốt nhất dưới hỗn hợp context, độ phủ item/danh mục trong **2.000 action được đánh giá** (không tính lượt warm-up chung). Báo paired percentile bootstrap 95% CI (2.000 lần lấy mẫu) cho chênh lệch trên cùng test seed. Không dùng NDCG/Recall vì không có slate top-K hay tập relevance độc lập.

### Kết quả lần chạy

Lệnh chạy từ thư mục `services/recommendation-service` sau khi build:

```powershell
npm run recommendation:criterion-8-exploration-evaluate
```

Lệnh trên chạy từ thư mục gốc repository và tự build trước khi mô phỏng. Có thể chạy toàn bộ evaluator tiêu chí 3–8 bằng `npm run recommendation:criteria-3-8-evaluate`.

Chạy thủ công theo từng bước:

```powershell
npm run build
node .\dist\services\recommendation-service\src\scripts\evaluate-criterion-8-exploration.js
```

| Policy synthetic                       | Reward/lượt | Pseudo-regret/lượt | Item duy nhất trung bình (2.000 action) | Phủ catalog | Danh mục duy nhất (2.000 action) |
| -------------------------------------- | ----------: | -----------------: | --------------------------------------: | ----------: | -------------------------------: |
| Greedy, không chủ động random          |  **0,4817** |         **0,0262** |                                    6,47 |      40,42% |                             3,30 |
| ε-greedy (`ε=0,02`, chọn ở validation) |      0,4818 |             0,0238 |                                   15,10 |      94,38% |                             4,00 |
| UCB1 gộp arm                           |      0,4439 |             0,0646 |                                   16,00 |        100% |                             4,00 |

So với greedy, ε-greedy có chênh lệch reward/lượt `0,0000` (paired 95% CI `[-0,0070; 0,0084]`). Chênh lệch giảm pseudo-regret/lượt (`regret_greedy − regret_ε-greedy`) là `0,0024` (CI `[-0,0051; 0,0111]`). Cả hai khoảng đều chứa 0 nên lần chạy này **không cho thấy cải thiện rõ ràng** về reward hoặc regret; ε-greedy tăng độ phủ item trong kịch bản này. UCB1 có reward thấp hơn greedy `−0,0378` (CI `[-0,0483; −0,0276]`) và pseudo-regret cao hơn; trong môi trường và horizon này, chi phí thử nhiều arm làm reward ngắn hạn giảm, dù coverage tăng. Đây là kết quả của cấu hình synthetic cụ thể, không phải bằng chứng rằng greedy tốt hơn trong thương mại điện tử.

### Giới hạn và cách diễn giải

1. **Không có phép so sánh định lượng với feature production.** Feature hiện tại chỉ đi vào LambdaRank; AI model và candidate sources cùng quyết định slate. Gán trực tiếp reward/regret cho cờ 0/1 hoặc đem nó so như một policy sẽ không phản ánh cách phục vụ thật. Vì vậy output ghi `productionComparison.status = unavailable`.
2. Kết quả ở trên chỉ đối chiếu các policy synthetic theo cùng giả định và reward tiềm ẩn. Reward sinh sẵn, không phát sinh từ khách hàng, impression thật hay kết quả của mô hình. Không được diễn giải số liệu như hiệu quả người dùng thật hoặc bằng chứng công thức `exploration` tốt.
3. Bước kiểm chứng production vẫn là ablation LambdaRank trên impression log chia theo thời gian: giữ nguyên request/candidate/nhãn, so model đủ feature với model bỏ `exploration` trên cùng test set. Nếu mục tiêu là kiểm chứng policy tuần tự, cần log action/impression, propensity của lựa chọn, reward sau impression; nguồn nghiên cứu contextual-bandit recommendation dùng phản hồi sau khi chọn và random traffic để đánh giá offline [Li et al.](https://doi.org/10.1145/1772690.1772758). Khi không có propensity hay traffic random, cần thí nghiệm online có kiểm soát.

`npm run build` đã chạy thành công trước lần đo này. Kết quả trên là một lần chạy tái lập được bằng seed cố định; đổi seed/grid/horizon hoặc reward assumptions sẽ cho kết quả khác và phải được báo cáo như một cấu hình mới.

## Tài liệu tham khảo

1. Lihong Li, Wei Chu, John Langford, Robert E. Schapire. 2010. “A Contextual-Bandit Approach to Personalized News Article Recommendation.” WWW 2010, 661–670. [DOI](https://doi.org/10.1145/1772690.1772758), [toàn văn](https://www.schapire.net/papers/www10.pdf).
2. Peter Auer, Nicolò Cesa-Bianchi, Paul Fischer. 2002. “Finite-Time Analysis of the Multiarmed Bandit Problem.” _Machine Learning_, 47, 235–256. [DOI](https://doi.org/10.1023/A:1013689704352).
3. Tobias Schnabel, Paul N. Bennett, Susan T. Dumais, Thorsten Joachims. 2018. “Short-Term Satisfaction and Long-Term Coverage: Understanding How Users Tolerate Algorithmic Exploration.” WSDM 2018. [DOI](https://doi.org/10.1145/3159652.3159700), [toàn văn](https://www.cs.cornell.edu/~tj/publications/schnabel_etal_18a.pdf).
4. Javier Parapar, Filip Radlinski. 2021. “Diverse User Preference Elicitation with Multi-Armed Bandits.” WSDM 2021. [Google Research](https://research.google/pubs/diverse-user-preference-elicitation-with-multi-armed-bandits/).

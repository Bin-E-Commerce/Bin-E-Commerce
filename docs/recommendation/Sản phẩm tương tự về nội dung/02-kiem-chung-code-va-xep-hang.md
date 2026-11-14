# Kiểm chứng tiêu chí 3 — Sản phẩm tương tự về nội dung

> **Phạm vi:** tài liệu này ánh xạ công thức `semanticSimilarity` vào code, liệt kê các phép kiểm tra cần có và quy định phép đo xếp hạng có thể lặp lại. Hiện chưa có kết quả đo semantic riêng trên dữ liệu lịch sử hoặc dữ liệu được gán nhãn; không dùng dữ liệu synthetic để tuyên bố hiệu quả với khách hàng.

## 1. Bản đồ triển khai hiện tại

| Bước                             | Code                                                                                                                                                                                                                                                                                               | Vai trò và nhận xét                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chuẩn hóa content và tạo văn bản | [`SemanticContentService`](../../../services/recommendation-service/src/modules/catalog/application/services/semantic/semantic-content.service.ts)                                                                                                                                                 | Chuẩn hóa Unicode/HTML/whitespace; đưa title, brand, category path, mô tả và thuộc tính vào chuỗi embedding; tạo `contentHash` từ các trường ngữ nghĩa. Giá, tồn kho và trạng thái không làm thay đổi nội dung embedding. |
| Gọi embedding model              | [`ProductEmbeddingProvider`](../../../services/ai-service/app/modules/embeddings/infrastructure/openai_provider.py), [`worker.py`](../../../services/ai-service/app/modules/embeddings/infrastructure/messaging/worker.py)                                                                         | AI service gọi model được cấu hình, mặc định `text-embedding-3-small`; gửi vector qua Kafka. Đây là embedding model có sẵn của provider, không phải semantic encoder được trainer LambdaRank của dự án fine-tune.         |
| Kiểm tra và lưu vector           | [`EmbeddingConsumerService`](../../../services/recommendation-service/src/kafka/consumers/catalog/embedding-consumer.service.ts), [`VectorIndexService`](../../../services/recommendation-service/src/modules/catalog/application/services/vector/vector-index.service.ts)                         | Từ chối model/content hash stale, vector sai chiều hoặc không hữu hạn; Qdrant lưu payload trạng thái, model version và hash. Cấu hình hiện tại trong `.env` và `.env.example` là `Cosine`, 1536 chiều.                    |
| Tạo query centroid               | [`SemanticCandidateService`](../../../services/recommendation-service/src/modules/recommendation/application/services/candidates/sources/semantic-candidate.service.ts)                                                                                                                            | Lấy vector anchor còn mới, tính trung bình có trọng số, chặn centroid toàn 0 trước khi search và gọi vector index với tối đa 60 kết quả. Lỗi/mất Qdrant làm semantic source rỗng để nguồn khác còn chạy.                  |
| Lọc/hydrate ứng viên             | [`CandidateGenerationService`](../../../services/recommendation-service/src/modules/recommendation/application/services/candidates/generation/candidate-generation.service.ts)                                                                                                                     | Lọc ứng viên theo business catalog; chỉ giữ candidate có `contentHash` khớp snapshot hiện hành.                                                                                                                           |
| Tạo feature                      | [`RankingFeatureService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts)                                                                                                                                    | Lọc contribution `SEMANTIC_SIMILARITY`, chặn raw score vào `[0,1]`, lấy score lớn nhất; không dùng score của source khác.                                                                                                 |
| Đưa vào ranker                   | [`RecommendationMlRankingService`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts), [`ranking evaluator`](../../../services/ai-service/app/modules/ranking/infrastructure/training/ranking_evaluator.py) | Feature `semanticSimilarity` nằm trong schema LambdaRank v3 cùng các feature khác. Đây không phải model sinh embedding; AI ranker học cách phối hợp feature từ nhãn huấn luyện.                                           |

Luồng này xác nhận công thức không chỉ là `cosine(product A, product B)`: khi có nhiều anchor, query là centroid có trọng số; sau retrieval, score lại được chặn để thành feature. `SemanticCandidateService` tính centroid; `VectorIndexService.searchSimilarProducts()` gửi vector truy vấn tới Qdrant và nhận score theo metric đã cấu hình (mặc định `Cosine`), chứ không tự tạo weighted embedding. `RankingFeatureService.normalizeSemantic()` chỉ chặn score provider vào `[0,1]`, không dựng centroid. Candidate search và feature score là hai tầng riêng.

## 2. Đối chiếu unit specs đã có

Các unit specs hiện có kiểm tra code path; một benchmark synthetic riêng đã được thêm tại [`evaluate-criterion-3-semantic.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-3-semantic.ts). Xem kết quả và giới hạn tại mục 4.3. Unit specs là kiểm chứng code path, benchmark synthetic không phải phép đo hiệu quả trên người dùng thật.

| Spec                                                                                                                                                                                   | Trường hợp đang bảo vệ                                                                                                                                                                  | Chưa chứng minh                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`semantic-candidate.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/candidates/sources/semantic-candidate.service.spec.ts) | Với vector `[1,0]` trọng số 4 và `[0,1]` trọng số 2, code gửi centroid `[2/3,1/3]` tới Qdrant; negative weight không tạo anchor/search; centroid chính xác bằng 0 thì không gọi search. | Không kiểm tra cosine ranking, chiều không đồng nhất, content hash/model mismatch, filter catalog, hoặc end-to-end score của Qdrant. |
| [`vector-index.service.spec.ts`](../../../services/recommendation-service/src/modules/catalog/application/services/vector/vector-index.service.spec.ts)                                | `Dot`/`Euclid` làm semantic source unavailable; collection active phải là `Cosine`; collection cosine hợp lệ được khởi tạo.                                                             | Chưa kiểm tra mọi lỗi HTTP/collection config; physical và active collection phải giữ đúng contract.                                  |
| [`ranking-feature.service.spec.ts`](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts)         | Score `1,4` bị chặn thành `1`; score âm và score không hữu hạn thành `0`; contribution `TRENDING` bị bỏ qua; nhiều semantic contribution lấy max.                                       | Không kiểm tra cosine score đầu ra end-to-end với Qdrant thật.                                                                       |
| [`semantic-content.service.spec.ts`](../../../services/recommendation-service/src/modules/catalog/application/services/semantic/semantic-content.service.spec.ts)                      | Chuẩn hóa/hash content deterministic, thứ tự thuộc tính không làm đổi hash và thay đổi semantic text làm hash đổi.                                                                      | Không chứng minh nội dung được chọn là đủ để biểu diễn “sản phẩm tương tự” theo đánh giá của người mua.                              |

Các spec trên xác nhận một số bước của code, không phải phép đo chất lượng xếp hạng. Benchmark ở mục 4.3 dùng adapter vector giả lập để chạy phép biến đổi production nhưng không gọi Qdrant thật. Repo có alias `ranking-criterion-3-semantic-evaluate` để build service và chạy evaluator; trong lượt đo này em dùng lệnh `ts-node` trực tiếp nhằm tránh ghi vào `dist` khi các build khác đang chạy.

## 3. Golden cases nên dùng để kiểm tra công thức

Các giá trị dưới đây là ca tính tay để bổ sung/đối chiếu unit tests; không phải kết quả chạy hệ thống hoặc bằng chứng về relevance thực tế.

| Ca                        | Đầu vào                                                  | Kỳ vọng theo công thức                                                                                   | Hiện trạng cần ghi nhận                                                                                                          |
| ------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Một anchor                | `v₁=[1,0]`, `α₁=1`; candidate `[1,0]`, `[0,1]`, `[-1,0]` | Centroid `[1,0]`; cosine lần lượt `1`, `0`, `-1`; feature lần lượt `1`, `0`, `0`.                        | Feature test xác nhận score âm bị clamp về `0`; chưa có retrieval end-to-end.                                                    |
| Centroid 4:2              | Anchor A `[1,0]`, weight 4; B `[0,1]`, weight 2          | `q=[2/3,1/3]`. Cosine với A `2/√5≈0,8944`; với B `1/√5≈0,4472`; với candidate cùng hướng `q`, score `1`. | Spec hiện có kiểm tra centroid `[2/3,1/3]`, nhưng chưa kiểm tra score cosine đầu ra.                                             |
| Cùng vector               | Nhiều anchor đều cùng `v`, trọng số dương bất kỳ         | `q=v`; tăng/giảm đồng loạt mọi trọng số không đổi kết quả.                                               | Nên có tính chất bất biến làm kiểm tra.                                                                                          |
| Không có vector dùng được | Không có anchor, hoặc mọi vector thiếu/stale/sai model   | Không gọi search nếu không có anchor hợp lệ; semantic source rỗng; feature `0`.                          | Một phần được test cho negative weight; chưa bao phủ mọi nguyên nhân không hợp lệ.                                               |
| Score ngoài miền          | Contribution score `1,4`, `-0,3`, `NaN`                  | Feature lần lượt `1`, `0`, `0`.                                                                          | `1,4`, score âm và source filter đã có test; `NaN` trực tiếp chưa có test.                                                       |
| Centroid triệt tiêu       | Hai vector `[1,0]` và `[-1,0]`, trọng số bằng nhau       | `q=[0,0]`; cosine không xác định nên service trả danh sách rỗng và không gọi Qdrant.                     | Đã có guard cho centroid chính xác bằng 0 và unit spec xác nhận search không được gọi; chưa có epsilon guard cho centroid gần 0. |

Guard hiện tại trong `SemanticCandidateService` chỉ loại centroid mà mọi phần tử bằng chính xác 0. Vector gần 0 nhưng khác 0 vẫn được gửi tới cosine search; nhiễu số học có thể làm hướng truy vấn nhạy với sai số. Nếu vector embedding thực tế có hiện tượng triệt tiêu gần hoàn toàn, cần thống kê norm centroid và kiểm thử ngưỡng epsilon trên validation trước khi thêm chính sách mới.

### Rà soát cấu hình metric — vấn đề cần xử lý trước khi khẳng định score

`RankingFeatureService.normalizeSemantic()` coi raw score lớn hơn là similarity tốt hơn rồi chặn vào `[0,1]`. Điều đó đúng với metric `Cosine` mà công thức này định nghĩa, không đúng với mọi metric. Code hiện chỉ bật vector search khi `QDRANT_DISTANCE=Cosine`, đánh dấu `Dot`/`Euclid` unavailable mà không làm dừng recommendation service, đồng thời xác nhận physical collection và collection alias đang phục vụ có dimension/metric khớp. Nếu collection active không phải `Cosine`, semantic source fail-soft thay vì biến distance thành feature similarity.

**Điều kiện để công thức ở tài liệu 01 khớp production:** cấu hình `QDRANT_DISTANCE` (mặc định `Cosine`) và collection active đều phải là `Cosine`; `VectorIndexService` kiểm tra điều kiện này khi khởi tạo. Cấu hình `Dot`/`Euclid` làm semantic vector source fail-soft. Không lấy tên biến `similarityScore` làm bằng chứng rằng mọi metric đều trả cosine similarity. Nếu cần metric khác trong tương lai, phải định nghĩa và kiểm thử phép chuyển score trước khi cho phép đưa nó vào feature.

Qdrant cosine có thể trả score âm. Search hiện không đặt `score_threshold`, vì vậy nếu catalog phù hợp ít hoặc không có, top kết quả vẫn có thể chứa score âm; các score này đều bị `clamp` thành feature `0`. Cần đo xem ngưỡng loại ứng viên thấp có cải thiện precision/coverage hay không; chọn ngưỡng chỉ trên validation.

## 4. Phép đo đề xuất

Đánh giá hai câu hỏi riêng: **các ứng viên lấy được có thực sự tương tự nội dung không?** và **feature này có giúp model AI xếp hạng trên dữ liệu người dùng không?** Không gộp hai kết quả thành một tuyên bố.

### 4.1. Đánh giá retrieval bằng bộ nhãn tương tự nội dung

1. Giảng viên/chuyên gia thống nhất rubric trước khi chấm. Ví dụ: `2` = cùng công dụng, có thể xem là sản phẩm thay thế; `1` = liên quan/đi kèm nhưng không thay thế; `0` = không liên quan hoặc chỉ trùng từ khóa. Nếu đề tài định nghĩa “tương tự” khác, cập nhật rubric trước khi tạo nhãn.
2. Lấy anchor đại diện nhiều danh mục, thương hiệu, độ dài mô tả và mức thiếu metadata. Cho ít nhất hai người chấm độc lập, không cho xem score/model; phân xử các bất đồng. Lấy cả hard negatives như trùng từ nhưng khác công dụng, cùng thương hiệu nhưng khác loại, và sản phẩm bổ trợ.
3. Chạy tất cả phương pháp trên cùng snapshot catalog, cùng tập sản phẩm đủ điều kiện, cùng query/anchor và cùng loại trừ. So:
    - **Production weighted-centroid cosine:** công thức hiện tại.
    - **Single-anchor cosine:** chỉ vector sản phẩm request hiện tại, làm baseline item-to-item content.
    - **Unweighted-centroid cosine:** trung bình đều các anchor, cô lập tác động của trọng số.
    - **TF–IDF cosine:** token hóa cùng các trường nội dung, đặt `tf(t,d)` là số lần term `t` xuất hiện trong văn bản `d`, rồi tính `tf(t,d) × (log((N+1)/(df(t)+1))+1)`; `N` là số sản phẩm trong catalog snapshot và `df(t)` là số sản phẩm có term đó. Chuẩn hóa vector rồi dùng cosine; tính IDF từ snapshot tại thời điểm query để không lấy catalog tương lai. Đây là một biến thể smoothed TF–IDF baseline, không phải công thức semantic của dự án.
4. Báo `NDCG@10` theo nhãn 0/1/2 để đánh giá thứ tự top-10; báo `Recall@60` chỉ khi nhãn gold bao phủ đủ các sản phẩm liên quan của query để đo candidate source top-60. Báo số query, số cặp được chấm, phân bố nhãn, và khoảng tin cậy theo query. Nếu không có nhãn nào liên quan cho query, quy tắc xử lý query đó phải được công bố trước.

Nhãn chuyên gia đo **độ phù hợp theo nội dung**. Chúng không thể thay thế nhãn click/mua; ngược lại, hành vi click/mua chịu ảnh hưởng của vị trí, giá, tồn kho, thương hiệu và thiết kế giao diện, nên cũng không phải nhãn thuần túy về ngữ nghĩa.

### 4.2. Đánh giá ảnh hưởng lên LambdaRank bằng log thật

1. Cần impression log ghi request/session, thời điểm request, danh sách sản phẩm **thực sự hiển thị**, vị trí, product anchors/recent signals/profile IDs trước request, trạng thái eligible, và hành vi xảy ra sau impression. Chọn nhãn (click; hoặc báo riêng add-to-cart/mua) và cửa sổ quy kết trước khi chạy.
2. Cần snapshot catalog/vector đúng thời điểm request: text, `contentHash`, `modelVersion` và vector. Qdrant hiện tra snapshot hiện tại và code bỏ candidate khi hash không còn khớp; không thể mặc định rằng catalog/vector hiện tại tái dựng được dữ liệu lịch sử.
3. Chia theo thời gian thành train, validation và test. Dùng validation để chọn mọi tham số như anchor weights/threshold; test chỉ chạy một lần sau khi khóa cấu hình. Không dùng event xảy ra sau request để dựng anchor hay feature tại thời điểm đó.
4. Đo retrieval source riêng trên cùng query và eligible catalog: production weighted-centroid so với single-anchor, unweighted centroid và TF–IDF; dùng bộ nhãn nội dung đủ bao phủ để tính Recall@60/NDCG@10. Impression log chỉ dùng nhãn hành vi từ sản phẩm đã thực sự được hiển thị; candidate không được hiển thị là **chưa biết nhãn**, không tự gán âm.
5. Đo đóng góp vào ranker riêng: dùng cùng request, cùng candidate pool và cùng nhãn để huấn luyện hai LambdaRank cùng thiết lập/seed: model đủ feature và model ablation đặt `semanticSimilarity=0` nhất quán ở train/validation/test. Đo NDCG@10 làm chính, Recall@10 bổ trợ; báo số request, chênh lệch tuyệt đối, bootstrap confidence interval và các nhóm dữ liệu quan trọng.
6. Nếu lịch sử impression do ranker cũ tạo, báo vị trí và exposure bias. Offline metric không chứng minh tác động nhân quả lên doanh thu; kết luận business lift cần A/B test được thiết kế hợp lệ.

Không so feature project với một model nghiên cứu trên dataset khác rồi kết luận model nào “thắng”. Bài Guo et al. dùng co-compare labels để huấn luyện Siamese product embeddings và có protocol riêng; chỉ có thể tái hiện công bằng khi có dữ liệu, nhãn, split và điều kiện tương thích.

### 4.3. Benchmark synthetic có thể chạy lại

Script [`evaluate-criterion-3-semantic.ts`](../../../services/recommendation-service/src/scripts/evaluate-criterion-3-semantic.ts) đã được chạy trên 20 seed, mỗi seed 500 request và catalog 48 sản phẩm. Mỗi seed chia theo thời gian thành 300 train, 100 validation, 100 test. Không có model nào được train trong benchmark feature này nên split train được giữ để thể hiện protocol nhưng không dùng để fit. Validation chỉ chọn một hệ số nhân recent-signal trong `{0,25; 0,5; 1; 2; 4}`; kết quả test không tham gia chọn hệ số. Mọi baseline chấm cùng candidate pool, nhãn và tie-break.

Nhãn sinh độc lập với vector/score: grade `2` = cùng latent topic, `1` = cùng family, `0` = family khác. Vì nhãn vẫn được tạo từ kịch bản synthetic, chúng chỉ dùng để kiểm tra evaluator và so hành vi trên kịch bản định trước, không thay nhãn giảng viên hay người mua.

Hai kịch bản được báo tách biệt để tránh gộp các câu hỏi khác nhau:

1. `current-item-centric`: latent topic của nhãn được đặt bằng topic của sản phẩm đang xem. Đây là phép đo item-to-item; baseline single-anchor gần như được ưu tiên theo cách sinh nhãn, nên không thể dùng kết quả này để tuyên bố single-anchor luôn tốt nhất.
2. `multi-anchor-intent`: target intent sinh độc lập; sản phẩm đang xem khớp target chỉ với xác suất 45%, còn tín hiệu gần đây và hồ sơ dài hạn có xác suất cao mang target. Kịch bản này kiểm tra trường hợp nhiều anchor cần khôi phục intent khi sản phẩm hiện tại đã cũ/lệch.

| Kịch bản             | Phương pháp                  | Test NDCG@10 (mean ± SD; min–max) | Test Recall@10 (mean ± SD; min–max) | Chênh NDCG so weighted-centroid (paired 95% CI) | Chênh Recall (paired 95% CI) |
| -------------------- | ---------------------------- | --------------------------------: | ----------------------------------: | ----------------------------------------------: | ---------------------------: |
| current-item-centric | Production weighted-centroid |    0,6791 ± 0,0277; 0,6245–0,7283 |      0,7919 ± 0,0278; 0,7197–0,8500 |                                               — |                            — |
| current-item-centric | Validation-tuned centroid    |    0,7792 ± 0,0322; 0,7026–0,8222 |      0,8112 ± 0,0322; 0,7253–0,8552 |                        +0,1001 [0,0926; 0,1073] |     +0,0194 [0,0092; 0,0297] |
| current-item-centric | Single-anchor cosine         |    0,9996 ± 0,0009; 0,9961–1,0000 |      0,9997 ± 0,0010; 0,9959–1,0000 |                        +0,3206 [0,3094; 0,3329] |     +0,2078 [0,1969; 0,2195] |
| current-item-centric | Unweighted-centroid cosine   |    0,7184 ± 0,0316; 0,6523–0,7644 |      0,7290 ± 0,0309; 0,6694–0,7826 |                        +0,0394 [0,0304; 0,0482] |   −0,0629 [−0,0722; −0,0539] |
| current-item-centric | Weighted TF–IDF cosine       |    0,7822 ± 0,0251; 0,7378–0,8424 |      0,8271 ± 0,0227; 0,7858–0,8691 |                        +0,1031 [0,0920; 0,1141] |     +0,0352 [0,0261; 0,0447] |
| multi-anchor-intent  | Production weighted-centroid |    0,7056 ± 0,0385; 0,6456–0,7594 |      0,8121 ± 0,0335; 0,7574–0,8730 |                                               — |                            — |
| multi-anchor-intent  | Validation-tuned centroid    |    0,7311 ± 0,0335; 0,6838–0,7857 |      0,8439 ± 0,0294; 0,7934–0,8929 |                        +0,0254 [0,0195; 0,0314] |     +0,0319 [0,0259; 0,0375] |
| multi-anchor-intent  | Single-anchor cosine         |    0,5651 ± 0,0474; 0,5081–0,6976 |      0,5682 ± 0,0474; 0,5141–0,7000 |                      −0,1406 [−0,1653; −0,1137] |   −0,2438 [−0,2668; −0,2189] |
| multi-anchor-intent  | Unweighted-centroid cosine   |    0,5593 ± 0,0383; 0,4822–0,6152 |      0,6361 ± 0,0363; 0,5545–0,6872 |                      −0,1464 [−0,1592; −0,1348] |   −0,1759 [−0,1901; −0,1639] |
| multi-anchor-intent  | Weighted TF–IDF cosine       |    0,8682 ± 0,0262; 0,8213–0,9254 |      0,8756 ± 0,0244; 0,8318–0,9282 |                        +0,1626 [0,1521; 0,1735] |     +0,0635 [0,0548; 0,0724] |

Khoảng tin cậy là percentile bootstrap ghép cặp trên 20 seed (4.000 lần resample), không phải khoảng tin cậy theo người dùng thật. Trong kịch bản đầu, single-anchor gần oracle vì nhãn được định nghĩa từ chính sản phẩm đang xem. Trong kịch bản thứ hai, TF–IDF synthetic vượt cả centroid dự án; điều này chỉ chỉ ra baseline đó đáng được đánh giá bằng dữ liệu thật, không chứng minh lexical ranking tốt hơn cho catalog thật. Hệ số validation-tuned lần lượt chọn `0,25` cho cả 20 seed ở kịch bản đầu và `1`, `2` hoặc `4` ở kịch bản hai; không được gọi các giá trị đó là tối ưu ngoài kịch bản synthetic.

Lệnh tiêu chí 3 từ thư mục gốc repo (build service rồi chạy evaluator):

```powershell
npm run recommendation:criterion-3-semantic-evaluate
```

Để chạy lại toàn bộ evaluator của các tiêu chí 3–8, dùng `npm run recommendation:criteria-3-8-evaluate`.

Lệnh trực tiếp đã dùng để sinh các số ở bảng trên (không build/ghi `dist`):

```powershell
npx --no-install ts-node --project services/recommendation-service/tsconfig.json -r tsconfig-paths/register services/recommendation-service/src/scripts/evaluate-criterion-3-semantic.ts
```

Script in bảng tóm tắt và số liệu từng seed. Qdrant được thay bằng adapter exact-cosine; vì vậy phép đo không kiểm tra ANN recall, lọc collection, latency hay tính đúng của vector embedding thật. Không có LambdaRank training, impression logs, feedback propensities, hoặc nhãn người dùng trong phép đo này.

## 5. Bằng chứng hiện có và kết luận được phép

| Câu hỏi                                            | Bằng chứng đang có                                                                                                                                                                                      | Kết luận được phép                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Centroid có được tính đúng ở ca 4:2 không?         | Unit spec kiểm tra `[2/3,1/3]`; ca triệt tiêu xác nhận không gọi Qdrant.                                                                                                                                | Khớp các ca đã kiểm tra; còn thiếu nhiều biên vector và score.                                                                          |
| Metric/collection có khớp semantics feature không? | Adapter chỉ bật search với `Cosine`; initializer kiểm tra dimension/metric của physical và active collection.                                                                                           | Vector search không được bật khi phát hiện metric không tương thích.                                                                    |
| Feature có lọc đúng source và giới hạn miền không? | Unit spec cho score vượt miền, score âm/không hữu hạn và source khác; code lọc source rồi clamp.                                                                                                        | Hành vi đó khớp code; chưa kiểm tra score end-to-end với Qdrant thật.                                                                   |
| Công thức có nền tảng nghiên cứu không?            | SBERT/OpenAI/Qdrant hỗ trợ embedding + cosine; nghiên cứu average embedding nêu rõ giả định và giới hạn; bài Guo et al. chứng minh hướng nội dung sản phẩm đáng đánh giá bằng nhãn phù hợp.             | Có cơ sở cho họ phương pháp. Không có bài nào trong đây chứng minh chính trọng số `1/2/4/0,5` hoặc centroid hiện tại tối ưu.            |
| Công thức dự án có xếp hạng tốt không?             | Benchmark synthetic chạy được, nhưng chưa có bộ nhãn semantic do chuyên gia/người dùng chấm và chưa đo trên impression log thật. Trong multi-anchor-intent, TF–IDF synthetic cao hơn weighted-centroid. | **Chưa kết luận được cho người dùng thật.** Bằng chứng synthetic chỉ phụ thuộc kịch bản sinh; không được diễn giải thành hiệu quả thật. |

## 6. Tiêu chuẩn kết luận sau khi đo

Chỉ kết luận công thức hiện tại tốt hơn một baseline khi trên test đã khóa trước:

- Code khớp ca golden/boundary và collection metric thực tế là `Cosine`.
- Candidate retrieval cải thiện chỉ số liên quan theo nhãn semantic hoặc behavior mà không làm giảm coverage đáng kể.
- Model có `semanticSimilarity` cải thiện NDCG@10/Recall@10 so với ablation cùng candidate pool; chênh lệch và khoảng tin cậy được báo cáo.
- Kết quả không chỉ đến từ một nhóm catalog/request; hạn chế do thiếu nội dung, embedding stale, hoặc bias được nêu rõ.

Nếu centroid thua unweighted hoặc single-anchor trên validation, chỉ thử thay trọng số/threshold trên validation rồi đánh giá một lần trên test giữ riêng. Nếu kết quả test không tốt hơn baseline, báo đúng là chưa có bằng chứng công thức tốt hơn; không chọn lại test hoặc tự tạo nhãn để làm đẹp kết quả.

### Lời trình bày ngắn

> “Em tách kiểm chứng thành toán, code và chất lượng xếp hạng. Về toán, centroid có trọng số là tổ hợp lồi; cosine có miền xác định rõ; feature sau clamp thuộc `[0,1]`. Về code, `SemanticCandidateService` tạo centroid; `VectorIndexService` chỉ bật metric Cosine và kiểm tra metric collection; `RankingFeatureService` chỉ clamp score semantic chứ không tạo centroid. Em đã chạy benchmark synthetic theo hai kịch bản, cùng candidate pool, nhãn độc lập với score, chia theo thời gian và chỉ tune trên validation. Kết quả thay đổi theo cách sinh intent, nên đây chưa phải bằng chứng về người dùng thật; em cần nhãn nội dung hoặc log hiển thị thật để kết luận.”

## Tài liệu tham khảo bổ sung

- Salton, G. & Buckley, C. 1988. “Term-weighting approaches in automatic text retrieval.” _Information Processing & Management_, 24(5), 513–523. [Bản lưu tại Cornell](https://ecommons.cornell.edu/entities/publication/d81a71f9-8de9-4ef1-9ee2-8544cdb48372). Nguồn cho baseline lexical term-weighting; TF–IDF baseline vẫn phải được cài và đánh giá trên đúng catalog này.
- Järvelin, K. & Kekäläinen, J. 2002. “Cumulated gain-based evaluation of IR techniques.” _ACM Transactions on Information Systems_, 20(4), 422–446. [DOI](https://doi.org/10.1145/582415.582418). Cơ sở cho discounted cumulative gain/NDCG khi relevance có nhiều mức.

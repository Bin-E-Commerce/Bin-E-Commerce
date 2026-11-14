# Đối chiếu code và đánh giá tiêu chí profileAffinity

## 1. Hai câu hỏi cần trả lời riêng

1. **Code có tính đúng feature đã định nghĩa không?** Có thể trả lời bằng đối chiếu công thức với luồng dữ liệu, kiểm thử tính chất toán học và kiểm tra các nhánh biên.
2. **Feature có giúp model xếp hạng tốt hơn không?** Chỉ trả lời được bằng dữ liệu impression thật, chia theo thời gian và thí nghiệm so sánh có cùng candidate, request và label.

Câu 1 không chứng minh câu 2. Unit test xác nhận code thực hiện đúng định nghĩa; nó không chứng minh công thức làm tăng click, giỏ hàng hay đơn mua.

## 2. Luồng dữ liệu của riêng tiêu chí này

1. **Nhận tín hiệu:** profile projection tiêu thụ event tương tác có thời điểm và trọng số do RecommendationRuleService cung cấp. Tùy loại event, trọng số có thể dương hoặc âm.
2. **Ánh xạ chiều hồ sơ:** interaction liên kết với khóa sản phẩm, danh mục và thương hiệu; purchase/return mới dùng snapshot category/brand từ order item. Profile cũng lưu chiều truy vấn, nhưng profileAffinity hiện không dùng chiều QUERY.
3. **Cộng dồn theo thời gian:** repository duy trì hai tổng positive_score và negative_score riêng, cùng last_signal_at. Projection ledger chống cộng lặp event.
4. **Đọc hồ sơ:** recommendation query yêu cầu top-k riêng cho tín hiệu dương và âm: 30 khóa sản phẩm mỗi phía, 12 danh mục và 12 thương hiệu mỗi phía. Profile service gộp khóa trùng giữa hai phía. Query repository sắp thứ tự theo tín hiệu hiệu dụng tại thời điểm đọc; candidate seed và trạng thái cá nhân hóa dùng positiveScore để không mất tín hiệu khi signed score triệt tiêu.
5. **Tính feature:** với từng candidate, ranker tra khóa sản phẩm, danh mục và thương hiệu; chỉ dùng positive_score cho profileAffinity, áp dụng decay, chia scale, chặn từng chiều tại 1, rồi kết hợp bằng trọng số đã chuẩn hóa.
6. **Gửi model:** profileAffinity là một cột feature. LambdaRank học cách kết hợp cột này với các feature khác và nhãn; monotonic constraint bảo đảm tăng riêng profileAffinity không làm raw score giảm khi các cột khác giữ nguyên.

## 3. Bản đồ công thức sang code

| Thành phần                                                       | Nơi triển khai                                                                                                                                                                                                                                                                                                                                        | Điều cần xác nhận                                                                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Half-life cố định 7 ngày; ENV khác 7 bị từ chối                  | [recommendation-rule.service.ts](../../../services/recommendation-service/src/modules/profiles/application/services/rules/recommendation-rule.service.ts), hàm getProfileHalfLifeDays                                                                                                                                                                 | Không trộn aggregate đã decay bằng H cũ với H mới; đổi H phải replay event                                |
| Ba cặp trọng số/scale mặc định và chuẩn hóa trọng số tổng bằng 1 | [recommendation-rule.service.ts](../../../services/recommendation-service/src/modules/profiles/application/services/rules/recommendation-rule.service.ts), hàm getProfileAffinityConfig                                                                                                                                                               | Scale hữu hạn và dương; weight hữu hạn và không âm; nếu tổng 0 thì dùng defaults                          |
| Cập nhật tổng dương/âm về mốc mới, xử lý event đến trễ           | [profile-projection.repository.ts](../../../services/recommendation-service/src/modules/profiles/infrastructure/repositories/profile-projection.repository.ts), hàm upsertPreference                                                                                                                                                                  | Dùng cùng half-life, cùng mốc last_signal_at, không cộng lặp event                                        |
| Chặn event trùng                                                 | [profile-projection.repository.ts](../../../services/recommendation-service/src/modules/profiles/infrastructure/repositories/profile-projection.repository.ts), hàm claimProjectionEvent                                                                                                                                                              | Event id duy nhất; event đã claim thì không cộng lại                                                      |
| Cộng dồn chiều từ event                                          | [profile-projection.service.ts](../../../services/recommendation-service/src/modules/profiles/application/services/profile/profile-projection.service.ts), các hàm project và projectPurchase                                                                                                                                                         | Bỏ qua khóa thiếu hoặc weight bằng 0; purchase/return gồm product, category và brand nếu snapshot có khóa |
| Đọc preference theo độ lớn sau decay                             | [profile-query.repository.ts](../../../services/recommendation-service/src/modules/profiles/infrastructure/repositories/profile-query.repository.ts), hàm findTop; [profile-query.service.ts](../../../services/recommendation-service/src/modules/profiles/application/services/profile/profile-query.service.ts), hàm getTop                        | Lấy top-k riêng cho positive/negative; giới hạn truy vấn ảnh hưởng độ phủ hồ sơ                           |
| Tính điểm từng chiều và kết hợp                                  | [ranking-feature.service.ts](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.ts), các hàm positivePreferenceScore, decayedComponentScore và build                                                                                                                   | Dùng positiveScore, đúng scale, đúng reference time; tổng weight đã chuẩn hóa                             |
| Tạo vector feature trong request                                 | [recommendation-query.service.ts](../../../services/recommendation-service/src/modules/recommendation/application/services/query/recommendation-query.service.ts) và [recommendation-ml-ranking.service.ts](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/ml/recommendation-ml-ranking.service.ts) | Gắn đúng profile với user/session và candidate; không dùng response cache của contract cũ                 |

### Phân biệt phần dương và âm trong code

profileAffinity chỉ đo phần dương. negativePenalty là cột riêng, được tính từ negative_score và đưa riêng vào model. Không nên mô tả công thức thành “điểm dương trừ điểm âm”; code hiện tại không làm phép trừ đó.

### Giới hạn đầu vào hồ sơ cần ghi nhận

- Query giới hạn riêng mỗi phía: tối đa 30 khóa sản phẩm dương và 30 âm; 12 khóa danh mục dương và 12 âm; 12 khóa thương hiệu dương và 12 âm, trước khi gộp khóa trùng. Vì vậy công thức áp dụng trên preference đã đọc và candidate đã được tạo; không có bảo đảm mọi lịch sử người dùng đều nằm trong các tập đầu vào.
- Candidate seed, strategy và profileState hiện cùng dựa vào positiveScore như feature. Dù vậy, top-k và giới hạn candidate pool vẫn có thể loại một phần lịch sử; đánh giá riêng feature cần cố định candidate pool để không lẫn tác động của bước sinh ứng viên.
- Migration tách điểm signed cũ thành hai phần dương/âm theo giá trị tổng tại thời điểm migration. Nếu không replay event gốc, dữ liệu lịch sử trước migration không phải phép tái dựng chính xác của công thức mới.
- Purchase/return mới truyền brand snapshot qua Product → Order → Kafka → profile projection. Order cũ chưa có snapshot này nên lịch sử thương hiệu trước migration vẫn thiếu.

## 4. Bằng chứng kiểm thử phép tính

Các test hiện có trong [ranking-feature.service.spec.ts](../../../services/recommendation-service/src/modules/recommendation/application/services/ranking/features/ranking-feature.service.spec.ts) kiểm tra:

- Ba chiều dùng scale riêng và trọng số kết hợp cho kết quả 0.45 với fixture 4/8, 8/16, 2/8.
- Tín hiệu dương vẫn được giữ trong profileAffinity khi cùng khóa có positive và negative; phần âm được đưa sang negativePenalty.
- Tín hiệu cũ đúng một half-life giảm còn một nửa và điểm từng chiều được chặn trước khi cộng; fixture kiểm tra kết quả tổng 0.8.
- Feature vector được kiểm tra là số hữu hạn và nằm trong [0,1].

Các test cấu hình trong [recommendation-rule.service.spec.ts](../../../services/recommendation-service/src/modules/profiles/application/services/rules/recommendation-rule.service.spec.ts) kiểm tra khóa half-life và chuẩn hóa weight. Test query, projection, validator và checkout kiểm tra mixed signed score cùng brand snapshot. Trainer LambdaRank ràng buộc profileAffinity theo chiều tăng và negativePenalty theo chiều giảm; artifact cũ bị registry từ chối. Đây là bằng chứng cho code path đã test, không phải bằng chứng ranking hiệu quả trên người dùng thật.

## 5. Cách đo xem tiêu chí có giúp ranking không

### Baseline nghiên cứu để so công thức

Content-based recommendation xây dựng hồ sơ sở thích người dùng từ tín hiệu phản hồi, biểu diễn sản phẩm bằng thuộc tính nội dung, rồi so độ tương tự giữa hồ sơ và sản phẩm. Pazzani và Billsus trình bày họ phương pháp này; trong vector space, cosine là một cách đo độ tương tự. Đây là **phương pháp tham chiếu có cơ sở nghiên cứu**, không phải một công thức duy nhất đã được chứng minh luôn tốt nhất cho mọi cửa hàng. [Pazzani & Billsus, _Content-Based Recommendation Systems_, 2007](https://cs.fit.edu/~pkc/apweb/related/pazzani07aw.pdf).

Với baseline cosine, đặt `u` là vector hồ sơ và `p` là vector thuộc tính sản phẩm:

```text
cosine(u, p) = (u · p) / (||u|| × ||p||)
```

Trong phạm vi tiêu chí này, các chiều là sản phẩm, danh mục và thương hiệu. Phải dùng cùng request, candidate, hồ sơ đầu vào và nhãn khi so cosine với `profileAffinity`. Có thể so thêm công thức dự án cũ/mới nếu mục tiêu là kiểm tra thay đổi công thức; popularity chỉ là mốc phụ, không thay thế baseline cá nhân hóa.

### Phép đo synthetic đã chạy

Evaluator [profile_cosine_evaluator.py](../../../services/ai-service/app/modules/ranking/infrastructure/training/profile_cosine_evaluator.py) chạy trên test split của dataset `synthetic-catalog-500-1000u-5000s-seed42`. Nó so `profileAffinity` do production feature builder tạo với cosine trên cùng 15.000 dòng, 750 request và cùng nhãn; các tie được xử lý theo `itemId` tăng dần để không thừa hưởng thứ tự candidate trong file. Report đầy đủ nằm tại [comparison-content-profile-cosine.json](../../../services/ai-service/data/ranking-synthetic/synthetic-catalog-500-1000u-5000s-seed42/comparison-content-profile-cosine.json).

| Phương pháp                  |                            NDCG@10 |                          Recall@10 |
| ---------------------------- | ---------------------------------: | ---------------------------------: |
| `profileAffinity` hiện tại   |                             0.5152 |                             0.5936 |
| Content-profile cosine       |                             0.5376 |                             0.6042 |
| Cosine trừ `profileAffinity` | **+0.0224** (+2.24 điểm phần trăm) | **+0.0105** (+1.05 điểm phần trăm) |

Trong kịch bản synthetic này, cosine xếp tốt hơn theo cả hai metric. Đây **chưa phải kết luận chọn cosine**: mô phỏng đã sinh hồ sơ và nhãn theo một cơ chế biết trước, chưa có độ tin cậy thống kê hoặc quan sát độc lập từ người mua.

**Giới hạn quan trọng:** bộ dữ liệu này do simulator tạo. Hồ sơ cosine lấy từ persona/category/brand giả cùng sản phẩm neo của session, không tái dựng lịch sử tích lũy trước từng request; nhãn cũng sinh từ utility ẩn có dùng độ khớp category/brand, giá, rating, popularity và vị trí. Vì vậy số đo chỉ xác nhận pipeline chạy và cho thấy hai cách tính phản ứng ra sao với kịch bản giả lập; không chứng minh cosine hay công thức dự án tốt hơn người dùng thật. Không dùng số này làm kết luận luận văn rằng công thức đã hiệu quả.

**Popularity baseline synthetic trước đây không hợp lệ:** simulator xếp candidate khớp persona lên trước rồi gán `sourceRank` theo đúng vị trí candidate trong request. Feature popularity vì thế bị nhiễm thứ tự và không đại diện độ phổ biến toàn catalog. Hãy bỏ các số đo popularity synthetic cũ khỏi kết luận.

### Phép đánh giá cần dùng với log thật

1. Ghi impression thật: request/user-or-session, item thực sự được hiển thị, vị trí, timestamp, feature snapshot tại lúc request và outcome sau impression. Không xem candidate chưa hiển thị là negative.
2. Chia train/validation/test theo thời gian; mọi preference để chấm request chỉ được dựng từ event trước hoặc bằng thời điểm request. Cố định cùng test requests, candidate pool và labels cho mọi phương pháp.
3. Trước tiên so `profileAffinity` với **content-profile cosine** như một personalized research baseline trên cùng profile đầu vào. Dùng **NDCG@10** chính và **Recall@10** bổ trợ; báo cả chênh lệch, số request/candidate/positive và khoảng tin cậy paired bootstrap theo user hoặc request.
4. Vì sản phẩm cuối dùng AI ranker, sau đó train hai model giống nhau: đầy đủ feature hiện hành và bỏ riêng `profileAffinity`. Train trên train split, chọn cấu hình bằng validation, đánh giá một lần trên test. Đây là kiểm tra tiêu chí có đóng góp vào model cuối không; không đồng nhất với so công thức độc lập.
5. Nếu thử lại half-life, scale hoặc trọng số, chọn trên validation và giữ test chưa đụng đến. Báo kết quả theo các giai đoạn thời gian nếu dữ liệu đủ.

NDCG@10/Recall@10 chỉ đánh giá thứ hạng theo nhãn đã chọn; chúng không tự chứng minh tăng doanh thu hoặc hài lòng. Nếu log được tạo bởi hệ thống cũ, cần nêu position/exposure bias và cân nhắc đánh giá có kiểm soát hoặc hiệu chỉnh propensity.

## 6. Trạng thái bằng chứng hiện tại

| Mệnh đề                                                                            | Bằng chứng hiện có                                                                  | Kết luận được phép                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Công thức có half-life đúng nghĩa, bounded và không tăng khi tín hiệu cũ đi xa hơn | Suy ra đại số từ định nghĩa; ví dụ đã có unit test                                  | Có thể chứng minh tính chất toán học theo giả định đã nêu                                                |
| Code tính đúng các ví dụ đã kiểm tra                                               | Unit test feature và config                                                         | Có thể nói các trường hợp kiểm tra khớp công thức; không nên nói đã chứng minh mọi đường chạy production |
| Cách suy giảm theo thời gian có nền tảng nghiên cứu                                | Các nghiên cứu time-aware recommender ở tài liệu 01                                 | Có thể nói phương pháp đã được nghiên cứu; không thể gán tham số của paper cho dự án                     |
| Phương pháp cosine có nền tảng content-based recommendation                        | Pazzani & Billsus (2007); công thức cosine/vector-space được mô tả trong nghiên cứu | Có cơ sở chọn làm baseline; nghiên cứu không khẳng định nó tối ưu cho dữ liệu dự án                      |
| Công thức giúp model của dự án xếp hạng tốt                                        | Chưa có kết quả trên impression log thật                                            | **Chưa kết luận được**                                                                                   |

Phép đo synthetic ở trên không huấn luyện LambdaRank và không đo hiệu quả người dùng. Artifact AI cần được train lại sau khi đổi monotonic constraint; registry từ chối artifact cũ thiếu constraint profileAffinity tăng. Monotonic constraint chứng minh chiều tác động có điều kiện của feature, không chứng minh model cải thiện NDCG/Recall. Repository hiện chưa có impression log thật đủ điều kiện để kết luận hiệu quả ranking.

## 7. Kết luận có thể bảo vệ trước giảng viên

> “Em không khẳng định bài báo đã chứng minh các con số cấu hình của em là tối ưu. Em chứng minh các tính chất của công thức bằng đại số; chỉ ra nghiên cứu đã dùng mô hình suy giảm theo độ mới và half-life; kiểm tra code qua unit test đối với các trường hợp có kiểm soát. Để chứng minh tiêu chí này có ích cho ranking của hệ thống, em sẽ so LambdaRank đủ feature với LambdaRank bỏ riêng profileAffinity trên cùng candidate pool và impression log chia theo thời gian, dùng NDCG@10/Recall@10. Hiện em chưa có kết quả dữ liệu thật đủ điều kiện để khẳng định model tốt hơn.”

Cách nói chính xác hơn về baseline là: “Content-based profile và cosine là phương pháp tham chiếu được nghiên cứu trước. Em sẽ so cosine với `profileAffinity` trên cùng hồ sơ, sản phẩm ứng viên và outcome. Phép đo synthetic hiện tại nghiêng về cosine, nhưng vì cả hồ sơ lẫn outcome đều do simulator sinh nên em chưa dùng nó để khẳng định phương pháp nào tốt hơn người mua thật. Khi có impression log thật, em sẽ đánh giá baseline trước, rồi train lại model bỏ riêng feature để đo đóng góp của nó vào AI ranker.”

## Tài liệu tham khảo phương pháp

1. Ardagelou & Arampatzis (2017), [A Half-Life Decaying Model for Recommender Systems with Matrix Factorization](https://ceur-ws.org/Vol-2038/paper1.pdf).
2. Stefanidis et al. (2012), [A Framework for Time-Aware Recommendations](https://homepages.tuni.fi/konstantinos.stefanidis/docs/dexa12.pdf).
3. Sánchez-Moreno et al. (2020), [Time-Aware Music Recommender Systems](https://doi.org/10.3390/app10155324).
4. Pazzani & Billsus (2007), [Content-Based Recommendation Systems](https://cs.fit.edu/~pkc/apweb/related/pazzani07aw.pdf).

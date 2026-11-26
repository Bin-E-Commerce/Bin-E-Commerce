# Đánh giá kịch bản tìm sản phẩm bằng ảnh

Ngày đo 26/11/2026. Mục tiêu là xem khách có tìm được đúng món khi ảnh
chụp khác ảnh catalog, và khi nào hệ thống cần trả ít kết quả hơn.

## Dữ liệu và cách đo

- Lấy mẫu 62 sản phẩm đang hiển thị từ catalog công khai. Mẫu gồm áo thun,
  áo sơ mi, giày sục/búp bê, sandal/cao gót, sneaker, túi, bàn phím, điện
  thoại, đồ uống và sách. Lấy theo thứ tự mới nhất trong từng nhóm, có ưu
  tiên phủ các nhóm liên quan đến feedback.
- Chạy local với PE-Core ONNX 512 chiều đang có trong repo. Hai ảnh đầu của
  mỗi sản phẩm tạo gallery 124 vector. Có 51 sản phẩm với ảnh thứ ba riêng
  để giữ ngoài gallery. Không có ảnh thứ ba nào trùng byte với một trong
  hai ảnh gallery sau bước chuẩn hóa file.
- Chọn tối đa hai sản phẩm từ mỗi nhóm, dùng ảnh thứ ba để thử khác ảnh
  catalog, rồi sinh các biến thể có kiểm soát. Với phép thử hai món, đổi
  bên đặt món đích giữa các ca. Phần chọn vùng mô phỏng khách đã khoanh đúng
  món cần tìm.
- Tính cosine và lấy điểm cao nhất qua các ảnh trong gallery. Mô phỏng
  ngưỡng điểm, chọn hướng xoay và điều kiện giữ kết quả gần điểm dẫn đầu.
  Đây là phép đo offline. Qdrant, Product API, tồn kho và độ trễ từ trình
  duyệt nằm ngoài phép đo này.
- Các ca có một SKU đích dùng tỷ lệ hạng 1, Recall@10 và NDCG@10 trên mỗi
  nhóm kịch bản. Nhóm không có đích đo tỷ lệ trả ít nhất một kết quả. Các
  ca feedback chỉ đánh giá những mẫu catalog đã đối chiếu thủ công.

## Kết quả offline

Chạy 204 ca logic gồm 180 ca có một sản phẩm đích, 16 ca đối chứng âm và
8 ca từ ảnh feedback/hồi quy hoặc vùng cắt của chúng. Các biến thể của cùng
ảnh và các lượt thử ngưỡng không phải những ảnh người dùng độc lập.

### Ảnh một sản phẩm

Mỗi hàng có 20 ca, dùng ngưỡng cosine mặc định 0,75 và hai ảnh gallery cho
mỗi sản phẩm. NDCG@10 làm tròn đến hai chữ số.

| Kịch bản                         | Đúng hạng 1 | Recall@10 | NDCG@10 | Trả rỗng |
| -------------------------------- | ----------: | --------: | ------: | -------: |
| Ảnh catalog giữ ngoài gallery    |       17/20 |       90% |    0,88 |     2/20 |
| JPEG cạnh dài 180 px, quality 28 |        7/20 |       40% |    0,38 |    11/20 |
| Xoay 90° không có EXIF           |       13/20 |       70% |    0,68 |     6/20 |
| Nghiêng 16° trên nền viền xám    |        7/20 |       35% |    0,35 |    13/20 |
| Cắt mất cạnh phải và phần trên   |       16/20 |       85% |    0,83 |     3/20 |
| Che khoảng một phần ba ảnh       |       14/20 |       85% |    0,79 |     3/20 |
| Tối và mờ                        |       13/20 |       70% |    0,68 |     6/20 |

Chỉ dùng ảnh gallery đầu tiên, ca ảnh giữ ngoài index đạt hạng 1 **13/20**
và Recall@10 **65%**. Dùng hai ảnh nâng lên **17/20** và **90%**. Mẫu
gallery thứ hai có lợi cho khả năng tìm đúng SKU từ ảnh khác. Stock,
trạng thái index và số ảnh vector thực tế của production cần phép kiểm
riêng.

### Nhiều món và nền rối

| Kịch bản và cách chọn                  | Đúng hạng 1 | Recall@10 | Sai nhóm ở hạng 1 |
| -------------------------------------- | ----------: | --------: | ----------------: |
| Hai món, dùng toàn khung               |        2/20 |       15% |              3/20 |
| Hai món, khách chọn đúng vùng          |       17/20 |       90% |              0/20 |
| Hai món, tự chọn vùng có điểm cao nhất |        4/20 |       55% |             16/20 |
| Món nhỏ trên nền rối, dùng toàn ảnh    |       15/20 |       80% |              0/20 |
| Món nhỏ trên nền rối, khoanh đúng món  |       18/20 |       95% |              0/20 |

Tự lấy điểm cao nhất từ hai vùng có thể đảo ý định của khách sang món
còn lại. Hai món trong phép thử thuộc hai nhóm khác nhau. Ảnh chứa hai áo
cùng kiểu cần bộ nhãn theo màu, kiểu và mục tiêu ở từng vùng.

### Ngưỡng, kết quả không phù hợp và độ trễ

| Ngưỡng cơ sở | Recall@10 trên 140 ca một món | Ảnh không có mẫu phù hợp vẫn trả kết quả |
| -----------: | ----------------------------: | ---------------------------------------: |
|         0,72 |                       110/140 |                                     1/16 |
|         0,75 |                        95/140 |                                     0/16 |
|         0,78 |                        79/140 |                                     0/16 |

Nhóm đối chứng âm gồm sáu ảnh màu trơn/nhiễu/tài liệu giả lập và mười ảnh
chạy khi nhóm sản phẩm tương ứng đã được loại khỏi gallery thử. So với
0,75, ngưỡng 0,72 tìm thêm 15 ca đúng nhưng đã trả nhầm trên bộ đối chứng
âm nhỏ. Ngưỡng riêng 0,80 cho ảnh cần khớp mạnh vẫn được áp ở cả ba lượt.
Kết quả phù hợp để nghiên cứu phục hồi ứng viên có điều kiện. Giữ ngưỡng
toàn hệ thống 0,75 cho đến khi có bộ ca âm và hard negative rộng hơn.

Thời gian tạo embedding ảnh truy vấn trên máy local có p50 **464 ms**
và p95 **871 ms** trên 140 ca một món. Số liệu này gồm tiền xử lý và
các vector phụ khi có, với CPU ONNX hai luồng. Độ trễ trình duyệt, Qdrant
và đọc catalog cần được đo qua Gateway.

### Đối chiếu feedback với ảnh catalog

| Ca thực tế                       | Kết quả trên gallery mẫu                                                                                                                                                                                   | Điều cần kiểm tra tiếp                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Áo trắng trong ảnh hai người     | Hai mẫu áo trắng hạng 1 và 3 với toàn ảnh. Cắt sát thân áo làm cả hai vắng mặt. Cắt lấy nửa ảnh trái với toàn bộ người mẫu giữ hạng 1 và 3.                                                                | Hướng dẫn khách khoanh cả dáng áo và giữ thêm bối cảnh khi cần. Đo riêng áo trắng và áo đen.                      |
| Giày chấm bi trong ảnh quảng cáo | Mẫu búp bê NAB166 hạng 1 ở toàn ảnh lẫn vùng khoanh. Cosine tăng từ 0,8174 lên 0,8227.                                                                                                                     | So với cùng dáng giày trơn và cùng họa tiết ở kiểu giày khác.                                                     |
| Giày chấm bi được mang trên chân | Với hai ảnh gallery, mẫu NAB166 có điểm 0,7427 và bị bỏ. Thêm ảnh catalog thứ ba đưa mẫu vào hạng 3. Khoanh đôi giày dưới chân cùng gallery mở rộng đưa mẫu lên hạng 2. Giày cao gót chấm bi vẫn đứng đầu. | Chấm riêng ảnh mang trên chân. Ưu tiên dấu hiệu kiểu quai, mũi và gót bên cạnh họa tiết.                          |
| Boston nghiêng 12° và 16°        | Vắng mặt với một ảnh gallery. Với hai ảnh gallery, Boston hạng 2 ở cả hai góc và Rencho Zurich đứng đầu. Thử thêm ảnh thứ ba cho các mẫu liên quan vẫn giữ thứ hạng này.                                   | Kiểm lại bằng gallery Qdrant đủ ảnh qua Gateway. Bổ sung cặp kín mũi/hở mũi vào bộ đánh giá, kèm ảnh Rencho thật. |
| Rencho Zurich gốc                | Hạng 1 khi dùng một, hai hoặc ba ảnh gallery cho các mẫu liên quan.                                                                                                                                        | Giữ làm đối chứng khi tăng độ ưu tiên cho dấu hiệu mũi kín của Boston.                                            |

Các ảnh feedback lấy từ phần ảnh trong screenshot. Kết quả so với gallery
mẫu phản ánh độ nhạy với cách lấy vùng và mức phủ gallery. Thứ hạng trên
production còn phụ thuộc ảnh gốc, toàn bộ vector đã index, điều kiện chữ
và bộ lọc catalog.

## Vòng 2 trên các ảnh giữ ngoài gallery

Giữ nguyên mẫu 62 sản phẩm và hai ảnh gallery cho mỗi SKU. Dùng 31 ảnh phụ
chưa làm ảnh đích trong nhóm biến thể của vòng 1. Các ảnh biến đổi mô phỏng
cách khách chụp và chia sẻ ảnh. Mỗi biến thể vẫn có nhãn SKU từ ảnh gốc.

Vòng 2 có 343 ca logic gồm 248 ca ảnh một món, 62 ca ẩn nhóm đích,
15 ca ba món cùng nhóm, 7 ca tìm sản phẩm thay thế và 11 ca ảnh chat.
Các cách khoanh vùng và ngưỡng so sánh dùng lại cùng ảnh trong từng
nhóm, nên không làm tăng số ca độc lập.

### Ảnh gửi qua điện thoại

| Kịch bản mới                                  | Đúng hạng 1 | Recall@10 | Trả rỗng |
| --------------------------------------------- | ----------: | --------: | -------: |
| Ảnh giữ ngoài gallery, làm mốc                |       26/31 |     30/31 |     1/31 |
| Ám ánh sáng ấm                                |       25/31 |     26/31 |     3/31 |
| Lóa một phần ảnh                              |       27/31 |     29/31 |     1/31 |
| Ảnh lật gương                                 |       26/31 |     30/31 |     1/31 |
| Chụp lệch phối cảnh                           |       29/31 |     29/31 |     1/31 |
| Chữ khuyến mãi đè qua phần dưới               |       19/31 |     20/31 |    11/31 |
| Screenshot trang bán hàng với thanh giao diện |        1/31 |      1/31 |    30/31 |
| Ảnh chia sẻ khung cao, nền trống              |       28/31 |     31/31 |     0/31 |

| Bố cục screenshot giả lập | Cách lấy vùng                | Đúng hạng 1 | Recall@10 |
| ------------------------- | ---------------------------- | ----------: | --------: |
| Trang bán hàng            | Toàn màn hình                |        1/31 |      1/31 |
| Trang bán hàng            | Khoanh đúng ảnh sản phẩm     |       29/31 |     31/31 |
| Trang bán hàng            | Khoanh rộng hơn, giữ ít viền |       27/31 |     30/31 |
| Ảnh chat nền tối          | Toàn màn hình                |        0/11 |      0/11 |
| Ảnh chat nền tối          | Khoanh đúng ảnh sản phẩm     |       10/11 |     11/11 |

Ảnh dài nền trống vẫn giữ tín hiệu sản phẩm. Trên mẫu thử này, chữ
và các vùng giao diện mới là dấu hiệu khiến việc tìm bằng toàn ảnh
screenshot gặp khó hơn rõ rệt. Các vùng thử ở đây lấy theo tọa độ
đã biết của ảnh mô phỏng. Gợi ý vùng thật vẫn cần kiểm tra trên các
bố cục app khác nhau và khi màn hình có nhiều thẻ sản phẩm.

Thời gian embedding local trên 248 ca
ảnh một món ở vòng này đạt p50 **276 ms**, p95 **785 ms**. Các biến
thể và tập ảnh khác vòng 1 nên số độ trễ không dùng để kết luận đã
cải thiện hiệu năng.

### Ảnh có ba món cùng nhóm catalog

Mỗi ca có một món khách muốn tìm và hai món dễ nhầm cùng nhóm. Đổi vị trí
đích giữa hình trái, giữa và phải.

| Cách tìm                          | Đúng hạng 1 | Recall@10 | Đưa một trong hai món còn lại lên đầu |
| --------------------------------- | ----------: | --------: | ------------------------------------: |
| Dùng toàn khung                   |        2/15 |      2/15 |                                  5/15 |
| Khoanh đúng món khách chọn        |       13/15 |     13/15 |                                  1/15 |
| Tự lấy điểm cao nhất trên ba vùng |        7/15 |     11/15 |                                  7/15 |

Hai sản phẩm cùng nhóm catalog có thể hợp loại mà sai món người dùng
muốn. Cần đo riêng lỗi chọn nhầm món thay vì chỉ đếm kết quả sai nhóm.

### Thử phục hồi ứng viên ở ca trả rỗng

Đo cùng 248 ca có đích và 62 ca đối chứng với toàn nhóm đích bị ẩn.
Nhóm đối chứng dùng hai dạng ảnh, ảnh giữ ngoài gallery và screenshot.
Đây là số ca còn có kết quả khi đã ẩn nhóm, dùng để đo mức tăng nguy
cơ trả nhầm giữa các phương án trong mẫu.

| Cách phục hồi                                                                | Recall@10 | Ca có kết quả khi ẩn nhóm đích |
| ---------------------------------------------------------------------------- | --------: | -----------------------------: |
| Ngưỡng hiện tại 0,75                                                         |   196/248 |                          13/62 |
| Nới ngưỡng 0,72 cho mọi truy vấn                                             |   209/248 |                          17/62 |
| Chỉ phục hồi phiên rỗng, có hai ảnh gallery hỗ trợ                           |   201/248 |                          13/62 |
| Như trên, kèm khoảng cách với ứng viên thứ hai và kiểm tra gallery gần trùng |   200/248 |                          13/62 |

Thử nghiệm hai ảnh dùng ngưỡng 0,72 cho ảnh tốt nhất và 0,70 cho ảnh
còn lại. Khi đủ điểm, chỉ trả ứng viên cao nhất. Các ca đã có kết quả
hoặc cần mức khớp mạnh được giữ nguyên. Năm ca tìm lại được gồm hai
ảnh có chữ khuyến mãi, hai ảnh ánh sáng ấm và một ảnh chụp lệch phối
cảnh. Mẫu nhỏ này ủng hộ việc thử tiếp cơ chế có điều kiện. Cần thêm
đối chứng cùng kiểu, khác màu, gallery gần trùng và ảnh thật trước
khi chọn ngưỡng production. Mẫu hiện tại có 0/62 cặp gallery vượt
cosine 0,95 giữa hai ảnh, nên chưa đo được tác dụng của điều kiện
loại ảnh gần trùng.

### Tìm mẫu thay thế khi thiếu đúng SKU

Một nhóm kiểm thử riêng ẩn SKU gốc và chỉ tìm **sản phẩm thay thế**. Gán
nhãn trước khi chạy theo tiêu chí của từng trường hợp, như áo thun trắng
cổ tròn, dép sục kín mũi hoặc giày búp bê chấm bi. Hai mức nhãn phân biệt
mẫu thay thế gần với mẫu chỉ giống một phần. Bảy ca gồm quần áo, giày dép
và túi. Ảnh khách tự chụp sẽ bổ sung ngữ cảnh còn thiếu của phép thử dùng
ảnh catalog.
[Nghiên cứu Complete the Look](https://openaccess.thecvf.com/content_CVPR_2019/papers/Kang_Complete_the_Look_Scene-Based_Complementary_Product_Recommendation_CVPR_2019_paper.pdf)

| Tìm sản phẩm thay thế                   | Có mẫu phù hợp ở hạng 1 | Recall@10 | NDCG@10 | Lượt xuất hiện của mẫu dễ nhầm trong top 3 | Ca rỗng |
| --------------------------------------- | ----------------------: | --------: | ------: | -----------------------------------------: | ------: |
| Tìm ảnh với ngưỡng 0,75                 |                     3/7 |    42,86% |  0,4054 |                                          6 |     1/7 |
| Giả lập khách đã chọn đúng nhóm catalog |                     3/7 |    42,86% |  0,4169 |                                          2 |     2/7 |

- **Dép sục:** Khi ẩn mẫu Boston, dép quai ngang hở mũi chiếm hai vị trí
  đầu. Chọn nhóm giày sục/búp bê giúp loại chúng và ca đó trả rỗng.
- **Giày búp bê chấm bi:** Giày cao gót cùng họa tiết xen vào giữa hai
  mẫu thay thế. Chọn đúng nhóm loại mẫu cao gót và giữ hai mẫu búp bê.
- **Áo trắng trong ảnh bảng size:** Áo sọc vẫn đứng đầu dù lọc nhóm áo
  thun. Cần đo riêng tín hiệu màu và họa tiết trong cùng nhóm.

Phép thử chọn nhóm là đối chứng có nhãn do người đánh giá cung cấp.
Một nhóm catalog rộng có thể chứa nhiều kiểu. Kết quả 7 ca dùng để tìm
lỗi điển hình và thiết kế bộ test lớn hơn.

## Thứ tự thử nghiệm tiếp theo

1. **Kiểm tra độ phủ ảnh catalog theo SKU.** Đối chiếu ảnh có thể đọc,
   số vector đang được phục vụ và sản phẩm còn hoạt động. Tách ảnh góc
   khác khỏi ảnh gần trùng. Ưu tiên các mẫu đúng biến mất khi bỏ ảnh phụ
   như Boston và NAB166. Đo với ảnh holdout để tránh dùng cùng ảnh cho
   cả truy vấn và gallery.
2. **Ưu tiên gợi ý khoanh vùng khi ảnh chụp màn hình hoặc có nhiều món.**
   Thử trên ảnh chat thật, ảnh chụp trang bán hàng và lưới có nhiều món.
   So toàn ảnh, crop sát và crop giữ một ít bối cảnh trên cùng query.
   Với nhiều món, ghi nhãn món khách muốn tìm và giữ thao tác xác nhận
   vùng. Đo cả lỗi chọn nhầm món trong cùng nhóm.
3. **Thử phục hồi ứng viên yếu theo bằng chứng bổ sung.** Đánh giá
   riêng JPEG nén mạnh, ảnh nghiêng và ảnh chụp trên người. Thử cho
   ứng viên dưới ngưỡng cơ sở đi tiếp vào vòng xếp hạng khi có tín hiệu
   xác nhận độc lập từ nhiều ảnh gallery, hoặc văn bản của khách khớp
   danh mục/thuộc tính được kiểm chứng. Dùng nhóm sai kiểu để đo phần
   kết quả nhầm thêm trước khi quyết định dùng phương án.
4. **Đo lại cả luồng storefront.** Dùng
   [evaluator hiện tại](./image-search-evaluation.md) với một bộ ảnh và
   nhãn được giữ riêng. So image-only và image+text trên Recall@10,
   NDCG@10, tỷ lệ đúng bộ lọc và p95. Evaluator hiện yêu cầu ít nhất một
   nhãn dương. Cần bổ sung ca mong đợi trả rỗng rõ ràng để đo tỷ lệ trả
   nhầm qua Gateway. Kiểm cả thay giá, hết hàng, ảnh bị đổi và phiên tìm
   ảnh đã lưu. Dùng ảnh thật đã được phép kiểm thử.

Đánh giá các nhóm khó riêng. Một phương án có thể tăng Recall tổng thể
nhưng vẫn phải kiểm ca Boston/Rencho, giày chấm bi đúng kiểu, độ chính xác
bộ lọc và tỷ lệ trả nhầm trên ảnh không có đích trước khi triển khai.

## Các kịch bản cần giữ trong bộ hồi quy

| Thao tác hoặc ảnh của khách                               | Kết quả mong đợi                                                       | Cách kiểm chứng                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Chụp lại đúng món ở góc khác                              | Cùng sản phẩm đứng trước mẫu cùng loại                                 | Dùng ảnh chụp hoặc ảnh gallery giữ ngoài index theo SKU         |
| Tìm áo trắng từ ảnh có áo trắng và áo đen                 | Vùng đã chọn ưu tiên đúng món và màu                                   | Gắn nhãn cả hai phía, thử ảnh gốc, vùng trái và vùng phải       |
| Tìm giày chấm bi từ ảnh quảng cáo hoặc ảnh mang trên chân | Mẫu thay thế đúng kiểu quai và họa tiết đứng trước giày khác kiểu      | Gắn nhãn theo kiểu dáng, màu và họa tiết trước khi xem thứ hạng |
| Tìm dép sục kín mũi                                       | Boston đứng trước dép hở mũi, ảnh Rencho thật vẫn tìm đúng Rencho      | Giữ cả query dương lẫn hard negative cùng góc hoặc nền          |
| Ảnh nhỏ, JPEG nén mạnh, tối hoặc mờ                       | Có thể trả mẫu phù hợp dù giảm chất lượng ảnh                          | Dùng cùng SKU và một biến đổi có thể tái lập trên mỗi query     |
| Ảnh xoay 90°, nghiêng, mất góc hoặc bị che                | Tìm đúng khi còn đủ chi tiết nhận diện                                 | Đo riêng từng mức thay vì gộp chung một điểm                    |
| Sản phẩm nhỏ lệch góc trên nền rối                        | Kết quả dựa trên vùng chứa sản phẩm                                    | So sánh toàn khung với vùng sản phẩm đã chọn                    |
| Ảnh tài liệu, màu trơn hoặc catalog thiếu nhóm sản phẩm   | Trả rỗng nếu chưa có mẫu phù hợp                                       | Gắn nhãn rỗng rõ ràng và đếm tỷ lệ trả nhầm                     |
| Ảnh kèm từ khóa có dấu, không dấu, tên gọi khác           | Mô tả đúng cải thiện thứ hạng, ảnh vẫn có kết quả khi tên catalog khác | So sánh image-only và image+text trên cùng ảnh và nhãn          |
| Khách đổi giá, còn hàng, trang hoặc cách sắp xếp          | Mọi kết quả thuộc catalog hiện thời và thỏa bộ lọc                     | Kiểm qua Gateway với cả phiên vừa tạo và phiên đã có            |

DeepFashion2 dùng cặp ảnh khách và ảnh shop, đồng thời gắn nhãn góc chụp,
kích thước và che khuất. Các chiều đánh giá đó phù hợp để bổ sung bộ ảnh
khách tự chụp sau khi có đủ mẫu và nhãn.
[Bài báo DeepFashion2](https://openaccess.thecvf.com/content_CVPR_2019/papers/Ge_DeepFashion2_A_Versatile_Benchmark_for_Detection_Pose_Estimation_Segmentation_and_CVPR_2019_paper.pdf)

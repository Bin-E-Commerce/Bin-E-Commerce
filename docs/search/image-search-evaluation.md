# Đánh giá tìm sản phẩm bằng hình ảnh

Evaluator của Phase 6 chạy từ Recommendation Service nhưng gọi public Product
API để đo đúng luồng mà storefront sử dụng. Evaluator không tạo nhãn tự động và
không gửi ảnh tới dịch vụ ngoài; ảnh truy vấn được gửi tới đúng API origin do
người chạy chỉ định.

## Chuẩn bị bộ query có nhãn

Tạo một thư mục dataset riêng. Mỗi dòng của `queries.jsonl` là một query ảnh;
đường dẫn ảnh phải tương đối với file JSONL và nằm trong cùng thư mục dataset.
Nhãn chỉ liệt kê product có liên quan; product không có trong danh sách được
xem như grade 0. Người đánh giá nên xem catalog và gán grade nhất quán:

- `3`: cùng sản phẩm hoặc biến thể trực quan gần như giống hệt.
- `2`: sản phẩm thay thế rất gần về kiểu dáng/chức năng.
- `1`: có điểm tương tự hữu ích nhưng khác biệt đáng kể.

```jsonl
{"queryId":"q-001","image":"images/query-001.jpg","text":"áo khoác xanh","filters":{"inStock":true,"minPrice":200000,"maxPrice":900000},"relevance":[{"productId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","grade":3},{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","grade":1}]}
{"queryId":"q-002","image":"images/query-002.webp","relevance":[{"productId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","grade":2}]}
```

`text`, `filters` và `queryId` có thể bỏ tùy trường hợp; mỗi case cần ít nhất
một nhãn dương. Filter hỗ trợ `categoryId`, `sellerShopId`, `minPrice`,
`maxPrice`, `minRating`, `inStock`. Giá dùng đơn vị catalog hiện tại. Query text
tối đa 120 ký tự. Dataset không nhận URL ảnh, đường dẫn tuyệt đối, trường filter
không hỗ trợ hoặc product ID không phải UUID.
`inStock: true` bật điều kiện có hàng; `false` tương đương bỏ điều kiện theo
contract hiện tại của Product Service, không có nghĩa là chỉ tìm sản phẩm hết hàng.

Nên có các query đại diện cho nhiều ngành hàng, nền/chất lượng ảnh khác nhau,
ảnh chụp và ảnh catalog, cùng các trường hợp ảnh khó. Dùng cùng danh sách query,
filter và nhãn cho hai scenario để so sánh công bằng. Việc gán nhãn phải độc lập
với thứ tự kết quả của evaluator; không dùng vector similarity làm nhãn. Recall
chỉ có ý nghĩa khi danh sách grade dương đủ đầy cho catalog đã đánh giá; nhãn
thiếu sẽ làm mẫu số thấp và khiến điểm có thể cao hơn chất lượng thật.

## Chạy

Từ thư mục `services/recommendation-service`:

```powershell
npm run image-search-evaluate -- --dataset <dataset-folder>/queries.jsonl --output <report-folder>/image-search-report.json --base-url http://localhost:3000 --max-cases 10
```

Hoặc đặt `IMAGE_SEARCH_EVALUATION_BASE_URL` thay cho `--base-url`. Base URL chỉ
nhận origin HTTP/HTTPS, không nhận credentials, query, fragment hoặc path prefix.
Chỉ chạy với endpoint đáng tin cậy: file ảnh trong dataset sẽ được gửi tới
Product API origin đã chọn.

Evaluator giữ giới hạn vận hành cố định:

- Mặc định chạy 10 case; tối đa 500 case mỗi lần.
- Chỉ nhận JPEG, PNG hoặc WebP qua signature của file; mỗi ảnh tối đa 5 MiB.
- Mỗi POST cách nhau tối thiểu 6,1 giây để tôn trọng giới hạn 10 request/phút.
- Detail GET xác minh tồn kho được gửi tuần tự, cách nhau ít nhất 650 ms; ID
  trùng trong cùng response dùng chung lookup; mỗi scenario mới đọc lại Product
  detail để không dùng tồn kho cache đã cũ. Report đếm riêng detail lookups.
- Mỗi request có timeout 30 giây; redirect bị từ chối để bytes ảnh không bị
  chuyển tiếp sang origin khác. Detail lookup lỗi sẽ dừng run để tránh tiếp tục
  tạo tải khi catalog authority không sẵn sàng.
- POST gửi `X-Requested-With: XMLHttpRequest` giống frontend; Gateway yêu cầu
  header này cả trên endpoint public, nếu thiếu sẽ trả 403 trước Product Service.
- HTTP 429, timeout client/server (408), network failure, lỗi search 5xx, sai
  endpoint/quyền truy cập hoặc response sai contract sẽ dừng các case tiếp theo.
  Fallback được ghi thành trạng thái riêng; response lỗi không được dùng để tính
  Recall/NDCG.
- Output đã loại query ID, text, đường dẫn, bytes ảnh, URL và product ID. Mặc
  định không ghi đè báo cáo cũ; thêm `--overwrite` khi muốn thay file.

Ảnh chỉ được đọc vào RAM theo từng case; evaluator không copy ảnh vào report,
cache hoặc thư mục output. Không log body hoặc response của Product API.

## Định nghĩa metrics

- **Recall@10:** macro-average số product được trả trong top 10 có nhãn grade
  dương chia cho tổng product có nhãn dương của query.
- **NDCG@10:** macro-average với gain `2^grade - 1` và discount
  `log2(rank + 1)`; product không có nhãn có gain 0.
- **Filter compliance:** số product trả về đã xác minh thỏa mọi ràng buộc chia
  cho tổng product đã xác minh. Sản phẩm thiếu field hoặc không đọc được detail
  tồn kho được đếm là `unverifiable`, nằm ngoài mẫu số và báo riêng.
- **Latency p50/p95:** nearest-rank trên thời gian response HTTP thành công của
  endpoint image search; không gồm thời gian chờ rate limit hay Product detail
  GET. Lỗi HTTP/network không được đưa vào percentile và có bộ đếm riêng.
- Fallback `TEXT_FALLBACK` được tính riêng nhưng bỏ khỏi Recall/NDCG của scenario
  ảnh để không xem text search là kết quả retrieval ảnh. Scenario image+text chỉ
  chạy nếu case có `text`.

Kết quả JSON có aggregate riêng cho image-only và image+text cùng bảng case theo
số thứ tự. `null` nghĩa là chưa có query đủ điều kiện để tính metric, không phải
điểm 0.

## Chi phí và giới hạn

Phase này không thêm provider/API tính phí. Với PE-Core ONNX self-host, mỗi query
dùng CPU/RAM của AI Service, Qdrant và Product API hiện có; filter `inStock`
còn gọi public detail để kiểm chứng inventory. Tốc độ mặc định giới hạn tối đa
xấp xỉ 9,8 search POST/phút. Chi phí tiền tệ phụ thuộc cấu hình hạ tầng hiện tại
và không thể ước tính khi chưa có cấu hình deployment/usage; không có phí
embedding bên thứ ba cho mỗi ảnh.

## Kiểm chứng chỉ đọc ngày 25/11/2026

AI local đã trả `ready: true`, model `pe-core-s16-384-r255fa76e`, dimension 512,
preprocess `pe-core-image-transform-v1`. Alias ảnh đang trỏ collection v1 một
vector/product với 260 point; ngưỡng runtime là 0,65. Source mới dùng collection
v2 MaxSim và ngưỡng mặc định 0,75, chưa được triển khai/backfill trong lần review.

Trên đúng ảnh dép Boston người dùng cung cấp, query trực tiếp qua model local và
collection ảnh đang được alias phục vụ cho kết quả:

| Phép đo                                 | Kết quả    |
| --------------------------------------- | ---------- |
| Thứ hạng sản phẩm đích trước ngưỡng     | 12/260     |
| Cosine với ảnh đại diện đã index        | 0,60385454 |
| Số candidate đạt 0,65                   | 3          |
| Số candidate đạt 0,75                   | 2          |
| Thời gian model HTTP nội bộ, một lần đo | 4.407 ms   |
| Thời gian Qdrant query, một lần đo      | 933 ms     |

Đây là đo retrieval trực tiếp, chưa qua lọc/hydrate Product, không phải latency
public API hay p50/p95. Sản phẩm đích không nằm top 10 và bị ngưỡng runtime loại.
Số điểm cosine 0,7854 của ảnh gallery từ phép đo trước không chứng minh thứ hạng
sau backfill đa ảnh; cần đo lại trên collection v2 sau triển khai.

HTTP local với header frontend đã trả 400 cho MIME không hỗ trợ, PNG hỏng và
body rỗng; body trên 5 MiB trả 413. Tìm chữ `Boston` trả HTTP 200 với hai kết quả.
Không chạy POST tìm ảnh hợp lệ qua stack đang bật vì có thể tạo index/session ở
dịch vụ bên ngoài. Không backfill, chuyển alias hoặc restart stack trong review.

Repo chưa có bộ query ảnh được gán nhãn độc lập cho nhiều ngành hàng. Các test
unit xác minh parser, công thức metric, filter check và request contract; chưa
có benchmark image-only/image+text, filter compliance thực tế hoặc p50/p95 đủ mẫu.
Không dùng tỷ lệ pass unit test như thước đo chất lượng retrieval.

Kiểm chứng source sau sửa lỗi rollout và header benchmark:

| Phạm vi                                                | Kết quả                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| Recommendation image-index + evaluator                 | 9 suite, 63 test pass                                               |
| Product snapshot + image-search + storefront liên quan | 8 suite, 19 test pass                                               |
| Web product-search hook/panel                          | 2 suite, 12 test pass (JSDOM, API giả)                              |
| Build Product/Recommendation                           | `npm run build` và Docker target `production` đạt                   |
| Web                                                    | `npm run type-check` đạt; `npm run lint` không có error, 32 warning |
| Định dạng/cấu hình                                     | Prettier, `git diff --check`, `docker compose config --quiet` đạt   |

Lệnh tái kiểm tra Recommendation từ thư mục service:

```powershell
npm test -- --runInBand --config jest.config.cjs src/modules/catalog/image-index src/scripts/image-search-evaluation
```

Lệnh UI từ `web`:

```powershell
npm test -- --runInBand src/features/product-search
npm run type-check
npm run lint
```

JSDOM không thay thế kiểm thử browser end-to-end với Product/AI/Qdrant/Redis thật.
Lần review này chưa xác nhận luồng ảnh hợp lệ qua UI đến kết quả trên index v2.

Backfill tối đa năm ảnh cho 260 sản phẩm cần tối đa 1.300 lần inference nội bộ
và khoảng 2,54 MiB vector float32 thô, chưa gồm payload/index/replica. Không có
phí API embedding bên thứ ba; chi phí CPU/RAM và Qdrant phụ thuộc deployment.

## So sánh ảnh biến đổi trên local ngày 25/11/2026

Đo trước và sau khi AI Service bỏ viền đồng màu rõ ràng, ghép pixel alpha lên
nền trung tính và dùng cùng ảnh đã giải mã cho mọi góc nhìn của query. Cả hai
lượt dùng endpoint Product Service, cùng model, collection Qdrant v2 và bộ lọc
mặc định. Mỗi lượt chạy tuần tự 29 ảnh gồm 27 truy vấn có một sản phẩm đích và
hai ảnh không chứa sản phẩm. Mỗi trường hợp được gọi một lần mỗi lượt.

| Chỉ số trên bộ ảnh thử                       | Trước sửa   | Sau sửa     |
| -------------------------------------------- | ----------- | ----------- |
| Sản phẩm đích hạng 1                         | 19/27       | 22/27       |
| Sản phẩm đích trong top 10                   | 24/27       | 24/27       |
| NDCG@10 theo một nhãn đích mỗi truy vấn      | 0,8083      | 0,8567      |
| Boston hạng 1                                | 5/12        | 8/12        |
| Rencho Zurich xuất hiện khi tìm ảnh Boston   | 8/12        | 5/12        |
| Rencho Zurich đứng hạng 1 khi tìm ảnh Boston | 6/12        | 3/12        |
| Ảnh không chứa sản phẩm trả rỗng             | 2/2         | 2/2         |
| Độ trễ HTTP p50/p95 của lượt chạy local      | 1,60/3,02 s | 1,57/3,12 s |

Mười hai biến thể Boston dùng ảnh người dùng gửi. Nhóm này gồm ảnh gốc, lật
ngang, xoay 90° không có EXIF, đặt lên nền vuông với chiều rộng 70% và 45%
(lệch tâm), nghiêng 12°, crop còn mũi, crop mất mũi, làm tối và mờ, thêm viền
trong suốt, thêm nền kẻ và JPEG cạnh dài 160 px nén mạnh. Cả hai ca khung vuông
và ca viền alpha cải thiện lên hạng 1, đồng thời bỏ Rencho. Ảnh xoay 90° không EXIF
vẫn hạng 2. Khi mất mũi, nền rối hoặc JPEG quá nhỏ, Rencho vẫn có thể đứng đầu.

Mười lăm ảnh đối chứng lấy từ catalog của Rencho Zurich, dép ELEMENTS,
sneaker Enter Dragon, túi du lịch chấm bi và áo phông KIRKLAND. Với mỗi
sản phẩm, thử khung vuông 512 px chứa ảnh ở 58% cạnh khung, ảnh nghiêng
15° và JPEG cạnh dài 160 px. Cả hai bản đều trả đúng hạng 1 ở 14/15 ca.
Ảnh sneaker nén mạnh trả rỗng. Hai đối chứng âm là ảnh trơn và ảnh trong suốt.
Các chỉ số này đo độ ổn định với phép biến đổi, vì nhiều ảnh dùng chung ảnh
gốc catalog và mỗi truy vấn chỉ có một nhãn liên quan được chấm.

Kiểm tra riêng qua API Gateway sau triển khai xác nhận WebP lossless và PNG
xoay có EXIF đều trả riêng Boston. Họa tiết hình học trả rỗng. Phiên tìm ảnh
giữ đúng kết quả với bộ lọc còn hàng, giá tối đa và phân trang. Mô tả `Boston`
cho một kết quả, `tui xach` cho rỗng. MIME sai, PNG hỏng và định dạng ngoài
danh sách đều trả HTTP 400.

Đổi khung vuông thành nội dung dài có thể kích hoạt thêm hai lượt inference và
một truy vấn batch Qdrant. Với ảnh dài cần ba vector, mỗi cache miss hiện chỉ
decode ảnh một lần. Cache hit dùng lại bộ vector trong RAM. Lượt đo local có
trạng thái cache khác nhau, nên độ trễ trong bảng phản ánh lần chạy này.

## Kiểm thử lại bốn biến thể Boston khó

So với bản đã chuẩn hóa viền ở trên, lần này AI Service thử thêm hai hướng
xoay 90° trên ảnh dọc. Recommendation chỉ chọn hướng xoay khi cosine dẫn
đầu tăng rõ, ảnh gốc hỗ trợ ứng viên đó và hai hướng không mâu thuẫn. Product
dùng điểm từ hai hướng còn lại để kiểm tra ứng viên sau khi lọc catalog.
Với nền rối, AI Service chỉ cắt khi thấy một khung nổi có đủ bốn cạnh và
xác định lại vị trí mép trên ảnh gốc trước khi tạo vector.

| Ảnh truy vấn                    | Trước sửa lần này       | Sau sửa                |
| ------------------------------- | ----------------------- | ---------------------- |
| Xoay 90° thiếu EXIF             | Boston #2, Rencho #4    | Boston #1, một kết quả |
| Nền kẻ, có khung ảnh lồng rõ    | Boston #3, Rencho #1    | Boston #1, một kết quả |
| JPEG 160 × 76 px, chất lượng 28 | Rencho #1, thiếu Boston | 0 kết quả              |
| Crop mất mũi dép                | Rencho #1, thiếu Boston | 0 kết quả              |

Ngưỡng 0,80 áp dụng với ảnh upload rất nhỏ và hẹp, hoặc ảnh nền tương đối
đồng nhất có một bên tiền cảnh bị cắt rõ. Hai ca trả rỗng vẫn thiếu tín
hiệu để nhận diện Boston. Khử nhiễu, làm nét và thay phép resize trong thử nghiệm
vẫn cho Rencho điểm cao hơn Boston ở JPEG nén mạnh. Kết quả nền rối áp dụng cho
mẫu có khung nhận diện rõ.

Chạy lại cùng 29 ca, tỷ lệ hạng 1 tăng từ 22/27 lên 24/27 và NDCG@10 từ
0,8567 lên 0,8889. Recall@10 vẫn là 24/27. Trong 12 biến thể Boston, Rencho
xuất hiện ở 1 ca thay vì 5 ca, cụ thể là hạng 2 ở ảnh nghiêng 12°. Hai ảnh
không có sản phẩm vẫn trả rỗng. Ba ca bổ sung gồm Boston xoay chiều ngược
lại, ảnh Rencho thật vuông 90 px và ảnh túi du lịch dọc, đều giữ sản phẩm
đích ở hạng 1.

Cả bốn ca chính được xác nhận lại qua API Gateway với bộ lọc mặc định.
25 kiểm thử AI Service, 38 kiểm thử Recommendation và 14 kiểm thử Product
đạt. Runtime dùng tối đa ba lần inference mỗi ảnh và collection Qdrant v2 hiện
có.

## Đối chiếu ảnh nghiêng 12°

Trước sửa, với ảnh Boston nghiêng 12°, vùng ủng hộ Boston tách Rencho
0,05032 điểm. Vùng còn lại nghiêng về Rencho 0,03013 điểm nên luật cũ giữ
cả hai. Điểm toàn ảnh lần lượt là 0,84679 và 0,82259. Khi các vùng cho
tín hiệu trái chiều, Product hiện chỉ loại ứng viên nếu mốc hơn ít nhất
0,020 điểm toàn ảnh và lợi thế vùng ủng hộ vượt vùng phản đối ít nhất
0,015. Việc chọn mốc vẫn diễn ra sau khi xác minh catalog và áp bộ lọc.

| Ảnh thử                         | Trước sửa               | Sau sửa                 |
| ------------------------------- | ----------------------- | ----------------------- |
| Boston nghiêng 12°              | Boston #1 và Rencho #2  | Boston #1, một kết quả  |
| Boston gốc                      | Boston #1, một kết quả  | Boston #1, một kết quả  |
| Rencho thật, ba ảnh catalog     | 3/3 trả riêng Rencho #1 | 3/3 trả riêng Rencho #1 |
| Cùng ba ảnh Rencho, nghiêng 12° | 3/3 trả riêng Rencho #1 | 3/3 trả riêng Rencho #1 |
| Rencho thật thu nhỏ còn 90 px   | Rencho #1, một kết quả  | Rencho #1, một kết quả  |
| Boston nghiêng 16°              | Rencho #1 và Boston #2  | Rencho #1 và Boston #2  |

Ba lần tìm ảnh Boston nghiêng 12° qua API Gateway đều trả đúng một sản
phẩm Boston. Gateway cũng trả riêng sản phẩm đích cho ảnh Boston gốc, một
ảnh Rencho gốc, phiên bản nghiêng 12° và phiên bản 90 px. Ảnh Boston 16°
thử thêm có Rencho dẫn đầu theo điểm toàn ảnh và thiếu điểm hai vùng, nên
luật cân bằng tín hiệu trái chiều chưa áp dụng ở ca đó.

Chạy lại 32 ca hồi quy của lượt trước. Thay đổi duy nhất về hạng đích, số
kết quả hoặc sự xuất hiện của Rencho là ca Boston nghiêng 12°. Rencho vắng
mặt trong 12 biến thể Boston của bộ hồi quy. Ca 16° là đối chứng bổ sung
ngoài bộ này.

Bản sửa chạy trong Product Service và dùng các điểm cosine đã có. Prettier,
ESLint, type-check, build và 19 kiểm thử liên quan của Product Service đạt.

## Khôi phục khung ảnh Boston nghiêng 16°

Ảnh quay 16° có kích thước 971 × 652 px, tỷ lệ khoảng 1,489. Ở bản trước,
tỷ lệ này vào nhánh cắt giữa. Hai vùng chi tiết bị bỏ qua và Rencho có
điểm toàn ảnh cao hơn Boston. AI Service hiện dùng preview để dò khung
ngang có viền phẳng. Chỉ chỉnh góc khi hình bao thu gọn rõ rệt và hai cạnh
đối diện đủ thẳng. Sau khi chỉnh, khung ngang lại dùng toàn ảnh và hai vùng
chi tiết trong cùng không gian vector PE-Core.

| Ảnh thử                         | Trước sửa               | Sau sửa                 |
| ------------------------------- | ----------------------- | ----------------------- |
| Boston nghiêng 16°              | Rencho #1, Boston #2    | Boston #1, một kết quả  |
| Boston nghiêng 12°              | Boston #1, một kết quả  | Boston #1, một kết quả  |
| Rencho thật, ba ảnh gốc         | 3/3 trả riêng Rencho #1 | 3/3 trả riêng Rencho #1 |
| Cùng ba ảnh Rencho, nghiêng 12° | 3/3 trả riêng Rencho #1 | 3/3 trả riêng Rencho #1 |
| Rencho thật thu nhỏ còn 90 px   | Rencho #1, một kết quả  | Rencho #1, một kết quả  |

Gateway xác nhận ảnh Boston 16° ở cả hai lượt sau sửa. Test hình học còn
kiểm tra hai chiều nghiêng và trường hợp vật thể cong trên nền phẳng.
Trong 32 ca hồi quy của lượt trước, số lượng, sản phẩm và thứ tự kết quả
giữ nguyên. Ca Boston 16° được đo riêng ngoài bộ hồi quy này.
Ruff, mypy, Docker build và 28 kiểm thử ảnh của AI Service đạt.

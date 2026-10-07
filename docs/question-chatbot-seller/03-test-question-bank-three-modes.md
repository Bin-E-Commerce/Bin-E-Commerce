# Bộ câu hỏi kiểm thử 3 mode Seller Copilot

Tài liệu này dùng để kiểm thử thủ công ba lựa chọn trong menu Seller Copilot: **Trò chuyện**, **Dữ liệu shop** và **Tài liệu**. Các câu được viết theo cách người bán có thể hỏi thật, gồm câu nối tiếp, cách diễn đạt khác nhau và tình huống dễ chọn nhầm nguồn.

Đây là bộ câu hỏi và tiêu chí kiểm tra, không phải nguồn chính sách mới. Với số liệu live, kết quả kỳ vọng phải lấy từ fixture của shop kiểm thử tại thời điểm chạy. Với chính sách, chỉ chấp nhận nội dung và trích dẫn có trong kho tài liệu đang published.

## Cách chạy và ghi nhận

1. Chạy từng câu trong đúng mode ghi ở bảng; mỗi nhóm bắt đầu bằng một hội thoại mới, trừ ca ghi rõ là nối tiếp.
2. Ghi lại câu trả lời, mode thực tế, số liệu, card/biểu đồ, nguồn và citation nếu có.
3. Với câu hỏi yêu cầu đổi mode, kiểm tra trợ lý hướng dẫn đúng mode và không âm thầm gọi nguồn của mode khác.
4. Không chấm câu trả lời live theo một con số cố định nếu fixture chưa được reset. So sánh với dữ liệu của chính shop test, đúng trạng thái và khoảng thời gian.

### Fixture tối thiểu cho nhóm Dữ liệu shop

Nên chuẩn bị shop test có 4 sản phẩm catalog (trong đó có sản phẩm chưa bán), ít nhất 2 sản phẩm từng có giao dịch hoàn tất, các biến thể với tồn kho khác nhau, và đơn ở các trạng thái `PENDING_CONFIRMATION`, `PENDING_SHIPMENT`, `SHIPPING`, `DELIVERED`, `COMPLETED`, `CANCELLED`, `RETURN_REFUND`. Có ít nhất một đơn hủy có lý do và một đơn hoàn trả có lý do riêng. Tạo doanh thu ở tháng 9/2026 và một kỳ khác để kiểm tra ranh giới tháng và biểu đồ.

Nếu fixture không có một trạng thái hoặc lý do, expected của ca đó phải là “nguồn hiện không có bản ghi/không có trường lý do”, không được tạo dữ liệu thay thế.

## 1. Mode Trò chuyện

Trong mode này, xã giao và hội thoại thông thường được trả lời tự nhiên. Câu hỏi cần dữ liệu shop, tài liệu hoặc thao tác phải được nhận diện đúng và hướng người dùng sang mode phù hợp; không trả số liệu/chính sách như thể đã tra cứu.

| ID      | Câu hỏi                                                | Kết quả cần kiểm tra                                                                                                     |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| CHAT-01 | Chào BinGPT, hôm nay bạn thế nào?                      | Trả lời xã giao tự nhiên; không báo thiếu tài liệu.                                                                      |
| CHAT-02 | Mình hơi buồn nè, nói chuyện với mình chút được không? | Phản hồi đồng cảm; không gọi live data hoặc knowledge retrieval.                                                         |
| CHAT-03 | Có gì vui kể mình nghe đi.                             | Trò chuyện bình thường, không yêu cầu người dùng chuyển mode.                                                            |
| CHAT-04 | Bạn có thể giúp mình việc gì?                          | Giải thích khả năng chung ngắn gọn; không hiển thị thông báo “không tìm thấy tài liệu”.                                  |
| CHAT-05 | Doanh thu tháng 9/2026 của shop mình bao nhiêu?        | Không đoán số; hướng sang **Dữ liệu shop**. Không gọi dashboard trong mode Trò chuyện.                                   |
| CHAT-06 | Shop mình hiện có bao nhiêu sản phẩm?                  | Hướng sang **Dữ liệu shop**; không trả số nhớ từ hội thoại cũ.                                                           |
| CHAT-07 | Đơn BIN-123 hiện đang ở trạng thái nào?                | Hướng sang **Dữ liệu shop**; không tự suy ra trạng thái từ mã đơn.                                                       |
| CHAT-08 | Chính sách hoàn tiền khi khách trả hàng là gì?         | Hướng sang **Tài liệu**; không dùng kiến thức nền để tự kết luận chính sách.                                             |
| CHAT-09 | Đơn giao thất bại thì shop cần làm gì theo quy định?   | Hướng sang **Tài liệu** nếu hỏi quy trình chung; không nhầm với danh sách đơn live.                                      |
| CHAT-10 | Tăng tồn kho áo thun size M lên 20 cái giúp mình.      | Không cập nhật và không tạo proposal trong mode này; hướng sang **Agent** nếu tính năng thao tác được bật.               |
| CHAT-11 | So với tháng trước thì sao?                            | Nếu hội thoại Trò chuyện không có nguồn/kỳ hợp lệ, không lấy dữ liệu từ mode khác; hỏi lại hoặc hướng sang mode dữ liệu. |
| CHAT-12 | Cảm ơn bạn nha.                                        | Trả lời ngắn tự nhiên; không phát sinh truy vấn nghiệp vụ.                                                               |

## 2. Mode Dữ liệu shop

Kết quả phải lấy từ dashboard/order/product/profile live của đúng shop. Câu trả lời, card và biểu đồ phải cùng nguồn, cùng kỳ, cùng tập kết quả. Nếu thiếu dữ liệu hoặc snapshot bị giới hạn, phải nói rõ thay vì suy luận.

### 2.1 Sản phẩm, danh mục và tồn kho

| ID       | Câu hỏi                                                          | Kết quả cần kiểm tra                                                                                                                                    |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHOP-P01 | Shop mình có tất cả bao nhiêu sản phẩm?                          | Trả `catalogProducts`, phân biệt với số sản phẩm đang bán và số đơn vị tồn.                                                                             |
| SHOP-P02 | Liệt kê tất cả sản phẩm hiện có trong shop.                      | Hiển thị danh sách từ catalog, số trên card khớp số item thực trả; không chỉ lấy sản phẩm bán chạy.                                                     |
| SHOP-P03 | Shop có 4 sản phẩm, cho mình thông tin cả 4 sản phẩm này.        | Trả đúng cả 4 nếu catalog snapshot có đủ; mỗi item/card gắn đúng tên, ảnh, trạng thái và tồn. Nếu `hasMore`, phải nói danh sách đang hiển thị một phần. |
| SHOP-P04 | Cửa hàng đang bán những mặt hàng nào?                            | Chỉ liệt kê trạng thái đang bán nếu dữ liệu nguồn phân biệt được; không gọi toàn catalog là đang bán.                                                   |
| SHOP-P05 | Có bao nhiêu sản phẩm còn hàng và tổng cộng còn bao nhiêu chiếc? | Trả riêng số sản phẩm có hàng và tổng đơn vị tồn; không đánh tráo hai metric.                                                                           |
| SHOP-P06 | Sản phẩm nào đang gần hết hàng?                                  | Dùng ngưỡng tồn thấp của từng biến thể; không chỉ nhận cách nói “sắp hết hàng”. Nêu biến thể/tồn nếu có.                                                |
| SHOP-P07 | Sản phẩm nào đã hết hàng?                                        | Chỉ biến thể/sản phẩm có tồn khả dụng bằng 0; không đưa mặt hàng còn 1–5 chiếc nếu ngưỡng riêng chưa xác nhận.                                          |
| SHOP-P08 | Áo thun màu đen size M còn bao nhiêu?                            | Tra đúng sản phẩm và biến thể; nếu trùng tên/không xác định được biến thể thì hỏi làm rõ.                                                               |
| SHOP-P09 | Cho mình thông tin chi tiết của sản phẩm “Giày thể thao”.        | Trả chi tiết đúng sản phẩm, ảnh và biến thể từ catalog; không gắn ảnh sản phẩm khác.                                                                    |
| SHOP-P10 | Sản phẩm này có những size nào?                                  | Chỉ dùng khi câu trước có duy nhất một sản phẩm xác định; nếu trước đó là danh sách nhiều món thì hỏi chọn sản phẩm.                                    |
| SHOP-P11 | Có những sản phẩm nào chưa bán được đơn nào?                     | Lấy catalog trừ sản phẩm có giao dịch hoàn tất trong đúng kỳ; nếu aggregate doanh số bị giới hạn thì không kết luận đầy đủ.                             |
| SHOP-P12 | Những sản phẩm nào có doanh thu trong 30 ngày qua?               | Chỉ sản phẩm có giao dịch hoàn tất trong 30 ngày; loại đơn đang giao, đã giao nhưng chưa hoàn tất, hủy và hoàn trả.                                     |
| SHOP-P13 | Sản phẩm nào bán chạy nhất tháng 9/2026?                         | Xếp hạng từ số lượng bán của đơn hoàn tất trong tháng 9/2026; không dùng `totalSold` tích lũy.                                                          |
| SHOP-P14 | Sản phẩm nào bán được nhiều đơn vị nhất?                         | Xếp theo quantity sold, không xếp theo số sản phẩm catalog hoặc số đơn; nếu hòa, giải thích tiêu chí phụ có dữ liệu.                                    |
| SHOP-P15 | Mỗi sản phẩm đã bán được bao nhiêu trong tháng này?              | Danh sách chỉ gồm sản phẩm có bán trong khoảng từ đầu tháng đến hiện tại; ghi rõ tháng chưa kết thúc.                                                   |
| SHOP-P16 | Sản phẩm nào chưa có doanh thu trong tháng 9/2026?               | Phần bù catalog với doanh số đơn hoàn tất cùng kỳ; không lẫn sản phẩm chỉ đang vận chuyển.                                                              |

### 2.2 Doanh thu và kỳ thời gian

| ID       | Câu hỏi                                                                   | Kết quả cần kiểm tra                                                                                               |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SHOP-R01 | Doanh thu tháng 9/2026 của shop là bao nhiêu?                             | Tính trọn tháng lịch 01–30/09/2026 theo timezone Việt Nam; chỉ tính đơn hoàn tất theo quy tắc dashboard.           |
| SHOP-R02 | Doanh thu tháng 9 năm ngoái là bao nhiêu?                                 | Resolve đúng tháng 9 của năm trước theo ngày hiện tại/fixture; không đổi thành 30 ngày gần nhất.                   |
| SHOP-R03 | So sánh doanh thu tháng này với tháng trước.                              | Tháng hiện tại là tạm tính đến hôm nay; tháng trước là toàn tháng; nêu rõ hai kỳ và phép tính.                     |
| SHOP-R04 | Doanh thu 30 ngày gần nhất là bao nhiêu?                                  | Dùng đúng khoảng 30 ngày rolling, không đổi thành tháng lịch.                                                      |
| SHOP-R05 | Doanh thu ngày 30/09/2026 là bao nhiêu?                                   | Lấy đúng ngày địa phương; không lệch sang 29/09 hoặc 01/10 do UTC.                                                 |
| SHOP-R06 | Trong tháng 9 có những ngày nào phát sinh doanh thu?                      | Các ngày và tổng trên biểu đồ khớp dữ liệu trả lời; ngày không có doanh thu thể hiện đúng theo UI, không bịa điểm. |
| SHOP-R07 | Doanh thu tháng này tăng hay giảm so với tháng trước bao nhiêu phần trăm? | Phần trăm tính từ đúng KPI hai kỳ; nếu mẫu số bằng 0/thiếu thì nêu không thể tính, không chia giả.                 |
| SHOP-R08 | Doanh thu của đơn đang giao có được tính chưa?                            | Phân biệt theo quy tắc nguồn; không cộng đơn SHIPPING vào doanh thu nếu metric đã chốt chỉ lấy đơn hoàn tất.       |
| SHOP-R09 | Biểu đồ doanh thu có khớp con số tổng ở trên không?                       | Tổng các điểm biểu đồ bằng KPI trong cùng range; không có ngày hoặc đơn vị lệch.                                   |
| SHOP-R10 | Xem doanh thu từ tháng 12/2025 đến tháng 1/2026.                          | Khoảng thời gian đi qua ranh giới năm phải bao gồm đủ cả hai tháng/ngày được hỏi.                                  |

### 2.3 Đơn hàng và trạng thái

| ID       | Câu hỏi                                                  | Kết quả cần kiểm tra                                                                                                                |
| -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| SHOP-O01 | Hiện có bao nhiêu đơn đã hoàn thành?                     | Dùng aggregate trạng thái COMPLETED, không đếm danh sách tối đa 5 đơn gần nhất.                                                     |
| SHOP-O02 | Những đơn hoàn thành đó là đơn nào?                      | Danh sách chỉ gồm COMPLETED; số card khớp số đơn trả về và có nhãn giới hạn nếu `hasMore`.                                          |
| SHOP-O03 | Đơn nào cần mình xử lý trước?                            | Chỉ gồm nhóm shop cần làm: chờ xác nhận, chờ giao, giao thất bại, hoàn trả; ưu tiên sự cố/hoàn trước, đơn cũ trước trong cùng nhóm. |
| SHOP-O04 | Đơn nào đang vận chuyển?                                 | Chỉ trạng thái SHIPPING; không coi là đơn cần shop xử lý hoặc đơn đã giao.                                                          |
| SHOP-O05 | Đơn nào đã giao cho khách?                               | Chỉ DELIVERED theo read model; không gộp với COMPLETED nếu nguồn định nghĩa riêng.                                                  |
| SHOP-O06 | Đơn nào bị hủy và vì sao?                                | Danh sách CANCELLED cùng `cancelReason`; thiếu reason phải ghi chưa có lý do, không thay bằng lý do hoàn trả.                       |
| SHOP-O07 | Đơn nào đang hoàn trả và lý do là gì?                    | Danh sách RETURN_REFUND cùng `returnReason`/`returnDescription`; không dùng `cancelReason`.                                         |
| SHOP-O08 | Mã đơn BIN-123 gồm sản phẩm nào và tổng tiền bao nhiêu?  | Tra đúng mã đơn; tên, ảnh, số lượng và tổng tiền đều khớp snapshot đơn.                                                             |
| SHOP-O09 | Có bao nhiêu đơn chờ xác nhận và bao nhiêu đơn chờ giao? | Trả riêng từng aggregate; không cộng thành một số không rõ nghĩa.                                                                   |
| SHOP-O10 | Cho mình xem 5 đơn gần đây nhất.                         | Đúng 5 hoặc ít hơn nếu shop có ít hơn; ghi đây là mẫu gần đây, không phải toàn bộ lịch sử.                                          |

## 3. Mode Tài liệu

Mode này trả lời quy trình/chính sách dựa trên tài liệu published có hiệu lực. Kiểm tra citation mở đúng tài liệu và đoạn liên quan. Nếu không có evidence đủ căn cứ thì phải nói rõ; không lấy live data để thay policy và không dùng hiểu biết chung để bịa quy định.

| ID     | Câu hỏi                                                                | Kết quả cần kiểm tra                                                                                                |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| DOC-01 | Khách muốn trả hàng thì shop cần xử lý theo quy trình nào?             | Tìm đúng tài liệu returns/refunds; nêu các bước có evidence và gắn citation phù hợp.                                |
| DOC-02 | Đơn đang ở trạng thái hoàn trả khác đơn đã hoàn tất thế nào?           | Phân biệt khái niệm/trạng thái theo tài liệu; không tra một đơn cụ thể trong live data.                             |
| DOC-03 | Khách báo nhận thiếu hàng thì shop nên làm gì?                         | Truy xuất quy trình khiếu nại/hoàn trả có liên quan; không tự hứa kết quả hoặc thời hạn.                            |
| DOC-04 | Đơn bị hủy thì phí và tiền hoàn được xử lý ra sao?                     | Chỉ nêu quy tắc được tài liệu hỗ trợ; phân biệt hủy đơn với hoàn trả.                                               |
| DOC-05 | Phí giao hàng và COD được tính theo nguyên tắc nào?                    | Dùng tài liệu phí/đối soát; không trả số tiền phí live của shop.                                                    |
| DOC-06 | Doanh thu được ghi nhận vào thời điểm nào theo chính sách?             | Tra quy tắc ghi nhận; không thay bằng tổng doanh thu dashboard hiện tại.                                            |
| DOC-07 | Đơn báo đã thu COD thì tiền đã chuyển về shop chưa?                    | Giải thích theo tài liệu đối soát; nếu hỏi trạng thái payout cụ thể mà không có nguồn thì nói rõ giới hạn.          |
| DOC-08 | Shop cần đóng gói hàng trước khi bàn giao cho hãng vận chuyển thế nào? | Trả checklist theo shipping/order-processing docs; không tạo SLA hoặc điều kiện ngoài nguồn.                        |
| DOC-09 | “Thời gian chuẩn bị hàng” có phải thời gian giao tới khách không?      | Phân biệt khái niệm dựa trên tài liệu; không tự đặt số ngày.                                                        |
| DOC-10 | Đơn đã giao khác đơn hoàn tất ở điểm nào?                              | Dùng tài liệu định nghĩa trạng thái; citation phải chứa phần giải thích tương ứng.                                  |
| DOC-11 | Sản phẩm thuộc nhóm hạn chế cần đáp ứng điều kiện nào để đăng bán?     | Tra restricted-products docs; không khẳng định duyệt/ngoại lệ nếu tài liệu không nêu.                               |
| DOC-12 | Tôi tìm phần quản lý sản phẩm trong Seller Center ở đâu?               | Dùng hướng dẫn Seller Center; không trả danh sách sản phẩm live thay cho chỉ dẫn giao diện.                         |
| DOC-13 | Tôi không thấy nút xác nhận đơn, cần kiểm tra gì?                      | Dùng tài liệu troubleshooting/order-processing; không tuyên bố đã sửa giao diện hoặc trạng thái đơn.                |
| DOC-14 | Viết không dấu: `khach muon hoan hang thi shop can lam gi`             | Vẫn route Tài liệu và tìm đúng chủ đề; câu trả lời có citation thật.                                                |
| DOC-15 | Gõ sai: `chinh sach hoan tien cho khach nhu the nao`                   | Chịu được lỗi gõ; không trả lời từ trí nhớ khi retrieval không có evidence.                                         |
| DOC-16 | Trích nguyên văn điều kiện đổi trả giúp tôi.                           | Chỉ trích đoạn ngắn, đúng nguồn; không ghép câu từ nhiều đoạn thành một điều kiện mới.                              |
| DOC-17 | Tài liệu không nói rõ thời hạn xử lý, vậy thường mất mấy ngày?         | Nêu tài liệu chưa xác nhận thời hạn; không suy đoán từ thông lệ bên ngoài.                                          |
| DOC-18 | Quy định cụ thể cho mặt hàng X là gì?                                  | Nếu kho không có tài liệu phù hợp, trả trạng thái không có evidence phù hợp; không dùng tài liệu gần nghĩa để đoán. |

## 4. Kiểm thử ranh giới giữa ba mode

| ID      | Mode đang chọn | Câu hỏi                                            | Expected                                                                                             |
| ------- | -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| MODE-01 | Trò chuyện     | Doanh thu shop tháng 9/2026 là bao nhiêu?          | Hướng sang Dữ liệu shop; không trả số.                                                               |
| MODE-02 | Trò chuyện     | Quy định hoàn tiền khi đơn bị hủy thế nào?         | Hướng sang Tài liệu; không trả policy không nguồn.                                                   |
| MODE-03 | Dữ liệu shop   | Chính sách chung về thời hạn hoàn tiền là gì?      | Không dùng order snapshot để trả policy; hướng sang Tài liệu nếu mode không hỗ trợ chuyển tự động.   |
| MODE-04 | Dữ liệu shop   | Đơn BIN-123 của shop tôi đã hoàn tiền chưa?        | Tra dữ liệu đơn nếu read model có trạng thái; không viện dẫn chính sách thay cho trạng thái thực tế. |
| MODE-05 | Tài liệu       | Đơn BIN-123 của tôi hiện bị hủy vì lý do gì?       | Không bịa từ policy; hướng sang Dữ liệu shop vì đây là dữ liệu đơn cụ thể.                           |
| MODE-06 | Tài liệu       | Shop tôi tháng này có bao nhiêu sản phẩm bán được? | Hướng sang Dữ liệu shop; không suy ra số lượng từ tài liệu.                                          |
| MODE-07 | Trò chuyện     | Cập nhật tồn SKU A lên 10 giúp tôi.                | Hướng sang Agent; tuyệt đối không ghi dữ liệu trong Chat.                                            |
| MODE-08 | Dữ liệu shop   | Cập nhật tồn SKU A lên 10 giúp tôi.                | Không thực hiện thay đổi trong mode chỉ đọc; hướng sang Agent.                                       |

## 5. Checklist pass/fail chung

- **Đúng mode/nguồn:** câu live không dùng tài liệu; chính sách không dùng số dashboard; chat không giả vờ đã truy vấn.
- **Đúng tập dữ liệu:** trạng thái, kỳ, số đếm, đơn vị và điều kiện lọc được nêu rõ; không đếm mẫu hữu hạn thành tổng.
- **Nhất quán UI:** card/ảnh/giá trị/nhãn trạng thái khớp phần chữ; sản phẩm và đơn trong card đều thuộc câu hỏi.
- **Có giới hạn thì nói giới hạn:** `hasMore`, thiếu trường, unavailable source hoặc thiếu evidence phải được phản ánh trung thực.
- **Không bịa:** không tự tạo con số, sản phẩm, lý do hủy/hoàn, chính sách, URL, citation hoặc trạng thái.
- **Nối tiếp an toàn:** đại từ chỉ đúng đối tượng gần nhất trong cùng mode session; không lấy sản phẩm/đơn từ một mode session khác.
- **Lỗi nguồn:** lỗi API/provider phải khác với kết quả rỗng hợp lệ và khác với không có tài liệu.

## 6. Phiếu ghi kết quả chạy

| ID  | Mode chọn | Mode/nguồn thực tế | Câu trả lời đúng | Card/citation đúng | Không bịa | Kết quả     | Ghi chú |
| --- | --------- | ------------------ | ---------------- | ------------------ | --------- | ----------- | ------- |
|     |           |                    |                  |                    |           | PASS / FAIL |         |

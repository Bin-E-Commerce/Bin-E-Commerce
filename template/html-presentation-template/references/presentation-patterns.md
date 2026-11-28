# Thiết kế và kiểm tra bài trình chiếu HTML

<a id="chon-mau"></a>

## Chọn mẫu trong repo

Các đường dẫn dưới đây tính từ gốc repository. Dùng chúng như mã tham chiếu khi có sẵn. Các quy tắc trong tài liệu này cũng áp dụng nếu máy chỉ có skill mà thiếu một trong các tệp mẫu.

| Tệp tham chiếu | Phần nên đọc | Giá trị tái sử dụng |
| --- | --- | --- |
| `template/Kinshield - Presentation HTML.html` | `.workspace-shell`, `.model-card`, `goToPage`, `initPackets`, `renderPackets` | Nhịp trình bày, phân nhóm mục lục, màu theo vai trò, phối hợp thẻ mô hình với luồng dữ liệu |
| `template/Recommendation - Presentation HTML.html` | `[data-choice]`, `[data-view]`, `template[id^="scene-"]`, `findPacketRoute`, `packetTravelDuration`, `renderView`, `togglePresentation` | Cảnh chính/phụ, sơ đồ SVG, nhãn theo chấm, mô phỏng đầu vào, biểu đồ và kiểm soát trên màn chiếu |
| `template/Image Search - Presentation HTML.html` | `showPage`, `animateFlow`, `setPresentation`, các trang ảnh minh họa và kết quả thử | Cặp ảnh đầu vào/kết quả, dẫn dắt bằng tình huống, bảng phép thử và phần kết luận |

Ưu tiên tái dùng thành phần đã chạy tốt. Khi dùng một file làm nền, sao chép sang file đích rồi thay nội dung và tài nguyên theo đề tài. Chỉ lấy CSS, hàm và đoạn dữ liệu cần thiết nếu chủ đề có cấu trúc khác đáng kể. Thử mở file khi ngắt mạng nếu mục tiêu là trình chiếu tại chỗ, đặc biệt khi mẫu cũ có phông chữ từ CDN.

<a id="bo-cuc"></a>

## Bố cục và nội dung

- Dùng 16:9 cho bản trình chiếu chính. Trong màn hình luyện tập có thể dùng mục lục trái, khu vực nội dung chính và ghi chú. Trong chế độ F ưu tiên tiêu đề, hình, số liệu và điều hướng. Để thanh điều hướng có hàng riêng và cho phần nội dung mở rộng hoặc cuộn độc lập khi cần.
- Một trình tự tham khảo cho đề tài kỹ thuật gồm vấn đề, trải nghiệm, kiến trúc, luồng chính, khía cạnh khó hoặc mô phỏng, đánh giá và kết luận. Trong hệ thống có luồng đọc và luồng ghi, trình bày riêng từng luồng khi sơ đồ tổng quan trở nên dày. Đặt tiêu đề theo điều người nghe cần hiểu. Mỗi cảnh có một hình hoặc bảng chính và câu nhận xét ngắn.
- Trong sơ đồ, xếp luồng chủ đạo theo hướng đọc nhất quán. Gom thành phần theo ranh giới thật, chẳng hạn giao diện, dịch vụ, xử lý, lưu trữ, hệ thống ngoài. Dùng nét đứt cho luồng sự kiện nếu đã ghi trong chú giải. Đặt tên giao thức hoặc dữ liệu lên cạnh đúng chiều. Công thức có tên biến và đơn vị. Khi có ví dụ, chỉ ra giá trị đầu vào và đầu ra quan sát được.
- Dùng màu theo vai trò, nền ít bão hòa và chữ tương phản. Giữ hệ thống màu thống nhất giữa các cảnh. Ở 1280 × 720 có thể bắt đầu với tiêu đề 30–42 px, mô tả 15–18 px, chữ trong nút sơ đồ khoảng 15–18 px và nhãn cạnh khoảng 12–14 px sau khi co. Nếu chữ nhỏ do sơ đồ dày, rút phần đệm trong `viewBox` hoặc chia thành hai cảnh.
- Giữ bảng ngắn và căn số theo cột. Nêu mẫu số, nhóm, split, đơn vị và baseline khi cần để đọc đúng phép so sánh. Dùng ảnh đúng tỷ lệ với `object-fit: contain` hoặc bố trí theo tỉ lệ tự nhiên. Đặt tiêu đề và chú thích bằng HTML. Khi ảnh có chữ nhỏ, thêm nút mở ảnh lớn hoặc khoanh vùng cần chỉ trong một ảnh phụ được ghi rõ.
- Dữ liệu, kiến trúc và diễn giải có cùng phạm vi. Ví dụ minh họa, số chụp trên giao diện và kết quả đánh giá cần được nhận diện ngay ở đầu cảnh. Khi nói về mô hình đang phục vụ hoặc một hệ thống thật, gắn các kết luận với dữ liệu và môi trường tương ứng.

<a id="hieu-ung"></a>

## Hiệu ứng và tương tác

### Sơ đồ chuyển động

- Vẽ dây và đầu mũi tên từ cùng một đường dùng để tính vị trí của gói. Đặt `circle`, thẻ nhãn và chữ vào cùng một nhóm SVG. Cập nhật một `transform` trên nhóm để chữ luôn đi theo đúng chấm. Nếu nhãn phải lệch khỏi dây, dùng đường nối mảnh ngắn từ chấm tới nhãn.
- Giữ một nhãn rõ trên mỗi cạnh cần diễn giải. Khi bố trí, chừa quãng chạy cho **toàn bộ thẻ nhãn**, gồm viền và lề, ở cả đầu, giữa và cuối lượt. Đo quãng quét so với biên `viewBox`, hộp, tiêu đề nhóm, thẻ khác và nét dây. Thử cảnh rẽ/hợp nhánh và hai đường đi ngược chiều. Rút ngắn quãng, nới khoảng cách hộp hoặc đổi phía nhãn khi có va chạm.
- Ở 1×, mốc tham khảo của mẫu Recommendation là khoảng 4 giây di chuyển ở chế độ F cho đường ngắn, lâu hơn cho đường dài, và dừng gần nửa giây ở cuối. Cần đọc được ngay cả khi đứng xa màn hình. Sử dụng độ dài quãng hoặc bước Bézier dài nhất để chọn thời gian. Giữ chữ nguyên độ đậm lúc chạy, dừng và lặp lại. Khi chuyển cảnh, giữ dữ liệu đã chỉnh để người trình bày có thể bắt đầu lại mà vẫn dùng ví dụ đang thử.
- Ưu tiên một vòng `requestAnimationFrame` cho cảnh đang hiện. Hủy khung chờ khi rời cảnh hoặc tạm dừng, giới hạn `delta` sau khi tab ở nền. Trong chế độ giảm chuyển động, dựng ngay sơ đồ có nhãn tại vị trí an toàn và biểu đồ đủ số liệu. Cung cấp nút phát chủ động nếu người dùng muốn.
- Với SVG khai báo theo mẫu Recommendation, một cảnh có `data-view` và nguồn `scene-<id>`. Trong nguồn, mỗi `data-node` định danh duy nhất và mô tả vị trí, kích thước, vai trò. Mỗi `data-edge` tham chiếu đúng cặp nút, cổng, độ lệch và mang tên dữ liệu. Bổ sung cảnh mới bằng cấu trúc hiện có trước khi thêm điều khiển mới.

### Biểu đồ, bàn phím và mô phỏng

- Giữ số liệu và hình học biểu đồ khớp từ khung đầu. Nếu hiện dần, dùng tăng độ đậm đồng thời hoặc tiến độ chung. Tránh tình trạng thanh ngắn trông lớn hơn thanh dài trong khi nhãn đã hiện giá trị cuối.
- Ở chế độ chiếu, nút phát/tạm dừng và chạy lại hiển thị ngay. Phím F dùng để vào hoặc ra chế độ chiếu. Phím trái/phải chuyển trang khi tiêu điểm ở nội dung chung, còn thanh trượt và ô nhập dùng phím theo vai trò riêng. Thử cả bấm chuột và Tab. Kiểm tra tiêu điểm khi đóng ảnh phóng to.
- Khi mô phỏng tương tác, một lần đổi đầu vào cập nhật cùng lúc nhãn gói, sơ đồ, giá trị và giải thích. Đổi tiêu chí hoặc cảnh phụ có thể giữ giá trị người dùng đã nhập. Thử cực tiểu, cực đại và hai phía của các ngưỡng rời rạc.

<a id="kiem-tra"></a>

## Kiểm tra trước khi bàn giao

1. **Duyệt toàn bộ** ở kích thước CSS 1280 × 720 và tỷ lệ trang 100% trong Chrome hoặc trình duyệt đã thỏa thuận. Bật F, đối chiếu bộ đếm trang với mục lục và mở lần lượt mọi cảnh phụ. Kiểm tra sát đáy vùng nội dung, vì cắt mất dòng cuối hoặc cuối bảng thường chỉ xảy ra ở cảnh có nhiều nhánh. Xem bố cục thường khi dự kiến dùng laptop để luyện.
2. **Phát hết ít nhất một lượt** tại các cảnh dài, rẽ nhánh và có nhãn dễ nhầm. Xem nhãn ở đầu, giữa, cuối, lúc lặp lại và lúc tạm dừng. Bấm chạy lại, chuyển cảnh khi đang phát, rồi quay lại. Kiểm tra màu tối nếu bản trình chiếu có chế độ này.
3. **Thử điều khiển và dữ liệu**. Bấm mũi tên ở ngoài và trong thanh trượt. Đổi giữa các cảnh/tiêu chí. Mở và đóng ảnh, kiểm tra tỷ lệ ảnh và câu chú thích. Đối chiếu số, dấu, đơn vị, thứ tự, nguồn và công thức với tài liệu gốc.
4. **Đo tự động khi dùng đúng cấu trúc Recommendation**. Từ gốc repo, gọi `node <đường-dẫn-skill>/scripts/check-flow-deck.cjs <tệp-html>`. Chỉ chạy với bản HTML nội bộ mà bạn tin cậy vì công cụ thực thi JavaScript nhúng trong DOM giả lập. Công cụ dùng `jsdom` đã có trong `web/node_modules`. Nếu thiếu thì dùng kiểm tra trong trình duyệt với công cụ hiện có. Có thể truyền đường dẫn gốc repo làm đối số thứ hai nếu gọi từ thư mục khác.
5. **Đọc kết quả đo theo phạm vi của nó**. Công cụ đo chuyển động và va chạm qua 300 khung mỗi cảnh đồ thị SVG. Nó kiểm tra các mẫu tương thích với `article.model-card`, `[data-view]`, `[data-packet]` và dữ liệu `data-edge`. Kết quả này bổ sung cho kiểm tra trực tiếp cỡ chữ, bố cục CSS, thao tác chuột và toàn màn hình. HTML khác cấu trúc vẫn được kiểm tra theo các mục 1–3.

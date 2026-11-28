---
name: html-presentation-template
description: Tạo, chỉnh sửa hoặc rà soát bài trình chiếu HTML tương tác cho đề tài, chức năng hoặc kiến trúc phần mềm theo các mẫu KinShield, Recommendation và Image Search. Áp dụng cho slide chạy trong trình duyệt có sơ đồ, nhãn chuyển động, biểu đồ, ảnh giao diện hoặc chế độ trình chiếu F. Dùng quy trình theo định dạng tương ứng cho PPTX, Google Slides, PDF và website thông thường.
---

# Mẫu trình chiếu HTML

Tạo một bản trình chiếu có thể mở trực tiếp trong trình duyệt. Mỗi cảnh cần giúp khán giả hiểu một câu hỏi, nhìn rõ dữ liệu đang di chuyển và đọc được kết luận trên màn chiếu.

## Chọn mẫu và phạm vi

- Ưu tiên mẫu, file đích, ngôn ngữ và yêu cầu thị giác do người dùng chỉ định. Với yêu cầu tạo mới trong repo này, lưu vào `template/<Tên chủ đề> - Presentation HTML.html` nếu chưa có đường dẫn cụ thể. Với yêu cầu sửa, làm trên file hiện hành.
- Mở nguồn trong `template/` theo [bản đồ tham chiếu](references/presentation-patterns.md#chon-mau). Dùng Recommendation làm nền mặc định cho chế độ F, cảnh phụ, nhãn theo chấm và vòng lặp phát. Lấy nhịp trình bày từ KinShield và các mẫu bố cục ảnh, kết quả từ Image Search khi phù hợp.
- Đọc mã và tài liệu đúng phần cần minh họa. Chốt thông điệp, điểm vào/ra, vai trò của từng thành phần và ý nghĩa của mỗi phép đo trước khi dựng trang. Lấy số liệu, công thức và trạng thái triển khai từ nguồn đã xác minh. Gắn nhãn cho ví dụ giả định.
- Xây thứ tự trang theo nội dung thực tế. Chọn cảnh phụ khi cần giải thích nhánh xử lý hoặc chuyển góc nhìn. Tham khảo [cách tổ chức nội dung và bố cục](references/presentation-patterns.md#bo-cuc). Giữ số lượng trang do người dùng yêu cầu, nếu có.

## Dựng bài trình chiếu

1. Giữ tệp HTML tự chứa khi có thể. Dùng CSS theo vai trò, HTML ngữ nghĩa, SVG nội tuyến và JavaScript thuần. Dùng ảnh thực người dùng cung cấp hoặc được phép chụp. Giữ tỷ lệ ảnh, có mô tả ngắn và cho phóng to khi chữ trong ảnh nhỏ.
2. Khi dựa trên Recommendation, tái dùng cơ chế chuyển trang, trạng thái cảnh và vòng lặp hoạt ảnh. Thay tiêu đề, tên hệ thống, dữ liệu, ghi chú, ảnh và kịch bản cũ bằng nội dung của đề tài mới. Kiểm tra xem chức năng chỉ phục vụ đề tài mẫu, như bộ tính đặc trưng, có cần được gỡ cùng các tham chiếu mã của nó hay không.
3. Trong sơ đồ, cho **chấm và tên dữ liệu** cùng di chuyển trên đường nối. Giữ chữ đủ đậm, tránh đè lên nút, nhãn khác hoặc mũi tên. Thực hiện theo [quy tắc chuyển động](references/presentation-patterns.md#hieu-ung). Trong biểu đồ, giữ giá trị, đơn vị, chiều dài thanh và khoảng tin cậy nhất quán ở mọi khung hình.
4. Chế độ F có vùng nội dung riêng và thanh phân trang nằm ngoài vùng đó. Giữ nút phát, tạm dừng và chạy lại dễ thấy. Bảo toàn tiêu điểm bàn phím của nút, thanh trượt và hộp thoại. Tôn trọng thiết lập giảm chuyển động và cho phép người dùng chủ động phát.

## Kiểm tra và bàn giao

- Với mẫu dựa trên cấu trúc Recommendation, chạy từ thư mục gốc dự án: `node <đường-dẫn-skill>/scripts/check-flow-deck.cjs "template/Tên bài - Presentation HTML.html"`. Công cụ kiểm tra liên kết trang/cảnh và lấy mẫu hình học trong hoạt ảnh SVG. Phạm vi, cách đọc kết quả và kiểm tra thủ công nằm trong [quy trình rà soát](references/presentation-patterns.md#kiem-tra).
- Mở bản đã sửa trong trình duyệt. Bật **F** và xác minh viewport **1280 × 720**, hoặc kích thước người dùng yêu cầu. Đi qua từng trang và từng cảnh phụ. Thử chuyển trang, phát lại, tạm dừng, chỉnh ví dụ tương tác và phóng ảnh nếu có. Sửa các lỗi thấy được và mở lại đúng cảnh sau chỉnh sửa.
- Bàn giao đường dẫn HTML, phạm vi thực tế đã kiểm tra và lỗi còn tồn tại nếu có. Khi thiếu trình duyệt hoặc công cụ đo, báo rõ phần đã chạy được và phần còn thiếu.

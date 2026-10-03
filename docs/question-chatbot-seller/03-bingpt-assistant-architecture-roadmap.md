# Định hướng tái xây dựng BinGPT thành trợ lý Seller

**Trạng thái:** Định hướng đã thống nhất, chưa triển khai pipeline mới  
**Phạm vi:** Seller Copilot/BinGPT, kho tài liệu Seller Knowledge và trang quản trị tài liệu.

## 1. Mục tiêu sản phẩm

BinGPT không chỉ là chatbot hỏi đáp chính sách. Đây là trợ lý Seller có thể mở rộng theo từng năng lực:

1. **Trò chuyện thông thường:** chào hỏi, cảm ơn và trao đổi tự nhiên; không gọi nguồn dữ liệu nghiệp vụ khi không cần.
2. **Đọc và phân tích dữ liệu hiện tại:** hồ sơ/tài khoản và shop, doanh số, đơn hàng, sản phẩm và tồn kho của đúng người bán đang đăng nhập.
3. **Tra cứu tài liệu chính sách:** trả lời dựa trên tài liệu Seller Knowledge đã xuất bản, còn hiệu lực và có dẫn nguồn.
4. **Thực hiện hành động:** tương lai mới cho phép AI đề xuất/cập nhật dữ liệu như tồn kho hoặc thông tin shop; không thuộc phạm vi hiện tại.
5. **Mở rộng thêm năng lực:** thêm nguồn hoặc nghiệp vụ mới theo capability rõ ràng, không phải chèn thêm regex vào nhiều file.

Trong đợt hiện tại, ba năng lực đầu là mục tiêu. AI chỉ đọc dữ liệu; không tự ghi thay đổi vào hệ thống.

## 2. Kiến trúc mục tiêu

### Hiểu yêu cầu và điều phối

- Dùng một bước planner AI để hiểu ý định, chủ đề, ngữ cảnh hội thoại và dữ liệu cần thiết.
- Planner trả cấu trúc có schema; backend validate mọi trường và tự chọn source được phép. AI không được tự chọn `shopId`, gọi service hoặc cấp quyền.
- Chat thường, truy vấn dữ liệu live, truy vấn chính sách và câu hỏi cần làm rõ đi theo luồng riêng. Câu hỏi nhiều ý có thể phối hợp nhiều source nhưng phải giữ evidence riêng cho từng ý.
- Không dùng regex làm bộ phân loại nghiệp vụ. Quy tắc bảo mật, tenant, quyền truy cập và danh sách field được phép vẫn do backend kiểm soát.

### Dữ liệu live

- Đọc hồ sơ/shop, doanh số, đơn hàng, sản phẩm và tồn kho qua API/read model của service sở hữu dữ liệu.
- Không truy vấn trực tiếp database của service khác từ Seller Copilot. Nếu source hiện chưa có API/read model phù hợp thì bổ sung adapter/API tại đúng service sở hữu dữ liệu.
- Chỉ lấy dữ liệu của shop/user hiện tại và chỉ lấy field cần cho câu hỏi. Thông tin hồ sơ nhạy cảm không gửi sang model; lịch sử đã lưu tiếp tục được che theo quy tắc hiện có.

### Tài liệu và RAG

- Tạo feature `seller-knowledge` riêng, sở hữu metadata tài liệu, kiểm tra, ingest và retrieval; Seller Copilot gọi qua application port.
- Admin Center cho phép tải file `.md` hoặc dán/chỉnh sửa Markdown. Luồng xuất bản: **bản nháp → xem trước chunk/chạy câu hỏi thử → xuất bản**.
- S3 lưu tài liệu gốc và revision; Qdrant chỉ là chỉ mục truy vấn của tài liệu được xuất bản. Không thêm PostgreSQL làm kho tài liệu chính sách.
- Capability khai báo domain nào được dùng cho nghiệp vụ nào. Thêm file trong domain đang có không cần sửa code; thêm domain/capability mới phải khai báo và có test tương ứng.
- Chỉ bật dense+sparse hybrid hoặc nâng Qdrant khi benchmark trên câu hỏi thực tế chứng minh có lợi hơn dense hiện tại.

### Agent trong tương lai

- Không cung cấp write tool trong giai đoạn hiện tại. Câu yêu cầu sửa dữ liệu phải được giải thích rõ là BinGPT chưa tự thao tác.
- Khi triển khai agent, mỗi action phải có allowlist, quyền riêng, tenant validation, xác nhận người dùng, audit, idempotency và xử lý lỗi/hoàn tác. Không để planner hiện tại tự biến thành quyền ghi dữ liệu.

## 3. Phần giữ lại và phần thay thế

### Giữ lại

- Dữ liệu, schema và repository lưu lịch sử hội thoại hiện có.
- API quản lý hội thoại: tạo mới, đọc lịch sử, tìm kiếm, pin, đổi tiêu đề và xóa.
- Endpoint chat/SSE và giao diện chat hiện tại, trừ khi có lý do tương thích cụ thể được duyệt.
- Source live hoặc helper còn được luồng mới sử dụng, sau khi xác nhận đúng ownership và tenant scope.

### Thay thế và xóa

- Thay lõi hiểu câu hỏi → chọn route → lấy evidence → kiểm chứng → tạo câu trả lời bằng pipeline mới có contract rõ.
- Xóa regex/heuristic phân loại nghiệp vụ, cấu hình query expansion thủ công, fallback đoán intent, route/generator cũ và test chỉ phục vụ chúng **sau khi đã chuyển consumer và xác nhận không còn reference**.
- Không giữ adapter rỗng hoặc nhánh legacy runtime chỉ để tránh xóa. Không xóa API/persistence conversation chỉ vì chúng cùng nằm trong Seller Copilot.
- Không để service build/runtime ở trạng thái hỏng giữa các bước. Code đang được endpoint sử dụng chỉ được xóa cùng lúc với việc thay consumer tương ứng; rollback vận hành dùng bản deploy trước, không giữ nhánh code cũ trong ứng dụng.

## 4. Trình tự thực hiện

1. **Lập baseline và danh sách dependency:** ghi lại route, provider, source, type, API, module registration, test và xác định code đang dùng so với code chết. Không xóa file chỉ dựa vào tên hoặc cảm giác cũ.
2. **Tạo contract và ranh giới capability/source:** định nghĩa output planner đã validate, capability registry và các source adapter cho chat, hồ sơ, doanh số, đơn hàng, sản phẩm/tồn kho, chính sách.
3. **Xây knowledge management/Admin:** quản lý revision Markdown trên S3, metadata/domain, quyền ADMIN, preview/test và publish an toàn sang Qdrant; giữ bản index đang chạy nếu publish lỗi.
4. **Kết nối live-data và answer pipeline:** lấy số liệu từ đúng service, phân biệt source rỗng với source lỗi, kiểm chứng claim và citation trước khi phát câu trả lời qua SSE hiện có.
5. **Đánh giá retrieval và câu trả lời:** so sánh dense với hybrid trên bộ câu hỏi tiếng Việt có nhãn expected capability/document/evidence; chỉ nâng Qdrant/bật hybrid khi kết quả đạt tiêu chí đã thống nhất.
6. **Loại bỏ pipeline cũ:** sau khi consumer đã chuyển và test thay thế đã có, xóa các file cũ không còn reference; rà stale import, provider registration, config, test và tài liệu.
7. **Hoàn thiện và xác nhận:** chạy test backend/frontend, type-check, lint, build; xác nhận API/SSE và hội thoại cũ vẫn hoạt động; báo danh sách code đã xóa và phần chưa triển khai.

## 5. Tiêu chí hoàn thành

- Chào hỏi không bị route nhầm sang dữ liệu hoặc policy; câu nối tiếp giữ đúng ngữ cảnh.
- Hồ sơ/shop, doanh số, đơn hàng, sản phẩm và tồn kho chỉ đọc dữ liệu của chủ thể đã xác thực; không lộ dữ liệu nhạy cảm sang model.
- Câu hỏi chính sách truy vấn đúng domain, chỉ dùng tài liệu published/còn hiệu lực và citation đúng revision.
- Nhiều ý được trả lời theo từng phần, không trộn nguồn; không có evidence thì không bịa.
- ADMIN có thể tạo/sửa draft, xem trước, hỏi thử, publish và rollback tài liệu; user khác bị từ chối ở backend.
- Lịch sử chat cũ, API conversation và SSE contract vẫn tương thích.
- Không còn code legacy được giữ chỉ để tương thích; code bị xóa không còn consumer, đăng ký module hoặc test phụ thuộc.
- Các thay đổi có test phù hợp; type-check, lint và build của các phần bị ảnh hưởng đều đạt.

## Quyết định và giới hạn đã chốt

- Live-data scope: hồ sơ/shop, doanh số, đơn hàng, sản phẩm/tồn kho.
- Knowledge source: S3 giữ bản gốc/revision, Qdrant giữ index; không dùng PostgreSQL làm kho policy.
- Admin quản trị tài liệu: chỉ ADMIN; đầu vào Markdown; có bước draft và test trước publish.
- Chat model, endpoint chat/SSE, schema/lịch sử conversation được giữ nguyên trong kế hoạch mặc định.
- Agent tự cập nhật dữ liệu là giai đoạn tương lai, không triển khai trong đợt tái xây dựng này.
- Các file đang untracked/modified trong worktree thuộc phạm vi bảo toàn; chỉ xóa code Seller Copilot sau khi đối chiếu dependency và test.

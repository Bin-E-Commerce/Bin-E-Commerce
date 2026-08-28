// Điều khiển mô phỏng luồng AI Image Optimization; file này không gọi API và không chứa dữ liệu nhạy cảm.

const FLOW_STAGES = [
  { id: 1, title: 'Chọn sản phẩm', summary: 'Seller chọn một sản phẩm trong Seller Center để bắt đầu yêu cầu.', input: 'Danh sách sản phẩm seller sở hữu', output: 'productId và context hiển thị', safety: 'Giới hạn một sản phẩm trong phiên bản hiện tại để tránh áp dụng nhầm.', failure: 'Không có sản phẩm phù hợp hoặc thiếu quyền truy cập.' },
  { id: 2, title: 'Chọn ảnh nguồn', summary: 'Seller chủ động chọn một ảnh cụ thể thay vì luôn dùng ảnh đại diện.', input: 'Ảnh trong gallery của sản phẩm', output: 'sourceAssetId', safety: 'Asset phải thuộc đúng product graph và seller hiện tại.', failure: 'Ảnh đã bị xóa, không còn quyền hoặc không có URL tải hợp lệ.' },
  { id: 3, title: 'Xác thực JWT', summary: 'Gateway kiểm tra phiên đăng nhập trước khi chuyển tiếp request.', input: 'JWT từ Seller Center', output: 'User context đã xác thực', safety: 'OpenAI key không đi qua browser hoặc Gateway.', failure: '401 khi token hết hạn hoặc không hợp lệ.' },
  { id: 4, title: 'Kiểm tra quyền', summary: 'Gateway kiểm tra permission image optimization trước khi forward.', input: 'seller.ai.image_optimization.generate', output: 'OWN_SHOP authorization', safety: 'Permission được kiểm tra lại ở AI Service và ownership ở Product Service.', failure: '403 nếu seller thiếu permission.' },
  { id: 5, title: 'Kiểm tra ownership', summary: 'AI Service bảo đảm sản phẩm và asset thực sự thuộc seller.', input: 'productId + user context', output: 'Request hợp lệ để xử lý', safety: 'Không tin tuyệt đối dữ liệu từ frontend; xác thực server-to-server.', failure: '404 hoặc 403 nếu ownership không khớp.' },
  { id: 6, title: 'Validate asset', summary: 'Kiểm tra HTTPS, MIME, kích thước và allow-list Media Service.', input: 'sourceAssetId', output: 'Asset reference an toàn', safety: 'Không nhận URL tùy ý để tránh SSRF và không lưu binary trong job.', failure: '400 nếu asset không hợp lệ hoặc vượt giới hạn.' },
  { id: 7, title: 'Lưu job', summary: 'Tạo batch và job trong PostgreSQL trước khi publish event.', input: 'Validated optimization command', output: 'PENDING job', safety: 'Idempotency key và request hash ngăn tạo job trùng.', failure: '409 nếu key đã dùng cho payload khác.' },
  { id: 8, title: 'Ghi outbox', summary: 'Ghi event metadata trong cùng transaction với job.', input: 'Job transaction', output: 'Outbox event chưa publish', safety: 'Job và event commit nguyên tử; không gửi ảnh hoặc JWT vào Kafka.', failure: 'Publisher retry hoặc chuyển DLQ, job vẫn còn để quan sát.' },
  { id: 9, title: 'Publish event', summary: 'Outbox relay gửi event versioned lên Kafka topic.', input: 'jobId + sourceAssetId + mode', output: 'ai.image-optimization.requested.v1', safety: 'eventId dùng xuyên suốt để worker idempotent khi redelivery.', failure: 'Kafka unavailable khiến event chờ publish.' },
  { id: 10, title: 'Claim job', summary: 'Worker nhận event và claim lease nguyên tử trước khi gọi provider.', input: 'Kafka event', output: 'PROCESSING + lease', safety: 'Hai worker không cùng xử lý một job trả phí.', failure: 'Lease hết hạn cho phép worker khác phục hồi có giới hạn.' },
  { id: 11, title: 'Tải ảnh gốc', summary: 'Worker lấy binary qua Media Service bằng internal client.', input: 'sourceAssetId', output: 'Ảnh nguồn tạm thời trong memory', safety: 'Không tải URL seller cung cấp trực tiếp và không ghi binary vào database.', failure: 'Media Service 5xx hoặc timeout → job FAILED.' },
  { id: 12, title: 'Chọn provider', summary: 'Application chọn capability provider dựa trên mode seller chọn.', input: 'Optimization mode', output: 'WhiteBackgroundProvider hoặc OpenAIImageProvider', safety: 'Provider registry tách capability; use case không hard-code SDK.', failure: 'Provider chưa cấu hình → lỗi rõ ràng, không báo thành công giả.' },
  { id: 13, title: 'Tạo ảnh', summary: 'Nhánh local dùng rembg/Pillow hoặc nhánh lifestyle gọi GPT-Image-2.', input: 'Ảnh nguồn đã chuẩn hóa', output: 'Processed image candidate', safety: 'Không retry tùy tiện request trả phí; lọc prompt và giữ hình dáng sản phẩm.', failure: 'Timeout, quota hoặc lỗi xử lý → FAILED, không thay ảnh gốc.' },
  { id: 14, title: 'Upload output', summary: 'Ảnh candidate được validate rồi upload thành asset mới.', input: 'Processed image', output: 'generatedAssetId + sourceAssetId', safety: 'Output luôn có lineage để apply đúng ảnh seller chọn.', failure: 'Upload lỗi → không chuyển REVIEW_REQUIRED.' },
  { id: 15, title: 'Ready to review', summary: 'Job chuyển REVIEW_REQUIRED để UI hiển thị preview before/after.', input: 'Generated asset metadata', output: 'Preview chờ seller duyệt', safety: 'Ảnh gốc vẫn là snapshot an toàn; AI chưa ghi vào product graph.', failure: 'Output thiếu mapping bị từ chối áp dụng.' },
  { id: 16, title: 'Seller xem preview', summary: 'Seller kiểm tra kết quả, cảnh báo và provider trước khi quyết định.', input: 'Ảnh gốc + ảnh AI', output: 'Reject hoặc apply intent', safety: 'Không tự động áp dụng khi worker hoàn tất.', failure: 'Đóng dialog không làm thay đổi sản phẩm.' },
  { id: 17, title: 'Finalization', summary: 'Khi seller đồng ý, hệ thống tạo ảnh chất lượng cuối trước apply.', input: 'REVIEW_REQUIRED + selected output', output: 'FINAL output', safety: 'jobId là idempotency key để bấm nhiều lần không tạo bản sao.', failure: 'Final provider lỗi → product vẫn giữ ảnh hiện tại.' },
  { id: 18, title: 'Apply product media', summary: 'Product Service kiểm tra ownership và version trước cập nhật.', input: 'Final asset + expectedProductUpdatedAt', output: 'Product media mới', safety: 'Optimistic locking ngăn ghi đè; ảnh gốc không bị xóa.', failure: '409 nếu sản phẩm đã cập nhật trong lúc xử lý.' },
  { id: 19, title: 'Hoàn tất', summary: 'Job APPLIED và seller thấy ảnh mới; rollback vẫn khôi phục snapshot.', input: 'Committed product update', output: 'APPLIED + audit metadata', safety: 'Cleanup chỉ dọn output AI khi reject hoặc hết retention.', failure: 'Cleanup lỗi tạo task retry bền vững.' },
];

const STAGE_EXPLANATIONS = {
  1: { reason: 'Seller phải xác định rõ sản phẩm trước khi tạo yêu cầu. Đây là context gốc mà các service phía sau dùng để kiểm tra quyền, tìm ảnh và cập nhật kết quả.', solves: 'Ngăn một request không rõ mục tiêu hoặc áp dụng nhầm ảnh sang sản phẩm khác. Hệ thống cũng có thể gắn toàn bộ job, log và audit vào đúng productId.' },
  2: { reason: 'Một sản phẩm có thể có nhiều ảnh: ảnh đại diện, ảnh chi tiết hoặc ảnh biến thể. Seller cần chọn chính xác ảnh muốn AI xử lý thay vì để backend tự đoán.', solves: 'Bảo đảm AI làm việc trên đúng sourceAssetId. Việc này ngăn thay đổi nhầm ảnh và giúp kết quả cuối có thể truy ngược về ảnh nguồn.' },
  3: { reason: 'Gateway cần xác nhận người gửi request đã đăng nhập và token còn hợp lệ trước khi chuyển tiếp.', solves: 'Chặn request giả mạo, token hết hạn hoặc request không có user context. Secret của provider AI cũng không cần đi qua trình duyệt của seller.' },
  4: { reason: 'Một người dùng đã đăng nhập vẫn có thể không được cấp quyền dùng chức năng tạo ảnh. Permission là lớp kiểm tra chức năng ở mức gateway.', solves: 'Ngăn seller gọi trực tiếp endpoint AI khi chưa được cấp quyền. Việc kiểm tra sớm cũng giúp tiết kiệm tài nguyên và tránh tạo job không hợp lệ.' },
  5: { reason: 'Frontend có thể gửi productId hoặc assetId bất kỳ, nên AI Service phải xác thực lại ở phía server.', solves: 'Ngăn seller đọc hoặc xử lý dữ liệu của shop khác bằng cách thay ID trong request. Đây là lớp bảo vệ ownership độc lập với dữ liệu mà trình duyệt cung cấp.' },
  6: { reason: 'Bước này nhận sourceAssetId và xác minh ảnh thực sự tồn tại trong product graph của seller. Trước khi worker tải binary, hệ thống kiểm tra URL dùng HTTPS, host thuộc allow-list, MIME là loại ảnh được hỗ trợ, kích thước nằm trong giới hạn và asset chưa bị xóa. Nó phải xảy ra trước bước tạo job hoặc gọi provider vì mọi bước sau đều tin vào ảnh này.', solves: 'Bước này giải quyết đồng thời ba nhóm vấn đề: dữ liệu lỗi, chi phí xử lý và bảo mật mạng. File hỏng hoặc quá lớn bị chặn sớm để không làm worker tốn CPU/memory; định dạng lạ không đi vào pipeline gây lỗi khó đoán. Allow-list còn chống SSRF — attacker không thể đưa URL trỏ tới localhost, cloud metadata hoặc service nội bộ để biến worker thành công cụ quét mạng.' },
  7: { reason: 'Sau khi input hợp lệ, hệ thống tạo một job bền vững trong PostgreSQL thay vì giữ yêu cầu trong bộ nhớ của API. Job lưu productId, sourceAssetId, mode, background, trạng thái ban đầu, attempt và các mốc thời gian. Đây là bản ghi nghiệp vụ đại diện cho “một lần seller yêu cầu tối ưu ảnh”.', solves: 'Bước này giải quyết việc theo dõi và phục hồi: API có thể trả response ngay, còn UI dùng jobId để xem tiến trình sau đó. Nếu server restart, worker vẫn biết job nào chưa xử lý; nếu provider lỗi tạm thời, hệ thống có dữ liệu để retry. Idempotency key hoặc request hash cũng ngăn seller bấm nhiều lần tạo ra nhiều job và có thể phát sinh nhiều lần gọi provider trả phí.' },
  8: { reason: 'Job mới chỉ là dữ liệu trong PostgreSQL, nhưng worker còn cần một tín hiệu để biết có việc cần làm. Vì PostgreSQL và Kafka là hai hệ thống khác nhau nên không thể giả định rằng lưu database xong thì gửi Kafka chắc chắn thành công. Outbox giải quyết bằng cách lưu một record event trong cùng transaction với job, thường gồm eventId, jobId, topic, payload tham chiếu và trạng thái gửi.', solves: 'Bước này loại bỏ lỗi mất đồng bộ giữa database và message broker. Nếu ghi job thành công nhưng Kafka đang down, record Outbox vẫn nằm ở trạng thái PENDING để relay gửi lại; nếu transaction rollback thì job và event cùng không tồn tại. Nhờ eventId và trạng thái PUBLISHED/FAILED, hệ thống còn có thể retry, giám sát và điều tra mà không cần đoán xem request đã được phát đi hay chưa.' },
  9: { reason: 'Outbox relay đọc các record chưa publish và gửi event lên Kafka topic versioned. Event chỉ nên chứa dữ liệu tham chiếu như eventId, jobId, productId, sourceAssetId và mode; không gửi binary ảnh, secret hoặc thông tin nhạy cảm qua message. API không chờ bước này hoàn tất trong cùng request, vì mục tiêu là đưa việc xử lý nặng sang hàng đợi.', solves: 'Bước này tạo ranh giới bất đồng bộ giữa API và AI Worker. API phản hồi nhanh, Kafka giữ event khi worker bận, và có thể tăng số worker để xử lý nhiều job hơn. Nếu publish thất bại, relay retry từ Outbox; nếu event bị giao lại, consumer phải dựa vào jobId/eventId để xử lý idempotent thay vì tạo output mới mỗi lần.' },
  10: { reason: 'Khi event tới Kafka, một hoặc nhiều worker có thể nhìn thấy nó; ngoài ra Kafka có thể giao lại event sau timeout hoặc consumer restart. Worker vì vậy không được lập tức gọi provider, mà phải atomically claim job trong database bằng jobId. Claim chuyển trạng thái sang PROCESSING, ghi workerId, leaseUntil và tăng attempt trước khi bắt đầu các bước tốn chi phí.', solves: 'Lease là khóa tạm có thời hạn: worker đang giữ lease được quyền xử lý, worker khác thấy job đang bị giữ thì bỏ qua. Nếu worker crash, mất mạng hoặc treo quá lâu, lease hết hạn để worker khác tiếp quản; attempt giúp giới hạn số lần retry và chuyển job sang FAILED/DLQ khi vượt ngưỡng. Bước này giải quyết cả hai rủi ro đối lập: xử lý trùng làm tạo nhiều ảnh/tốn tiền, và khóa vĩnh viễn khiến job bị treo không bao giờ hoàn tất.' },
  11: { reason: 'Worker cần binary thật để chạy rembg, Pillow hoặc chuẩn hóa ảnh trước khi gọi provider. Việc tải ảnh phải đi qua Media Service với quyền nội bộ và asset reference đã được xác thực.', solves: 'Tách quyền truy cập file khỏi URL do người dùng tự nhập, giảm nguy cơ SSRF và bảo vệ storage. Binary chỉ tồn tại trong quá trình xử lý thay vì làm phình database.' },
  12: { reason: 'Hai mode có chi phí, tốc độ và cách xử lý khác nhau: nền trắng có thể chạy local, còn lifestyle có thể cần provider external. Provider registry cho phép chọn capability phù hợp ở runtime.', solves: 'Đảm bảo mỗi yêu cầu đi đúng pipeline mà không rải điều kiện SDK khắp use case. Có thể thay provider hoặc thêm provider mới mà không phá luồng nghiệp vụ chính.' },
  13: { reason: 'Đây là bước biến ảnh nguồn thành một candidate mới theo mode đã chọn. Candidate chưa phải dữ liệu chính thức của sản phẩm và vẫn cần kiểm tra sau khi tạo.', solves: 'Tạo kết quả tối ưu mà không ghi đè ảnh gốc. Nếu provider timeout, quota hoặc trả output lỗi, job được đánh dấu thất bại và seller vẫn còn ảnh ban đầu để sử dụng.' },
  14: { reason: 'Ảnh candidate cần được upload thành asset có ID, metadata và quan hệ với sourceAssetId trước khi UI có thể hiển thị hoặc seller có thể duyệt.', solves: 'Bảo đảm output có lineage rõ ràng: biết ảnh nào được dùng để tạo ra nó, thuộc job nào và thuộc sản phẩm nào. Nếu upload lỗi, hệ thống không đưa một URL tạm hoặc kết quả chưa hoàn chỉnh sang bước duyệt.' },
  15: { reason: 'Worker đã tạo xong ảnh không có nghĩa là seller đã đồng ý dùng ảnh đó. Hệ thống chuyển job sang REVIEW_REQUIRED để tách “tạo đề xuất” khỏi “thay đổi sản phẩm”.', solves: 'Ngăn AI tự động ghi đè media đang hiển thị. UI có thể tải preview, hiển thị cảnh báo và chỉ mở nút apply khi output có đủ mapping và trạng thái hợp lệ.' },
  16: { reason: 'Seller là người hiểu bối cảnh thương hiệu, sản phẩm và tiêu chí hình ảnh tốt hơn hệ thống tự động. Vì vậy cần một bước xem before/after và quyết định rõ ràng.', solves: 'Cho phép seller từ chối output mà không ảnh hưởng ảnh gốc, hoặc xác nhận để đi tiếp. Đóng dialog cũng chỉ đóng giao diện, không vô tình thay đổi product graph.' },
  17: { reason: 'Bản preview có thể được tạo nhanh để seller xem trước, nhưng bản lưu chính thức cần chất lượng hoặc kích thước cao hơn. Finalization tạo bản cuối sau khi seller đã đồng ý.', solves: 'Tách tốc độ xem trước khỏi chất lượng lưu trữ. Trong lúc tạo bản cuối, preview và ảnh gốc vẫn được giữ nguyên; thao tác apply lặp lại cũng không tạo nhiều bản sao nhờ jobId idempotency.' },
  18: { reason: 'Trong thời gian AI xử lý, seller hoặc hệ thống khác có thể đã cập nhật sản phẩm. Product Service phải kiểm tra lại quyền sở hữu và phiên bản ngay trước khi ghi.', solves: 'Optimistic locking ngăn kết quả cũ ghi đè thay đổi mới. Nếu version không còn khớp, API trả 409 để tạo job mới thay vì âm thầm làm mất cập nhật của seller.' },
  19: { reason: 'Sau khi Product Service commit thành công, hệ thống cần chốt trạng thái job, lưu audit metadata và xử lý asset tạm theo retention policy.', solves: 'Giúp UI và các service biết kết quả đã thực sự được áp dụng. Cleanup chỉ dọn output AI khi an toàn, còn ảnh gốc và thông tin rollback vẫn được bảo toàn.' },
};

const state = { activeStage: 1, timer: null, playing: false, speed: 1 };
const map = document.querySelector('#architecture-map');
const flowLines = map.querySelector('.flow-lines');
const sellerNode = map.querySelector('.lane-seller .architecture-node');
const productNode = map.querySelector('.lane-product .architecture-node');
const mainConnector = flowLines.querySelector('.connector-main');

// Tính lại đoạn nối 14 → 18 từ vị trí render thật của hai card thay vì dùng tọa độ SVG cố định.
// Cách này giữ connector chạm đúng mép Media Service và Product Service khi container đổi kích thước
// hoặc khi người dùng cuộn ngang ở màn hình nhỏ.
function syncMediaProductConnector() {
  if (!flowLines || !mainConnector || !sellerNode || !productNode) return;

  const mapRect = map.getBoundingClientRect();
  const svgRect = flowLines.getBoundingClientRect();
  const viewBox = flowLines.viewBox.baseVal;
  const sellerRect = sellerNode.getBoundingClientRect();
  const productRect = productNode.getBoundingClientRect();
  const scaleX = viewBox.width / svgRect.width;
  const scaleY = viewBox.height / svgRect.height;
  const toSvgX = (x) => (x - svgRect.left) * scaleX;
  const toSvgY = (y) => (y - svgRect.top) * scaleY;
  const y = toSvgY(sellerRect.top + sellerRect.height / 2);
  const startX = toSvgX(sellerRect.left);
  const endX = toSvgX(productRect.left);

  // Chỉ vẽ khi Product Service nằm bên phải Media Service; tránh tạo đường ngược khi layout mobile xếp dọc.
  if (endX <= startX || mapRect.width <= 0) {
    mainConnector.setAttribute('d', 'M0 0');
    return;
  }
  mainConnector.setAttribute('d', `M${startX} ${y}H${endX}`);
}

syncMediaProductConnector();
window.addEventListener('resize', syncMediaProductConnector);

const stageStatus = document.querySelector('#stage-status');
const stageProgressBar = document.querySelector('#stage-progress-bar');
const detailsPanel = document.querySelector('#details-panel');
const detailsTitle = document.querySelector('#details-title');
const detailsSummary = document.querySelector('#details-summary');
const detailsInput = document.querySelector('#details-input');
const detailsOutput = document.querySelector('#details-output');
const detailsSafety = document.querySelector('#details-safety');
const detailsFailure = document.querySelector('#details-failure');
const detailsReason = document.createElement('p');
const detailsSolves = document.createElement('p');
const detailsReasonLabel = document.createElement('span');
const detailsSolvesLabel = document.createElement('span');

// Thêm hai vùng giải thích ngay dưới phần mô tả để mỗi node trả lời được cả "vì sao" và "giải quyết gì".
detailsReason.className = 'detail-explanation';
detailsSolves.className = 'detail-explanation';
detailsReasonLabel.className = 'detail-label';
detailsReasonLabel.textContent = 'VÌ SAO CẦN BƯỚC NÀY';
detailsSolvesLabel.className = 'detail-label';
detailsSolvesLabel.textContent = 'BƯỚC NÀY GIẢI QUYẾT GÌ';
detailsSummary.insertAdjacentElement('afterend', detailsReason);
detailsReason.insertAdjacentElement('beforebegin', detailsReasonLabel);
detailsReason.insertAdjacentElement('afterend', detailsSolvesLabel);
detailsSolvesLabel.insertAdjacentElement('afterend', detailsSolves);

// Đồng bộ stage đang chạy vào timeline, node kiến trúc và live region để người dùng biết vị trí trong luồng.
function setActiveStage(stageId) {
  const stage = FLOW_STAGES.find((item) => item.id === stageId);
  if (!stage) return;
  state.activeStage = stage.id;
  document.querySelectorAll('[data-stage]').forEach((element) => {
    const elementStage = Number(element.dataset.stage);
    element.classList.toggle('is-active', elementStage === stage.id);
    element.classList.toggle('is-complete', elementStage < stage.id);
  });
  stageProgressBar.style.width = `${(stage.id / FLOW_STAGES.length) * 100}%`;
  stageStatus.textContent = `Bước ${stage.id} / ${FLOW_STAGES.length} · ${stage.title} · ${stage.summary}`;
}

// Mở bảng chi tiết của một bước mà không hiển thị ID thật hoặc secret runtime.
function openStageDetails(stageId) {
  const stage = FLOW_STAGES.find((item) => item.id === stageId);
  if (!stage) return;
  setActiveStage(stage.id);
  detailsTitle.textContent = `${String(stage.id).padStart(2, '0')} · ${stage.title}`;
  detailsSummary.textContent = stage.summary;
  detailsInput.textContent = stage.input;
  detailsOutput.textContent = stage.output;
  detailsSafety.textContent = stage.safety;
  detailsFailure.textContent = stage.failure;
  detailsReason.textContent = STAGE_EXPLANATIONS[stage.id]?.reason ?? 'Bước này bảo đảm dữ liệu được chuyển đúng sang giai đoạn tiếp theo.';
  detailsSolves.textContent = STAGE_EXPLANATIONS[stage.id]?.solves ?? 'Giảm lỗi và bảo vệ tính nhất quán của luồng xử lý.';
  detailsPanel.classList.add('is-open');
  detailsPanel.setAttribute('aria-hidden', 'false');
  document.querySelector('#close-details').focus();
}

// Đóng bảng chi tiết, không đụng vào pointer-events của body để trang luôn thao tác được.
function closeStageDetails() {
  detailsPanel.classList.remove('is-open');
  detailsPanel.setAttribute('aria-hidden', 'true');
}

// Dừng timer cũ trước khi tạo timer mới để Play không sinh nhiều vòng lặp cạnh tranh.
function pausePlayback() {
  state.playing = false;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  stageStatus.textContent = `Đã tạm dừng · Bước ${state.activeStage} / ${FLOW_STAGES.length}`;
}

// Chạy tuần tự 19 bước bằng timeout đệ quy để tốc độ có thể thay đổi an toàn.
function startPlayback() {
  if (state.playing) return;
  state.playing = true;
  const advance = () => {
    if (!state.playing) return;
    if (state.activeStage >= FLOW_STAGES.length) {
      state.playing = false;
      stageStatus.textContent = 'Đã hoàn tất mô phỏng · Seller vẫn phải duyệt trước khi áp dụng.';
      return;
    }
    state.timer = window.setTimeout(() => { setActiveStage(state.activeStage + 1); advance(); }, 1500 / state.speed);
  };
  advance();
}

// Đưa mô phỏng về bước đầu để người dùng có thể xem lại toàn bộ luồng.
function replayFlow() {
  pausePlayback();
  setActiveStage(1);
  stageStatus.textContent = 'Sẵn sàng bắt đầu · Bước 1 / 19';
}

// Bật/tắt nhánh lỗi bằng class, để CSS điều khiển hiển thị mà không làm thay đổi layout.
function toggleFailurePath() {
  const toggle = document.querySelector('#failure-toggle');
  const enabled = toggle.getAttribute('aria-pressed') === 'true';
  toggle.setAttribute('aria-pressed', String(!enabled));
  map.classList.toggle('show-failure', !enabled);
}

document.querySelectorAll('.stage-node, .architecture-node').forEach((node) => node.addEventListener('click', () => openStageDetails(Number(node.dataset.stage))));
document.querySelector('#play-button').addEventListener('click', startPlayback);
document.querySelector('#pause-button').addEventListener('click', pausePlayback);
document.querySelector('#replay-button').addEventListener('click', replayFlow);
document.querySelector('#failure-toggle').addEventListener('click', toggleFailurePath);
document.querySelector('#close-details').addEventListener('click', closeStageDetails);
document.querySelector('#previous-button').addEventListener('click', () => { pausePlayback(); setActiveStage(Math.max(1, state.activeStage - 1)); });
document.querySelector('#next-button').addEventListener('click', () => { pausePlayback(); setActiveStage(Math.min(FLOW_STAGES.length, state.activeStage + 1)); });
document.querySelector('#speed-select').addEventListener('change', (event) => { state.speed = Number(event.target.value); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && detailsPanel.classList.contains('is-open')) closeStageDetails(); });
setActiveStage(1);

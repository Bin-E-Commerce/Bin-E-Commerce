// Điều khiển mô phỏng Recommendation; không gọi API, không chứa secret và chỉ điều phối dữ liệu trình bày.

const FLOW_STAGES = [
  { id: 1, phase: 'PHASE 01 · EVENT FOUNDATION', title: 'Người dùng tương tác', summary: 'Một hành vi mua sắm được tạo ra từ product view, click, search, cart, wishlist, impression hoặc purchase.', input: 'Hành động và context trên Web App', output: 'Behavior signal thô', reason: 'Recommendation chỉ có thể cá nhân hóa khi quan sát được cách người dùng khám phá và ra quyết định. Mỗi tín hiệu là một mảnh context khác nhau, từ quan tâm nhẹ như impression tới ý định mạnh như add-to-cart hoặc completed purchase.', solves: 'Tạo đầu vào chung cho profile, candidate generation, ranking và đo lường. Hệ thống không còn phụ thuộc vào một danh sách newest hoặc bestseller cố định.', safety: 'Không ghi nhận dữ liệu vượt quá mục đích recommendation; purchase chỉ được xem là positive khi Order Service phát ra trạng thái COMPLETED.', failure: 'Event không được tạo hoặc trình duyệt offline → UX vẫn tiếp tục; Web có thể retry nhẹ nhưng không chặn thao tác mua sắm.' },
  { id: 2, phase: 'PHASE 01 · EVENT FOUNDATION', title: 'Web tạo behavior event', summary: 'Frontend chuẩn hóa hành vi thành event có eventId, sessionId, context trang và product reference.', input: 'Behavior signal + productId/variantId + page context', output: 'Versioned interaction envelope', reason: 'Một event có cấu trúc ổn định giúp các service phía sau hiểu cùng một ý nghĩa và cho phép replay khi pipeline cần xây lại profile.', solves: 'Loại bỏ payload tùy tiện giữa các màn hình; guest vẫn có sessionId UUID để nhận gợi ý cơ bản trước khi đăng nhập.', safety: 'Không gửi access token, email, địa chỉ hoặc userId tự khai báo. EventId được tạo ở client nhưng phải được kiểm tra lại ở server.', failure: 'Thiếu product reference hoặc sessionId → event bị đánh dấu invalid, không làm hỏng trải nghiệm chính.' },
  { id: 3, phase: 'PHASE 01 · EVENT FOUNDATION', title: 'Gateway xác thực actor', summary: 'API Gateway kiểm tra JWT hoặc guest session, sau đó forward trusted identity tới Recommendation Service.', input: 'JWT, sessionId và request event', output: 'User context đáng tin cậy + request đã giới hạn tốc độ', reason: 'Browser không phải nơi đáng tin để quyết định danh tính. Gateway là trust boundary chung để userId authenticated được lấy từ authentication context.', solves: 'Ngăn giả mạo user, spam event và việc Recommendation Service phải tự mở rộng logic auth của toàn hệ thống.', safety: 'Không tin userId do frontend gửi; rate limit theo user/session/IP; secret của service không đi qua browser.', failure: 'Token hết hạn → trả 401; session lỗi → chỉ bỏ event, không chặn các chức năng mua sắm khác.' },
  { id: 4, phase: 'PHASE 01 · EVENT FOUNDATION', title: 'Kafka nhận event', summary: 'Event được publish lên topic versioned để tách request nhanh khỏi xử lý bất đồng bộ.', input: 'Interaction envelope đã qua Gateway', output: 'recommendation.interactions.v1', reason: 'Profile và interaction ledger không nên nằm trên request path của người dùng. Kafka tạo buffer, cho phép retry và scale consumer độc lập với Web.', solves: 'Bảo vệ API khỏi spike traffic và giữ event khi consumer hoặc database tạm thời không sẵn sàng.', safety: 'Partition theo userId hoặc sessionId để giữ thứ tự tương đối; payload không chứa binary, token hay PII.', failure: 'Kafka unavailable → producer retry/outbox path; nếu vượt ngưỡng, event được quan sát qua DLQ/alert thay vì báo thành công giả.' },
  { id: 5, phase: 'PHASE 01 · EVENT FOUNDATION', title: 'Validate và deduplicate', summary: 'Consumer kiểm tra allow-list, bounded fields, timestamp, actor và eventId trước khi xử lý.', input: 'Kafka event', output: 'Interaction hợp lệ hoặc failure record', reason: 'Kafka có thể redeliver và các producer có thể phát event không đầy đủ. Validation phải xảy ra trước profile update để dữ liệu lỗi không lan sang ranking.', solves: 'Ngăn event trùng, sai loại hoặc chứa dữ liệu nguy hiểm làm sai sở thích của user.', safety: 'eventId là idempotency key; xử lý duplicate thành safe no-op; event hỏng đi DLQ sau retry có giới hạn.', failure: 'Schema mismatch hoặc invalid payload → reject có lý do; không retry vô hạn dữ liệu chắc chắn sai.' },
  { id: 6, phase: 'PHASE 01 · EVENT FOUNDATION', title: 'Lưu interaction ledger', summary: 'Recommendation Service lưu event đã xác thực vào PostgreSQL database do chính service sở hữu.', input: 'Validated interaction', output: 'recommendation_interactions + processing metadata', reason: 'Ledger bền vững là nền để replay, debug, audit và xây lại profile khi thuật toán thay đổi.', solves: 'Tách dữ liệu hành vi khỏi database của Product, Cart và Order; service có thể phát triển pipeline riêng mà không phá ownership.', safety: 'Unique eventId, processing status, received/processed time và DLQ metadata; không query database chéo service.', failure: 'PostgreSQL lỗi → retry; retry cạn → DLQ và alert; event chưa persist không được dùng làm tín hiệu chính thức.' },
  { id: 7, phase: 'PHASE 02 · BEHAVIORAL PROFILE & SESSION INTENT', title: 'Normalize tín hiệu', summary: 'Interaction được chuyển thành feature có loại hành vi, trọng số, độ mới, tần suất và context.', input: 'Interaction ledger', output: 'Normalized behavior features', reason: 'View, click, add-to-cart và purchase phản ánh mức độ quan tâm khác nhau. Time decay giúp nhu cầu hiện tại không bị lịch sử quá cũ lấn át.', solves: 'Tạo một thang đo nhất quán cho category affinity, brand affinity, session intent và ranking score.', safety: 'Trọng số và decay phải cấu hình được; cancellation không cộng điểm; return/refund tạo negative signal.', failure: 'Event thiếu timestamp hoặc context → dùng giá trị an toàn và ghi cảnh báo, không làm profile tăng điểm bất thường.' },
  { id: 8, phase: 'PHASE 02 · BEHAVIORAL PROFILE & SESSION INTENT', title: 'Cập nhật long-term profile', summary: 'Hệ thống duy trì sở thích dài hạn theo category, brand, price, product, shop và thuộc tính.', input: 'Normalized features + lịch sử đã xử lý', output: 'User preference profile', reason: 'Long-term profile giúp hệ thống hiểu user qua nhiều phiên, kể cả khi phiên hiện tại chưa có đủ hành vi.', solves: 'Tạo cá nhân hóa ổn định thay vì mỗi request chỉ nhìn một lượt xem gần nhất.', safety: 'Profile không lưu PII không cần thiết; profile version tăng khi projection thay đổi để cache cũ không được dùng vô thời hạn.', failure: 'Projection lỗi hoặc stale → giữ profile trước đó, retry bằng event ledger; không xóa sạch sở thích chỉ vì một batch lỗi.' },
  { id: 9, phase: 'PHASE 02 · BEHAVIORAL PROFILE & SESSION INTENT', title: 'Cập nhật session intent', summary: 'Session profile phản ánh nhu cầu hiện tại qua chuỗi view, search, click và cart gần nhất.', input: 'Recent normalized interactions', output: 'Category/brand/price intent + confidence', reason: 'Người dùng có thể hôm nay tìm laptop nhưng lịch sử dài hạn lại thiên về thời trang. Session intent cần thắng trong ngữ cảnh ngắn hạn.', solves: 'Giúp lần gọi kế tiếp ưu tiên sản phẩm đúng nhu cầu đang diễn ra, không chỉ lặp lại sở thích cũ.', safety: 'Intent có confidence và lastActivity; tín hiệu cũ giảm dần; query hoặc product context không được giữ vô hạn.', failure: 'Thiếu hành vi gần đây → dùng long-term profile hoặc anonymous fallback.' },
  { id: 10, phase: 'PHASE 02 · BEHAVIORAL PROFILE & SESSION INTENT', title: 'Merge anonymous profile', summary: 'Khi guest đăng nhập, session profile được hợp nhất với user profile mà không làm mất context vừa tạo.', input: 'Anonymous session profile + authenticated user profile', output: 'Merged profile có version mới', reason: 'Guest đã để lại nhiều tín hiệu có giá trị trước khi login. Bỏ chúng đi sẽ khiến recommendation đột ngột trở nên kém liên quan.', solves: 'Liên kết hành trình trước và sau đăng nhập, đồng thời giữ lịch sử dài hạn và purchase history đáng tin cậy.', safety: 'Gateway cung cấp userId; merge phải idempotent, không để session cũ ghi đè preference chính thức hoặc dữ liệu nhạy cảm.', failure: 'Merge conflict → giữ hai projection để retry; user vẫn nhận gợi ý từ session hiện tại.' },
  { id: 11, phase: 'PHASE 03 · CATALOG INTELLIGENCE & CANDIDATE GENERATION', title: 'Đồng bộ product read model', summary: 'Recommendation nhận product context cần thiết từ Product Service qua event hoặc internal API được kiểm soát.', input: 'Product/category/brand/price/status/stock contract', output: 'Local catalog read model', reason: 'Candidate và hard filter cần product data nhanh, nhưng Product Service vẫn phải là source of truth.', solves: 'Giảm latency và loại bỏ việc Recommendation query trực tiếp database của Product Service.', safety: 'Read model có updatedAt, originType và sync version; stock/active status được xem là dynamic data, không nhúng cố định vào vector.', failure: 'Product sync chậm → đánh dấu stale; không đưa product không chắc chắn vào kết quả nếu hard filter không xác minh được.' },
  { id: 12, phase: 'PHASE 03 · CATALOG INTELLIGENCE & CANDIDATE GENERATION', title: 'AI tạo product embedding', summary: 'AI Service tạo vector từ tên, mô tả, category, brand và attributes của sản phẩm.', input: 'Stable product content', output: 'Embedding + model metadata', reason: 'Embedding giúp tìm sản phẩm tương tự về ngữ nghĩa và thuộc tính ngay cả khi tên sản phẩm không giống nhau.', solves: 'Xử lý long-tail, synonym và sản phẩm mới tốt hơn keyword hoặc category matching đơn thuần.', safety: 'Lưu modelVersion, dimension, contentHash và updatedAt; không đưa stock hoặc giá động vào embedding.', failure: 'AI timeout hoặc lỗi model → retry có giới hạn, giữ embedding cũ nếu content chưa đổi hoặc bỏ qua semantic source.' },
  { id: 13, phase: 'PHASE 03 · CATALOG INTELLIGENCE & CANDIDATE GENERATION', title: 'Index embedding vào Qdrant', summary: 'Embedding được lưu vào collection product_embeddings cùng payload phục vụ filter và attribution.', input: 'Embedding + product metadata', output: 'Qdrant vector point', reason: 'Vector index là lớp retrieval hiệu quả cho candidate semantic, tách khỏi database nghiệp vụ.', solves: 'Cho phép tìm Top-N sản phẩm tương tự theo user/session/product context mà không cần scan toàn catalog.', safety: 'Payload gồm productId, categoryId, brandId, sellerShopId, price, originType, isActive, isInStock và modelVersion; không tạo collection theo user.', failure: 'Qdrant unavailable → candidate pipeline dùng co-behavior, category, trending và newest; index rebuild được theo model version.' },
  { id: 14, phase: 'PHASE 03 · CATALOG INTELLIGENCE & CANDIDATE GENERATION', title: 'Semantic retrieval', summary: 'Hệ thống dùng representation của product hoặc session để lấy các sản phẩm gần về ngữ nghĩa.', input: 'Session/user representation + Qdrant collection', output: 'Semantic candidate list + similarity score', reason: 'Sản phẩm tiếp theo không nhất thiết phải cùng từ khóa; semantic retrieval mở rộng những lựa chọn có cùng nhu cầu.', solves: 'Tăng recall cho query tự nhiên, sản phẩm mới và các mối liên hệ không có đủ lịch sử co-view.', safety: 'Similarity chỉ là một nguồn score, không được bỏ qua active/stock filter và không tự quyết định kết quả cuối.', failure: 'Vector không có hoặc score thấp → giảm tỷ trọng semantic, chuyển sang behavioral và business candidates.' },
  { id: 15, phase: 'PHASE 03 · CATALOG INTELLIGENCE & CANDIDATE GENERATION', title: 'Gom multi-source candidates', summary: 'Candidate pool được tạo từ co-view, co-cart, co-purchase, category, brand, price, trending, newest, recent và explore.', input: 'Profile, intent, catalog read model, relations và vector results', output: 'Candidate pool rộng có source metadata', reason: 'Mỗi nguồn có điểm mạnh riêng: semantic hiểu nội dung, co-purchase hiểu hành vi cộng đồng, trending giải quyết cold-start.', solves: 'Tránh phụ thuộc vào một thuật toán duy nhất và tạo danh sách đủ rộng trước khi ranking.', safety: 'Purchase chỉ dùng COMPLETED; CANCELLED không phải positive; RETURN_REFUND là negative; multi-item phải giữ đúng product/variant/quantity.', failure: 'Một source lỗi không làm mất các source còn lại; nếu profile rỗng dùng newest/trending/category.' },
  { id: 16, phase: 'PHASE 03 · CATALOG INTELLIGENCE & CANDIDATE GENERATION', title: 'Union, deduplicate và attribution', summary: 'Các candidate trùng được hợp nhất, giữ provenance và tạo lý do gợi ý cho từng product.', input: 'Nhiều candidate lists và source scores', output: 'Unified candidate pool + source/reason metadata', reason: 'Một sản phẩm có thể xuất hiện từ semantic, co-view và category cùng lúc. Giữ source giúp ranking biết tín hiệu nào mạnh và UI có thể giải thích.', solves: 'Không render trùng sản phẩm, đo được hiệu quả từng candidate source và tạo explanation không mơ hồ.', safety: 'Dedupe theo product/variant phù hợp; không làm mất source mạnh nhất; score normalization diễn ra trước khi cộng.', failure: 'Metadata thiếu → dùng reason chung an toàn; candidate vẫn phải qua hard filter trước khi trả về.' },
  { id: 17, phase: 'PHASE 04 · FILTERING, RANKING, DIVERSITY & SERVING', title: 'Hard filtering', summary: 'Loại sản phẩm không hợp lệ trước khi tính điểm ranking.', input: 'Unified candidate pool + catalog state', output: 'Eligible candidates', reason: 'Một sản phẩm hết hàng hoặc inactive không thể trở thành kết quả hợp lệ chỉ vì score cao.', solves: 'Bảo vệ trải nghiệm, giảm click vào sản phẩm không mua được và bảo đảm business rule luôn thắng relevance.', safety: 'Loại product không tồn tại, inactive, hidden, archived, out-of-stock theo policy, chính sản phẩm đang xem và product vừa mua trong cooldown.', failure: 'Candidate pool rỗng → dùng fallback theo thứ tự newest/trending/category active.' },
  { id: 18, phase: 'PHASE 04 · FILTERING, RANKING, DIVERSITY & SERVING', title: 'Feature extraction và normalize', summary: 'Mỗi candidate nhận các feature về semantic, affinity, behavior, price, popularity, freshness và exploration.', input: 'Eligible candidates + user/session context', output: 'Normalized feature vectors', reason: 'Score từ các nguồn có scale khác nhau. Normalize trước khi kết hợp giúp semantic score không lấn át mọi tín hiệu khác.', solves: 'Tạo nền tảng cho weighted ranking hiện tại và learned ranking về sau.', safety: 'Feature thiếu phải có default rõ ràng; dynamic stock dùng dữ liệu mới nhất; log feature version để debug.', failure: 'Feature service lỗi → dùng baseline features; không để NaN hoặc score vô hạn đi vào ranker.' },
  { id: 19, phase: 'PHASE 04 · FILTERING, RANKING, DIVERSITY & SERVING', title: 'Weighted ranking', summary: 'Hệ thống tính finalScore minh bạch từ nhiều tín hiệu và sắp xếp candidate theo mức phù hợp.', input: 'Normalized features + configured weights', output: 'Ranked candidates + score breakdown', reason: 'Weighted score dễ kiểm tra, dễ giải thích và phù hợp giai đoạn đầu khi chưa có đủ nhãn để train model.', solves: 'Biến candidate pool thành thứ tự ưu tiên có thể phục vụ Web và đo lường theo từng thành phần.', safety: 'Có tie-breaker ổn định, weights version, negative feedback penalty và không xếp lại product đã hard-filter.', failure: 'Ranker lỗi → baseline category/trending/newest; ghi metric để không che giấu sự cố.' },
  { id: 20, phase: 'PHASE 04 · FILTERING, RANKING, DIVERSITY & SERVING', title: 'Diversity rerank', summary: 'Re-ranking cân bằng relevance với độ đa dạng về brand, category, shop và exploration.', input: 'Ranked candidates + diversity policy', output: 'Final Top-K list', reason: 'Danh sách toàn sản phẩm cùng brand có thể có score cao nhưng tạo cảm giác nghèo nàn và bỏ lỡ cơ hội khám phá.', solves: 'Giữ danh sách vừa liên quan vừa đa dạng; dành khoảng 5–10% vị trí cho sản phẩm mới hoặc ít phổ biến.', safety: 'Diversity không được hy sinh hard constraint; caps phải cấu hình được; MMR hoặc rule-based rerank có thể replay.', failure: 'Policy lỗi → giữ ranked list đã filter; không trả product ngoài candidate pool.' },
  { id: 21, phase: 'PHASE 04 · FILTERING, RANKING, DIVERSITY & SERVING', title: 'Cache Redis', summary: 'Final recommendation được cache theo user/session, surface, context và profile version.', input: 'Final Top-K list + cache context', output: 'Cached recommendation response', reason: 'Recommendation có thể bị gọi nhiều lần trong một session. Redis giúp latency ổn định mà không phải chạy lại toàn pipeline.', solves: 'Đạt mục tiêu cache hit p95 dưới 300ms và cache miss p95 dưới 800ms.', safety: 'TTL tối đa 5 phút; add-to-cart và purchase invalidate nhanh hơn; cache key không chứa PII; profile version ngăn dùng kết quả cũ.', failure: 'Redis down → chạy pipeline trực tiếp hoặc fallback; cache failure không được làm Web error.' },
  { id: 22, phase: 'PHASE 04 · FILTERING, RANKING, DIVERSITY & SERVING', title: 'Recommendation API', summary: 'Gateway gọi Recommendation API để lấy Top-K theo surface như home hoặc product detail.', input: 'Trusted context + surface + product/category context + limit', output: 'Products + position + source + reason + request metadata', reason: 'Serving API là boundary duy nhất để Web nhận recommendation; nó che giấu candidate, profile và ranking implementation phía sau.', solves: 'Cho phép thay algorithm mà không đổi UI contract, đồng thời hỗ trợ impression/click attribution bằng requestId và position.', safety: 'API không trả dữ liệu master lỗi thời thay Product Service; timeout có fallback; limit được bounded để bảo vệ tài nguyên.', failure: 'Recommendation Service lỗi → Gateway/Web dùng catalog fallback; checkout và browsing không bị chặn.' },
  { id: 23, phase: 'PHASE 05 · FEEDBACK, EVALUATION & PRODUCTION READINESS', title: 'Render, reason và impression', summary: 'Web hiển thị product card cùng lý do gợi ý và ghi impression khi sản phẩm thật sự vào viewport.', input: 'Recommendation response', output: 'Rendered list + impression/click events', reason: 'Impression là mẫu số để biết candidate có cơ hội được nhìn thấy; reason giúp người dùng hiểu vì sao sản phẩm xuất hiện.', solves: 'Đo đúng CTR theo position/source và nối được từ recommendation request tới click/cart.', safety: 'Chỉ ghi impression khi thực sự hiển thị; giữ requestId, position và surface; không block render nếu tracking thất bại.', failure: 'Tracking lỗi → UI vẫn hoạt động; event được retry nhẹ hoặc bỏ qua theo policy.' },
  { id: 24, phase: 'PHASE 05 · FEEDBACK, EVALUATION & PRODUCTION READINESS', title: 'Feedback và A/B test', summary: 'Click, cart, completed purchase, cancel và return/refund quay lại làm feedback cho evaluation và cải thiện pipeline.', input: 'Impression/click/cart/order outcomes', output: 'Metrics, experiment result và model/rule feedback', reason: 'Không thể đánh giá recommendation bằng cảm giác. Cần so sánh với newest, bestseller, category-based và content-based baseline bằng cả offline lẫn online metrics.', solves: 'Biết source nào hiệu quả, ranking có tăng CTR/add-to-cart/purchase không, fallback có thường xuyên xảy ra không và khi nào đủ dữ liệu để learned ranking.', safety: 'Purchase chính thức chỉ là COMPLETED; cancellation không cộng điểm; refund/return là negative; A/B assignment và exposure phải audit được.', failure: 'Metric pipeline lỗi → giữ raw events để replay; experiment không đủ sample → không kết luận và rollback về baseline an toàn.' },
];

const state = { activeStage: 1, timer: null, playing: false, speed: 1 };
const stageStatus = document.querySelector('#stage-status');
const stageProgressBar = document.querySelector('#stage-progress-bar');
const architectureMap = document.querySelector('#architecture-map');
const detailsPanel = document.querySelector('#details-panel');
const detailsTitle = document.querySelector('#details-title');
const detailsPhase = document.querySelector('#details-phase');
const detailsSummary = document.querySelector('#details-summary');
const detailsInput = document.querySelector('#details-input');
const detailsOutput = document.querySelector('#details-output');
const detailsReason = document.querySelector('#details-reason');
const detailsSolves = document.querySelector('#details-solves');
const detailsSafety = document.querySelector('#details-safety');
const detailsFailure = document.querySelector('#details-failure');

// Đồng bộ stage đang chạy vào timeline, architecture map và live region để người xem luôn biết vị trí trong flow.
// Stage nhỏ hơn hiện tại được đánh dấu hoàn tất; node không có stage trực tiếp vẫn giữ trạng thái trung tính.
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
  stageStatus.textContent = `Bước ${String(stage.id).padStart(2, '0')} / ${FLOW_STAGES.length} · ${stage.title}`;
}

// Mở panel chi tiết bằng dữ liệu tĩnh của bước, không hiển thị ID thật, secret hoặc dữ liệu runtime của hệ thống.
// Nội dung panel tập trung vào mục đích, boundary, invariant và fallback để hỗ trợ thuyết trình kiến trúc.
function openStageDetails(stageId) {
  const stage = FLOW_STAGES.find((item) => item.id === stageId);
  if (!stage) return;

  setActiveStage(stage.id);
  detailsTitle.textContent = `${String(stage.id).padStart(2, '0')} · ${stage.title}`;
  detailsPhase.textContent = stage.phase;
  detailsSummary.textContent = stage.summary;
  detailsInput.textContent = stage.input;
  detailsOutput.textContent = stage.output;
  detailsReason.textContent = stage.reason;
  detailsSolves.textContent = stage.solves;
  detailsSafety.textContent = stage.safety;
  detailsFailure.textContent = stage.failure;
  detailsPanel.classList.add('is-open');
  detailsPanel.setAttribute('aria-hidden', 'false');
  document.querySelector('#close-details').focus();
}

// Đóng panel chi tiết và giữ nguyên stage hiện tại để người xem có thể tiếp tục mô phỏng từ vị trí cũ.
function closeStageDetails() {
  detailsPanel.classList.remove('is-open');
  detailsPanel.setAttribute('aria-hidden', 'true');
}

// Dừng timer cũ trước khi tạo vòng lặp mới để nhiều lần bấm Play không tạo các nhánh tiến trình cạnh tranh.
function pausePlayback() {
  state.playing = false;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  stageStatus.textContent = `Đã tạm dừng · Bước ${String(state.activeStage).padStart(2, '0')} / ${FLOW_STAGES.length}`;
}

// Chạy tuần tự 24 bước bằng timeout đệ quy để tốc độ có thể đổi mà không tạo interval bị treo.
// Khi tới bước cuối, mô phỏng dừng lại và nhấn mạnh rằng feedback là vòng lặp quay về event pipeline.
function startPlayback() {
  if (state.playing) return;
  state.playing = true;

  const advance = () => {
    if (!state.playing) return;
    if (state.activeStage >= FLOW_STAGES.length) {
      state.playing = false;
      stageStatus.textContent = 'Đã hoàn tất mô phỏng · Feedback quay lại làm dữ liệu cho lần gợi ý tiếp theo.';
      return;
    }
    state.timer = window.setTimeout(() => {
      setActiveStage(state.activeStage + 1);
      advance();
    }, 1500 / state.speed);
  };

  advance();
}

// Đưa flow về bước đầu và xóa timer cũ để người xem có thể trình bày lại từ đầu.
function replayFlow() {
  pausePlayback();
  setActiveStage(1);
  stageStatus.textContent = `Sẵn sàng bắt đầu · Bước 01 / ${FLOW_STAGES.length}`;
}

// Bật nhánh lỗi trên architecture map bằng class để CSS cùng lúc hiện connector, packet và nhãn fallback.
function toggleFailurePath() {
  const toggle = document.querySelector('#failure-toggle');
  const enabled = toggle.getAttribute('aria-pressed') === 'true';
  toggle.setAttribute('aria-pressed', String(!enabled));
  architectureMap.classList.toggle('show-failure', !enabled);
}

// Mở đúng stage tương ứng với node được chọn trong timeline hoặc architecture map.
// Cả hai loại node dùng chung contract data-stage để không nhân đôi dữ liệu flow.
function handleStageNodeClick(event) {
  openStageDetails(Number(event.currentTarget.dataset.stage));
}

// Chuyển về stage trước và dừng playback để thao tác điều khiển thủ công không bị timer ghi đè.
function handlePreviousClick() {
  pausePlayback();
  setActiveStage(Math.max(1, state.activeStage - 1));
}

// Chuyển tới stage kế tiếp và dừng playback để người xem kiểm soát chính xác từng bước.
function handleNextClick() {
  pausePlayback();
  setActiveStage(Math.min(FLOW_STAGES.length, state.activeStage + 1));
}

// Lưu tốc độ mô phỏng vào state để các timeout tiếp theo dùng cùng một tốc độ.
function handleSpeedChange(event) {
  state.speed = Number(event.target.value);
}

// Cho phép phím Escape đóng panel chi tiết mà không reset stage hiện tại.
function handleKeyDown(event) {
  if (event.key === 'Escape' && detailsPanel.classList.contains('is-open')) closeStageDetails();
}

// Gắn cùng một hành vi mở chi tiết cho timeline và architecture map để trải nghiệm điều hướng nhất quán.
function bindStageNode(node) {
  node.addEventListener('click', handleStageNodeClick);
}

document.querySelectorAll('.stage-node, .architecture-node').forEach(bindStageNode);
document.querySelector('#play-button').addEventListener('click', startPlayback);
document.querySelector('#pause-button').addEventListener('click', pausePlayback);
document.querySelector('#replay-button').addEventListener('click', replayFlow);
document.querySelector('#failure-toggle').addEventListener('click', toggleFailurePath);
document.querySelector('#close-details').addEventListener('click', closeStageDetails);
document.querySelector('#previous-button').addEventListener('click', handlePreviousClick);
document.querySelector('#next-button').addEventListener('click', handleNextClick);
document.querySelector('#speed-select').addEventListener('change', handleSpeedChange);
document.addEventListener('keydown', handleKeyDown);

setActiveStage(1);

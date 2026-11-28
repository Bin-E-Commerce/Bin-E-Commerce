// Kiểm tra hình học và tương tác của deck nội bộ dùng cấu trúc Recommendation.
// Chỉ báo lỗi từ mẫu DOM và toạ độ SVG đã chạy, không đánh giá bố cục CSS của trình duyệt.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const [, , input, root = process.cwd()] = process.argv;
const frameCount = 300;
const frameMilliseconds = 50;
const failures = new Set();

if (!input) {
    process.stderr.write('Cách dùng: node check-flow-deck.cjs <tệp HTML> [gốc repo]\n');
    process.exit(2);
}

// Đọc toạ độ và kích thước hiển thị để dùng cùng phép đo cho nút và nhãn.
function bounds(rect, left = 0, top = 0) {
    return {
        left: Number(rect.getAttribute('x')) + left,
        top: Number(rect.getAttribute('y')) + top,
        width: Number(rect.getAttribute('width')),
        height: Number(rect.getAttribute('height')),
    };
}

// Chỉ tính giao có diện tích để hai khung chạm biên vẫn hợp lệ.
function overlaps(a, b) {
    return a.left < b.left + b.width && a.left + a.width > b.left &&
        a.top < b.top + b.height && a.top + a.height > b.top;
}

// Lấy mẫu trên dây Bézier nội tại để phát hiện nhãn quét qua nét nối khi chạy.
// Trả lỗi cấu trúc nếu deck dùng bộ vẽ khác và cần kiểm tra bằng trình duyệt.
function pointsOnWire(wire) {
    const d = wire.getAttribute('d') || '';
    const coords = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number);
    assert(/^M\s.+\sC\s/i.test(d) && coords?.length === 8, 'Dây SVG cần có một đường Bézier bậc ba.');
    const [ax, ay, bx, by, cx, cy, dx, dy] = coords;
    return Array.from({ length: 161 }, (_, index) => {
        const t = index / 160;
        const u = 1 - t;
        return [
            u ** 3 * ax + 3 * u ** 2 * t * bx + 3 * u * t ** 2 * cx + t ** 3 * dx,
            u ** 3 * ay + 3 * u ** 2 * t * by + 3 * u * t ** 2 * cy + t ** 3 * dy,
        ];
    });
}

// Đo các nhãn trong cùng một khung trước khi tăng đồng hồ mô phỏng.
// Đối chiếu nhãn gốc, vị trí trên nhóm chuyển động và độ đậm của nhãn.
// Gom lỗi để một lần chạy hiện đủ các tuyến cần sửa.
function checkGraph(scene, svg, step) {
    const key = scene.id;
    const packets = [...svg.querySelectorAll('[data-packet]')];
    const expected = [...scene.content.querySelectorAll('[data-edge]')].map((edge) => {
        const [from, to] = edge.dataset.edge.split(',');
        return from + '-' + to;
    });
    assert.deepEqual(
        packets.map((packet) => packet.dataset.packet).sort(),
        expected.sort(),
        key + ' thiếu hoặc thừa gói theo đường nối',
    );
    const [left, top, width, height] = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
    assert(width > 0 && height > 0, key + ' có viewBox không hợp lệ');
    const nodes = [...svg.querySelectorAll('.flow-node rect')].map(rect => bounds(rect));
    for (const zone of scene.content.querySelectorAll('[data-zone]')) {
        // Dự phòng vùng chữ tiêu đề vùng theo cách mẫu đặt chữ mono ở góc trái.
        const [x, y] = zone.dataset.zone.split(',').map(Number);
        nodes.push({ left: x + 11, top: y + 6, width: zone.textContent.length * 7.5 + 4, height: 16 });
    }
    const wirePoints = [...svg.querySelectorAll('.flow-wire')].flatMap(pointsOnWire);
    const motion = packets.map(packet => {
        const name = key + ' / ' + packet.dataset.packet;
        const caption = packet.querySelector('.edge-label');
        const frame = packet.querySelector('.edge-label-frame');
        assert(packet.querySelector('circle') && frame && caption?.textContent.trim(), name + ' thiếu chấm hoặc tên dữ liệu');
        return { packet, name, frame, caption, text: caption.textContent, start: null, maxDrift: 0 };
    });
    for (let sample = 0; sample < frameCount; sample++) {
        const labels = [];
        for (const mark of motion) {
            const { packet, name, frame, caption } = mark;
            const translate = packet.getAttribute('transform')?.match(/^translate\(([-\d.]+)[ ,]+([-\d.]+)\)$/);
            assert(translate, name + ' thiếu transform của nhóm SVG');
            const x = Number(translate[1]);
            const y = Number(translate[2]);
            mark.start ??= [x, y];
            mark.maxDrift = Math.max(mark.maxDrift, Math.hypot(x - mark.start[0], y - mark.start[1]));
            if (caption.textContent !== mark.text || packet.matches('[hidden], [display="none"], [visibility="hidden"]') ||
                caption.matches('[hidden], [display="none"], [visibility="hidden"]')) {
                failures.add(name + ' đổi/mất chữ trong lúc chạy');
            }
            if (Number(packet.getAttribute('opacity') ?? 1) < .9 || Number(caption.getAttribute('opacity') ?? 1) < .9) {
                failures.add(name + ' làm mờ nhãn');
            }
            const box = bounds(frame, x, y);
            if (box.left < left || box.top < top || box.left + box.width > left + width || box.top + box.height > top + height) {
                failures.add(name + ' vượt khỏi viewBox');
            }
            if (nodes.some(node => overlaps(node, box))) failures.add(name + ' đè lên khối hoặc tiêu đề vùng');
            if (labels.some(label => overlaps(label, box))) failures.add(name + ' chồng lên nhãn khác');
            if (wirePoints.some(([px, py]) =>
                px > box.left && px < box.left + box.width && py > box.top && py < box.top + box.height,
            )) failures.add(name + ' che nét dây');
            labels.push(box);
        }
        step();
    }
    for (const mark of motion) {
        if (mark.maxDrift < 2) failures.add(mark.name + ' chưa di chuyển rõ');
    }
    return packets.length;
}

// Kiểm tra biểu đồ có dữ liệu hiện ngay, không đổi tương quan khi hoạt ảnh chạy.
// Nếu có khoảng tin cậy, hai cận phải hiện trong khung đầu.
function checkChart(key, svg, step) {
    const bars = [...svg.querySelectorAll('[data-chart-bar]')];
    assert(bars.length > 0, key + ' thiếu thanh dữ liệu');
    const interval = svg.querySelector('[data-interval]');
    if (interval) {
        assert(Number(interval.getAttribute('x2')) > Number(interval.getAttribute('x1')), key + ' có khoảng tin cậy co về một điểm');
    }
    const widths = bars.map(bar => Number(bar.getAttribute('width')));
    for (const [index, bar] of bars.entries()) {
        if (Number(bar.dataset.chartBar) > 0) assert(widths[index] > 0, key + ' chưa hiện thanh đã có giá trị');
    }
    for (let i = 0; i < 30; i++) step();
    assert.deepEqual(bars.map(bar => Number(bar.getAttribute('width'))), widths, key + ' thay hình học trong lúc hiện số');
}

// Dùng nhịp 50 ms giả lập để đi qua cùng một tập khung ở mọi máy.
// Mở trang/cảnh qua điều khiển của deck và xác nhận thành phần cần vẽ thật sự xuất hiện.
// Chỉ chạy JavaScript nhúng từ tệp nội bộ đáng tin cậy.
function checkDeck() {
    const requireFromWeb = createRequire(path.resolve(root, 'web', 'package.json'));
    const { JSDOM, VirtualConsole } = requireFromWeb('jsdom');
    const filename = path.resolve(input);
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => failures.add(error.message));
    const frames = new Map();
    let serial = 0;
    let now = 0;
    const dom = new JSDOM(fs.readFileSync(filename, 'utf8'), {
        url: pathToFileURL(filename).href,
        runScripts: 'dangerously',
        virtualConsole,
        beforeParse(window) {
            // Thay phần phụ thuộc trình duyệt thật, vẫn chạy đúng mã trang qua RAF và điều khiển.
            window.matchMedia = () => ({ matches: false });
            window.scrollTo = () => {};
            window.HTMLElement.prototype.scrollIntoView = () => {};
            window.requestAnimationFrame = callback => {
                frames.set(++serial, callback);
                return serial;
            };
            window.cancelAnimationFrame = id => frames.delete(id);
        },
    });
    // Chụp hàng đợi trước khi gọi để callback mới chỉ chạy ở khung sau.
    function step() {
        const pending = [...frames.values()];
        frames.clear();
        now += frameMilliseconds;
        for (const frame of pending) frame(now);
    }

    try {
        const { document } = dom.window;
        const pages = [...document.querySelectorAll('.side-menu [data-page]')];
        const slides = [...document.querySelectorAll('article.model-card')];
        const button = document.getElementById('present');
        assert(pages.length && pages.length === slides.length && button, 'Deck dùng cấu trúc khác mẫu Recommendation.');
        assert.deepEqual(pages.map(page => page.dataset.page), slides.map(slide => slide.id), 'Mục lục sai thứ tự hoặc tham chiếu trang thiếu.');
        if (document.documentElement.dataset.present !== 'on') button.click();
        assert.equal(document.documentElement.dataset.present, 'on', 'Nút trình chiếu chưa áp dụng bố cục F.');
        const result = { slides: pages.length, scenes: 0, diagrams: 0, charts: 0, edges: 0, framesPerDiagram: frameCount };
        for (const [index, page] of pages.entries()) {
            page.click();
            const active = [...document.querySelectorAll('article.model-card:not([hidden])')];
            assert.deepEqual(active.map(slide => slide.id), [page.dataset.page], 'Đã chọn sai trang.');
            const options = [...active[0].querySelectorAll('[data-choice]')];
            const sceneSections = [...active[0].querySelectorAll('section[data-view]')];
            assert.equal(sceneSections.length, options.length || 1, page.dataset.page + ' có cảnh chưa gắn nút');
            assert.notEqual(document.getElementById('page-count')?.textContent.trim(), '', 'Bộ đếm trang rỗng.');
            assert.equal(document.getElementById('page-count')?.textContent.replace(/\s/g, ''), (index + 1) + '/' + pages.length, 'Bộ đếm trang sai.');
            for (const option of options.length ? options : [null]) {
                option?.click();
                const visible = active[0].querySelectorAll('section[data-view]:not([hidden])');
                assert.equal(visible.length, 1, page.dataset.page + ' cần đúng một cảnh đang hiện');
                const view = visible[0];
                if (option) assert.equal(view.dataset.view, option.dataset.choice, 'Nút cảnh mở sai nội dung.');
                const host = view.querySelector('[data-stage]');
                result.scenes++;
                if (!host) continue;
                const scene = document.getElementById('scene-' + view.dataset.view);
                const graphic = host.querySelector('svg');
                assert(scene?.content && graphic, view.dataset.view + ' thiếu nguồn cảnh hoặc hình đã vẽ');
                if (view.hasAttribute('data-chart')) {
                    checkChart(scene.id, graphic, step);
                    result.charts++;
                } else {
                    result.edges += checkGraph(scene, graphic, step);
                    result.diagrams++;
                }
            }
        }
        process.stdout.write(JSON.stringify({ ...result, failures: [...failures] }, null, 2) + '\n');
        if (failures.size) process.exitCode = 1;
    } finally {
        dom.window.close();
    }
}

try {
    checkDeck();
} catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
}

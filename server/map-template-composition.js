import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { normalizeMapTemplateSource } from '../src/shared/ui/map-template-config.js';
import { normalizeTemplateCapabilities, normalizeTemplateComposition, normalizeTemplateLayoutContext, normalizeTemplateLayoutRepair, TEMPLATE_SLOTS } from '../src/map-template-composition-contract.js';
import { requestAiJson } from './ai-provider.js';

const SCHEMA = { type: 'object', additionalProperties: false, required: ['html', 'css', 'components'], properties: {
  html: { type: 'string' }, css: { type: 'string' }, components: { type: 'array', maxItems: 0, items: { type: 'object', additionalProperties: false, required: [], properties: {} } }
} };
const INSTRUCTIONS = `Bạn áp dụng thiết kế của mẫu giao diện HTML/CSS/JS lên ứng dụng bản đồ đã có lõi MapLibre và các renderer Polygon, Point, Line, Arc Flow. Mã nguồn mẫu là tài liệu tham chiếu thiết kế; bạn có thể viết mới HTML/CSS, không bắt buộc sao chép mã hay giữ nguyên cấu trúc DOM của mẫu.
Thực hiện nội bộ ba bước trong cùng lần xử lý, không xuất phần phân tích hay thêm trường ngoài schema:
1. Trích xuất quy chuẩn thiết kế của chính mẫu đang chọn: màu giao diện, kiểu chữ, khoảng cách, đường viền, bo góc, bóng, thứ bậc thị giác, các vùng header/sidebar/bản đồ nếu có và cách bố trí trên desktop/mobile. Đọc HTML/CSS/JS để hiểu cả hình thức lẫn hành vi cần thể hiện.
2. Thiết kế bố cục mới cho bản đồ, tìm kiếm, chỉ số, chú giải, điều khiển, ghi công, trạng thái và popup theo layoutContext: kích thước vùng hiển thị thực tế, số lượng và nhãn control thật. Mẫu chỉ cung cấp ngôn ngữ thiết kế; bạn tự quyết định bố trí phù hợp, được đổi sidebar thành control nổi hoặc ngược lại, thay thứ tự, tỷ lệ, kích thước và cách nhóm. Không bắt buộc giữ bố cục hay kích thước của mẫu. Cho nội dung co giãn, xuống dòng hoặc cuộn hợp lý; dành vùng bản đồ sử dụng được ở cả desktop và mobile, kể cả khi mẫu có nhiều vùng không cần cho dữ liệu hiện tại.
3. Sinh giao diện phù hợp với DOM control và dữ liệu thật bằng quy chuẩn đã trích xuất. Áp dụng nhất quán cho tìm kiếm, chỉ số, chú giải, điều khiển và popup, kể cả các trạng thái tương tác. Giữ nhất quán phong cách của mẫu đang chọn trong bố cục do bạn thiết kế cho ứng dụng hiện tại. Chỉ giữ tiêu đề, nhãn trang trí và thương hiệu tĩnh khi phù hợp với giao diện bản đồ dùng cho nhiều bộ dữ liệu; bỏ nội dung minh họa, số liệu mẫu và tiêu đề gắn với lĩnh vực/địa điểm không được dữ liệu thật xác nhận. Không tự đặt tiêu đề hoặc nội dung dữ liệu khi đầu vào chỉ có khả năng hiển thị. Trả về HTML chỉ chứa lớp giao diện, không tạo bản đồ MapLibre mới, không nhúng script/link/iframe.
HTML phải có đúng một phần tử data-template-slot cho mỗi vai trò: ${TEMPLATE_SLOTS.join(', ')}. Các slot là nơi chương trình chuyển các DOM control thật vào; chúng được cập nhật động theo kết quả AI. Dùng div/section/main/header/footer/aside/nav/h1/h2/h3/em/i/br/span/strong/small/p/ul/li và SVG tĩnh cho biểu tượng; không tạo button, input hay label tĩnh. Không chép danh sách lớp, chú giải, ghi chú hướng dẫn hoặc tên vùng dữ liệu minh họa của mẫu vào HTML; các nội dung đó chỉ lấy từ DOM thật trong slot. Chỉ dùng class và data-template-slot để gắn CSS cho bố cục mới; id và style nội tuyến sẽ bị loại bỏ. Slot map chứa canvas bản đồ hiện có; popup MapLibre cũng nằm trong canvas và được định kiểu qua CSS. Không tạo nút chỉ số hoặc giá trị chú giải cố định.
CSS phải áp dụng quy chuẩn thiết kế đã trích xuất cho vùng bản đồ, lớp điều khiển và popup; khai báo biến giao diện trên .map-template-shell thay cho :root/body. Đặt vị trí của từng slot theo vùng chức năng đã ánh xạ, kể cả slot map: vùng bản đồ có thể chỉ chiếm phần còn lại bên cạnh sidebar. Ghi rõ CSS cho desktop và @media cho mobile; cho nhãn dài xuống dòng và danh sách dài cuộn khi cần mà không che hoặc làm co vùng bản đồ về 0. Slot sở hữu vị trí, chiều rộng, padding và khung nền; control thật bên trong đã được lõi đặt lại position:relative, inset:auto, transform:none, width:100%, margin:0 và bỏ khung nền cũ. Không đặt lại vị trí tuyệt đối hoặc translate trên control bên trong để tránh lệch hai lần. Đặt màu chữ và font trên shell/slot, định kiểu đủ các phần tử con thay vì chỉ vẽ khung ngoài. Không dùng @import, url(), font ngoài hoặc đổi màu dữ liệu/chú giải do AI phân tích dữ liệu đã chọn; dùng font có sẵn với fallback phù hợp phong cách mẫu. CSS sẽ được giới hạn trong .map-template-shell và được ưu tiên hơn CSS giao diện gốc.
DOM thật trong slot search: .map-query-panel > .map-search > .map-search-controls chứa .map-search-box (bên trong có form.map-search-form với .map-search-location, input, button.map-search-clear và button.map-search-submit; kế tiếp là .map-search-results) và select.map-region-navigation. Phải định kiểu cả input, placeholder, nút, select và kết quả; không chỉ .map-search. Slot metrics chứa .workspace-metrics > .map-metric-control > .map-metric-toggle và .map-metric-list > .map-metric-button (bên trong có .map-metric-preview, .map-metric-label). Slot legend chứa .map-legends > .layer-legends > .weather-legend hoặc .point-legend; .weather-legend có .weather-legend-heading (strong và span), .weather-legend-scale, .weather-legend-labels, small. Giữ màu gradient/swatch thật, cho nhãn và ghi chú màu đủ tương phản với nền slot. Không lặp lại tiêu đề hoặc dữ liệu bằng HTML trang trí. Slot controls chứa .map-controls > button; attribution chứa .map-attribution đang bị ẩn; giữ slot rỗng để tương thích, không tạo khung nền, padding, nhãn hoặc wrapper trang trí cho phần ghi công đã bỏ. Không chép lại tên nhà cung cấp bản đồ vào HTML. status chứa #status. Popup dùng .maplibregl-popup-content. Các phần tử [hidden] phải luôn ẩn. Không tạo khung thẻ thứ hai trên control nếu slot đã có khung.
Khi mẫu dùng dải chip nổi, slot metrics và .workspace-metrics phải co theo nội dung (width:fit-content với max-width phù hợp), không đặt width:100%, chiều cao cố định, min-height lớn hoặc tạo một panel nền phủ rộng phía sau các chip nếu mẫu không có panel đó. Định kiểu .map-metric-list thành flex theo hướng của mẫu; từng .map-metric-button rộng theo nhãn/icon, không chia các chỉ số thành các cột 1fr kéo giãn toàn bản đồ. .map-metric-toggle là một nút chứa trực tiếp SVG, span tiêu đề ([data-control-id="map-metric-caption"] hoặc #map-metric-caption), .map-metric-count và .map-metric-chevron: dùng flex hàng, align-items:center, không cho số lượng và mũi tên xuống hàng hoặc áp quy tắc bố cục chung cho mọi span. .map-metric-control là wrapper bên trong, không tạo thêm khung nền/padding lớn. Giới hạn chiều cao danh sách và cho cuộn dọc khi nhiều chỉ số, giữ tiêu đề thu gọn luôn dùng được. Chú giải không được cuộn ngang: cho ghi chú dài xuống dòng, giữ bố trí các nhãn ngưỡng do ứng dụng đã tính.
Ngoại lệ của reset width:100% là khối chỉ số: slot metrics và .workspace-metrics mặc định co theo nội dung. .map-metric-list mặc định flex hàng và xuống dòng; nếu mẫu xếp chỉ số dọc, khai báo flex-direction:column rõ ràng. Dành khoảng cách giữa slot search và metrics theo chiều cao thật của cả ô tìm kiếm lẫn select khu vực khi nó hiển thị, kể cả mobile; không giả định tìm kiếm luôn chỉ cao một hàng.
Vùng .map-template-shell đã có kích thước đầy đủ. Mọi wrapper giữa shell và slot map phải có chiều cao rõ ràng hoặc được giãn bằng flex/grid với min-height:0; slot map phải có kích thước khác 0 ở cả desktop và mobile. Không đặt kích thước/vị trí cho #map hoặc canvas MapLibre; lõi ứng dụng sẽ cho #map lấp đầy slot map và resize canvas.
Popup biểu đồ đường (line), cột (bar) và tròn (pie) luôn dùng renderer gốc của ứng dụng. Trả components: []; chỉ áp dụng giao diện qua CSS, giữ nguyên bố cục và tương tác của biểu đồ gốc. Khai báo các biến --template-surface (nền thẻ/tooltip), --template-text (chữ), --template-secondary (nhãn trục/đơn vị), --template-border (lưới/viền), --template-font, --template-heading-font, --template-label-size (10–12px), --template-radius và --template-shadow trên .map-template-shell, lấy giá trị từ quy chuẩn thiết kế của mẫu và bảo đảm tương phản trên nền sáng/tối. Biểu đồ thật có .ai-popup-chart > .bar-chart-card (đường có thêm .line-chart-card; tròn có .pie-chart-card, .pie-chart-table, .pie-chart-plot và .pie-chart-legend), .bar-chart-heading chứa h2 và p đơn vị, .bar-chart-plot chứa SVG Recharts, tooltip/chú giải và .chart-zoom-controls ở biểu đồ cột. Lõi ứng dụng quản lý kích thước/chiều cao popup và vùng vẽ; chỉ định kiểu màu/font/viền, không thay cấu trúc, kích thước, vị trí trục/chú giải, không ẩn nhãn hoặc áp CSS chung lên SVG/text/path của biểu đồ. Giữ nhãn ngày rút gọn, tooltip ngày đầy đủ và đơn vị; giữ đường đứt tại dữ liệu thiếu, các điểm 0, thu/phóng và thanh chọn khoảng của cột. Màu đường/cột/lát tròn/chú giải chuỗi lấy từ dữ liệu thật, không đổi bằng màu giao diện. Không tạo iframe hay JS vẽ lại biểu đồ.
Ô tìm kiếm: .map-search-controls là flex chứa .map-search-box và select.map-region-navigation. Khi xếp dọc, dùng flex-basis:auto cho hai phần tử này; không dùng basis theo px vì nó trở thành chiều cao tạo khoảng trắng lớn. Slot search và các wrapper phải cao theo nội dung, không dùng height/min-height cố định cho một ô tìm kiếm nổi. Input dùng text-align:start, flex:1, min-width:0; nút tìm kiếm/xóa giữ kích thước riêng, các kết quả [hidden] không chiếm diện tích. Icon kính lúp dùng SVG có sẵn, kích thước 22×22px, stroke:currentColor, fill:none, stroke-width:2; nút .map-search-submit tối thiểu 36×36px, padding:0, không để icon co theo padding hoặc quy tắc SVG chung. Bên trong form tìm kiếm dùng gap/padding để tách icon, input và nút; không vẽ đường kẻ phân cách bằng border trái/phải, box-shadow hay pseudo-element. Input không có viền hoặc outline riêng; hiển thị trạng thái focus ở .map-search-form:focus-within và giữ focus-visible cho các nút.
Nút chỉ số thật có thứ tự con .map-metric-label (span nhãn và small đơn vị), rồi .map-metric-preview (icon, nền --metric-color). Dùng order/flex-direction nếu mẫu đặt icon trước nhãn; định kiểu rõ padding, gap, border-radius, font, trạng thái .active/[aria-pressed=true], :hover, :focus-visible theo mẫu. Header .map-metric-toggle chứa SVG, caption, count, chevron trên cùng một hàng; cho header co theo nội dung nếu mẫu dùng chip, tránh kéo thành thanh nền dài. Không gán cùng bố cục/kích thước cho mọi button, span hoặc small.
Popup thông tin dùng .maplibregl-popup-content > .weather-popup, chứa header.popup-info-heading > small.popup-info-caption và strong tên khu vực; dl.popup-info-details chứa div.popup-info-value/chip/meta/description/note > dt nhãn và dd giá trị. Có thể có .popup-source-records > .popup-source-record chứa cùng cấu trúc khi nhiều bản ghi. Định kiểu đủ caption, strong, dt, dd, note, đường phân cách và .maplibregl-popup-close-button theo màu nền popup; không chỉ đổi nền khung trong khi chữ giữ màu cũ. Khung .maplibregl-popup-content sở hữu padding; .weather-popup bên trong mặc định padding:0 để tránh khung đệm kép. Giữ nguyên giới hạn cuộn và kích thước popup theo vùng bản đồ. Popup ảnh dùng .info-image-popup, .info-image-body, .info-image-body h2, .info-image-details dt/dd và .info-image-navigation button; giữ ảnh, link, nút điều hướng và dữ liệu thật.
Nếu đầu vào có repair, đó là HTML/CSS đã thử trên trình duyệt nhưng không dùng được. Đọc repair.feedback với kích thước đo thật của slot và các wrapper; xác định nguyên nhân rồi thiết kế lại phần bố cục gây lỗi, không lặp lại CSS cũ. Có thể thay cấu trúc và cách phân chia không gian, không cần giữ sidebar/vị trí mẫu. Trả đầy đủ html/css/components mới theo cùng schema. Kiểm tra chuỗi chiều cao từ shell qua mọi wrapper tới slot map: shell đã có kích thước thật, dùng grid/flex có minmax(0,1fr), min-height:0 và vùng map giãn theo không gian còn lại, tránh height:100% trên cha không có chiều cao. Không dùng nhãn/lớp dữ liệu giả để lấp vùng trống.
Không sửa ý nghĩa của các chỉ số, màu và mốc chú giải, popup hoặc dữ liệu. Chỉ trả JSON đúng schema.`;

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 500_000) throw new Error('Yêu cầu template quá lớn.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function checkLocalCodexLogin(baseUrl) {
  const host = new URL(baseUrl).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return;
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? 'cmd.exe' : 'codex', windows ? ['/d', '/s', '/c', 'codex.cmd login status'] : ['login', 'status'],
    { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  if (result.error || result.status !== 0) {
    const command = process.platform === 'win32' ? 'codex.cmd login' : 'codex login';
    const error = new Error(`Codex CLI chưa đăng nhập. Chạy \`${command}\` rồi thử lại.`);
    error.status = 503;
    throw error;
  }
}

export function mapTemplateCompositionPlugin(env, { fetchImpl = globalThis.fetch, composeImpl = requestAiJson, authCheck = checkLocalCodexLogin } = {}) {
  const cache = new Map();
  const middleware = async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/ai/compose-map-template') return next();
    const send = (status, body) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST') return send(405, { error: 'Chỉ hỗ trợ POST.' });
    if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL) return send(503, { error: 'Chưa cấu hình dịch vụ AI.' });
    let input;
    try {
      input = await readBody(request);
      if (!/^[a-z\d_-]{1,80}$/i.test(input.templateId || '')) throw new Error('Mã template không hợp lệ.');
      input.capabilities = normalizeTemplateCapabilities(input.capabilities);
      input.layoutContext = normalizeTemplateLayoutContext(input.layoutContext);
      input.repair = normalizeTemplateLayoutRepair(input.repair);
    } catch (error) { return send(400, { error: error.message }); }
    try {
      const url = new URL(env.OPENAI_BASE_URL.replace(/\/+$/, ''));
      if (!url.pathname.endsWith('/analyze')) throw new Error('Chưa kết nối server template.');
      url.pathname = url.pathname.replace(/\/analyze$/, `/templates/${encodeURIComponent(input.templateId)}`);
      url.search = '';
      const upstream = await fetchImpl(url.toString(), { headers: { 'X-API-Key': env.OPENAI_API_KEY }, signal: AbortSignal.timeout(10_000) });
      if (!upstream.ok) return send(upstream.status === 404 ? 404 : 502, { error: 'Không tải được mã nguồn template.' });
      const source = normalizeMapTemplateSource(await upstream.json(), input.templateId);
      const sourceHash = createHash('sha256').update(source.html).update(source.css).update(source.js).digest('hex');
      const key = JSON.stringify([input.templateId, sourceHash, input.capabilities, input.layoutContext]);
      if (cache.has(key) && input.refresh !== true && !input.repair) return send(200, cache.get(key));
      authCheck(env.OPENAI_BASE_URL);
      const raw = await composeImpl(env, { instructions: INSTRUCTIONS, input: { source, capabilities: input.capabilities, layoutContext: input.layoutContext, repair: input.repair },
        schema: SCHEMA, name: 'map_template_composition' }, fetchImpl);
      const composition = normalizeTemplateComposition(raw, input.capabilities);
      const result = { templateId: input.templateId, sourceHash, composition };
      cache.set(key, result);
      if (cache.size > 16) cache.delete(cache.keys().next().value);
      send(200, result);
    } catch (error) {
      if (error.status !== 503) console.error('Map template composition:', error);
      send(error.status || 502, { error: error.name === 'AbortError' ? 'AI ghép mẫu quá thời gian chờ.' : error.message || 'Không thể ghép mẫu.' });
    }
  };
  return { name: 'map-template-composition',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}

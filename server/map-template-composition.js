import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { normalizeMapTemplateSource } from '../src/shared/ui/map-template-config.js';
import { normalizeTemplateCapabilities, normalizeTemplateComposition, TEMPLATE_POPUP_KINDS, TEMPLATE_SLOTS } from '../src/map-template-composition-contract.js';
import { requestAiJson } from './ai-provider.js';

const COMPONENT = { type: 'object', additionalProperties: false, required: ['kind', 'origin', 'html', 'css', 'js'], properties: {
  kind: { type: 'string', enum: TEMPLATE_POPUP_KINDS }, origin: { type: 'string', enum: ['template', 'generated'] },
  html: { type: 'string' }, css: { type: 'string' }, js: { type: 'string' }
} };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['html', 'css', 'components'], properties: {
  html: { type: 'string' }, css: { type: 'string' }, components: { type: 'array', items: COMPONENT }
} };
const INSTRUCTIONS = `Bạn ghép mẫu giao diện HTML/CSS/JS vào ứng dụng bản đồ đã có lõi MapLibre và các renderer Polygon, Point, Line, Arc Flow.
Đọc toàn bộ mẫu, nhận diện bố cục và phong cách RIÊNG của mẫu đang chọn. Giữ các vùng lớn, tỷ lệ, thứ tự, kiểu chữ, màu nền và cách bố trí trên màn hình rộng/di động của chính mẫu đó. Nếu mẫu có sidebar riêng cạnh bản đồ thì bố cục kết quả cũng phải có sidebar và vùng bản đồ được thu hẹp tương ứng; không chuyển thành các nút nổi trên bản đồ. Giữ tiêu đề, nhãn trang trí và thương hiệu tĩnh nếu chúng không giả làm dữ liệu. Không dùng bố cục của một mẫu khác hoặc bố cục mặc định của ứng dụng. Trả về HTML chỉ chứa lớp giao diện, không tạo bản đồ MapLibre mới, không nhúng script/link/iframe và không chứa dữ liệu minh họa.
HTML phải có đúng một phần tử data-template-slot cho mỗi vai trò: ${TEMPLATE_SLOTS.join(', ')}. Các slot là nơi chương trình chuyển các DOM control thật vào; chúng được cập nhật động theo kết quả AI. Dùng div/section/main/header/footer/aside/nav/h1/h2/h3/em/i/br/span/strong/small/p/ul/li và SVG tĩnh cho biểu tượng; không tạo button, input hay label tĩnh. Slot map chứa canvas bản đồ hiện có; popup MapLibre cũng nằm trong canvas và được định kiểu qua CSS. Không tạo nút chỉ số hoặc giá trị chú giải cố định.
CSS phải tái hiện mẫu, dành cho vùng bản đồ, lớp điều khiển và popup; chuyển biến :root/body của mẫu thành biến trên .map-template-shell. Đặt vị trí của từng slot theo vùng tương ứng trong mã mẫu, kể cả slot map: vùng bản đồ có thể chỉ chiếm phần còn lại bên cạnh sidebar. Ghi rõ CSS cho desktop và @media cho mobile theo mẫu. Các control thật vốn có CSS vị trí mặc định; đặt lại position/inset/top/right/bottom/left/width khi mẫu yêu cầu vị trí khác. Không dùng @import, url(), font ngoài hoặc đổi màu dữ liệu/chú giải do AI phân tích dữ liệu đã chọn. CSS sẽ được giới hạn trong .map-template-shell. Dùng các class đang có trên DOM thật: .workspace-metrics, .map-metric-control, .map-metric-button, .map-metric-preview, .map-legends, .weather-legend, .map-query-panel, .map-controls, .map-attribution, .maplibregl-popup-content.
Với mỗi loại bar/line trong popupTypes, trả một component trong components. Nếu JS mẫu có biểu đồ tương ứng, chuyển logic của nó thành component độc lập và origin='template'; nếu chưa có, tự viết component phù hợp phong cách mẫu và origin='generated'. Component html/css không chứa script/link/iframe. Component js định nghĩa window.renderTemplateComponent = ({root,chart,palette}) => void. chart là cấu hình biểu đồ đã được ứng dụng tính từ dữ liệu thật (chart.data, chart.series, chart.title); palette là màu do AI dữ liệu quyết định. Code chỉ dựng DOM/SVG trong root, không fetch, không truy cập parent, không tạo bản đồ. Các component này sẽ chạy trong iframe cô lập.
Không sửa ý nghĩa của các chỉ số, màu và mốc chú giải, popup hoặc dữ liệu. Chỉ trả JSON đúng schema.`;

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 20_000) throw new Error('Yêu cầu template quá lớn.');
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
      const key = JSON.stringify([input.templateId, sourceHash, input.capabilities]);
      if (cache.has(key)) return send(200, cache.get(key));
      authCheck(env.OPENAI_BASE_URL);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180_000);
      let raw;
      try {
        raw = await composeImpl(env, { instructions: INSTRUCTIONS, input: { source, capabilities: input.capabilities },
          schema: SCHEMA, name: 'map_template_composition', signal: controller.signal }, fetchImpl);
      } finally { clearTimeout(timer); }
      const composition = normalizeTemplateComposition(raw, input.capabilities);
      for (const component of composition.components) if (component.js.trim()) new Script(component.js, { filename: `template-${component.kind}.js` });
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

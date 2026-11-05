import { requestAiJson } from './ai-provider.js';
import { normalizeMapTemplateEntry, preferredTemplateNavigation } from '../src/shared/ui/map-template-config.js';

const MAP_TYPES = new Set(['choropleth', 'point', 'map_line', 'arc_flow']);

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new Error('Yêu cầu chọn template quá lớn.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function mapTemplateRecommendationPlugin(env, { recommendImpl = requestAiJson, fetchImpl = globalThis.fetch } = {}) {
  const middleware = async (request, response, next) => {
    if (request.url?.split('?')[0] !== '/api/ai/recommend-map-template') return next();
    const send = (status, body) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'POST') return send(405, { error: 'Chỉ hỗ trợ POST.' });
    let input;
    try {
      input = await readBody(request);
      if (!Array.isArray(input.mapTypes) || !input.mapTypes.length || input.mapTypes.length > 50
        || input.mapTypes.some(type => !MAP_TYPES.has(type))) throw new Error('Kiểu bản đồ không hợp lệ.');
      if (!Number.isInteger(input.layerCount) || input.layerCount < 1 || input.layerCount > 50
        || !Array.isArray(input.popupTypes) || input.popupTypes.length > 20
        || input.popupTypes.some(type => typeof type !== 'string' || type.length > 40))
        throw new Error('Ngữ cảnh bản đồ không hợp lệ.');
    } catch (error) { return send(400, { error: error.message }); }
    if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL) return send(503, { error: 'Chưa cấu hình dịch vụ template.' });
    let candidates;
    try {
      const url = new URL(env.OPENAI_BASE_URL.replace(/\/+$/, ''));
      if (!url.pathname.endsWith('/analyze')) throw new Error('Chưa kết nối server template.');
      url.pathname = url.pathname.replace(/\/analyze$/, '/templates');
      url.search = '';
      const upstream = await fetchImpl(url.toString(), { headers: { 'X-API-Key': env.OPENAI_API_KEY }, signal: AbortSignal.timeout(10_000) });
      if (!upstream.ok) throw new Error('Không tải được danh mục template.');
      const catalog = (await upstream.json())?.templates;
      if (!Array.isArray(catalog) || !catalog.length || catalog.length > 100) throw new Error('Danh mục template không hợp lệ.');
      candidates = catalog.map(normalizeMapTemplateEntry);
      if (new Set(candidates.map(item => item.id)).size !== candidates.length)
        throw new Error('Danh mục template trùng mã.');
    } catch (error) { return send(502, { error: error.message || 'Không tải được danh mục template.' }); }
    const navigation = preferredTemplateNavigation(input.mapTypes);
    candidates = candidates.filter(item => item.navigation === navigation && !item.styles);
    if (!candidates.length) return send(422, { error: 'Không có template phù hợp với kiểu bản đồ.' });
    if (candidates.length === 1) return send(200, { templateId: candidates[0].id, source: 'only_candidate' });
    const schema = { type: 'object', additionalProperties: false, required: ['templateId'],
      properties: { templateId: { type: 'string', enum: candidates.map(item => item.id) } } };
    try {
      if (!env.OPENAI_API_KEY) throw new Error('AI chưa được cấu hình.');
      const result = await recommendImpl(env, {
        instructions: 'Bạn chọn một template giao diện cho bản đồ GIS. Chỉ chọn một templateId từ candidates. Kiểu điều hướng đã được lọc sẵn; dùng mô tả bố cục, số lớp dữ liệu, loại bản đồ và loại popup để chọn mẫu dễ đọc, phù hợp nhất. Không tạo template mới, không sinh code.',
        input: { mapTypes: input.mapTypes, layerCount: input.layerCount, popupTypes: input.popupTypes, candidates: candidates.map(({ id, name, description, navigation }) => ({ id, name, description: description || '', navigation })) },
        schema, name: 'map_template_recommendation'
      });
      if (!candidates.some(item => item.id === result?.templateId)) throw new Error('AI chọn mã template không hợp lệ.');
      return send(200, { templateId: result.templateId, source: 'ai' });
    } catch (error) {
      console.warn('Map template recommendation:', error);
      return send(200, { templateId: candidates[0].id, source: 'fallback' });
    }
  };
  return { name: 'map-template-recommendation',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}

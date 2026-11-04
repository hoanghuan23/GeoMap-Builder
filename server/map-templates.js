import { normalizeMapTemplateEntry, normalizeMapTemplateSource } from '../src/shared/ui/map-template-config.js';

/** Fetch template metadata and source with server-side credentials. */
export function mapTemplatesPlugin(env, fetchImpl = globalThis.fetch) {
  const middleware = async (request, response, next) => {
    const path = request.url?.split('?')[0];
    const detail = /^\/api\/map-templates\/([a-z\d_-]{1,80})$/i.exec(path || '');
    if (path !== '/api/map-templates' && !detail) return next();
    const send = (status, body) => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify(body));
    };
    if (request.method !== 'GET') return send(405, { error: 'Chỉ hỗ trợ GET.' });
    if (!env.OPENAI_API_KEY || !env.OPENAI_BASE_URL) return send(503, { error: 'Chưa kết nối danh sách mẫu giao diện.' });
    try {
      const url = new URL(env.OPENAI_BASE_URL.replace(/\/+$/, ''));
      if (!url.pathname.endsWith('/analyze')) return send(503, { error: 'Chưa kết nối danh sách mẫu giao diện.' });
      url.pathname = url.pathname.replace(/\/analyze$/, '/templates');
      if (detail) url.pathname += `/${encodeURIComponent(detail[1])}`;
      url.search = '';
      const upstream = await fetchImpl(url.toString(), { headers: { 'X-API-Key': env.OPENAI_API_KEY }, signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) return send(upstream.status === 404 ? 404 : 502, { error: 'Không tải được mẫu giao diện.' });
      const body = await upstream.json();
      if (detail) return send(200, normalizeMapTemplateSource(body, detail[1]));
      if (!Array.isArray(body?.templates)) throw new Error('Invalid template catalog');
      send(200, { templates: body.templates.map(normalizeMapTemplateEntry) });
    } catch { send(502, { error: 'Không tải được cấu hình mẫu giao diện. Kiểm tra server template rồi thử lại.' }); }
  };
  return { name: 'map-templates',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}

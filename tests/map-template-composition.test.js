import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTemplateCompositionPlugin } from '../server/map-template-composition.js';
import { normalizeTemplateComposition } from '../src/map-template-composition-contract.js';

const env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze' };
const source = { template: 'mau_01', html: '<main id="map"></main>', css: '#map{height:100%}', js: 'window.MAP_CONFIG = {};' };
const slots = ['map', 'search', 'metrics', 'legend', 'controls', 'attribution', 'status'];
const layout = slots.map(slot => `<div data-template-slot="${slot}"></div>`).join('');
const chart = kind => ({ kind, origin: kind === 'bar' ? 'template' : 'generated', html: '<div></div>', css: 'svg{width:100%}',
  js: 'window.renderTemplateComponent = ({root,chart}) => { root.textContent = chart.title; };' });

function callPlugin({ fetchImpl, composeImpl, body }) {
  let handler;
  mapTemplateCompositionPlugin(env, { fetchImpl, composeImpl, authCheck: () => {} }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  const request = { url: '/api/ai/compose-map-template', method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  let result;
  const response = { setHeader() {}, end(value) { result = JSON.parse(value); } };
  return async () => { await handler(request, response, () => {}); return { status: response.statusCode, body: result }; };
}

test('AI composition uses mau_01 source and caches the checked result for identical capabilities', async () => {
  let calls = 0;
  const invoke = callPlugin({ body: { templateId: 'mau_01', capabilities: { mapTypes: ['choropleth', 'point', 'map_line', 'arc_flow'], popupTypes: ['bar', 'line'] } },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8000/templates/mau_01');
      assert.equal(options.headers['X-API-Key'], 'test-key');
      return { ok: true, json: async () => source };
    },
    composeImpl: async (_env, { input, instructions, schema }) => {
      calls++;
      assert.deepEqual(input.source, source);
      assert.deepEqual(input.capabilities.mapTypes, ['arc_flow', 'choropleth', 'map_line', 'point']);
      assert.match(instructions, /luôn dùng renderer gốc/);
      assert.equal(schema.properties.components.maxItems, 0);
      return { html: layout, css: '.layer-controls{right:12px}', components: [] };
    } });
  assert.equal((await invoke()).status, 200);
  const second = await invoke();
  assert.equal(second.status, 200);
  assert.equal(second.body.templateId, 'mau_01');
  assert.equal(second.body.composition.components.length, 0);
  assert.equal(calls, 1);
});

test('native bar and line popups need no generated components; legacy output remains compatible', () => {
  const capabilities = { popupTypes: ['bar', 'line'] };
  assert.deepEqual(normalizeTemplateComposition({ html: layout, css: '', components: [] }, capabilities).components, []);
  assert.equal(normalizeTemplateComposition({ html: layout, css: '', components: [chart('bar'), chart('line')] }, capabilities).components.length, 2);
  assert.throws(() => normalizeTemplateComposition({ html: `${layout}<script>alert(1)</script>`, css: '', components: [] }, { popupTypes: [] }), /không hợp lệ/);
});

test('retry regenerates a composition rejected by browser layout validation', async () => {
  let calls = 0;
  const body = { templateId: 'mau_01', capabilities: { mapTypes: ['point'], popupTypes: [] } };
  const invoke = callPlugin({ body, fetchImpl: async () => ({ ok: true, json: async () => source }),
    composeImpl: async () => ({ html: layout, css: `div{z-index:${++calls}}`, components: [] }) });
  assert.equal((await invoke()).status, 200);
  assert.equal((await invoke()).status, 200);
  assert.equal(calls, 1);
  body.refresh = true;
  assert.equal((await invoke()).status, 200);
  assert.equal(calls, 2);
  body.refresh = false;
  assert.equal((await invoke()).body.composition.css, 'div{z-index:2}');
  assert.equal(calls, 2);
});

test('missing local Codex login returns an actionable error before calling AI', async () => {
  let aiCalls = 0; let handler;
  mapTemplateCompositionPlugin(env, { fetchImpl: async () => ({ ok: true, json: async () => source }),
    authCheck: () => { const error = new Error('Codex CLI chưa đăng nhập.'); error.status = 503; throw error; },
    composeImpl: async () => { aiCalls++; return {}; } }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  const request = { url: '/api/ai/compose-map-template', method: 'POST', async *[Symbol.asyncIterator]() {
    yield Buffer.from(JSON.stringify({ templateId: 'mau_01', capabilities: { mapTypes: ['choropleth'], popupTypes: [] } }));
  } };
  let body; const response = { setHeader() {}, end(value) { body = JSON.parse(value); } };
  await handler(request, response, () => {});
  assert.equal(response.statusCode, 503);
  assert.match(body.error, /chưa đăng nhập/);
  assert.equal(aiCalls, 0);
});

test('layout uses actual viewport and controls; browser feedback regenerates rather than returning cached CSS', async () => {
  const contexts = []; const repairs = [];
  const body = { templateId: 'mau_01', capabilities: { mapTypes: ['point'], popupTypes: [] },
    layoutContext: { viewport: { width: 900, height: 650 }, metrics: { count: 3, labels: ['Ô nhiễm', 'Nhiệt độ', 'Lượng mưa'] },
      legends: { count: 1, titles: ['Mức độ ô nhiễm trung bình'] }, search: { enabled: true, placeholder: 'Tìm trong dữ liệu' } } };
  const invoke = callPlugin({ body, fetchImpl: async () => ({ ok: true, json: async () => source }),
    composeImpl: async (_env, { input, instructions }) => {
      contexts.push(input.layoutContext); repairs.push(input.repair);
      assert.match(instructions, /Không bắt buộc giữ bố cục hay kích thước của mẫu/);
      return { html: layout, css: `.layout{z-index:${contexts.length}}`, components: [] };
    } });
  await invoke(); await invoke();
  assert.equal(contexts.length, 1);
  assert.deepEqual(contexts[0].metrics.labels, body.layoutContext.metrics.labels);
  body.layoutContext.viewport.width = 390;
  await invoke(); assert.equal(contexts.length, 2, 'desktop cache must not replace a mobile design');
  body.repair = { layout: { html: layout, css: '/* previous design */' + ' '.repeat(25_000) },
    feedback: { issue: 'map-size', slots: [{ name: 'map', width: 0, height: 0 }],
      ancestors: [{ name: 'map-wrapper', width: 390, height: 0, display: 'grid' }] } };
  assert.equal((await invoke()).status, 200);
  assert.equal(contexts.length, 3);
  assert.equal(repairs[2].feedback.ancestors[0].height, 0);
  assert.equal(repairs[2].layout.css, body.repair.layout.css);
  body.repair = null;
  assert.equal((await invoke()).body.composition.css, '.layout{z-index:3}');
  body.repair = { layout: { html: '<script>bad()</script>', css: '' }, feedback: { issue: 'map-size' } };
  assert.equal((await invoke()).status, 400);
  assert.equal(contexts.length, 3, 'unsafe repair is rejected before calling AI');
});

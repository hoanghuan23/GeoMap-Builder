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
    composeImpl: async (_env, { input }) => {
      calls++;
      assert.deepEqual(input.source, source);
      assert.deepEqual(input.capabilities.mapTypes, ['arc_flow', 'choropleth', 'map_line', 'point']);
      return { html: layout, css: '.layer-controls{right:12px}', components: [chart('bar'), chart('line')] };
    } });
  assert.equal((await invoke()).status, 200);
  const second = await invoke();
  assert.equal(second.status, 200);
  assert.equal(second.body.templateId, 'mau_01');
  assert.equal(second.body.composition.components.length, 2);
  assert.equal(calls, 1);
});

test('missing generated line chart and unsafe layout are rejected', () => {
  assert.throws(() => normalizeTemplateComposition({ html: layout, css: '', components: [chart('bar')] }, { popupTypes: ['bar', 'line'] }), /line/);
  assert.throws(() => normalizeTemplateComposition({ html: `${layout}<script>alert(1)</script>`, css: '', components: [] }, { popupTypes: [] }), /không hợp lệ/);
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

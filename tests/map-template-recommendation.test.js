import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTemplateRecommendationPlugin } from '../server/map-template-recommendation.js';

const candidates = [
  { id: 'mau_01', name: '2D', navigation: 'pan_zoom', description: 'Polygon và point' },
  { id: 'mau_02', name: '3D sáng', navigation: 'rotate_3d', description: 'Arc Flow sáng' },
  { id: 'mau_03', name: '3D tối', navigation: 'rotate_3d', description: 'Arc Flow tối' }
];

async function invoke(body, recommendImpl, catalog = candidates) {
  let handler;
  mapTemplateRecommendationPlugin({ OPENAI_API_KEY: 'test', OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze' }, {
    recommendImpl,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:8000/templates');
      assert.equal(options.headers['X-API-Key'], 'test');
      return { ok: true, json: async () => ({ templates: catalog }) };
    }
  }).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  const request = { url: '/api/ai/recommend-map-template', method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
  let result;
  const response = { setHeader() {}, end(text) { result = JSON.parse(text); } };
  await handler(request, response, () => {});
  return { status: response.statusCode, body: result };
}

test('polygon, line and point select the fixed 2D template', async () => {
  for (const mapTypes of [['choropleth'], ['map_line'], ['point']]) {
    const result = await invoke({ mapTypes, layerCount: 1, popupTypes: [] }, () => { throw new Error('Only one candidate should not call AI'); });
    assert.deepEqual(result, { status: 200, body: { templateId: 'mau_01', source: 'only_candidate' } });
  }
});

test('Arc Flow filters to rotating templates and accepts only an eligible AI choice', async () => {
  let input;
  const body = { mapTypes: ['point', 'arc_flow'], layerCount: 2, popupTypes: ['info'] };
  const result = await invoke(body, async (_env, request) => {
    input = request.input;
    return { templateId: 'mau_03' };
  });
  assert.deepEqual(input.candidates.map(item => item.id), ['mau_02', 'mau_03']);
  assert.deepEqual(result, { status: 200, body: { templateId: 'mau_03', source: 'ai' } });
  const invalid = await invoke(body, async () => ({ templateId: 'mau_01' }));
  assert.deepEqual(invalid, { status: 200, body: { templateId: 'mau_02', source: 'fallback' } });
});

test('AI failure falls back within the matching group; no match and bad input are rejected', async () => {
  const body = { mapTypes: ['arc_flow'], layerCount: 1, popupTypes: [] };
  assert.equal((await invoke(body, async () => { throw new Error('offline'); })).body.templateId, 'mau_02');
  assert.equal((await invoke(body, async () => ({}), candidates.slice(0, 1))).status, 422);
  assert.equal((await invoke({ ...body, mapTypes: ['unknown'] }, async () => ({}))).status, 400);
});

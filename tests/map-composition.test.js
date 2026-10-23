import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionClient } from '../src/map-composition.js';
import { analyzeMapComposition, COMPOSITION_INSTRUCTIONS } from '../server/map-composition.js';
import { MAP_COMPOSITION_SCHEMA, normalizeCompositionInput, normalizeCompositionResult } from '../src/map-composition-contract.js';
import { createMapWorkspace, addWorkspaceLayer, applyWorkspaceComposition } from '../src/map-workspace.js';
import { aiMapRecommendationPlugin } from '../server/ai-map-recommendation.js';
import { Readable } from 'node:stream';

const input = { workspaceRevision: 1, groups: [], newLayerIds: ['a', 'b'], layers: ['a', 'b'].map(id => ({ id, title: id, available: true,
  chartType: 'point', geometryKinds: ['point'], columns: [], search_bar: false, search_fields: [] })) };
const result = { decisions: ['a', 'b'].map(layerId => ({ layerId, action: 'create_group', targetGroupId: null, newGroupKey: 'same', groupTitle: 'A + B', confidence: .9, reason: 'Có ích khi hiển thị chung' })), searchLayerIds: [] };

test('composition client caches successful descriptors, excludes workspace revision, and retries failures', async () => {
  let calls = 0;
  const client = createCompositionClient({ fetchImpl: async (_url, init) => {
    calls++; assert.equal(JSON.parse(init.body).layers[0].id, 'a');
    return { ok: true, json: async () => result };
  } });
  assert.equal((await client(input)).source, 'ai');
  await client({ ...input, workspaceRevision: 2 }); assert.equal(calls, 1);
  let failures = 0;
  const offline = createCompositionClient({ fetchImpl: async () => { failures++; throw new Error('Offline'); } });
  assert.equal((await offline(input)).decisions[0].action, 'undetermined');
  await offline(input); assert.equal(failures, 2);
});

test('composition timeout retains every dataset and external cancellation remains cancellation', async () => {
  const client = createCompositionClient({ timeoutMs: 5, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  const fallback = await client(input);
  assert.deepEqual(fallback.decisions.map(item => item.layerId), ['a', 'b']);
  assert.match(fallback.decisions[0].reason, /hết thời gian/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client(input, { signal: controller.signal }), { name: 'AbortError' });
});

test('server forwards only minimized metadata with a strict schema and validates model output', async () => {
  let payload;
  const output = await analyzeMapComposition({ ...input, geometry: 'private', layers: input.layers.map(layer => ({ ...layer, records: ['private'] })) }, { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' }, async (_url, init) => {
    payload = JSON.parse(init.body); return { ok: true, json: async () => ({ output_text: JSON.stringify(result) }) };
  });
  assert.equal(payload.store, false); assert.equal(payload.text.format.strict, true);
  // Gateways may ignore text.format, so the model must see the same schema
  // in its instructions, including the exact layerId key and batch semantics.
  assert.ok(payload.instructions.includes(JSON.stringify(MAP_COMPOSITION_SCHEMA)));
  assert.equal(payload.instructions.includes('schemaVersion'), false);
  assert.match(payload.instructions, /Tên trường là layerId/);
  assert.match(payload.instructions, /Khi groups rỗng, không dùng append_to_group/);
  assert.equal(payload.input.includes('private'), false);
  assert.deepEqual(output.decisions, result.decisions);
  assert.match(COMPOSITION_INSTRUCTIONS, /TOÀN BỘ/);
  assert.match(COMPOSITION_INSTRUCTIONS, /bắc cầu/);
  assert.match(COMPOSITION_INSTRUCTIONS, /Không ghép chỉ vì bbox/);
});

test('a gateway batch reply groups layers only with exact IDs and valid new-group actions', async () => {
  const workspace = createMapWorkspace();
  const ids = ['Weather', 'Stations'].map(title => addWorkspaceLayer(workspace, { title, dataset: {}, descriptor: {} }).id);
  const snapshot = { ...input, workspaceRevision: workspace.revision, newLayerIds: ids,
    layers: input.layers.map((layer, index) => ({ ...layer, id: ids[index] })) };
  const malformed = { ...result, decisions: ids.map((newLayerId, index) => ({ ...result.decisions[index], layerId: undefined, newLayerId,
    action: index ? 'append_to_group' : 'create_group' })) };
  const reply = output => async () => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }) });
  const invalid = await analyzeMapComposition(snapshot, { OPENAI_API_KEY: 'test' }, reply(malformed));
  assert.deepEqual(invalid.decisions.map(item => item.action), ['undetermined', 'undetermined']);
  const wrongNewGroup = await analyzeMapComposition(snapshot, { OPENAI_API_KEY: 'test' }, reply({ ...malformed,
    decisions: malformed.decisions.map((item, index) => ({ ...item, layerId: ids[index] })) }));
  assert.deepEqual(wrongNewGroup.decisions.map(item => item.action), ['create_group', 'undetermined']);
  const valid = await analyzeMapComposition(snapshot, { OPENAI_API_KEY: 'test' }, reply({ ...result,
    decisions: ids.map((layerId, index) => ({ ...result.decisions[index], layerId })) }));
  assert.equal(applyWorkspaceComposition(workspace, valid, ids, snapshot.workspaceRevision), true);
  assert.equal(workspace.groupOrder.length, 1);
  assert.deepEqual(workspace.groupsById[workspace.groupOrder[0]].layerIds, ids);
});

const geometryPairs = [
  ['Dân số theo quận', 'choropleth', 'area', 'Cơ sở y tế', 'point', 'point'],
  ['Tuyến giao hàng', 'map_line', 'line', 'Kho hàng', 'point', 'point'],
  ['Khu dân cư', 'choropleth', 'area', 'Vùng ngập', 'choropleth', 'area'],
  ['Đường ống', 'map_line', 'line', 'Tuyến cáp', 'map_line', 'line'],
  ['Trường học', 'point', 'point', 'Thư viện', 'point', 'point'],
  ['Quận huyện', 'choropleth', 'area', 'Mạng đường', 'map_line', 'line'],
  ['Mật độ theo ô', 'h3', 'area', 'Vị trí phương tiện', 'point', 'point']
];

for (const [titleA, chartA, kindA, titleB, chartB, kindB] of geometryPairs) {
  test(`shared composition pipeline: ${chartA}/${chartB}, ${titleA} + ${titleB}`, async () => {
    const workspace = createMapWorkspace();
    const specs = [[titleA, chartA, kindA], [titleB, chartB, kindB], ['Dữ liệu độc lập', 'point', 'point']];
    const layers = specs.map(([title, chartType, kind], index) => {
      const layer = addWorkspaceLayer(workspace, { title, dataset: {}, fileKey: `arbitrary-${workspace.sequence}.json` });
      return { id: layer.id, title, chartType, geometryKinds: [kind], available: true,
        columns: [{ name: 'entity_name', role: 'text' }], search_bar: index < 2, search_fields: ['entity_name'] };
    });
    const snapshot = { workspaceRevision: workspace.revision, groups: [], newLayerIds: layers.map(layer => layer.id), layers };
    const modelReply = { decisions: layers.map((layer, index) => ({ layerId: layer.id, action: 'create_group',
      targetGroupId: null, newGroupKey: index < 2 ? 'compatible' : null,
      groupTitle: index < 2 ? `${titleA} + ${titleB}` : layer.title, confidence: .9, reason: 'Quyết định từ hồ sơ đầu vào.' })),
      searchLayerIds: [layers[1].id] };
    const client = createCompositionClient({ fetchImpl: async (_url, init) => {
      const output = await analyzeMapComposition(JSON.parse(init.body), { OPENAI_API_KEY: 'test' }, async (_upstream, request) => {
        const forwarded = JSON.parse(JSON.parse(request.body).input);
        assert.deepEqual(forwarded.layers.map(layer => [layer.title, layer.chartType, layer.geometryKinds]),
          layers.map(layer => [layer.title, layer.chartType, layer.geometryKinds]));
        return { ok: true, json: async () => ({ output_text: JSON.stringify(modelReply) }) };
      });
      return { ok: true, json: async () => output };
    } });
    const output = await client(snapshot);
    assert.equal(applyWorkspaceComposition(workspace, output, snapshot.newLayerIds, snapshot.workspaceRevision), true);
    assert.deepEqual(workspace.groupOrder.map(id => workspace.groupsById[id].layerIds), [[layers[0].id, layers[1].id], [layers[2].id]]);
    assert.equal(workspace.layersById[layers[0].id].searchEnabled, true);
    assert.equal(workspace.layersById[layers[1].id].searchEnabled, true);
    assert.equal(workspace.layersById[layers[2].id].searchEnabled, false);
  });
}

test('composition omissions retain valid search defaults without enabling disabled or invalid fields', () => {
  const snapshot = normalizeCompositionInput({ ...input, newLayerIds: ['a', 'b', 'disabled', 'invalid'], layers: [
    ...input.layers.map(layer => ({ ...layer, search_bar: true, search_fields: ['name'], columns: [{ name: 'name', role: 'text' }] })),
    { ...input.layers[0], id: 'disabled', search_bar: false, search_fields: ['name'], columns: [{ name: 'name', role: 'text' }] },
    { ...input.layers[0], id: 'invalid', search_bar: true, search_fields: ['value'], columns: [{ name: 'value', role: 'measure' }] }
  ] });
  for (const searchLayerIds of [undefined, [], ['b'], ['disabled', 'invalid', 'unknown', 'b', 'b']]) {
    const output = normalizeCompositionResult({ ...result, searchLayerIds }, snapshot);
    assert.deepEqual(new Set(output.searchLayerIds), new Set(['a', 'b']));
    assert.deepEqual(normalizeCompositionResult(output, snapshot), output, 'client normalization preserves the server search selection');
  }
});

test('composition middleware accepts only a valid snapshot and keeps missing configuration explicit', async () => {
  let middleware;
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(result) }) });
  const call = async (body, env) => {
    aiMapRecommendationPlugin(env).configureServer({ middlewares: { use(handler) { middleware = handler; } } });
    const request = Readable.from([Buffer.from(JSON.stringify(body))]); request.url = '/api/ai/analyze-map-composition'; request.method = 'POST';
    let text;
    const response = { statusCode: 0, setHeader() {}, end(value) { text = value; } };
    await middleware(request, response, () => assert.fail('composition endpoint must be handled'));
    return { status: response.statusCode, body: JSON.parse(text) };
  };
  try {
    assert.equal((await call(input, {})).status, 503);
    assert.equal((await call({ ...input, newLayerIds: ['missing'] }, { OPENAI_API_KEY: 'test' })).status, 400);
    const response = await call(input, { OPENAI_API_KEY: 'test' });
    assert.equal(response.status, 200); assert.equal(response.body.decisions.length, 2);
  } finally { globalThis.fetch = original; }
});

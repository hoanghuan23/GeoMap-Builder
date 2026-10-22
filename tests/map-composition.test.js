import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompositionClient } from '../src/map-composition.js';
import { analyzeMapComposition, COMPOSITION_INSTRUCTIONS } from '../server/map-composition.js';

const input = { workspaceRevision: 1, groups: [], newLayerIds: ['a', 'b'], layers: ['a', 'b'].map(id => ({ id, title: id, available: true,
  chartType: 'point', geometryKinds: ['point'], columns: [], search_bar: false, search_fields: [] })) };
const result = { schemaVersion: 1, decisions: ['a', 'b'].map(layerId => ({ layerId, action: 'create_group', targetGroupId: null, newGroupKey: 'same', groupTitle: 'A + B', confidence: .9, reason: 'Có ích khi hiển thị chung' })), searchLayerIds: [] };

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
  assert.equal(payload.input.includes('private'), false);
  assert.equal(output.decisions.length, 2);
  assert.match(COMPOSITION_INSTRUCTIONS, /TOÀN BỘ/);
  assert.match(COMPOSITION_INSTRUCTIONS, /bắc cầu/);
  assert.match(COMPOSITION_INSTRUCTIONS, /Không ghép chỉ vì bbox/);
});

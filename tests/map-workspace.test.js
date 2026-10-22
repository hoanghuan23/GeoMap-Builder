import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapWorkspace, addWorkspaceLayer, createWorkspaceGroup, applyWorkspaceComposition, removeWorkspaceLayer, activeMapGroup } from '../src/map-workspace.js';
import { normalizeCompositionInput, normalizeCompositionResult, fallbackComposition } from '../src/map-composition-contract.js';
import { buildGroupDataSearchIndex } from '../src/map-search.js';

const layer = (workspace, title) => addWorkspaceLayer(workspace, { dataset: { title }, title, fileKey: title, descriptor: {} });
test('group membership, sidebar focus and per-layer data remain independent', () => {
  const workspace = createMapWorkspace(); const weather = layer(workspace, 'Thời tiết'); const stations = layer(workspace, 'Trạm');
  const group = createWorkspaceGroup(workspace, [weather.id], weather.title);
  const revision = workspace.revision;
  assert.equal(applyWorkspaceComposition(workspace, { decisions: [{ layerId: stations.id, action: 'append_to_group', targetGroupId: group.id, groupTitle: 'Thời tiết + Trạm' }] }, [stations.id], revision), true);
  group.activeLayerId = stations.id;
  assert.deepEqual(group.layerIds, [weather.id, stations.id]);
  assert.equal(workspace.datasetsById[weather.id].title, 'Thời tiết');
  const sales = layer(workspace, 'Doanh thu');
  assert.equal(applyWorkspaceComposition(workspace, { decisions: [] }, [sales.id], revision), false, 'stale composition cannot mutate membership');
  applyWorkspaceComposition(workspace, { decisions: [] }, [sales.id], workspace.revision);
  assert.equal(workspace.groupOrder.length, 2);
  assert.equal(activeMapGroup(workspace).id, group.id);
  removeWorkspaceLayer(workspace, stations.id);
  assert.equal(group.activeLayerId, weather.id);
  assert.equal(group.title, weather.title);
  removeWorkspaceLayer(workspace, weather.id);
  assert.equal(activeMapGroup(workspace).layerIds[0], sales.id);
  removeWorkspaceLayer(workspace, sales.id);
  assert.equal(activeMapGroup(workspace), null);
  assert.deepEqual(workspace.datasetsById, {});
});

test('a batch can form a new group without merging existing groups', () => {
  const workspace = createMapWorkspace(); const a = layer(workspace, 'A'); const old = createWorkspaceGroup(workspace, [a.id], 'A');
  const b = layer(workspace, 'B'); const c = layer(workspace, 'C');
  const result = { decisions: [b, c].map(item => ({ layerId: item.id, action: 'create_group', newGroupKey: 'new-bc', groupTitle: 'B + C' })) };
  applyWorkspaceComposition(workspace, result, [b.id, c.id], workspace.revision);
  assert.equal(workspace.groupOrder.length, 2);
  assert.deepEqual(old.layerIds, [a.id]);
  assert.deepEqual(workspace.groupsById[workspace.groupOrder[1]].layerIds, [b.id, c.id]);
});

const profile = { workspaceRevision: 2, groups: [{ id: 'g', layerIds: ['a'], title: 'A' }], newLayerIds: ['b'], layers: [
  { id: 'a', title: 'A', available: true, chartType: 'choropleth', geometryKinds: ['area'], columns: [{ name: 'name', role: 'text' }], search_bar: false, search_fields: ['name'] },
  { id: 'b', title: 'B', available: true, chartType: 'point', geometryKinds: ['point'], columns: [{ name: 'name', role: 'text' }], search_bar: true, search_fields: ['name'] }
] };
test('composition profiles strip records, geometry and sample values; validation preserves unambiguous decisions only', () => {
  const input = normalizeCompositionInput({ ...profile, records: ['private'], layers: profile.layers.map(item => ({ ...item, originalData: { secret: true }, samples: ['private'] })) });
  assert.equal(JSON.stringify(input).includes('private'), false);
  const decision = { layerId: 'b', action: 'append_to_group', targetGroupId: 'g', newGroupKey: null, groupTitle: 'A + B', confidence: .95, reason: 'Cùng ngữ cảnh' };
  const raw = { schemaVersion: 1, decisions: [decision], searchLayerIds: ['a', 'b', 'unknown', 'b'] };
  assert.deepEqual(normalizeCompositionResult(raw, input).searchLayerIds, ['b']);
  assert.equal(normalizeCompositionResult(raw, input).decisions[0].action, 'append_to_group');
  for (const patch of [{ targetGroupId: 'missing' }, { confidence: 2 }, { confidence: '0.9' }, { newGroupKey: 'bad' }]) {
    assert.equal(normalizeCompositionResult({ ...raw, decisions: [{ ...decision, ...patch }] }, input).decisions[0].action, 'undetermined');
  }
  assert.equal(normalizeCompositionResult({ ...raw, decisions: [decision, decision] }, input).decisions[0].action, 'undetermined');
  assert.equal(fallbackComposition(input).decisions[0].action, 'undetermined');
  assert.throws(() => normalizeCompositionInput({ ...profile, newLayerIds: ['a'] }));
  assert.throws(() => normalizeCompositionInput({ ...profile, layers: [profile.layers[0], profile.layers[0]] }));
});

test('group search keeps identical entity names separate and applies filtering thresholds independently', () => {
  const data = count => ({ type: 'FeatureCollection', features: Array.from({ length: count }, (_, i) => ({ type: 'Feature', properties: { name: `Trạm ${i}` }, geometry: { type: 'Point', coordinates: [105 + i / 10, 21] } })) });
  const base = { columns: [{ name: 'name', role: 'text' }], search_fields: ['name'], search_bar: true, titleField: 'name', chartType: 'point' };
  const a = { ...base, data: data(6), layerId: 'a', layerTitle: 'Nhóm A', groupId: 'g' };
  const b = { ...base, data: data(6), layerId: 'b', layerTitle: 'Nhóm B', groupId: 'g' };
  let index = buildGroupDataSearchIndex([a, b]);
  assert.equal(index.uniqueCount, 12);
  assert.equal(index.entries.filter(entry => entry.label === 'Trạm 0').length, 2);
  assert.match(index.entries[0].subtitle, /Nhóm A/);
  index = buildGroupDataSearchIndex([{ ...a, data: data(2), filtered: true, sourceRecords: data(6).features.map(feature => feature.properties) }, b]);
  assert.equal(index.enabled, true); assert.equal(index.entries.length, 6);
  assert.ok(index.entries.every(entry => entry.layerId === 'b'));
});

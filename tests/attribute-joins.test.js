import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpreadsheetBuffer } from '../src/tabular-parser.js';
import { pointGeoJSONToRecords } from '../src/geojson-layers.js';
import { describeWorkspaceLayer, tableRecords } from '../src/map-layer-data.js';
import { createMapWorkspace, addWorkspaceLayer, createWorkspaceGroup, applyWorkspaceComposition, removeWorkspaceLayer } from '../src/map-workspace.js';
import { normalizeCompositionInput, normalizeCompositionResult } from '../src/map-composition-contract.js';
import { normalizeJoinValue, joinedPopupSources } from '../src/attribute-joins.js';
import { popupImageUrls } from '../src/info-image-popup.js';
import { analyzeMapComposition } from '../server/map-composition.js';
import { popupAttributeRecords, imagePopupContent } from './fixtures/popup-attributes.js';

const geojson = JSON.parse(readFileSync(new URL('../dulieu_chua_mienbac.geojson', import.meta.url)));
const spreadsheet = parseSpreadsheetBuffer(readFileSync(new URL('./fixtures/popup-attributes.xlsx', import.meta.url)));

function addLayer(workspace, sourceKind, records = sourceKind === 'attribute' ? spreadsheet.records : null, title = sourceKind) {
  const points = pointGeoJSONToRecords(geojson);
  records ||= sourceKind === 'attribute' ? spreadsheet.records : points.records;
  const columns = Object.keys(records[0]).map(name => ({ name, role: name === points.bindings.lat || name === points.bindings.lng ? 'geo' : 'text',
    geoLevel: name === points.bindings.lat ? 'point_lat' : name === points.bindings.lng ? 'point_lng' : null }));
  const suggestions = sourceKind === 'attribute' ? [] : [{ id: 'points', chartType: 'point', available: true,
    bindings: points.bindings, popupSuggestions: [{ name: 'info', confidence: .8 }] }];
  const dataset = { records, rawRecords: records, analysis: { columns, popupContent: imagePopupContent, suggestions }, suggestions,
    selectedSuggestionId: suggestions[0]?.id, spatialData: sourceKind === 'attribute' ? null : geojson };
  const state = { aiDataset: dataset, mapType: sourceKind === 'attribute' ? null : 'point', pointData: sourceKind === 'attribute' ? null : geojson };
  const descriptor = describeWorkspaceLayer('pending', state, title);
  const layer = addWorkspaceLayer(workspace, { title, dataset, runtime: { state }, descriptor });
  assert.equal(layer.sourceKind, sourceKind);
  return layer;
}

const snapshot = (workspace, ids) => normalizeCompositionInput({ workspaceRevision: workspace.revision,
  newLayerIds: ids, layers: Object.values(workspace.layersById).map(layer => ({ ...layer.descriptor, id: layer.id })),
  groups: Object.values(workspace.groupsById).map(group => ({ id: group.id, title: group.title, layerIds: group.layerIds })) });

const proposal = (source, target, keyPairs = [{ sourceField: 'ten_chua', targetField: 'ten_chua' }]) => ({
  sourceId: source.id, targetLayerId: target.id, keyPairs, popupContent: imagePopupContent,
  popupSuggestions: [{ name: 'info_image', confidence: .99 }, { name: 'info', confidence: .8 }], confidence: .94, reason: 'Khóa định danh chung.'
});

function apply(workspace, ids, joins) {
  const input = snapshot(workspace, ids);
  const raw = { decisions: ids.map(layerId => ({ layerId, action: workspace.layersById[layerId].sourceKind === 'attribute' ? 'undetermined' : 'create_group',
    targetGroupId: null, newGroupKey: null, groupTitle: layerId, confidence: .9, reason: 'Giữ nguồn độc lập.' })), attributeJoins: joins, searchLayerIds: [] };
  const result = normalizeCompositionResult(raw, input);
  assert.equal(applyWorkspaceComposition(workspace, result, ids, input.workspaceRevision), true);
  return result;
}

test('the Excel fixture parses Vietnamese keys, multiple images, repeated descriptions and unmatched rows', () => {
  assert.deepEqual(spreadsheet.records, popupAttributeRecords);
  assert.equal(geojson.features.length, 5);
  assert.equal(normalizeJoinValue('  CHÙA  TRẤN QUỐC '.normalize('NFD')), 'chùa trấn quốc');
  assert.notEqual(normalizeJoinValue('chua tran quoc'), normalizeJoinValue('Chùa Trấn Quốc'));
});

for (const order of ['batch', 'spatial-first', 'attribute-first']) {
  test(`imports ${order}: attributes never create map layers/groups or mutate either source`, () => {
    const workspace = createMapWorkspace(); let target, source;
    if (order === 'attribute-first') {
      source = addLayer(workspace, 'attribute');
      apply(workspace, [source.id], []);
      assert.equal(workspace.groupOrder.length, 0);
      target = addLayer(workspace, 'spatial');
    } else {
      target = addLayer(workspace, 'spatial');
      if (order === 'spatial-first') createWorkspaceGroup(workspace, [target.id], target.title);
      source = addLayer(workspace, 'attribute');
    }
    const before = JSON.stringify(Object.values(workspace.datasetsById));
    const newIds = order === 'batch' ? [target.id, source.id] : order === 'attribute-first' ? [target.id] : [source.id];
    apply(workspace, newIds, [proposal(source, target)]);
    assert.deepEqual(workspace.groupsById[workspace.groupOrder[0]].layerIds, [target.id]);
    assert.equal(workspace.groupOrder.length, 1);
    assert.equal(JSON.stringify(Object.values(workspace.datasetsById)), before);
    assert.equal(tableRecords(target.runtime.state).length, 5);
    assert.equal(tableRecords(source.runtime.state).length, 5);
    assert.deepEqual(workspace.attributeJoins[0].stats, { matchedObjects: 2, unmatchedObjects: 3, matchedRows: 3, unmatchedRows: 2, missingKeyRows: 1, ambiguousRows: 0 });
    const joined = joinedPopupSources(workspace, target.id, geojson.features[1]);
    assert.equal(joined[0].records.length, 2);
    assert.deepEqual(joined[0].records.map(row => row.mo_ta), spreadsheet.records.slice(0, 2).map(row => row.mo_ta));
    const images = popupImageUrls([{ records: [geojson.features[1].properties], columns: target.descriptor.columns, popupContent: imagePopupContent }, ...joined]);
    assert.equal(images.length, 4); assert.match(images[0], /utm_source/);
    assert.equal(images.some(url => /google\.com/.test(url)), false);
  });
}

test('single keys skip ambiguous targets; composite keys disambiguate locations, retain accents and reject empty components', () => {
  const workspace = createMapWorkspace();
  const base = pointGeoJSONToRecords(geojson); const [a] = base.records;
  const targets = [a, { ...a, dia_chi: 'Địa điểm khác', [base.bindings.lng]: 110 }, { ...a, ten_chua: '', dia_chi: 'Ba Đình, Hà Nội' }];
  const target = addLayer(workspace, 'spatial', targets);
  const source = addLayer(workspace, 'attribute', [{ ten_chua: a.ten_chua, dia_chi: a.dia_chi, mo_ta: 'A' },
    { ten_chua: a.ten_chua, dia_chi: 'Địa điểm khác', mo_ta: 'B' }, { ten_chua: a.ten_chua, dia_chi: '', mo_ta: 'C' },
    { ten_chua: a.ten_chua.normalize('NFD'), dia_chi: a.dia_chi, mo_ta: 'D' },
    { ten_chua: 'Chua Mot Cot', dia_chi: a.dia_chi, mo_ta: 'E' }]);
  apply(workspace, [target.id, source.id], [proposal(source, target)]);
  assert.equal(workspace.attributeJoins.length, 0);
  assert.equal(workspace.attributeJoinReports[0].stats.ambiguousRows, 4);
  const pairs = ['ten_chua', 'dia_chi'].map(field => ({ sourceField: field, targetField: field }));
  apply(workspace, [source.id], [proposal(source, target, pairs)]);
  const [join] = workspace.attributeJoins;
  assert.equal(join.stats.matchedObjects, 2); assert.equal(join.stats.matchedRows, 3); assert.equal(join.stats.unmatchedRows, 2);
  assert.equal(joinedPopupSources(workspace, target.id, { properties: targets[1] })[0].records[0].mo_ta, 'B');
});

test('a third source coexists, same-named columns remain separate, removal cleans relationships and stale AI cannot restore them', () => {
  const workspace = createMapWorkspace(); const target = addLayer(workspace, 'spatial'); const a = addLayer(workspace, 'attribute', null, 'Khảo sát A');
  apply(workspace, [target.id, a.id], [proposal(a, target)]);
  const b = addLayer(workspace, 'attribute', [{ ten_chua: 'Chùa Trấn Quốc', mo_ta: 'Thông tin B', hinh_anh: ['https://example.org/b'] }], 'Khảo sát B');
  apply(workspace, [b.id], [proposal(b, target)]);
  const sources = joinedPopupSources(workspace, target.id, geojson.features[1]);
  assert.deepEqual(sources.map(source => source.title), ['Khảo sát A', 'Khảo sát B']);
  assert.equal(sources[1].records[0].mo_ta, 'Thông tin B');
  const revision = workspace.revision;
  removeWorkspaceLayer(workspace, a.id);
  assert.equal(applyWorkspaceComposition(workspace, { decisions: [], attributeJoins: [proposal(a, target)] }, [a.id], revision), false);
  assert.equal(workspace.attributeJoins.length, 1);
  assert.equal(joinedPopupSources(workspace, target.id, geojson.features[1])[0].sourceId, b.id);
  removeWorkspaceLayer(workspace, target.id);
  assert.equal(workspace.attributeJoins.length, 0);
  assert.ok(workspace.datasetsById[b.id]);
});

test('unknown keys, indirect joins, duplicate proposals and joins with no matches retain datasets and expose reasons', () => {
  const workspace = createMapWorkspace(); const target = addLayer(workspace, 'spatial'); const source = addLayer(workspace, 'attribute');
  const input = snapshot(workspace, [target.id, source.id]);
  for (const item of [proposal(source, target, [{ sourceField: 'missing', targetField: 'ten_chua' }]), proposal(source, source), proposal(target, source)]) {
    const result = normalizeCompositionResult({ decisions: [], attributeJoins: [item] }, input);
    assert.equal(result.attributeJoins.length, 0); assert.ok(result.attributeJoinIssues.length);
  }
  assert.equal(normalizeCompositionResult({ decisions: [], attributeJoins: [proposal(source, target), proposal(source, target)] }, input).attributeJoins.length, 0);
  const noMatch = addLayer(workspace, 'attribute', [{ ten_chua: 'Không có', mo_ta: 'Giữ dòng này' }]);
  apply(workspace, [target.id, source.id, noMatch.id], [proposal(noMatch, target)]);
  assert.equal(workspace.attributeJoins.length, 0);
  assert.match(workspace.attributeJoinReports[0].reason, /Không có bản ghi khớp/);
  assert.equal(workspace.datasetsById[noMatch.id].records.length, 1);
});

test('composition forwards metadata and popup field selections without records, geometry or image values', async () => {
  const workspace = createMapWorkspace(); const target = addLayer(workspace, 'spatial'); const source = addLayer(workspace, 'attribute');
  const input = snapshot(workspace, [target.id, source.id]);
  const result = await analyzeMapComposition(input, { OPENAI_API_KEY: 'test' }, async (_url, init) => {
    const request = JSON.parse(init.body); const forwarded = JSON.parse(request.input);
    assert.deepEqual(forwarded.layers.map(layer => layer.sourceKind), ['spatial', 'attribute']);
    assert.deepEqual(forwarded.layers[1].popupContent.imageFields, ['hinh_anh']);
    assert.equal(request.input.includes('https://'), false); assert.equal(request.input.includes('Chùa Trấn Quốc'), false);
    assert.equal(request.input.includes('coordinates'), false);
    assert.match(request.instructions, /khóa.*ghép|đơn hoặc ghép/);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ decisions: [], attributeJoins: [proposal(source, target)] }) }) };
  });
  assert.equal(result.attributeJoins.length, 1);
  assert.deepEqual(normalizeCompositionResult(result, input), result, 'server and client normalization agree');
  assert.equal(normalizeCompositionResult({ decisions: [] }, input).attributeJoins.length, 0, 'old replies remain valid');
});

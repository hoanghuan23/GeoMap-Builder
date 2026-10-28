import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { WebMercatorViewport } from '@deck.gl/core';
import { createArcFlowModel, buildArcFlowView, classifyArcFlows, arcFlowPath } from '../src/arc-flow-data.js';
import { parseSpreadsheetBuffer } from '../src/tabular-parser.js';
import { normalizeTabularRecords, profileTabularData } from '../src/tabular-data.js';
import { validateAndNormalizeAnalysis, ANALYSIS_RESPONSE_SCHEMA, supportedChartsForPrompt } from '../src/ai-chart-contract.js';
import { prepareSuggestions } from '../src/ai-chart-pipeline.js';
import { describeWorkspaceLayer, layerData, tableRecords, csvForRecords } from '../src/map-layer-data.js';
import { normalizeCompositionInput } from '../src/map-composition-contract.js';
import { nativeMapDataset } from '../src/native-map-data.js';
import { analysis, bindings, columns, row, suggestion } from './fixtures/arc-flow-fixture.js';

test('Arc Flow contract validates real, distinct endpoint bindings and remains compatible with old maps', () => {
  const profile = profileTabularData([row()]);
  const normalized = validateAndNormalizeAnalysis(analysis, profile);
  assert.equal(normalized.suggestions[0].chartType, 'arc_flow');
  assert.deepEqual(normalized.suggestions[0].bindings, bindings);
  assert.ok(supportedChartsForPrompt().arc_flow);
  assert.ok(ANALYSIS_RESPONSE_SCHEMA.properties.suggestions.items.properties.bindings.required.includes('targetLat'));
  for (const changes of [{ targetLat: null }, { targetLat: 'missing' }, { source: ['origin'] }, { sourceLat: 'origin' }, { targetLng: 'origin_lng' }, { value: 'period' }]) {
    const result = validateAndNormalizeAnalysis({ ...analysis, suggestions: [{ ...suggestion, bindings: { ...bindings, ...changes } }] }, profile);
    assert.equal(result.suggestions.length, 0);
  }
  const point = validateAndNormalizeAnalysis({ ...analysis, suggestions: [{ ...suggestion, chartType: 'point', bindings: { lat: 'origin_lat', lng: 'origin_lng' } }] }, profile);
  assert.equal(point.suggestions[0].chartType, 'point');
});

test('OD direction, aggregation and identities preserve reciprocal flows and names at different coordinates', () => {
  const records = [row(), row({ passengers: 20 }), row({ origin: 'B', destination: 'A', origin_lat: 10.8, origin_lng: 106.8, destination_lat: 10.7, destination_lng: 106.7, passengers: 5 }), row({ origin_lat: 11, passengers: 7 })];
  const view = buildArcFlowView(createArcFlowModel(records, columns, suggestion));
  assert.deepEqual(view.flows.map(flow => flow.value), [30, 7, 5]);
  assert.equal(view.nodes.features.length, 3);
  const first = view.flows[0];
  const filtered = buildArcFlowView(view.model, { sourceId: first.source.id });
  assert.equal(filtered.flows.length, 1);
  assert.equal(filtered.total, 30);
  assert.equal(view.total, 42);
  assert.equal(view.nodes.features.find(feature => feature.properties.__arcNodeId === first.source.id).properties.__inbound, 5);
});

test('validation counts invalid rows, retains zero, and applies the 70% gate without changing AI confidence', () => {
  const invalid = [row({ origin: '' }), row({ origin_lat: null }), row({ origin_lat: 100 }), row({ passengers: null }), row({ passengers: -1 }), row({ destination_lat: 10.7, destination_lng: 106.7 })];
  const model = createArcFlowModel([row({ passengers: 0 }), ...invalid], columns, suggestion);
  assert.equal(model.stats.invalidRows, 6);
  assert.deepEqual(Object.values(model.stats.reasons), [1, 1, 1, 1, 1, 1]);
  assert.equal(model.rows[0].value, 0);
  assert.equal(model.available, false);
  for (const [validCount, available] of [[7, true], [6, false]]) {
    const records = [...Array.from({ length: validCount }, () => row()), ...Array.from({ length: 10 - validCount }, () => row({ passengers: null }))];
    const normalized = normalizeTabularRecords(records, columns);
    const result = prepareSuggestions(analysis, normalized.records, normalized.validRowRate, { mapOnly: true })[0];
    assert.equal(result.available, available); assert.equal(result.confidence, .94); assert.equal(result.feasibilityScore, validCount / 10);
  }
});

test('ambiguous duplicate aggregation is reported, while explicit mean and count retain their semantics', () => {
  const records = [row(), row({ passengers: 30 })];
  const noDefault = columns.map(column => ({ ...column, aggDefault: null }));
  const model = createArcFlowModel(records, noDefault, { ...suggestion, agg: null });
  assert.equal(model.available, false); assert.match(model.unavailableReason, /phép tổng hợp/);
  assert.equal(buildArcFlowView(model).aggregationIssues, 1);
  assert.equal(buildArcFlowView(createArcFlowModel(records, columns, { ...suggestion, agg: 'mean' })).total, 20);
  const count = buildArcFlowView(createArcFlowModel(records, columns, { ...suggestion, agg: 'count' }));
  assert.equal(count.total, 2); assert.equal(count.model.unit, 'bản ghi');
});

test('attribute/time filters precede aggregation and Top N preserves the classification population', () => {
  const model = createArcFlowModel([row(), row({ passengers: 30, date: '2026-09-16', period: 'Chiều' })], columns, suggestion);
  assert.equal(buildArcFlowView(model, { time: '2026-09-16' }).total, 30);
  assert.equal(buildArcFlowView(model, { time: '2026-09-15' }).total, 10);
  assert.equal(buildArcFlowView(model, { time: '' }).total, 40);
  assert.equal(buildArcFlowView(model, { time: '2026-09-17' }).flows.length, 0);
  assert.equal(buildArcFlowView(model, { time: 'not-a-date' }).flows.length, 0);
  assert.equal(buildArcFlowView(model, { filters: { period: 'Chiều' } }).total, 30);
  const large = createArcFlowModel(Array.from({ length: 182 }, (_, i) => row({ destination: `B${i}`, passengers: i })), columns, suggestion);
  const view = buildArcFlowView(large);
  assert.equal(view.flows.length, 182); assert.equal(view.visibleFlows.length, 100);
  assert.equal(buildArcFlowView(large, { topN: 'all' }).visibleFlows.length, 182);
  assert.deepEqual(buildArcFlowView(large, { topN: 50 }).thresholds, view.thresholds);
  assert.equal(buildArcFlowView(large, { filters: { period: 'Không tồn tại' } }).flows.length, 0);
});

test('quantiles handle repeated values, empty data and one/two classes honestly', () => {
  const flows = values => values.map(value => ({ value }));
  assert.equal(classifyArcFlows([]).legend.length, 0);
  assert.equal(classifyArcFlows(flows([5, 5, 5])).legend.length, 1);
  assert.deepEqual(classifyArcFlows(flows([5, 10])).legend.map(item => item.id), ['low', 'high']);
  const classified = classifyArcFlows(flows([1, 1, 1, 1, 1, 10]));
  assert.equal(classified.legend.length, 2);
  assert.ok(classified.legend.every(item => item.count > 0 && item.min <= item.max));
});

test('the sampled 3D path has ground endpoints and separated reciprocal directions', () => {
  const flow = buildArcFlowView(createArcFlowModel([row()], columns, suggestion)).flows[0];
  const path = arcFlowPath(flow);
  assert.deepEqual(path[0], [...flow.source.position, 0]);
  assert.ok(Math.abs(path.at(-1)[0] - flow.target.position[0]) < 1e-8);
  assert.equal(path.at(-1)[2], 0); assert.ok(path[32][2] > 0);
  const reciprocal = arcFlowPath({ ...flow, source: flow.target, target: flow.source });
  assert.notEqual(path[32][0], reciprocal[32][0]);
  const wrapped = arcFlowPath({ ...flow, source: { position: [179, 10] }, target: { position: [-179, 10] } });
  assert.ok(Math.abs(wrapped.at(-1)[0] - wrapped[0][0]) <= 2.01);
});

test('city and national routes rise visibly above the map at their fitted zoom levels', () => {
  const routes = [
    { source: [106.7, 10.7], target: [106.8, 10.8], zoom: 11.5 },
    { source: [105.806, 21.219], target: [106.652, 10.819], zoom: 5 }
  ];
  for (const { source, target, zoom } of routes) {
    const flow = { source: { position: source }, target: { position: target } };
    const path = arcFlowPath(flow);
    const apex = path[32];
    const viewport = new WebMercatorViewport({ width: 1000, height: 650, pitch: 55, zoom,
      longitude: (source[0] + target[0]) / 2, latitude: (source[1] + target[1]) / 2 });
    const ground = viewport.project([apex[0], apex[1], 0]);
    const raised = viewport.project(apex);
    assert.ok(ground[1] - raised[1] > 40, `Route at zoom ${zoom} must have a visible elevated arch`);
    assert.ok(raised.every(Number.isFinite));
    const taller = arcFlowPath(flow, 2)[32];
    assert.ok(viewport.project(taller)[1] < raised[1], 'Increasing height must raise the rendered arch');
    const reverse = arcFlowPath({ source: flow.target, target: flow.source });
    const reverseApex = viewport.project(reverse[32]);
    assert.ok(Math.hypot(raised[0] - reverseApex[0], raised[1] - reverseApex[1]) > 2, 'Reciprocal routes must stay distinguishable');
  }
});

test('workspace descriptors, table and CSV share all filtered ODs independently of Top N', () => {
  const records = Array.from({ length: 120 }, (_, i) => row({ destination: `B${i}`, passengers: i }));
  const model = createArcFlowModel(records, columns, suggestion); const view = buildArcFlowView(model);
  const state = { mapType: 'arc_flow', arcFlowView: view, aiDataset: { records, analysis, suggestions: [{ ...suggestion, available: true }], selectedSuggestionId: suggestion.id } };
  assert.equal(tableRecords(state).length, 120); assert.equal(layerData(state).features.length, 120);
  assert.equal(csvForRecords(tableRecords(state)).split('\n').length, 121);
  const descriptor = describeWorkspaceLayer('a', state, 'Flows');
  const normalized = normalizeCompositionInput({ layers: [descriptor], groups: [], newLayerIds: ['a'] });
  assert.equal(normalized.layers[0].chartType, 'arc_flow'); assert.equal(normalized.layers[0].sourceKind, 'spatial');
  assert.deepEqual(normalized.layers[0].geometryKinds, ['line']);
});

test('GeoJSON properties with explicit OD bindings retain Arc Flow alongside their authoritative native geometry', () => {
  const records = [row()]; const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: records[0],
    geometry: { type: 'LineString', coordinates: [[106.7, 10.7], [106.8, 10.8]] } }] };
  const native = { id: 'native', chartType: 'map_line', confidence: .8, bindings: { value: 'passengers' } };
  const dataset = nativeMapDataset(data, { records, analysis: { ...analysis, suggestions: [native, suggestion] } }, 'flows.geojson');
  assert.deepEqual(dataset.suggestions.map(item => item.chartType), ['arc_flow', 'map_line']);
  assert.equal(dataset.nativeGeometry.features[0], data.features[0]);
  assert.equal(dataset.suggestions[0].bindings, bindings);
  assert.equal(buildArcFlowView(createArcFlowModel(dataset.records, dataset.analysis.columns, dataset.suggestions[0])).total, 10);
});

const sample = new URL('../metro_arc_flow_gia_lap.xlsx', import.meta.url);
test('provided Excel: 182 directed ODs, 14 endpoints, 1,663,830 passengers, Top 100/all', { skip: !existsSync(sample) }, () => {
  const parsed = parseSpreadsheetBuffer(readFileSync(sample), { sheetName: 'Luu_luong_OD' });
  const sampleBindings = Object.fromEntries(Object.keys(bindings).map((key, i) => [key, ['Ga đi', 'Ga đến', 'Vĩ độ đi', 'Kinh độ đi', 'Vĩ độ đến', 'Kinh độ đến', 'Lượt hành khách', 'Ngày', 'Giờ'][i]]));
  const sampleColumns = columns.map(column => ({ ...column, name: sampleBindings[Object.keys(bindings).find(key => bindings[key] === column.name)] }));
  const model = createArcFlowModel(parsed.records, sampleColumns, { ...suggestion, bindings: sampleBindings });
  const view = buildArcFlowView(model);
  assert.equal(model.stats.invalidRows, 0); assert.equal(view.flows.length, 182); assert.equal(view.nodes.features.length, 14);
  assert.equal(view.total, 1663830); assert.equal(view.visibleFlows.length, 100);
  assert.equal(buildArcFlowView(model, { topN: 'all' }).visibleFlows.length, 182);
});

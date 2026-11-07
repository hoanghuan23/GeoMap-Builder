import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeMapDataset, nativeMapView } from '../src/shared/data/native-map-data.js';
import { buildPopupChart, createPopupChartSelection } from '../src/shared/popup/ai-popup-chart.js';
import { geometryExtent, describeWorkspaceLayer, csvForRecords } from '../src/shared/view/map-layer-data.js';

const geometry = { type: 'Polygon', coordinates: [[[105, 21], [106, 21], [106, 22], [105, 21]]] };
const features = [1, 2].flatMap(id => [1, 2].map(day => ({ type: 'Feature', id, geometry, properties: { name: 'Tên trùng', date: new Date(`2026-09-0${day}`), temperature: id * 10 + day } })));
const pipeline = { records: features.map(feature => feature.properties), analysis: { datasetTitle: 'Thời tiết', source: 'ai',
  columns: [{ name: 'name', role: 'text' }, { name: 'date', role: 'time', timeParse: 'iso' }, { name: 'temperature', role: 'measure', aggDefault: 'mean', unit: '°C' }],
  suggestions: [{ id: 'native', chartType: 'choropleth', bindings: { region: 'name', value: 'temperature' }, confidence: .9,
    popupSuggestions: [{ name: 'line', confidence: .95 }, { name: 'info', confidence: .9 }], metricButtons: [] }], search_bar: true, search_fields: ['name'] } };

test('native geometry keeps stable object IDs, independent time filtering and popup histories for duplicate names', () => {
  const dataset = nativeMapDataset({ type: 'FeatureCollection', features }, pipeline, 'weather.geojson');
  const suggestion = dataset.suggestions[0]; const identity = dataset.nativeGeometry.identityField;
  assert.equal(dataset.records[0][identity], dataset.records[1][identity]);
  assert.notEqual(dataset.records[0][identity], dataset.records[2][identity]);
  const view = nativeMapView(dataset, { date: '2026-09-02T00:00:00.000Z' });
  assert.equal(view.features.length, 2);
  assert.equal(view.features[0].geometry, geometry, 'authoritative geometry is not geocoded or reconstructed');
  assert.equal(view.features[0].properties.temperature, 12);
  const selection = createPopupChartSelection(dataset.records, dataset.analysis.columns, 'temperature', 'line', suggestion.bindings);
  const chart = buildPopupChart({ records: dataset.records, columns: dataset.analysis.columns, feature: view.features[0], regionField: identity,
    kind: 'line', selection, chartType: 'choropleth', bindings: suggestion.bindings });
  assert.ok(chart.config);
  assert.equal(chart.config.data.length, 2);
  assert.deepEqual(chart.config.data.map(row => row[chart.config.series[0].key]), [11, 12]);
  assert.equal(features[0].properties[identity], undefined, 'source records are unchanged');
});

test('extent and composition descriptors avoid raw values; CSV exports real fields safely', () => {
  const data = { type: 'FeatureCollection', features };
  assert.deepEqual(geometryExtent(data), [105, 21, 106, 22]);
  assert.equal(geometryExtent({ type: 'Point', coordinates: [999, 21] }), null);
  const descriptor = describeWorkspaceLayer('layer', { mapType: 'polygon', sourceBoundary: data, boundary: data, spatialAnalysis: pipeline.analysis }, 'Thời tiết');
  assert.equal(descriptor.available, true);
  assert.equal(describeWorkspaceLayer('invalid', { mapType: null, aiDataset: { analysis: pipeline.analysis,
    suggestions: [{ id: 'broken', available: false, chartType: 'choropleth' }], selectedSuggestionId: 'broken', boundaries: data } }, 'Chưa ghép được').available, false);
  assert.equal(descriptor.geometry, undefined);
  assert.equal(descriptor.records, undefined);
  assert.equal(descriptor.columns.some(column => 'samples' in column), false);
  const csv = csvForRecords([{ name: '=SUM(A1)', temperature: 0, __private: 'secret' }]);
  assert.match(csv, /'=SUM/); assert.equal(csv.includes('secret'), false); assert.match(csv, /"0"/);
});

test('unchanged GeoJSON reuses its extent without revisiting coordinates or exposing the cached bounds', () => {
  let reads = 0;
  const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'Polygon', get coordinates() { reads++; return geometry.coordinates; }
  } }] };
  const extent = geometryExtent(data);
  assert.deepEqual(extent, [105, 21, 106, 22]);
  const initialReads = reads;
  extent[0] = -180;
  data.features[0].properties.name = 'Updated label';
  assert.deepEqual(geometryExtent(data), [105, 21, 106, 22]);
  assert.equal(reads, initialReads, 'property/style changes must not scan coordinates again');

  const filtered = { ...data, features: [] };
  assert.equal(geometryExtent(filtered), null);
  assert.equal(geometryExtent(filtered), null);
  const replacement = { ...data, features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'Point', coordinates: [107, 23]
  } }] };
  assert.deepEqual(geometryExtent(replacement), [107, 23, 107, 23]);
  assert.deepEqual(geometryExtent(data), [105, 21, 106, 22], 'filtered/replacement datasets keep independent extents');
});

test('extent covers geometry collections and ignores invalid positions', () => {
  const data = { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [
    { type: 'Point', coordinates: [999, 21] },
    { type: 'LineString', coordinates: [[105, 0], [106, -10], [NaN, 20]] },
    { type: 'Point', coordinates: [0, 0] }
  ] } };
  assert.deepEqual(geometryExtent(data), [0, -10, 106, 0]);
  assert.equal(geometryExtent(null), null);
});

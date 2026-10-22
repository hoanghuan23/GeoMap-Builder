import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeMapDataset, nativeMapView } from '../src/native-map-data.js';
import { buildPopupChart, createPopupChartSelection } from '../src/ai-popup-chart.js';
import { geometryExtent, describeWorkspaceLayer, csvForRecords } from '../src/map-layer-data.js';

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
  assert.equal(descriptor.geometry, undefined);
  assert.equal(descriptor.records, undefined);
  assert.equal(descriptor.columns.some(column => 'samples' in column), false);
  const csv = csvForRecords([{ name: '=SUM(A1)', temperature: 0, __private: 'secret' }]);
  assert.match(csv, /'=SUM/); assert.equal(csv.includes('secret'), false); assert.match(csv, /"0"/);
});

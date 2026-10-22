import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as XLSX from 'xlsx';
import { createHarness } from './fixtures/map-runtime-harness.js';
import { requestAiDataAnalysis } from '../src/ai-data-analysis.js';
import { fallbackAnalysis, validateAndNormalizeAnalysis } from '../src/ai-chart-contract.js';
import { prepareSuggestions } from '../src/ai-chart-pipeline.js';
import { expandJsonUpload, jsonDatasets } from '../src/json-datasets.js';
import { tableRecords } from '../src/map-layer-data.js';
import { nativeMapDataset } from '../src/native-map-data.js';
import { layerRank } from '../src/layer-order.js';

const noMap = { datasetTitle: 'Kết quả phân tích', grain: 'Một bản ghi', columns: [], suggestions: [], search_bar: false, search_fields: [], source: 'ai' };
const feature = (type, coordinates, properties = {}) => ({ type: 'Feature', properties, geometry: { type, coordinates } });
const collection = (...features) => ({ type: 'FeatureCollection', features });
const polygon = collection(feature('Polygon', [[[105, 21], [106, 21], [106, 22], [105, 21]]], { cell_id: 'a', ratio_0530: 9 }));
const file = (name, data) => ({ name, size: JSON.stringify(data).length, lastModified: 1, text: async () => JSON.stringify(data) });

test('known travel-time columns in JSON, CSV and Excel always go through AI analysis', async () => {
  const rows = [{ cell_id: 'a', departure_time: '05:30', bus_minutes: 30, motorbike_minutes: 10 }];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Observations');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const csv = 'cell_id,departure_time,bus_minutes,motorbike_minutes\na,05:30,30,10';
  const original = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/analyze-map-data'); requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => noMap };
  };
  try {
    for (const input of [file('travel_times.json', rows),
      { name: 'travel_times.csv', size: csv.length, text: async () => csv, arrayBuffer: async () => new TextEncoder().encode(csv).buffer },
      { name: 'travel_times.xlsx', arrayBuffer: async () => bytes }]) {
      const { context } = createHarness(); context.requestAiDataAnalysis = requestAiDataAnalysis; context.input = input;
      const result = await vm.runInContext('readSpatialFile(input)', context);
      assert.equal(result.kind, 'ai-pipeline');
      assert.deepEqual(result.pipeline.analysis.suggestions, []);
      assert.equal('ratio' in result.pipeline.records[0], false, 'no business metric is calculated');
      assert.deepEqual(Array.from(result.pipeline.records, row => row.cell_id), ['a']);
    }
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.profile.columns.some(column => column.name === 'bus_minutes')));
  } finally { globalThis.fetch = original; }
});

test('station, OSM and neutral filenames follow the same GeoJSON AI path and preserve an empty decision', async () => {
  const data = collection(feature('Point', [105, 21], { name: 'A', fclass: 'bus_stop', observation: 12 }));
  const original = globalThis.fetch; const profiles = [];
  globalThis.fetch = async (_url, options) => {
    profiles.push(JSON.parse(options.body).profile);
    return { ok: true, json: async () => noMap };
  };
  try {
    for (const name of ['stations.geojson', 'gis_osm_transport_free.geojson', 'sample.geojson']) {
      const { context } = createHarness(); context.requestAiDataAnalysis = requestAiDataAnalysis; context.input = file(name, data);
      await vm.runInContext('(async () => applyReadResult(await readSpatialFile(input), input))()', context);
      assert.equal(vm.runInContext('state.mapType', context), null);
      assert.deepEqual(vm.runInContext('state.aiDataset.suggestions', context), []);
      assert.equal(vm.runInContext('state.uploadLayers.length', context), 0);
    }
    assert.equal(profiles.length, 3);
    assert.deepEqual(profiles[0], profiles[1]); assert.deepEqual(profiles[1], profiles[2]);
    assert.deepEqual(profiles[0].spatial.geometryKinds, ['point']);
  } finally { globalThis.fetch = original; }
});

test('native Polygon and Line geometry requires an AI proposal and accepts optional attribute bindings', async () => {
  const original = globalThis.fetch;
  try {
    for (const [data, chartType, expected] of [[polygon, 'choropleth', 'polygon'], [collection(feature('LineString', [[105, 21], [106, 22]])), 'map_line', 'line']]) {
      for (const proposed of [false, true]) {
        const { context, sources } = createHarness(); context.requestAiDataAnalysis = requestAiDataAnalysis; context.input = file('hexagons.geojson', data);
        globalThis.fetch = async (_url, options) => {
          const { profile } = JSON.parse(options.body);
          assert.equal(profile.spatial.nativeGeometry, true);
          return { ok: true, json: async () => ({ ...noMap, suggestions: proposed ? [{ id: 'ai-native', chartType, title: 'Geometry', confidence: .84,
            reason: 'Đề xuất từ hồ sơ geometry', bindings: { region: null, value: null }, popupSuggestions: [{ name: 'info', confidence: .9 }] }] : [] }) };
        };
        await vm.runInContext('(async () => applyReadResult(await readSpatialFile(input), input))()', context);
        assert.equal(vm.runInContext('state.mapType', context), proposed ? expected : null);
        assert.equal(vm.runInContext('state.aiDataset.suggestions.length', context), proposed ? 1 : 0);
        if (proposed) {
          const rendered = sources.get(expected === 'polygon' ? 'polygon-data' : 'line-data').data;
          assert.equal(JSON.stringify(rendered.features[0].geometry), JSON.stringify(data.features[0].geometry));
          assert.equal(vm.runInContext('state.aiDataset.suggestions[0].confidence', context), .84);
        }
      }
    }
  } finally { globalThis.fetch = original; }
});

test('compound JSON extraction depends on structure and never joins records or computes ratios', async () => {
  const bundle = { hexagons: polygon, stations: collection(feature('Point', [105, 21], { name: 'A' })),
    metro_route: collection(feature('LineString', [[105, 21], [106, 22]])), travel_times: [{ cell_id: 'a', bus_minutes: 30, motorbike_minutes: 10 }],
    metadata: { description: 'context', times: ['05:30', '06:30'] } };
  const renamed = Object.fromEntries(Object.values(bundle).map((data, index) => [`input${index}`, data]));
  const original = JSON.stringify(bundle);
  assert.deepEqual(jsonDatasets(bundle).map(item => item.data), jsonDatasets(renamed).map(item => item.data));
  const parts = await expandJsonUpload(file('metro.json', bundle));
  assert.equal(parts.length, 4);
  assert.equal(new Set(parts.map(part => part.datasetKey)).size, 4);
  const inputs = await Promise.all(parts.map(async part => JSON.parse(await part.text())));
  assert.equal(inputs[0].features[0].properties.ratio_0530, 9);
  assert.equal('ratio' in inputs[3][0], false);
  assert.equal(JSON.stringify(bundle), original);
  assert.throws(() => jsonDatasets({ message: 'No datasets' }), /JSON/);
  await assert.rejects(expandJsonUpload({ name: 'bad.json', text: async () => '{' }), SyntaxError);
});

test('mixed geometry is split structurally so each dataset can receive an AI decision', async () => {
  const mixed = collection(polygon.features[0], feature('Point', [105, 21]), feature('LineString', [[105, 21], [106, 22]]));
  const parts = await expandJsonUpload(file('mixed.geojson', mixed));
  assert.equal(parts.length, 3);
  assert.deepEqual((await Promise.all(parts.map(async part => JSON.parse(await part.text())))).map(data => data.features[0].geometry.type), ['Polygon', 'Point', 'LineString']);
  assert.equal(mixed.features.length, 3);
});

test('unavailable and malformed AI results preserve records without inventing roles, aggregation or suggestions', async () => {
  const rows = [{ province: 'A', temperature: 30 }, { province: 'B', temperature: 20 }];
  const original = globalThis.fetch;
  try {
    for (const response of [{ ok: false, json: async () => ({ error: 'AI unavailable' }) },
      { ok: true, json: async () => ({ columns: [], suggestions: [{ id: 'broken', chartType: 'unknown' }] }) }]) {
      globalThis.fetch = async () => response;
      const result = await requestAiDataAnalysis(rows);
      assert.deepEqual(result.records, rows);
      assert.deepEqual(prepareSuggestions(result.analysis, result.records, result.validRowRate), []);
      assert.ok(result.analysis.columns.every(column => column.role === 'ignore' && column.aggDefault === null));
      assert.ok(result.fallbackReason);
      assert.deepEqual(tableRecords({ aiDataset: result }), rows);
    }
    const profile = { rowCount: 2, columns: [{ name: 'province', inferredType: 'text' }, { name: 'temperature', inferredType: 'number' }] };
    const normalized = validateAndNormalizeAnalysis({ ...noMap, columns: [{ name: 'province', role: 'category' }] }, profile);
    assert.equal(normalized.columns[0].role, 'category');
    assert.equal(normalized.columns[1].role, 'ignore');
    const native = nativeMapDataset(polygon, { analysis: fallbackAnalysis(profile), records: polygon.features.map(feature => feature.properties) }, 'hexagons.geojson');
    assert.deepEqual(native.suggestions, []);
  } finally { globalThis.fetch = original; }
});

test('draw ordering uses geometry rather than dataset filenames', () => {
  for (const geometryKinds of [['area'], ['line'], ['point']]) {
    assert.equal(layerRank({ name: 'hexagons.geojson', geometryKinds }), layerRank({ name: 'stations.geojson', geometryKinds }));
  }
});

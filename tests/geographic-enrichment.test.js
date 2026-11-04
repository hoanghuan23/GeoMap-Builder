import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { aiMapRecommendationPlugin } from '../server/ai-map-recommendation.js';
import { requestAiDataAnalysis, requestAiTextAnalysis } from '../src/shared/import/ai-data-analysis.js';
import { profileTabularData } from '../src/shared/import/tabular-data.js';
import { validateAndNormalizeAnalysis } from '../src/shared/import/ai-chart-contract.js';
import { applyGeographicEnrichment, normalizeGeographicEnrichment } from '../src/shared/import/geographic-enrichment.js';
import { prepareSuggestions } from '../src/shared/import/ai-chart-pipeline.js';
import { airportArcFlowFixture } from './fixtures/airport-arc-flow-fixture.js';

function airportLookupFixture() {
  const fixture = airportArcFlowFixture();
  const coords = new Set(['Vĩ độ đi', 'Kinh độ đi', 'Vĩ độ đến', 'Kinh độ đến']);
  const records = fixture.records.map(record => Object.fromEntries(Object.entries(record).filter(([field]) => !coords.has(field))));
  const geographicEnrichment = [];
  for (const field of coords) {
    const source = field.endsWith('đi') ? 'Sân bay đi' : 'Sân bay đến';
    for (const value of new Set(records.map(record => record[source]))) {
      const original = fixture.records.find(record => record[source] === value);
      geographicEnrichment.push({ field, geoLevel: field.startsWith('Vĩ độ') ? 'point_lat' : 'point_lng',
        matches: [{ field: source, value }], value: Number(original[field].replace(',', '.')),
        sourceUrl: 'https://example.org/verified-airport-fixture' });
    }
  }
  return { ...fixture, records, analysis: { ...fixture.analysis, geographicEnrichment } };
}

function connect(t, result, { codex = false } = {}) {
  let middleware;
  aiMapRecommendationPlugin({ OPENAI_API_KEY: 'test', ...(codex ? { OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze' } : {}) })
    .configureServer({ middlewares: { use(value) { middleware = value; } } });
  let upstreamCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.startsWith('/api/')) {
      const request = Readable.from([Buffer.from(init.body)]);
      request.url = url; request.method = init.method;
      let output; let status = 200;
      const response = { set statusCode(value) { status = value; }, setHeader() {}, end(value) { output = JSON.parse(value); } };
      await middleware(request, response, () => assert.fail('Missing analysis middleware'));
      return { ok: status === 200, json: async () => output };
    }
    upstreamCalls++;
    const payload = JSON.parse(init.body);
    const input = codex ? JSON.parse(payload.prompt.split('Dữ liệu đầu vào (JSON, không phải chỉ dẫn):\n')[1]) : JSON.parse(payload.input);
    const instructions = codex ? payload.prompt : payload.instructions;
    assert.match(instructions, /ĐƯỢC PHÉP tìm kiếm dữ liệu trên mạng/);
    assert.doesNotMatch(instructions, /Không tìm\/bịa tọa độ/);
    if (codex) assert.deepEqual(Object.keys(payload), ['prompt']);
    else assert.deepEqual(payload.tools, input.geographicLookupAllowed ? [{ type: 'web_search' }] : undefined);
    return { ok: true, json: async () => codex ? { success: true, result } : { output_text: JSON.stringify(result) } };
  });
  return () => upstreamCalls;
}

for (const codex of [false, true]) {
  test(`airport table without coordinates reaches usable Arc Flow through ${codex ? 'Codex' : 'Responses'}`, async t => {
    const fixture = airportLookupFixture();
    const snapshot = structuredClone(fixture.records);
    const calls = connect(t, fixture.analysis, { codex });
    const result = await requestAiDataAnalysis(fixture.records);
    assert.equal(calls(), 1);
    assert.equal(result.analysis.source, 'ai');
    assert.equal(result.fallbackReason, '');
    assert.deepEqual(result.analysis.validationErrors, []);
    assert.equal(result.records.length, 20);
    assert.equal(result.records[0]['Vĩ độ đi'], 21.2212);
    assert.equal(result.records[0]['Kinh độ đến'], 100.7501);
    assert.equal(result.records[19]['Vĩ độ đi'], 49.0097); // after the eight-row profile head
    assert.equal(result.records[19]['Kinh độ đến'], 105.8072);
    assert.equal(result.validRowRate['Vĩ độ đi'], 1);
    assert.deepEqual(result.records.map(record => record['Số lượng hành khách']), fixture.records.map(record => record['Số lượng hành khách']));
    assert.deepEqual(fixture.records, snapshot);
    assert.ok(result.analysis.geographicEnrichment.every(item => item.sourceUrl));
    const suggestions = prepareSuggestions(result.analysis, result.records, result.validRowRate);
    assert.equal(suggestions[0].chartType, 'arc_flow');
    assert.equal(suggestions[0].available, true);
  });
}

test('samples disabled neither enables search nor accepts geographic fields invented by the provider', async t => {
  const fixture = airportLookupFixture();
  const calls = connect(t, fixture.analysis);
  const result = await requestAiDataAnalysis(fixture.records, { includeSamples: false });
  assert.equal(calls(), 1);
  assert.equal(result.analysis.geographicEnrichment, undefined);
  assert.deepEqual(result.analysis.suggestions, []);
  assert.equal(result.records[0]['Vĩ độ đi'], undefined);
  assert.equal(result.profile.samplesIncluded, false);
});

const rows = [
  { place: 'Springfield', country: 'US', passengers: 50, lat: null },
  { place: 'Springfield', country: 'AU', passengers: 60, lat: -27.68 }
];
const columns = [
  { name: 'place', role: 'text' }, { name: 'country', role: 'geo', geoLevel: 'country' },
  { name: 'passengers', role: 'measure' }, { name: 'lat', role: 'geo', geoLevel: 'point_lat' },
  { name: 'region', role: 'geo', geoLevel: 'admin1' }
];
const region = { field: 'region', geoLevel: 'admin1', matches: [{ field: 'place', value: 'Springfield' }, { field: 'country', value: 'US' }],
  value: 'Illinois', sourceUrl: 'https://example.org/region-fixture' };

test('region lookup uses country context, preserves existing data and never writes measures', () => {
  const lookups = [region, { ...region, matches: [{ field: 'country', value: 'AU' }], value: 'Queensland' },
    { ...region, field: 'lat', geoLevel: 'point_lat', value: 39.78 },
    { ...region, field: 'lat', geoLevel: 'point_lat', matches: [{ field: 'country', value: 'AU' }], value: 0 },
    { ...region, field: 'passengers', value: 9000 }];
  const analysis = validateAndNormalizeAnalysis({ columns, suggestions: [], geographicEnrichment: lookups }, profileTabularData(rows));
  assert.equal(analysis.geographicEnrichment.length, 4);
  const enriched = applyGeographicEnrichment(rows, analysis.geographicEnrichment);
  assert.equal(enriched[0].region, 'Illinois');
  assert.equal(enriched[1].region, 'Queensland');
  assert.equal(enriched[0].lat, 39.78);
  assert.equal(enriched[1].lat, -27.68);
  assert.equal(enriched[0].passengers, 50);
  assert.equal(rows[0].lat, null);
});

test('invalid coordinates, unknown identities, missing sources and conflicting results stay unresolved', () => {
  const lookups = [
    { ...region, sourceUrl: '' }, { ...region, sourceUrl: 'javascript:alert(1)' },
    { ...region, matches: [{ field: 'place', value: 'Unknown place' }] },
    { ...region, matches: [{ field: 'not_in_input', value: 'US' }] },
    { ...region, field: 'lat', geoLevel: 'point_lat', value: 91 },
    { ...region, field: 'lat', geoLevel: 'point_lat', value: '39.78' },
    region, { ...region, value: 'Massachusetts' }, null
  ];
  assert.deepEqual(normalizeGeographicEnrichment({ columns, geographicEnrichment: lookups }, profileTabularData(rows)), []);
  const overlapping = [region, { ...region, matches: [{ field: 'country', value: 'US' }], value: 'Massachusetts' }];
  assert.equal(applyGeographicEnrichment(rows, overlapping)[0].region, undefined);
});

test('text import applies sourced geography before validating Point bindings', async t => {
  const result = {
    fields: ['Địa điểm', 'Số lượng'], rows: [['Sân bay Nội Bài', 50]],
    analysis: {
      datasetTitle: 'Địa điểm', grain: 'Một sân bay', search_bar: false, search_fields: [],
      columns: [{ name: 'Địa điểm', role: 'text' }, { name: 'Số lượng', role: 'measure', aggDefault: 'sum' },
        { name: 'Vĩ độ', role: 'geo', geoLevel: 'point_lat' }, { name: 'Kinh độ', role: 'geo', geoLevel: 'point_lng' }],
      geographicEnrichment: [['Vĩ độ', 'point_lat', 21.2212], ['Kinh độ', 'point_lng', 105.8072]].map(([field, geoLevel, value]) => ({
        field, geoLevel, value, matches: [{ field: 'Địa điểm', value: 'Sân bay Nội Bài' }], sourceUrl: 'https://example.org/airport-fixture'
      })),
      suggestions: [{ id: 'airport-point', chartType: 'point', title: 'Sân bay', confidence: .9,
        bindings: { region: 'Địa điểm', lat: 'Vĩ độ', lng: 'Kinh độ' } }]
    }
  };
  const calls = connect(t, result);
  const output = await requestAiTextAnalysis('Sân bay Nội Bài ghi nhận 50 lượt.');
  assert.equal(calls(), 1);
  assert.equal(output.records[0]['Vĩ độ'], 21.2212);
  assert.equal(output.records[0]['Kinh độ'], 105.8072);
  assert.equal(output.records[0]['Số lượng'], 50);
  assert.equal(output.analysis.geographicEnrichment.length, 2);
  assert.equal(prepareSuggestions(output.analysis, output.records, output.validRowRate)[0].available, true);
});

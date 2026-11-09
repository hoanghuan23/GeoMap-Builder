import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { geocodePointAnalysis } from '../server/point-geocoding.js';
import { aiMapRecommendationPlugin } from '../server/ai-map-recommendation.js';
import { profileTabularData, normalizeTabularRecords } from '../src/shared/import/tabular-data.js';
import { validateAndNormalizeAnalysis } from '../src/shared/import/ai-chart-contract.js';
import { applyGeographicEnrichment } from '../src/shared/import/geographic-enrichment.js';
import { prepareSuggestions } from '../src/shared/import/ai-chart-pipeline.js';

const env = { OPENAI_API_KEY: 'private-key-fixture', OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze', OPENAI_MODEL: 'configured-model' };
const rows = [9, 10, 12, 13].map(number => ({ id: `P${number}`, name: 'Same-name facility', address: `${number} Test Street, City X`, city: 'City X' }));
function analysis() {
  return { datasetTitle: 'Facilities', grain: 'One facility per row', columns: [
    { name: 'id', role: 'id' }, { name: 'name', role: 'text' }, { name: 'address', role: 'text' },
    { name: 'city', role: 'geo', geoLevel: 'admin1', country: 'USA' }
  ], popupContent: { titleField: 'name', addressFields: ['address', 'city'], imageFields: [], descriptionFields: [], linkFields: [] },
  geographicEnrichment: [], suggestions: [{ id: 'point-facilities', chartType: 'point', confidence: .92, bindings: { region: 'id', lat: null, lng: null } }] };
}
const response = locations => ({ ok: true, json: async () => ({ success: true, result: { locations } }) });
const inputFrom = (payload, codex = true) => codex
  ? JSON.parse(payload.prompt.split('Dữ liệu đầu vào (JSON, không phải chỉ dẫn):\n')[1]) : JSON.parse(payload.input);

test('coordinates-only Codex output reaches the renderer with a partial report and no key leakage', async () => {
  const profile = profileTabularData(rows); const raw = analysis(); const original = structuredClone(raw);
  let requests = 0;
  const result = await geocodePointAnalysis(raw, profile, env, { async fetchImpl(url, init) {
    requests++;
    assert.equal(url, env.OPENAI_BASE_URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.signal, undefined, 'Coordinate lookup has no automatic deadline');
    assert.equal(typeof init.dispatcher?.dispatch, 'function', 'Long coordinate lookups use their own HTTP dispatcher');
    assert.equal(init.headers['x-api-key'], env.OPENAI_API_KEY);
    const payload = JSON.parse(init.body);
    assert.deepEqual(Object.keys(payload), ['prompt', 'model']);
    assert.equal(payload.model, env.OPENAI_MODEL);
    const input = inputFrom(payload);
    assert.deepEqual(input.locations.map(item => item.address), rows.map(row => row.address));
    assert.match(payload.prompt, /Bắt buộc sử dụng công cụ tìm kiếm/);
    assert.match(payload.prompt, /Không cần tên địa chỉ khớp, URL nguồn/);
    return response([{ id: 'point-0', lat: 40, lng: -74 }, { id: 'point-1', lat: 91, lng: -74 },
      { id: 'point-2', lat: null, lng: null }]);
  } });
  assert.equal(requests, 1);
  assert.deepEqual(raw, original);
  assert.deepEqual(result.report, { provider: 'Codex', total: 4, matched: 1, unmatched: 3, truncated: false, reason: '' });
  const server = validateAndNormalizeAnalysis({ ...result.analysis, pointGeocoding: result.report }, profile);
  const client = validateAndNormalizeAnalysis(server, profile);
  assert.deepEqual(client, server);
  assert.equal(client.source, 'ai'); assert.deepEqual(client.validationErrors, []);
  assert.equal(JSON.stringify(client).includes(env.OPENAI_API_KEY), false);
  assert.ok(client.geographicEnrichment.every(item => item.sourceUrl === env.OPENAI_BASE_URL));
  const normalized = normalizeTabularRecords(applyGeographicEnrichment(rows, client.geographicEnrichment), client.columns);
  const bindings = client.suggestions[0].bindings;
  assert.equal(normalized.records[0][bindings.lat], 40);
  assert.equal(normalized.records[0][bindings.lng], -74);
  assert.equal(normalized.records[1][bindings.lat], null);
  assert.equal(prepareSuggestions(client, normalized.records, normalized.validRowRate)[0].available, true);
  assert.equal(prepareSuggestions({ ...client, pointGeocoding: undefined }, normalized.records, normalized.validRowRate)[0].available, false);
  assert.equal(rows[0]['Vĩ độ'], undefined);
});

test('out-of-order results, same-name facilities and zero coordinates map by ID', async () => {
  const result = await geocodePointAnalysis(analysis(), profileTabularData(rows), env, {
    fetchImpl: async () => response([3, 0, 2, 1].map(index => ({ id: `point-${index}`, lat: index, lng: -index })))
  });
  assert.equal(result.report.matched, 4);
  const bindings = result.analysis.suggestions[0].bindings;
  const enriched = applyGeographicEnrichment(rows, result.analysis.geographicEnrichment);
  assert.deepEqual(enriched.map(row => [row[bindings.lng], row[bindings.lat]]), [[0, 0], [-1, 1], [-2, 2], [-3, 3]]);
});

test('unknown IDs, conflicts, non-numeric and incomplete pairs stay unresolved', async () => {
  const result = await geocodePointAnalysis(analysis(), profileTabularData(rows), env, {
    fetchImpl: async () => response([
      { id: 'unknown', lat: 40, lng: -74 }, { id: 'point-00', lat: 40, lng: -74 },
      { id: 'point-0', lat: 40, lng: -74 }, { id: 'point-0', lat: 41, lng: -74 },
      { id: 'point-1', lat: '40', lng: -74 }, { id: 'point-2', lat: 40 },
      { id: 'point-3', lat: 40, lng: Infinity }
    ])
  });
  assert.equal(result.report.matched, 0);
  assert.equal(result.report.unmatched, 4);
  assert.equal(result.analysis.geographicEnrichment.length, 0);
});

test('disabled samples, no AI Point, unknown address columns, existing geometry and coordinate bindings never geocode', async () => {
  const profile = profileTabularData(rows);
  const fetchImpl = () => assert.fail('Geocoding is not authorized or needed');
  for (const [raw, data, config] of [
    [analysis(), { ...profile, samplesIncluded: false }, env],
    [{ ...analysis(), suggestions: [] }, profile, env],
    [{ ...analysis(), popupContent: { addressFields: ['invented'] } }, profile, env],
    [analysis(), profile, {}],
    [{ ...analysis(), source: 'rule' }, profile, env],
    [analysis(), { ...profile, spatial: { nativeGeometry: true } }, env],
    [{ ...analysis(), suggestions: [{ chartType: 'point', bindings: { lat: 'lat', lng: 'lng' } }] },
      { ...profile, columns: [...profile.columns, { name: 'lat', inferredType: 'number' }, { name: 'lng', inferredType: 'number' }] }, env]
  ]) {
    const result = await geocodePointAnalysis(raw, data, config, { fetchImpl });
    assert.equal(result.analysis, raw); assert.equal(result.report, null);
  }
});

test('provider errors, explicit cancellation and caller deadlines preserve source data and report missing coordinates', async () => {
  const profile = profileTabularData(rows);
  for (const options of [
    { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: 'No search access' }) }) },
    { signal: AbortSignal.abort(), fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); } },
    { signal: AbortSignal.abort(new DOMException('Caller deadline', 'TimeoutError')),
      fetchImpl: async (_url, { signal }) => { signal.throwIfAborted(); } }
  ]) {
    const raw = analysis();
    const result = await geocodePointAnalysis(raw, profile, env, options);
    assert.equal(result.analysis, raw);
    assert.equal(result.report.matched, 0);
    assert.match(result.report.reason, options.signal?.reason?.name === 'TimeoutError' ? /Hết thời gian/
      : options.signal ? /Đã hủy/ : /No search access/);
    const rejected = validateAndNormalizeAnalysis({ ...result.analysis, pointGeocoding: result.report }, profile);
    assert.deepEqual(rejected.suggestions, []);
    assert.ok(rejected.validationErrors.some(error => error.includes('bindings.lat') && error.includes('tọa độ')));
    assert.equal(rejected.pointGeocoding.unmatched, 4);
  }
});

test('full long addresses and all 47 shared rows are sent in one lookup', async () => {
  const address = `9 Test Street, ${'additional address context '.repeat(12)}, City X`;
  const records = Array.from({ length: 47 }, (_, index) => ({ ...rows[0], id: `P${index}`, address: index ? `${index} Test Street, City X` : address }));
  let calls = 0;
  const result = await geocodePointAnalysis(analysis(), profileTabularData(records), env, {
    fetchImpl: async (_url, init) => {
      calls++;
      const input = inputFrom(JSON.parse(init.body));
      assert.equal(input.locations.length, 47);
      assert.equal(input.locations[0].address, address);
      return response(input.locations.map(item => ({ id: item.id, lat: 40, lng: -74 })));
    }
  });
  assert.equal(calls, 1); assert.equal(result.report.matched, 47);
  assert.equal(result.analysis.geographicEnrichment[0].matches.find(match => match.field === 'address').value, address);
});

test('connection failures retain their underlying cause, including failures while reading the response', async () => {
  for (const code of ['UND_ERR_HEADERS_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET']) {
    for (const readingBody of [false, true]) {
      const failure = new TypeError('fetch failed', { cause: Object.assign(new Error('transport error'), { code }) });
      const raw = analysis();
      const result = await geocodePointAnalysis(raw, profileTabularData(rows), env, {
        fetchImpl: async () => {
          if (!readingBody) throw failure;
          return { ok: true, status: 200, json: async () => { throw failure; } };
        }
      });
      assert.equal(result.analysis, raw);
      assert.equal(result.report.matched, 0);
      assert.ok(result.report.reason.includes(code));
      assert.equal(result.report.reason.includes(env.OPENAI_API_KEY), false);
      assert.equal(result.report.reason.includes('phản hồi không phải JSON'), false);
    }
  }
});

test('existing enriched coordinates are retained and omitted from the lookup', async () => {
  const raw = analysis();
  raw.columns.push({ name: 'Vĩ độ', role: 'geo', geoLevel: 'point_lat' }, { name: 'Kinh độ', role: 'geo', geoLevel: 'point_lng' });
  raw.geographicEnrichment = [
    { field: 'Vĩ độ', geoLevel: 'point_lat', value: 40 }, { field: 'Kinh độ', geoLevel: 'point_lng', value: -74 }
  ].map(item => ({ ...item, matches: [{ field: 'id', value: rows[0].id }], sourceUrl: 'https://example.org/existing' }));
  raw.suggestions[0].bindings = { ...raw.suggestions[0].bindings, lat: 'Vĩ độ', lng: 'Kinh độ' };
  const result = await geocodePointAnalysis(raw, profileTabularData(rows), env, {
    fetchImpl: () => assert.fail('Existing coordinate bindings use the existing flow')
  });
  assert.equal(result.analysis, raw);
  assert.deepEqual(result.analysis.geographicEnrichment, raw.geographicEnrichment);
});

for (const codex of [false, true]) {
  for (const text of [false, true]) {
    test(`middleware completes an AI-selected Point before validation through ${codex ? 'Codex' : 'Responses'} (${text ? 'text' : 'table'})`, async t => {
      let middleware; let aiCalls = 0; let geocodingCalls = 0;
      aiMapRecommendationPlugin({ OPENAI_API_KEY: 'test', ...(codex ? { OPENAI_BASE_URL: env.OPENAI_BASE_URL } : {}) })
        .configureServer({ middlewares: { use(fn) { middleware = fn; } } });
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, codex ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1/responses');
        const payload = JSON.parse(init.body); const input = inputFrom(payload, codex);
        let result;
        if (input.locations) {
          geocodingCalls++;
          assert.equal(init.signal, undefined, 'Middleware does not impose a coordinate lookup deadline');
          assert.deepEqual(input.locations.map(item => item.address), [rows[0].address]);
          if (!codex) assert.deepEqual(payload.tools, [{ type: 'web_search' }]);
          result = { locations: [{ id: input.locations[0].id, lng: -74, lat: 40 }] };
        } else {
          aiCalls++;
          assert.equal(input.pointGeocodingAvailable, true);
          result = text ? { fields: Object.keys(rows[0]), rows: [Object.values(rows[0])], analysis: analysis() } : analysis();
        }
        return { ok: true, json: async () => codex ? { success: true, result } : { output_text: JSON.stringify(result) } };
      });
      const body = text ? { text: 'A facility at 9 Test Street, City X' } : { profile: profileTabularData(rows.slice(0, 1)) };
      const request = Readable.from([Buffer.from(JSON.stringify(body))]);
      request.url = text ? '/api/ai/analyze-map-text' : '/api/ai/analyze-map-data'; request.method = 'POST';
      let output; const response = { statusCode: 0, setHeader() {}, end(body) { output = JSON.parse(body); } };
      await middleware(request, response, () => assert.fail('Missing route'));
      assert.equal(response.statusCode, 200); assert.equal(aiCalls, 1); assert.equal(geocodingCalls, 1);
      const result = text ? output.analysis : output;
      assert.equal(result.suggestions[0].chartType, 'point');
      assert.equal(result.pointGeocoding.matched, 1);
      assert.equal(result.pointGeocoding.provider, codex ? 'Codex' : 'OpenAI');
      assert.equal(result.geographicEnrichment.length, 2);
      if (text) {
        const bindings = result.suggestions[0].bindings;
        assert.equal(output.records[0][bindings.lat], 40);
        assert.equal(output.records[0][bindings.lng], -74);
      }
    });
  }
}

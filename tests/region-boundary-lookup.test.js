import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupRegionBoundary } from '../server/region-boundary-lookup.js';
import { loadAdministrativeBoundaries } from '../src/shared/geography/administrative-boundaries.js';
import { landOnlyBoundary } from '../src/shared/search/map-search.js';
import { requestRegionBoundary } from '../src/shared/geography/region-boundary-lookup.js';

const geometry = { type: 'Polygon', coordinates: [[[105, 20], [106, 20], [106, 21], [105, 20]]] };
const region = { type: 'Feature', id: 'region.test', text: 'Test Region', place_name: 'Test Region, Việt Nam',
  place_type: ['region'], geometry, properties: { __country_code: 'VNM' } };
const response = data => ({ ok: true, status: 200, json: async () => data });
const collection = features => response({ type: 'FeatureCollection', features });

for (const source of ['MapTiler', 'local', 'web']) {
  test(`region resolution stops at ${source} and preserves provider/local/web priority`, async () => {
    const calls = [];
    const result = await loadAdministrativeBoundaries(['Test Region'], {
      country: 'VNM', placeType: 'region', apiKey: 'test',
      fetchImpl: async url => {
        if (String(url).startsWith('https://api.maptiler.com')) {
          calls.push('MapTiler'); return collection(source === 'MapTiler' ? [region] : []);
        }
        calls.push('local');
        return collection(source === 'local' ? [{ type: 'Feature', geometry,
          properties: { GID_0: 'VNM', GID_1: 'VNM.TEST', NAME_1: 'Test Region' } }] : []);
      },
      resolveMissingBoundary: async (name, options) => {
        calls.push('web');
        assert.equal(name, 'Test Region'); assert.equal(options.country, 'VNM');
        assert.equal(options.placeType, 'region');
        return { ...region, properties: { ...region.properties, web_boundary: true } };
      }
    });
    assert.equal(result.matchRate, 1);
    assert.equal(calls[0], 'MapTiler');
    if (source === 'MapTiler') assert.deepEqual(calls, ['MapTiler']);
    else {
      assert.ok(calls.indexOf('local') > calls.indexOf('MapTiler'));
      if (source === 'local') assert.ok(!calls.includes('web'));
      else assert.equal(calls.at(-1), 'web');
    }
  });
}

test('ambiguous provider candidates do not trigger a web search', async () => {
  const result = await loadAdministrativeBoundaries(['Test Region'], {
    country: 'VNM', placeType: 'region', apiKey: 'test', strict: false,
    fetchImpl: async () => collection([region, { ...region, id: 'region.other' }]),
    resolveMissingBoundary: () => assert.fail('must retain the ambiguous provider choices')
  });
  assert.equal(result.features.length, 0);
  assert.equal(result.candidates['Test Region'].length, 2);
});

test('missing local files allow a web fallback, but abort never starts web lookup', async () => {
  let calls = 0;
  const result = await loadAdministrativeBoundaries(['Test Region'], {
    country: 'VNM', fetchImpl: async () => { throw new Error('local file missing'); },
    resolveMissingBoundary: async () => { calls++; return region; }
  });
  assert.equal(calls, 1); assert.equal(result.matchRate, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadAdministrativeBoundaries(['Test Region'], {
    country: 'VNM', signal: controller.signal,
    resolveMissingBoundary: () => assert.fail('do not lookup after abort')
  }), { name: 'AbortError' });
});

test('wrong country, wrong level and unresolved web results leave the region unmatched', async () => {
  for (const feature of [null, { ...region, properties: { __country_code: 'THA' } }, { ...region, place_type: ['country'] }]) {
    const result = await loadAdministrativeBoundaries(['Test Region'], {
      country: 'VNM', placeType: 'region', strict: false, fetchImpl: async () => collection([]),
      resolveMissingBoundary: async () => feature
    });
    assert.deepEqual(result.unmatched, ['Test Region']);
    assert.equal(result.features.length, 0);
  }
});

const lookupInput = { name: 'Test Region', country: 'VNM', placeType: 'region' };
const aiResult = { found: true, country: 'VNM', placeType: 'region', names: ['Test Region'], sourceUrl: 'https://example.org/region-reference' };
const download = 'https://raw.githubusercontent.com/wmgeolab/geoBoundaries/main/releaseData/gbOpen/VNM/ADM1/test.geojson';
const metadata = { boundaryISO: 'VNM', boundaryType: 'ADM1', simplifiedGeometryGeoJSON: download, boundaryYearRepresented: '2024' };
const sourceFeature = { type: 'Feature', geometry, properties: { shapeName: 'Test Region', shapeType: 'ADM1', shapeGroup: 'VNM' } };

function mockLookup({ ai = aiResult, meta = metadata, features = [sourceFeature] } = {}) {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    if (url.endsWith('/responses')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.tools, [{ type: 'web_search' }]);
      assert.match(body.instructions, /đã thử MapTiler và dữ liệu nội bộ/);
      return response({ output_text: JSON.stringify(ai) });
    }
    if (url.startsWith('https://www.geoboundaries.org/api/')) return response(meta);
    assert.equal(url, download);
    assert.equal(init.redirect, 'manual');
    return collection(features);
  };
  return { urls, fetchImpl };
}

test('web boundary uses downloaded GeoJSON, preserves provenance and is not clipped to an older local outline', async () => {
  const mock = mockLookup();
  const result = await lookupRegionBoundary(lookupInput, { OPENAI_API_KEY: 'test' }, mock);
  assert.equal(mock.urls.length, 3);
  assert.deepEqual(result.geometry, geometry);
  assert.equal(result.properties.boundary_source_url, download);
  assert.equal(result.properties.boundary_lookup_source_url, aiResult.sourceUrl);
  assert.equal(result.properties.boundary_year, '2024');
  assert.equal(await landOnlyBoundary(result, { fetchImpl: () => assert.fail('preserve the web boundary geometry') }), result);
});

test('unverified identity, mismatched country/level, or a private download URL never downloads geometry', async () => {
  for (const options of [
    { ai: { ...aiResult, found: false } }, { ai: { ...aiResult, country: 'THA' } },
    { ai: { ...aiResult, placeType: 'country' } }, { ai: { ...aiResult, sourceUrl: '' } },
    { meta: { ...metadata, boundaryISO: 'THA' } },
    { meta: { ...metadata, simplifiedGeometryGeoJSON: 'http://127.0.0.1/private' } }
  ]) {
    const mock = mockLookup(options);
    assert.equal(await lookupRegionBoundary(lookupInput, { OPENAI_API_KEY: 'test' }, mock), null);
    assert.ok(mock.urls.length <= 2);
  }
});

test('duplicate names, wrong shape level, foreign shapes and malformed polygons stay unresolved', async () => {
  for (const features of [[sourceFeature, sourceFeature],
    [{ ...sourceFeature, properties: { ...sourceFeature.properties, shapeType: 'ADM0' } }],
    [{ ...sourceFeature, properties: { ...sourceFeature.properties, shapeGroup: 'THA' } }],
    [{ ...sourceFeature, geometry: { type: 'Point', coordinates: [105, 20] } }],
    [{ ...sourceFeature, geometry: { type: 'Polygon', coordinates: [[[105, 20], [181, 20], [106, 21], [105, 20]]] } }]]) {
    const mock = mockLookup({ features });
    assert.equal(await lookupRegionBoundary(lookupInput, { OPENAI_API_KEY: 'test' }, mock), null);
  }
});

test('browser fallback sends only the unresolved region context and propagates cancellation', async () => {
  const controller = new AbortController();
  const result = await requestRegionBoundary('Test Region', { country: 'VNM', placeType: 'region', signal: controller.signal,
    fetchImpl: async (url, init) => {
      assert.equal(url, '/api/ai/resolve-region-boundary');
      assert.deepEqual(JSON.parse(init.body), lookupInput);
      assert.equal(init.signal, controller.signal);
      return response({ feature: region });
    } });
  assert.deepEqual(result, region);
});

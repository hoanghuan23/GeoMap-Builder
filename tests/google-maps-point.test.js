import test from 'node:test';
import assert from 'node:assert/strict';
import { googleMapsUrl, googlePlacePin, googleAddressMatches } from '../server/google-maps-point.js';
import { geocodePointAnalysis } from '../server/point-geocoding.js';
import { profileTabularData, normalizeTabularRecords } from '../src/shared/import/tabular-data.js';
import { validateAndNormalizeAnalysis } from '../src/shared/import/ai-chart-contract.js';
import { applyGeographicEnrichment } from '../src/shared/import/geographic-enrichment.js';
import { prepareSuggestions } from '../src/shared/import/ai-chart-pipeline.js';

const pinUrl = 'https://www.google.com/maps/place/6+P.+Gia+Thuy/@1,2,12z/data=!4m5!8m2!3d21.0496082!4d105.8843794?authuser=0';
test('Google Maps pin extraction rejects camera centers, unrelated domains, search strings and sign-in links', () => {
  assert.deepEqual(googlePlacePin(pinUrl), { lat: 21.0496082, lng: 105.8843794,
    sourceUrl: pinUrl.split('?')[0] });
  for (const value of ['https://www.google.com/maps/@21,105,12z',
    'https://www.google.com/maps/search/?api=1&query=6+Gia+Thuy',
    'https://example.org/maps/place/Test/data=!3d21!4d105',
    `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(pinUrl)}`,
    'https://www.google.com/maps/place/Test/data=!3d91!4d105']) assert.equal(googlePlacePin(value), null);
  for (const value of ['http://127.0.0.1/', 'https://www.google.com.evil.test/maps/', 'https://user:pass@www.google.com/maps/',
    'https://www.google.com:8443/maps/', 'file:///tmp/test']) assert.equal(googleMapsUrl(value), null);
  assert.ok(googleMapsUrl('https://maps.app.goo.gl/fixture'));
});

test('selected address evidence must match the requested house, street and city', () => {
  const expected = 'Số 6 phố Gia Thụy, phường Bồ Đề, Hà Nội';
  assert.equal(googleAddressMatches(expected, '6 P. Gia Thụy, Bồ Đề, Hà Nội, Vietnam'), true);
  for (const address of ['16 P. Gia Thụy, Bồ Đề, Hà Nội, Vietnam', '6 P. Gia Quất, Bồ Đề, Hà Nội, Vietnam',
    '6 P. Gia Thụy, Đà Nẵng, Vietnam', 'P. Gia Thụy, Bồ Đề, Hà Nội, Vietnam']) assert.equal(googleAddressMatches(expected, address), false);
  const complex = 'L12–L15, lô R01, phân khu B, KĐT mới Dương Nội, Hà Nội';
  assert.equal(googleAddressMatches(complex, 'R01-L12, phân khu B, Dương Nội, Hà Nội',
    'An Dưỡng Việt – Daycare', 'Trung tâm AN DƯỠNG VIỆT'), true);
  assert.equal(googleAddressMatches(complex, 'R01-L90, phân khu B, Dương Nội, Hà Nội',
    'An Dưỡng Việt – Daycare', 'Trung tâm AN DƯỠNG VIỆT'), false);
});

test('address lookup sends original Maps links as context to Codex without invoking browser fallback', async () => {
  const records = [{ id: 'A', name: 'Facility', address: '6 Gia Thụy, Hà Nội', maps: 'https://maps.app.goo.gl/fixture' }];
  const profile = profileTabularData(records);
  const raw = { columns: Object.keys(records[0]).map(name => ({ name, role: name === 'id' ? 'id' : 'text' })),
    popupContent: { titleField: 'name', addressFields: ['address'], linkFields: ['maps'] },
    suggestions: [{ id: 'points', chartType: 'point', confidence: .9, bindings: { region: 'id', lat: null, lng: null } }], geographicEnrichment: [] };
  const result = await geocodePointAnalysis(raw, profile, { OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze', MAPTILER_API_KEY: 'unused' }, {
    fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:8000/analyze');
      assert.ok(JSON.parse(init.body).prompt.includes(records[0].maps));
      return { ok: true, json: async () => ({ success: true, result: { locations: [{ id: 'point-0', lat: 21.0496082, lng: 105.8843794 }] } }) };
    },
    resolveGoogleMaps: async () => assert.fail('Browser fallback is no longer part of address lookup')
  });
  assert.equal(result.report.provider, 'Codex');
  assert.equal(result.report.matched, 1);
  const server = validateAndNormalizeAnalysis({ ...result.analysis, pointGeocoding: result.report }, profile);
  const client = validateAndNormalizeAnalysis(server, profile);
  assert.deepEqual(client, server);
  const normalized = normalizeTabularRecords(applyGeographicEnrichment(records, client.geographicEnrichment), client.columns);
  const point = client.suggestions[0];
  assert.equal(normalized.records[0][point.bindings.lat], 21.0496082);
  assert.equal(prepareSuggestions(client, normalized.records, normalized.validRowRate)[0].available, true);
  assert.equal(JSON.stringify(client).includes('secret'), false);
});

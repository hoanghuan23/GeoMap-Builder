import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingMetroBundle } from '../src/metro-upload-group.js';
import { metroFixture } from './fixtures/metro-fixture.js';

const bundle = parts => ({ metroBundle: true, api: { state: { metroParts: parts } } });
test('structural Metro components must share cell IDs and cannot overwrite an existing role', () => {
  const metro = bundle({ hexagons: { data: metroFixture.hexagons } });
  assert.equal(matchingMetroBundle([metro], { metroRole: 'travel_times', data: metroFixture.travel_times }), metro);
  assert.equal(matchingMetroBundle([metro], { metroRole: 'travel_times', data: [{ cell_id: 'unrelated' }] }), null);
  assert.equal(matchingMetroBundle([metro], { metroRole: 'hexagons', data: metroFixture.hexagons }), null);
  assert.equal(matchingMetroBundle([metro, metro], { metroRole: 'travel_times', data: metroFixture.travel_times }), null, 'ambiguous parts stay separate');
});

test('optional geometry is associated only with one nearby bundle; measured stations remain independent datasets', () => {
  const metro = bundle({ hexagons: { data: metroFixture.hexagons } });
  const result = { metroRole: 'stations', data: metroFixture.stations };
  assert.equal(matchingMetroBundle([metro], result), metro);
  assert.equal(matchingMetroBundle([metro], { ...result, pipeline: { analysis: { columns: [{ name: 'measurement', role: 'measure' }] } } }), null);
  assert.equal(matchingMetroBundle([metro], { ...result, data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [105, 21] } }] } }), null);
});

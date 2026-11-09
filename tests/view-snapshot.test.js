import test from 'node:test';
import assert from 'node:assert/strict';
import { viewSnapshot } from '../src/shared/runtime/module.js';
import { tableRecords } from '../src/shared/view/map-layer-data.js';

const definition = { id: 'point' };
const context = () => ({ state: { mapType: 'point', dataProfile: { textFields: ['name'] } }, tasks: {} });
const point = properties => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [105, 21] }, properties });

test('reading map/search metadata does not materialize rows; table/export reads reuse them', () => {
  let reads = 0;
  const properties = { name: 'Hà Nội', value: 0 };
  const feature = point(properties);
  Object.defineProperty(feature, 'properties', { get() { reads++; return properties; } });
  const data = { type: 'FeatureCollection', features: [feature] };
  const view = viewSnapshot(context(), definition, { data });
  assert.equal(view.data, data);
  assert.equal(view.search.data, data);
  assert.deepEqual(view.extent, [105, 21, 105, 21]);
  assert.equal(reads, 0);
  const records = tableRecords({ getView: () => view });
  assert.deepEqual(records, [properties]);
  assert.equal(view.tableRecords, records);
  assert.equal(reads, 1);
});

test('new snapshots reflect replaced properties and filtered/replaced data', () => {
  const state = context();
  const data = { type: 'FeatureCollection', features: [point({ value: 1 }), point({ value: 2 })] };
  const original = viewSnapshot(state, definition, { data }).tableRecords;
  data.features[0].properties = { value: 10 };
  const updated = viewSnapshot(state, definition, { data }).tableRecords;
  assert.deepEqual(updated, [{ value: 10 }, { value: 2 }]);
  assert.equal(original[0].value, 1);
  const filtered = viewSnapshot(state, definition, { data: { ...data, features: data.features.slice(1) } });
  assert.deepEqual(filtered.tableRecords, [{ value: 2 }]);
  assert.deepEqual(viewSnapshot(state, definition, { data: null }).tableRecords, []);
});

test('attribute datasets and explicit Arc Flow rows keep their existing table semantics', () => {
  const state = context(); const records = [{ name: 'No geometry', value: null }];
  state.state.aiDataset = { records, suggestions: [], analysis: { columns: [] } };
  assert.equal(viewSnapshot(state, definition, { data: null }).tableRecords, records);
  const allFlows = [{ flow: 'A → B' }, { flow: 'B → C' }];
  const data = { type: 'FeatureCollection', features: [point({ flow: 'A → B' })] };
  assert.equal(viewSnapshot(state, definition, { data, tableRecords: allFlows }).tableRecords, allFlows);
  const empty = [];
  assert.equal(viewSnapshot(state, definition, { data, tableRecords: empty }).tableRecords, empty);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePieChartConfig } from '../src/charts/pie-chart.js';
import { buildPopupChart, createPopupChartSelection, popupDisplayOptions } from '../src/shared/popup/ai-popup-chart.js';
import { normalizePopupSuggestions, POPUP_SUGGESTION_SCHEMA } from '../src/shared/import/ai-chart-contract.js';
import { normalizeEditContext } from '../src/ai-map-edit-contract.js';
import { pieColumns, pieRows, pieBinding, pieSuggestion } from './fixtures/pie-composition-fixture.js';

const feature = { properties: { region: 'A' } };
function chart({ records = pieRows, columns = pieColumns, selection, binding = pieBinding } = {}) {
  return buildPopupChart({ records, columns, feature, regionField: 'region', chartType: 'choropleth', kind: 'pie',
    bindings: pieSuggestion.bindings, selection: selection || createPopupChartSelection(records, columns, 'trips', 'pie', pieSuggestion.bindings, binding) });
}

test('pie retains AI ranking and bindings through normalization and schema', () => {
  const normalized = normalizePopupSuggestions(pieSuggestion.popupSuggestions);
  assert.deepEqual(normalized, pieSuggestion.popupSuggestions);
  assert.ok(POPUP_SUGGESTION_SCHEMA.properties.name.enum.includes('pie'));
  assert.deepEqual(popupDisplayOptions(pieSuggestion, pieColumns).map(item => item.name), ['pie', 'info']);
  assert.equal(popupDisplayOptions(pieSuggestion, pieColumns)[0].available, true);
  assert.deepEqual(popupDisplayOptions({ popupSuggestions: [{ name: 'info', confidence: 1 }] }, pieColumns).map(item => item.name), ['info'], 'the client must not inject pie or change AI ordering');
  const context = normalizeEditContext({ groupId: 'g', layers: [{ id: 'a', mapType: 'polygon', columns: pieColumns, popupModes: ['info', 'pie'], popupMode: 'pie' }] });
  assert.ok(context.layers[0].popupModes.includes('pie'));
  assert.equal(context.layers[0].popupMode, 'pie');
});

test('reference composition isolates the selected object, excludes AI total rows and totals 100%', () => {
  const before = JSON.stringify(pieRows);
  const result = chart({ records: [...pieRows, { region: 'B', vehicle: 'Other object', trips: 900000 }] });
  assert.equal(result.message, '');
  const config = normalizePieChartConfig(result.config);
  assert.equal(config.total, 10000);
  assert.deepEqual(config.data.map(item => item.name), ['Xe máy', 'Ô tô', 'Xe buýt', 'Xe đạp', 'Khác']);
  config.data.forEach((item, index) => assert.ok(Math.abs(item.percentage - [50, 25, 15, 7, 3][index]) < 1e-10));
  assert.equal(new Set(config.data.map(item => item.color)).size, 5);
  assert.equal(config.groupLabel, 'Phương tiện');
  assert.equal(config.valueLabel, 'Số lượt di chuyển');
  assert.equal(JSON.stringify(pieRows), before);
});

test('pie groups use the actual dataset and latest snapshot instead of fixed reference categories', () => {
  const columns = [pieColumns[0], { name: 'channel', role: 'category', labelVi: 'Kênh' },
    { name: 'share', role: 'measure', unit: '%', aggDefault: 'mean' }, { name: 'date', role: 'time', timeParse: 'iso', granularity: 'day' }];
  const records = ['2026-09-01', '2026-09-02'].flatMap((date, index) => ['Trực tiếp', 'Trực tuyến'].map((channel, group) => ({
    region: 'A', channel, date, share: index ? [60, 40][group] : [25, 75][group]
  })));
  const binding = { groupField: 'channel', valueField: 'share', measureFields: [], excludedValues: [], title: 'Cơ cấu kênh' };
  const result = chart({ columns, records, binding });
  assert.equal(result.message, '');
  assert.deepEqual(result.config.data.map(item => item.value), [60, 40]);
  assert.deepEqual(normalizePieChartConfig(result.config).data.map(item => item.percentage), [60, 40]);
  assert.equal(chart({ columns, records: records.map(row => ({ ...row, share: 30 })), binding }).config, null, 'partial percentages must not be silently normalized into a complete whole');
});

test('pie supports wide component columns, excludes total columns and refuses different units', () => {
  const columns = [pieColumns[0], ...['online', 'store', 'total'].map(name => ({ name, role: 'measure', unit: 'đồng', aggDefault: 'sum' }))];
  const records = [{ region: 'A', online: 30, store: 70, total: 100 }];
  const binding = { groupField: null, valueField: null, measureFields: ['online', 'store'], excludedValues: [], title: null };
  const result = chart({ columns, records, binding });
  assert.equal(result.message, '');
  assert.deepEqual(normalizePieChartConfig(result.config).data.map(item => item.percentage), [30, 70]);
  assert.equal(normalizePieChartConfig(result.config).total, 100);
  assert.match(chart({ columns: columns.map(column => column.name === 'store' ? { ...column, unit: 'lượt' } : column), records, binding }).message, /cùng đơn vị/);
});

test('pie handles repeated observations through declared aggregation and can count group records', () => {
  const selected = createPopupChartSelection(pieRows, pieColumns, 'trips', 'pie', pieSuggestion.bindings, pieBinding);
  const result = chart({ records: [...pieRows, { region: 'A', vehicle: 'Xe máy', trips: 1000 }], selection: selected });
  assert.equal(normalizePieChartConfig(result.config).total, 11000);
  assert.match(chart({ columns: pieColumns.map(column => column.name === 'trips' ? { ...column, aggDefault: null } : column), records: [...pieRows, pieRows[0]] }).message, /phép gộp/);
  const counted = chart({ columns: pieColumns.filter(column => column.role !== 'measure'), binding: { ...pieBinding, valueField: null } });
  assert.equal(counted.message, '');
  assert.equal(normalizePieChartConfig(counted.config).total, 5);
});

test('pie preserves zero and rejects missing, negative, all-zero and single-component totals', () => {
  for (const [value, message] of [[-1, /không âm/], [null, /thiếu/], ['', /thiếu/], [NaN, /thiếu/]]) {
    assert.match(chart({ records: pieRows.map((row, index) => index ? row : { ...row, trips: value }) }).message, message);
  }
  assert.match(chart({ records: pieRows.map(row => ({ ...row, trips: 0 })) }).message, /lớn hơn 0/);
  assert.match(chart({ records: [pieRows[0]] }).message, /ít nhất hai nhóm/);
  const withZero = chart({ records: pieRows.map((row, index) => index ? row : { ...row, trips: 0 }) });
  assert.equal(normalizePieChartConfig(withZero.config).data[0].percentage, 0);
  assert.throws(() => normalizePieChartConfig({ data: [{ name: 'a', value: -1 }, { name: 'b', value: 2 }] }), /không âm/);
  assert.throws(() => normalizePieChartConfig({ data: [{ name: 'a', value: 0 }, { name: 'b', value: 0 }] }), /lớn hơn 0/);
  assert.throws(() => normalizePieChartConfig({ data: [{ name: 'a', value: ' ' }, { name: 'b', value: 2 }] }), /thiếu/);
});

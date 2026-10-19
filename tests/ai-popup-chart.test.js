import test from "node:test";
import assert from "node:assert/strict";
import { buildPopupChart, createPopupChartSelection, polygonDisplaySuggestions } from "../src/ai-popup-chart.js";
import { normalizeBarChartConfig } from "../src/charts/bar-chart.js";
import { buildRegionHexGrid } from "../src/region-hex-grid.js";

const columns = [
  { name: "region", role: "geo" }, { name: "date", role: "time" },
  { name: "temperature", role: "measure", aggDefault: "mean", unit: "°C" },
  { name: "rain", role: "measure", aggDefault: "sum", unit: "mm" }
];
const records = [
  { region: "A", date: new Date("2026-09-01"), temperature: 0, rain: 2 },
  { region: "A", date: new Date("2026-09-02"), temperature: null, rain: 3 },
  { region: "A", date: new Date("2026-09-03"), temperature: 30, rain: 4 },
  { region: "B", date: new Date("2026-09-01"), temperature: 90, rain: 90 },
  { region: "B", date: new Date("2026-09-03"), temperature: 90, rain: 90 }
];
const feature = { type: "Feature", properties: { region: "A", __location: "A", date: "2026-09-03", temperature: 30 },
  geometry: { type: "Polygon", coordinates: [[[105.7, 20.9], [105.9, 20.9], [105.9, 21.1], [105.7, 21.1], [105.7, 20.9]]] } };
const chart = (kind, overrides = {}) => buildPopupChart({ records, columns, feature, regionField: "region", kind,
  selection: createPopupChartSelection(records, columns, "temperature", kind), ...overrides });

test("polygon suggestions hide standalone charts while other data keeps existing choices", () => {
  const suggestions = [{ chartType: "line", available: true }, { chartType: "choropleth", available: true }, { chartType: "bar", available: true }];
  assert.deepEqual(polygonDisplaySuggestions(suggestions).map(item => item.chartType), ["choropleth"]);
  assert.equal(polygonDisplaySuggestions(suggestions.slice(0, 1)).length, 1);
  suggestions[1].available = false;
  assert.equal(polygonDisplaySuggestions(suggestions).length, 3);
  suggestions[1].repairable = true;
  assert.equal(polygonDisplaySuggestions(suggestions).length, 1);
  for (const chartType of ["point", "map_line", "hex_h3"]) {
    const other = [...suggestions, { id: "other-map", chartType, available: true }];
    other[1].id = "polygon";
    assert.equal(polygonDisplaySuggestions(other), other, "other map flows retain their existing default choices");
    assert.equal(polygonDisplaySuggestions(other, "other-map"), other);
    assert.equal(polygonDisplaySuggestions(other, "polygon").some(item => item.chartType === "line"), false);
  }
});

test("popup uses only clicked region, full independent date range, zero and missing points", () => {
  const before = JSON.stringify(records);
  const result = chart("line");
  assert.equal(result.message, "");
  assert.deepEqual(result.config.data.map(row => row.temperature), [0, null, 30]);
  assert.equal(result.config.data.length, 3, "the feature's displayed date must not filter the chart");
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(normalizeBarChartConfig(chart("bar").config).data.map(row => row.temperature), [0, null, 30]);
  const selection = createPopupChartSelection(records, columns, "temperature", "line");
  assert.equal(selection.from, "2026-09-01T00:00:00.000Z");
  selection.from = "2026-09-03";
  assert.match(chart("line", { selection }).message, /hai mốc/);
  assert.deepEqual(chart("bar", { selection: { ...selection, metrics: ["temperature"], variant: "single", aggregation: "auto" } }).config.data,
    [{ date: "2026-09-03", temperature: 30 }]);
});

test("popup bar and line group repeated observations using the selected measure's aggregation", () => {
  const duplicated = [...records, { region: "A", date: new Date("2026-09-03"), temperature: 20, rain: 6 }];
  assert.equal(chart("line", { records: duplicated }).config.data.at(-1).temperature, 25);
  const selection = { ...createPopupChartSelection(records, columns, "rain", "bar"), variant: "grouped", metrics: ["temperature", "rain"] };
  const result = chart("bar", { records: duplicated, selection });
  assert.deepEqual(result.config.data.at(-1), { date: "2026-09-03", temperature: 25, rain: 10 });
  const normalized = normalizeBarChartConfig(result.config);
  assert.equal(normalized.data[1].temperature, null, "missing values are not converted into zero");
  assert.equal(chart("bar", { records: duplicated, selection: { ...selection, aggregation: "sum" } }).config.data.at(-1).temperature, 50);
});

test("polygon and inherited hex cells produce the same regional chart", () => {
  const cells = buildRegionHexGrid({ type: "FeatureCollection", features: [feature] }, 7).data;
  assert.ok(cells.features.length);
  assert.deepEqual(chart("line", { feature: cells.features[0] }).config, chart("line").config);
});

test("missing region, empty range and invalid measures return informative empty states", () => {
  assert.match(chart("bar", { feature: { properties: { region: "unknown" } } }).message, /Không có dữ liệu/);
  assert.match(chart("bar", { records: [] }).message, /Không có dữ liệu/);
  assert.match(chart("line", { selection: { measure: "absent" } }).message, /Chưa có chỉ số/);
  assert.match(chart("bar", { selection: { metrics: ["temperature"], from: "2027-01-01", to: "2027-01-02" } }).message, /khoảng thời gian/);
  assert.match(chart("line", { records: records.map(row => ({ ...row, temperature: null })) }).message, /Không có số liệu/);
  const unknown = columns.map(column => column.name === "temperature" ? { name: "value", role: "measure" } : column);
  assert.match(chart("line", { columns: unknown, records: [...records, records[0]].map(row => ({ ...row, value: row.temperature })),
    selection: { measure: "value" } }).message, /chưa xác định phép gộp/);
});

test("bar without time aggregates the region and line explains the missing time field", () => {
  const noTime = columns.filter(column => column.role !== "time");
  const result = chart("bar", { columns: noTime });
  assert.deepEqual(result.config.data, [{ region: "A", temperature: 15 }]);
  assert.match(chart("line", { columns: noTime }).message, /cột thời gian/);
});

test("bar popup retains distinct timestamps and formats hours and minutes", () => {
  const result = chart("bar", { records: [
    { region: "A", date: new Date("2026-09-01T01:00:00Z"), temperature: 20 },
    { region: "A", date: new Date("2026-09-01T08:30:00Z"), temperature: 30 }
  ] });
  assert.equal(result.config.data.length, 2);
  assert.notEqual(result.config.data[0].date, result.config.data[1].date);
  assert.equal(result.config.timeColumn.granularity, "datetime");
});

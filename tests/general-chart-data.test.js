import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as timeValues from "../src/time-values.js";
import { comparableFilterValue } from "../src/ai-data-analysis.js";
import { fallbackAnalysis } from "../src/ai-chart-contract.js";
import { buildBarChartOption, buildLineChartOption, evaluateSuggestion, normalizeBarSelection, prepareSuggestions } from "../src/ai-chart-pipeline.js";

const time = { name: "period", role: "time", granularity: "month" };
const line = { id: "line", chartType: "line", title: "L", bindings: { x: "period", y: ["score"] }, confidence: .9 };
const coverage = { period: 1, score: 1, product: 1 };

test("không thêm bar khi AI trả rỗng, có chiều nhóm khác, hoặc phép gộp chưa rõ", () => {
  const metric = { name: "score", role: "measure" };
  const records = [{ period: "T1", score: 1, product: "A" }, { period: "T2", score: 2, product: "B" }];
  assert.deepEqual(prepareSuggestions({ columns: [time, metric], suggestions: [], source: "ai" }, records, coverage), []);
  for (const role of ["category", "geo"]) {
    const suggestions = prepareSuggestions({ columns: [time, metric, { name: "product", role }], suggestions: [line] }, records, coverage);
    assert.equal(suggestions.some(item => item.chartType === "bar"), false);
  }
  const split = { ...line, bindings: { ...line.bindings, series: "product" } };
  assert.equal(prepareSuggestions({ columns: [time, metric], suggestions: [split] }, records, coverage).some(item => item.chartType === "bar"), false);
  const repeated = [...records, { period: "T1", score: 3 }];
  const suggestions = prepareSuggestions({ columns: [time, metric], suggestions: [line] }, repeated, coverage);
  assert.equal(suggestions.some(item => item.chartType === "bar"), false);
  assert.equal(suggestions[0].available, false);
  assert.match(suggestions[0].unavailableReason, /phép gộp/);
});

test("cột có chữ total phải bằng tổng thành phần cùng đơn vị mới được ưu tiên", () => {
  const columns = [time,
    { name: "east", role: "measure", unit: "VND", aggDefault: "sum" },
    { name: "west", role: "measure", unit: "VND", aggDefault: "sum" },
    { name: "total_rate", role: "measure", unit: "%", aggDefault: "mean" },
    { name: "total_other", role: "measure", unit: "VND", aggDefault: "sum" }
  ];
  const records = [{ period: "T1", east: 1, west: 2, total_rate: 3, total_other: 100 }, { period: "T2", east: 3, west: 4, total_rate: 7, total_other: 200 }];
  const analysis = { columns, suggestions: [{ ...line, bindings: { x: "period", y: ["east", "west"] } }] };
  const rates = Object.fromEntries(columns.map(column => [column.name, 1]));
  assert.equal(prepareSuggestions(analysis, records, rates).find(item => item.chartType === "bar").bindings.y, "east");
  const validTotal = records.map(record => ({ ...record, total_other: record.east + record.west }));
  assert.equal(prepareSuggestions(analysis, validTotal, rates).find(item => item.chartType === "bar").bindings.y, "total_other");
});

test("chuỗi dài giữ đủ kỳ và không tổng hợp thời gian thành Khác", () => {
  const columns = [{ name: "period", role: "time" }, { name: "score", role: "measure", aggDefault: "sum" }];
  const records = Array.from({ length: 40 }, (_, index) => ({ period: new Date(Date.UTC(2026, 0, index + 1)), score: 40 - index }));
  const bar = prepareSuggestions({ columns, suggestions: [line] }, records, coverage).find(item => item.chartType === "bar");
  assert.equal(buildBarChartOption(bar, records, columns).config.data.length, 40);
  const limited = buildBarChartOption(bar, records, columns, { top: 10 });
  assert.equal(limited.config.data.length, 10);
  assert.equal(limited.config.data.some(row => row.period === "Khác"), false);
});

test("lựa chọn giao diện giữ phép gộp riêng mỗi chỉ số và mặc định chọn cùng đơn vị", () => {
  const columns = [time,
    { name: "revenue", role: "measure", unit: "VND", aggDefault: "sum" },
    { name: "average_revenue", role: "measure", unit: "VND", aggDefault: "mean" },
    { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean" }
  ];
  const records = [{ period: "T1", revenue: 20, average_revenue: 20, temperature: 20 }, { period: "T1", revenue: 30, average_revenue: 30, temperature: 30 }];
  const suggestion = { id: "bar", chartType: "bar", title: "B", bindings: { x: "period", y: "temperature" }, agg: "mean" };
  const selection = normalizeBarSelection(suggestion, columns);
  assert.equal(selection.aggregation, "auto");
  assert.equal(buildBarChartOption(suggestion, records, columns, selection).config.data[0].temperature, 25);
  assert.equal(buildBarChartOption(suggestion, records, columns, { ...selection, aggregation: "sum" }).config.data[0].temperature, 50);
  const grouped = { ...suggestion, bindings: { x: "period", y: "revenue" }, agg: "sum" };
  const saved = normalizeBarSelection(grouped, columns, { variant: "grouped" });
  assert.deepEqual(saved.metrics, ["revenue", "average_revenue"]);
  assert.deepEqual(buildBarChartOption(grouped, records, columns, saved).config.data[0], { period: "T1", revenue: 50, average_revenue: 25 });
  const chart = buildLineChartOption({ ...grouped, bindings: { x: "period", y: ["revenue", "average_revenue", "temperature"] } }, records, columns);
  assert.deepEqual(chart.config.series.map(item => item.key), ["revenue", "average_revenue"]);
  assert.deepEqual(chart.config.data[0], { period: "T1", revenue: 50, average_revenue: 25 });
});

test("giữ giờ cùng ngày, không biến null thành zero, từ chối trộn kỳ lặp và ngày có năm", () => {
  const columns = [{ name: "period", role: "time" }, { name: "score", role: "measure", aggDefault: "sum" }];
  const suggestion = { ...line, chartType: "bar", bindings: { x: "period", y: "score" } };
  const records = [{ period: new Date("2026-01-01T08:00:00Z"), score: 1 }, { period: new Date("2026-01-01T09:00:00Z"), score: 2 }];
  assert.deepEqual(buildBarChartOption(suggestion, records, columns).config.data.map(row => row.period), records.map(record => record.period.toISOString()));
  assert.equal(evaluateSuggestion(suggestion, [records[0], { ...records[1], score: null }], columns, { period: 1, score: .5 }).available, false);
  assert.equal(evaluateSuggestion(suggestion, [records[0], { period: "T1", score: 2 }], columns, coverage).available, false);
  const chart = buildLineChartOption(line, [...records, { period: new Date("2026-01-01T10:00:00Z"), score: null }], columns);
  assert.equal(chart.config.data.length, 2);
  const days = [{ period: new Date("2026-01-01Z"), score: 1 }, { period: new Date("2026-01-02Z"), score: 2 }];
  const monthMetadata = [{ ...columns[0], granularity: "month" }, columns[1]];
  assert.equal(new Set(buildBarChartOption(suggestion, days, monthMetadata).config.data.map(row => row.period)).size, 2);
});

test("tỷ lệ dùng mean, chỉ số chưa rõ không tự có phép gộp, ID không thành thời gian", () => {
  const result = fallbackAnalysis({ rowCount: 2, columns: [
    { name: "revenue_rate", inferredType: "number", uniqueCount: 2 },
    { name: "Doanh thu", inferredType: "number", uniqueCount: 2 },
    { name: "measurement", inferredType: "number", uniqueCount: 2 },
    { name: "timestamp_id", inferredType: "number", uniqueCount: 2 }
  ] });
  assert.equal(result.columns[0].aggDefault, "mean");
  assert.equal(result.columns[1].aggDefault, "sum");
  assert.equal(result.columns[2].aggDefault, null);
  assert.equal(result.columns[3].role, "id");
});

test("giao diện dùng đúng cột thời gian đã bind và giữ aggregation tự động", () => {
  const element = () => ({ children: [], dataset: {}, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute() {} });
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({
    ...pipeline, ...timeValues, comparableFilterValue, Date,
    CONFIG: { DEFAULT_RESOLUTION: 6 }, DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {}, DEFAULT_POINT_STYLE: {},
    document: { getElementById: get, createElement: element },
    keepSelectOpenAfterMouseClick: value => value, humanizeField: value => value
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/export function createMapLayerRuntime\(options\) \{\nconst document = options.document;\nconst maplibregl = options.maplibregl \|\| globalThis.maplibregl;\n/, "const options = {};\n")
    .replace(/\/\/ Runtime public API[\s\S]*$/, "");
  vm.runInContext(source, context);
  const columns = [{ name: "otherDate", role: "time" }, time, { name: "score", role: "measure", aggDefault: "mean" }];
  context.dataset = {
    analysis: { columns },
    records: ["T10", "T2", "T1"].map((period, i) => ({ period, score: 20 + i, otherDate: new Date(Date.UTC(2026, 0, i + 1)) }))
  };
  context.line = line;
  context.option = buildLineChartOption(line, context.dataset.records, columns);
  vm.runInContext("state.aiDataset = dataset; populateAiLineSelection(option, line)", context);
  const ranges = get("ai-filter-controls").children.slice(-2).map(node => node.children[1]);
  assert.deepEqual(ranges[0].children.map(option => option.value), ["T1", "T2", "T10"]);
  assert.deepEqual(ranges[0].children.map(option => option.textContent), ["T1", "T2", "T10"]);
  const selection = vm.runInContext("barSelectionFor(dataset, {id: 'bar', bindings: {x: 'period', y: 'score'}})", context);
  assert.equal(selection.aggregation, "auto");
});

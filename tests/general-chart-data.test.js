import test from "node:test";
import assert from "node:assert/strict";
import { fallbackAnalysis } from "../src/shared/import/ai-chart-contract.js";
import { buildBarChartOption, buildLineChartOption, prepareSuggestions } from "../src/shared/import/ai-chart-pipeline.js";

const time = { name: "period", role: "time", granularity: "month" };
const line = { id: "line", chartType: "line", title: "L", bindings: { x: "period", y: ["score"] }, confidence: .9 };

test("không suy ra chỉ số total hoặc thêm biểu đồ ngoài quyết định AI", () => {
  const columns = [time,
    { name: "east", role: "measure", unit: "VND", aggDefault: "sum" },
    { name: "west", role: "measure", unit: "VND", aggDefault: "sum" },
    { name: "total_rate", role: "measure", unit: "%", aggDefault: "mean" },
    { name: "total_other", role: "measure", unit: "VND", aggDefault: "sum" }
  ];
  const records = [{ period: "T1", east: 1, west: 2, total_rate: 3, total_other: 100 }, { period: "T2", east: 3, west: 4, total_rate: 7, total_other: 200 }];
  const analysis = { columns, suggestions: [{ ...line, bindings: { x: "period", y: ["east", "west"] } }] };
  const rates = Object.fromEntries(columns.map(column => [column.name, 1]));
  assert.equal(prepareSuggestions(analysis, records, rates).some(item => item.chartType === "bar"), false);
  const validTotal = records.map(record => ({ ...record, total_other: record.east + record.west }));
  assert.equal(prepareSuggestions(analysis, validTotal, rates).some(item => item.chartType === "bar"), false);
});

test("chuỗi dài giữ đủ kỳ và không tổng hợp thời gian thành Khác", () => {
  const columns = [{ name: "period", role: "time" }, { name: "score", role: "measure", aggDefault: "sum" }];
  const records = Array.from({ length: 40 }, (_, index) => ({ period: new Date(Date.UTC(2026, 0, index + 1)), score: 40 - index }));
  const bar = { ...line, chartType: "bar", bindings: { x: "period", y: "score" } };
  assert.equal(buildBarChartOption(bar, records, columns).config.data.length, 40);
  const limited = buildBarChartOption(bar, records, columns, { top: 10 });
  assert.equal(limited.config.data.length, 10);
  assert.equal(limited.config.data.some(row => row.period === "Khác"), false);
});

test("giữ giờ cùng ngày và không biến null thành zero", () => {
  const columns = [{ name: "period", role: "time" }, { name: "score", role: "measure", aggDefault: "sum" }];
  const suggestion = { ...line, chartType: "bar", bindings: { x: "period", y: "score" } };
  const records = [{ period: new Date("2026-01-01T08:00:00Z"), score: 1 }, { period: new Date("2026-01-01T09:00:00Z"), score: 2 }];
  assert.deepEqual(buildBarChartOption(suggestion, records, columns).config.data.map(row => row.period), records.map(record => record.period.toISOString()));
  const chart = buildLineChartOption(line, [...records, { period: new Date("2026-01-01T10:00:00Z"), score: null }], columns);
  assert.equal(chart.config.data.length, 2);
  const days = [{ period: new Date("2026-01-01Z"), score: 1 }, { period: new Date("2026-01-02Z"), score: 2 }];
  const monthMetadata = [{ ...columns[0], granularity: "month" }, columns[1]];
  assert.equal(new Set(buildBarChartOption(suggestion, days, monthMetadata).config.data.map(row => row.period)).size, 2);
});

test("fallback không suy đoán phép gộp hay role dựa vào tên cột", () => {
  const result = fallbackAnalysis({ rowCount: 2, columns: [
    { name: "revenue_rate", inferredType: "number", uniqueCount: 2 },
    { name: "Doanh thu", inferredType: "number", uniqueCount: 2 },
    { name: "measurement", inferredType: "number", uniqueCount: 2 },
    { name: "timestamp_id", inferredType: "number", uniqueCount: 2 }
  ] });
  assert.equal(result.columns[0].aggDefault, null);
  assert.equal(result.columns[1].aggDefault, null);
  assert.equal(result.columns[2].aggDefault, null);
  assert.equal(result.columns[3].role, "ignore");
});

import test from "node:test";
import assert from "node:assert/strict";
import { chartTimeValue, compareTimeValues, filterTimeRange, formatTimeValue, normalizeTimeValue, timeValueInfo, uniqueTimeValues } from "../src/time-values.js";
import { normalizeTabularRecords, profileTabularData } from "../src/tabular-data.js";
import { fallbackAnalysis, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { buildBarChartOption, buildLineChartOption, defaultTimeFilter, prepareSuggestions } from "../src/ai-chart-pipeline.js";

const recurring = [
  ["month", ["T10", "T2", "T1"], ["T1", "T2", "T10"]],
  ["month", ["Tháng 12", "Tháng 2", "Tháng 1"], ["Tháng 1", "Tháng 2", "Tháng 12"]],
  ["month", ["Dec", "Feb", "Jan"], ["Jan", "Feb", "Dec"]],
  ["month", [12, 2, 1], [1, 2, 12]],
  ["quarter", ["Q4", "Q2", "Q1"], ["Q1", "Q2", "Q4"]],
  ["quarter", ["Quý 4", "Quý 2", "Quý 1"], ["Quý 1", "Quý 2", "Quý 4"]],
  ["week", ["W10", "W2", "W1"], ["W1", "W2", "W10"]]
];

test("các nhãn kỳ không có năm dùng chung thứ tự cho normalize, bar, line và range filter", () => {
  for (const [granularity, input, expected] of recurring) {
    const time = { name: "period", role: "time", timeParse: "text", granularity };
    const columns = [time, { name: "metric", role: "measure", aggDefault: "sum" }];
    const normalized = normalizeTabularRecords(input.map((period, i) => ({ period, metric: i + 1 })), columns);
    assert.equal(normalized.validRowRate.period, 1, String(input));
    assert.deepEqual(normalized.records.map(record => record.period), input);
    assert.deepEqual(uniqueTimeValues(normalized.records, time), expected);
    const line = { id: "line", chartType: "line", title: "Xu hướng", bindings: { x: "period", y: ["metric"] }, confidence: .9 };
    const suggestions = prepareSuggestions({ columns, suggestions: [line] }, normalized.records, normalized.validRowRate);
    assert.ok(suggestions.every(suggestion => suggestion.available));
    const bar = suggestions.find(suggestion => suggestion.chartType === "bar");
    assert.deepEqual(buildBarChartOption(bar, normalized.records, columns).config.data.map(row => row.period), expected.map(String));
    assert.deepEqual(buildLineChartOption(line, normalized.records, columns).config.data.map(row => row.period), expected.map(String));
    const filtered = filterTimeRange(normalized.records, time, String(expected[1]), String(expected[2]));
    assert.deepEqual(uniqueTimeValues(filtered, time), expected.slice(1));
    assert.deepEqual(uniqueTimeValues(filterTimeRange(normalized.records, time, String(expected[2]), String(expected[1])), time), expected.slice(1));
    const mapFilter = defaultTimeFilter(normalized.records, columns, "choropleth");
    assert.equal(mapFilter.default, String(expected[2]));
    assert.equal(mapFilter.control, "select");
  }
});

test("kỳ có năm, ngày Việt Nam, Excel và Unix có mốc chính xác và không mất giờ", () => {
  const cases = [
    ["2026-02", {}, "2026-02-01T00:00:00.000Z"],
    ["02/2026", {}, "2026-02-01T00:00:00.000Z"],
    ["Q2/2026", {}, "2026-04-01T00:00:00.000Z"],
    ["2026-Q2", {}, "2026-04-01T00:00:00.000Z"],
    ["2020-W53", {}, "2020-12-28T00:00:00.000Z"],
    ["Jan 2026", {}, "2026-01-01T00:00:00.000Z"],
    ["13/10/2026", { timeParse: "text" }, "2026-10-13T00:00:00.000Z"],
    ["2026-10-13T08:15:00Z", {}, "2026-10-13T08:15:00.000Z"],
    [46266, { timeParse: "excel_serial" }, "2026-09-01T00:00:00.000Z"],
    [1788220800, { timeParse: "unix_s" }, "2026-09-01T00:00:00.000Z"],
    [1788220800000, { timeParse: "unix_ms" }, "2026-09-01T00:00:00.000Z"],
    [2026, { granularity: "year" }, "2026-01-01T00:00:00.000Z"]
  ];
  for (const [input, column, iso] of cases) {
    assert.equal(normalizeTimeValue(input, column).toISOString(), iso, String(input));
    assert.equal(normalizeTimeValue(normalizeTimeValue(input, column), column).toISOString(), iso);
  }
  assert.equal(chartTimeValue(new Date("2026-04-01Z"), { granularity: "quarter" }), "Q2/2026");
  assert.equal(formatTimeValue("T1", { granularity: "month" }), "T1");
  assert.equal(formatTimeValue(1, { granularity: "month" }), "1");
});

test("từ chối thời gian không hợp lệ và không tự bịa thứ tự cho nhãn bất kỳ", () => {
  for (const value of ["T00", "T13", "Q5", "W54", "2021-W53", "W1/0000", "Jan 0000", "2026-02-30", "31/02/2026", "2026-01-01T25:00:00Z", "01/02/03", "foo", true, null, ""]) {
    assert.equal(normalizeTimeValue(value, { timeParse: "text" }), null, String(value));
  }
  assert.equal(timeValueInfo("T01").key, timeValueInfo("January").key);
  assert.ok(compareTimeValues("W2", "W10", { granularity: "week" }) < 0);
});

test("profile không cần gửi samples vẫn nhận diện được kỳ và giữ đúng granularity qua contract", () => {
  for (const [granularity, input] of recurring) {
    const records = input.map(period => ({ [granularity]: period, metric: 40_000 }));
    const profile = profileTabularData(records);
    assert.equal(profile.samplesIncluded, false);
    const column = profile.columns.find(item => item.name === granularity);
    assert.equal(column.dateHint, "text");
    assert.equal(column.temporalGranularity, granularity);
    const analysis = fallbackAnalysis(profile);
    assert.equal(analysis.columns[0].role, "time");
    assert.equal(analysis.columns[0].granularity, granularity);
    assert.equal(analysis.columns[1].role, "measure");
    const normalized = validateAndNormalizeAnalysis({ columns: [{ name: granularity, role: "time" }], suggestions: [] }, profile);
    assert.equal(normalized.columns[0].granularity, granularity);
    assert.equal(normalized.columns[0].timeParse, "text");
  }
});

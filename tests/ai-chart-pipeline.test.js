import test from "node:test";
import assert from "node:assert/strict";
import { buildBarChartOption, buildLineChartOption, evaluateSuggestion, withSuggestionMetric } from "../src/ai-chart-pipeline.js";

const columns = [
  { name: "date", role: "time" },
  { name: "province", role: "geo" },
  { name: "rain", role: "measure", aggDefault: "sum", unit: "mm" }
];

test("bar aggregate theo nhóm và gộp phần dư thành Khác", () => {
  const records = Array.from({ length: 15 }, (_, index) => ({ province: `P${index}`, rain: index + 1 }));
  const option = buildBarChartOption({ id: "bar", title: "Mưa", reason: "", bindings: { x: "province", y: "rain" }, agg: "sum" }, records, columns, { top: 3 });
  assert.equal(option.config.data.length, 4);
  assert.equal(option.config.data.at(-1).province, "Khác");
  assert.equal(option.config.data.at(-1).rain, 78);
});

test("line long format chỉ chọn năm series có nhiều điểm nhất và pivot đúng", () => {
  const records = [];
  for (let province = 0; province < 7; province++) {
    for (let day = 1; day <= 3; day++) records.push({ date: new Date(`2026-09-0${day}T00:00:00Z`), province: `P${province}`, rain: province + day });
  }
  const option = buildLineChartOption({ id: "line", title: "Mưa", reason: "", bindings: { x: "date", y: ["rain"], series: "province" }, agg: "sum" }, records, columns);
  assert.equal(option.config.series.length, 5);
  assert.equal(option.availableSeries.length, 7);
  assert.equal(option.config.data.length, 3);
  assert.equal(option.config.data[0].date, "2026-09-01");
});

test("line long format nhiều measure chỉ dựng chuỗi theo measure đang chọn", () => {
  const metricColumns = [
    { name: "date", role: "time", labelVi: "Ngày" },
    { name: "province", role: "geo", labelVi: "Tỉnh" },
    { name: "rain", role: "measure", labelVi: "Lượng mưa", aggDefault: "sum", unit: "mm" },
    { name: "temperature", role: "measure", labelVi: "Nhiệt độ trung bình", aggDefault: "mean", unit: "°C" }
  ];
  const records = [];
  for (let province = 0; province < 3; province++) {
    for (let day = 1; day <= 2; day++) records.push({
      date: new Date(`2026-09-0${day}T00:00:00Z`),
      province: `P${province}`,
      rain: province + day,
      temperature: 20 + province + day
    });
  }
  const suggestion = { id: "line", title: "Thời tiết", reason: "Lý do dài", bindings: { x: "date", y: ["rain", "temperature"], series: "province" }, agg: null };
  const initial = buildLineChartOption(suggestion, records, metricColumns);
  assert.equal(initial.availableSeries.length, 3);
  assert.deepEqual(initial.availableMeasures.map(item => item.key), ["rain", "temperature"]);
  assert.equal(initial.activeMeasure, "rain");
  assert.equal(initial.config.aggregation, "sum");

  const changed = buildLineChartOption(suggestion, records, metricColumns, { selectedSeries: ["P1", "P2"], measure: "temperature" });
  assert.deepEqual(changed.selectedSeries, ["P1", "P2"]);
  assert.equal(changed.activeMeasure, "temperature");
  assert.equal(changed.config.aggregation, "mean");
  assert.equal(changed.config.title, "Nhiệt độ trung bình theo ngày");
  assert.equal(changed.config.subtitle, "2/3 chuỗi · 2026-09-01 – 2026-09-02");
  assert.equal(changed.config.unit, "°C");
  assert.equal(changed.config.data[0].P1, 22);
});

test("feasibility kết hợp coverage với confidence và khóa line chỉ có một mốc", () => {
  const result = evaluateSuggestion(
    { id: "line", chartType: "line", title: "L", bindings: { x: "date", y: ["rain"] }, confidence: .9 },
    [{ date: new Date(), rain: 1 }], columns, { date: 1, rain: 1 }
  );
  assert.equal(result.available, false);
  assert.equal(result.effectiveConfidence, .74);
});

test("H3 bị khóa nếu các điểm hợp lệ chỉ tạo thành một cell", () => {
  const result = evaluateSuggestion(
    { id: "h3", chartType: "hex_h3", title: "H3", bindings: { lat: "lat", lng: "lng", value: "rain" }, confidence: .9 },
    [{ lat: 21.0285, lng: 105.8542, rain: 1 }, { lat: 21.02851, lng: 105.85421, rain: 2 }],
    [{ name: "lat", role: "geo" }, { name: "lng", role: "geo" }, { name: "rain", role: "measure" }],
    { lat: 1, lng: 1, rain: 1 }
  );
  assert.equal(result.available, false);
  assert.match(result.unavailableReason, /hai ô H3/);
});

test("đổi chỉ số cập nhật phép gộp và tiêu đề cho bar, polygon và H3", () => {
  const metricColumns = [
    ...columns,
    { name: "temperature", role: "measure", aggDefault: "mean", labelVi: "Nhiệt độ trung bình", unit: "°C" }
  ];
  for (const chartType of ["bar", "choropleth", "hex_h3"]) {
    const original = { id: chartType, chartType, title: "Lượng mưa", agg: "sum", bindings: chartType === "bar"
      ? { x: "province", y: "rain" }
      : chartType === "choropleth" ? { region: "province", value: "rain" } : { lat: "lat", lng: "lng", value: "rain" } };
    const changed = withSuggestionMetric(original, "temperature", metricColumns);
    assert.equal(changed.agg, "mean");
    assert.match(changed.title, /^Nhiệt độ trung bình theo /);
    assert.equal(original.agg, "sum");
    assert.equal(original.bindings[chartType === "bar" ? "y" : "value"], "rain");
    if (chartType === "bar") {
      const option = buildBarChartOption(changed, [
        { province: "A", temperature: 20 }, { province: "A", temperature: 30 }
      ], metricColumns);
      assert.equal(option.config.data[0].temperature, 25);
      assert.equal(option.config.title, changed.title);
      assert.equal(option.config.unit, "°C");
    }
    assert.equal(withSuggestionMetric(changed, "rain", metricColumns).agg, "sum");
  }
});

test("đổi từ đếm sang chỉ số dùng lại phép gộp của cột mới", () => {
  const original = { chartType: "bar", bindings: { x: "province", y: "rain" }, agg: "sum" };
  const counted = withSuggestionMetric(original, "count", columns);
  assert.equal(counted.agg, "count");
  assert.match(counted.title, /^Số bản ghi theo /);
  assert.equal(withSuggestionMetric(counted, "rain", columns).agg, "sum");
});

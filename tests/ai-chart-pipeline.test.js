import test from "node:test";
import assert from "node:assert/strict";
import { buildBarChartOption, buildLineChartOption, evaluateSuggestion } from "../src/ai-chart-pipeline.js";

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

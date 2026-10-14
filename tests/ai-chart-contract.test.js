import test from "node:test";
import assert from "node:assert/strict";
import { fallbackAnalysis, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";

const profile = {
  rowCount: 2,
  columns: [
    { name: "province", inferredType: "text", uniqueCount: 2 },
    { name: "date", inferredType: "date", dateHint: "iso", uniqueCount: 2 },
    { name: "temperature", inferredType: "number", uniqueCount: 2 },
    { name: "note", inferredType: "text", uniqueCount: 2 }
  ]
};

test("validator loại cột lạ/trùng, bù cột thiếu và chỉ loại suggestion lỗi", () => {
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Thời tiết",
    grain: "một tỉnh một ngày",
    columns: [
      { name: "province", role: "unknown" },
      { name: "province", role: "geo", geoLevel: "admin1", country: "VN" },
      { name: "province", role: "text" },
      { name: "date", role: "time", timeParse: "iso", granularity: "day" },
      { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean" },
      { name: "hallucinated", role: "measure" }
    ],
    suggestions: [
      { id: "map", chartType: "choropleth", title: "Nhiệt độ", bindings: { region: "province", value: "temperature" }, confidence: .9, reason: "phù hợp" },
      { id: "bad", chartType: "line", title: "Sai", bindings: { x: "missing", y: ["temperature"] }, confidence: .9, reason: "sai cột" }
    ]
  }, profile);
  assert.deepEqual(result.columns.map(column => column.name), profile.columns.map(column => column.name));
  assert.equal(result.columns.find(column => column.name === "province").role, "geo");
  assert.equal(result.columns.find(column => column.name === "note").source, "rule");
  assert.deepEqual(result.suggestions.map(item => item.id), ["map"]);
  assert.ok(result.validationErrors.length >= 3);
});

test("fallback dùng cùng AnalysisResult và không biến id thành measure", () => {
  const result = fallbackAnalysis({
    rowCount: 2,
    columns: [
      { name: "region", inferredType: "text", uniqueCount: 2 },
      { name: "station_id", inferredType: "number", uniqueCount: 2 },
      { name: "total", inferredType: "number", uniqueCount: 2 }
    ]
  });
  assert.equal(result.columns.find(column => column.name === "station_id").role, "id");
  assert.equal(result.columns.find(column => column.name === "total").aggDefault, "sum");
  assert.ok(result.suggestions.some(item => item.chartType === "choropleth"));
  assert.equal(validateAndNormalizeAnalysis(result, {
    rowCount: 2,
    columns: [
      { name: "region", inferredType: "text", uniqueCount: 2 },
      { name: "station_id", inferredType: "number", uniqueCount: 2 },
      { name: "total", inferredType: "number", uniqueCount: 2 }
    ]
  }).source, "rule");
});

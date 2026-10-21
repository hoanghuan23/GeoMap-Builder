import test from "node:test";
import assert from "node:assert/strict";
import { displayFilterValue, fallbackMapRecommendation, requestAiDataAnalysis, summarizeTabularData } from "../src/ai-data-analysis.js";

const records = [
  { "Tỉnh/thành phố": "Hà Nội", "Ngày": new Date("2026-09-01T00:00:00Z"), "Nhiệt độ trung bình": 29.4, "Độ ẩm": 70 },
  { "Tỉnh/thành phố": "Đà Nẵng", "Ngày": new Date("2026-09-01T00:00:00Z"), "Nhiệt độ trung bình": 30.1, "Độ ẩm": 74 }
];

test("tóm tắt bảng dữ liệu mà không gửi toàn bộ workbook", () => {
  const summary = summarizeTabularData(records);
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.columns.find(column => column.name === "Ngày").inferredType, "date");
  assert.equal(summary.samples[0]["Ngày"], "2026-09-01");
});

test("rule fallback nhận diện địa phương, thời gian và metric", () => {
  const recommendation = fallbackMapRecommendation(records);
  assert.equal(recommendation.visualization, "polygon");
  assert.deepEqual(recommendation.geometry, { field: "Tỉnh/thành phố", provider: "maptiler", placeType: "region", country: "VNM" });
  assert.equal(recommendation.metricField, "Nhiệt độ trung bình");
  assert.deepEqual(recommendation.numericFields, ["Nhiệt độ trung bình", "Độ ẩm"]);
  assert.deepEqual(recommendation.filters, [
    { field: "Tỉnh/thành phố", label: "Tỉnh/thành phố", control: "select", allowAll: true },
    { field: "Ngày", label: "Ngày", control: "date-select", allowAll: false }
  ]);
});

test("không sinh option thời gian khi dataset không có chiều thời gian", () => {
  const recommendation = fallbackMapRecommendation([
    { province: "A", population: 10 },
    { province: "B", population: 20 }
  ]);
  assert.deepEqual(recommendation.filters.map(filter => filter.field), ["province"]);
});

test("định dạng filter thời gian dựa trên spec thay vì tên cột", () => {
  assert.equal(displayFilterValue("2026-09-01", "date-select"), "01/09/2026");
  assert.equal(displayFilterValue("Ca sáng", "select"), "Ca sáng");
});

test("client không tự tạo đề xuất dự phòng khi AI trả danh sách rỗng", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ datasetTitle: "Dữ liệu", grain: "một tỉnh một ngày", columns: [], suggestions: [], source: "ai" }) };
  };
  try {
    const result = await requestAiDataAnalysis(records);
    assert.equal(result.analysis.source, "ai");
    assert.deepEqual(result.analysis.suggestions, []);
    assert.equal(result.fallbackReason, "");
    assert.equal(result.records.length, records.length);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

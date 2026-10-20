import test from "node:test";
import assert from "node:assert/strict";
import { displayFilterValue, fallbackMapRecommendation, requestAiDataAnalysis, requestAiPolygonLegends, summarizeTabularData } from "../src/ai-data-analysis.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";

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
  assert.deepEqual(recommendation.geometry, { field: "Tỉnh/thành phố", provider: "maptiler", placeType: "region" });
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

const summaryPayload = () => ({
  targets: [{ field: "temperature", aggregation: "mean", unit: "°C", unitSource: "explicit",
    renderStatistics: { min: 25, max: 34, mean: 29.5, p10: 25.9, p50: 29.5, p90: 33.1, validCount: 2, missingCount: 0 } }],
  context: { regionField: "province", matchedRegionCount: 2, filters: {}, timeRange: null }, records: ["private"]
});

test("legend client sends a summary-only batch and revalidates server output", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1; assert.equal(url, "/api/ai/recommend-polygon-legends");
    assert.equal(options.body.includes("private"), false);
    return { ok: true, json: async () => ({ legends: [legendFixture({ stops: [] })] }) };
  };
  try {
    const result = await requestAiPolygonLegends(summaryPayload());
    assert.deepEqual(result.legends, []); assert.ok(result.validationErrors.length); assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("legend request has a deadline, supports cancellation and never retries failed requests", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    return new Promise((_, reject) => {
      const abort = () => { const error = new Error("Aborted"); error.name = "AbortError"; reject(error); };
      if (options.signal.aborted) abort(); else options.signal.addEventListener("abort", abort, { once: true });
    });
  };
  try {
    await assert.rejects(requestAiPolygonLegends(summaryPayload(), { timeoutMs: 5 }), /quá thời gian/);
    const controller = new AbortController();
    const pending = requestAiPolygonLegends(summaryPayload(), { signal: controller.signal }); controller.abort();
    await assert.rejects(pending, error => error.name === "AbortError");
    assert.equal(calls, 2);
    globalThis.fetch = async () => { calls += 1; return { ok: false, json: async () => ({ error: "No AI" }) }; };
    await assert.rejects(requestAiPolygonLegends(summaryPayload()), /No AI/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = originalFetch; }
});

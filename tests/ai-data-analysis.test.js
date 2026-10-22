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

test("fallback does not infer a map from recognizable column names", () => {
  assert.equal(fallbackMapRecommendation(records), null);
  assert.equal(fallbackMapRecommendation([{ province: "A", population: 10 }]), null);
});

test("định dạng filter thời gian dựa trên spec thay vì tên cột", () => {
  assert.equal(displayFilterValue("2026-09-01", "date-select"), "01/09/2026");
  assert.equal(displayFilterValue("Ca sáng", "select"), "Ca sáng");
});

test("client không tự tạo đề xuất dự phòng khi AI trả danh sách rỗng", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const { profile } = JSON.parse(options.body);
    assert.equal(profile.samplesIncluded, true);
    assert.equal(profile.head.length, records.length);
    assert.equal(profile.head[0]["Tỉnh/thành phố"], "Hà Nội");
    assert.ok(profile.columns.every(column => column.samples.length > 0));
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

test("tắt gửi mẫu vẫn giữ metadata và không gửi samples/head", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const { profile } = JSON.parse(options.body);
    assert.equal(profile.samplesIncluded, false);
    assert.equal("head" in profile, false);
    assert.ok(profile.columns.every(column => !("samples" in column)));
    return { ok: true, json: async () => ({ columns: [], suggestions: [], source: "ai" }) };
  };
  try { await requestAiDataAnalysis(records, { includeSamples: false }); }
  finally { globalThis.fetch = originalFetch; }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fallbackAnalysis, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { displayFilterValue, requestAiDataAnalysis } from "../src/ai-data-analysis.js";
import { buildBarChartOption, buildLineChartOption, prepareSuggestions } from "../src/ai-chart-pipeline.js";
import { formatLineX } from "../src/charts/line-chart.js";
import { readMetroData } from "../src/metro-data.js";
import { parseSpreadsheetBuffer } from "../src/tabular-parser.js";
import { profileTabularData } from "../src/tabular-data.js";
import { parseSpreadsheetFile, profileRecordsInWorker } from "../src/tabular-worker-client.js";
import { createRoadTrafficWorkbook, trafficAiAnalysis, trafficRecords, TRAFFIC_SPEED, TRAFFIC_TIMES } from "./fixtures/road-traffic-fixture.js";

function uploadHarness() {
  const context = vm.createContext({
    CONFIG: { DEFAULT_RESOLUTION: 6 }, DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {}, DEFAULT_POINT_STYLE: {},
    document: { getElementById: () => ({ checked: false }) },
    parseSpreadsheetFile, profileRecordsInWorker, requestAiDataAnalysis, readMetroData,
    recordsToPointGeoJSON() { throw new Error("No coordinates"); }
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "")
    .replace(/\binit\(\);\s*$/, "");
  vm.runInContext(source, context);
  return context;
}

test("traffic XLSX và JSON đi qua API AI chung, đề xuất tuyến bản đồ/Line/Bar và giữ ba mốc giờ", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/ai/analyze-map-data");
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => trafficAiAnalysis };
  };
  try {
    const buffer = createRoadTrafficWorkbook();
    for (const file of [
      { name: "giao-thong.xlsx", arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) },
      { name: "giao-thong.json", text: async () => JSON.stringify(trafficRecords) }
    ]) {
      const context = uploadHarness();
      context.file = file;
      const result = await vm.runInContext("readSpatialFile(file)", context);
      assert.equal(result.kind, "ai-pipeline");
      const { analysis, records, validRowRate } = result.pipeline;
      assert.equal(analysis.source, "ai");
      assert.equal(records.length, trafficRecords.length);
      const suggestions = prepareSuggestions(analysis, records, validRowRate);
      assert.deepEqual(suggestions.map(item => item.chartType), ["map_line", "line", "bar"]);
      assert.ok(suggestions.every(item => item.available));
      const line = buildLineChartOption(suggestions.find(item => item.chartType === "line"), records, analysis.columns, { selectedSeries: ["Đường Lĩnh Nam"] });
      assert.deepEqual(line.config.data.map(row => row["Thời điểm"]), TRAFFIC_TIMES.map(time => new Date(`2026-10-13 ${time}`).toISOString()));
      assert.deepEqual(line.config.data.map(row => row["Đường Lĩnh Nam"]), [24, 20, 38]);
      assert.equal(line.availableSeries.length, 84);
      const labels = line.config.data.map(row => formatLineX(row["Thời điểm"]));
      assert.deepEqual(labels, TRAFFIC_TIMES.map(time => `13/10 ${time}`));
      const bar = buildBarChartOption(suggestions.find(item => item.chartType === "bar"), records, analysis.columns, { top: "all" });
      assert.equal(bar.config.data.length, 84);
      assert.equal(bar.config.data.find(row => row["Tên đường"] === "Đường Lĩnh Nam")[TRAFFIC_SPEED], 82 / 3);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].source.sheetName, "Ùn tắc");
    assert.equal(calls[0].profile.rowCount, trafficRecords.length);
    assert.equal(calls[0].profile.samplesIncluded, false);
    assert.ok(!("head" in calls[0].profile));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tên đường có hơn 80 giá trị vẫn là chiều phân nhóm, không bị hiểu thành vùng hành chính", () => {
  const { profile } = parseSpreadsheetBuffer(createRoadTrafficWorkbook());
  const fallback = fallbackAnalysis({ ...profile, columns: [...profile.columns].reverse() });
  assert.equal(fallback.columns.find(column => column.name === "Tên đường").role, "category");
  assert.equal(fallback.suggestions.find(item => item.chartType === "line").bindings.series, "Tên đường");
  assert.equal(fallback.suggestions.find(item => item.chartType === "bar").bindings.x, "Tên đường");
  for (const role of ["text", "geo"]) {
    const analysis = validateAndNormalizeAnalysis({ ...trafficAiAnalysis, columns: [
      ...trafficAiAnalysis.columns.filter(column => column.name !== "Tên đường"),
      { name: "Tên đường", role, geoLevel: "admin2", country: "VN" }
    ] }, profile);
    assert.equal(analysis.columns.find(column => column.name === "Tên đường").role, "category");
    assert.equal(analysis.columns.find(column => column.name === "Tên đường").geoLevel, null);
    assert.equal(analysis.suggestions.length, 3);
  }
});

test("nhãn trục, tooltip và bộ lọc giữ giờ phút mà vẫn giữ định dạng dữ liệu theo ngày", () => {
  for (const time of TRAFFIC_TIMES) {
    const date = new Date(`2026-10-13 ${time}`);
    assert.equal(formatLineX(date.toISOString(), true), `13/10/2026 ${time}`);
    assert.ok(displayFilterValue(date, "datetime-select").includes(time));
    assert.ok(displayFilterValue(date.toISOString(), "datetime-select").includes(time));
  }
  assert.equal(formatLineX("2026-10-13"), "13/10");
  assert.equal(formatLineX("2026-10-13", true), "13/10/2026");
  assert.equal(formatLineX("2026-10"), "10/2026");
  const instant = new Date("2026-10-13T08:15:00Z");
  const profile = profileTabularData([{ "Thời điểm": instant }], { includeSamples: true });
  assert.equal(profile.head[0]["Thời điểm"], instant.toISOString());
});

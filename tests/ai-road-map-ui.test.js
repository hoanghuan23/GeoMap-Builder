import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as roadMap from "../src/road-map-data.js";
import { AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { displayFilterValue, comparableFilterValue } from "../src/ai-data-analysis.js";

const roads = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Đường A" },
  geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] } }] };
const columns = [{ name: "Tên đường", role: "category" }, { name: "Thời điểm", role: "time" },
  { name: "Tốc độ", role: "measure", aggDefault: "mean" }];

function harness(fetchImpl = async () => ({ ok: true, json: async () => roads })) {
  const elements = new Map(); const sources = new Map(); const layers = new Map();
  const element = () => ({
    checked: true, hidden: false, value: "", textContent: "", style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
    setAttribute() {}, addEventListener() {}
  });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id), resize() {}, fitBounds() {},
    setPaintProperty(id, field, value) { layers.get(id).paint[field] = value; },
    setLayoutProperty(id, field, value) { layers.get(id).layout[field] = value; }
  };
  for (const id of ["line-data", "h3-grid", "point-data", "polygon-data", "vietnam-boundary"]) sources.set(id, { data: null, setData(data) { this.data = data; } });
  layers.set("data-lines", { layout: {}, paint: {} });
  get("opacity").value = ".72";
  const context = vm.createContext({
    ...pipeline, ...roadMap, AI_CHART_REGISTRY, displayFilterValue, comparableFilterValue,
    CONFIG: { DEFAULT_RESOLUTION: 5 }, DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {}, DEFAULT_POINT_STYLE: {},
    roadNetworkUrl: id => ["hanoi", "da_nang"].includes(id) ? `/roads/${id}.json` : null,
    keepSelectOpenAfterMouseClick: value => value, humanizeField: value => value,
    renderMapIcon() {}, renderChartIcon() {}, clearBarStylePanel() {}, clearPieStylePanel() {},
    fetch: fetchImpl, AbortController, Date, console,
    setTimeout() { return 0; }, clearTimeout() {},
    document: { getElementById: get, createElement: element, querySelector: element,
      querySelectorAll: selector => selector === "#ai-filter-controls .ai-generated-filter"
        ? descendants(get("ai-filter-controls")).filter(node => node.className === "ai-generated-filter") : [] },
    maplibregl: { LngLatBounds: class { extend() { return this; } } }
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/\binit\(\);\s*$/, "");
  vm.runInContext(source, context);
  context.testMap = map; context.testColumns = columns;
  vm.runInContext(`map = testMap; state.aiDataset = {
    records: [
      { 'Tên đường': 'Đường A', 'Thời điểm': new Date('2026-10-13T01:00:00Z'), 'Tốc độ': 20 },
      { 'Tên đường': 'Đường A', 'Thời điểm': new Date('2026-10-13T15:00:00Z'), 'Tốc độ': 40 }
    ], analysis: { columns: testColumns, source: 'ai' },
    suggestions: [{ id: 'roads', chartType: 'map_line', available: true, effectiveConfidence: .95,
      bindings: { region: 'Tên đường', value: 'Tốc độ' } }],
    selectedSuggestionId: 'roads', roadNetwork: 'hanoi'
  };`, context);
  return { context, get, sources, layers, filters: () => descendants(get("ai-filter-controls")).filter(node => node.className === "ai-generated-filter") };
}

test("AI map_line dùng bộ lọc chung, đổi giờ, ẩn/hiện và dọn dữ liệu khi chuyển biểu đồ", async () => {
  let calls = 0;
  const { context, get, sources, layers, filters } = harness(async () => { calls++; return { ok: true, json: async () => roads }; });
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  assert.equal(calls, 1);
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 40);
  assert.equal(layers.get("data-lines").layout.visibility, "visible");
  assert.equal(get("ai-line-legend").hidden, false);
  assert.equal(get("metro-time-section").hidden, true);
  assert.equal(get("ai-data-filters").hidden, false);
  assert.equal(get("line-toggle-label").textContent, "Hiển thị tuyến đường");
  filters().find(control => control.dataset.field === "Thời điểm").value = "2026-10-13T01:00:00.000Z";
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 20);
  get("show-map-lines").checked = false;
  vm.runInContext("applyMapLayerVisibility()", context);
  assert.equal(layers.get("data-lines").layout.visibility, "none");
  assert.equal(get("ai-line-legend").hidden, true);
  get("show-map-lines").checked = true;
  vm.runInContext("clearMapForAiChart(); state.mapType = 'line-chart'; updateModelSections();", context);
  assert.equal(sources.get("line-data").data.features.length, 0);
  assert.equal(get("ai-line-legend").hidden, true);
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  assert.equal(calls, 1, "reuse the loaded road geometry");
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 20);
});

test("mạng đường chưa xác định/không khớp hoặc tải lỗi không tạo tuyến giả", async () => {
  const { context, get, sources } = harness(async () => { throw new Error("offline"); });
  vm.runInContext("state.aiDataset.roadNetwork = null", context);
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  assert.match(get("status").textContent, /Chọn mạng đường/);
  assert.equal(sources.get("line-data").data.features.length, 0);
  vm.runInContext("state.aiDataset.roadNetwork = 'hanoi'", context);
  await vm.runInContext("loadAiRoadNetwork()", context);
  assert.match(get("status").textContent, /offline/);
  assert.equal(sources.get("line-data").data.features.length, 0);
  context.fetch = async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) });
  await vm.runInContext("loadAiRoadNetwork()", context);
  assert.match(get("status").textContent, /Không có tuyến khớp/);
  assert.equal(sources.get("line-data").data.features.length, 0);
});

test("kết quả tải mạng đường cũ không được ghi đè sau khi đổi kiểu hoặc xóa file", async () => {
  for (const action of ["state.aiDataset.selectedSuggestionId = 'temporal'; state.mapType = 'temporal'; cancelAiBoundaryLoad();", "clearAiMapState();"]) {
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    const { context, sources, get } = harness(() => pending);
    const task = vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
    vm.runInContext(action, context);
    complete({ ok: true, json: async () => roads });
    assert.equal(await task, null);
    assert.equal(sources.get("line-data").data.features.length, 0);
    assert.equal(get("ai-line-legend").hidden, true);
  }
});

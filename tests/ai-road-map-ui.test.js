import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as popupChart from "../src/ai-popup-chart.js";
import * as coordinates from "../src/coordinate-data.js";
import * as roadMap from "../src/road-map-data.js";
import * as timeValues from "../src/time-values.js";
import { AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { displayFilterValue, comparableFilterValue } from "../src/ai-data-analysis.js";

const roads = { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Đường A" },
  geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] } }] };
const columns = [{ name: "Khu vực", role: "geo", geoLevel: "admin1" },
  { name: "Tên đường", role: "category" }, { name: "Thời điểm", role: "time" },
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
    ...pipeline, ...popupChart, ...coordinates, ...roadMap, ...timeValues, AI_CHART_REGISTRY, displayFilterValue, comparableFilterValue,
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
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/export function createMapLayerRuntime\(options\) \{\nconst document = options.document;\nconst maplibregl = options.maplibregl \|\| globalThis.maplibregl;\n/, "const options = {};\n")
    .replace(/\/\/ Runtime public API[\s\S]*$/, "");
  vm.runInContext(source, context);
  context.testMap = map; context.testColumns = columns;
  vm.runInContext(`map = testMap; state.aiDataset = {
    records: [
      { 'Khu vực': 'Hà Nội', 'Tên đường': 'Đường A', 'Thời điểm': new Date('2026-10-13T01:00:00Z'), 'Tốc độ': 20 },
      { 'Khu vực': 'Hà Nội', 'Tên đường': 'Đường A', 'Thời điểm': new Date('2026-10-13T15:00:00Z'), 'Tốc độ': 40 }
    ], analysis: { columns: testColumns, source: 'ai' },
    suggestions: [{ id: 'roads', chartType: 'map_line', available: true, effectiveConfidence: .95,
      bindings: { region: 'Tên đường', value: 'Tốc độ' } }],
    selectedSuggestionId: 'roads', roadGeometries: {}
  };`, context);
  return { context, get, sources, layers, descendants, filters: () => descendants(get("ai-filter-controls")).filter(node => node.className === "ai-generated-filter") };
}

test("AI map_line dùng bộ lọc chung, đổi giờ, ẩn/hiện và dọn dữ liệu khi chuyển biểu đồ", async () => {
  let calls = 0;
  const { context, get, sources, layers, descendants, filters } = harness(async () => { calls++; return { ok: true, json: async () => roads }; });
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  assert.equal(calls, 1);
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 40);
  assert.equal(layers.get("data-lines").layout.visibility, "visible");
  assert.equal(get("ai-line-legend").hidden, false);
  assert.equal(get("style-section").hidden, false);
  assert.equal(get("road-style-controls").hidden, false);
  assert.equal(get("map-style-controls").hidden, true);
  assert.equal(get("style-description").textContent, "Màu sắc, độ dày, độ mờ và chú giải tuyến");
  assert.equal(get("line-toggle-field").hidden, true);
  assert.equal(get("metro-time-section").hidden, true);
  assert.equal(get("ai-data-filters").hidden, false);
  assert.equal(descendants(get("ai-filter-controls")).some(node => node.className === "ai-road-network-selector"), false);
  const areaFilters = filters().filter(control => control.dataset.field === "Khu vực");
  assert.equal(areaFilters.length, 1);
  assert.equal(areaFilters[0].value, "Hà Nội");
  assert.equal(areaFilters[0].checked, false);
  assert.equal(get("line-toggle-label").textContent, "Hiển thị tuyến đường");
  filters().find(control => control.dataset.field === "Thời điểm").value = "2026-10-13T01:00:00.000Z";
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 20);
  get("show-map-lines").checked = false;
  vm.runInContext("applyMapLayerVisibility()", context);
  assert.equal(layers.get("data-lines").layout.visibility, "visible", "mạng lưới dùng công tắc lớp bản đồ chung");
  assert.equal(get("ai-line-legend").hidden, false, "chú giải không phụ thuộc công tắc tuyến đã ẩn");
  get("show-map-layers").checked = false;
  vm.runInContext("applyMapLayerVisibility()", context);
  assert.equal(layers.get("data-lines").layout.visibility, "none");
  assert.equal(get("ai-line-legend").hidden, true);
  get("show-map-layers").checked = true;
  get("show-map-lines").checked = true;
  vm.runInContext("clearMapForAiChart(); state.mapType = 'line-chart'; updateModelSections();", context);
  assert.equal(sources.get("line-data").data.features.length, 0);
  assert.equal(get("ai-line-legend").hidden, true);
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  assert.equal(calls, 1, "reuse the loaded road geometry");
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 20);
});

test("style mạng lưới cập nhật độ dày, độ mờ và chú giải", async () => {
  const { context, get, layers, descendants } = harness();
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  const colors = descendants(get("road-style-colors")).filter(node => node.className === "road-style-color");
  assert.equal(colors.length, 1);
  vm.runInContext("state.roadDisplayStyle = { width: 5.5, opacity: .4, showLegend: false }; applyStyle()", context);
  assert.equal(layers.get("data-lines").paint["line-width"], 5.5);
  assert.equal(layers.get("data-lines").paint["line-opacity"], .4);
  assert.equal(get("ai-line-legend").hidden, true);
});

test("nhiều Khu vực có bộ lọc mặc định tất cả và cập nhật tuyến theo lựa chọn", async () => {
  let calls = 0;
  const { context, sources, filters } = harness(async () => { calls++; return { ok: true, json: async () => roads }; });
  vm.runInContext(`state.aiDataset.records.push(
    { 'Khu vực': 'Đà Nẵng', 'Tên đường': 'Đường A', 'Thời điểm': new Date('2026-10-13T01:00:00Z'), 'Tốc độ': 30 },
    { 'Khu vực': 'Đà Nẵng', 'Tên đường': 'Đường A', 'Thời điểm': new Date('2026-10-13T15:00:00Z'), 'Tốc độ': 50 }
  )`, context);
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
  const areas = filters().filter(control => control.dataset.field === "Khu vực");
  assert.equal(areas.length, 2);
  assert.ok(areas.every(control => control.type === "checkbox" && !control.checked));
  assert.ok(areas.every(control => control.dataset.singleToggle === "true"));
  assert.equal(calls, 2);
  assert.equal(sources.get("line-data").data.features.length, 2);
  const daNang = areas.find(control => control.value === "Đà Nẵng");
  daNang.checked = true;
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(sources.get("line-data").data.features.length, 1);
  assert.equal(sources.get("line-data").data.features[0].properties["Khu vực"], "Đà Nẵng");
  assert.equal(sources.get("line-data").data.features[0].properties["Tốc độ"], 50);
  daNang.checked = false;
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(sources.get("line-data").data.features.length, 2);
});

test("Khu vực thiếu/không hỗ trợ hoặc tải lỗi không tạo tuyến giả", async () => {
  const missing = harness();
  vm.runInContext("state.aiDataset.analysis.columns = testColumns.filter(column => column.name !== 'Khu vực')", missing.context);
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", missing.context);
  assert.match(missing.get("status").textContent, /Cần cột Khu vực/);
  assert.equal(missing.sources.get("line-data").data.features.length, 0);

  const unsupported = harness();
  vm.runInContext("state.aiDataset.records.forEach(row => row['Khu vực'] = 'Chưa hỗ trợ')", unsupported.context);
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", unsupported.context);
  assert.match(unsupported.get("status").textContent, /Không nhận diện được mạng đường/);
  assert.equal(unsupported.sources.get("line-data").data.features.length, 0);

  const { context, get, sources } = harness(async () => { throw new Error("offline"); });
  await vm.runInContext("activateAiRoadMap(state.aiDataset.suggestions[0])", context);
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as metro from "../src/metro-data.js";
import * as capabilities from "../src/data-capabilities.js";
import * as polygonStyle from "../src/renderers/polygon-style.js";
import { PolygonRenderer } from "../src/renderers/polygon-renderer.js";
import * as profile from "../src/analysis/data-profile.js";
import * as engine from "../src/analysis/plan-engine.js";
import { analyzeBarData } from "../src/charts/bar-chart.js";
import { createBarOptions, dataForBarMapping } from "../src/charts/data-transformers.js";
import { createLineOption } from "../src/charts/line-chart.js";
import { createPieOptions } from "../src/charts/pie-chart.js";

// Exercise the actual upload and UI handlers with a MapLibre/DOM adapter.
function createHarness(overrides = {}) {
  const elements = new Map();
  const element = () => ({
    checked: true, hidden: false, value: "", textContent: "", style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {}, events: {}, addEventListener(name, callback) { this.events[name] = callback; }
  });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get("fixed-color").value = "#6c5ce7"; get("opacity").value = ".72";
  get("border-color").value = "#ffffff"; get("line-width").value = ".5";
  const sources = new Map(); const layers = new Map();
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    addSource(id, config) { sources.set(id, { data: config.data, setData(data) { this.data = data; } }); },
    addLayer(layer) { layers.set(layer.id, { ...layer, layout: { ...layer.layout }, paint: { ...layer.paint } }); },
    setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; },
    getPaintProperty(id, key) { return layers.get(id).paint[key]; },
    getContainer() { return get("map"); },
    project(coordinates) { return { x: coordinates[0] * 10, y: coordinates[1] * 10 }; },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
    moveLayer() {}, on() {}, resize() {}, fitBounds() {}
  };
  const context = vm.createContext({
    ...metro, ...capabilities, ...polygonStyle, ...profile, ...engine, PolygonRenderer,
    requestAnalysis: async () => { throw new Error("AI unavailable in offline test"); },
    AbortController, structuredClone, clearInterval, setInterval,
    analyzeBarData, createBarOptions, dataForBarMapping, createLineOption, createPieOptions,
    BarRenderer: { render() {}, clear() {} }, LineRenderer: { render() {}, clear() {} }, PieRenderer: { render() {}, clear() {} },
    renderDataMappingPanel() {}, renderBarStylePanel() {}, renderPieStylePanel() {}, renderChartIcon() {},
    CONFIG: { DEFAULT_RESOLUTION: 5, MAX_RENDER_CELLS: 120000 },
    DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {},
    mergeBarConfig: () => ({}), mergePieConfig: () => ({}),
    clearDataMappingPanel() {}, clearBarStylePanel() {}, clearPieStylePanel() {}, renderMapIcon() {},
    humanizeField: field => field,
    geoJSONToCells() { throw new Error("Metro polygons must not be regenerated as H3"); },
    document: { getElementById: get, createElement: element, querySelector: () => element(), querySelectorAll: () => [] },
    maplibregl: {
      LngLatBounds: class { extend() { return this; } },
      Popup: class {
        constructor(options) { this.options = options; }
        on(name, callback) { this[name] = callback; return this; }
        setLngLat(coordinates) { this.coordinates = coordinates; return this; }
        setDOMContent(card) { this.card = card; return this; }
        addTo() { return this; }
        remove() { this.close?.(); }
      }
    },
    console, setTimeout: callback => { callback(); return 0; }, clearTimeout() {},
    ...overrides
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "")
    .replace(/\binit\(\);\s*$/, "");
  vm.runInContext(source, context);
  context.testMap = map;
  vm.runInContext("map = testMap; addMapLayers();", context);
  return { context, get, sources, layers };
}

test("upload displays independent Metro layers, changes departure, and clears all sources", async () => {
  const { context, get, sources, layers } = createHarness();
  context.file = { name: "metro.json", text: async () => readFileSync(new URL("../geomap_metro1_du_lieu_mo_phong.json", import.meta.url), "utf8") };
  await vm.runInContext("processSpatialFile(file)", context);
  assert.equal(sources.get("polygon-data").data.features.length, 3980);
  assert.equal(sources.get("vietnam-boundary").data.features.length,
    JSON.parse(readFileSync(new URL("../geomap_metro1_du_lieu_mo_phong.json", import.meta.url), "utf8")).boundary.features.length);
  assert.equal(sources.get("metro-station-data").data.features.length, 13);
  assert.equal(sources.get("line-data").data.features.length, 1);
  assert.equal(layers.get("polygon-fill").layout.visibility, "visible");
  assert.equal(layers.get("data-lines").layout.visibility, "visible");
  assert.equal(layers.get("metro-stations").layout.visibility, "visible");
  assert.equal(get("metro-time-section").hidden, false);
  assert.equal(get("metro-departure").children.length, 18);
  assert.equal(get("display-config-section").hidden, true);
  get("metro-departure").value = "17:30";
  vm.runInContext("updateMetroTime()", context);
  const cell = sources.get("polygon-data").data.features[0].properties;
  assert.equal(cell.departure_time, "17:30");
  assert.equal(cell.ratio, cell.bus_minutes / cell.motorbike_minutes);
  get("show-map-lines").checked = false;
  vm.runInContext("applyMapLayerVisibility()", context);
  assert.equal(layers.get("data-lines").layout.visibility, "none");
  assert.equal(layers.get("metro-stations").layout.visibility, "visible");
  get("show-metro-boundary").checked = false;
  vm.runInContext("applyMapLayerVisibility()", context);
  assert.equal(layers.get("vietnam-border").layout.visibility, "none");
  get("show-map-layers").checked = false;
  vm.runInContext("applyMapLayerVisibility()", context);
  for (const id of ["polygon-fill", "polygon-border", "metro-stations", "metro-station-labels", "data-lines", "vietnam-border"]) {
    assert.equal(layers.get(id).layout.visibility, "none");
  }
  await vm.runInContext("resetConfiguration()", context);
  assert.equal(sources.get("polygon-data").data.features[0].properties.departure_time, "05:30");
  assert.equal(layers.get("data-lines").layout.visibility, "visible");
  vm.runInContext("deleteData()", context);
  for (const id of ["polygon-data", "vietnam-boundary", "metro-station-data", "line-data"]) assert.equal(sources.get(id).data.features.length, 0);
  assert.equal(get("metro-time-section").hidden, true);
  assert.equal(get("metro-legend").hidden, true);
});

test("rainfall upload falls back to polygons, changes time, resets and clears without H3", async () => {
  let calls = 0;
  const { context, get, sources, layers } = createHarness({ requestAnalysis: async () => { calls++; throw new Error("401: API key bị từ chối"); } });
  context.file = { name: "rain.json", text: async () => readFileSync(new URL("../geomap_demo_rainfall_theo_thoi_gian.json", import.meta.url), "utf8") };
  await vm.runInContext("processSpatialFile(file)", context);
  assert.equal(calls, 1); assert.equal(sources.get("polygon-data").data.features.length, 3980);
  assert.equal(layers.get("polygon-fill").layout.visibility, "visible");
  assert.equal(get("chart-canvas").hidden, true); assert.equal(get("analysis-time-select").children.length, 12);
  assert.equal(get("analysis-legend").hidden, false); assert.ok(get("analysis-explanation").textContent.includes("401"));
  get("analysis-time-select").value = "22:00";
  vm.runInContext("updateAnalysisTime()", context);
  const source = JSON.parse(await context.file.text());
  const value = source.measurements.find(r => r.cell_id === "hex_0001" && r.time === "22:00").rainfall_mm;
  assert.equal(sources.get("polygon-data").data.features[0].properties.__value, value);
  assert.equal(calls, 1);
  await vm.runInContext("resetConfiguration()", context);
  assert.equal(sources.get("polygon-data").data.features[0].properties.__time, "00:00");
  vm.runInContext("deleteData()", context);
  assert.equal(get("analysis-section").hidden, true); assert.equal(get("analysis-legend").hidden, true);
  assert.equal(sources.get("polygon-data").data.features.length, 0);
});

test("late AI response from previous upload cannot replace the latest data", async () => {
  let finish; let calls = 0;
  const { context, sources } = createHarness({ requestAnalysis: async payload => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finish = () => resolve({ plan: {}, model: "Luna" }); });
    throw new Error("offline");
  } });
  context.first = { name: "old.json", text: async () => JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { value: 1 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } }] }) };
  const first = vm.runInContext("processSpatialFile(first)", context);
  await new Promise(resolve => setImmediate(resolve));
  context.second = { name: "latest.json", text: async () => readFileSync(new URL("../geomap_demo_rainfall_theo_thoi_gian.json", import.meta.url), "utf8") };
  await vm.runInContext("processSpatialFile(second)", context);
  finish(); await first;
  assert.equal(sources.get("polygon-data").data.features.length, 3980);
  assert.equal(vm.runInContext("state.analysisFileName", context), "latest.json");
});

test("playback ticks each second, loops, and stops on deletion", async () => {
  let tick; let active = false;
  const { context, get, sources } = createHarness({ setInterval(callback, duration) { assert.equal(duration, 1000); tick = callback; active = true; return 42; }, clearInterval() { active = false; } });
  context.file = { name: "rain.json", text: async () => readFileSync(new URL("../geomap_demo_rainfall_theo_thoi_gian.json", import.meta.url), "utf8") };
  await vm.runInContext("processSpatialFile(file)", context);
  vm.runInContext("togglePlayback()", context); assert.equal(active, true);
  tick(); assert.equal(sources.get("polygon-data").data.features[0].properties.__time, "02:00");
  get("analysis-time-select").value = "22:00"; vm.runInContext("updateAnalysisTime()", context);
  tick(); assert.equal(sources.get("polygon-data").data.features[0].properties.__time, "00:00");
  vm.runInContext("deleteData()", context); assert.equal(active, false);
});

test("manual palette and metric mapping apply without a second AI call", async () => {
  let calls = 0;
  const { context, get, sources } = createHarness({ requestAnalysis: async () => { calls++; throw new Error("offline"); } });
  context.file = { name: "rain.json", text: async () => readFileSync(new URL("../geomap_demo_rainfall_theo_thoi_gian.json", import.meta.url), "utf8") };
  await vm.runInContext("processSpatialFile(file)", context);
  get("analysis-colors").value = "viridis";
  await vm.runInContext("applyAnalysisMapping()", context);
  assert.equal(vm.runInContext("state.visualization.colors[0].color", context), "#440154");
  assert.equal(calls, 1); assert.equal(sources.get("polygon-data").data.features.length, 3980);
});

test("valid AI plan uses its metric and renderer, invalid plan falls back", async () => {
  const input = [{ city: "A", amount: 2, score: 10 }, { city: "B", amount: 4, score: 20 }];
  const { context, get } = createHarness({ requestAnalysis: async () => ({ model: "gpt-6-luna", plan: { ...engine.localPlan(profile.profileInput(input)), renderer: "line-chart", metric: "score", reason: "Xu hướng điểm" } }) });
  context.file = { name: "table.json", text: async () => JSON.stringify(input) };
  await vm.runInContext("processSpatialFile(file)", context);
  assert.equal(vm.runInContext("state.chartConfig.chartKind", context), "line");
  assert.equal(vm.runInContext("state.chartConfig.series.length", context), 1);
  assert.equal(vm.runInContext("state.chartConfig.series[0].key", context), "score");
  assert.ok(get("analysis-explanation").textContent.includes("Xu hướng điểm"));
  context.requestAnalysis = async () => ({ plan: { renderer: "eval" } });
  await vm.runInContext("processSpatialFile(file)", context);
  assert.equal(vm.runInContext("state.chartConfig.variant", context), "single");
  assert.ok(get("analysis-explanation").textContent.includes("Phân tích cục bộ"));
});

test("CSV/Excel upload reads every sheet and plain tables retain chart rendering", async () => {
  const { context, get } = createHarness({ XLSX: {
    read: () => ({ SheetNames: ["First", "Second"], Sheets: { First: [{ label: "A", amount: "2" }, { label: "B", amount: "4" }], Second: [{ label: "C", amount: "6" }] } }),
    utils: { sheet_to_json: sheet => sheet }
  } });
  context.file = { name: "table.csv", text: async () => "label,amount\nA,2\nB,4" };
  await vm.runInContext("processSpatialFile(file)", context);
  assert.equal(vm.runInContext("state.analysisProfile.datasets.length", context), 2);
  assert.equal(get("chart-canvas").hidden, false);
  assert.equal(vm.runInContext("state.chartConfig.data[0].amount", context), 2);
});

test("clicks anywhere in a Metro cell focus its full geometry and anchor to the same center", async () => {
  const { context, sources, layers } = createHarness();
  context.file = { name: "metro.json", text: async () => readFileSync(new URL("../geomap_metro1_du_lieu_mo_phong.json", import.meta.url), "utf8") };
  await vm.runInContext("processSpatialFile(file)", context);
  const feature = sources.get("polygon-data").data.features[0];
  context.clickedFeature = { ...feature, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } };
  context.clickLocation = [106, 10];
  vm.runInContext("showMetroComparison({ features: [clickedFeature], lngLat: clickLocation })", context);
  const firstCenter = vm.runInContext("state.metroPopup.coordinates", context);
  assert.equal(vm.runInContext("state.metroPopup.options.className", context), "metro-comparison-popup");
  assert.equal(vm.runInContext("state.metroPopup.options.anchor", context), "left");
  const card = vm.runInContext("state.metroPopup.card", context);
  assert.equal(card.children[0].textContent, "Xe buýt chậm hơn xe máy");
  assert.equal(card.children[1].className, "metro-comparison-ratio");
  assert.equal(card.children[1].children[0].textContent, (feature.properties.bus_minutes / feature.properties.motorbike_minutes).toFixed(2));
  assert.equal(card.children[2].children[1].children[0].textContent, `${Number(feature.properties.bus_minutes.toFixed(1))}′`);
  assert.deepEqual(sources.get("selected-cell").data.features[0].geometry, feature.geometry);
  assert.equal(layers.get("cell-focus-fill").paint["fill-opacity"], 1);
  assert.deepEqual(layers.get("cell-focus-fill").paint["fill-color"], layers.get("polygon-fill").paint["fill-color"]);
  assert.equal(layers.get("cell-focus-border").paint["line-color"], "#ffffff");
  context.clickLocation = [107, 11];
  vm.runInContext("showMetroComparison({ features: [clickedFeature], lngLat: clickLocation })", context);
  assert.deepEqual(vm.runInContext("state.metroPopup.coordinates", context), firstCenter);
  assert.equal(layers.get("cell-focus-dim").layout.visibility, "visible");
  vm.runInContext("state.metroPopup.remove()", context);
  for (const id of ["cell-focus-dim", "cell-focus-fill", "cell-focus-border"]) assert.equal(layers.get(id).layout.visibility, "none");
  assert.equal(sources.get("selected-cell").data.features.length, 0);
  assert.equal(vm.runInContext("state.metroPopup", context), null);
});

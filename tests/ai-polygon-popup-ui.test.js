import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as popupChart from "../src/ai-popup-chart.js";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as times from "../src/time-values.js";
import { AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { comparableFilterValue } from "../src/ai-data-analysis.js";
import { createAiPopupContent } from "../src/ai-popup.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { analyzeSpatialData } from "../src/data-capabilities.js";

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.value = ""; this.checked = true;
    this.className = ""; this.textContent = ""; this.style = { setProperty() {} }; this.clientWidth = 800; this.clientHeight = 600;
    this.offsetWidth = 520; this.offsetHeight = 500;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, callback) { this.events[type] = callback; }
  matches(selector) {
    return selector.split(",").some(part => {
      const name = part.trim();
      if (name === "[data-popup-bar-variant]") return this.dataset.popupBarVariant != null;
      return name.startsWith(".") && this.className.split(" ").includes(name.slice(1).replace(":checked", "")) && (!name.endsWith(":checked") || this.checked);
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.querySelectorAll("*")]).filter(child => selector === "*" || child.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function harness() {
  const elements = new Map(); const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const rendered = []; const cleared = []; const popups = [];
  class Popup {
    constructor() { this.callbacks = []; this.element = new Element(); popups.push(this); }
    on(name, callback) { if (name === "close") this.callbacks.push(callback); return this; }
    setDOMContent(card) { this.card = card; this.element.replaceChildren(card); return this; }
    setLngLat(value) { this.lngLat = value; return this; }
    addTo() { this.added = true; return this; }
    getElement() { return this.element; }
    remove() { if (!this.removed) { this.removed = true; this.callbacks.forEach(callback => callback()); } }
  }
  const renderer = kind => ({
    render(container, config) { assert.ok(popups.at(-1).added, "chart must mount after popup.addTo"); rendered.push({ kind, config }); },
    clear(container) { cleared.push(container); }
  });
  const sources = new Map(["polygon-data", "vietnam-boundary", "h3-grid"].map(id => [id, { setData(data) { this.data = data; } }]));
  const map = { getContainer: () => get("map"), getSource: id => sources.get(id), getLayer: () => null, resize() {},
    project: () => ({ x: 400, y: 300 }), unproject: point => point };
  const dataset = {
    records: ["A", "B"].flatMap((region, index) => [1, 2, 3].map(day => ({ region, date: new Date(`2026-09-0${day}`), temperature: day + index * 10, minimum: day - 1 }))),
    analysis: { source: "ai", datasetTitle: "Thời tiết", grain: "một vùng/ngày", columns: [
      { name: "region", role: "geo" }, { name: "date", role: "time" },
      { name: "temperature", role: "measure", aggDefault: "mean", unit: "°C" },
      { name: "minimum", role: "measure", aggDefault: "min", unit: "°C" }
    ] },
    selectedSuggestionId: "polygon", suggestions: [
      { id: "line", chartType: "line", available: true, effectiveConfidence: .99 },
      { id: "polygon", chartType: "choropleth", available: true, effectiveConfidence: .9, bindings: { region: "region", value: "temperature" } },
      { id: "bar", chartType: "bar", available: true, effectiveConfidence: .8 }
    ], recommendation: { geometry: { field: "region" }, metricField: "temperature", numericFields: ["temperature", "minimum"],
      filters: [{ field: "date", control: "date-select" }], source: "ai" },
    boundaries: { features: ["A", "B"].map(region => ({ properties: { __data_location: region }, geometry: { type: "Polygon", coordinates: [] } })) }
  };
  const features = ["A", "B"].map(region => ({ properties: { region, __location: region, temperature: 3, date: "2026-09-03" } }));
  const context = vm.createContext({
    ...popupChart, ...pipeline, ...times, AI_CHART_REGISTRY, comparableFilterValue, createAiPopupContent, joinRecordsToMapTilerBoundaries, analyzeSpatialData,
    CONFIG: { DEFAULT_RESOLUTION: 5 }, DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {}, DEFAULT_POINT_STYLE: {},
    BarRenderer: renderer("bar"), LineRenderer: renderer("line"),
    humanizeField: field => field, renderMapIcon() {}, renderChartIcon() {}, keepSelectOpenAfterMouseClick: value => value,
    document: { getElementById: get, createElement: () => new Element(), querySelector: () => new Element(), addEventListener() {},
      querySelectorAll: selector => selector.startsWith("#ai-filter-controls ") ? get("ai-filter-controls").querySelectorAll(selector.slice(20)) : [] },
    maplibregl: { Popup }, console, setTimeout() {}, clearTimeout() {}, dataset, testMap: map, testFeatures: features
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/\binit\(\);\s*$/, "");
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run("map = testMap; state.aiDataset = dataset; state.mapType = 'polygon'; state.boundary = {features: testFeatures}; bindUI(); populateAiFilters(dataset);");
  const all = selector => get("ai-filter-controls").querySelectorAll(selector);
  const click = element => get("ai-filter-controls").events.click({ target: element });
  const change = element => get("ai-filter-controls").events.change({ target: element });
  const mode = name => click(all(".ai-popup-type").find(button => button.dataset.popupMode === name));
  return { dataset, get, run, all, click, change, mode, popups, rendered, cleared, sources, features };
}

test("polygon defaults to information with map controls and accurate map-only suggestions", () => {
  const h = harness();
  assert.equal(h.all(".ai-popup-type").length, 3);
  assert.equal(h.all(".ai-popup-type").find(button => button.dataset.popupMode === "info").attributes["aria-pressed"], "true");
  assert.equal(h.all(".ai-popup-settings").length, 0);
  assert.equal(h.all(".ai-metric-selector").length, 1);
  assert.deepEqual(h.all(".ai-generated-filter").map(control => control.dataset.field), ["date"]);
  h.run("renderAiSuggestionGrid()");
  assert.match(h.get("map-type-summary").textContent, /1 đề xuất/);
  assert.equal(h.get("map-type-grid").children[1].children[1].textContent, AI_CHART_REGISTRY.choropleth.label);
});

test("popup switches charts, preserves map and per-kind settings, and releases chart roots", () => {
  const h = harness();
  h.mode("bar");
  assert.equal(h.run("state.mapType"), "polygon"); assert.equal(h.run("state.chartConfig"), null);
  assert.equal(h.all(".ai-popup-settings").length, 1);
  assert.equal(h.all(".ai-popup-range").length, 2);
  assert.equal(h.popups.length, 0, "choosing a type must not open a popup");
  h.run("openPolygonPopup(testFeatures[0], [105, 21])");
  assert.equal(h.rendered.at(-1).config.data.length, 3);
  h.mode("line");
  assert.equal(h.cleared.length, 1); assert.equal(h.rendered.at(-1).kind, "line");
  const metric = h.all(".ai-popup-metric")[0]; metric.value = "minimum"; h.change(metric);
  h.mode("info"); assert.equal(h.all(".ai-popup-settings").length, 0);
  h.mode("line"); assert.equal(h.all(".ai-popup-metric")[0].value, "minimum");
  h.run("openPolygonPopup(testFeatures[1], [106, 21])");
  assert.equal(h.popups[0].removed, true); assert.equal(h.rendered.at(-1).config.title, "Biểu đồ đường · B");
  h.run("closePolygonPopup()");
  assert.equal(h.popups.at(-1).removed, true); assert.equal(h.run("polygonPopupView"), null);
});

test("map date and map metric changes update open popup information without changing chart range or metric", async () => {
  const h = harness(); h.mode("line"); h.run("openPolygonPopup(testFeatures[0], [105,21])");
  const before = JSON.stringify(h.rendered.at(-1).config.data);
  const date = h.all(".ai-generated-filter")[0]; date.value = "2026-09-01T00:00:00.000Z";
  h.run("syncPolygonPaletteControls = () => {}; applyStyle = () => {};");
  await h.change(date);
  assert.equal(h.run("polygonPopupView.feature.properties.temperature"), 1);
  assert.equal(JSON.stringify(h.rendered.at(-1).config.data), before);
  const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum";
  await h.change(metric);
  assert.equal(h.dataset.recommendation.metricField, "minimum");
  assert.equal(h.rendered.at(-1).config.series[0].key, "temperature");
  assert.equal(h.run("state.boundary.features.length"), 2);
  h.run("clearAiMapState()"); assert.equal(h.popups.at(-1).removed, true);
});

test("date ranges remain ordered and grouped bar controls apply selected aggregation", async () => {
  const h = harness(); h.mode("bar");
  h.click(h.all(".ai-bar-chart-type").find(button => button.dataset.popupBarVariant === "grouped"));
  assert.equal(h.all(".ai-popup-metric-checkbox").length, 3);
  const aggregate = h.all(".ai-popup-aggregation")[0]; aggregate.value = "sum"; await h.change(aggregate);
  const from = h.all(".ai-popup-range").find(control => control.dataset.edge === "from"); from.value = "2026-09-03T00:00:00.000Z"; await h.change(from);
  const to = h.all(".ai-popup-range").find(control => control.dataset.edge === "to"); to.value = "2026-09-01T00:00:00.000Z"; await h.change(to);
  assert.equal(h.all(".ai-popup-range")[0].value, "2026-09-01T00:00:00.000Z");
  h.run("openPolygonPopup(testFeatures[0], [105,21])");
  assert.equal(h.rendered.at(-1).config.variant, "grouped");
  assert.equal(h.rendered.at(-1).config.aggregation, "sum");
});

test("a new upload resets popup settings and prioritizes polygon over higher-scored line", async () => {
  const h = harness(); h.mode("bar"); h.run("openPolygonPopup(testFeatures[0], [105,21])");
  h.run(`
    analyzeBarData = () => { throw new Error('no legacy chart'); };
    prepareSuggestions = () => dataset.suggestions;
    roadNetworksFromRecords = () => null;
    showChartStyleControls = () => {};
    selectAiSuggestion = async id => { globalThis.selectedId = id; return true; };
  `);
  await h.run("replaceAiPipelineData({records: dataset.records, analysis: dataset.analysis}, 'new.csv')");
  assert.equal(h.run("selectedId"), "polygon");
  assert.equal(h.run("Object.keys(state.aiDataset.popupSelections).length"), 0);
  assert.equal(h.popups[0].removed, true);
});

test("data without a time column keeps bar and information choices and disables line", () => {
  const h = harness();
  h.dataset.analysis.columns = h.dataset.analysis.columns.filter(column => column.role !== "time");
  h.run("populateAiFilters(state.aiDataset)");
  assert.equal(h.all(".ai-generated-filter").length, 0);
  assert.equal(h.all(".ai-popup-type").find(button => button.dataset.popupMode === "line").disabled, true);
  h.mode("bar"); h.run("openPolygonPopup(testFeatures[0], [105,21])");
  assert.equal(h.rendered.at(-1).config.data.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as popupChart from "../src/ai-popup-chart.js";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as times from "../src/time-values.js";
import { AI_CHART_REGISTRY, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { comparableFilterValue, displayFilterValue, requestAiDataAnalysis } from "../src/ai-data-analysis.js";
import { createAiPopupContent } from "../src/ai-popup.js";
import { createInfoImagePopup } from "../src/info-image-popup.js";
import { collapseCountryFeatures, joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { administrativeBoundaryLabel, loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { analyzeSpatialData } from "../src/data-capabilities.js";
import * as roadMap from "../src/road-map-data.js";
import * as coordinates from "../src/coordinate-data.js";
import * as h3Utils from "../src/h3-utils.js";
import * as pointStyle from "../src/renderers/point-style.js";
import * as polygonStyle from "../src/renderers/polygon-style.js";
import * as weatherStyle from "../src/renderers/weather-style.js";
import * as polygonLegend from "../src/polygon-legend.js";
import * as legendContract from "../src/polygon-legend-contract.js";
import * as categoricalColor from "../src/categorical-color.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";
import { storeColumns, storeRecords, storeSuggestions } from "./fixtures/store-points-fixture.js";
import { normalizeTabularRecords, profileTabularData } from "../src/tabular-data.js";
import { trafficAiAnalysis, trafficRecords, TRAFFIC_SPEED } from "./fixtures/road-traffic-fixture.js";
import { normalizeBarChartConfig } from "../src/charts/bar-chart.js";
import { descriptiveColumns, descriptiveCountryFetch, descriptiveRecords, descriptiveSuggestion } from "./fixtures/descriptive-countries-fixture.js";
import { accessField, accessLegend, categoricalCountryFixture } from "./fixtures/categorical-countries-fixture.js";

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.value = ""; this.checked = true;
    this.className = ""; this.textContent = ""; this.style = { setProperty(key, value) { this[key] = value; } }; this.clientWidth = 800; this.clientHeight = 600;
    this.offsetWidth = 520; this.offsetHeight = 500;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  append(...children) { for (const child of children) { child.parent = this; child.parentElement = this; this.children.push(child); } }
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

function harness({ road = false, point = false, path = false, thematic = false, storeNameRole = "category", pointRecords = storeRecords,
  metricButtons = null,
  popupSuggestions = [{ name: "info", confidence: .95 }, { name: "bar", confidence: .9 }, { name: "line", confidence: .85 }],
  fetchImpl = () => assert.fail("map interactions must not call AI"), boundaryLoader = loadAdministrativeBoundaries,
  boundaryClipper = async boundary => boundary } = {}) {
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
    render(container, config) { assert.ok(popups.at(-1).added, "chart must mount after popup.addTo");
      rendered.push({ kind, config: kind === "bar" ? normalizeBarChartConfig(config) : config }); },
    clear(container) { cleared.push(container); }
  });
  const sources = new Map(["polygon-data", "vietnam-boundary", "h3-grid", "line-data", "point-data"].map(id => [id, { setData(data) { this.data = data; } }]));
  const layers = new Map((thematic ? ["polygon-fill", "polygon-border", "h3-fill", "h3-border"] : []).map(id => [id, { paint: {}, layout: {} }]));
  const palettes = ["diverging", "viridis", "blue"].map(palette => { const button = new Element(); button.className = "palette"; button.dataset.palette = palette; return button; });
  const map = { getContainer: () => get("map"), getSource: id => sources.get(id), getLayer: id => layers.get(id), resize() {},
    setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
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
  if (road) {
    dataset.analysis = { ...trafficAiAnalysis, source: "ai" };
    dataset.records = normalizeTabularRecords(trafficRecords.slice(0, 6), dataset.analysis.columns).records;
    dataset.suggestions = trafficAiAnalysis.suggestions.map(item => ({ ...item, available: true,
      effectiveConfidence: item.chartType === "map_line" ? .85 : .99 }));
    dataset.selectedSuggestionId = "traffic-map-line";
    dataset.roadArea = roadMap.roadNetworksFromRecords(dataset.records, dataset.analysis.columns);
    dataset.roadGeometries = { hanoi: { type: "FeatureCollection", features: [
      { type: "Feature", properties: { name: "Đường Lĩnh Nam" }, geometry: { type: "LineString", coordinates: [[105.8,21],[105.9,21]] } },
      { type: "Feature", properties: { name: "Đường Ngọc Hồi", ref: "QL1" }, geometry: { type: "LineString", coordinates: [[105.8,20.9],[105.9,20.9]] } }
    ] } };
  }
  if (point) {
    dataset.analysis = { source: "ai", datasetTitle: "Cửa hàng", grain: "một cửa hàng/tháng",
      columns: storeColumns.map(column => column.name === "ten_cua_hang" ? { ...column, role: storeNameRole } : column) };
    dataset.records = pointRecords;
    dataset.suggestions = storeSuggestions.map(item => ({ ...item, available: true, effectiveConfidence: item.confidence }));
    dataset.selectedSuggestionId = "stores";
  }
  if (path) {
    dataset.analysis = { source: "ai", datasetTitle: "Tuyến", grain: "tọa độ trong tuyến", columns: [
      { name: "lat", role: "geo", geoLevel: "point_lat" }, { name: "lng", role: "geo", geoLevel: "point_lng" },
      { name: "speed", role: "measure", aggDefault: "mean" }
    ] };
    dataset.records = [{ lat: 21.03, lng: 105.03, speed: 30 }, { lat: 21.01, lng: 105.01, speed: 10 }, { lat: 21.02, lng: 105.02, speed: 20 }];
    dataset.suggestions = [{ id: "path", chartType: "map_line", available: true, bindings: { lat: "lat", lng: "lng" } }];
    dataset.selectedSuggestionId = "path";
  }
  if (popupSuggestions !== null) dataset.suggestions = dataset.suggestions.map(suggestion => ({ ...suggestion,
    popupSuggestions: popupSuggestions.map(item => ({ ...item })) }));
  if (metricButtons !== null) dataset.suggestions.find(suggestion => suggestion.id === dataset.selectedSuggestionId).metricButtons = metricButtons;
  const context = vm.createContext({
    ...popupChart, ...pipeline, ...times, ...roadMap, ...coordinates, ...h3Utils, ...pointStyle, ...polygonStyle, ...weatherStyle, ...polygonLegend, ...legendContract, ...categoricalColor,
    fetch: fetchImpl, requestAiDataAnalysis, profileTabularData, loadAdministrativeBoundaries: boundaryLoader, landOnlyBoundary: boundaryClipper, legendFixture, AI_CHART_REGISTRY, comparableFilterValue, displayFilterValue, createAiPopupContent, createInfoImagePopup, collapseCountryFeatures, joinRecordsToMapTilerBoundaries, administrativeBoundaryLabel, analyzeSpatialData,
    CONFIG: { DEFAULT_RESOLUTION: 5 }, DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {},
    BarRenderer: renderer("bar"), LineRenderer: renderer("line"),
    humanizeField: field => field, renderMapIcon() {}, renderChartIcon() {}, keepSelectOpenAfterMouseClick: value => value,
    document: { getElementById: get, createElement: () => new Element(), querySelector: () => new Element(), addEventListener() {},
      querySelectorAll: selector => selector === "#polygon-color-ramp .palette" ? palettes : selector.startsWith("#ai-filter-controls ") ? get("ai-filter-controls").querySelectorAll(selector.slice(20))
        : selector.startsWith(".geo-") ? get("ai-filter-controls").querySelectorAll(selector) : [] },
    maplibregl: { Popup }, AbortController, Date, console, setTimeout() {}, clearTimeout() {}, dataset, testMap: map, testFeatures: features
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/export function createMapLayerRuntime\(options\) \{\nconst document = options.document;\nconst maplibregl = options.maplibregl \|\| globalThis.maplibregl;\n/, "const options = {};\n")
    .replace(/\/\/ Runtime public API[\s\S]*$/, "");
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run("map = testMap; state.aiDataset = dataset; state.mapType = 'polygon'; state.boundary = {features: testFeatures}; bindUI(); populateAiFilters(dataset);");
  if (road) run("state.mapType = 'line'; state.boundary = null; dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]); populateAiFilters(dataset); refreshAiRoadMap();");
  if (point) run("state.mapType = 'point'; dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]); refreshPointView(dataset.suggestions[0], {rebuildControls: true});");
  if (path) run("state.mapType = 'line'; state.boundary = null; dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]); populateAiFilters(dataset); refreshAiRoadMap();");
  const all = selector => get("ai-filter-controls").querySelectorAll(selector);
  const click = element => get("ai-filter-controls").events.click({ target: element });
  const change = element => get("ai-filter-controls").events.change({ target: element });
  const mode = name => click(all(".ai-popup-type").find(button => button.dataset.popupMode === name));
  return { dataset, get, run, all, click, change, mode, popups, rendered, cleared, sources, features, layers, palettes };
}

const polygonMetricButtons = [
  { field: "temperature", label: "Nhiệt độ trung bình", icon: "🌡️", color: "#f59e0b" },
  { field: "minimum", label: "Nhiệt độ thấp nhất", icon: "❄️", color: "#3b82f6" }
];

test("information popups use the active input dataset title, with the input file name as fallback", () => {
  const h = harness();
  const caption = () => h.popups.at(-1).card.querySelector('.popup-info-caption').textContent;
  h.run("openMapPopup(testFeatures[0], [105, 21])");
  assert.equal(caption(), 'Thời tiết');
  h.dataset.analysis.datasetTitle = 'Doanh thu cửa hàng theo tháng';
  h.run("openMapPopup(testFeatures[1], [105, 21])");
  assert.equal(caption(), 'Doanh thu cửa hàng theo tháng');
  h.dataset.analysis.datasetTitle = '  ';
  h.dataset.fileName = 'Dữ liệu đầu vào.xlsx';
  h.run("openMapPopup(testFeatures[0], [105, 21])");
  assert.equal(caption(), 'Dữ liệu đầu vào');
});

test("categorical country map shows exact AI colors, a distinct combination swatch and both original popup records", async () => {
  const fixture = categoricalCountryFixture();
  const analysis = validateAndNormalizeAnalysis({ columns: fixture.columns, suggestions: [fixture.suggestion], search_bar: true, search_fields: ["Điểm đến"] }, profileTabularData(fixture.records));
  const boundaries = await loadAdministrativeBoundaries(fixture.records.map(row => row["Điểm đến"]), { apiKey: "key", placeType: "country", fetchImpl: descriptiveCountryFetch() });
  const h = harness({ thematic: true });
  Object.assign(h.dataset, { records: fixture.records, analysis, suggestions: analysis.suggestions.map(suggestion => ({ ...suggestion, available: true })),
    selectedSuggestionId: fixture.suggestion.id, boundaries, popupSelections: {} });
  h.run("dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]); populateAiFilters(dataset);");
  await h.run("filteredAiBoundary()");
  assert.equal(h.sources.get("polygon-data").data.features.length, 51);
  assert.equal(h.get("weather-legend").hidden, false);
  assert.equal(h.get("weather-legend-scale").hidden, true);
  assert.equal(h.get("weather-legend-title").textContent, accessField);
  const rows = h.get("weather-legend-labels").children;
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.slice(0, 4).map(row => row.children[0].style.background), accessLegend.stops.map(stop => stop.color));
  const mixed = rows.at(-1);
  assert.equal(mixed.children[0].style.background, "#be185d");
  assert.equal(mixed.children[1].textContent, "Bao gồm Miễn thị thực và Thị thực khi đến");
  assert.equal(mixed.children[2].textContent, "1");
  const china = h.sources.get("polygon-data").data.features.find(feature => feature.properties.__resolved_country_code === "CHN");
  const paint = h.layers.get("polygon-fill").paint["fill-color"];
  const keyIndex = paint.indexOf(china.properties.__category_color_key);
  assert.ok(keyIndex > 1);
  assert.equal(paint[keyIndex + 1], "#be185d");
  h.run("openMapPopup(state.boundary.features.find(feature => feature.properties.__resolved_country_code === 'CHN'), [105,21])");
  const sections = h.popups.at(-1).card.querySelectorAll(".popup-source-record");
  assert.equal(sections.length, 2);
  assert.match(sections[0].querySelectorAll("*").map(node => node.textContent).join(" | "), /Miễn thị thực/);
  assert.match(sections[1].querySelectorAll("*").map(node => node.textContent).join(" | "), /Thị thực khi đến/);
  h.run("fitBoundary = () => {};");
  const categoryFilter = h.all(".ai-generated-filter").find(control => control.dataset.field === accessField);
  categoryFilter.value = "Miễn thị thực"; await h.change(categoryFilter);
  assert.equal(h.get("weather-legend-labels").children.length, 4);
  assert.ok(h.get("weather-legend-labels").children.every(row => !row.children[1].textContent.startsWith("Bao gồm")));
  assert.equal(h.dataset.records.length, 52);
});

test("descriptive countries render with the fixed color and preserve both source records in the popup", async () => {
  const h = harness({ thematic: true, boundaryLoader: (names, options) => loadAdministrativeBoundaries(names, {
    ...options, apiKey: "key", fetchImpl: descriptiveCountryFetch()
  }) });
  Object.assign(h.dataset, { records: structuredClone(descriptiveRecords),
    analysis: { source: "ai", columns: descriptiveColumns, search_bar: true, search_fields: ["Điểm đến"] },
    selectedSuggestionId: descriptiveSuggestion.id, suggestions: [{ ...descriptiveSuggestion, available: true }], popupSelections: {} });
  const original = JSON.stringify(h.dataset.records);
  h.get("fixed-color").value = "#123456";
  h.run("replaceBoundary = async (data, name, profile) => { state.boundary = data; state.dataProfile = profile; };");
  assert.equal(await h.run("activateAiChoropleth(dataset.suggestions[0])"), true);
  assert.equal(h.sources.get("polygon-data").data.features.length, 51);
  assert.equal(h.layers.get("polygon-fill").paint["fill-color"], "#123456");
  assert.equal(h.get("fixed-color").disabled, false);
  assert.equal(h.get("polygon-palette-options").hidden, true);
  assert.equal(h.get("weather-legend").hidden, true);
  h.run("renderMapMetricControls()");
  assert.equal(h.get("map-metric-control").hidden, true);
  assert.equal(h.run("activePolygonLegendScale()"), null);
  h.run("openMapPopup(state.boundary.features.find(feature => feature.properties.__resolved_country_code === 'CHN'), [105, 21])");
  const sections = h.popups.at(-1).card.querySelectorAll(".popup-source-record");
  assert.equal(sections.length, 2);
  const texts = sections.map(section => section.querySelectorAll("*").map(node => node.textContent).join(" | "));
  assert.match(texts[0], /Trung Quốc — đảo Hải Nam.*Đoàn du lịch.*Chỉ áp dụng tại đảo Hải Nam/);
  assert.match(texts[1], /Trung Quốc — quá cảnh.*Có vé nối chuyến.*Giữ nguyên điều kiện quá cảnh/);
  assert.ok(texts.every(text => !text.includes("Nhiều giá trị")));
  assert.equal(Object.keys(h.run("currentDataSearch().locationKeys")).length, 52);
  h.run("fitBoundary = () => {};");
  const region = h.all(".ai-generated-filter").find(control => control.dataset.field === "Điểm đến");
  region.value = "Trung Quốc — quá cảnh"; await h.change(region);
  assert.equal(h.sources.get("polygon-data").data.features.length, 1);
  assert.equal(h.sources.get("polygon-data").data.features[0].properties["Ghi chú"], descriptiveRecords.at(-1)["Ghi chú"]);
  assert.equal(JSON.stringify(h.dataset.records), original);
});

test("one matched country is enough for Polygon without a measure", async () => {
  const h = harness({ thematic: true, boundaryLoader: (names, options) => loadAdministrativeBoundaries(names, {
    ...options, apiKey: "key", fetchImpl: descriptiveCountryFetch()
  }) });
  Object.assign(h.dataset, { records: structuredClone(descriptiveRecords.slice(-1)), analysis: { source: "ai", columns: descriptiveColumns },
    selectedSuggestionId: descriptiveSuggestion.id, suggestions: [{ ...descriptiveSuggestion, available: true }] });
  h.run("replaceBoundary = async (data, name, profile) => { state.boundary = data; state.dataProfile = profile; };");
  assert.equal(await h.run("activateAiChoropleth(dataset.suggestions[0])"), true);
  assert.equal(h.sources.get("polygon-data").data.features.length, 1);
  assert.equal(h.dataset.recommendation.metricField, null);
  assert.equal(h.dataset.recommendation.aggregation, null);
});

test("an all-null selected Polygon measure keeps its thematic configuration and search data", async () => {
  const h = harness({ thematic: true });
  h.run("dataset.records.forEach(row => row.temperature = null); dataset.recommendation.aggregation = 'mean';");
  await h.run("filteredAiBoundary()");
  assert.equal(h.sources.get("polygon-data").data.features.length, 0);
  assert.equal(h.run("currentDataSearch().data.features.length"), 2);
  assert.equal(h.run("usesDefaultPolygonColor()"), false);
  assert.equal(h.get("fixed-color").disabled, true);
});

test("Point and both Line providers keep color legends and toggles without measures", async () => {
  const point = harness({ point: true });
  point.run(`dataset.analysis.columns = dataset.analysis.columns.filter(column => column.role !== 'measure');
    dataset.pointModels = {}; dataset.pointSelections = {}; dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]);
    refreshPointView(dataset.suggestions[0], {rebuildControls:true}); renderPointStyleControls(); renderPointLegend();`);
  assert.equal(point.run("dataset.activePointView.metric"), null);
  assert.equal(point.run("dataset.activePointView.paint['circle-color']"), point.run("state.pointStyle.color"));
  assert.equal(point.get("point-fixed-color-field").hidden, false);
  assert.equal(point.get("point-show-legend-field").hidden, false);
  assert.equal(point.get("point-legend").hidden, false);
  assert.equal(point.get("point-legend").querySelector(".point-legend-row").children[0].style.background, point.run("state.pointStyle.color"));
  point.run("state.pointStyle = {...state.pointStyle, color:'#123456'}; refreshPointStyle();");
  assert.equal(point.get("point-legend").querySelector(".point-legend-row").children[0].style.background, "#123456");
  point.run("state.pointStyle.showLegend = false; renderPointLegend();");
  assert.equal(point.get("point-legend").hidden, true);
  point.run("state.pointStyle.showLegend = true; renderPointLegend();");
  assert.equal(point.get("point-legend").hidden, false);
  assert.equal(point.sources.get("point-data").data.features.length, 2);
  for (const options of [{ road: true }, { path: true }]) {
    const h = harness(options);
    h.run(`dataset.analysis.columns = dataset.analysis.columns.filter(column => column.role === 'geo' || column.name === 'Tên đường');
      dataset.suggestions[0].bindings = {...dataset.suggestions[0].bindings, value:null}; dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]);
      populateAiFilters(dataset); refreshAiRoadMap(); renderRoadStyleControls(); renderRoadLegend();`);
    assert.equal(h.run("dataset.recommendation.metricField"), null);
    assert.equal(h.run("dataset.roadStyle.color"), "#00d084");
    assert.equal(h.get("ai-line-legend").hidden, false);
    assert.equal(h.get("ai-line-legend").querySelector(".point-legend-row").children[0].style.background, h.run("dataset.roadStyle.color"));
    h.run("roadColorOverridesFor(dataset.suggestions[0]).path = '#123456'; refreshAiRoadMap();");
    assert.equal(h.get("ai-line-legend").querySelector(".point-legend-row").children[0].style.background, "#123456");
    h.run("state.roadDisplayStyle.showLegend = false; renderRoadLegend();");
    assert.equal(h.get("ai-line-legend").hidden, true);
    h.run("state.roadDisplayStyle.showLegend = true; renderRoadLegend();");
    assert.equal(h.get("ai-line-legend").hidden, false);
    assert.equal(h.get("road-style-colors").children.length, 1);
    assert.ok(h.sources.get("line-data").data.features.length > 0);
  }
});

test("khu vực null biến mất khỏi lớp tô và viền, hiện lại theo chỉ số và ngày có dữ liệu", async () => {
  const h = harness({ thematic: true, metricButtons: polygonMetricButtons });
  h.run(`
    dataset.records.forEach(row => {
      row.region = row.region === 'A' ? 'Hà Đông' : 'Ba Đình';
      if (row.region === 'Hà Đông' && row.date.getUTCDate() === 3) row.temperature = null;
    });
    dataset.boundaries.features.forEach((feature, index) => {
      feature.properties.__data_location = index === 0 ? 'Hà Đông' : 'Ba Đình';
    });
  `);
  await h.run("filteredAiBoundary(); renderMapMetricControls();");
  const locations = source => Array.from(h.sources.get(source).data.features, feature => feature.properties.__location);
  assert.deepEqual(locations("polygon-data"), ["Ba Đình"]);
  assert.deepEqual(locations("vietnam-boundary"), ["Ba Đình"]);
  assert.equal(h.run("currentDataSearch().data.features.length"), 2);
  assert.equal(h.run("currentDataSearch().data.features[0].properties.__location"), "Hà Đông");
  assert.equal(h.run("currentDataSearch().data.features[0].properties.__metric"), null);
  assert.equal(h.dataset.records.length, 6);
  assert.equal(h.dataset.boundaries.features.length, 2);

  const list = h.get("map-metric-list");
  const clickMetric = field => list.events.click({ target: list.children.find(button => button.dataset.metricField === field) });
  await clickMetric("minimum");
  assert.deepEqual(locations("polygon-data"), ["Hà Đông", "Ba Đình"]);
  h.run("openMapPopup(state.boundary.features[0], [105,21]);");
  const popup = h.popups.at(-1);
  await clickMetric("temperature");
  assert.deepEqual(locations("polygon-data"), ["Ba Đình"]);
  assert.equal(popup.removed, true, "close the popup when its region has no active metric");

  const date = h.all(".ai-generated-filter").find(control => control.dataset.field === "date");
  date.value = "2026-09-02T00:00:00.000Z"; await h.change(date);
  assert.deepEqual(locations("polygon-data"), ["Hà Đông", "Ba Đình"]);
  date.value = "2026-09-03T00:00:00.000Z"; await h.change(date);
  const region = h.all(".ai-generated-filter").find(control => control.dataset.field === "region");
  region.value = "Hà Đông"; await h.change(region);
  assert.deepEqual(locations("polygon-data"), []);
  assert.deepEqual(locations("vietnam-boundary"), []);
  assert.equal(h.run("state.mapType"), "polygon");
  assert.equal(h.run("state.dataProfile.hasArea"), true);
  assert.equal(h.get("weather-legend").hidden, true);
  assert.equal(h.run("currentDataSearch().data.features[0].properties.__location"), "Hà Đông");
  await clickMetric("minimum");
  assert.deepEqual(locations("polygon-data"), ["Hà Đông"]);
  assert.equal(h.get("weather-legend").hidden, false);
});

test("map metric buttons update Polygon and sidebar while preserving date, region and popup settings", async () => {
  const h = harness({ metricButtons: polygonMetricButtons }); h.mode("bar");
  const controls = h.all(".ai-generated-filter");
  controls.find(control => control.dataset.field === "date").value = "2026-09-01T00:00:00.000Z";
  controls.find(control => control.dataset.field === "region").value = "A";
  await h.run("filteredAiBoundary(); renderMapMetricControls();");
  const filters = JSON.stringify(h.dataset.filters);
  const popupSettings = h.run("JSON.stringify(popupSelectionFor())");
  const list = h.get("map-metric-list"); const buttons = [...list.children];
  assert.equal(h.get("map-metric-control").hidden, false);
  assert.deepEqual(buttons.map(button => button.dataset.metricField), ["temperature", "minimum"]);
  assert.equal(buttons[0].attributes["aria-pressed"], "true");
  await list.events.click({ target: buttons[1].children[0] });
  assert.equal(h.dataset.recommendation.metricField, "minimum");
  assert.equal(h.all(".ai-metric-selector")[0].value, "minimum");
  assert.equal(buttons[1].attributes["aria-pressed"], "true");
  assert.equal(buttons[0].attributes["aria-pressed"], "false");
  assert.equal(list.children[1], buttons[1], "keep the focused button mounted");
  assert.equal(JSON.stringify(h.dataset.filters), filters);
  assert.equal(h.run("JSON.stringify(popupSelectionFor())"), popupSettings);
  assert.equal(h.sources.get("polygon-data").data.features.length, 1);
  assert.equal(h.sources.get("polygon-data").data.features[0].properties.minimum, 0);
  const sidebar = h.all(".ai-metric-selector")[0]; sidebar.value = "temperature"; await h.change(sidebar);
  assert.equal(buttons[0].attributes["aria-pressed"], "true");
  await h.run("changeAiMapMetric('date')");
  assert.equal(h.dataset.recommendation.metricField, "temperature");
});

test("map metric controls collapse, refresh for new data and hide outside maps or with one measure", () => {
  const h = harness({ metricButtons: polygonMetricButtons }); h.run("renderMapMetricControls()");
  const toggle = h.get("map-metric-toggle"); const list = h.get("map-metric-list");
  toggle.events.click();
  assert.equal(list.hidden, true);
  assert.equal(toggle.attributes["aria-expanded"], "false");
  assert.equal(h.get("map-metric-caption").textContent, "Nhiệt độ trung bình");
  toggle.events.click();
  assert.equal(list.hidden, false);
  h.run("state.chartConfig = {}; renderMapMetricControls();");
  assert.equal(h.get("map-metric-control").hidden, true);
  h.run("state.chartConfig = null; dataset.analysis.columns = dataset.analysis.columns.filter(column => column.name !== 'minimum'); renderMapMetricControls();");
  assert.equal(h.get("map-metric-control").hidden, true);
  h.run(`state.aiDataset = {...dataset, metricControlCollapsed: false,
    suggestions: dataset.suggestions.map(suggestion => ({...suggestion,metricButtons:[
      {field:'temperature',label:'Nhiệt độ',icon:'☀️',color:'#ef4444'},
      {field:'Lượng mưa',label:'Mưa',icon:'🌧️',color:'#2563eb'}]})),
    analysis: {...dataset.analysis, columns: [...dataset.analysis.columns, {name:'Lượng mưa',role:'measure',unit:'mm'}]}};
    renderMapMetricControls();`);
  assert.equal(h.get("map-metric-control").hidden, false);
  assert.deepEqual(list.children.map(button => button.dataset.metricField), ["temperature", "Lượng mưa"]);
  assert.equal(list.children[1].children[1].textContent, "🌧️");
  assert.equal(list.children[1].children[1].style["--metric-color"], "#2563eb");
  h.run("clearAiMapState()");
  assert.equal(h.get("map-metric-control").hidden, true);
  assert.equal(list.children.length, 0);
});

for (const [geoLevel, locationField, metric, otherMetric, names] of [
  ['country', 'Quốc gia', 'Tử vong', 'Ca ước tính', ['Lào', 'Việt Nam', 'Malaysia']],
  ['admin1', 'Tỉnh', 'Lượng mưa', 'Nhiệt độ', ['Hà Nội', 'Hải Phòng', 'Cà Mau']],
  ['admin2', 'district_key', 'metric.with.dots', 'another_metric', ['Khu A', 'Khu B', 'Khu C']]
]) {
  test(`missing selected metrics stay transparent and searchable across metric switches (${geoLevel})`, async () => {
    const h = harness({ thematic: true });
    const columns = [{ name: locationField, role: 'geo', geoLevel },
      ...[otherMetric, metric].map(name => ({ name, role: 'measure', aggDefault: 'sum' }))];
    const records = names.map((name, index) => ({ [locationField]: name, [metric]: [null, 0, 14][index], [otherMetric]: 100 + index }));
    h.run(`
      dataset.records = ${JSON.stringify(records)};
      dataset.analysis.columns = ${JSON.stringify(columns)};
      dataset.analysis.search_bar = true; dataset.analysis.search_fields = [${JSON.stringify(locationField)}];
      dataset.filters = {};
      dataset.suggestions = [{...dataset.suggestions[1],
        bindings:{region:${JSON.stringify(locationField)},value:${JSON.stringify(otherMetric)}},
        metricButtons:${JSON.stringify([otherMetric, metric].map(field => ({ field, label: field, icon: '●', color: '#123456' })))}
      }];
      dataset.boundaries = {type:'FeatureCollection', features:dataset.records.map((record,index)=>({
        type:'Feature', properties:{__data_location:record[${JSON.stringify(locationField)}]},
        geometry:{type:'Polygon',coordinates:[[[index,0],[index+1,0],[index+1,1],[index,1],[index,0]]]}
      }))};
      dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]);
      populateAiFilters(dataset);
    `);
    await h.run("filteredAiBoundary()");
    h.run("renderMapMetricControls()");
    const buttons = h.get("map-metric-list").children;
    await h.get("map-metric-list").events.click({ target: buttons.find(button => button.dataset.metricField === metric) });
    assert.equal(h.run("activePolygonLegendScale().field"), metric);
    assert.equal(h.run("activePolygonLegendScale().dataMin"), 0);
    assert.equal(h.run("activePolygonLegendScale().dataMax"), 14);
    const paint = h.layers.get("polygon-fill").paint["fill-color"];
    assert.deepEqual(JSON.parse(JSON.stringify(paint[1])), ["==", ["typeof", ["get", metric]], "number"]);
    assert.equal(paint[3], "rgba(0, 0, 0, 0)");
    const index = buildDataSearchIndex(h.run("currentDataSearch()"));
    assert.equal(index.enabled, true);
    assert.equal(index.uniqueCount, 3);
    const feature = searchDataIndex(index, names[0])[0]?.feature;
    assert.equal(feature?.properties[locationField], names[0]);
    assert.equal(feature.properties[metric] ?? null, null);
    assert.equal(feature.properties.__metric, null);
    assert.equal(feature.properties[otherMetric], 100);
    assert.equal(searchDataIndex(index, names[1])[0].feature.properties[metric], 0);
    assert.equal(h.sources.get("polygon-data").data.features.length, 3);
    await h.run(`changeAiMapMetric(${JSON.stringify(otherMetric)})`);
    assert.equal(h.run("activePolygonLegendScale().field"), otherMetric);
    assert.equal(searchDataIndex(buildDataSearchIndex(h.run("currentDataSearch()")), names[0])[0].feature.properties[otherMetric], 100);
    h.run(`dataset.records.forEach(record=>record[${JSON.stringify(metric)}]=null)`);
    await h.run(`changeAiMapMetric(${JSON.stringify(metric)})`);
    assert.equal(h.layers.get("polygon-fill").paint["fill-color"], "rgba(0, 0, 0, 0)");
    assert.equal(buildDataSearchIndex(h.run("currentDataSearch()")).uniqueCount, 3);
  });
}

test("Point metric buttons sync size and sidebar without changing groups, map time or popup metrics", async () => {
  const h = harness({ point: true, metricButtons: [
    { field: "doanh_thu_vnd", label: "Doanh thu", icon: "💰", color: "#16a34a" },
    { field: "chi_phi_vnd", label: "Chi phí", icon: "🧾", color: "#e11d48" }
  ] }); h.mode("line");
  const selectionBefore = h.run("JSON.stringify(pointSelectionFor(activePointSuggestion()))");
  const popupBefore = h.run("JSON.stringify(popupSelectionFor())");
  const buttons = h.get("map-metric-list").children;
  assert.deepEqual(buttons.map(button => button.dataset.metricField), ["doanh_thu_vnd", "chi_phi_vnd"]);
  await h.get("map-metric-list").events.click({ target: buttons[1] });
  assert.equal(h.all(".ai-point-metric")[0].value, "chi_phi_vnd");
  assert.equal(h.run("dataset.activePointView.selection.metricField"), "chi_phi_vnd");
  assert.equal(h.run("JSON.stringify({...pointSelectionFor(activePointSuggestion()), metricField:'doanh_thu_vnd'})"), selectionBefore);
  assert.equal(h.run("JSON.stringify(popupSelectionFor())"), popupBefore);
  assert.equal(buttons[1].attributes["aria-pressed"], "true");
  const sidebar = h.all(".ai-point-metric")[0]; sidebar.value = "doanh_thu_vnd"; await h.change(sidebar);
  assert.equal(buttons[0].attributes["aria-pressed"], "true");
});

test("H3 missing-value cells and their searchable source points follow the active filters", async () => {
  const h = harness({ thematic: true });
  h.run(`
    dataset.analysis.columns = [
      {name:'name',role:'text'}, {name:'period',role:'category'},
      {name:'lat',role:'geo',geoLevel:'point_lat'}, {name:'lng',role:'geo',geoLevel:'point_lng'},
      {name:'metric',role:'measure',aggDefault:'sum'}
    ];
    dataset.analysis.search_bar = true; dataset.analysis.search_fields = ['name'];
    dataset.records = ['A','B'].flatMap(period=>[0,1,2,3,4].map(index=>({
      name:period+index,period,lat:20+index,lng:105,metric:index===0?null:index
    })));
    dataset.suggestions = [{id:'h3',chartType:'hex_h3',available:true,
      bindings:{lat:'lat',lng:'lng',value:'metric'},filters:[{column:'period',control:'select'}]}];
    dataset.selectedSuggestionId = 'h3';
    dataset.recommendation = recommendationForSuggestion(dataset.suggestions[0]);
    dataset.recommendation.filters.push({field:'period',control:'select'});
    populateAiFilters(dataset);
  `);
  for (const period of ['A', 'B']) {
    const control = h.all('.ai-generated-filter').find(control => control.dataset.field === 'period');
    control.value = period;
    await h.run("refreshAiH3()");
    assert.equal(h.run("state.h3Data.features.length"), 5);
    const index = buildDataSearchIndex(h.run("currentDataSearch()"));
    assert.equal(index.enabled, true);
    assert.equal(index.uniqueCount, 5);
    assert.equal(searchDataIndex(index, `${period}0`)[0].feature.properties.metric, null);
    assert.equal(searchDataIndex(index, `${period === 'A' ? 'B' : 'A'}0`).length, 0);
    assert.equal(h.layers.get('h3-fill').paint['fill-color'][3], 'rgba(0, 0, 0, 0)');
  }
});

test("Heatmap excludes missing selected measures from its weight without dropping searchable points", () => {
  const h = harness({ point: true });
  h.layers.set('point-heatmap', {paint:{}});
  h.run(`state.pointData = {type:'FeatureCollection',features:[null,0,10].map((metric,index)=>({
    type:'Feature',properties:{metric,name:'Điểm '+index},geometry:{type:'Point',coordinates:[105+index,21]}
  }))}; state.dataProfile = {numericFields:['metric']}; applyHeatmapWeight();`);
  const weight = h.layers.get('point-heatmap').paint['heatmap-weight'];
  assert.equal(weight[0], 'case');
  assert.equal(weight[3], 0);
  assert.equal(weight[2][3], 0);
  assert.equal(weight[2].at(-2), 10);
  assert.equal(h.run('state.pointData.features.length'), 3);
});

test("Line metric buttons retain filters and the same eligible fields as the sidebar", async () => {
  const h = harness({ road: true });
  h.run(`dataset.suggestions[0].metricButtons = mapMetricColumns(dataset, dataset.suggestions[0]).map(column =>
    ({field:column.name,label:column.name,icon:'🚗',color:'#6366f1'})); renderMapMetricControls();`);
  const sidebar = h.all(".ai-metric-selector")[0];
  const buttons = h.get("map-metric-list").children;
  assert.deepEqual(buttons.map(button => button.dataset.metricField), sidebar.children.map(option => option.value));
  const next = buttons.find(button => button.dataset.metricField !== h.dataset.recommendation.metricField);
  assert.ok(next);
  const filters = JSON.stringify(h.dataset.filters);
  await h.get("map-metric-list").events.click({ target: next });
  assert.equal(sidebar.value, next.dataset.metricField);
  assert.equal(h.dataset.recommendation.metricField, next.dataset.metricField);
  assert.equal(next.attributes["aria-pressed"], "true");
  assert.equal(JSON.stringify(h.dataset.filters), filters);
  assert.ok(h.sources.get("line-data").data.features.length);
});

test("AI chooses arbitrary metric subsets, order, labels, symbols and colors without name-based presets", () => {
  const h = harness();
  h.run(`dataset.analysis.columns.push({name:'profit',role:'measure',labelVi:'Lợi nhuận'}, {name:'cost',role:'measure',labelVi:'Chi phí'});
    dataset.suggestions[1].metricButtons = [
      {field:'cost',label:'Chi phí vận hành',icon:'🧾',color:'#be123c'},
      {field:'profit',label:'Kết quả kinh doanh',icon:'💹',color:'#15803d'},
      {field:'date',label:'Ngày',icon:'📅',color:'#111111'}]; renderMapMetricControls();`);
  const buttons = h.get("map-metric-list").children;
  assert.deepEqual(buttons.map(button => button.dataset.metricField), ["cost", "profit"]);
  assert.deepEqual(buttons.map(button => button.children[0].children[0].textContent), ["Chi phí vận hành", "Kết quả kinh doanh"]);
  assert.deepEqual(buttons.map(button => button.children[1].textContent), ["🧾", "💹"]);
  assert.deepEqual(buttons.map(button => button.children[1].style["--metric-color"]), ["#be123c", "#15803d"]);
});

test("missing or empty AI button configuration stays hidden and preserves manual metric selection", async () => {
  for (const metricButtons of [null, []]) {
    const h = harness({ metricButtons }); h.run("renderMapMetricControls()");
    assert.equal(h.get("map-metric-control").hidden, true);
    const select = h.all(".ai-metric-selector")[0]; select.value = "minimum"; await h.change(select);
    assert.equal(h.dataset.recommendation.metricField, "minimum");
    assert.equal(h.get("map-metric-control").hidden, true);
  }
});

test("Point initializes its size from the first AI button rather than the first numeric column", () => {
  const h = harness({ point: true, metricButtons: [
    { field: "chi_phi_vnd", label: "Chi phí", icon: "🧾", color: "#e11d48" },
    { field: "doanh_thu_vnd", label: "Doanh thu", icon: "💰", color: "#16a34a" }
  ] });
  assert.equal(h.run("pointSelectionFor(activePointSuggestion()).metricField"), "chi_phi_vnd");
  assert.equal(h.all(".ai-point-metric")[0].value, "chi_phi_vnd");
  assert.equal(h.get("map-metric-list").children[0].attributes["aria-pressed"], "true");
});

test("uneven legend labels stay on one row while ticks retain their scale positions", async () => {
  const h = harness({ thematic: true });
  h.get("weather-legend").clientWidth = 330;
  h.run(`
    const column = dataset.analysis.columns.find(column => column.name === 'temperature');
    column.unit = 'mm';
    column.legend = legendFixture({unit:'mm',title:'Lượng mưa',domain:[0,200],
      stops:[0,10,40,100,200].map((value,index)=>({value,color:['#edf8fb','#b3cde3','#6497b1','#005b96','#03396c'][index]}))});
    dataset.suggestions[1].legend = column.legend;
  `);
  await h.run("filteredAiBoundary()");
  const labels = h.get("weather-legend-labels").children;
  assert.deepEqual(labels.map(label => label.textContent), ["0", "10", "40", "100", "200"]);
  assert.ok(labels.every(label => label.style.top === "0px"));
  assert.match(labels[1].style.left, /^calc\(5% \+ /);
  assert.deepEqual(h.get("weather-legend-scale").children.map(tick => tick.style.left), ["0%", "5%", "20%", "50%", "100%"]);
  assert.deepEqual(Array.from(h.run("activePolygonLegendScale().stops"), stop => stop[0]), [0, 10, 40, 100, 200]);
});

test("AI semantic/auto legends lock palette controls, follow metrics and filters, and match regional hex fill", async () => {
  const h = harness({ thematic: true });
  h.get("weather-legend").clientWidth = 330;
  h.run(`
    for (const column of dataset.analysis.columns.filter(column => column.role === 'measure')) {
      column.semanticType='air_temperature'; column.legend=legendFixture({aggregation:column.aggDefault});
    }
    dataset.records.forEach(record => { record.temperature += 24; record.minimum += 20; record.revenue = record.temperature * 10; });
    dataset.analysis.columns.push({name:'revenue',role:'measure',unit:'triệu',aggDefault:'sum',
      legend:legendFixture({aggregation:'sum',unit:'triệu',mode:'auto',title:'Doanh thu',domain:[0,1],stops:[{value:0,color:'#000000'},{value:0.25,color:'#888888'},{value:1,color:'#ffffff'}]})});
    dataset.recommendation.numericFields.push('revenue');
    dataset.suggestions[1].legend=dataset.analysis.columns.find(column=>column.name==='temperature').legend;
    state.polygonPalette='blue';
  `);
  await h.run("filteredAiBoundary()");
  const labels = () => h.get("weather-legend-labels").children.map(child => child.textContent);
  assert.deepEqual(labels(), ["-20", "-10", "0", "10", "20", "30", "40"]);
  assert.equal(h.get("weather-legend-title").textContent, "Nhiệt độ quan sát (°C)");
  assert.equal(h.get("weather-legend-mode").textContent, "Theo ngữ nghĩa");
  assert.equal(h.get("weather-legend-mode").title, legendFixture().reason);
  assert.equal(h.get("polygon-palette-options").hidden, true);
  assert.equal(h.get("polygon-palette-help").hidden, true);
  assert.equal(h.get("polygon-color-label").textContent, "Chú giải màu");
  assert.equal(h.get("fixed-color").disabled, true);
  assert.ok(h.palettes.every(button => button.disabled));
  const original = JSON.stringify(h.layers.get("polygon-fill").paint["fill-color"]);
  h.get("polygon-color-ramp").events.click({ target: h.palettes[0] });
  h.get("fixed-color").events.input({ target: { value: "#ffffff" } });
  assert.equal(h.run("state.polygonPalette"), "blue");
  assert.equal(JSON.stringify(h.layers.get("polygon-fill").paint["fill-color"]), original);
  const time = h.all(".ai-generated-filter")[0]; time.value = "2026-09-01T00:00:00.000Z";
  await h.change(time);
  assert.deepEqual(labels(), ["-20", "-10", "0", "10", "20", "30", "40"]);
  assert.equal(JSON.stringify(h.layers.get("polygon-fill").paint["fill-color"]), original);
  h.run("state.regionHexEnabled=true; applyStyle()");
  assert.deepEqual(h.layers.get("h3-fill").paint["fill-color"], h.layers.get("polygon-fill").paint["fill-color"]);
  assert.equal(h.layers.get("h3-fill").layout.visibility, "visible");
  h.run("state.regionHexEnabled=false;");
  const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum";
  await h.change(metric);
  assert.equal(h.get("weather-legend-mode").textContent, "Theo ngữ nghĩa");
  assert.equal(h.run("activePolygonLegendScale().field"), "minimum");
  metric.value = "revenue"; await h.change(metric);
  assert.equal(h.get("weather-legend-mode").textContent, "Theo dữ liệu");
  assert.equal(h.get("weather-legend-title").textContent, "Doanh thu (triệu)");
  assert.equal(h.get("fixed-color").disabled, true);
  assert.ok(h.palettes.every(button => button.disabled));
  assert.equal(h.run("state.polygonPalette"), "blue");
  const firstMin = h.run("activePolygonLegendScale().min");
  time.value = "2026-09-02T00:00:00.000Z"; await h.change(time);
  assert.notEqual(h.run("activePolygonLegendScale().min"), firstMin);
  metric.value = "temperature"; await h.change(metric);
  assert.equal(h.get("weather-legend-mode").textContent, "Theo ngữ nghĩa");
  assert.deepEqual(labels(), ["-20", "-10", "0", "10", "20", "30", "40"]);
  h.get("show-map-layers").checked = false; h.run("applyMapLayerVisibility()");
  assert.equal(h.get("weather-legend").hidden, true);
});

test("one upload analysis supplies legends before polygon activation and subsequent interactions make no AI requests", async () => {
  const originalFetch = globalThis.fetch; const requests = [];
  const h = harness({ thematic: true, boundaryLoader: async () => ({
    features: h.dataset.boundaries.features, matched: ["A", "B"], unmatched: [], matchRate: 1, candidates: {}
  }) });
  const profile = profileTabularData(h.dataset.records, { includeSamples: false });
  const raw = {
    columns: h.dataset.analysis.columns.map(column => ({ ...column,
      geoLevel: column.role === "geo" ? "admin1" : null,
      legend: column.role === "measure" ? legendFixture({ aggregation: column.aggDefault }) : null })),
    suggestions: [{ ...h.dataset.suggestions[1], agg: "mean", legend: null,
      popupSuggestions: [{ name: "line", confidence: .96 }, { name: "bar", confidence: .78 }] }]
  };
  globalThis.fetch = async (url, options) => {
    requests.push(url); assert.equal(url, "/api/ai/analyze-map-data");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.profile, profile);
    assert.equal(body.profile.samplesIncluded, false);
    // The server validates once; requestAiDataAnalysis validates this response again.
    return { ok: true, json: async () => validateAndNormalizeAnalysis(raw, body.profile) };
  };
  try {
    h.get("ai-include-samples").checked = false;
    await h.run(`(async () => {
      const result = await analyzeTabularRecords(dataset.records, profileTabularData(dataset.records, {includeSamples:false}));
      dataset.records = result.pipeline.records; dataset.analysis = result.pipeline.analysis;
      dataset.suggestions = result.pipeline.analysis.suggestions.map(item => ({...item, available:true, feasibilityScore:1}));
      dataset.selectedSuggestionId = dataset.suggestions[0].id;
      dataset.popupSelections = {};
      replaceBoundary = async data => { state.boundary = data; state.dataProfile = analyzeSpatialData(data); };
      await activateAiChoropleth(dataset.suggestions[0]);
    })()`);
    assert.equal(h.run("activePolygonLegendScale().source"), "ai");
    assert.equal(h.run("activePolygonLegendScale().max"), 40);
    assert.equal(h.run("activePolygonLegendScale() === activePolygonLegendScale()"), true);
    assert.equal(h.run("popupSelectionFor().mode"), "line");
    h.run("openMapPopup(state.boundary.features[0], [105,21])");
    h.mode("bar");
    const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum"; await h.change(metric);
    const time = h.all(".ai-generated-filter")[0]; time.value = "2026-09-01T00:00:00.000Z"; await h.change(time);
    h.run("state.regionHexEnabled=true; applyStyle(); applyMapLayerVisibility();");
    assert.equal(h.run("activePolygonLegendScale().field"), "minimum");
    assert.equal(h.run("activePolygonLegendScale().source"), "ai");
    assert.deepEqual(h.layers.get("h3-fill").paint["fill-color"], h.layers.get("polygon-fill").paint["fill-color"]);
    h.run("state.regionHexEnabled=false; dataset.geoAliases={A:'A'}; applyStyle();");
    await h.run("activateAiChoropleth(dataset.suggestions[0])");
    assert.equal(h.run("activePolygonLegendScale().source"), "ai");
    assert.equal(h.run("popupSelectionFor().mode"), "bar");
    assert.deepEqual(requests, ["/api/ai/analyze-map-data"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a replacement dataset cannot reuse the previous dataset's resolved legend", async () => {
  const h = harness({ thematic: true });
  h.run("dataset.analysis.columns[2].legend=legendFixture();");
  await h.run("filteredAiBoundary()");
  assert.equal(h.run("activePolygonLegendScale().source"), "ai");
  h.run(`state.aiDataset = {...dataset, polygonLegendScaleCache: undefined,
    analysis: {...dataset.analysis, columns: dataset.analysis.columns.map(column=>({...column, legend:null}))},
    suggestions: dataset.suggestions.map(suggestion=>({...suggestion, legend:null}))};`);
  await h.run("filteredAiBoundary()");
  assert.equal(h.run("activePolygonLegendScale().source"), "technical-fallback");
  assert.equal(h.dataset.analysis.columns[2].legend.mode, "semantic");
});

test("missing or invalid per-field legends fall back immediately without requesting AI", async () => {
  const h = harness({ thematic: true });
  await h.run("filteredAiBoundary()");
  assert.equal(h.run("activePolygonLegendScale().source"), "technical-fallback");
  assert.equal(h.get("weather-legend-mode").textContent, "Chú giải dự phòng");
  h.run("dataset.analysis.columns[2].legend=legendFixture(); dataset.analysis.columns[3].legend=legendFixture({aggregation:'min',stops:[]});");
  await h.run("filteredAiBoundary()");
  assert.equal(h.run("activePolygonLegendScale().source"), "ai");
  const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum"; await h.change(metric);
  assert.equal(h.run("activePolygonLegendScale().source"), "technical-fallback");
  await h.run("filteredAiBoundary()");
  assert.equal(h.run("activePolygonLegendScale().source"), "technical-fallback");
});

test("polygon defaults to information with map controls and accurate map-only suggestions", () => {
  const h = harness();
  assert.equal(h.all(".ai-popup-type").length, 3);
  assert.equal(h.all(".ai-popup-type").find(button => button.dataset.popupMode === "info").attributes["aria-pressed"], "true");
  assert.equal(h.all(".ai-popup-settings").length, 0);
  assert.equal(h.all(".ai-metric-selector").length, 1);
  assert.deepEqual(h.all(".ai-generated-filter").map(control => control.dataset.field), ["date", "region"]);
  h.run("renderAiSuggestionGrid()");
  assert.match(h.get("map-type-summary").textContent, /1 đề xuất/);
  assert.equal(h.get("map-type-grid").children[1].children[1].textContent, AI_CHART_REGISTRY.choropleth.label);
});

test("Polygon, Line and Point show only their AI-ranked popup choices and initialize their own default", () => {
  for (const [mapOptions, popupSuggestions, names, initial] of [
    [{}, [{ name: "info", confidence: .91 }, { name: "line", confidence: .96 }], ["line", "info"], "line"],
    [{ road: true }, [{ name: "bar", confidence: .78 }], ["bar"], "bar"],
    [{ point: true }, [{ name: "info", confidence: 0 }], ["info"], "info"]
  ]) {
    const h = harness({ ...mapOptions, popupSuggestions });
    assert.deepEqual(h.all(".ai-popup-type").map(button => button.dataset.popupMode), names);
    assert.equal(h.run("popupSelectionFor().mode"), initial);
    assert.equal(h.all(".ai-popup-type")[0].attributes["aria-pressed"], "true");
    assert.equal(h.all(".ai-popup-type")[0].disabled, false);
    assert.equal(h.all(".ai-popup-type-score")[0].textContent,
      `${Math.round(Math.max(...popupSuggestions.map(item => item.confidence)) * 100)}%`);
    assert.equal(h.all(".ai-popup-settings").length, initial === "info" ? 0 : 1);
  }
});

test("missing, invalid or entirely impossible popup proposals show only unscored information fallback", () => {
  for (const popupSuggestions of [null, [], [{ name: "pie", confidence: .99 }], [{ name: "info", confidence: "1" }]]) {
    const h = harness({ popupSuggestions });
    assert.deepEqual(h.all(".ai-popup-type").map(button => button.dataset.popupMode), ["info"]);
    assert.equal(h.all(".ai-popup-type")[0].children[1].children[0].textContent, "Hiển thị mặc định");
    assert.equal(h.all(".ai-popup-type-score").length, 0);
    assert.equal(h.run("popupSelectionFor().mode"), "info");
    h.run("openMapPopup(testFeatures[0], [105,21])");
    assert.equal(h.popups[0].card.children.length, 2);
  }
  const h = harness({ popupSuggestions: [{ name: "line", confidence: .99 }] });
  h.dataset.analysis.columns = h.dataset.analysis.columns.filter(column => column.role !== "time");
  h.run("populateAiFilters(dataset)");
  assert.deepEqual(h.all(".ai-popup-type").map(button => button.dataset.popupMode), ["info"]);
  assert.equal(h.all(".ai-popup-type-score").length, 0);
  assert.equal(h.all(".ai-popup-settings").length, 0);
});

test("an impossible higher-ranked line stays disabled while the next available proposal is selected", () => {
  const h = harness({ popupSuggestions: [{ name: "line", confidence: .99 }, { name: "bar", confidence: .1 }] });
  h.dataset.analysis.columns = h.dataset.analysis.columns.filter(column => column.role !== "time");
  h.run("populateAiFilters(dataset)");
  assert.deepEqual(h.all(".ai-popup-type").map(button => button.dataset.popupMode), ["line", "bar"]);
  assert.equal(h.all(".ai-popup-type")[0].disabled, true);
  assert.match(h.all(".ai-popup-type")[0].title, /thời gian/);
  assert.equal(h.run("popupSelectionFor().mode"), "bar");
  assert.equal(h.all(".ai-popup-type")[1].attributes["aria-pressed"], "true");
});

test("changing maps keeps manual popup choices and chart settings scoped to each suggestion", () => {
  const h = harness({ point: true, popupSuggestions: [
    { name: "line", confidence: .96 }, { name: "bar", confidence: .8 }, { name: "info", confidence: .7 }
  ] });
  h.mode("bar");
  const aggregation = h.all(".ai-popup-aggregation")[0]; aggregation.value = "mean"; h.change(aggregation);
  const saved = h.run("JSON.stringify(popupSelectionFor())");
  h.run(`
    dataset.suggestions[1].popupSuggestions=[{name:'info',confidence:1}];
    dataset.selectedSuggestionId='cities'; dataset.recommendation=recommendationForSuggestion(dataset.suggestions[1]);
    populateAiFilters(dataset);
  `);
  assert.deepEqual(h.all(".ai-popup-type").map(button => button.dataset.popupMode), ["info"]);
  assert.equal(h.run("popupSelectionFor().mode"), "info");
  h.run("showChartStyleControls=()=>{}; dataset.selectedSuggestionId='stores'; activateAiPoint(dataset.suggestions[0]);");
  assert.equal(h.run("JSON.stringify(popupSelectionFor())"), saved);
  assert.equal(h.all(".ai-popup-aggregation")[0].value, "mean");
  assert.equal(h.all(".ai-popup-type").find(button => button.dataset.popupMode === "bar").attributes["aria-pressed"], "true");
});

test("AI-default line remains selected for sparse objects and empty chart ranges", () => {
  const h = harness({ popupSuggestions: [{ name: "line", confidence: .96 }] });
  h.dataset.records.forEach(record => { if (record.region === "A" && record.date.getUTCDate() !== 1) record.temperature = null; });
  h.run("openMapPopup(testFeatures[0], [105,21])");
  assert.equal(h.run("popupSelectionFor().mode"), "line");
  assert.match(h.popups[0].card.children[0].textContent, /hai mốc/);
  assert.equal(h.rendered.length, 0);
  h.run("openMapPopup(testFeatures[1], [106,21])");
  assert.equal(h.rendered.at(-1).kind, "line");
  h.run("popupSelectionFor().line.from='2027-01-01'; popupSelectionFor().line.to='2027-01-02'; refreshMapPopup();");
  assert.match(h.popups.at(-1).card.children[0].textContent, /khoảng thời gian/);
  assert.equal(h.run("popupSelectionFor().mode"), "line");
});

test("a replacement upload chooses its AI default instead of the previous manual popup mode", async () => {
  const h = harness({ popupSuggestions: [{ name: "line", confidence: .96 }, { name: "bar", confidence: .8 }] });
  h.mode("bar"); h.run("openMapPopup(testFeatures[0], [105,21])");
  h.run(`
    showChartStyleControls = () => {};
    selectAiSuggestion = async id => {
      const suggestion=state.aiDataset.suggestions.find(item=>item.id===id);
      state.aiDataset.selectedSuggestionId=id; state.aiDataset.recommendation=recommendationForSuggestion(suggestion);
      populateAiFilters(state.aiDataset); return true;
    };
  `);
  await h.run("replaceAiPipelineData({records:dataset.records,analysis:{...dataset.analysis,suggestions:dataset.suggestions},validRowRate:{region:1,date:1,temperature:1,minimum:1}}, 'new.csv')");
  assert.equal(h.run("popupSelectionFor().mode"), "line");
  assert.equal(h.run("popupSelectionFor().bar"), null);
  assert.equal(h.popups[0].removed, true);
  assert.equal(h.all(".ai-popup-type")[0].attributes["aria-pressed"], "true");
});

test("polygon filters geographic and categorical columns with cascading choices regardless of field names", async () => {
  for (const [country, area, category] of [["nation_code", "division", "channel"], ["Thị trường", "Chi nhánh", "Nhóm khách hàng"]]) {
    const h = harness();
    const metricColumns = h.dataset.analysis.columns.filter(column => column.role === "measure");
    h.dataset.analysis.columns = [
      { name: area, role: "geo", geoLevel: "admin1" },
      { name: category, role: "category" },
      { name: "date", role: "time" }, ...metricColumns,
      { name: country, role: "geo", geoLevel: "country" },
      { name: "latitude", role: "geo", geoLevel: "point_lat" },
      { name: "note", role: "text" }, { name: "row_id", role: "id" }
    ];
    h.dataset.records = [1, 3].flatMap(day => [
      ["A", "Northport", "Retail", 20], ["A", "Northport", "Wholesale", 30],
      ["A", "Westport", "Retail", 40], ["B", "Southport", "Retail", 10]
    ].map(([nation, division, channel, temperature], index) => ({
      [country]: nation, [area]: division, [category]: channel,
      date: new Date(`2026-09-0${day}`), temperature: temperature + day - 3, minimum: temperature - 5,
      latitude: 21, note: `Observation ${day}/${index}`, row_id: `${day}/${index}`
    })));
    h.dataset.suggestions[1].bindings.region = country;
    h.run("fitBoundary = () => {}; dataset.recommendation = recommendationForSuggestion(dataset.suggestions[1]); populateAiFilters(dataset);");
    const control = field => h.all(".ai-generated-filter").find(item => item.dataset.field === field);
    const options = field => control(field).children.map(option => option.value);
    assert.deepEqual(h.all(".ai-generated-filter").map(item => item.dataset.field), ["date", country, area, category]);
    assert.deepEqual(options(country), ["", "A", "B"], "geographic parents precede children even when file columns are reversed");
    assert.equal(control(country).attributes["aria-label"], `Lọc theo ${country}`);
    await h.run("filteredAiBoundary()");
    assert.equal(h.sources.get("polygon-data").data.features.length, 2);

    control(country).value = "A"; await h.change(control(country));
    assert.deepEqual(options(area), ["", "Northport", "Westport"]);
    control(area).value = "Northport"; await h.change(control(area));
    assert.equal(h.sources.get("polygon-data").data.features[0].properties.temperature, 25, "filters apply before aggregation");
    control(category).value = "Retail"; await h.change(control(category));
    assert.equal(h.sources.get("polygon-data").data.features[0].properties.temperature, 20);
    assert.deepEqual(options(country), ["", "A", "B"], "a selected child must not remove other parent choices");

    h.mode("bar");
    h.run("openMapPopup(state.boundary.features[0], [105,21])");
    assert.deepEqual(h.rendered.at(-1).config.data.map(row => row.temperature), [18, 20], "popup respects dimension filters and retains its own time range");
    assert.equal(control(country).value, "A");
    assert.equal(control(area).value, "Northport");
    const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum"; await h.change(metric);
    assert.equal(h.sources.get("polygon-data").data.features[0].properties.minimum, 15);
    assert.equal(control(category).value, "Retail");

    control(category).value = "Wholesale"; await h.change(control(category));
    control(country).value = "B"; await h.change(control(country));
    assert.deepEqual(options(area), ["", "Southport"]);
    assert.equal(control(area).value, "", "changing a parent clears an incompatible child");
    assert.equal(control(category).value, "", "all incompatible downstream dimensions reset");
    assert.equal(h.sources.get("polygon-data").data.features[0].properties[country], "B");
    assert.equal(h.popups.at(-1).removed, true, "filtering out an open region closes its popup");
    assert.equal(control("date").value, "2026-09-03T00:00:00.000Z");

    control(country).value = ""; await h.change(control(country));
    assert.equal(h.sources.get("polygon-data").data.features.length, 2, "all restores the full dataset");
  }
});

test("default bar metric with spreadsheet whitespace keeps visible values after switching away and back", async () => {
  const h = harness();
  h.run(`
    const metricName='Nhiệt độ trung bình ';
    dataset.records.forEach(record=>{record[metricName]=record.temperature;delete record.temperature;});
    const column=dataset.analysis.columns.find(column=>column.name==='temperature');
    column.name=metricName;column.labelVi='Nhiệt độ trung bình';
    dataset.suggestions[1].bindings.value=metricName;
    dataset.recommendation.metricField=metricName;
    dataset.recommendation.numericFields=[metricName,'minimum'];
    populateAiFilters(dataset);
  `);
  h.mode("bar"); h.run("openMapPopup(testFeatures[0], {lng:105,lat:21})");
  const values = () => {
    const config = h.rendered.at(-1).config;
    return config.data.map(row => row[config.series[0].key]);
  };
  assert.deepEqual(values(), [1, 2, 3]);
  let metric = h.all(".ai-popup-metric")[0]; metric.value = "minimum"; await h.change(metric);
  assert.deepEqual(values(), [0, 1, 2]);
  metric = h.all(".ai-popup-metric")[0]; metric.value = "Nhiệt độ trung bình "; await h.change(metric);
  assert.deepEqual(values(), [1, 2, 3]);
});

test("count coloring and popup values use record units rather than the source measure unit", async () => {
  const h = harness({ thematic: true });
  h.run("dataset.suggestions[1].agg='count'; dataset.recommendation=recommendationForSuggestion(dataset.suggestions[1]);");
  await h.run("filteredAiBoundary()");
  assert.equal(h.run("activePolygonLegendScale().unit"), "bản ghi");
  assert.equal(h.get("weather-legend-title").textContent, "Số bản ghi");
  const rows = JSON.parse(h.run("JSON.stringify(aiWeatherPopupContent(state.boundary.features[0]).children[1].children.map(row=>row.children.map(cell=>cell.textContent)))"));
  assert.ok(rows.some(([label, value]) => label === "Số bản ghi" && value === "1"));
});

test("country choropleth requests global country boundaries and never forces a Vietnam clipping option", async () => {
  const clipped = [];
  const h = harness({
    boundaryLoader: async (names, options) => {
      assert.deepEqual([...names], ["A", "B"]);
      assert.equal(options.placeType, "country");
      assert.equal(options.country, null);
      return { type: "FeatureCollection", matchRate: 1, matched: names, unmatched: [], candidates: {},
        features: names.map(name => ({ type: "Feature", place_type: ["country"],
          properties: { __data_location: name, boundary_source: "MapTiler" },
          geometry: { type: "Polygon", coordinates: [] } })) };
    },
    boundaryClipper: async (boundary, options) => {
      clipped.push(options);
      assert.equal(options.country, undefined);
      return boundary;
    }
  });
  h.run(`dataset.analysis.columns[0].geoLevel = 'country'; dataset.analysis.columns[0].country = 'VN';
    dataset.suggestions[1].confidence = .9; dataset.suggestions[1].feasibilityScore = 1;
    replaceBoundary = async () => {}; filteredAiBoundary = async () => {}; renderAiSuggestionGrid = () => {};`);
  assert.equal(await h.run("activateAiChoropleth(dataset.suggestions[1])"), true);
  assert.equal(clipped.length, 2);
  assert.equal(h.dataset.recommendation.geometry.placeType, "country");
  assert.equal(h.dataset.recommendation.geometry.country, null);
});

test("regional choropleth qualifies duplicate area names by each row's country throughout activation and filtering", async () => {
  const clipped = [];
  const h = harness({
    boundaryLoader: async (names, options) => {
      assert.deepEqual([...names], ["Central, Việt Nam", "Central, Thái Lan"]);
      assert.equal(options.country, null, "a constant country in column metadata must not override row context");
      assert.equal(options.contexts["Central, Việt Nam"].country, "Việt Nam");
      assert.equal(options.contexts["Central, Thái Lan"].country, "Thái Lan");
      return { type: "FeatureCollection", matchRate: 1, matched: names, unmatched: [], candidates: {},
        features: names.map((name, index) => ({ type: "Feature", id: `region.${index}`, properties: { __data_location: name },
          geometry: { type: "Polygon", coordinates: [] } })) };
    },
    boundaryClipper: async (feature, options) => { clipped.push(options.country); return feature; }
  });
  h.dataset.analysis.columns[0].geoLevel = "admin1";
  h.dataset.analysis.columns[0].country = "VN";
  h.dataset.analysis.columns.push({ name: "market", role: "geo", geoLevel: "country" });
  h.dataset.records = ["Việt Nam", "Thái Lan"].flatMap((market, index) => [1, 2].map(day => ({ market, region: "Central",
    date: new Date(`2026-09-0${day}`), temperature: 20 + index * 10 + day, minimum: 10 + index + day })));
  h.run(`
    dataset.suggestions[1].confidence=.9; dataset.suggestions[1].feasibilityScore=1;
    replaceBoundary=async data=>{state.boundary=data;state.dataProfile=analyzeSpatialData(data);};
    fitBoundary=()=>{};
  `);
  assert.equal(await h.run("activateAiChoropleth(dataset.suggestions[1])"), true);
  assert.deepEqual(clipped, ["Việt Nam", "Thái Lan"]);
  assert.deepEqual(h.sources.get("polygon-data").data.features.map(feature => feature.properties.temperature), [22, 32]);
  h.run("openMapPopup(state.boundary.features[0], [105,21])");
  const country = h.all(".ai-generated-filter").find(control => control.dataset.field === "market");
  country.value = "Thái Lan"; await h.change(country);
  assert.equal(h.sources.get("polygon-data").data.features.length, 1);
  assert.equal(h.sources.get("polygon-data").data.features[0].properties.temperature, 32);
  assert.equal(h.popups.at(-1).removed, true, "a same-name region in another country cannot replace the open region");
});

test("ambiguous geographic names show provinces and retries join exactly the chosen geometry", async () => {
  const h = harness();
  h.dataset.geoAliases = { "Tên đã sửa": "Tên đúng" };
  const first = { id: "municipality.first", place_name: "Xã Tân Châu, Việt Nam", center: [105, 20],
    properties: { __province_name: "Tỉnh Tây Ninh" }, geometry: { type: "Polygon", coordinates: [[[105, 20], [106, 20], [105, 21], [105, 20]]] } };
  const second = { id: "municipality.second", place_name: "Xã Tân Châu, Việt Nam", center: [106, 21],
    properties: { __province_name: "An Giang" }, geometry: { type: "Polygon", coordinates: [[[106, 21], [107, 21], [106, 22], [106, 21]]] } };
  h.dataset.geoMatch = { candidates: { "xã Tân Châu": [first, second] } };
  h.run(`renderGeoRepair(['xã Tân Châu']); activateAiChoropleth = async () => { dataset.retried = true; };`);
  const choice = h.all(".geo-boundary-choice")[0];
  assert.equal(choice.value, "", "do not preselect the first same-name region");
  assert.equal(choice.children.length, 3);
  assert.equal(choice.children[1].textContent, "Xã Tân Châu — Tây Ninh");
  assert.equal(choice.children[2].textContent, "Xã Tân Châu — An Giang");
  for (const feature of [first, second]) {
    choice.value = feature.id;
    h.click(h.all(".apply-geo-aliases")[0]);
    assert.equal(h.dataset.geoSelections["xã Tân Châu"], feature);
    const boundaries = await loadAdministrativeBoundaries(["xã Tân Châu"], {
      selections: h.dataset.geoSelections, fetchImpl: () => assert.fail("do not search again after a user chooses a polygon")
    });
    const joined = joinRecordsToMapTilerBoundaries([{ region: "xã Tân Châu", value: 30 }], boundaries, {
      geometry: { field: "region" }, metricField: "value"
    });
    assert.equal(joined.features[0].geometry, feature.geometry);
    assert.equal(joined.features[0].properties.value, 30);
    assert.equal(joined.features[0].properties.__location, "xã Tân Châu");
  }
  assert.equal(h.dataset.geoAliases["Tên đã sửa"], "Tên đúng");
  assert.equal(h.dataset.retried, true);

  h.all(".geo-alias-input")[0].value = "xã Tân Châu, Hưng Yên";
  h.click(h.all(".apply-geo-aliases")[0]);
  assert.equal(h.dataset.geoSelections["xã Tân Châu"], undefined, "a new query invalidates the old polygon choice");
  assert.equal(h.dataset.geoAliases["xã Tân Châu"], "xã Tân Châu, Hưng Yên");
  assert.equal(h.dataset.geoAliases["Tên đã sửa"], "Tên đúng");
});

test("popup switches charts, preserves map and per-kind settings, and releases chart roots", () => {
  const h = harness();
  h.mode("bar");
  assert.equal(h.run("state.mapType"), "polygon"); assert.equal(h.run("state.chartConfig"), null);
  assert.equal(h.all(".ai-popup-settings").length, 1);
  assert.equal(h.all(".ai-popup-range").length, 2);
  assert.equal(h.popups.length, 0, "choosing a type must not open a popup");
  h.run("openMapPopup(testFeatures[0], [105, 21])");
  assert.equal(h.rendered.at(-1).config.data.length, 3);
  h.mode("line");
  assert.equal(h.cleared.length, 1); assert.equal(h.rendered.at(-1).kind, "line");
  const metric = h.all(".ai-popup-metric")[0]; metric.value = "minimum"; h.change(metric);
  h.mode("info"); assert.equal(h.all(".ai-popup-settings").length, 0);
  h.mode("line"); assert.equal(h.all(".ai-popup-metric")[0].value, "minimum");
  h.run("openMapPopup(testFeatures[1], [106, 21])");
  assert.equal(h.popups[0].removed, true); assert.equal(h.rendered.at(-1).config.title, "Biểu đồ đường · B");
  h.run("closeMapPopup()");
  assert.equal(h.popups.at(-1).removed, true); assert.equal(h.run("mapPopupView"), null);
});

test("map date and map metric changes update open popup information without changing chart range or metric", async () => {
  const h = harness(); h.mode("line"); h.run("openMapPopup(testFeatures[0], [105,21])");
  const before = JSON.stringify(h.rendered.at(-1).config.data);
  const date = h.all(".ai-generated-filter")[0]; date.value = "2026-09-01T00:00:00.000Z";
  h.run("syncPolygonPaletteControls = () => {}; applyStyle = () => {};");
  await h.change(date);
  assert.equal(h.run("mapPopupView.feature.properties.temperature"), 1);
  assert.equal(JSON.stringify(h.rendered.at(-1).config.data), before);
  const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum";
  await h.change(metric);
  assert.equal(h.dataset.recommendation.metricField, "minimum");
  assert.equal(h.rendered.at(-1).config.series[0].key, "temperature");
  assert.equal(h.run("state.boundary.features.length"), 2);
  h.run("clearAiMapState()"); assert.equal(h.popups.at(-1).removed, true);
});

test("popup bar calculations summarize the selected range and switching back restores time observations", async () => {
  const h = harness(); h.mode("bar"); h.run("openMapPopup(testFeatures[0], [105,21])");
  const mapFilters = JSON.stringify(h.dataset.filters);
  const calculate = async value => {
    const control = h.all(".ai-popup-aggregation")[0]; control.value = value; await h.change(control);
    return h.rendered.at(-1).config;
  };
  let config = await calculate("sum");
  assert.deepEqual(config.data, [{ [config.xField]: "A", temperature: 6 }]);
  assert.equal(config.timeColumn, null);
  const from = h.all(".ai-popup-range").find(control => control.dataset.edge === "from");
  from.value = "2026-09-02T00:00:00.000Z"; await h.change(from);
  assert.equal(h.rendered.at(-1).config.data[0].temperature, 5);
  config = await calculate("mean");
  assert.deepEqual(config.data, [{ [config.xField]: "A", temperature: 2.5 }]);
  config = await calculate("auto");
  assert.deepEqual(config.data.map(row => row.temperature), [2, 3]);
  assert.equal(config.xField, "date");
  assert.ok(config.timeColumn);
  assert.equal(h.all(".ai-popup-aggregation")[0].children[0].textContent, "Theo dữ liệu");
  assert.equal(JSON.stringify(h.dataset.filters), mapFilters);
  assert.equal(h.popups.length, 1, "changing calculations refreshes the existing popup");
});

test("date ranges remain ordered and grouped bar controls apply selected aggregation", async () => {
  const h = harness(); h.mode("bar");
  h.click(h.all(".ai-bar-chart-type").find(button => button.dataset.popupBarVariant === "grouped"));
  assert.equal(h.all(".ai-popup-metric-checkbox").length, 3);
  const aggregate = h.all(".ai-popup-aggregation")[0]; aggregate.value = "sum"; await h.change(aggregate);
  const from = h.all(".ai-popup-range").find(control => control.dataset.edge === "from"); from.value = "2026-09-03T00:00:00.000Z"; await h.change(from);
  const to = h.all(".ai-popup-range").find(control => control.dataset.edge === "to"); to.value = "2026-09-01T00:00:00.000Z"; await h.change(to);
  assert.equal(h.all(".ai-popup-range")[0].value, "2026-09-01T00:00:00.000Z");
  h.run("openMapPopup(testFeatures[0], [105,21])");
  assert.equal(h.rendered.at(-1).config.variant, "grouped");
  assert.equal(h.rendered.at(-1).config.aggregation, "sum");
  const config = h.rendered.at(-1).config;
  assert.deepEqual(config.data, [{ [config.xField]: "A", temperature: 1, minimum: 0 }]);
});

test("a new upload resets popup settings and prioritizes polygon over higher-scored line", async () => {
  const h = harness(); h.mode("bar"); h.run("openMapPopup(testFeatures[0], [105,21])");
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
  assert.deepEqual(h.all(".ai-generated-filter").map(control => control.dataset.field), ["region"]);
  assert.equal(h.all(".ai-popup-type").find(button => button.dataset.popupMode === "line").disabled, true);
  h.mode("bar"); h.run("openMapPopup(testFeatures[0], [105,21])");
  assert.equal(h.rendered.at(-1).config.data.length, 1);
});

test("Bản đồ Line offers popup modes and keeps only maps in section 2", () => {
  const h = harness({ road: true });
  h.run("renderAiSuggestionGrid()");
  assert.equal(h.get("map-type-grid").children.length, 2);
  assert.equal(h.get("map-type-grid").children[1].children[1].textContent, "Bản đồ Line");
  assert.match(h.get("map-type-summary").textContent, /1 đề xuất/);
  assert.equal(h.all(".ai-popup-type").length, 3);
  assert.equal(h.all(".ai-popup-settings").length, 0);
  assert.deepEqual([...new Set(h.all(".ai-generated-filter").map(control => control.dataset.field))], ["Khu vực", "Tên đường", "Thời điểm"]);
  h.run("openMapPopup(state.lineData.features[0], [105.8,21], 'data-lines')");
  assert.equal(h.popups[0].card.children.length, 2, "information mode retains the source information cards");
  h.mode("bar");
  assert.equal(h.run("state.mapType"), "line"); assert.equal(h.run("state.chartConfig"), null);
  assert.equal(h.popups[0].card.children.length, 1, "chart mode hides all information above the chart");
  assert.deepEqual(h.rendered.at(-1).config.data.map(row => row[TRAFFIC_SPEED]), [24, 20, 38]);
  h.mode("line");
  assert.equal(h.rendered.at(-1).kind, "line");
  assert.equal(h.all(".ai-popup-metric")[0].value, TRAFFIC_SPEED);
  assert.ok(h.all(".ai-popup-range")[0].children[0].textContent.includes("08:00"));
  h.mode("info");
  assert.equal(h.popups[0].card.children.length, 2);
  assert.equal(h.all(".ai-popup-settings").length, 0);
});

test("road map time and color remain independent of popup charts; hidden routes close the popup", async () => {
  const h = harness({ road: true }); h.mode("line");
  h.run("openMapPopup(state.lineData.features[0], [105.8,21], 'data-lines'); fitGeoJSON = () => {};");
  const before = JSON.stringify(h.rendered.at(-1).config.data);
  const range = JSON.stringify(h.run("popupSelectionFor().line"));
  const time = h.all(".ai-generated-filter").find(control => control.dataset.field === "Thời điểm");
  time.value = time.children[0].value; await h.change(time);
  assert.equal(h.run(`mapPopupView.feature.properties[${JSON.stringify(TRAFFIC_SPEED)}]`), 24);
  assert.equal(JSON.stringify(h.rendered.at(-1).config.data), before);
  assert.equal(JSON.stringify(h.run("popupSelectionFor().line")), range);
  assert.equal(h.popups.length, 1);
  const metric = h.all(".ai-metric-selector")[0]; metric.value = TRAFFIC_SPEED; await h.change(metric);
  assert.equal(JSON.stringify(h.rendered.at(-1).config.data), before);
  const road = h.all(".ai-generated-filter").find(control => control.dataset.field === "Tên đường" && control.value === "Đường Ngọc Hồi");
  road.checked = true; await h.change(road);
  assert.equal(h.run("mapPopupView"), null);
  assert.equal(h.popups[0].removed, true);
  assert.ok(h.cleared.length);
});

test("new traffic data selects Bản đồ Line even when chart confidence is higher", async () => {
  const h = harness({ road: true });
  h.run(`
    analyzeBarData = () => { throw new Error('no legacy chart'); };
    prepareSuggestions = () => dataset.suggestions;
    showChartStyleControls = () => {};
    selectAiSuggestion = async id => { globalThis.selectedId = id; return true; };
  `);
  await h.run("replaceAiPipelineData({records: dataset.records, analysis: dataset.analysis}, 'traffic.csv')");
  assert.equal(h.run("selectedId"), "traffic-map-line");
  assert.equal(h.run("Object.keys(state.aiDataset.popupSelections).length"), 0);
});

test("Point defaults to information and switches chart-only popups for the clicked store", () => {
  const h = harness({ point: true });
  assert.equal(h.all(".ai-popup-type").length, 3);
  assert.equal(h.all(".ai-popup-settings").length, 0);
  assert.equal(h.all(".ai-point-time").length, 1);
  assert.equal(h.all(".ai-point-range").length, 0);
  assert.equal(h.all(".ai-point-time")[0].value, "2026-03-01T00:00:00.000Z");
  assert.equal(h.sources.get("point-data").data.features.length, 2);
  h.run("renderAiSuggestionGrid(); openMapPopup(state.pointData.features[0], [105.85,21.02], 'point-marker')");
  assert.match(h.get("map-type-summary").textContent, /2 đề xuất/);
  assert.equal(h.popups[0].card.children.length, 2);
  h.mode("bar");
  assert.equal(h.run("state.mapType"), "point");
  assert.equal(h.popups[0].card.children.length, 1);
  assert.deepEqual(h.rendered.at(-1).config.data.map(row => row.doanh_thu_vnd), [0, null, 200]);
  h.mode("line");
  assert.equal(h.rendered.at(-1).kind, "line");
  h.run("openMapPopup(state.pointData.features.find(feature => feature.properties.ma_cua_hang === 'CH02'), [105.83,21.04], 'point-marker')");
  assert.equal(h.popups[0].removed, true);
  assert.match(h.rendered.at(-1).config.title, /CH02/);
  assert.deepEqual(h.rendered.at(-1).config.data.map(row => row.doanh_thu_vnd), [1000, null, 1200]);
  h.mode("info");
  assert.equal(h.all(".ai-popup-settings").length, 0);
  assert.equal(h.popups.at(-1).card.children.length, 2);
  assert.ok(h.cleared.length >= 3);
});

test("Point map time/metric filters preserve chart range and close popups for hidden objects", async () => {
  const h = harness({ point: true }); h.mode("line");
  h.run("openMapPopup(state.pointData.features[0], [105.85,21.02], 'point-marker')");
  const before = JSON.stringify(h.rendered.at(-1).config.data);
  const time = h.all(".ai-point-time")[0];
  time.value = "2026-01-01T00:00:00.000Z"; await h.change(time);
  assert.equal(h.run("mapPopupView.feature.properties.doanh_thu_vnd"), 0);
  assert.equal(h.sources.get("point-data").data.features.length, 2);
  assert.equal(JSON.stringify(h.rendered.at(-1).config.data), before);
  const metric = h.all(".ai-point-metric")[0]; metric.value = "chi_phi_vnd"; await h.change(metric);
  assert.equal(h.run("state.aiDataset.activePointView.selection.metricField"), "chi_phi_vnd");
  assert.equal(h.rendered.at(-1).config.series[0].key, "doanh_thu_vnd");
  const group = h.all(".ai-point-value").find(control => control.value === "Cửa hàng CH01");
  group.checked = false; await h.change(group);
  assert.equal(h.run("mapPopupView"), null);
  assert.equal(h.popups[0].removed, true);
});

test("Point display selector includes text store names and a city with a single value", () => {
  const h = harness({ point: true, storeNameRole: "text" });
  const group = h.all(".ai-point-group")[0];
  assert.equal(group.parentElement.children[0].textContent, "Hiển thị theo");
  assert.deepEqual(group.children.map(option => option.value), ["ten_cua_hang", "thanh_pho"]);
  group.value = "thanh_pho"; h.change(group);
  assert.deepEqual(h.all(".ai-point-value").map(input => input.value), ["Hà Nội"]);
  assert.equal(h.sources.get("point-data").data.features.length, 2);
});

test("Point city selection filters stores, preserves one map time and keeps each store's chart separate", async () => {
  const pointRecords = [...storeRecords, ...storeRecords.filter(record => record.ma_cua_hang === "CH02").map(record => ({
    ...record, ma_cua_hang: "CH03", ten_cua_hang: "Cửa hàng CH03", thanh_pho: "Đà Nẵng", vi_do: 16.06, kinh_do: 108.2
  }))];
  const h = harness({ point: true, pointRecords });
  const time = h.all(".ai-point-time")[0]; time.value = "2026-01-01T00:00:00.000Z"; await h.change(time);
  const group = h.all(".ai-point-group")[0]; group.value = "thanh_pho"; await h.change(group);
  const city = h.all(".ai-point-value").find(control => control.value === "Đà Nẵng");
  city.checked = false; await h.change(city);
  assert.deepEqual(h.sources.get("point-data").data.features.map(feature => feature.properties.ma_cua_hang), ["CH01", "CH02"]);
  assert.equal(h.all(".ai-point-time")[0].value, "2026-01-01T00:00:00.000Z");
  h.mode("line");
  h.run("openMapPopup(state.pointData.features.find(feature => feature.properties.ma_cua_hang === 'CH02'), [105.83,21.04], 'point-marker')");
  assert.deepEqual(h.rendered.at(-1).config.data.map(row => row.doanh_thu_vnd), [1000, null, 1200]);
  assert.equal(h.all(".ai-popup-range").length, 2);
  const mode = h.all(".ai-point-mode")[0]; mode.value = "all"; await h.change(mode);
  assert.equal(h.sources.get("point-data").data.features.length, 3);
  assert.equal(h.all(".ai-point-time").length, 1);
});

test("new store data accepts a single city polygon in AI priority order and resets popup settings", async () => {
  const h = harness({ point: true }); h.mode("bar");
  h.run("showChartStyleControls = () => {}; selectAiSuggestion = async id => { globalThis.selectedId = id; return true; };");
  await h.run("replaceAiPipelineData({records: dataset.records, analysis: {...dataset.analysis, suggestions: dataset.suggestions}}, 'stores.csv')");
  assert.equal(h.run("selectedId"), "cities");
  assert.equal(h.run("Object.keys(state.aiDataset.popupSelections).length"), 0);
});

test("coordinate Line uses source row order without road network loading and retains popup behavior", async () => {
  const h = harness({ path: true });
  h.run("fitGeoJSON = () => {}; showChartStyleControls = () => {}; fetch = () => { throw new Error('must not fetch roads'); };");
  await h.run("activateAiRoadMap(dataset.suggestions[0])");
  assert.equal(h.run("dataset.recommendation.geometry.provider"), "coordinates");
  assert.equal(h.run("state.lineData.features[0].geometry.type"), "LineString");
  assert.equal(JSON.stringify(h.run("state.lineData.features[0].geometry.coordinates")), JSON.stringify([[105.03,21.03],[105.01,21.01],[105.02,21.02]]));
  assert.equal(h.all(".ai-popup-type").find(control => control.dataset.popupMode === "line").disabled, true);
  h.mode("bar");
  h.run("openMapPopup(state.lineData.features[0], [105.02,21.02], 'data-lines')");
  assert.equal(h.rendered.at(-1).config.data[0].speed, 20);
  assert.equal(h.popups[0].card.children.length, 1);
});

test("coordinate Line keeps coordinate/order fields out of metric controls and applies map colors independently", () => {
  const h = harness({ path: true });
  h.run(`
    dataset.analysis.columns = dataset.analysis.columns.map(column => column.role === 'geo' ? {...column, role:'measure'} : column);
    dataset.analysis.columns.push({name:'stt', role:'measure'});
    dataset.records = dataset.records.map((record, index) => ({...record, stt:index+1}));
    dataset.suggestions[0].bindings.x='stt';
    dataset.recommendation=recommendationForSuggestion(dataset.suggestions[0]);
    populateAiFilters(dataset); refreshAiRoadMap();
  `);
  assert.deepEqual(h.all(".ai-metric-selector")[0].children.map(option => option.value), ["speed"]);
  h.mode("bar");
  assert.deepEqual(h.all(".ai-popup-metric")[0].children.map(option => option.value), ["count", "speed"]);
  h.run("openMapPopup(state.lineData.features[0], [105.02,21.02], 'data-lines')");
  const before = h.rendered.length;
  const control = h.get("road-style-colors").querySelector(".road-style-color");
  control.value = "#123456"; h.get("road-style-controls").events.change({ target: control });
  assert.equal(h.run("dataset.roadStyle.color[2]"), "#123456");
  assert.equal(h.rendered.length, before, "changing map color does not rebuild popup charts");
});


test("image information follows AI rank, keeps image navigation out of chart settings, and switches modes without AI", () => {
  const h = harness({ point: true, popupSuggestions: [{ name: "info_image", confidence: .99 }, { name: "info", confidence: .9 }, { name: "bar", confidence: .8 }] });
  h.run(`dataset.analysis.columns.push({name:'photo',role:'text'}, {name:'description',role:'text'});
    dataset.analysis.popupContent = {titleField:'ten_cua_hang',imageFields:['photo'],descriptionFields:['description']};
    dataset.records.forEach(record => {record.photo='https://example.org/photo'; record.description='<b>Thông tin gốc</b>';});
    dataset.popupSelections = {}; populatePointControls(activeMapPopupSuggestion());
    openMapPopup({...state.pointData.features[0], geometry:{type:'Point',coordinates:[105.85,21.02]}}, [105.85,21.02], 'point-marker');`);
  assert.equal(h.run('popupSelectionFor().mode'), 'info_image');
  assert.equal(h.all('.ai-popup-settings').length, 0);
  assert.equal(h.popups[0].card.className, 'info-image-popup');
  assert.equal(h.run('popupSelectionFor().info_image'), undefined);
  h.mode('bar'); assert.ok(h.all('.ai-popup-settings').length);
  assert.equal(h.rendered.at(-1).kind, 'bar');
  h.mode('info_image'); assert.equal(h.all('.ai-popup-settings').length, 0);
  assert.equal(h.popups[0].card.className, 'info-image-popup');
  h.run(`options.popupMetadata = () => ({hasJoinedImages: true, popupSuggestions:[{name:'info_image', confidence:1}]}); populatePointControls(activeMapPopupSuggestion());`);
  assert.equal(h.run('popupSelectionFor().mode'), 'info_image');
  h.mode('info');
  h.run('populatePointControls(activeMapPopupSuggestion())');
  assert.equal(h.run('popupSelectionFor().mode'), 'info', 'new suggestions preserve an available user choice');
  h.run('dataset.analysis.popupContent = null; options.popupMetadata = () => ({}); populatePointControls(activeMapPopupSuggestion())');
  assert.equal(h.run('popupSelectionFor().mode'), 'info');
});

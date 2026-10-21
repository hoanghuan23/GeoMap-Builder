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
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { administrativeBoundaryLabel, loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { analyzeSpatialData } from "../src/data-capabilities.js";
import * as roadMap from "../src/road-map-data.js";
import * as coordinates from "../src/coordinate-data.js";
import * as pointStyle from "../src/renderers/point-style.js";
import * as polygonStyle from "../src/renderers/polygon-style.js";
import * as weatherStyle from "../src/renderers/weather-style.js";
import * as polygonLegend from "../src/polygon-legend.js";
import * as legendContract from "../src/polygon-legend-contract.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";
import { storeColumns, storeRecords, storeSuggestions } from "./fixtures/store-points-fixture.js";
import { normalizeTabularRecords, profileTabularData } from "../src/tabular-data.js";
import { trafficAiAnalysis, trafficRecords, TRAFFIC_SPEED } from "./fixtures/road-traffic-fixture.js";
import { normalizeBarChartConfig } from "../src/charts/bar-chart.js";

class Element {
  constructor() {
    this.children = []; this.dataset = {}; this.attributes = {}; this.events = {}; this.value = ""; this.checked = true;
    this.className = ""; this.textContent = ""; this.style = { setProperty() {} }; this.clientWidth = 800; this.clientHeight = 600;
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
  const context = vm.createContext({
    ...popupChart, ...pipeline, ...times, ...roadMap, ...coordinates, ...pointStyle, ...polygonStyle, ...weatherStyle, ...polygonLegend, ...legendContract,
    fetch: fetchImpl, requestAiDataAnalysis, profileTabularData, loadAdministrativeBoundaries: boundaryLoader, landOnlyBoundary: boundaryClipper, legendFixture, AI_CHART_REGISTRY, comparableFilterValue, displayFilterValue, createAiPopupContent, joinRecordsToMapTilerBoundaries, administrativeBoundaryLabel, analyzeSpatialData,
    CONFIG: { DEFAULT_RESOLUTION: 5 }, DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {},
    BarRenderer: renderer("bar"), LineRenderer: renderer("line"),
    humanizeField: field => field, renderMapIcon() {}, renderChartIcon() {}, keepSelectOpenAfterMouseClick: value => value,
    document: { getElementById: get, createElement: () => new Element(), querySelector: () => new Element(), addEventListener() {},
      querySelectorAll: selector => selector === "#polygon-color-ramp .palette" ? palettes : selector.startsWith("#ai-filter-controls ") ? get("ai-filter-controls").querySelectorAll(selector.slice(20))
        : selector.startsWith(".geo-") ? get("ai-filter-controls").querySelectorAll(selector) : [] },
    maplibregl: { Popup }, AbortController, Date, console, setTimeout() {}, clearTimeout() {}, dataset, testMap: map, testFeatures: features
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/\binit\(\);\s*$/, "");
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
    suggestions: [{ ...h.dataset.suggestions[1], agg: "mean", legend: null }]
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
      replaceBoundary = async data => { state.boundary = data; state.dataProfile = analyzeSpatialData(data); };
      await activateAiChoropleth(dataset.suggestions[0]);
    })()`);
    assert.equal(h.run("activePolygonLegendScale().source"), "ai");
    assert.equal(h.run("activePolygonLegendScale().max"), 40);
    assert.equal(h.run("activePolygonLegendScale() === activePolygonLegendScale()"), true);
    const metric = h.all(".ai-metric-selector")[0]; metric.value = "minimum"; await h.change(metric);
    const time = h.all(".ai-generated-filter")[0]; time.value = "2026-09-01T00:00:00.000Z"; await h.change(time);
    h.run("state.regionHexEnabled=true; applyStyle(); applyMapLayerVisibility();");
    assert.equal(h.run("activePolygonLegendScale().field"), "minimum");
    assert.equal(h.run("activePolygonLegendScale().source"), "ai");
    assert.deepEqual(h.layers.get("h3-fill").paint["fill-color"], h.layers.get("polygon-fill").paint["fill-color"]);
    h.run("state.regionHexEnabled=false; dataset.geoAliases={A:'A'}; applyStyle();");
    await h.run("activateAiChoropleth(dataset.suggestions[0])");
    assert.equal(h.run("activePolygonLegendScale().source"), "ai");
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

test("new store data prefers Point to polygon and resets popup settings", async () => {
  const h = harness({ point: true }); h.mode("bar");
  h.run("showChartStyleControls = () => {}; selectAiSuggestion = async id => { globalThis.selectedId = id; return true; };");
  await h.run("replaceAiPipelineData({records: dataset.records, analysis: {...dataset.analysis, suggestions: dataset.suggestions}}, 'stores.csv')");
  assert.equal(h.run("selectedId"), "stores");
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
  assert.equal(h.run("dataset.roadStyle.color"), "#123456");
  assert.equal(h.rendered.length, before, "changing map color does not rebuild popup charts");
});

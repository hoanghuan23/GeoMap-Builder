import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getResolution, latLngToCell } from "h3-js";
import { buildRegionHexGrid } from "../src/region-hex-grid.js";
import { polygonFillExpression } from "../src/renderers/polygon-style.js";
import { resolvePolygonLegendConfig } from "../src/polygon-legend.js";
import { polygonLegendKey, polygonLegendTarget } from "../src/polygon-legend-contract.js";
import { resolveAggregation } from "../src/ai-chart-pipeline.js";

const polygon = (west, south, east, north, properties = {}) => ({
  type: "Feature", properties,
  geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }
});
const regions = { type: "FeatureCollection", features: [
  polygon(105.7, 20.9, 105.9, 21.1, { region: "A", value: 10 }),
  polygon(106.7, 20.9, 106.9, 21.1, { region: "B", value: 40 })
] };

test("region hexagons preserve regional properties without mutating boundaries", () => {
  const before = JSON.stringify(regions);
  const result = buildRegionHexGrid(regions, 7);
  assert.equal(result.resolution, 7);
  assert.ok(result.data.features.length > 0);
  assert.deepEqual(new Set(result.data.features.map(f => f.properties.value)), new Set([10, 40]));
  for (const feature of result.data.features) {
    assert.equal(getResolution(feature.properties.h3), 7);
    assert.equal(feature.geometry.type, "Polygon");
  }
  assert.equal(JSON.stringify(regions), before);
});

test("resolution 15 is reduced before generating an excessive grid", () => {
  const result = buildRegionHexGrid(regions, 15, 1000);
  assert.ok(result.resolution < 15);
  assert.ok(result.data.features.length > 0 && result.data.features.length <= 1000);
  assert.ok(result.data.features.every(f => getResolution(f.properties.h3) === result.resolution));
});

test("resolution zero and empty data are supported; invalid resolutions fail", () => {
  assert.equal(buildRegionHexGrid(regions, 0).resolution, 0);
  assert.deepEqual(buildRegionHexGrid({ type: "FeatureCollection", features: [] }, 15).data.features, []);
  for (const resolution of [-1, 16, 2.5, NaN]) assert.throws(() => buildRegionHexGrid(regions, resolution), RangeError);
});

test("MultiPolygon and polygon holes retain H3 center containment", () => {
  const area = polygon(105, 20, 106, 21, { value: 3 });
  area.geometry.coordinates.push(polygon(105.3, 20.3, 105.7, 20.7).geometry.coordinates[0]);
  const multi = { ...area, geometry: { type: "MultiPolygon", coordinates: [area.geometry.coordinates] } };
  const { data } = buildRegionHexGrid(multi, 6);
  assert.ok(data.features.length > 0);
  assert.ok(!data.features.some(f => f.properties.h3 === latLngToCell(20.5, 105.5, 6)));
  assert.ok(data.features.every(f => f.properties.value === 3));
});

function harness() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { checked: true, value: "", textContent: "", hidden: false });
    return elements.get(id);
  };
  const sources = new Map(["h3-grid", "polygon-data", "vietnam-boundary"].map(id => [id, { setData(data) { this.data = data; } }]));
  const layers = new Map(["h3-fill", "h3-border", "polygon-fill", "polygon-border", "vietnam-border"].map(id => [id, { layout: {}, paint: {} }]));
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
    setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; }
  };
  get("opacity").value = .72; get("fixed-color").value = "#6c5ce7";
  const context = vm.createContext({
    buildRegionHexGrid, polygonFillExpression, resolvePolygonLegendConfig, resolveAggregation, polygonLegendKey, polygonLegendTarget, regions, testMap: map, setTimeout, console,
    CONFIG: { DEFAULT_RESOLUTION: 6, MAX_RENDER_CELLS: 1000 },
    DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {}, DEFAULT_POINT_STYLE: {},
    document: { getElementById: get, querySelectorAll: () => [] },
    joinRecordsToMapTilerBoundaries: () => regions,
    analyzeSpatialData: () => ({ numericFields: ["value"], textFields: ["region"] })
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "").replace(/\binit\(\);\s*$/, "");
  vm.runInContext(source, context);
  vm.runInContext(`map = testMap;
    setStatus = () => {}; updateDashboard = () => {}; syncPolygonPaletteControls = () => {};
    renderMetroLegend = () => {}; renderWeatherLegend = () => {}; renderTransportLegend = () => {};
    renderPointLegend = () => {}; renderRoadLegend = () => {};
    state.boundary = regions; state.mapType = "polygon";
    state.dataProfile = { numericFields: ["value"], textFields: ["region"] };
    state.polygonPalette = "blue";
  `, context);
  return { context, get, sources, layers, run: code => vm.runInContext(code, context) };
}

test("region hex mode swaps layers, keeps the color scale, and follows master visibility", async () => {
  const { run, get, layers } = harness();
  run("updateModelSections(); applyStyle()");
  assert.equal(get("region-hex-controls").hidden, false);
  assert.equal(get("region-hex-resolution").disabled, true);
  assert.equal(get("region-hex-resolution-control").hidden, true);
  const originalColor = layers.get("polygon-fill").paint["fill-color"];
  await run("state.regionHexEnabled = true; rebuildRegionHexGrid()");
  assert.equal(get("region-hex-resolution").disabled, false);
  assert.equal(get("region-hex-resolution-control").hidden, false);
  assert.equal(layers.get("h3-fill").layout.visibility, "visible");
  assert.equal(layers.get("polygon-fill").layout.visibility, "none");
  assert.equal(layers.get("vietnam-border").layout.visibility, "none");
  assert.deepEqual(layers.get("h3-fill").paint["fill-color"], originalColor);
  get("show-map-layers").checked = false;
  run("applyMapLayerVisibility()");
  assert.equal(layers.get("h3-fill").layout.visibility, "none");
  get("show-map-layers").checked = true;
  run("state.regionHexEnabled = false; syncRegionHexControls(); applyStyle()");
  assert.equal(layers.get("polygon-fill").layout.visibility, "visible");
  assert.equal(layers.get("h3-fill").layout.visibility, "none");
  assert.equal(get("region-hex-resolution").disabled, true);
  assert.equal(get("region-hex-resolution-control").hidden, true);
});

test("AI regional filters regenerate the grid and show the actual limited resolution", async () => {
  const { run, get, sources } = harness();
  run(`state.regionHexEnabled = true; state.regionHexResolution = 15;
    selectedAiFilters = () => ({});
    state.aiDataset = { selectedSuggestionId: "regions", suggestions: [{ id: "regions", chartType: "choropleth", bindings: {region:"region",value:"value"} }],
      records: [], boundaries: regions, analysis: { columns: [] },
      recommendation: { metricField: "value", numericFields: ["value"] } };
  `);
  await run("filteredAiBoundary()");
  const features = sources.get("h3-grid").data.features;
  assert.ok(features.length > 0 && features.length <= 1000);
  assert.ok(Number(get("region-hex-resolution-value").value) < 15);
  assert.match(get("region-hex-note").textContent, /Đã dùng độ phân giải/);
});

test("switching away while hex generation is pending prevents a stale update", async () => {
  const { run, sources } = harness();
  const pending = run("state.regionHexEnabled = true; rebuildRegionHexGrid()");
  run('state.mapType = "point"');
  await pending;
  assert.equal(sources.get("h3-grid").data, undefined);
});

test("hex controls are limited to regional polygon maps", () => {
  const { run, get } = harness();
  run('state.mapType = "h3"; updateModelSections()');
  assert.equal(get("region-hex-controls").hidden, true);
  run('state.mapType = "polygon"; state.chartConfig = {}; updateModelSections()');
  assert.equal(get("region-hex-controls").hidden, true);
  run('state.chartConfig = null; updateModelSections()');
  assert.equal(get("region-hex-controls").hidden, false);
});

test("map resize follows container changes", () => {
  const { context, run, get } = harness();
  let callback, observedElement, resizeCount = 0;
  context.ResizeObserver = class {
    constructor(handler) { callback = handler; }
    observe(element) { observedElement = element; }
  };
  context.testMap.resize = () => { resizeCount += 1; };
  run("observeMapSize()");
  assert.equal(observedElement, get("map"));
  callback(); callback();
  assert.equal(resizeCount, 2);
});

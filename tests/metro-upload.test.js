import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as metro from "../src/metro-data.js";
import * as capabilities from "../src/data-capabilities.js";
import * as polygonStyle from "../src/renderers/polygon-style.js";
import * as pointStyle from "../src/renderers/point-style.js";
import * as geojsonLayers from "../src/geojson-layers.js";
import { PointRenderer } from "../src/renderers/point-renderer.js";
import { PolygonRenderer } from "../src/renderers/polygon-renderer.js";
import * as congestion from "../src/congestion-data.js";
import * as transport from "../src/transport-style.js";
import * as layerOrder from "../src/layer-order.js";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as popupChart from "../src/ai-popup-chart.js";
import * as coordinates from "../src/coordinate-data.js";
import * as roadMap from "../src/road-map-data.js";
import * as timeValues from "../src/time-values.js";
import { AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { displayFilterValue, comparableFilterValue } from "../src/ai-data-analysis.js";
import { parseSpreadsheetFile } from "../src/tabular-worker-client.js";
import { metroFixture } from "./fixtures/metro-fixture.js";
import { createRoadTrafficWorkbook, trafficAiAnalysis } from "./fixtures/road-traffic-fixture.js";
import { fallbackAnalysis } from "../src/ai-chart-contract.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { normalizeTabularRecords } from "../src/tabular-data.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { countryFeature, createCountryWeatherWorkbook, WEATHER_COUNTRIES } from "./fixtures/country-weather-fixture.js";
import * as polygonLegend from "../src/polygon-legend.js";
import * as legendContract from "../src/polygon-legend-contract.js";

// Exercise the actual upload and UI handlers with a MapLibre/DOM adapter.
function createHarness() {
  const elements = new Map();
  const element = () => ({
    checked: true, hidden: false, value: "", textContent: "", style: { setProperty() {} }, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; }
  });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  get("fixed-color").value = "#6c5ce7"; get("opacity").value = ".72";
  get("border-color").value = "#ffffff"; get("line-width").value = ".5";
  const sources = new Map(); const layers = new Map();
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    addSource(id, config) { sources.set(id, { data: config.data, setData(data) { this.data = data; } }); },
    addLayer(layer) { layers.set(layer.id, { ...layer, layout: { ...layer.layout }, paint: { ...layer.paint } }); },
    removeSource(id) { sources.delete(id); }, removeLayer(id) { layers.delete(id); },
    setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; },
    getPaintProperty(id, key) { return layers.get(id).paint[key]; },
    getContainer() { return get("map"); },
    project(coordinates) { return { x: coordinates[0] * 10, y: coordinates[1] * 10 }; },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
    moveLayer() {}, on() {}, resize() {}, fitBounds() {}
  };
  const context = vm.createContext({
    ...metro, ...capabilities, ...polygonStyle, ...pointStyle, ...geojsonLayers, ...congestion, ...transport, ...layerOrder, PointRenderer, PolygonRenderer,
    ...pipeline, ...popupChart, ...coordinates, ...roadMap, ...timeValues, ...polygonLegend, ...legendContract,
    AI_CHART_REGISTRY, displayFilterValue, comparableFilterValue,
    requestAiDataAnalysis: async records => ({ analysis: { ...trafficAiAnalysis, source: "ai" }, records, validRowRate: 1 }),
    roadNetworkUrl: () => "/roads/hanoi_roads.json",
    fetch: async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [{
      type: "Feature", properties: { name: "Đường Lĩnh Nam" },
      geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] }
    }] }) }),
    CONFIG: { DEFAULT_RESOLUTION: 5, MAX_RENDER_CELLS: 120000 },
    DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {},
    mergeBarConfig: () => ({}), mergePieConfig: () => ({}),
    clearDataMappingPanel() {}, clearBarStylePanel() {}, clearPieStylePanel() {}, renderMapIcon() {}, renderChartIcon() {},
    humanizeField: field => field, keepSelectOpenAfterMouseClick: control => control,
    geoJSONToCells() { throw new Error("Metro polygons must not be regenerated as H3"); },
    geoJSONToH3FeatureCollection: () => ({ type: "FeatureCollection", features: [] }),
    document: { getElementById: get, createElement: element, querySelector: () => element(),
      querySelectorAll: selector => selector === "#ai-filter-controls .ai-generated-filter"
        ? descendants(get("ai-filter-controls")).filter(node => node.className === "ai-generated-filter") : [] },
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
    console, setTimeout: callback => { callback(); return 0; }, clearTimeout() {}
  });
  const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "")
    .replace(/\binit\(\);\s*$/, "");
  vm.runInContext(source, context);
  context.testMap = map;
  vm.runInContext("map = testMap; addMapLayers();", context);
  return { context, get, sources, layers };
}

test("danh sách kiểu bản đồ chỉ có Polygon, Line và Point", () => {
  const { context, get } = createHarness();
  vm.runInContext("renderSupportedChartCatalog()", context);
  const labels = get("supported-chart-grid").children.map(item => item.children[1].textContent);
  assert.deepEqual(labels, ["Bản đồ Polygon", "Bản đồ Line", "Bản đồ Point"]);
  const areaTypes = capabilities.compatibleMapTypes({ hasPoints: false, hasLines: false, hasArea: true, numericFields: [], textFields: [] });
  assert.deepEqual(areaTypes.map(type => type.id), ["polygon"], "H3 is no longer a selectable map type");
  context.roadData = metroFixture.metro_route;
  vm.runInContext("renderCompatibleMapTypes(roadData)", context);
  const card = get("map-type-grid").children.find(item => item.dataset.type === "line");
  assert.equal(card.dataset.label, "Bản đồ Line");
  assert.equal(card.title, "Bản đồ Line · MapLibre");
  assert.equal(card.children[1], "Bản đồ Line");
});

test("upload displays independent Metro layers, changes departure, and clears all sources", async () => {
  const { context, get, sources, layers } = createHarness();
  context.file = { name: "metro.json", text: async () => JSON.stringify(metroFixture) };
  await vm.runInContext("processSpatialFile(file)", context);
  assert.equal(sources.get("polygon-data").data.features.length, metroFixture.hexagons.features.length);
  assert.equal(sources.get("vietnam-boundary").data.features.length, 1);
  assert.equal(sources.get("metro-station-data").data.features.length, 13);
  assert.equal(sources.get("line-data").data.features.length, 1);
  assert.equal(layers.get("polygon-fill").layout.visibility, "visible");
  assert.equal(layers.get("data-lines").layout.visibility, "visible");
  assert.equal(layers.get("metro-stations").layout.visibility, "visible");
  assert.equal(get("metro-time-section").hidden, false);
  assert.equal(get("metro-departure").children.length, 18);
  assert.equal(get("chart-data-mapping-section").hidden, true);
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

test("data search follows analyzed upload fields and clears when the dataset is removed", async () => {
  const { context } = createHarness();
  const snapshots = [];
  context.searchController = { setData(data) { snapshots.push(data); } };
  vm.runInContext("mapSearch = searchController; syncDataSearch()", context);
  assert.equal(snapshots.at(-1), undefined, "no uploaded data means no search data");
  context.polygonData = { type: "FeatureCollection", features: [{
    type: "Feature", properties: { name: "Hà Nội", temperature: 30 },
    geometry: { type: "Polygon", coordinates: [[[105, 20], [106, 20], [106, 21], [105, 20]]] }
  }] };
  await vm.runInContext('replaceBoundary(polygonData, "regions.geojson", null, { preservePolygons: true })', context);
  assert.equal(snapshots.at(-1).data, context.polygonData);
  assert.deepEqual(Array.from(snapshots.at(-1).columns, column => column.name), ["name"]);
  const columns = snapshots.at(-1).columns;
  vm.runInContext("syncDataSearch()", context);
  assert.equal(snapshots.at(-1).columns, columns, "styling must not reset the search index");
  vm.runInContext("deleteData()", context);
  assert.equal(snapshots.at(-1), undefined);
  assert.equal(vm.runInContext("state.dataOrigin", context), null);
  assert.equal(vm.runInContext("state.mapType", context), null);
});

test("uploaded country weather enables search using the current date and country filters", async () => {
  const { context, get } = createHarness();
  const indexes = [];
  context.parseSpreadsheetFile = parseSpreadsheetFile;
  context.searchController = { setData(snapshot) { indexes.push(buildDataSearchIndex(snapshot)); } };
  vm.runInContext("mapSearch = searchController", context);
  context.requestAiDataAnalysis = async (rows, { profile }) => {
    const analysis = fallbackAnalysis(profile);
    return { analysis, profile, ...normalizeTabularRecords(rows, analysis.columns) };
  };
  context.loadAdministrativeBoundaries = async names => ({
    type: "FeatureCollection", matched: names, unmatched: [], matchRate: 1,
    features: names.map(name => ({ ...countryFeature(WEATHER_COUNTRIES.find(country => country.name === name)),
      properties: { __data_location: name } }))
  });
  context.landOnlyBoundary = async feature => feature;
  context.joinRecordsToMapTilerBoundaries = joinRecordsToMapTilerBoundaries;
  const workbook = createCountryWeatherWorkbook();
  context.countryFile = { name: "country-weather.xlsx", arrayBuffer: async () => workbook };
  await vm.runInContext("processSpatialFile(countryFile)", context);
  assert.equal(vm.runInContext("state.mapType", context), "polygon");
  let result = searchDataIndex(indexes.at(-1), "Vietnam")[0];
  assert.equal(result.label, "Việt Nam");
  assert.equal(result.feature.properties["Nhiệt độ trung bình"], 28.6, "search opens the latest displayed date");
  assert.deepEqual(searchDataIndex(indexes.at(-1), "Hoa Kỳ"), [], "known countries outside the upload stay absent");
  const controls = get("ai-filter-controls");
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const date = descendants(controls).find(node => node.className === "ai-generated-filter" && node.dataset.field === "Ngày");
  date.value = "2026-09-01T00:00:00.000Z";
  await vm.runInContext("filteredAiBoundary()", context);
  result = searchDataIndex(indexes.at(-1), "Vietnam")[0];
  assert.equal(result.feature.properties["Nhiệt độ trung bình"], 28, "filter changes refresh the searchable feature values");
  vm.runInContext("deleteData()", context);
  assert.equal(indexes.at(-1).entries.length, 0);
});

test("Point style panel applies appearance and resets it without rebuilding H3 or changing filters", async () => {
  const { context, get, sources, layers } = createHarness();
  context.pointRecords = [
    { lat: 21, lng: 105, type: "A", value: 10 },
    { lat: 21.1, lng: 105.1, type: "B", value: 20 }
  ];
  vm.runInContext(`
    state.mapType = "point";
    state.aiDataset = {
      records: pointRecords,
      analysis: { columns: [{ name: "type", role: "category" }, { name: "value", role: "measure" }] },
      suggestions: [{ id: "point-test", chartType: "point", bindings: { lat: "lat", lng: "lng" } }],
      selectedSuggestionId: "point-test"
    };
    state.pointData = buildActivePointView(state.aiDataset.suggestions[0]).data;
    state.boundary = state.pointData;
    map.getSource("point-data").setData(state.pointData);
    updateModelSections(); applyStyle();
  `, context);
  assert.equal(get("style-section").hidden, false);
  assert.equal(get("point-style-controls").hidden, false);
  assert.equal(get("map-style-controls").hidden, true);
  assert.equal(get("point-group-colors").children.length, 2);
  const data = sources.get("point-data").data;
  const selection = vm.runInContext("JSON.stringify(state.aiDataset.activePointView.selection)", context);
  vm.runInContext(`
    state.pointStyle = mergePointStyle({ size: 150, opacity: .4, showBorder: false, showLegend: false });
    pointColorOverridesFor(state.aiDataset.suggestions[0]).A = "#ff0000";
    refreshPointStyle();
  `, context);
  assert.equal(layers.get("point-marker").paint["circle-opacity"], .4);
  assert.equal(layers.get("point-marker").paint["circle-stroke-width"], 0);
  assert.equal(get("point-legend").hidden, true);
  assert.equal(vm.runInContext("state.aiDataset.activePointView.colors.A", context), "#ff0000");
  assert.equal(sources.get("point-data").data, data);
  await vm.runInContext("resetConfiguration()", context);
  assert.equal(layers.get("point-marker").paint["circle-opacity"], .95);
  assert.equal(layers.get("point-marker").paint["circle-stroke-width"], 1);
  assert.equal(get("point-legend").hidden, false);
  assert.notEqual(vm.runInContext("state.aiDataset.activePointView.colors.A", context), "#ff0000");
  assert.equal(vm.runInContext("JSON.stringify(state.aiDataset.activePointView.selection)", context), selection);
  assert.equal(sources.get("point-data").data, data);
});

test("skips a file uploaded more than once and allows it again after removal", async () => {
  const { context } = createHarness();
  const data = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: "A" }, geometry: { type: "Point", coordinates: [106.7, 10.8] } }]
  });
  context.file = { name: "points.geojson", size: data.length, lastModified: 123, type: "application/geo+json", text: async () => data };

  await vm.runInContext("processSpatialFiles([file, file])", context);
  assert.equal(vm.runInContext("state.uploadedFiles.length", context), 1);
  assert.equal(vm.runInContext("state.uploadLayers.length", context), 1);
  assert.equal(vm.runInContext("state.uploadedFileKeys.size", context), 1);

  await vm.runInContext("processSpatialFiles([file])", context);
  assert.equal(vm.runInContext("state.uploadedFiles.length", context), 1);
  assert.match(vm.runInContext("document.getElementById('status').textContent", context), /đã được tải lên/i);

  vm.runInContext("removeUploadedFile(state.uploadedFiles[0].id)", context);
  assert.equal(vm.runInContext("state.uploadedFileKeys.size", context), 0);
  await vm.runInContext("processSpatialFiles([file])", context);
  assert.equal(vm.runInContext("state.uploadedFiles.length", context), 1);
  assert.equal(vm.runInContext("state.uploadLayers.length", context), 1);
});

function trafficUploadFiles() {
  const workbook = createRoadTrafficWorkbook();
  return {
    roadsFile: { name: "un_tac.xlsx", size: workbook.length, lastModified: 1,
      arrayBuffer: async () => workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength) },
    stopsFile: { name: "dulieu_diem_phuongtien.geojson", lastModified: 2, text: async () => JSON.stringify({
      type: "FeatureCollection", features: ["bus_stop", "ferry_terminal"].map((fclass, index) => ({
        type: "Feature", properties: { name: fclass, fclass },
        geometry: { type: "Point", coordinates: [105.8 + index * .01, 21] }
      }))
    }) }
  };
}

test("Excel đường và các điểm giao thông cùng hiện trong input khi tải nối tiếp hoặc cùng lúc", async () => {
  for (const together of [false, true]) {
    const { context, get, sources } = createHarness();
    Object.assign(context, trafficUploadFiles(), { parseSpreadsheetFile });
    if (together) await vm.runInContext("processSpatialFiles([roadsFile, stopsFile])", context);
    else {
      await vm.runInContext("processSpatialFiles([roadsFile])", context);
      await vm.runInContext("processSpatialFiles([stopsFile])", context);
    }
    const roadData = sources.get("line-data").data;
    assert.ok(roadData.features.length > 0);
    assert.equal(get("file-name").textContent, "2 tệp dữ liệu");
    assert.deepEqual(get("uploaded-layer-list").children.map(item => item.children[0].textContent),
      [context.roadsFile.name, context.stopsFile.name]);
    assert.match(get("uploaded-layer-list").children[0].children[1].textContent, /bản ghi khớp.*đoạn đường/);
    assert.equal(get("uploaded-layer-list").children[1].children[1].textContent, "2 đối tượng");
    assert.equal(get("selected-file").hidden, false);
    assert.equal(get("remove-current-file").hidden, true);
    assert.equal(get("ai-line-legend").hidden, false);
    assert.equal(get("transport-legend").hidden, false);

    await vm.runInContext("processSpatialFiles([roadsFile, stopsFile])", context);
    assert.equal(vm.runInContext("state.uploadedFiles.length", context), 2, "tệp gốc cũng được kiểm tra trùng");
    await vm.runInContext("filteredAiBoundary()", context);
    assert.equal(get("file-name").textContent, "2 tệp dữ liệu", "lọc dữ liệu không ghi đè tiêu đề input");
    assert.equal(get("uploaded-layer-list").children.length, 2);

    await vm.runInContext("removeUploadedFile(state.uploadLayers[0].id)", context);
    assert.equal(get("uploaded-layer-list").children.length, 1);
    assert.equal(get("uploaded-layer-list").children[0].children[0].textContent, context.roadsFile.name);
    assert.ok(sources.get("line-data").data.features.length > 0);
    assert.equal(get("ai-line-legend").hidden, false);
    assert.equal(get("transport-legend").hidden, true);
  }
});

test("xóa tệp đường giữ lớp điểm và có thể tải lại tệp đường", async () => {
  const { context, get, sources } = createHarness();
  Object.assign(context, trafficUploadFiles(), { parseSpreadsheetFile });
  await vm.runInContext("processSpatialFiles([roadsFile, stopsFile])", context);
  const stopsSource = vm.runInContext("state.uploadLayers[0].sourceId", context);
  const stopsData = sources.get(stopsSource).data;
  await vm.runInContext("removeUploadedFile(state.primaryUploadId)", context);
  assert.equal(sources.get(stopsSource).data, stopsData);
  assert.equal(sources.get("line-data").data.features.length, 0);
  assert.equal(get("uploaded-layer-list").children.length, 1);
  assert.equal(get("uploaded-layer-list").children[0].children[0].textContent, context.stopsFile.name);
  assert.equal(get("ai-line-legend").hidden, true);
  assert.equal(get("transport-legend").hidden, false);

  await vm.runInContext("processSpatialFiles([roadsFile])", context);
  assert.equal(get("uploaded-layer-list").children.length, 2);
  assert.ok(sources.get("line-data").data.features.length > 0);
  assert.equal(sources.get(stopsSource).data, stopsData);
  vm.runInContext("deleteData()", context);
  assert.equal(vm.runInContext("state.uploadedFileKeys.size", context), 0);
  assert.equal(get("selected-file").hidden, true);
  assert.equal(get("ai-line-legend").hidden, true);
  assert.equal(get("transport-legend").hidden, true);
});

test("recognizes an Excel travel-time table as a Metro part", async () => {
  const { context } = createHarness();
  context.XLSX = {
    read: () => ({ SheetNames: ["travel_times"], Sheets: { travel_times: {} } }),
    utils: { sheet_to_json: () => [{ cell_id: "hex_0001", departure_time: 5.5 / 24, bus_minutes: "55,6", motorbike_minutes: 28.8, ratio: "1,93" }] }
  };
  context.file = { name: "travel_times.xlsx", arrayBuffer: async () => new ArrayBuffer(0) };

  const result = await vm.runInContext("readSpatialFile(file)", context);
  assert.equal(result.kind, "metro-part");
  assert.equal(result.role, "travel_times");
  assert.deepEqual({ ...result.data[0] }, {
    cell_id: "hex_0001",
    departure_time: "05:30",
    bus_minutes: 55.6,
    motorbike_minutes: 28.8,
    ratio: 1.93
  });
});

test("activates Metro with only hexagons and travel times, then adds optional overlays", async () => {
  const { context, sources } = createHarness();
  const bundle = metroFixture;
  const file = (name, data, stamp) => {
    const text = JSON.stringify(data);
    return { name, size: text.length, lastModified: stamp, type: "application/json", text: async () => text };
  };
  context.hexagonsFile = file("hexagons.geojson", bundle.hexagons, 1);
  context.timesFile = file("travel_times.json", bundle.travel_times, 2);

  await vm.runInContext("processSpatialFiles([hexagonsFile, timesFile])", context);
  assert.equal(vm.runInContext("state.separateMetroActive", context), true);
  assert.equal(sources.get("polygon-data").data.features.length, bundle.hexagons.features.length);
  assert.equal(sources.get("metro-station-data").data.features.length, 0);
  assert.equal(sources.get("line-data").data.features.length, 0);
  assert.match(vm.runInContext("document.getElementById('status').textContent", context), /ghép 2 file/i);

  context.stationsFile = file("stations.geojson", bundle.stations, 3);
  context.routeFile = file("metro_route.geojson", bundle.metro_route, 4);
  await vm.runInContext("processSpatialFiles([stationsFile, routeFile])", context);
  assert.equal(sources.get("metro-station-data").data.features.length, bundle.stations.features.length);
  assert.equal(sources.get("line-data").data.features.length, bundle.metro_route.features.length);
  assert.match(vm.runInContext("document.getElementById('status').textContent", context), /ghép 4 file/i);
});

test("clicks anywhere in a Metro cell focus its full geometry and anchor to the same center", async () => {
  const { context, sources, layers } = createHarness();
  context.file = { name: "metro.json", text: async () => JSON.stringify(metroFixture) };
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

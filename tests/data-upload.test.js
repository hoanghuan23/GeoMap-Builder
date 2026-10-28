import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as capabilities from "../src/data-capabilities.js";
import * as polygonStyle from "../src/renderers/polygon-style.js";
import * as pointStyle from "../src/renderers/point-style.js";
import * as geojsonLayers from "../src/geojson-layers.js";
import { PointRenderer } from "../src/renderers/point-renderer.js";
import { PolygonRenderer } from "../src/renderers/polygon-renderer.js";
import * as layerOrder from "../src/layer-order.js";
import * as pipeline from "../src/ai-chart-pipeline.js";
import * as popupChart from "../src/ai-popup-chart.js";
import * as coordinates from "../src/coordinate-data.js";
import * as roadMap from "../src/road-map-data.js";
import * as timeValues from "../src/time-values.js";
import { AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { displayFilterValue, comparableFilterValue, requestAiDataAnalysis } from "../src/ai-data-analysis.js";
import { parseSpreadsheetFile, profileRecordsInWorker } from "../src/tabular-worker-client.js";
import { metroFixture } from "./fixtures/metro-fixture.js";
import { createRoadTrafficWorkbook, trafficAiAnalysis } from "./fixtures/road-traffic-fixture.js";
import { mockAiAnalysis } from "./fixtures/mock-ai-analysis.js";
import { jsonDatasets } from "../src/json-datasets.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { normalizeTabularRecords } from "../src/tabular-data.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { countryFeature, createCountryWeatherWorkbook, WEATHER_COUNTRIES } from "./fixtures/country-weather-fixture.js";
import * as polygonLegend from "../src/polygon-legend.js";
import * as legendContract from "../src/polygon-legend-contract.js";

import { createHarness } from "./fixtures/map-runtime-harness.js";

test("danh sách kiểu bản đồ có Polygon, Line, Point và Arc Flow", () => {
  const { context, get } = createHarness();
  vm.runInContext("renderSupportedChartCatalog()", context);
  const labels = get("supported-chart-grid").children.map(item => item.children[1].textContent);
  assert.deepEqual(labels, ["Bản đồ Polygon", "Bản đồ Line", "Bản đồ Point", "Bản đồ Arc Flow 3D"]);
  const areaTypes = capabilities.compatibleMapTypes({ hasPoints: false, hasLines: false, hasArea: true, numericFields: [], textFields: [] });
  assert.deepEqual(areaTypes.map(type => type.id), ["polygon"], "H3 is no longer a selectable map type");
  context.roadData = metroFixture.metro_route;
  vm.runInContext("renderCompatibleMapTypes(roadData)", context);
  const card = get("map-type-grid").children.find(item => item.dataset.type === "line");
  assert.equal(card.dataset.label, "Bản đồ Line");
  assert.equal(card.title, "Bản đồ Line · MapLibre");
  assert.equal(card.children[1], "Bản đồ Line");
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
  let analysisCalls = 0;
  context.parseSpreadsheetFile = parseSpreadsheetFile;
  context.searchController = { setData(snapshot) { indexes.push(buildDataSearchIndex(snapshot)); } };
  vm.runInContext("mapSearch = searchController", context);
  context.requestAiDataAnalysis = async (rows, { profile }) => {
    analysisCalls += 1;
    const analysis = { ...mockAiAnalysis(profile), search_bar: true, search_fields: ["Quốc gia"] };
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
  assert.equal(indexes.at(-1).enabled, true);
  assert.deepEqual(Array.from(indexes.at(-1).fields), ["Quốc gia"]);
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
  const countries = descendants(controls).filter(node => node.className === "ai-generated-filter" && node.dataset.field === "Quốc gia");
  assert.equal(countries.length, 1);
  countries[0].value = "Việt Nam";
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(indexes.at(-1).uniqueCount, 1);
  assert.equal(indexes.at(-1).enabled, false);
  countries[0].value = "";
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(indexes.at(-1).enabled, true);
  vm.runInContext("state.aiDataset.analysis.search_bar = false; syncDataSearch()", context);
  assert.equal(indexes.at(-1).enabled, false);
  assert.equal(analysisCalls, 1, "filters and search preferences never repeat AI analysis");
  vm.runInContext("deleteData()", context);
  assert.equal(indexes.at(-1).entries.length, 0);
});

test("khởi tạo polygon với ngày cuối toàn null vẫn cho phép đổi ngày hoặc chỉ số", async () => {
  const { context, get, sources } = createHarness();
  const indexes = [];
  context.searchController = { setData(snapshot) { indexes.push(buildDataSearchIndex(snapshot)); } };
  vm.runInContext("mapSearch = searchController", context);
  const columns = [
    { name: "region", role: "geo", geoLevel: "admin2", country: "VN" },
    { name: "date", role: "time", timeParse: "iso" },
    { name: "temperature", role: "measure", aggDefault: "mean" },
    { name: "rain", role: "measure", aggDefault: "sum" }
  ];
  const records = ["Hà Đông", "Ba Đình"].flatMap(region => [1, 2].map(day => ({
    region, date: `2026-09-0${day}`, temperature: day === 2 ? null : 22, rain: 18
  })));
  context.nullPipeline = {
    ...normalizeTabularRecords(records, columns),
    analysis: { source: "ai", columns, search_bar: true, search_fields: ["region"], suggestions: [{
      id: "temperature-map", chartType: "choropleth", title: "Nhiệt độ", confidence: .9,
      bindings: { region: "region", value: "temperature" }, agg: "mean", popupSuggestions: [], metricButtons: []
    }] }
  };
  context.loadAdministrativeBoundaries = async names => ({
    type: "FeatureCollection", matched: names, unmatched: [], matchRate: 1,
    features: names.map((name, index) => ({
      type: "Feature", properties: { __data_location: name },
      geometry: { type: "Polygon", coordinates: [[[105 + index, 20], [106 + index, 20], [106 + index, 21], [105 + index, 20]]] }
    }))
  });
  context.landOnlyBoundary = async feature => feature;
  context.joinRecordsToMapTilerBoundaries = joinRecordsToMapTilerBoundaries;
  await vm.runInContext('replaceAiPipelineData(nullPipeline, "null-weather.xlsx")', context);
  assert.equal(vm.runInContext("state.mapType", context), "polygon");
  assert.equal(vm.runInContext("state.dataProfile.hasArea", context), true);
  assert.equal(sources.get("polygon-data").data.features.length, 0);
  assert.equal(sources.get("vietnam-boundary").data.features.length, 0);
  assert.equal(get("weather-legend").hidden, true);
  assert.equal(get("ai-data-filters").hidden, false);
  assert.equal(indexes.at(-1).enabled, true);
  const result = searchDataIndex(indexes.at(-1), "ha dong")[0];
  assert.equal(result.label, "Hà Đông");
  assert.equal(result.feature.properties.__metric, null);
  assert.equal(result.feature.properties.rain, 18);
  assert.equal(result.feature.properties.date, "2026-09-02T00:00:00.000Z");
  await vm.runInContext('changeAiMapMetric("rain")', context);
  assert.equal(sources.get("polygon-data").data.features.length, 2);
  await vm.runInContext('changeAiMapMetric("temperature")', context);
  assert.equal(sources.get("polygon-data").data.features.length, 0);
  assert.equal(searchDataIndex(indexes.at(-1), "ha dong")[0].label, "Hà Đông");
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  const date = descendants(get("ai-filter-controls")).find(node => node.className === "ai-generated-filter" && node.dataset.field === "date");
  date.value = "2026-09-01T00:00:00.000Z";
  await vm.runInContext("filteredAiBoundary()", context);
  assert.equal(sources.get("polygon-data").data.features.length, 2);
  assert.equal(vm.runInContext("state.mapType", context), "polygon");
  assert.equal(searchDataIndex(indexes.at(-1), "ha dong")[0].feature.properties.temperature, 22);
  const region = descendants(get("ai-filter-controls")).find(node => node.className === "ai-generated-filter" && node.dataset.field === "region");
  region.value = "Ba Đình";
  await vm.runInContext("filteredAiBoundary()", context);
  assert.deepEqual(searchDataIndex(indexes.at(-1), "ha dong"), [], "search still respects the explicit region filter");
});

test("AI road search works without a spatial profile and counts names rather than segments", () => {
  const { context } = createHarness();
  const indexes = [];
  context.searchController = { setData(snapshot) { indexes.push(buildDataSearchIndex(snapshot)); } };
  context.roadRows = Array.from({ length: 8 }, (_, i) => ({ "Tên đường": `Đường ${i}`, "Khu vực": "Hà Nội" }));
  vm.runInContext(`
    mapSearch = searchController;
    state.mapType = "line"; state.dataProfile = null;
    state.aiDataset = {
      records: roadRows, selectedSuggestionId: "roads", filters: {},
      analysis: { search_bar: true, search_fields: ["Tên đường"], columns: [
        { name: "Khu vực", role: "geo", geoLevel: "admin1" }, { name: "Tên đường", role: "category" }
      ] },
      suggestions: [{ id: "roads", chartType: "map_line", bindings: { region: "Tên đường" } }],
      recommendation: { geometry: { field: "Tên đường" } }
    };
    state.lineData = { type: "FeatureCollection", features: roadRows.flatMap(properties => [0, 1].map(() => ({
      type: "Feature", properties, geometry: { type: "LineString", coordinates: [[105, 21], [106, 22]] }
    }))) };
    syncDataSearch();
  `, context);
  assert.equal(indexes.at(-1).enabled, true);
  assert.equal(indexes.at(-1).uniqueCount, 8);
  assert.equal(searchDataIndex(indexes.at(-1), "duong 0")[0].label, "Đường 0");
  vm.runInContext(`
    state.aiDataset.filters = { "Tên đường": ["Đường 0"] };
    state.lineData = { ...state.lineData, features: state.lineData.features.slice(0, 2) };
    syncDataSearch();
  `, context);
  assert.equal(indexes.at(-1).uniqueCount, 1);
  assert.equal(indexes.at(-1).enabled, false);
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
  context.requestAiDataAnalysis = async (records, { profile }) => ({ analysis: mockAiAnalysis(profile), records, validRowRate: {} });
  const data = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: "A" }, geometry: { type: "Point", coordinates: [106.7, 10.8] } }]
  });
  context.file = { name: "points.geojson", size: data.length, lastModified: 123, type: "application/geo+json", text: async () => data };

  await vm.runInContext("processSpatialFiles([file, file])", context);
  assert.equal(vm.runInContext("state.uploadedFiles.length", context), 1);
  assert.equal(vm.runInContext("state.uploadLayers.length", context), 0);
  assert.equal(vm.runInContext("state.mapType", context), "point");
  assert.equal(vm.runInContext("state.uploadedFileKeys.size", context), 1);

  await vm.runInContext("processSpatialFiles([file])", context);
  assert.equal(vm.runInContext("state.uploadedFiles.length", context), 1);
  assert.match(vm.runInContext("document.getElementById('status').textContent", context), /đã được tải lên/i);

  vm.runInContext("removeUploadedFile(state.uploadedFiles[0].id)", context);
  assert.equal(vm.runInContext("state.uploadedFileKeys.size", context), 0);
  await vm.runInContext("processSpatialFiles([file])", context);
  assert.equal(vm.runInContext("state.uploadedFiles.length", context), 1);
  assert.equal(vm.runInContext("state.uploadLayers.length", context), 0);
  assert.equal(vm.runInContext("state.mapType", context), "point");
});

const weatherStations = { type: "FeatureCollection", features: Array.from({ length: 25 }, (_, index) => ({
  type: "Feature", properties: { station_id: `KT${String(index + 1).padStart(3, "0")}`,
    ten_tram: `Trạm khí tượng ${index + 1}`, nhiet_do_c: 19.6 + index / 10, do_am_phan_tram: 65 + index },
  geometry: { type: "Point", coordinates: [105.935752 + index / 100, 21.079462 + index / 100] }
})) };

test("weather station GeoJSON calls AI with properties and bounded samples, then exposes Point metrics", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const includeSamples of [true, false]) {
      const { context, get, sources } = createHarness();
      context.requestAiDataAnalysis = requestAiDataAnalysis;
      get("ai-include-samples").checked = includeSamples;
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, "/api/ai/analyze-map-data");
        const { profile, source } = JSON.parse(options.body);
        assert.equal(source.fileName, "tram_khi_tuong_mien_bac.geojson");
        assert.equal(profile.rowCount, 25);
        assert.equal(profile.samplesIncluded, includeSamples);
        assert.equal(profile.head?.length || 0, includeSamples ? 8 : 0);
        for (const column of profile.columns) {
          assert.equal("samples" in column, includeSamples);
          if (includeSamples) assert.ok(column.samples.length <= 5);
        }
        assert.equal(profile.columns.find(column => column.name === "nhiet_do_c").inferredType, "number");
        const analysis = mockAiAnalysis(profile, { datasetTitle: "Trạm khí tượng miền Bắc" });
        return { ok: true, json: async () => ({ ...analysis, source: "ai", columns: analysis.columns.map(column => ({
          ...column, ...(column.name === "nhiet_do_c" ? { labelVi: "Nhiệt độ", unit: "°C" }
            : column.name === "do_am_phan_tram" ? { labelVi: "Độ ẩm", unit: "%" } : {})
        })) }) };
      };
      context.weatherFile = { name: "tram_khi_tuong_mien_bac.geojson", text: async () => JSON.stringify(weatherStations) };
      await vm.runInContext("processSpatialFiles([weatherFile])", context);
      assert.equal(calls, 1);
      assert.equal(vm.runInContext("state.aiDataset.analysis.source", context), "ai");
      assert.equal(vm.runInContext("state.aiDataset.records.length", context), 25);
      assert.equal(vm.runInContext("state.mapType", context), "point");
      assert.equal(vm.runInContext("state.uploadLayers.length", context), 0, "no duplicate raw overlay obscures analyzed points");
      assert.ok(get("map-type-grid").children.some(node => node.dataset.type === "rule-point"));
      assert.match(get("map-type-summary").textContent, /Trạm khí tượng miền Bắc.*AI/);
      assert.equal(sources.get("point-data").data.features.length, 25);
      assert.deepEqual(sources.get("point-data").data.features[0].geometry.coordinates, weatherStations.features[0].geometry.coordinates);
      const mapControls = get("ai-filter-controls").children.find(node => node.className === "ai-popup-map-controls");
      const metricSelect = mapControls.children.find(node => node.children[1]?.className === "ai-point-metric").children[1];
      assert.deepEqual(metricSelect.children.map(option => option.textContent), ["Nhiệt độ", "Độ ẩm"]);
      vm.runInContext(`
        const suggestion = activePointSuggestion();
        state.aiDataset.pointSelections[suggestion.id].metricField = "do_am_phan_tram";
        refreshPointView(suggestion);
      `, context);
      assert.equal(vm.runInContext("state.aiDataset.activePointView.metric.field", context), "do_am_phan_tram");
      assert.equal(calls, 1, "switching metrics reuses the same AI analysis");
      await vm.runInContext("removeUploadedFile(state.primaryUploadId)", context);
      assert.equal(vm.runInContext("state.aiDataset", context), null);
      assert.equal(sources.get("point-data").data.features.length, 0);
    }
  } finally { globalThis.fetch = originalFetch; }
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


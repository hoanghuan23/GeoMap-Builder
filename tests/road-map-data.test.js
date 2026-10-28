import test from "node:test";
import assert from "node:assert/strict";
import { aiRoadMapStyle, joinRoadRecords, joinRoadRecordsByArea, roadAreaField, roadMapStyle, roadNetworkForArea, roadNetworksFromRecords, roadValueColumns } from "../src/road-map-data.js";
import { defaultTimeFilter, applyPipelineFilters, prepareSuggestions, withSuggestionMetric } from "../src/ai-chart-pipeline.js";
import { fallbackAnalysis, validateAndNormalizeAnalysis, AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { normalizeTabularRecords, profileTabularData } from "../src/tabular-data.js";
import { trafficAiAnalysis, trafficRecords, TRAFFIC_SPEED } from "./fixtures/road-traffic-fixture.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { MAP_NO_DATA_COLOR } from "../src/map-value.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";

const roads = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { name: "Đường Lĩnh Nam" }, geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] } },
  { type: "Feature", properties: { name: ["Tên khác", "Đường Ngọc Hồi"], ref: "QL1" }, geometry: { type: "MultiLineString", coordinates: [[[105.82, 21], [105.83, 21.01]]] } },
  { type: "Feature", properties: { name: "Đường Lĩnh Nam" }, geometry: { type: "Point", coordinates: [105.8, 21] } }
] };
const profile = profileTabularData(trafficRecords);
const analysis = validateAndNormalizeAnalysis(trafficAiAnalysis, profile);

test("Line uses AI stops and units for paint, remaps auto scales after filtering and keeps missing values transparent", () => {
  const column = { name: "value", role: "measure", aggDefault: "mean", unit: "°C", legend: legendFixture() };
  const suggestion = { chartType: "map_line", bindings: { region: "route", value: "value" }, agg: "mean" };
  const data = values => ({ type: "FeatureCollection", features: values.map(value => ({ properties: { value } })) });
  const semantic = aiRoadMapStyle(data([10, 30, null, 0]), [column], suggestion);
  assert.equal(semantic.scale.source, "ai");
  assert.deepEqual(semantic.rows.map(row => [row.value, row.color]), column.legend.stops.map(stop => [stop.value, stop.color]));
  assert.deepEqual(semantic.color[2].slice(3), semantic.scale.stops.flat());
  assert.equal(semantic.color.at(-1), MAP_NO_DATA_COLOR);
  const autoColumn = { ...column, legend: legendFixture({ mode: "auto" }) };
  const first = aiRoadMapStyle(data([10, 70]), [autoColumn], suggestion);
  const filtered = aiRoadMapStyle(data([20, 140]), [autoColumn], suggestion);
  assert.deepEqual(first.rows.map(row => row.color), filtered.rows.map(row => row.color));
  assert.deepEqual(filtered.rows.map(row => row.value), [20, 40, 60, 80, 100, 120, 140]);
  const empty = aiRoadMapStyle(data([null, null]), [column], suggestion);
  assert.equal(empty.color, MAP_NO_DATA_COLOR);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.scale.hasData, false);
  const zero = aiRoadMapStyle(data([0, 0]), [autoColumn], suggestion);
  assert.equal(zero.rows.length, 1);
  assert.equal(zero.rows[0].value, 0);
  assert.equal(zero.scale.hasData, true);
  assert.equal(aiRoadMapStyle(data([10]), [{ ...column, legend: null }], suggestion).scale.source, "technical-fallback");
});

test("Line metric changes replace the old AI legend and preserve category colors", () => {
  const numeric = { name: "value", role: "measure", aggDefault: "mean", unit: "°C", legend: legendFixture() };
  const category = { name: "status", role: "category", legend: {
    aggregation: null, type: "categorical", mode: "semantic", title: "Trạng thái", unit: null, domain: null, center: null,
    stops: [{ value: "Mở", color: "#123456" }, { value: "Đóng", color: "#abcdef" }], combinations: [], reason: "Màu nhóm do AI đề xuất."
  } };
  const columns = [numeric, category];
  const original = { chartType: "map_line", bindings: { region: "route", value: "value" }, agg: "mean", legend: numeric.legend };
  const changed = withSuggestionMetric(original, "status", columns);
  assert.deepEqual(changed.legend, category.legend);
  const style = aiRoadMapStyle({ features: [{ properties: { status: "Mở" } }] }, columns, changed);
  assert.deepEqual(style.color, ["match", ["to-string", ["get", "status"]], "Mở", "#123456", "Đóng", "#abcdef", MAP_NO_DATA_COLOR]);
  assert.equal(style.scale.source, "ai");
  assert.equal(style.scale.title, "Trạng thái");
  assert.deepEqual(withSuggestionMetric(changed, "value", columns).legend, numeric.legend);
});

test("map_line có registry và validation, không tự thêm khi AI chưa đề xuất", () => {
  assert.equal(AI_CHART_REGISTRY.map_line.renderer, "MapLibre");
  assert.equal(AI_CHART_REGISTRY.map_line.label, "Bản đồ Line");
  assert.equal(AI_CHART_REGISTRY.line.renderer, "Recharts");
  assert.deepEqual(analysis.suggestions.map(item => item.chartType), ["map_line", "line", "bar"]);
  assert.deepEqual(analysis.validationErrors, []);
  assert.deepEqual(fallbackAnalysis(profile).suggestions, []);
  const bad = validateAndNormalizeAnalysis({ ...trafficAiAnalysis, suggestions: [
    { id: "bad", chartType: "map_line", bindings: { region: "Không có", value: TRAFFIC_SPEED } }
  ] }, profile);
  assert.ok(bad.validationErrors.length);
  assert.equal(validateAndNormalizeAnalysis({ ...trafficAiAnalysis, suggestions: [] }, profile).suggestions.length, 0);
});

test("tự xác định mạng đường từ cột Khu vực, kể cả dữ liệu nhiều tỉnh", () => {
  const columns = [{ name: "Khu vực", role: "geo", geoLevel: "admin1" }];
  assert.equal(roadAreaField(columns), "Khu vực");
  assert.equal(roadNetworkForArea("Hà Nội"), "hanoi");
  assert.equal(roadNetworkForArea("TP. Hồ Chí Minh"), "ho_chi_minh");
  assert.equal(roadNetworkForArea("Tỉnh An Giang"), "an_giang");
  assert.equal(roadNetworkForArea("Không xác định"), null);
  assert.deepEqual(roadNetworksFromRecords([
    { "Khu vực": "Hà Nội" }, { "Khu vực": "An Giang" }, { "Khu vực": "Chưa hỗ trợ" }
  ], columns), { field: "Khu vực", networkIds: ["hanoi", "an_giang"], unknownAreas: ["Chưa hỗ trợ"] });
  assert.deepEqual(roadNetworksFromRecords([{ province: "Đà Nẵng" }], [{ name: "province", role: "category" }]), {
    field: null, networkIds: [], unknownAreas: []
  });
  assert.equal(roadAreaField([{ name: "market", role: "geo", geoLevel: "admin1" }]), "market");
});

test("road observations do not supplement missing AI map suggestions", () => {
  const data = normalizeTabularRecords(trafficRecords, analysis.columns);
  const suggestions = prepareSuggestions({ ...analysis, suggestions: analysis.suggestions.filter(item => item.chartType !== "map_line") }, data.records, data.validRowRate, { mapOnly: true });
  assert.deepEqual(suggestions, []);
  assert.deepEqual(prepareSuggestions({ ...analysis, suggestions: [] }, data.records, data.validRowRate, { mapOnly: true }), []);
});

test("ghép từng dòng vào đúng mạng theo Khu vực, không ghép chéo tên đường trùng", () => {
  const columns = [
    { name: "Khu vực", role: "geo", geoLevel: "admin1" },
    { name: "Tên đường", role: "category" },
    { name: TRAFFIC_SPEED, role: "measure", aggDefault: "mean" }
  ];
  const line = (name, lng) => ({ type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates: [[lng, 10], [lng + .01, 10.01]] } });
  const geometries = {
    hanoi: { type: "FeatureCollection", features: [line("Đường Trùng Tên", 105.8)] },
    an_giang: { type: "FeatureCollection", features: [line("Đường Trùng Tên", 105.1), line("Chỉ có ở An Giang", 105.2)] }
  };
  const data = joinRoadRecordsByArea([
    { "Khu vực": "Hà Nội", "Tên đường": "Đường Trùng Tên", [TRAFFIC_SPEED]: 20 },
    { "Khu vực": "An Giang", "Tên đường": "Đường Trùng Tên", [TRAFFIC_SPEED]: 30 },
    { "Khu vực": "Hà Nội", "Tên đường": "Chỉ có ở An Giang", [TRAFFIC_SPEED]: 40 }
  ], geometries, { roadField: "Tên đường", valueField: TRAFFIC_SPEED, columns });
  assert.equal(data.features.length, 2);
  assert.deepEqual(data.features.map(feature => feature.geometry.coordinates[0][0]), [105.8, 105.1]);
  assert.deepEqual(data.features.map(feature => feature.properties["Khu vực"]), ["Hà Nội", "An Giang"]);
  assert.equal(data.stats.matchedRows, 2);
  assert.deepEqual(data.stats.unmatched, ["Chỉ có ở An Giang"]);
});

test("bộ lọc thời điểm map_line giữ giờ, ghép hình học và cập nhật giá trị theo bộ lọc", () => {
  const { records, validRowRate } = normalizeTabularRecords(trafficRecords, analysis.columns);
  const suggestion = prepareSuggestions(analysis, records, validRowRate, { mapTilerAvailable: false }).find(item => item.chartType === "map_line");
  assert.ok(suggestion.available);
  const filter = defaultTimeFilter(records, analysis.columns, "map_line");
  assert.equal(filter.control, "datetime-select");
  assert.equal(filter.values.length, 3);
  for (const [index, value] of filter.values.entries()) {
    const selected = applyPipelineFilters(records, { "Thời điểm": value });
    const data = joinRoadRecords(selected, roads, { roadField: "Tên đường", valueField: TRAFFIC_SPEED, columns: analysis.columns });
    assert.equal(data.features.length, 2);
    assert.equal(data.features[0].properties[TRAFFIC_SPEED], [24, 20, 38][index]);
    assert.equal(data.stats.totalRows, 84);
    assert.equal(data.stats.matchedRows, 2);
    assert.equal(data.stats.unmatched.length, 82);
    assert.deepEqual(data.features[0].geometry, roads.features[0].geometry);
    assert.equal(data.features[0].properties["Mức độ ùn tắc"], index === 2 ? "Thông thoáng" : "Đông");
  }
});

test("ghép tên có dấu/mảng tên và yêu cầu tên, mã cùng khớp khi có mã", () => {
  const records = [
    { "Tên đường": "duong linh nam", [TRAFFIC_SPEED]: 20 },
    { "Tên đường": "duong linh nam", [TRAFFIC_SPEED]: 30 },
    { "Tên đường": "Đường Ngọc Hồi", "Mã đường": "QL.1", [TRAFFIC_SPEED]: 40 },
    { "Tên đường": "Đường Lĩnh Nam", "Mã đường": "QL.1", [TRAFFIC_SPEED]: 50 },
    { "Tên đường": "Không có tên trên bản đồ", "Mã đường": "QL.1", [TRAFFIC_SPEED]: 60 },
    { "Tên đường": "Không khớp", [TRAFFIC_SPEED]: null }
  ];
  const data = joinRoadRecords(records, roads, { roadField: "Tên đường", valueField: TRAFFIC_SPEED, columns: analysis.columns });
  assert.equal(data.features.length, 2);
  assert.equal(data.features[0].properties[TRAFFIC_SPEED], 25);
  assert.equal(data.features[1].properties[TRAFFIC_SPEED], 40);
  assert.equal(data.stats.matchedRows, 3);
  assert.deepEqual(data.stats.unmatched, ["Đường Lĩnh Nam", "Không có tên trên bản đồ", "Không khớp"]);
  assert.throws(() => joinRoadRecords(records, {}, {}), /không hợp lệ/);
});

test("không ghép tuyến Hà Nội vào mạng tỉnh khác chỉ vì trùng mã đường", () => {
  const anGiangRoads = { type: "FeatureCollection", features: [{
    type: "Feature",
    properties: { name: "Đường cao tốc Cần Thơ - Cà Mau", ref: "CT.01" },
    geometry: { type: "LineString", coordinates: [[105.24, 9.44], [105.25, 9.45]] }
  }] };
  const records = [{
    "Tên đường": "Đường cao tốc Pháp Vân - Cầu Giẽ",
    "Mã đường": "CT.01",
    [TRAFFIC_SPEED]: 84
  }];
  const data = joinRoadRecords(records, anGiangRoads, {
    roadField: "Tên đường", valueField: TRAFFIC_SPEED, columns: analysis.columns
  });
  assert.equal(data.features.length, 0);
  assert.equal(data.stats.matchedRows, 0);
  assert.deepEqual(data.stats.unmatched, ["Đường cao tốc Pháp Vân - Cầu Giẽ"]);
});

test("chỉ số bản đồ nhận cả số và trạng thái; màu/chú giải đổi theo đúng chỉ số", () => {
  const options = roadValueColumns(analysis.columns, trafficRecords, "Tên đường");
  assert.ok(options.some(column => column.name === "Mức độ ùn tắc"));
  assert.ok(!options.some(column => ["Tên đường", "Thời điểm", "Mã đường"].includes(column.name)));
  const suggestion = analysis.suggestions.find(item => item.chartType === "map_line");
  const updated = withSuggestionMetric(suggestion, TRAFFIC_SPEED, analysis.columns);
  assert.equal(updated.bindings.region, "Tên đường");
  assert.equal(updated.bindings.value, TRAFFIC_SPEED);
  assert.equal(updated.agg, "mean");
  const data = joinRoadRecords(trafficRecords, roads, { roadField: "Tên đường", valueField: TRAFFIC_SPEED, columns: analysis.columns });
  const numeric = roadMapStyle(data, analysis.columns.find(column => column.name === TRAFFIC_SPEED));
  assert.equal(numeric.rows.length, 4);
  assert.equal(numeric.color[0], "case");
  const numericOverride = roadMapStyle(data, analysis.columns.find(column => column.name === TRAFFIC_SPEED), { "measure-0": "#123456" });
  assert.equal(numericOverride.rows[0].color, "#123456");
  assert.ok(numericOverride.color.flat(Infinity).includes("#123456"));
  const categories = roadMapStyle({ features: [
    { properties: { "Mức độ ùn tắc": "Ùn tắc" } }, { properties: { "Mức độ ùn tắc": "Thông thoáng" } }
  ] }, analysis.columns.find(column => column.name === "Mức độ ùn tắc"));
  const renamed = roadMapStyle({ features: [{ properties: { status: "Ùn tắc" } }, { properties: { status: "Thông thoáng" } }] }, { name: "status", role: "category" });
  assert.deepEqual(categories.rows, renamed.rows, "category colors do not depend on a known traffic field name");
  const categoryOverride = roadMapStyle({ features: [{ properties: { "Mức độ ùn tắc": "Ùn tắc" } }] },
    analysis.columns.find(column => column.name === "Mức độ ùn tắc"), { "category:Ùn tắc": "#123456" });
  assert.equal(categoryOverride.rows[0].color, "#123456");
  assert.equal(roadMapStyle({ features: [] }, { name: "value", role: "measure" }).color, "rgba(0, 0, 0, 0)");
});

test("Line retains zero and leaves missing selected values transparent, including an all-null column", () => {
  const column = { name: "value", role: "measure", aggDefault: "mean" };
  const records = [{ road: "Đường Lĩnh Nam", value: 0 }, { road: "Đường Ngọc Hồi", value: null }];
  const join = source => joinRoadRecords(source, roads, { roadField: "road", valueField: "value", columns: [{ name: "road", role: "text" }, column] });
  const data = join(records);
  assert.equal(data.features.length, 2);
  assert.equal(data.features[0].properties.value, 0);
  const paint = roadMapStyle(data, column);
  assert.equal(paint.rows[0].label, "0");
  assert.equal(paint.color.at(-1), "rgba(0, 0, 0, 0)");
  assert.deepEqual(roadMapStyle(join(records.map(row => ({ ...row, value: null }))), column), { color: "rgba(0, 0, 0, 0)", rows: [] });
});

test("Line retains searchable roads and distinguishes missing measures from a constant zero", () => {
  const columns = [{ name: "route", role: "text" }, { name: "metric", role: "measure", aggDefault: "mean" }];
  const data = joinRoadRecords([
    { route: "Đường Lĩnh Nam", metric: null }, { route: "Đường Lĩnh Nam", metric: " " },
    { route: "Đường Ngọc Hồi", metric: 0 }
  ], roads, { roadField: "route", valueField: "metric", columns });
  assert.deepEqual(data.features.map(feature => feature.properties.metric), [null, 0]);
  const style = roadMapStyle(data, columns[1]);
  assert.equal(style.rows.length, 1);
  assert.deepEqual(style.color[1], ["==", ["typeof", ["get", "metric"]], "number"]);
  assert.equal(style.color[2], style.rows[0].color);
  assert.equal(style.color[3], MAP_NO_DATA_COLOR);
  const index = buildDataSearchIndex({ data, columns, chartType: "map_line", search_bar: true, search_fields: ["route"] });
  assert.equal(index.enabled, true);
  assert.equal(searchDataIndex(index, "linh nam")[0].feature, data.features[0]);
  const empty = { features: data.features.map(feature => ({ ...feature, properties: { ...feature.properties, metric: null } })) };
  assert.deepEqual(roadMapStyle(empty, columns[1]), { color: MAP_NO_DATA_COLOR, rows: [] });
  const categorical = roadMapStyle({ features: [null, "", " ", "Open"].map(status => ({ properties: { status } })) }, { name: "status", role: "category" });
  assert.equal(categorical.rows.length, 1);
  assert.equal(categorical.color.at(-1), MAP_NO_DATA_COLOR);
});

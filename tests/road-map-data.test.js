import test from "node:test";
import assert from "node:assert/strict";
import { joinRoadRecords, joinRoadRecordsByArea, roadAreaField, roadMapStyle, roadNetworkForArea, roadNetworksFromRecords, roadValueColumns } from "../src/road-map-data.js";
import { defaultTimeFilter, applyPipelineFilters, prepareSuggestions, withSuggestionMetric } from "../src/ai-chart-pipeline.js";
import { fallbackAnalysis, validateAndNormalizeAnalysis, AI_CHART_REGISTRY } from "../src/ai-chart-contract.js";
import { normalizeTabularRecords, profileTabularData } from "../src/tabular-data.js";
import { trafficAiAnalysis, trafficRecords, TRAFFIC_SPEED } from "./fixtures/road-traffic-fixture.js";

const roads = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { name: "Đường Lĩnh Nam" }, geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] } },
  { type: "Feature", properties: { name: ["Tên khác", "Đường Ngọc Hồi"], ref: "QL1" }, geometry: { type: "MultiLineString", coordinates: [[[105.82, 21], [105.83, 21.01]]] } },
  { type: "Feature", properties: { name: "Đường Lĩnh Nam" }, geometry: { type: "Point", coordinates: [105.8, 21] } }
] };
const profile = profileTabularData(trafficRecords);
const analysis = validateAndNormalizeAnalysis(trafficAiAnalysis, profile);

test("map_line có registry và validation, không tự thêm khi AI chưa đề xuất", () => {
  assert.equal(AI_CHART_REGISTRY.map_line.renderer, "MapLibre");
  assert.equal(AI_CHART_REGISTRY.map_line.label, "Bản đồ Line");
  assert.equal(AI_CHART_REGISTRY.line.renderer, "Recharts");
  assert.deepEqual(analysis.suggestions.map(item => item.chartType), ["map_line", "line", "bar"]);
  assert.deepEqual(analysis.validationErrors, []);
  assert.deepEqual(fallbackAnalysis(profile).suggestions, []);
  const bad = validateAndNormalizeAnalysis({ ...trafficAiAnalysis, suggestions: [
    { id: "bad", chartType: "map_line", bindings: { region: "Mã đường", value: TRAFFIC_SPEED } }
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
  assert.equal(roadMapStyle({ features: [] }, { name: "value", role: "measure" }).color, "#94a3b8");
});

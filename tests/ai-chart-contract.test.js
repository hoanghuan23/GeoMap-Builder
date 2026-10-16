import test from "node:test";
import assert from "node:assert/strict";
import { fallbackAnalysis, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";

const profile = {
  rowCount: 2,
  columns: [
    { name: "province", inferredType: "text", uniqueCount: 2 },
    { name: "date", inferredType: "date", dateHint: "iso", uniqueCount: 2 },
    { name: "temperature", inferredType: "number", uniqueCount: 2 },
    { name: "note", inferredType: "text", uniqueCount: 2 }
  ]
};

test("validator loại cột lạ/trùng, bù cột thiếu và chỉ loại suggestion lỗi", () => {
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Thời tiết",
    grain: "một tỉnh một ngày",
    columns: [
      { name: "province", role: "unknown" },
      { name: "province", role: "geo", geoLevel: "admin1", country: "VN" },
      { name: "province", role: "text" },
      { name: "date", role: "time", timeParse: "iso", granularity: "day" },
      { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean" },
      { name: "hallucinated", role: "measure" }
    ],
    suggestions: [
      { id: "map", chartType: "choropleth", title: "Nhiệt độ", bindings: { region: "province", value: "temperature" }, confidence: .9, reason: "phù hợp" },
      { id: "bad", chartType: "line", title: "Sai", bindings: { x: "missing", y: ["temperature"] }, confidence: .9, reason: "sai cột" }
    ]
  }, profile);
  assert.deepEqual(result.columns.map(column => column.name), profile.columns.map(column => column.name));
  assert.equal(result.columns.find(column => column.name === "province").role, "geo");
  assert.equal(result.columns.find(column => column.name === "note").source, "rule");
  assert.deepEqual(result.suggestions.map(item => item.id), ["map"]);
  assert.ok(result.validationErrors.length >= 3);
});

test("giữ nhận diện tỉnh/thành phố khi AI gán category hoặc thiếu geoLevel", () => {
  const regionProfile = { rowCount: 2, columns: [
    { name: "Tỉnh/thành phố", inferredType: "text", uniqueCount: 2 },
    { name: "Nhiệt độ trung bình", inferredType: "number", uniqueCount: 2 }
  ] };
  for (const role of ["category", "text", "geo"]) {
    const result = validateAndNormalizeAnalysis({
      columns: [
        { name: "Tỉnh/thành phố", role, geoLevel: null, labelVi: "Tỉnh/thành phố" },
        { name: "Nhiệt độ trung bình", role: "measure", aggDefault: "mean", unit: "°C" }
      ],
      suggestions: [{
        id: "weather-map", chartType: "choropleth", confidence: .9,
        bindings: { region: "Tỉnh/thành phố", value: "Nhiệt độ trung bình" }
      }]
    }, regionProfile);
    assert.equal(result.columns[0].role, "geo");
    assert.equal(result.columns[0].geoLevel, "admin1");
    assert.equal(result.suggestions[0].id, "weather-map");
    assert.equal(result.source, "ai");
    assert.deepEqual(result.validationErrors, []);
  }
});

test("giữ Khu vực là cột địa phương để tự chọn mạng đường", () => {
  const areaProfile = { rowCount: 2, columns: [
    { name: "Khu vực", inferredType: "text", uniqueCount: 1 },
    { name: "Tên đường", inferredType: "text", uniqueCount: 2 },
    { name: "Tốc độ", inferredType: "number", uniqueCount: 2 }
  ] };
  const result = validateAndNormalizeAnalysis({
    columns: [
      { name: "Khu vực", role: "category", geoLevel: null },
      { name: "Tên đường", role: "category", geoLevel: null },
      { name: "Tốc độ", role: "measure", aggDefault: "mean" }
    ],
    suggestions: [{
      id: "road-map", chartType: "map_line", confidence: .9,
      bindings: { region: "Tên đường", value: "Tốc độ" }
    }]
  }, areaProfile);
  assert.equal(result.columns.find(column => column.name === "Khu vực").role, "geo");
  assert.equal(result.columns.find(column => column.name === "Khu vực").geoLevel, "admin1");
  assert.equal(result.suggestions[0].chartType, "map_line");
});

test("fallback dùng cùng AnalysisResult và không biến id thành measure", () => {
  const result = fallbackAnalysis({
    rowCount: 2,
    columns: [
      { name: "region", inferredType: "text", uniqueCount: 2 },
      { name: "station_id", inferredType: "number", uniqueCount: 2 },
      { name: "total", inferredType: "number", uniqueCount: 2 }
    ]
  });
  assert.equal(result.columns.find(column => column.name === "station_id").role, "id");
  assert.equal(result.columns.find(column => column.name === "total").aggDefault, "sum");
  assert.ok(result.suggestions.some(item => item.chartType === "choropleth"));
  assert.equal(validateAndNormalizeAnalysis(result, {
    rowCount: 2,
    columns: [
      { name: "region", inferredType: "text", uniqueCount: 2 },
      { name: "station_id", inferredType: "number", uniqueCount: 2 },
      { name: "total", inferredType: "number", uniqueCount: 2 }
    ]
  }).source, "rule");
});

test("mỗi kiểu chỉ giữ cấu hình hợp lệ có confidence cao nhất", () => {
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Thời tiết",
    grain: "một tỉnh một ngày",
    columns: [],
    suggestions: [
      { id: "bad-map", chartType: "choropleth", bindings: { region: "missing", value: "temperature" }, confidence: 1 },
      { id: "map-low", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, confidence: .7 },
      { id: "map-high", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, confidence: .95 },
      { id: "bar-note", chartType: "bar", bindings: { x: "note", y: "temperature" }, confidence: .6 },
      { id: "bar-province", chartType: "bar", bindings: { x: "province", y: "temperature" }, confidence: .8 },
      { id: "line", chartType: "line", bindings: { x: "date", y: ["temperature"] }, confidence: .9 }
    ]
  }, profile);
  assert.equal(result.source, "ai");
  assert.deepEqual(result.suggestions.map(item => item.id), ["map-high", "line", "bar-province"]);
  assert.equal(new Set(result.suggestions.map(item => item.chartType)).size, result.suggestions.length);
});

test("AI có thể không đề xuất kiểu nào và quyết định vẫn giữ nguyên khi normalize lần nữa", () => {
  const raw = {
    datasetTitle: "Không có kiểu phù hợp",
    grain: "một tỉnh một ngày",
    columns: [{ name: "temperature", role: "measure", labelVi: "Nhiệt độ", unit: "°C", aggDefault: "mean" }],
    suggestions: []
  };
  const result = validateAndNormalizeAnalysis(raw, profile);
  assert.equal(result.source, "ai");
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.validationErrors, []);
  assert.equal(result.columns.find(column => column.name === "temperature").unit, "°C");
  const normalizedAgain = validateAndNormalizeAnalysis(result, profile);
  assert.equal(normalizedAgain.source, "ai");
  assert.deepEqual(normalizedAgain.suggestions, []);
  assert.deepEqual(normalizedAgain.validationErrors, []);
});

test("suggestions sai contract vẫn fallback thay vì coi là quyết định không đề xuất", () => {
  for (const suggestions of [null, {}, [{ id: "invalid", chartType: "unsupported" }]]) {
    const result = validateAndNormalizeAnalysis({ columns: [], suggestions }, profile);
    assert.equal(result.source, "rule");
    assert.ok(result.suggestions.length);
    assert.ok(result.validationErrors.length);
  }
});

test("fallback ưu tiên chiều địa phương thay vì thuộc tính mô tả khi chọn bar", () => {
  const result = fallbackAnalysis({ rowCount: 2, columns: [
    { name: "weather_status", inferredType: "text", uniqueCount: 2 },
    ...profile.columns
  ] });
  assert.equal(result.suggestions.find(item => item.chartType === "bar").bindings.x, "province");
});

test("fallback dùng Point và không đề xuất H3 cho bảng có kinh độ, vĩ độ", () => {
  const coordinateProfile = {
    rowCount: 2,
    columns: [
      { name: "Mã cửa hàng", inferredType: "text", uniqueCount: 2 },
      { name: "Tên cửa hàng", inferredType: "text", uniqueCount: 2 },
      { name: "Vĩ độ", inferredType: "number", uniqueCount: 2 },
      { name: "Kinh độ", inferredType: "number", uniqueCount: 2 },
      { name: "Doanh thu", inferredType: "number", uniqueCount: 2 }
    ]
  };
  const result = fallbackAnalysis(coordinateProfile);
  const point = result.suggestions.find(item => item.chartType === "point");

  assert.deepEqual(point.bindings, { lat: "Vĩ độ", lng: "Kinh độ" });
  assert.equal(result.suggestions.some(item => item.chartType === "hex_h3"), false);
});

test("validator chấp nhận đề xuất Point với binding kinh độ, vĩ độ", () => {
  const coordinateProfile = {
    rowCount: 2,
    columns: [
      { name: "lat", inferredType: "number", uniqueCount: 2 },
      { name: "lng", inferredType: "number", uniqueCount: 2 },
      { name: "name", inferredType: "text", uniqueCount: 2 }
    ]
  };
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Cửa hàng",
    grain: "một cửa hàng",
    columns: [
      { name: "lat", role: "geo", geoLevel: "point_lat" },
      { name: "lng", role: "geo", geoLevel: "point_lng" },
      { name: "name", role: "text" }
    ],
    suggestions: [{
      id: "stores-point",
      chartType: "point",
      title: "Vị trí cửa hàng",
      bindings: { lat: "lat", lng: "lng" },
      confidence: .98,
      reason: "Mỗi dòng là một cửa hàng có tọa độ."
    }]
  }, coordinateProfile);

  assert.equal(result.source, "ai");
  assert.equal(result.suggestions[0].chartType, "point");
  assert.deepEqual(result.suggestions[0].bindings, { lat: "lat", lng: "lng" });
});

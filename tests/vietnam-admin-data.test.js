import test from "node:test";
import assert from "node:assert/strict";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";

const boundary = (name, x) => ({
  type: "Feature",
  bbox: [x, 0, x + 1, 1],
  properties: { __data_location: name, boundary_source: "MapTiler" },
  geometry: { type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] }
});

test("lọc ngày và gắn dữ liệu lên đúng polygon MapTiler", () => {
  const records = [
    { province: "Hải Phòng", date: "2026-09-01", temperature: 30 },
    { province: "Hải Phòng", date: "2026-09-02", temperature: 31 }
  ];
  const boundaries = { type: "FeatureCollection", features: [boundary("Hải Phòng", 0)] };
  const recommendation = { geometry: { field: "province" }, metricField: "temperature" };
  const result = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: { date: "2026-09-02" } });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.temperature, 31);
  assert.equal(result.features[0].properties.__location, "Hải Phòng");
  assert.equal(result.features[0].properties.boundary_source, "MapTiler");
  assert.deepEqual(result.features[0].geometry, boundaries.features[0].geometry);
});

test("lọc được nhiều tỉnh cùng lúc và mảng rỗng nghĩa là tất cả", () => {
  const records = [
    { province: "Hà Nội", date: "2026-09-01", temperature: 29 },
    { province: "Hải Phòng", date: "2026-09-01", temperature: 28 },
    { province: "An Giang", date: "2026-09-01", temperature: 30 }
  ];
  const boundaries = {
    type: "FeatureCollection",
    features: [boundary("Hà Nội", 0), boundary("Hải Phòng", 1), boundary("An Giang", 2)]
  };
  const recommendation = { geometry: { field: "province" }, metricField: "temperature" };
  const selected = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, {
    filters: { province: ["Hà Nội", "An Giang"] }
  });
  assert.deepEqual(selected.features.map(feature => feature.properties.__location), ["Hà Nội", "An Giang"]);

  const all = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, {
    filters: { province: [] }
  });
  assert.equal(all.features.length, 3);
});

test("không tự ghép hoặc tự tạo polygon khi MapTiler thiếu địa phương", () => {
  const recommendation = { geometry: { field: "province" }, metricField: "value" };
  const result = joinRecordsToMapTilerBoundaries(
    [{ province: "Phú Thọ", value: 10 }],
    { type: "FeatureCollection", features: [] },
    recommendation
  );
  assert.deepEqual(result.features, []);
});

test("choropleth aggregate nhiều dòng cùng địa danh thay vì tạo polygon trùng", () => {
  const recommendation = { geometry: { field: "province" }, metricField: "rain", aggregation: "sum" };
  const result = joinRecordsToMapTilerBoundaries([
    { province: "Hà Nội", rain: 2 },
    { province: "Hà Nội", rain: 3 }
  ], { type: "FeatureCollection", features: [boundary("Hà Nội", 0)] }, recommendation);
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.rain, 5);
  assert.equal(result.features[0].properties.__record_count, 2);
});

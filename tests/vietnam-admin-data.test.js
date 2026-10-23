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

test("choropleth bỏ khu vực thiếu chỉ số đang xem, giữ số 0 và dữ liệu nguồn", () => {
  const records = [
    { region: "Ba Đình", pollution: 26, temperature: 22 },
    { region: "Hà Đông", pollution: null, temperature: 19.4 },
    { region: "Sơn Tây", pollution: 0, temperature: 19.1 }
  ];
  const boundaries = { type: "FeatureCollection", features: records.map((row, index) => boundary(row.region, index)) };
  const original = JSON.stringify({ records, boundaries });
  const columns = [
    { name: "region", role: "geo" },
    { name: "pollution", role: "measure", aggDefault: "mean" },
    { name: "temperature", role: "measure", aggDefault: "mean" }
  ];
  for (const schema of [null, columns]) {
    const recommendation = { geometry: { field: "region" }, metricField: "pollution", aggregation: "mean" };
    const pollution = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { columns: schema });
    assert.deepEqual(pollution.features.map(feature => feature.properties.__location), ["Ba Đình", "Sơn Tây"]);
    assert.equal(pollution.features[1].properties.__metric, 0);
    const temperature = joinRecordsToMapTilerBoundaries(records, boundaries, { ...recommendation, metricField: "temperature" }, { columns: schema });
    assert.equal(temperature.features.length, 3);
    assert.equal(temperature.features[1].properties.temperature, 19.4);
  }
  assert.equal(JSON.stringify({ records, boundaries }), original);
});

test("choropleth không vẽ giá trị thiếu hoặc không hợp lệ trước và sau khi tổng hợp", () => {
  const missing = [null, undefined, "", "   ", NaN, Infinity, -Infinity, "null"];
  const records = missing.map((value, index) => ({ region: `Vùng ${index}`, value }));
  const boundaries = { type: "FeatureCollection", features: records.map((row, index) => boundary(row.region, index)) };
  for (const aggregation of [undefined, "sum", "mean", "min", "max"]) {
    for (const columns of [null, [{ name: "region", role: "geo" }, { name: "value", role: "measure", aggDefault: aggregation }]]) {
      const result = joinRecordsToMapTilerBoundaries(records, boundaries, {
        geometry: { field: "region" }, metricField: "value", aggregation
      }, { columns });
      assert.deepEqual(result.features, [], `aggregation=${aggregation}, columns=${Boolean(columns)}`);
    }
  }
});

test("choropleth tổng hợp các giá trị hợp lệ khi khu vực có cả dòng null", () => {
  const records = [null, "", "   ", 0, 20].map(value => ({ region: "Hà Đông", value }));
  const boundaries = { type: "FeatureCollection", features: [boundary("Hà Đông", 0)] };
  for (const columns of [null, [{ name: "region", role: "geo" }, { name: "value", role: "measure", aggDefault: "mean" }]]) {
    const result = joinRecordsToMapTilerBoundaries(records, boundaries, {
      geometry: { field: "region" }, metricField: "value", aggregation: "mean"
    }, { columns });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].properties.value, 10);
    assert.equal(result.features[0].properties.__record_count, 5);
  }
});

test("choropleth copy schema nguồn và không chọn ngẫu nhiên giá trị phân loại", () => {
  const recommendation = { geometry: { field: "province" }, metricField: "revenue", aggregation: "sum" };
  const columns = [
    { name: "province", role: "geo" },
    { name: "month", role: "time", granularity: "month" },
    { name: "revenue", role: "measure", aggDefault: "sum" },
    { name: "orders", role: "measure", aggDefault: "sum" },
    { name: "channel", role: "category" },
    { name: "note", role: "text" },
    { name: "ignored", role: "ignore" }
  ];
  const result = joinRecordsToMapTilerBoundaries([
    { province: "Lào Cai", month: new Date("2026-12-01T00:00:00Z"), revenue: 2, orders: 3, channel: "Website", note: "ổn định", ignored: "a" },
    { province: "Lào Cai", month: new Date("2026-12-01T00:00:00Z"), revenue: 4, orders: 5, channel: "Cửa hàng", note: "ổn định", ignored: "b" }
  ], { type: "FeatureCollection", features: [boundary("Lào Cai", 0)] }, recommendation, { columns });
  const properties = result.features[0].properties;
  assert.equal(properties.revenue, 6);
  assert.equal(properties.orders, 8);
  assert.equal(properties.month, "2026-12-01T00:00:00.000Z");
  assert.equal(properties.channel, "Nhiều giá trị (2)");
  assert.equal(properties.note, "ổn định");
  assert.equal(properties.ignored, undefined);
});

test("choropleth giữ Kênh bán chính khi các dòng đồng nhất", () => {
  const result = joinRecordsToMapTilerBoundaries([
    { province: "Lào Cai", value: 2, channel: "Website" },
    { province: "Lào Cai", value: 4, channel: "Website" }
  ], { type: "FeatureCollection", features: [boundary("Lào Cai", 0)] }, {
    geometry: { field: "province" }, metricField: "value", aggregation: "sum"
  }, { columns: [
    { name: "province", role: "geo" },
    { name: "value", role: "measure", aggDefault: "sum" },
    { name: "channel", role: "category", labelVi: "Kênh bán chính" }
  ] });
  assert.equal(result.features[0].properties.channel, "Website");
});

import test from "node:test";
import assert from "node:assert/strict";
import { clipGeoJSONToPolygon, geometryKinds, isHexagonGeoJSON, pointGeoJSONToRecords } from "../src/geojson-layers.js";
import { fallbackAnalysis } from "../src/ai-chart-contract.js";
import { profileTabularData } from "../src/tabular-data.js";

const cells = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { cell_id: "hex_1", geometry_type: "synthetic_hexagon" }, geometry: { type: "Polygon", coordinates: [[[-1, -1], [1, -1], [2, 0], [1, 1], [-1, 1], [-2, 0], [-1, -1]]] } },
    { type: "Feature", properties: { cell_id: "hex_2" }, geometry: { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] } }
  ]
};

test("recognizes uploaded geometry roles and hexagon files", () => {
  assert.deepEqual(geometryKinds(cells), ["area"]);
  assert.equal(isHexagonGeoJSON(cells, "anything.geojson"), true);
  assert.equal(isHexagonGeoJSON({ type: "FeatureCollection", features: [] }, "hexagons.geojson"), false);
});

test("clips hexagon geometry to the drawn polygon instead of only filtering it", () => {
  const mask = { type: "Polygon", coordinates: [[[0, -2], [3, -2], [3, 2], [0, 2], [0, -2]]] };
  const clipped = clipGeoJSONToPolygon(cells, mask);
  assert.equal(clipped.features.length, 1);
  assert.equal(clipped.features[0].properties.cell_id, "hex_1");
  const vertices = clipped.features[0].geometry.coordinates.flat(2);
  assert.ok(vertices.every((value, index) => index % 2 || value >= -2));
  assert.ok(clipped.features[0].geometry.coordinates[0].every(([longitude]) => longitude >= 0 && longitude <= 3));
});

test("the clipping utility returns no features when no polygon mask is supplied", () => {
  assert.deepEqual(clipGeoJSONToPolygon(cells, null), { type: "FeatureCollection", features: [] });
});

test("Point analysis retains properties, feature IDs and authoritative geometry without field collisions", () => {
  const data = { type: "FeatureCollection", features: [{ type: "Feature", id: "KT001",
    properties: { station_id: "KT001", ten_tram: "Trạm Hà Nội", nhiet_do_c: 19.6, do_am_phan_tram: 65,
      latitude: "original", __geojson_latitude: "keep", __geojson_longitude: 123, __geojson_feature_id: "keep-id" },
    geometry: { type: "Point", coordinates: [105.935752, 21.079462, 20] }
  }] };
  const before = JSON.stringify(data);
  const { records, bindings } = pointGeoJSONToRecords(data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(records.length, 1);
  assert.equal(records[0][bindings.lat], 21.079462);
  assert.equal(records[0][bindings.lng], 105.935752);
  assert.equal(records[0].__geojson_feature_id_2, "KT001");
  for (const [field, value] of Object.entries(data.features[0].properties)) assert.equal(records[0][field], value);
  const analysis = fallbackAnalysis(profileTabularData(records));
  assert.deepEqual(analysis.suggestions.find(item => item.chartType === "point").bindings, bindings);
  assert.deepEqual(analysis.columns.filter(column => column.role === "measure").map(column => column.name), ["nhiet_do_c", "do_am_phan_tram"]);
});

test("Point conversion supports geometry inputs and MultiPoint while invalid positions remain missing", () => {
  const multi = { type: "Feature", properties: { value: 7 }, geometry: { type: "GeometryCollection", geometries: [
    { type: "MultiPoint", coordinates: [[105, 21], [106, 22], [181, 21], [105, null], ["105", "21"]] },
    { type: "Point", coordinates: [107, 23] }
  ] } };
  const { records, bindings: { lat, lng } } = pointGeoJSONToRecords(multi);
  assert.deepEqual(records.map(record => [record[lng], record[lat]]), [[105, 21], [106, 22], [null, null], [null, null], [null, null], [107, 23]]);
  assert.ok(records.every(record => record.value === 7));
  assert.equal(pointGeoJSONToRecords({ type: "Point", coordinates: [0, 0] }).records.length, 1);
  for (const data of [null, cells, { type: "FeatureCollection", features: [] },
    { type: "GeometryCollection", geometries: [multi.geometry, { type: "LineString", coordinates: [[105, 21], [106, 22]] }] }]) {
    assert.equal(pointGeoJSONToRecords(data), null);
  }
});

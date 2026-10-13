import test from "node:test";
import assert from "node:assert/strict";
import { clipGeoJSONToPolygon, geometryKinds, isHexagonGeoJSON } from "../src/geojson-layers.js";

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

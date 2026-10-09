import test from "node:test";
import assert from "node:assert/strict";
import { PolygonRenderer } from "../src/renderers/polygon-renderer.js";

const polygon = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [[[106, 10], [107, 10], [107, 11], [106, 10]]]
  }
};

test("polygon renderer tạo lớp tô và đường viền", () => {
  const sources = new Map();
  const layers = new Map();
  const map = {
    getSource: id => sources.get(id),
    addSource: (id, source) => sources.set(id, source),
    getLayer: id => layers.get(id),
    addLayer: layer => layers.set(layer.id, layer)
  };

  const ids = PolygonRenderer.render(map, polygon);

  assert.deepEqual(ids, ["polygon-fill", "polygon-border"]);
  assert.equal(sources.get("polygon-data").data, polygon);
  assert.equal(layers.get("polygon-fill").type, "fill");
  assert.equal(layers.get("polygon-border").type, "line");
});

test("polygon renderer cập nhật source đã có", () => {
  let currentData = null;
  const source = { setData: data => { currentData = data; } };
  const layers = new Map([
    ["polygon-fill", { id: "polygon-fill" }],
    ["polygon-border", { id: "polygon-border" }]
  ]);
  const map = {
    getSource: () => source,
    getLayer: id => layers.get(id),
    addSource: () => assert.fail("không được tạo lại source"),
    addLayer: () => assert.fail("không được tạo lại layer")
  };

  PolygonRenderer.render(map, polygon);

  assert.equal(currentData, polygon);
});

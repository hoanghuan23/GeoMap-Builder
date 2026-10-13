import test from "node:test";
import assert from "node:assert/strict";
import { deterministicLayerOrder, layerOrderProfile, mapLayerIdsInOrder, normalizeLayerOrder } from "../src/layer-order.js";

const uploadedInWrongOrder = [
  { id: "route", name: "metro_route.geojson", role: "line", geometryKinds: ["line"], featureCount: 1 },
  { id: "stations", name: "stations.geojson", role: "point", geometryKinds: ["point"], featureCount: 13 },
  { id: "hexagons", name: "hexagons.geojson", role: "hexagon", geometryKinds: ["area"], featureCount: 3980 }
];

test("xếp hexagon dưới route và station bất kể thứ tự upload", () => {
  assert.deepEqual(deterministicLayerOrder(uploadedInWrongOrder), ["hexagons", "route", "stations"]);
});

test("chuẩn hóa đề xuất AI, loại ID lạ và bổ sung layer bị thiếu", () => {
  assert.deepEqual(normalizeLayerOrder(uploadedInWrongOrder, ["hexagons", "unknown", "stations"]), ["hexagons", "route", "stations"]);
});

test("đề xuất AI không được phá thứ tự geometry nền → tuyến → điểm", () => {
  assert.deepEqual(normalizeLayerOrder(uploadedInWrongOrder, ["stations", "route", "hexagons"]), ["hexagons", "route", "stations"]);
});

test("chuyển thứ tự dữ liệu thành thứ tự layer MapLibre", () => {
  const layers = uploadedInWrongOrder.map(layer => ({
    ...layer,
    layerIds: layer.id === "hexagons" ? ["hex-fill", "hex-border"] : [`${layer.id}-layer`]
  }));
  assert.deepEqual(
    mapLayerIdsInOrder(layers, deterministicLayerOrder(layers)),
    ["hex-fill", "hex-border", "route-layer", "stations-layer"]
  );
});

test("chỉ gửi metadata lớp, không gửi toàn bộ GeoJSON", () => {
  const profile = layerOrderProfile(uploadedInWrongOrder.map(layer => ({ ...layer, originalData: { huge: true } })));
  assert.equal(profile[0].originalData, undefined);
  assert.deepEqual(profile.map(layer => layer.id), ["route", "stations", "hexagons"]);
});

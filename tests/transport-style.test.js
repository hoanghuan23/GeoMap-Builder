import test from "node:test";
import assert from "node:assert/strict";
import { transportClasses, transportClassStyle, transportColorExpression, transportGeometryKind } from "../src/transport-style.js";

test("nhận diện đúng ba lớp giao thông OSM", () => {
  assert.equal(transportGeometryKind("gis_osm_transport_free.geojson"), "point");
  assert.equal(transportGeometryKind("/tmp/gis_osm_transport_a_free.json"), "area");
  assert.equal(transportGeometryKind("GIS_OSM_RAILWAYS_FREE.GEOJSON"), "line");
  assert.equal(transportGeometryKind("dulieu_diem_phuontien.geojson"), "point");
  assert.equal(transportGeometryKind("dulieu_khuvuc_giaothong.geojson"), "area");
  assert.equal(transportGeometryKind("dulieu_duongsat.geojson"), "line");
  assert.equal(transportGeometryKind("other.geojson"), null);
});

test("vẫn nhận diện lớp giao thông sau khi đổi tên file", () => {
  const renamed = { type: "FeatureCollection", features: [{
    type: "Feature",
    properties: { fclass: "bus_stop" },
    geometry: { type: "Point", coordinates: [105.8, 21.0] }
  }] };
  assert.equal(transportGeometryKind("ten_bat_ky.geojson", renamed), "point");
});

test("cung cấp màu và mô tả tiếng Việt theo fclass", () => {
  assert.equal(transportClassStyle("bus_stop").label, "Điểm dừng xe buýt");
  assert.equal(transportClassStyle("rail", "line").color, "#e11d48");
  assert.notEqual(transportClassStyle("bus_station", "point").color, transportClassStyle("bus_station", "area").color);
  assert.equal(transportClassStyle("unknown", "line").color, "#be123c");
  assert.deepEqual(transportColorExpression("point").slice(0, 2), ["match", ["coalesce", ["get", "fclass"], ""]]);
});

test("không trùng màu giữa các mục trong cùng nhóm hình học", () => {
  const classes = {
    point: ["bus_stop", "ferry_terminal", "bus_station", "railway_station", "helipad", "taxi", "airport", "railway_halt", "airfield"],
    area: ["bus_station", "apron", "helipad", "airport", "ferry_terminal", "railway_station", "airfield", "taxi"],
    line: ["rail", "subway", "narrow_gauge", "funicular", "monorail", "miniature_railway", "light_rail"]
  };
  for (const [kind, values] of Object.entries(classes)) {
    const colors = values.map(value => transportClassStyle(value, kind).color);
    assert.equal(new Set(colors).size, colors.length, `${kind} có màu bị trùng`);
  }
});

test("chú giải chỉ liệt kê các fclass có trong lớp", () => {
  const data = { type: "FeatureCollection", features: [
    { properties: { fclass: "rail" } },
    { properties: { fclass: "subway" } },
    { properties: { fclass: "rail" } }
  ] };
  assert.deepEqual(new Set(transportClasses(data)), new Set(["rail", "subway"]));
});

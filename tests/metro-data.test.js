import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readMetroData, metroCellsAtTime, travelFillExpression, travelLegendColors, TRAVEL_COLORS } from "../src/metro-data.js";

const source = JSON.parse(readFileSync(new URL("../geomap_metro1_du_lieu_mo_phong.json", import.meta.url), "utf8"));

test("loads the Metro bundle without classifying it as chart data", () => {
  const data = readMetroData(source);
  assert.equal(data.hexagons.features.length, 3980);
  assert.equal(data.stations.features.length, 13);
  assert.deepEqual(data.times, Array.from({ length: 18 }, (_, i) => `${String(i + 5).padStart(2, "0")}:30`));
  assert.deepEqual(data.times, source.metadata.departure_times);
  assert.equal(data.boundary.type, "FeatureCollection");
  for (const feature of data.boundary.features) assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
  assert.equal(data.metro_route.features[0].geometry.type, "LineString");
  assert.equal(readMetroData({ type: "FeatureCollection", features: [] }), null);
});

test("branched demo has valid polygons and a complete, unique departure matrix", () => {
  const ids = new Set(source.hexagons.features.map(f => f.properties.cell_id));
  assert.equal(ids.size, source.hexagons.features.length);
  assert.equal(source.metadata.cell_count, ids.size);
  assert.equal(source.travel_times.length, ids.size * source.metadata.departure_times.length);
  assert.equal(source.metadata.travel_time_count, source.travel_times.length);
  const keys = new Set();
  for (const row of source.travel_times) {
    assert.ok(ids.has(row.cell_id));
    assert.ok(source.metadata.departure_times.includes(row.departure_time));
    const key = `${row.cell_id}/${row.departure_time}`;
    assert.ok(!keys.has(key), `Duplicate travel-time row: ${key}`);
    keys.add(key);
    assert.ok(Number.isFinite(row.bus_minutes) && row.bus_minutes > 0);
    assert.ok(Number.isFinite(row.motorbike_minutes) && row.motorbike_minutes > 0);
    assert.ok(Math.abs(row.ratio - row.bus_minutes / row.motorbike_minutes) <= 0.0051);
  }
  const boundary = source.boundary.features[0]?.geometry.coordinates[0];
  function inside([x, y]) {
    if (!boundary) {
      const bbox = source.metadata.extent_bbox;
      return !bbox || x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
    }
    let result = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      const [xi, yi] = boundary[i], [xj, yj] = boundary[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
    }
    return result;
  }
  const vertices = [];
  for (const cell of source.hexagons.features) {
    const ring = cell.geometry.coordinates[0];
    assert.equal(cell.geometry.type, "Polygon");
    assert.equal(ring.length, 7);
    assert.deepEqual(ring[0], ring.at(-1));
    for (const vertex of ring) assert.ok(inside(vertex), `${cell.properties.cell_id} outside boundary`);
    vertices.push(...ring);
  }
  // Branches extend west, east, south and north of the central Metro corridor.
  assert.ok(Math.min(...vertices.map(v => v[0])) < 106.64);
  assert.ok(Math.max(...vertices.map(v => v[0])) > 106.82);
  assert.ok(Math.min(...vertices.map(v => v[1])) < 10.71);
  assert.ok(Math.max(...vertices.map(v => v[1])) > 10.89);
  const data = readMetroData(source);
  assert.notDeepEqual(data.byTime.get("05:30").get("hex_3980"), data.byTime.get("17:30").get("hex_3980"));
});

test("joins travel times by cell and departure, preserving original geometry", () => {
  const data = readMetroData(source);
  for (const time of data.times) {
    const cells = metroCellsAtTime(data, time);
    for (const [index, cell] of cells.features.entries()) {
      const row = data.byTime.get(time).get(cell.properties.cell_id);
      assert.equal(cell.geometry, source.hexagons.features[index].geometry);
      assert.equal(cell.properties.bus_minutes, row.bus_minutes);
      assert.equal(cell.properties.motorbike_minutes, row.motorbike_minutes);
      assert.equal(cell.properties.ratio, row.bus_minutes / row.motorbike_minutes);
      assert.equal(cell.properties.departure_time, time);
      assert.equal(cell.properties.ratio_0530, undefined);
    }
  }
  const firstRow = data.byTime.get("05:30").get(source.hexagons.features[0].properties.cell_id);
  assert.equal(source.hexagons.features[0].properties.ratio_0530, firstRow.ratio);
  assert.equal(metroCellsAtTime(data, "05:30").features[0].properties.ratio, firstRow.bus_minutes / firstRow.motorbike_minutes);
});

test("missing times and zero denominators remain missing instead of zero ratios", () => {
  const data = readMetroData({ ...source, travel_times: [{ cell_id: "hex_0001", departure_time: "05:30", bus_minutes: 10, motorbike_minutes: 0 }] });
  const cells = metroCellsAtTime(data, "05:30");
  assert.equal(cells.features[0].properties.ratio, null);
  assert.equal(cells.features[1].properties.ratio, null);
});

test("color thresholds and legend use the same four ratio bands", () => {
  const expression = travelFillExpression("travel", "#ffffff");
  assert.deepEqual(expression[3], ["step", ["get", "ratio"], TRAVEL_COLORS[0], 1, TRAVEL_COLORS[1], 2, TRAVEL_COLORS[2], 3, TRAVEL_COLORS[3]]);
  assert.deepEqual(travelLegendColors("travel"), TRAVEL_COLORS);
  assert.equal(travelFillExpression(null, "#123456"), "#123456");
});

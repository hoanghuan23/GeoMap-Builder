import test from "node:test";
import assert from "node:assert/strict";
import { buildCoordinateLines, coordinateBindings, inferCoordinateLine } from "../src/coordinate-data.js";
import { prepareSuggestions } from "../src/ai-chart-pipeline.js";
import { validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { storeColumns, storeRecords, storeSuggestions } from "./fixtures/store-points-fixture.js";

const columns = [{ name: "vi_do", role: "measure" }, { name: "kinh_do", role: "measure" }, { name: "speed", role: "measure", aggDefault: "mean" }];
const bindings = { lat: "vi_do", lng: "kinh_do" };
const records = [3, 1, 2].map(value => ({ vi_do: 21 + value / 100, kinh_do: 105 + value / 100, speed: value * 10 }));

test("coordinate paths use file row order by default and preserve input records", () => {
  const before = JSON.stringify(records);
  assert.deepEqual(coordinateBindings(columns), bindings);
  assert.deepEqual(inferCoordinateLine(records, columns), bindings);
  const data = buildCoordinateLines(records, columns, bindings);
  assert.deepEqual(data.features[0].geometry.coordinates, [[105.03,21.03], [105.01,21.01], [105.02,21.02]]);
  assert.equal(data.features[0].properties.speed, 20);
  assert.equal(data.stats.matchedRows, 3);
  assert.equal(JSON.stringify(records), before);
});

test("coordinate paths sort each route independently by sequence or time", () => {
  for (const time of [false, true]) {
    const fields = [...columns, { name: "route", role: "id" }, { name: "stt", role: time ? "time" : "measure" }];
    const rows = ["B", "A"].flatMap(route => records.map((record, index) => ({ ...record, route,
      stt: time ? new Date(`2026-01-0${[3,1,2][index]}`) : [3,1,2][index] })));
    const found = inferCoordinateLine(rows, fields);
    assert.equal(found.region, "route"); assert.equal(found.x, "stt");
    const data = buildCoordinateLines(rows, fields, found);
    assert.equal(data.features.length, 2);
    assert.deepEqual(data.features.map(feature => feature.properties.route), ["B", "A"]);
    for (const feature of data.features) assert.deepEqual(feature.geometry.coordinates, [[105.01,21.01], [105.02,21.02], [105.03,21.03]]);
  }
});

test("invalid coordinates split paths; repeated or empty coordinates do not become lines", () => {
  const rows = [...records.slice(0,2), { vi_do: null, kinh_do: 105 }, ...records.slice(1)];
  const result = buildCoordinateLines(rows, columns, bindings);
  assert.equal(result.features[0].geometry.type, "MultiLineString");
  assert.equal(result.features[0].geometry.coordinates.length, 2);
  for (const rows of [[], [records[0]], [records[0], records[0]], [{ vi_do: "", kinh_do: null }, records[0]], [{ vi_do: 91, kinh_do: 181 }]]) {
    assert.deepEqual(buildCoordinateLines(rows, columns, bindings).features, []);
  }
  assert.equal(inferCoordinateLine([...records, ...Array(3).fill({})], columns), null);
});

test("fixed stores with repeated monthly observations stay Point even if AI offers a coordinate Line", () => {
  assert.equal(inferCoordinateLine(storeRecords, storeColumns), null);
  assert.equal(inferCoordinateLine(storeRecords.slice(0, 4), storeColumns), null, "incomplete monthly observations still describe fixed stores");
  const result = prepareSuggestions({ columns: storeColumns, suggestions: [...storeSuggestions,
    { id: "bad-path", chartType: "map_line", confidence: 1, title: "Path", bindings: { lat: "vi_do", lng: "kinh_do", x: "thang" } }
  ] }, storeRecords, {}, { mapOnly: true });
  assert.equal(result.find(item => item.chartType === "point").available, true);
  assert.equal(result.find(item => item.chartType === "map_line").available, false);
  assert.match(result.find(item => item.chartType === "map_line").unavailableReason, /cố định/);
  assert.ok(result.every(item => ["point", "map_line", "choropleth"].includes(item.chartType)));
});

test("coordinate Line contract allows optional group, order and measure without requiring road names", () => {
  const fields = [...columns, { name: "route", role: "id" }, { name: "stt", role: "measure" }];
  for (const extra of [{}, { region: "route", x: "stt", value: "speed" }]) {
    const result = validateAndNormalizeAnalysis({ columns: fields, suggestions: [{ id: "path", chartType: "map_line", bindings: { ...bindings, ...extra }, confidence: .9 }] },
      { rowCount: 3, columns: fields.map(column => ({ name: column.name, inferredType: column.role === "id" ? "text" : "number" })) });
    assert.deepEqual(result.validationErrors, []);
    assert.equal(result.suggestions[0].id, "path");
  }
});

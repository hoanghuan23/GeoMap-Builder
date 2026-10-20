import test from "node:test";
import assert from "node:assert/strict";
import { normalizePolygonLegendRecommendation, normalizeLegendUnit, normalizePolygonLegendBatch, normalizePolygonLegendRequest, polygonLegendTarget, POLYGON_LEGEND_SCHEMA } from "../src/polygon-legend-contract.js";
import { legendFixture, legendColumn } from "./fixtures/polygon-legend-fixture.js";

const target = polygonLegendTarget(legendColumn);

test("v2 preserves arbitrary AI stops, generic semantics and units across JSON normalization", () => {
  const legend = legendFixture({ unit: "Celsius", stops: legendFixture().stops.map(stop => ({ ...stop, color: stop.color.toUpperCase() })) });
  const normalized = normalizePolygonLegendRecommendation(legend, target);
  assert.equal(normalized.unit, "°C");
  assert.deepEqual(normalizePolygonLegendRecommendation(JSON.parse(JSON.stringify(normalized)), target), normalized);
  assert.equal(normalizeLegendUnit(" ℉ "), "°F"); assert.equal(normalizeLegendUnit(" triệu đồng "), "triệu đồng");
  assert.equal(normalizeLegendUnit(null), null);
  const unknown = legendFixture({ unit: null });
  assert.equal(normalizePolygonLegendRecommendation(unknown, { ...target, unit: null }).unit, null);
  assert.deepEqual(POLYGON_LEGEND_SCHEMA.anyOf.map(schema => schema.properties.type.enum[0]), ["continuous", "diverging"]);
  assert.deepEqual(POLYGON_LEGEND_SCHEMA.anyOf[1].properties.mode.enum, ["semantic"]);
});

test("invalid shape, binding, unit, mode, domain, stops and text reject independently", () => {
  const patches = [
    { legendSchemaVersion: 1 }, { field: "other" }, { aggregation: "sum" }, { unit: "°F" }, { unit: "" },
    { type: "categorical" }, { mode: "reference" }, { extra: true }, { domain: [40, -20] }, { domain: [0, Infinity] },
    { domain: [-1e308, 1e308] }, { domain: [0, 40] }, { title: " " }, { reason: "x".repeat(801) },
    { center: 0 }, { stops: [] }, { stops: [legendFixture().stops[0]] },
    { stops: [{ value: -20, color: "red" }, { value: 40, color: "#ffffff" }] },
    { stops: [{ value: -20, color: "#ffffff" }, { value: -20, color: "#000000" }, { value: 40, color: "#ffffff" }] },
    { stops: [{ value: -20, color: "#ffffff" }, { value: NaN, color: "#000000" }, { value: 40, color: "#ffffff" }] },
    { stops: Array.from({ length: 13 }, (_, index) => ({ value: index * 5 - 20, color: "#ffffff" })) }
  ];
  for (const patch of patches) {
    const errors = [];
    assert.equal(normalizePolygonLegendRecommendation(legendFixture(patch), target, { onFallback: (_, code) => errors.push(code) }), null, JSON.stringify(patch));
    assert.equal(errors.length, 1);
  }
  assert.equal(normalizePolygonLegendRecommendation(legendFixture(), { ...target, role: "category" }), null);
});

test("diverging requires a semantic scale with a stop at its meaningful center", () => {
  const legend = legendFixture({ type: "diverging", center: 0 });
  assert.equal(normalizePolygonLegendRecommendation(legend, target).center, 0);
  for (const patch of [{ mode: "auto" }, { center: -20 }, { center: null }, { center: 1 }]) {
    assert.equal(normalizePolygonLegendRecommendation({ ...legend, ...patch }, target), null);
  }
});

test("batch validation rejects missing, unknown, duplicate and invalid targets without losing valid peers", () => {
  const first = legendFixture(); const second = legendFixture({ field: "revenue", aggregation: "sum", unit: "đồng", mode: "auto" });
  const targets = [target, { field: "revenue", aggregation: "sum", unit: "đồng" }];
  for (const legends of [[first, { ...second, domain: [0, 0] }], [first, second, second], [first, { ...second, field: "unknown" }]]) {
    const result = normalizePolygonLegendBatch({ legends }, targets);
    assert.deepEqual(result.legends, [first]);
    assert.ok(result.validationErrors.length);
    assert.deepEqual(normalizePolygonLegendBatch(JSON.parse(JSON.stringify(result)), targets), result);
  }
  const countTarget = polygonLegendTarget(legendColumn, "count");
  assert.equal(countTarget.unit, "bản ghi");
});

test("summary payload excludes source records and geometry and validates render statistics", () => {
  const body = {
    targets: [{ ...target, labelVi: "Nhiệt độ", unitSource: "explicit", semanticType: "air_temperature",
      renderStatistics: { min: 25, max: 34, mean: 29.5, p10: 25.9, p50: 29.5, p90: 33.1, validCount: 2, missingCount: 0, records: ["private"] }, samples: ["private"] }],
    context: { regionField: "region", matchedRegionCount: 2, filters: { date: "2026-01-01", injected: { private: true } }, geometry: "private" }, records: ["private"]
  };
  const payload = normalizePolygonLegendRequest(body);
  assert.equal(JSON.stringify(payload).includes("private"), false);
  assert.equal(payload.targets[0].unitSource, "explicit");
  assert.deepEqual(payload.context.filters, { date: "2026-01-01" });
  for (const patch of [{ min: 40 }, { p50: 100 }, { validCount: 0 }, { max: Infinity }]) {
    assert.throws(() => normalizePolygonLegendRequest({ ...body, targets: [{ ...body.targets[0], renderStatistics: { ...body.targets[0].renderStatistics, ...patch } }] }));
  }
});

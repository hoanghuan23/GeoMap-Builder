import test from "node:test";
import assert from "node:assert/strict";
import { polygonLegendLabels, POLYGON_NO_DATA_COLOR, resolvePolygonLegendConfig, samplePolygonLegendColor, summarizePolygonLegendValues } from "../src/polygon-legend.js";
import { polygonFillExpression, polygonLegendScale } from "../src/renderers/polygon-style.js";
import { withSuggestionMetric } from "../src/ai-chart-pipeline.js";
import { legendFixture, legendColumn, legendSuggestion, legendData } from "./fixtures/polygon-legend-fixture.js";

const resolve = (values, legend = legendFixture(), options = {}) => resolvePolygonLegendConfig({
  suggestion: { ...legendSuggestion, legend }, columnMetadata: [legendColumn], aggregatedFeatures: legendData(values), ...options
});

test("semantic scale shares exact AI stops with paint and legend, preserving uneven gradient positions", () => {
  const scale = resolve([25, 34.3]);
  assert.equal(scale.mode, "semantic"); assert.equal(scale.source, "ai");
  assert.equal(scale.title, "Nhiệt độ quan sát"); assert.equal(scale.min, -20); assert.equal(scale.max, 40);
  assert.equal(scale.dataMax, 34.3);
  assert.ok(Math.abs(scale.positions[4] - 100 * 40 / 60) < 1e-10);
  assert.match(scale.gradient, /#fedcba 66\.666667%/);
  assert.strictEqual(polygonLegendScale(null, null, null, scale), scale);
  const paint = polygonFillExpression(null, null, null, "#ff0000", scale);
  assert.deepEqual(paint[2].slice(3), scale.stops.flat()); assert.equal(paint[3], POLYGON_NO_DATA_COLOR);
  assert.deepEqual(resolve([26, 27]).stops, scale.stops);
});

test("auto remaps the original relative stop positions to filtered data without changing colors", () => {
  const legend = legendFixture({ mode: "auto" });
  const first = resolve([10, 70], legend); const second = resolve([20, 140], legend);
  assert.deepEqual(first.stops.map(stop => stop[0]), [10, 20, 30, 40, 50, 60, 70]);
  assert.deepEqual(second.stops.map(stop => stop[0]), [20, 40, 60, 80, 100, 120, 140]);
  assert.deepEqual(first.colors, second.colors); assert.deepEqual(first.positions, second.positions);
});

test("legend keeps all seven reference ticks on full and narrow layouts", () => {
  const scale = resolve([20, 30]);
  const expected = [-20, -10, 0, 10, 20, 30, 40];
  for (const width of [100, 280, 330]) {
    const labels = polygonLegendLabels(scale, width);
    assert.deepEqual(labels.map(label => label.value), expected);
    assert.deepEqual(labels.map(label => label.text), expected.map(String));
    assert.equal(labels[0].position, 0);
    assert.equal(labels.at(-1).position, 100);
    assert.ok(labels.every((label, index) => !index || label.position > labels[index - 1].position));
  }
  assert.ok(polygonLegendLabels(scale, 100).some(label => label.row > 0), "crowded labels move to another row instead of disappearing");
});

test("uneven stops share a row without overlapping labels or moving their color ticks", () => {
  for (const values of [[0, 10, 40, 100, 200], [0, 100, 160, 190, 200]]) {
    const width = 290;
    const scale = { hasData: true, min: 0, max: 200, stops: values.map(value => [value, "#123456"]) };
    const before = JSON.stringify(scale);
    const labels = polygonLegendLabels(scale, width);
    assert.deepEqual(labels.map(label => label.value), values);
    assert.ok(labels.every(label => label.row === 0));
    assert.deepEqual(labels.map(label => label.position), values.map(value => value / 2));
    let end = -8;
    labels.forEach((label, index) => {
      const textWidth = label.text.length * 6;
      const x = label.position * width / 100;
      const left = (index === 0 ? x : index === labels.length - 1 ? x - textWidth : x - textWidth / 2) + label.offset;
      assert.ok(left >= end + 8 - 1e-10, "text labels retain an eight-pixel gap");
      assert.ok(left >= 0 && left + textWidth <= width);
      end = left + textWidth;
    });
    assert.equal(JSON.stringify(scale), before);
  }
});

test("diverging keeps its center and colors when observations are one-sided or filtered", () => {
  const legend = legendFixture({ type: "diverging", center: 0 });
  for (const values of [[-5, 8], [10, 20], [-30, 70]]) {
    const scale = resolve(values, legend);
    assert.equal(scale.center, 0); assert.deepEqual(scale.stops, legend.stops.map(stop => [stop.value, stop.color]));
    assert.ok(polygonLegendLabels(scale, 100).some(label => label.value === 0));
  }
});

test("constants, empty/invalid values, tiny ranges and legacy output always produce safe paint", () => {
  const constant = resolve([27, 27], legendFixture({ mode: "auto" }));
  assert.equal(constant.status, "constant"); assert.equal(constant.stops.length, 1); assert.deepEqual(constant.ticks, [27]);
  assert.equal(resolve([27]).stops.length, legendFixture().stops.length);
  for (const values of [[], [null, undefined, NaN, Infinity, -Infinity, "", "27", false]]) {
    const scale = resolve(values); assert.equal(scale.hasData, false);
    assert.equal(polygonFillExpression(null, null, null, "#ff0000", scale), POLYGON_NO_DATA_COLOR);
    assert.equal(polygonLegendScale(null, null, null, scale), null);
  }
  for (const legend of [null, { mode: "reference", referenceId: "air_temperature_c" }, legendFixture({ unit: "°F" })]) {
    const scale = resolve([25, 34], legend); assert.equal(scale.source, "technical-fallback");
    assert.equal(scale.min, 25); assert.equal(scale.max, 34); assert.equal(scale.field, "temperature");
  }
  for (const values of [[1, 1 + Number.EPSILON], [-1e308, 1e308]]) {
    const scale = resolve(values, legendFixture({ mode: "auto" }));
    assert.ok(scale.stops.every(([value], index) => Number.isFinite(value) && (!index || value > scale.stops[index - 1][0])));
    assert.equal(scale.gradient.includes("NaN"), false);
  }
});

test("source precedence only accepts legends bound to the active field, unit and aggregation", () => {
  const columnLegend = legendFixture({ title: "Cột" });
  assert.equal(resolve([25, 34], legendFixture({ title: "Suggestion" }), { columnMetadata: [{ ...legendColumn, legend: columnLegend }] }).title, "Suggestion");
  assert.equal(resolve([25, 34], legendFixture({ field: "other" }), { columnMetadata: [{ ...legendColumn, legend: columnLegend }] }).title, "Cột");
  assert.equal(resolve([25, 34], null, { columnMetadata: [{ ...legendColumn, legend: columnLegend }] }).title, "Cột");
  const changed = withSuggestionMetric(legendSuggestion, "revenue", [legendColumn, { name: "revenue", role: "measure", unit: "đồng", aggDefault: "sum", legend: columnLegend }]);
  assert.equal(changed.legend, null);
  assert.equal(resolve([25, 34], columnLegend, { aggregation: "sum" }).source, "technical-fallback");
});

test("statistics use finite numeric feature values and exact interpolated quantiles", () => {
  assert.deepEqual(summarizePolygonLegendValues(legendData([10, 20, 30, null, "40"]), "temperature"), {
    min: 10, max: 30, mean: 20, p10: 12, p50: 20, p90: 28, validCount: 3, missingCount: 2
  });
});

test("sRGB color samples clamp at endpoints and interpolate linearly within uneven segments", () => {
  const stops = [[0, "#000000"], [10, "#ffffff"], [40, "#000000"]];
  for (const [value, expected] of [[-5, "#000000"], [0, "#000000"], [5, "#808080"], [10, "#ffffff"], [25, "#808080"], [40, "#000000"], [50, "#000000"]]) {
    assert.equal(samplePolygonLegendColor(stops, value), expected);
  }
});

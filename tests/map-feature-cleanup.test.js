import { createMapLayerRuntime } from "../src/shared/runtime/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { validateAndNormalizeAnalysis } from "../src/shared/import/ai-chart-contract.js";
import { evaluateSuggestion, prepareSuggestions } from "../src/shared/import/ai-chart-pipeline.js";

test("retired visualizations cannot enter map validation or preparation", () => {
  const columns = [
    { name: "lat", role: "geo", geoLevel: "point_lat" },
    { name: "lng", role: "geo", geoLevel: "point_lng" }
  ];
  const records = [{ lat: 21, lng: 105 }];
  const point = { id: "point", chartType: "point", bindings: { lat: "lat", lng: "lng" }, confidence: .9 };
  const retired = ["bar", "line", "pie", "hex_h3", "heatmap"].map(chartType => ({ ...point, id: chartType, chartType }));
  const analysis = { columns, suggestions: [...retired, point] };
  const normalized = validateAndNormalizeAnalysis(analysis, { columns });
  assert.deepEqual(normalized.suggestions.map(item => item.chartType), ["point"]);
  const prepared = prepareSuggestions(analysis, records, { lat: 1, lng: 1 });
  assert.deepEqual(prepared.map(item => item.chartType), ["point"]);
  assert.equal(prepared[0].available, true);
  for (const suggestion of retired) {
    assert.equal(evaluateSuggestion(suggestion, records, columns, { lat: 1, lng: 1 }).available, false);
  }
});

test("disposing a map runtime releases its overlay without accessing retired chart controls", () => {
  const removed = [];
  const runtime = createMapLayerRuntime({
    id: "cleanup-layer",
    document: { getElementById(name) { assert.fail(`Unexpected control access during disposal: ${name}`); } },
    arcFlowOverlay: { removeLayer(id) { removed.push(id); } }
  });
  runtime.state.mapType="arc_flow";runtime.getView();
  runtime.dispose();
  assert.deepEqual(removed, ["cleanup-layer"]);
});

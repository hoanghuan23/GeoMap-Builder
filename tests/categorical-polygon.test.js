import test from "node:test";
import assert from "node:assert/strict";
import { profileTabularData } from "../src/tabular-data.js";
import { validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { resolveAggregation, withSuggestionMetric } from "../src/ai-chart-pipeline.js";
import { normalizePolygonLegendRecommendation, polygonLegendTarget } from "../src/polygon-legend-contract.js";
import { resolvePolygonLegendConfig } from "../src/polygon-legend.js";
import { polygonFillExpression } from "../src/renderers/polygon-style.js";
import { categoryColorProperties, featureCategoryValues } from "../src/categorical-color.js";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { collapseCountryFeatures, joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { popupRegionRecords } from "../src/ai-popup-chart.js";
import { descriptiveCountryFetch } from "./fixtures/descriptive-countries-fixture.js";
import { accessField, accessLegend, categoricalCountryFixture } from "./fixtures/categorical-countries-fixture.js";

const colorOf = (paint, feature) => {
  if (!Array.isArray(paint)) return paint;
  const value = feature.properties[paint[1][1]];
  for (let index = 2; index < paint.length - 1; index += 2) if (paint[index] === value) return paint[index + 1];
  return paint.at(-1);
};

test("profile includes complete category values and actual country combinations, and omits them when samples are disabled", () => {
  const { records } = categoricalCountryFixture();
  const profile = profileTabularData(records);
  assert.deepEqual(new Set(profile.columns.find(column => column.name === accessField).categoryValues), new Set(accessLegend.stops.map(stop => stop.value)));
  const group = profile.categoryGroups.find(group => group.entityField === "Điểm đến" && group.categoryField === accessField);
  assert.deepEqual(group.combinations, [{ values: ["Miễn thị thực", "Thị thực khi đến"], entities: ["Trung Quốc"] }]);
  const privateProfile = profileTabularData(records, { includeSamples: false });
  assert.equal(privateProfile.categoryGroups, undefined);
  assert.ok(privateProfile.columns.every(column => column.categoryValues === undefined && column.samples === undefined));
});

test("categorical map metadata, AI colors and combination colors survive normalization without becoming numerical measures", () => {
  const { records, columns, suggestion } = categoricalCountryFixture();
  const profile = profileTabularData(records);
  const normalize = raw => validateAndNormalizeAnalysis(raw, profile);
  const analysis = normalize({ columns, suggestions: [{ ...suggestion, agg: "sum" }], search_bar: true, search_fields: ["Điểm đến"] });
  assert.deepEqual(analysis.validationErrors, []);
  assert.equal(analysis.suggestions[0].bindings.value, accessField);
  assert.equal(analysis.suggestions[0].agg, null);
  assert.equal(resolveAggregation(analysis.suggestions[0], analysis.columns), null);
  assert.equal(analysis.columns.filter(column => column.role === "measure").length, 0);
  assert.deepEqual(analysis.columns.find(column => column.name === accessField).legend, accessLegend);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(analysis))), analysis);
  const updated = withSuggestionMetric(suggestion, accessField, analysis.columns);
  assert.equal(updated.agg, null);
  assert.deepEqual(updated.legend, accessLegend);
  const other = { name: "Service status", role: "category" };
  assert.ok(normalizePolygonLegendRecommendation({ ...accessLegend, title: "Service status" }, { ...polygonLegendTarget(other), role: other.role }));
});

test("categorical legends reject reused colors, nonexistent members, repeated sets and numerical aggregations", () => {
  const target = { ...polygonLegendTarget({ name: accessField, role: "category" }), role: "category" };
  for (const patch of [
    { aggregation: "count" }, { domain: [0, 1] }, { mode: "auto" },
    { stops: [...accessLegend.stops, { value: "duplicate", color: accessLegend.stops[0].color }] },
    { combinations: [{ values: ["Miễn thị thực", "Không tồn tại"], color: "#123456" }] },
    { combinations: [{ values: ["Miễn thị thực", "Miễn thị thực"], color: "#123456" }] },
    { combinations: [{ values: ["Miễn thị thực", "Thị thực khi đến"], color: accessLegend.stops[0].color }] },
    { combinations: [...accessLegend.combinations, { values: ["Thị thực khi đến", "Miễn thị thực"], color: "#123456" }] }
  ]) assert.equal(normalizePolygonLegendRecommendation({ ...accessLegend, ...patch }, target), null, JSON.stringify(patch));
});

test("52 source rows retain their details and search labels; each combined country gets the exact AI combination color", async () => {
  const { records, columns, suggestion } = categoricalCountryFixture();
  const original = structuredClone(records);
  const boundaries = await loadAdministrativeBoundaries(records.map(row => row["Điểm đến"]), {
    apiKey: "key", placeType: "country", fetchImpl: descriptiveCountryFetch()
  });
  const recommendation = { geometry: { field: "Điểm đến" }, metricField: accessField, aggregation: null };
  const join = filters => collapseCountryFeatures(joinRecordsToMapTilerBoundaries(records, boundaries, recommendation,
    { columns, filters, includeMissingMetric: true }), "Điểm đến", { categoryField: accessField });
  const data = join({});
  assert.equal(data.features.length, 51);
  const china = data.features.find(feature => feature.properties.__resolved_country_code === "CHN");
  assert.deepEqual(featureCategoryValues(china.properties, accessField), accessLegend.combinations[0].values);
  const scale = resolvePolygonLegendConfig({ suggestion, columnMetadata: columns, aggregatedFeatures: data });
  assert.equal(scale.type, "categorical");
  assert.equal(scale.mixed.length, 1);
  assert.equal(scale.mixed[0].color, "#be185d");
  const paint = polygonFillExpression(data, {}, null, "#000000", scale);
  assert.equal(colorOf(paint, china), "#be185d");
  for (const feature of data.features.filter(feature => feature !== china)) {
    assert.equal(colorOf(paint, feature), accessLegend.stops.find(stop => stop.value === feature.properties[accessField]).color);
  }
  assert.equal(scale.entries.reduce((sum, entry) => sum + entry.count, 0) + scale.mixed[0].count, 51);
  assert.deepEqual(popupRegionRecords(records, china, "Điểm đến"), original.slice(-2));
  const index = buildDataSearchIndex({ data, columns, chartType: "choropleth", titleField: "Điểm đến", search_fields: ["Điểm đến"], locationKeys: boundaries.locationKeys });
  assert.equal(searchDataIndex(index, "Trung Quốc")[0].feature, china);
  assert.equal(searchDataIndex(index, "China")[0].feature, china);
  const filtered = join({ [accessField]: "Miễn thị thực" });
  const filteredScale = resolvePolygonLegendConfig({ suggestion, columnMetadata: columns, aggregatedFeatures: filtered });
  assert.equal(filteredScale.mixed.length, 0);
  const filteredChina = filtered.features.find(feature => feature.properties.__resolved_country_code === "CHN");
  assert.equal(colorOf(polygonFillExpression(filtered, {}, null, "#000000", filteredScale), filteredChina), "#15803d");
  assert.equal(filteredChina.properties["Điểm đến"], "Trung Quốc");
  const sameRows = records.map((row, index) => index === 51 ? { ...row, [accessField]: records[50][accessField] } : row);
  const sameData = collapseCountryFeatures(joinRecordsToMapTilerBoundaries(sameRows, boundaries, recommendation, { columns }), "Điểm đến", { categoryField: accessField });
  const sameScale = resolvePolygonLegendConfig({ suggestion, columnMetadata: columns, aggregatedFeatures: sameData });
  assert.equal(sameScale.mixed.length, 0, "two source labels with one shared value use one category color");
  assert.equal(colorOf(polygonFillExpression(sameData, {}, null, "#000000", sameScale), sameData.features.find(feature => feature.properties.__resolved_country_code === "CHN")), "#15803d");
  assert.deepEqual(records, original);
});

test("missing selected categories remain transparent; zero is valid and unknown combinations never get a made-up color", () => {
  const column = { name: "status", role: "category", legend: { ...accessLegend, stops: [{ value: "0", color: "#123456" }, { value: "A", color: "#654321" }], combinations: [] } };
  const suggestion = { chartType: "choropleth", bindings: { value: "status" } };
  const properties = [null, 0].map(value => ({ status: value, ...categoryColorProperties("status", [value]) }));
  properties.push({ ...categoryColorProperties("status", [0, "A"]) });
  const data = { features: properties.map(properties => ({ properties })) };
  const scale = resolvePolygonLegendConfig({ suggestion, columnMetadata: [column], aggregatedFeatures: data });
  const paint = polygonFillExpression(data, {}, null, "#000000", scale);
  assert.equal(colorOf(paint, data.features[0]), "rgba(0, 0, 0, 0)");
  assert.equal(colorOf(paint, data.features[1]), "#123456");
  assert.equal(colorOf(paint, data.features[2]), "rgba(0, 0, 0, 0)");
  assert.equal(scale.status, "incomplete");
});

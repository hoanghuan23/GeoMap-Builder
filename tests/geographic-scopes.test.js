import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ANALYSIS_RESPONSE_SCHEMA, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { profileTabularData } from "../src/tabular-data.js";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { largestBoundaryPart } from "../src/geographic-scopes.js";
import { renderGeographicScopeMarkers } from "../src/renderers/geographic-scope-renderer.js";
import { createHarness } from "./fixtures/map-runtime-harness.js";
import vm from "node:vm";
import { descriptiveColumns, descriptiveCountryFetch, descriptiveRecords, descriptiveSuggestion } from "./fixtures/descriptive-countries-fixture.js";
import { collapseCountryFeatures, joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { featureCategoryValues } from "../src/categorical-color.js";

const polygon = x => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
const response = features => ({ ok: true, json: async () => ({ features }) });
const scope = (sourceValue, targetName, country, render = "boundary") => ({ sourceValue, targetName, country, render,
  geoLevel: render === "marker" ? "country" : "admin1", geometryPart: "all", label: sourceValue, reason: "Phạm vi theo dữ liệu." });

test("profile sends qualified rows beyond the head, complete source labels and their conditions", () => {
  const profile = profileTabularData(descriptiveRecords);
  assert.ok(!profile.head.some(row => row["Điểm đến"].includes("Hải Nam")));
  assert.deepEqual(profile.scopeRows.slice(-2), descriptiveRecords.slice(-2));
  assert.ok(profile.columns.find(column => column.name === "Điểm đến").distinctValues.includes("Trung Quốc — đảo Hải Nam"));
  assert.equal(Boolean(profile.categoryGroups?.some(group => group.entityField === "Điểm đến")), false);
  const privateProfile = profileTabularData(descriptiveRecords, { includeSamples: false });
  assert.equal(privateProfile.scopeRows, undefined);
  assert.ok(privateProfile.columns.every(column => column.distinctValues === undefined));
});

test("AI scope schema and exact source labels survive server/client normalization", () => {
  assert.ok(ANALYSIS_RESPONSE_SCHEMA.properties.suggestions.items.required.includes("geographicScopes"));
  const profile = profileTabularData(descriptiveRecords);
  const raw = { columns: [{ name: "Điểm đến", role: "geo", geoLevel: "country" }], suggestions: [descriptiveSuggestion] };
  const normalized = validateAndNormalizeAnalysis(raw, profile);
  assert.deepEqual(normalized.suggestions[0].geographicScopes, descriptiveSuggestion.geographicScopes);
  assert.deepEqual(validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(normalized)), profile), normalized);
  const invalid = validateAndNormalizeAnalysis({ ...raw, suggestions: [{ ...descriptiveSuggestion, geographicScopes: [
    { ...descriptiveSuggestion.geographicScopes[0], geoLevel: "invented" },
    { ...descriptiveSuggestion.geographicScopes[1], sourceValue: "Not in source" }
  ] }] }, profile);
  assert.equal(invalid.suggestions[0].geographicScopes.length, 1);
  assert.equal(invalid.suggestions[0].geographicScopes[0].render, "unresolved");
  assert.equal(invalid.validationErrors.length, 2);
});

test("mixed geographic scopes work for other countries and keep the original source identities", async () => {
  const scopes = [scope("Indonesia — Bali", "Bali", "IDN"), scope("France (Corsica)", "Corsica", "FRA"),
    scope("France — transit", "France", "FRA", "marker")];
  const requests = [];
  const result = await loadAdministrativeBoundaries(scopes.map(item => item.sourceValue), {
    apiKey: "test", placeType: "country", geographicScopes: scopes, strict: false,
    fetchImpl: async raw => {
      const url = new URL(raw); requests.push(url);
      const target = scopes.find(item => decodeURIComponent(url.pathname).includes(item.targetName));
      const marker = target.render === "marker";
      const code = target.country === "IDN" ? "id" : "fr";
      return response([{ type: "Feature", id: `${marker ? "country" : "region"}.${target.targetName}`,
        text: target.targetName, place_type: [marker ? "country" : "region"], properties: { country_code: code },
        geometry: polygon(requests.length * 10) }]);
    }
  });
  assert.equal(result.matchRate, 1);
  assert.deepEqual(result.features.map(feature => feature.geometry.type), ["Polygon", "Polygon", "Point"]);
  assert.deepEqual(result.features.map(feature => feature.properties.__data_location), scopes.map(scope => scope.sourceValue));
  assert.ok(requests.some(url => url.searchParams.get("types") === "region" && url.searchParams.get("country") === "id"));
});

test("scoped names in a lower-level column keep each row's parent country", async () => {
  const original = "Central — island";
  const names = [`${original}, Thailand`, `${original}, Vietnam`];
  const result = await loadAdministrativeBoundaries(names, {
    apiKey: "test", placeType: "region", geographicScopes: [scope(original, "Central", null)],
    contexts: Object.fromEntries(names.map((name, index) => [name, { sourceValue: original, country: index ? "VNM" : "THA" }])),
    fetchImpl: async raw => {
      const url = new URL(raw); const code = url.searchParams.get("country");
      return response([{ type: "Feature", id: `region.${code}`, text: "Central", place_type: ["region"],
        properties: { country_code: code }, geometry: polygon(code === "vn" ? 10 : 20) }]);
    }
  });
  assert.equal(result.matchRate, 1);
  assert.notEqual(result.features[0].properties.__resolved_location_key, result.features[1].properties.__resolved_location_key);
});

test("unresolved or unmatched child scopes never use a parent polygon, even from a manual selection", async () => {
  const name = "France — restricted area";
  const parent = { type: "Feature", id: "country.fr", text: "France", place_type: ["country"],
    properties: { country_code: "fr" }, geometry: polygon(0) };
  for (const render of ["boundary", "unresolved"]) {
    const result = await loadAdministrativeBoundaries([name], { placeType: "country", strict: false,
      geographicScopes: [scope(name, "Missing subregion", "FRA", render)], selections: { [name]: parent },
      fetchImpl: () => assert.fail("unresolved/manual mismatch must not request the parent") });
    assert.deepEqual(result.unmatched, [name]);
    assert.equal(result.features.length, 0);
  }
});

test("largest island geometry removes distant components, keeps holes and updates its extent", () => {
  const main = [[[10, 0], [14, 0], [14, 4], [10, 0]], [[11, 1], [12, 1], [12, 2], [11, 1]]];
  const feature = { type: "Feature", bbox: [-100, -10, 100, 20], geometry: { type: "MultiPolygon", coordinates: [
    polygon(-100).coordinates, main, polygon(99).coordinates
  ] } };
  const part = largestBoundaryPart(feature);
  assert.deepEqual(part.geometry, { type: "Polygon", coordinates: main });
  assert.deepEqual(part.bbox, [10, 0, 14, 4]);
  assert.equal(feature.geometry.coordinates.length, 3);
});

test("the real ADM1 fallback resolves Hainan to the main island rather than China or distant islands", async () => {
  const [island] = descriptiveSuggestion.geographicScopes;
  const result = await loadAdministrativeBoundaries([island.sourceValue], {
    placeType: "country", geographicScopes: [island],
    fetchImpl: async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) })
  });
  const feature = result.features[0];
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.properties.boundary_source, "Local ADM");
  assert.ok(feature.bbox[0] > 108 && feature.bbox[2] < 112 && feature.bbox[1] > 18 && feature.bbox[3] < 21);
});

test("categorical scopes keep the source classification without a parent-country combination", async () => {
  const records = descriptiveRecords.slice(-2).map(row => ({ ...row, status: "Miễn thị thực" }));
  const boundaries = await loadAdministrativeBoundaries(records.map(row => row["Điểm đến"]), {
    apiKey: "test", placeType: "country", geographicScopes: descriptiveSuggestion.geographicScopes, fetchImpl: descriptiveCountryFetch()
  });
  const data = collapseCountryFeatures(joinRecordsToMapTilerBoundaries(records, boundaries, {
    geometry: { field: "Điểm đến" }, metricField: "status"
  }, { columns: [...descriptiveColumns, { name: "status", role: "category" }] }), "Điểm đến", { categoryField: "status" });
  assert.equal(data.features.length, 2);
  assert.deepEqual(data.features.map(feature => feature.geometry.type), ["Polygon", "Point"]);
  for (const feature of data.features) assert.deepEqual(featureCategoryValues(feature.properties, "status"), ["Miễn thị thực"]);
});

test("scope overlay uses only marker features and follows visibility, independent of polygon fill", () => {
  const { context, layers, get } = createHarness();
  const marker = layers.get("scope-marker");
  assert.equal(marker.type, "circle");
  assert.equal(marker.source, "scope-marker-data");
  assert.deepEqual(marker.filter[2], ["==", ["get", "__geographic_scope"], "marker"]);
  vm.runInContext("state.aiDataset = {selectedSuggestionId:'map', suggestions:[{id:'map', chartType:'choropleth', bindings:{value:null}}]}; state.mapType='polygon'; applyMapLayerVisibility();", context);
  assert.equal(layers.get("scope-marker").layout.visibility, "visible");
  assert.equal(layers.has("scope-labels"), false, "the marker must not have a map label");
  assert.equal(layers.get("polygon-fill").layout.visibility, "visible");
  get("show-map-layers").checked = false;
  vm.runInContext("applyMapLayerVisibility();", context);
  assert.equal(layers.get("scope-marker").layout.visibility, "none");
  renderGeographicScopeMarkers({ getSource: () => true, addSource: () => assert.fail("must not duplicate sources"),
    getLayer: () => true, addLayer: () => assert.fail("must not duplicate layers") });
});

test("AI instructions describe scope choices from data rather than a fixed country exception", async () => {
  const instructions = await readFile(new URL("../server/map-analysis-instructions.js", import.meta.url), "utf8");
  for (const text of ["PHẠM VI THỰC SỰ", "profile.scopeRows", "render marker", "render unresolved", "bất kỳ nước nào"]) assert.ok(instructions.includes(text));
});

test("the existing legend shows a circular swatch and source scope without extra controls or map labels", () => {
  const { context, layers, get } = createHarness();
  context.scopePoint = { type: "Feature", properties: { __geographic_scope: "marker", __scope_label: "Quá cảnh Trung Quốc" },
    geometry: { type: "Point", coordinates: [104.1658, 35.85965] } };
  vm.runInContext(`state.aiDataset = {selectedSuggestionId:'map', suggestions:[{id:'map',chartType:'choropleth',bindings:{value:null}}]};
    state.mapType='polygon'; state.boundary={features:[scopePoint]}; applyMapLayerVisibility();`, context);
  const legend = get("scope-legend");
  assert.equal(legend.hidden, false);
  assert.equal(get("weather-legend").hidden, false);
  assert.equal(legend.children.length, 1);
  assert.equal(legend.children[0].className, "scope-legend-row");
  assert.equal(legend.children[0].children[1].textContent, "Quá cảnh Trung Quốc - lớp riêng");
  assert.equal(layers.has("scope-labels"), false);
  assert.equal(layers.get("scope-marker").paint["circle-radius"], 8);
  get("show-map-layers").checked = false;
  vm.runInContext("applyMapLayerVisibility();", context);
  assert.equal(legend.hidden, true);
  assert.equal(layers.get("scope-marker").layout.visibility, "none");
  get("show-map-layers").checked = true;
  vm.runInContext("state.boundary={features:[]}; applyMapLayerVisibility();", context);
  assert.equal(legend.hidden, true);
});

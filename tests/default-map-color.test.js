import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { prepareSuggestions, resolveAggregation } from "../src/ai-chart-pipeline.js";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { countryLookupName } from "../src/country-boundary-sources.js";
import { buildAdministrativeGeocodingUrl, buildDataSearchIndex, countryCandidateScore, getMapTilerAdministrativeBoundary, searchDataIndex } from "../src/map-search.js";
import { collapseCountryFeatures, joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { popupRegionRecords } from "../src/ai-popup-chart.js";
import { descriptiveColumns, descriptiveCountries, descriptiveCountryFetch, descriptiveRecords, descriptiveSuggestion } from "./fixtures/descriptive-countries-fixture.js";
import { countryFeature } from "./fixtures/country-weather-fixture.js";

const response = features => ({ ok: true, json: async () => ({ features }) });
const china = countryFeature(descriptiveCountries.at(-1));

test("nullable map values keep real metadata, validate fields, and never invent a count measure", () => {
  const columns = [...descriptiveColumns, { name: "lat", role: "geo", geoLevel: "point_lat" },
    { name: "lng", role: "geo", geoLevel: "point_lng" }, { name: "route", role: "text" },
    { name: "value", role: "measure", aggDefault: "mean" }];
  const profile = { rowCount: 2, columns: columns.map(column => ({ name: column.name, inferredType: column.role === "measure" ? "number" : "text" })) };
  const normalize = suggestion => validateAndNormalizeAnalysis({ columns, suggestions: [suggestion] }, profile);
  for (const value of [undefined, null, ""]) {
    for (const suggestion of [descriptiveSuggestion,
      { id: "road", chartType: "map_line", bindings: { region: "route" } },
      { id: "path", chartType: "map_line", bindings: { lat: "lat", lng: "lng" } }]) {
      const result = normalize({ ...suggestion, bindings: { ...suggestion.bindings, value }, agg: "count" });
      assert.deepEqual(result.validationErrors, []);
      assert.equal(result.suggestions[0].bindings.value, null);
      assert.equal(resolveAggregation(result.suggestions[0], columns), null);
    }
  }
  for (const chartType of ["choropleth", "map_line"]) {
    const bindings = { region: chartType === "choropleth" ? "Điểm đến" : "route" };
    for (const value of ["missing", "STT", "Ghi chú"]) assert.equal(normalize({ id: "invalid", chartType, bindings: { ...bindings, value } }).suggestions.length, 0);
    assert.equal(normalize({ id: "valid", chartType, bindings: { ...bindings, value: "value" } }).suggestions[0].bindings.value, "value");
  }
  const point = { id: "point", chartType: "point", bindings: { lat: "lat", lng: "lng" }, confidence: 1 };
  assert.equal(normalize(point).suggestions.length, 1);
  assert.equal(normalize({ ...point, bindings: { lat: "lat" } }).suggestions.length, 0);
  const one = prepareSuggestions({ columns: descriptiveColumns, suggestions: [descriptiveSuggestion] }, descriptiveRecords.slice(-1), 1);
  assert.equal(one[0].available, true);
  const invalidCoordinates = prepareSuggestions({ columns, suggestions: [point] }, [{ lat: 99, lng: 200 }], 1);
  assert.equal(invalidCoordinates[0].available, false);
});

test("scoped rows stay separate: Hainan is an island and transit is a searchable marker", async () => {
  const original = structuredClone(descriptiveRecords);
  const requests = [];
  const boundaries = await loadAdministrativeBoundaries(descriptiveRecords.map(row => row["Điểm đến"]), {
    apiKey: "key", placeType: "country", geographicScopes: descriptiveSuggestion.geographicScopes,
    fetchImpl: descriptiveCountryFetch(requests)
  });
  assert.equal(boundaries.features.length, 52);
  assert.equal(boundaries.matchRate, 1);
  assert.ok(requests.some(url => decodeURIComponent(url.pathname).includes("Hainan")));
  const recommendation = { geometry: { field: "Điểm đến" }, metricField: null, aggregation: null };
  const join = filters => collapseCountryFeatures(joinRecordsToMapTilerBoundaries(descriptiveRecords, boundaries, recommendation,
    { columns: descriptiveColumns, filters }), "Điểm đến");
  const data = join({});
  assert.equal(data.features.length, 52);
  const island = data.features.find(item => item.properties.__scope_label === "Đảo Hải Nam");
  const marker = data.features.find(item => item.properties.__geographic_scope === "marker");
  assert.equal(island.geometry.type, "Polygon");
  assert.deepEqual(island.bbox, [108.6, 18, 111.1, 20.2]);
  assert.equal(marker.geometry.type, "Point");
  assert.equal(marker.bbox, undefined, "a marker must not retain the country's extent");
  assert.notEqual(island.properties.__resolved_location_key, marker.properties.__resolved_location_key);
  assert.equal(data.features.filter(item => item.properties.__resolved_country_code === "CHN").length, 2);
  const options = { data, columns: descriptiveColumns, titleField: "Điểm đến", chartType: "choropleth", search_bar: true,
    search_fields: ["Điểm đến"], sourceRecords: descriptiveRecords, locationKeys: boundaries.locationKeys };
  const index = buildDataSearchIndex(options);
  assert.equal(index.uniqueCount, 52);
  assert.equal(searchDataIndex(index, "Hải Nam")[0].feature, island);
  assert.equal(searchDataIndex(index, "quá cảnh")[0].feature, marker);
  for (const feature of [island, marker]) assert.equal(popupRegionRecords(descriptiveRecords, feature, "Điểm đến").length, 1);
  const filtered = join({ "Điều kiện": "Có vé nối chuyến" });
  assert.equal(filtered.features.length, 1);
  assert.equal(filtered.features[0].geometry.type, "Point");
  assert.deepEqual(searchDataIndex(buildDataSearchIndex({ ...options, data: filtered }), "Hải Nam"), []);
  assert.deepEqual(descriptiveRecords, original);
});

test("qualified names never authorize the parent country without an explicit scope", async () => {
  const names = ["Trung Quốc — đảo Hải Nam", "Trung Quốc–quá cảnh", "Trung Quốc - du lịch", "Trung Quốc (quá cảnh)"];
  for (const name of names) {
    assert.equal(countryLookupName(name), "Trung Quốc", "parent identity remains available for navigation");
    assert.equal(countryCandidateScore(china, name), 2);
    assert.equal(decodeURIComponent(new URL(buildAdministrativeGeocodingUrl(name, "key", "country")).pathname), `/geocoding/${name}.json`);
  }
  assert.equal(countryLookupName("Guinea-Bissau"), "Guinea-Bissau");
  const progress = [];
  const result = await loadAdministrativeBoundaries(names, { placeType: "country", strict: false,
    onProgress: item => progress.push(item.completed), fetchImpl: () => assert.fail("must not look up the parent") });
  assert.deepEqual(result.unmatched, names);
  assert.equal(result.features.length, 0);
  assert.deepEqual(progress, [1, 2, 3, 4]);
  await assert.rejects(loadAdministrativeBoundaries(names, { placeType: "country" }), /Chưa tìm được/);
});

test("scoped values retain independent metric aggregation", async () => {
  const records = descriptiveRecords.slice(-2).map((row, index) => ({ ...row, value: (index + 1) * 10 }));
  const columns = [...descriptiveColumns, { name: "value", role: "measure", aggDefault: "mean" }];
  const boundaries = await loadAdministrativeBoundaries(records.map(row => row["Điểm đến"]), {
    apiKey: "key", placeType: "country", geographicScopes: descriptiveSuggestion.geographicScopes, fetchImpl: descriptiveCountryFetch()
  });
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, { geometry: { field: "Điểm đến" }, metricField: "value", aggregation: "mean" }, { columns });
  assert.deepEqual(data.features.map(feature => feature.properties.__metric), [10, 20]);
});

test("transit marker can use local ADM0 as a reference without returning its polygon", async () => {
  const name = "Trung Quốc — quá cảnh";
  const result = await loadAdministrativeBoundaries([name], { placeType: "country", geographicScopes: descriptiveSuggestion.geographicScopes,
    fetchImpl: async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) }) });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.type, "Point");
  assert.equal(result.features[0].properties.__country_code, "CHN");
  assert.equal(result.features[0].properties.__data_location, name);
});

test("wrong countries, wrong levels and tied matches remain rejected and repairable", async () => {
  const name = "Trung Quốc";
  for (const features of [[countryFeature(descriptiveCountries[0])], [{ ...china, place_type: ["region"] }],
    [china, { ...china, id: "country.cn-alternative" }]]) {
    assert.equal(await getMapTilerAdministrativeBoundary(name, { apiKey: "key", placeType: "country", fetchImpl: async () => response(features) }), null);
  }
  const ambiguous = await loadAdministrativeBoundaries(["Congo"], { apiKey: "key", placeType: "country", strict: false,
    fetchImpl: async () => response([1, 2].map(id => ({ ...china, id: `country.${id}`, text: "Congo", place_name: "Congo", properties: {} }))) });
  assert.deepEqual(ambiguous.unmatched, ["Congo"]);
  assert.equal(ambiguous.candidates.Congo.length, 2);
});

test("canonical country cache still rebinds pure country aliases", async () => {
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = descriptiveCountryFetch(requests);
  try {
    const first = await getMapTilerAdministrativeBoundary("Trung Quốc", { apiKey: "cache-key", placeType: "country" });
    const second = await getMapTilerAdministrativeBoundary("China", { apiKey: "cache-key", placeType: "country" });
    assert.equal(requests.length, 2);
    assert.equal(first.properties.__data_location, "Trung Quốc");
    assert.equal(second.properties.__data_location, "China");
    assert.equal(first.geometry, second.geometry);
  } finally { globalThis.fetch = originalFetch; }
});

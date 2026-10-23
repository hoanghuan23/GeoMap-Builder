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

test("52 descriptive source rows become 51 countries with two searchable China sections and filter-safe identities", async () => {
  assert.equal(descriptiveRecords.length, 52);
  const original = structuredClone(descriptiveRecords);
  const requests = [];
  const boundaries = await loadAdministrativeBoundaries(descriptiveRecords.map(row => row["Điểm đến"]), {
    apiKey: "key", placeType: "country", fetchImpl: descriptiveCountryFetch(requests)
  });
  assert.equal(boundaries.features.length, 52);
  assert.equal(boundaries.matchRate, 1);
  assert.equal(requests.filter(url => decodeURIComponent(url.pathname) === "/geocoding/Trung Quốc.json").length, 1);
  assert.equal(requests.filter(url => decodeURIComponent(url.pathname) === "/geocoding/country.cn.json").length, 1);
  const recommendation = { geometry: { field: "Điểm đến" }, metricField: null, aggregation: null };
  const join = filters => collapseCountryFeatures(joinRecordsToMapTilerBoundaries(descriptiveRecords, boundaries, recommendation,
    { columns: descriptiveColumns, filters }), "Điểm đến");
  const data = join({});
  assert.equal(data.features.length, 51);
  const feature = data.features.find(item => item.properties.__resolved_country_code === "CHN");
  assert.equal(feature.properties["Điểm đến"], "Trung Quốc");
  assert.equal(feature.properties.__record_count, 2);
  const options = { data, columns: descriptiveColumns, titleField: "Điểm đến", chartType: "choropleth", search_bar: true,
    search_fields: ["Điểm đến"], sourceRecords: descriptiveRecords, locationKeys: boundaries.locationKeys };
  const index = buildDataSearchIndex(options);
  assert.equal(index.uniqueCount, 51);
  for (const query of ["Hải Nam", "quá cảnh", "Trung Quốc", "China", "CN", "CHN"]) {
    const entries = searchDataIndex(index, query);
    assert.ok(entries.some(entry => entry.feature === feature), query);
  }
  const serialized = { ...feature, properties: { ...feature.properties, __source_locations: JSON.stringify(feature.properties.__source_locations) } };
  assert.deepEqual(popupRegionRecords(descriptiveRecords, serialized, "Điểm đến"), original.slice(-2));
  const filtered = join({ "Điều kiện": "Có vé nối chuyến" });
  assert.equal(filtered.features.length, 1);
  assert.equal(filtered.features[0].properties["Ghi chú"], original.at(-1)["Ghi chú"]);
  assert.deepEqual(searchDataIndex(buildDataSearchIndex({ ...options, data: filtered }), "Hải Nam"), []);
  assert.equal(searchDataIndex(buildDataSearchIndex({ ...options, data: filtered }), "quá cảnh").length, 1);
  // A filter that removes no countries must not spuriously trigger the small-result cutoff.
  assert.equal(buildDataSearchIndex({ ...options, filtered: true, data: { ...data, features: data.features.slice(0, 3) },
    sourceRecords: descriptiveRecords.slice(0, 3) }).enabled, true);
  assert.deepEqual(descriptiveRecords, original);
});

test("country qualifiers normalize delimiters, preserve internal hyphens and retain exact matches first", async () => {
  const names = ["Trung Quốc — đảo Hải Nam", "Trung Quốc–quá cảnh", "Trung Quốc - du lịch", "Trung Quốc (quá cảnh)"];
  for (const name of names) {
    assert.equal(countryLookupName(name), "Trung Quốc");
    assert.equal(countryCandidateScore(china, name), 1);
    assert.equal(decodeURIComponent(new URL(buildAdministrativeGeocodingUrl(name, "key", "country")).pathname), "/geocoding/Trung Quốc.json");
  }
  assert.equal(countryLookupName("Guinea-Bissau — quá cảnh"), "Guinea-Bissau");
  assert.equal(countryLookupName("Guinea-Bissau"), "Guinea-Bissau");
  assert.equal(countryCandidateScore({ ...china, text: names[0], properties: {} }, names[0]), 0);
  const exact = await loadAdministrativeBoundaries(["Guinea-Bissau"], { apiKey: "key", placeType: "country",
    fetchImpl: async () => response([{ ...china, id: "country.gw", text: "Guinea-Bissau", place_name: "Guinea-Bissau", properties: { country_code: "gw" } }]) });
  assert.equal(exact.features.length, 1);
  const requests = [];
  const result = await loadAdministrativeBoundaries(["Iceland (du lịch)", "Iceland — quá cảnh"], {
    apiKey: "key", placeType: "country", fetchImpl: descriptiveCountryFetch(requests)
  });
  assert.equal(result.features.length, 2);
  assert.equal(result.features[0].properties.__resolved_location_key, result.features[1].properties.__resolved_location_key);
  assert.equal(requests.length, 2, "one geocode and one detail for the unconfigured country");
});

test("country aliases with measures retain the declared aggregation for each source label", async () => {
  const records = descriptiveRecords.slice(-2).map((row, index) => ({ ...row, value: (index + 1) * 10 }));
  const columns = [...descriptiveColumns, { name: "value", role: "measure", aggDefault: "mean" }];
  const boundaries = await loadAdministrativeBoundaries(records.map(row => row["Điểm đến"]), {
    apiKey: "key", placeType: "country", fetchImpl: descriptiveCountryFetch()
  });
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, { geometry: { field: "Điểm đến" }, metricField: "value", aggregation: "mean" }, { columns });
  assert.equal(data.features.length, 2);
  assert.deepEqual(data.features.map(feature => feature.properties.__metric), [10, 20]);
  assert.ok(data.features.every(feature => feature.properties.__source_locations === undefined));
});

test("decorated country lookup uses local ADM0 fallback consistently", async () => {
  const name = "Trung Quốc — quá cảnh";
  const result = await loadAdministrativeBoundaries([name], { placeType: "country", fetchImpl: async url => ({
    ok: true, json: async () => JSON.parse(await readFile(url, "utf8"))
  }) });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.__country_code, "CHN");
  assert.equal(result.features[0].properties.__data_location, name);
});

test("wrong countries, wrong levels and tied matches are rejected; ambiguity remains repairable", async () => {
  const name = "Trung Quốc — quá cảnh";
  for (const features of [[countryFeature(descriptiveCountries[0])], [{ ...china, place_type: ["region"] }],
    [china, { ...china, id: "country.cn-alternative" }]]) {
    assert.equal(await getMapTilerAdministrativeBoundary(name, { apiKey: "key", placeType: "country", fetchImpl: async () => response(features) }), null);
  }
  const ambiguous = await loadAdministrativeBoundaries([name], { apiKey: "key", placeType: "country", strict: false,
    fetchImpl: async () => response([china, { ...china, id: "country.cn-alternative" }]) });
  assert.deepEqual(ambiguous.unmatched, [name]);
  assert.equal(ambiguous.candidates[name].length, 2);
  const wrongDetail = await getMapTilerAdministrativeBoundary(name, { apiKey: "key", placeType: "country", fetchImpl: async url =>
    response([String(url).includes("country.cn") ? countryFeature(descriptiveCountries[0]) : { ...china, geometry: { type: "Point", coordinates: [1, 1] } }]) });
  assert.equal(wrongDetail, null);
});

test("canonical country cache rebinds each original source label", async () => {
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = descriptiveCountryFetch(requests);
  try {
    const first = await getMapTilerAdministrativeBoundary("Trung Quốc — đảo Hải Nam", { apiKey: "cache-key", placeType: "country" });
    const second = await getMapTilerAdministrativeBoundary("Trung Quốc — quá cảnh", { apiKey: "cache-key", placeType: "country" });
    assert.equal(requests.length, 2);
    assert.equal(first.properties.__data_location, "Trung Quốc — đảo Hải Nam");
    assert.equal(second.properties.__data_location, "Trung Quốc — quá cảnh");
    assert.equal(first.geometry, second.geometry);
    assert.notEqual(first.properties, second.properties);
  } finally { globalThis.fetch = originalFetch; }
});

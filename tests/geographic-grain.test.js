import test from "node:test";
import assert from "node:assert/strict";
import { administrativeContextFields, geographicLocationName, preferredAdministrativeColumn } from "../src/geographic-grain.js";
import { profileTabularData } from "../src/tabular-data.js";
import { fallbackAnalysis, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { prepareSuggestions } from "../src/ai-chart-pipeline.js";
import { fallbackMapRecommendation } from "../src/ai-data-analysis.js";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { buildAdministrativeGeocodingUrl, getMapTilerAdministrativeBoundary } from "../src/map-search.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { popupFeaturesMatch, popupRegionRecords } from "../src/ai-popup-chart.js";

const rows = [1, 2].flatMap(day => [
  { "Quốc gia": "Việt Nam", "Khu vực": "Hà Nội", date: `2026-09-0${day}`, value: 20 + day },
  { "Quốc gia": "Thái Lan", "Khu vực": "Bangkok", date: `2026-09-0${day}`, value: 30 + day }
]);
const polygon = x => ({ type: "Polygon", coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 0]]] });
const response = features => ({ ok: true, json: async () => ({ type: "FeatureCollection", features }) });

test("region fallback follows the observation level even with one area per country and reversed column order", () => {
  for (const records of [rows, rows.map(row => Object.fromEntries(Object.entries(row).reverse()))]) {
    const profile = profileTabularData(records);
    const analysis = fallbackAnalysis(profile);
    assert.equal(analysis.suggestions.find(item => item.chartType === "choropleth").bindings.region, "Khu vực");
    assert.equal(fallbackMapRecommendation(records).geometry.field, "Khu vực");
    assert.deepEqual(fallbackMapRecommendation(records).geometry.contextFields, ["Quốc gia"]);
    assert.equal(fallbackMapRecommendation(records).geometry.country, null);
    const suggestions = prepareSuggestions({ ...analysis, suggestions: [] }, records, {}, { mapOnly: true });
    assert.equal(suggestions.find(item => item.chartType === "choropleth").bindings.region, "Khu vực");
  }
  const countriesOnly = rows.map(({ "Khu vực": _area, ...record }) => record);
  assert.equal(fallbackMapRecommendation(countriesOnly).geometry.field, "Quốc gia");
  const noRegions = rows.map(record => ({ ...record, "Khu vực": null }));
  assert.equal(fallbackMapRecommendation(noRegions).geometry.field, "Quốc gia");
});

test("generic administrative metadata chooses the deepest populated level and keeps the AI's explicit grain decision", () => {
  const columns = [
    { name: "parent", role: "geo", geoLevel: "country" },
    { name: "middle", role: "geo", geoLevel: "admin1" },
    { name: "detail", role: "geo", geoLevel: "admin2" },
    { name: "latitude", role: "geo", geoLevel: "point_lat" }
  ];
  assert.equal(preferredAdministrativeColumn(columns).name, "detail");
  assert.deepEqual(administrativeContextFields(columns, "detail"), ["middle", "parent"]);
  assert.equal(geographicLocationName({ detail: "Central", middle: "West", parent: "A" }, {
    field: "detail", contextFields: administrativeContextFields(columns, "detail")
  }), "Central, West, A");
  const profile = profileTabularData(rows);
  const analysis = fallbackAnalysis(profile);
  const normalized = validateAndNormalizeAnalysis({ ...analysis, source: "ai", grain: "Số đo cấp quốc gia", suggestions: [{
    id: "country", chartType: "choropleth", bindings: { region: "Quốc gia", value: "value" }, confidence: .9
  }] }, profile);
  assert.equal(normalized.suggestions[0].bindings.region, "Quốc gia", "fallback preference must not overwrite the AI's explicit interpretation");
});

test("regional lookup uses each row's country, separates duplicate names, and does not require configured local files", async () => {
  const countries = [
    { name: "Việt Nam", iso2: "vn", x: 10 }, { name: "Thái Lan", iso2: "th", x: 20 },
    { name: "Testland", iso2: null, x: 30 }
  ];
  const columns = [
    { name: "market", role: "geo", geoLevel: "country" },
    { name: "district", role: "geo", geoLevel: "admin1" },
    { name: "date", role: "time" }, { name: "amount", role: "measure", aggDefault: "mean" }
  ];
  const records = countries.flatMap(country => [1, 2].map(day => ({ market: country.name, district: "Central",
    date: new Date(`2026-09-0${day}`), amount: country.x + day })));
  const geometry = { field: "district", contextFields: administrativeContextFields(columns, "district") };
  const contexts = Object.fromEntries(records.map(record => [geographicLocationName(record, geometry), { country: record.market }]));
  const suggestions = prepareSuggestions({ columns, suggestions: [] }, records, {}, { mapOnly: true });
  assert.equal(suggestions[0].chartType, "choropleth");
  assert.equal(suggestions[0].bindings.region, "district");
  assert.equal(suggestions[0].available, true, "same-name areas in different countries are distinct geographic groups");
  const requests = [];
  const boundaries = await loadAdministrativeBoundaries(Object.keys(contexts), {
    apiKey: "test", country: "VN", contexts,
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl); requests.push(url);
      assert.equal(url.origin, "https://api.maptiler.com");
      const country = countries.find(item => decodeURIComponent(url.pathname).includes(item.name));
      assert.ok(country);
      assert.equal(url.searchParams.get("country"), country.iso2);
      assert.equal(url.searchParams.has("bbox"), country.iso2 === "vn");
      const feature = { type: "Feature", id: `region.${country.x}`, text: "Central", place_name: `Central, ${country.name}`,
        place_type: ["region"], properties: country.iso2 ? { country_code: country.iso2 } : {}, geometry: polygon(country.x) };
      const wrong = { ...feature, id: "region.wrong", place_name: "Central, Nga", properties: { country_code: "ru" } };
      return response([wrong, feature]);
    }
  });
  assert.equal(requests.length, 3, "daily rows share a lookup within each geographic context");
  assert.equal(boundaries.matchRate, 1);
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, { geometry, metricField: "amount", aggregation: "mean" }, {
    columns, filters: { date: "2026-09-02T00:00:00.000Z" }
  });
  assert.equal(data.features.length, 3);
  assert.deepEqual(data.features.map(feature => feature.properties.amount), [12, 22, 32]);
  assert.deepEqual(data.features.map(feature => feature.geometry.coordinates[0][0][0]), [10, 20, 30]);
  assert.ok(data.features.every(feature => feature.properties.__location === "Central"));
  const ownRows = popupRegionRecords(records, data.features[1], "district", { columns });
  assert.deepEqual(ownRows.map(record => record.amount), [21, 22]);
  assert.equal(popupFeaturesMatch(data.features[0], data.features[1], "district", { columns }), false);
});

test("foreign region URLs and candidates never reuse Vietnam constraints or accept a different country", async () => {
  const url = new URL(buildAdministrativeGeocodingUrl("Paris", "test", "region", "FRA"));
  assert.equal(url.searchParams.get("country"), "fr");
  assert.equal(url.searchParams.has("bbox"), false);
  const feature = await getMapTilerAdministrativeBoundary("Central", { apiKey: "test", country: "THA",
    fetchImpl: async () => response([{ id: "region.wrong", text: "Central", place_type: ["region"],
      place_name: "Central, Việt Nam", properties: { country_code: "vn" }, geometry: polygon(0) }]) });
  assert.equal(feature, null);
});

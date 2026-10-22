import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { mockAiAnalysis } from "./fixtures/mock-ai-analysis.js";
import { prepareSuggestions } from "../src/ai-chart-pipeline.js";
import { mockMapRecommendation } from "./fixtures/mock-ai-analysis.js";
import { buildAdministrativeGeocodingUrl, countryCandidateScore, getMapTilerAdministrativeBoundary, landOnlyBoundary } from "../src/map-search.js";
import { normalizeTabularRecords } from "../src/tabular-data.js";
import { parseSpreadsheetBuffer } from "../src/tabular-parser.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { countryFeature, createCountryWeatherWorkbook, WEATHER_COUNTRIES } from "./fixtures/country-weather-fixture.js";

const response = features => ({ ok: true, json: async () => ({ type: "FeatureCollection", features }) });
const RUSSIA = { name: "Nga", text: "Liên bang Nga", code: "ru", bbox: [20, 41, 180, 82] };
const CODE_COUNTRIES = [
  { ...WEATHER_COUNTRIES[0], iso3: "VNM", temperature: 29.9 },
  { ...RUSSIA, iso3: "RUS", temperature: 35 },
  { name: "Hoa Kỳ", text: "United States", code: "us", iso3: "USA", temperature: 32, bbox: [-125, 25, -66, 49] },
  { name: "Áo", text: "Austria", code: "at", iso3: "AUT", temperature: 21, bbox: [9, 46, 17, 49] },
  { name: "Úc", text: "Australia", code: "au", iso3: "AUS", temperature: 23, bbox: [113, -44, 154, -10] },
  { name: "Nhật Bản", text: "Japan", code: "jp", iso3: "JPN", temperature: 27, bbox: [129, 31, 146, 46] },
  { name: "Hàn Quốc", text: "South Korea", code: "kr", iso3: "KOR", temperature: 20, bbox: [126, 34, 130, 39] }
];

test("country URLs search globally while province lookup retains Vietnam constraints", () => {
  const url = new URL(buildAdministrativeGeocodingUrl("Thái Lan", "key", "country"));
  assert.equal(decodeURIComponent(url.pathname), "/geocoding/Thái Lan.json");
  assert.equal(url.searchParams.get("types"), "country");
  assert.equal(url.searchParams.get("autocomplete"), "false");
  assert.equal(url.searchParams.has("country"), false);
  assert.equal(url.searchParams.has("bbox"), false);
  const province = new URL(buildAdministrativeGeocodingUrl("Hà Nội", "key", "region"));
  assert.equal(province.searchParams.get("country"), "vn");
  assert.ok(province.searchParams.has("bbox"));
});

test("country identity matches Vietnamese, English, code and localized response fields", () => {
  for (const country of WEATHER_COUNTRIES) {
    const feature = countryFeature(country);
    for (const name of [country.name, country.text, country.code]) assert.equal(countryCandidateScore(feature, name), 0, name);
  }
  const france = { ...countryFeature(WEATHER_COUNTRIES[1]), text: "France", properties: { country_code: "fr" }, text_vi: "Pháp" };
  assert.equal(countryCandidateScore(france, "Pháp"), 0);
  assert.equal(countryCandidateScore(france, "Thái Lan"), 2);
  assert.equal(countryCandidateScore({ ...france, place_type: ["region"] }, "Pháp"), 2);
  for (const country of CODE_COUNTRIES) {
    assert.equal(countryCandidateScore(countryFeature(country), country.iso3), 0, country.iso3);
  }
  assert.equal(countryCandidateScore(countryFeature(CODE_COUNTRIES[3]), "AUS"), 2);
  const malaysia = countryFeature({ name: "Malaysia", text: "Malaysia", code: "my", bbox: [99, 1, 120, 8] });
  assert.equal(countryCandidateScore(malaysia, "Mỹ"), 2);
  assert.equal(countryCandidateScore(malaysia, "MY"), 0);
});

test("country weather XLSX matches five global polygons once and joins the correct values for every day", async () => {
  const parsed = parseSpreadsheetBuffer(createCountryWeatherWorkbook());
  assert.equal(parsed.records.length, 35);
  const analysis = mockAiAnalysis(parsed.profile);
  const region = analysis.columns.find(column => column.name === "Quốc gia");
  assert.equal(region.role, "geo");
  assert.equal(region.geoLevel, "country");
  assert.equal(region.country, null);
  const recommendation = mockMapRecommendation(parsed.records);
  assert.equal(recommendation.geometry.placeType, "country");
  assert.equal(recommendation.geometry.country, null);
  const requests = [];
  const boundaries = await loadAdministrativeBoundaries(parsed.records.map(record => record["Quốc gia"]), {
    apiKey: "key", placeType: "country", country: "VN",
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl); requests.push(url);
      assert.equal(url.origin, "https://api.maptiler.com", "provider matches do not require local country mappings");
      const path = decodeURIComponent(url.pathname);
      const detail = WEATHER_COUNTRIES.find(country => path.endsWith(`/country.${country.code}.json`));
      if (detail) return response([countryFeature(detail)]);
      assert.equal(url.searchParams.get("types"), "country");
      assert.equal(url.searchParams.has("country"), false);
      assert.equal(url.searchParams.has("bbox"), false);
      const country = WEATHER_COUNTRIES.find(country => path.endsWith(`/${country.name}.json`));
      assert.ok(country, path);
      return response([countryFeature(country, { point: true })]);
    }
  });
  assert.equal(boundaries.matchRate, 1);
  assert.equal(boundaries.features.length, 5);
  assert.deepEqual(boundaries.matched, WEATHER_COUNTRIES.map(country => country.name));
  assert.equal(requests.length, 10, "one search and one full-geometry request per country, not per daily row");
  const { records } = normalizeTabularRecords(parsed.records, analysis.columns);
  for (let day = 1; day <= 7; day++) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    const data = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: { "Ngày": `${date}T00:00:00.000Z` } });
    assert.equal(data.features.length, 5, date);
    for (const feature of data.features) {
      const original = parsed.records.find(row => row["Quốc gia"] === feature.properties.__location && row["Ngày"] === date);
      assert.equal(feature.properties.__metric, original[recommendation.metricField]);
      assert.equal(feature.properties.boundary_source, "MapTiler");
    }
  }
});

test("country names and code columns preserve the AI role and geographic level", () => {
  for (const field of ["Quốc gia", "Mã quốc gia", "Ma quoc gia", "Country Code"]) {
    const rows = CODE_COUNTRIES.map(country => ({ [field]: country.iso3, "Nhiệt độ trung bình": country.temperature }));
    const parsed = parseSpreadsheetBuffer(createCountryWeatherWorkbook(rows));
    for (const role of ["geo", "category", "text", "id"]) {
      const result = validateAndNormalizeAnalysis({ columns: [{ name: field, role, geoLevel: "admin1", country: "VN" }], suggestions: [] }, parsed.profile);
      const column = result.columns.find(column => column.name === field);
      assert.equal(column.role, role, `${field}: ${role}`);
      assert.equal(column.geoLevel, role === "geo" ? "admin1" : null);
      assert.equal(column.country, role === "geo" ? "VN" : null);
    }
  }
});

test("ISO Alpha-3 weather XLSX joins all seven country metrics through MapTiler and ADM0 fallback", async t => {
  const field = "Mã quốc gia";
  const rows = CODE_COUNTRIES.map(country => ({ [field]: country.iso3, "Ngày": "01/09/2026", "Nhiệt độ trung bình": country.temperature }));
  const parsed = parseSpreadsheetBuffer(createCountryWeatherWorkbook(rows));
  const analysis = validateAndNormalizeAnalysis({ ...mockAiAnalysis(parsed.profile), columns: [
    { name: field, role: "geo", geoLevel: "country" }, { name: "Ngày", role: "time", timeParse: "text" },
    { name: "Nhiệt độ trung bình", role: "measure", aggDefault: "mean", unit: "°C" }
  ], suggestions: [{ id: "ai-country", chartType: "choropleth", bindings: { region: field, value: "Nhiệt độ trung bình" }, confidence: .9 }] }, parsed.profile);
  const { records, validRowRate } = normalizeTabularRecords(parsed.records, analysis.columns);
  const [suggestion] = prepareSuggestions(analysis, records, validRowRate);
  assert.equal(suggestion.chartType, "choropleth");
  assert.equal(suggestion.available, true);
  assert.equal(suggestion.bindings.region, field);
  const recommendation = mockMapRecommendation(parsed.records);
  assert.equal(recommendation.geometry.placeType, "country");
  assert.equal(recommendation.geometry.country, null);
  const codes = rows.map(row => row[field]);
  for (const mode of ["maptiler", "point-only", "empty", "http", "no-key"]) {
    await t.test(mode, async () => {
      const requests = [];
      const boundaries = await loadAdministrativeBoundaries(codes, {
        apiKey: mode === "no-key" ? undefined : "key", placeType: "country",
        fetchImpl: async rawUrl => {
          const url = new URL(rawUrl); requests.push(url);
          const path = decodeURIComponent(url.pathname);
          if (url.origin === "https://api.maptiler.com") {
            if (mode === "http") return { ok: false, status: 503 };
            const detail = CODE_COUNTRIES.find(country => path.endsWith(`/country.${country.code}.json`));
            if (detail) return response([countryFeature(detail, { point: mode !== "maptiler" })]);
            assert.equal(url.searchParams.get("types"), "country");
            assert.equal(url.searchParams.has("country"), false);
            assert.equal(url.searchParams.has("bbox"), false);
            const country = CODE_COUNTRIES.find(country => path.endsWith(`/${country.name}.json`));
            assert.ok(country, "Alpha-3 codes are resolved to country names for the provider query");
            return response(mode === "empty" ? [] : [countryFeature(country, { point: true })]);
          }
          assert.notEqual(mode, "maptiler", "a provider polygon must take priority over local files");
          const country = CODE_COUNTRIES.find(country => path.endsWith(`/${country.iso3}/${country.iso3}_ADM0.geojson`));
          assert.ok(country, path);
          return response([{ type: "Feature", properties: { GID_0: country.iso3, COUNTRY: country.text }, geometry: countryFeature(country).geometry }]);
        }
      });
      assert.deepEqual(boundaries.matched, codes);
      assert.deepEqual(boundaries.unmatched, []);
      assert.deepEqual(boundaries.features.map(feature => feature.properties.__data_location), codes);
      assert.equal(requests.filter(url => url.pathname.endsWith(".geojson")).length, mode === "maptiler" ? 0 : codes.length);
      if (mode === "no-key") assert.ok(requests.every(url => url.protocol === "file:"));
      const joined = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: { "Ngày": "2026-09-01T00:00:00.000Z" } });
      assert.equal(joined.features.length, codes.length);
      assert.deepEqual(joined.features.map(feature => feature.properties.__location), codes);
      assert.deepEqual(joined.features.map(feature => feature.properties.__metric), CODE_COUNTRIES.map(country => country.temperature));
      assert.ok(joined.features.every(feature => feature.properties.boundary_source === (mode === "maptiler" ? "MapTiler" : "Local ADM")));
    });
  }
});

test("countries without a local mask retain their polygon even with a stale Vietnam option", async () => {
  for (const country of [
    { name: "Iceland", text: "Iceland", code: "is", bbox: [-25, 63, -13, 67] },
    { name: "Peru", text: "Peru", code: "pe", bbox: [-82, -19, -68, 0] }
  ]) {
    const feature = countryFeature(country);
    assert.equal(await landOnlyBoundary(feature, {
      country: "VNM", forceVietnam: true, fetchImpl: () => assert.fail("foreign polygons must not request a Vietnam mask")
    }), feature);
  }
});

test("Russia polygons use RUS_ADM0 as their mask even when the caller still specifies Vietnam", async () => {
  const feature = countryFeature(RUSSIA);
  const urls = [];
  const clipped = await landOnlyBoundary(feature, {
    country: "VNM", forceVietnam: true,
    fetchImpl: async url => {
      urls.push(String(url));
      assert.ok(String(url).endsWith("/RUS/RUS_ADM0.geojson"));
      return { ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) };
    }
  });
  assert.equal(urls.length, 1);
  assert.equal(clipped.properties.land_mask, "RUS ADM0");
  assert.equal(clipped.properties.land_clipped, true);
});

test("Russia uses its own ADM0 for missing results, missing polygons, API failures or a missing key", async () => {
  const source = JSON.parse(await readFile(new URL("../administrative_division/RUS/RUS_ADM0.geojson", import.meta.url), "utf8"));
  for (const failure of ["empty", "point-only", "http", "network", "no-key"]) {
    const urls = [];
    const names = ["Nga", "Liên bang Nga", "Russia", "Russian Federation", "RU", "RUS"];
    const result = await loadAdministrativeBoundaries(names, {
      apiKey: failure === "no-key" ? undefined : "key", placeType: "country",
      fetchImpl: async rawUrl => {
        const url = new URL(rawUrl); urls.push(url);
        if (url.protocol === "https:") {
          if (failure === "network") throw new Error("Provider unavailable");
          if (failure === "http") return { ok: false, status: 503 };
          return response(failure === "point-only" ? [countryFeature(RUSSIA, { point: true })] : []);
        }
        assert.ok(url.pathname.endsWith("/RUS/RUS_ADM0.geojson"));
        return { ok: true, json: async () => source };
      }
    });
    assert.deepEqual(result.matched, names, failure);
    assert.deepEqual(result.unmatched, []);
    assert.equal(urls.filter(url => url.pathname.endsWith(".geojson")).length, 1, "aliases share the Russia file load");
    assert.ok(result.features.every(feature => feature.properties.GID_0 === "RUS" && feature.properties.boundary_source === "Local ADM"));
    assert.deepEqual(result.features.map(feature => feature.properties.__data_location), names);
    for (const feature of result.features) assert.equal(feature.geometry, source.features[0].geometry);
  }
});

test("provider failures use only the matching configured country's ADM0 and leave other countries unmatched", async () => {
  const urls = [];
  const names = [...WEATHER_COUNTRIES.map(country => country.name), "Ấn Độ", "Iceland"];
  const result = await loadAdministrativeBoundaries(names, {
    apiKey: "key", placeType: "country", strict: false,
    fetchImpl: async url => {
      urls.push(String(url));
      if (String(url).startsWith("https:")) return { ok: false, status: 503 };
      assert.ok(/\/(VNM|THA|LAO|KHM|MMR|IND)\/\1_ADM0\.geojson$/.test(String(url)));
      return { ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) };
    }
  });
  assert.deepEqual(result.matched, [...WEATHER_COUNTRIES.map(country => country.name), "Ấn Độ"]);
  assert.deepEqual(result.unmatched, ["Iceland"]);
  assert.equal(urls.filter(url => url.endsWith(".geojson")).length, 6);
  assert.equal(result.features.find(feature => feature.properties.__data_location === "Ấn Độ").properties.GID_0, "IND");
});

test("country lookup rejects unrelated or ambiguous country matches instead of choosing the first polygon", async () => {
  const country = countryFeature(WEATHER_COUNTRIES[1]);
  const unrelated = await getMapTilerAdministrativeBoundary("Lào", {
    apiKey: "key", placeType: "country", fetchImpl: async () => response([country])
  });
  assert.equal(unrelated, null);
  const ambiguous = await getMapTilerAdministrativeBoundary("Congo", {
    apiKey: "key", placeType: "country", fetchImpl: async () => response([
      { ...country, id: "country.1", text: "Congo", properties: {} },
      { ...country, id: "country.2", text: "Congo", properties: {} }
    ])
  });
  assert.equal(ambiguous, null);
});

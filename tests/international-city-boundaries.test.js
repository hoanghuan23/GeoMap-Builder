import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";

const polygon = { type: "MultiPolygon", coordinates: [[[[100, 1], [101, 1], [101, 2], [100, 1]]]] };
const response = features => ({ ok: true, json: async () => ({ type: "FeatureCollection", features }) });
// These type/label combinations reproduce the live MapTiler responses; IDs and geometry are synthetic.
const capitals = [
  { name: "Singapore", country: "Singapore", code: "sg", type: "country" },
  { name: "Manila", country: "Philippines", code: "ph", type: "municipality" },
  { name: "Bandar Seri Begawan", country: "Brunei", code: "bn", type: "municipal_district" },
  { name: "Dili", country: "Timor-Leste", code: "tl", type: "subregion" }
];
const contextsFor = cases => Object.fromEntries(cases.map(item => [`${item.name}, ${item.country}`, { country: item.country }]));
const featureFor = item => ({ type: "Feature", id: `${item.type}.${item.code}`, text: item.name,
  place_name: `${item.name}, ${item.country}`, place_type: [item.type],
  properties: { country_code: item.code, kind: "admin_area", ...(item.type === "subregion" ? {} : { place_designation: "city" }) },
  geometry: { type: "Point", coordinates: [100, 1] } });

test("international cities resolve their actual polygon levels while retaining uploaded identities", async () => {
  const contexts = contextsFor(capitals); const calls = [];
  const result = await loadAdministrativeBoundaries(Object.keys(contexts), {
    apiKey: "test", contexts, strict: false,
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl); const path = decodeURIComponent(url.pathname); calls.push(path);
      const detail = capitals.find(item => path.endsWith(`/${item.type}.${item.code}.json`));
      if (detail) return response([{ ...featureFor(detail), geometry: polygon }]);
      const item = capitals.find(item => path.includes(item.name));
      assert.ok(item, path);
      assert.equal(url.searchParams.has("bbox"), false);
      if (item.type === "country") {
        assert.equal(url.searchParams.get("types"), "country");
        return response([featureFor(item)]);
      }
      assert.equal(url.searchParams.get("country"), item.code);
      if (url.searchParams.get("types") === "region") {
        return response(item.name === "Manila" ? [{ ...featureFor(item), id: "region.metro", text: "Metro Manila", place_name: "Metro Manila, Philippines", place_type: ["region"] }] : []);
      }
      assert.ok(url.searchParams.get("types").split(",").includes(item.type));
      return response([
        featureFor(item),
        { ...featureFor(item), id: "place.virtual", place_type: ["place"], properties: { country_code: item.code, kind: "virtual_place" } },
        { ...featureFor(item), id: "municipality.foreign", properties: { country_code: "ru" }, place_name: `${item.name}, Nga` },
        { ...featureFor(item), id: "municipality.other", text: `Greater ${item.name}`, place_name: `Greater ${item.name}, ${item.country}` }
      ]);
    }
  });
  assert.equal(result.matchRate, 1);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.matched, Object.keys(contexts));
  assert.deepEqual(result.features.map(feature => feature.place_type[0]), capitals.map(item => item.type));
  assert.ok(result.features.every(feature => feature.geometry.type === "MultiPolygon"));
  assert.ok(!calls.some(path => /place\.virtual|municipality\.foreign|municipality\.other|region\.metro/.test(path)), "unrelated and virtual features do not trigger geometry lookups");
  const records = capitals.map((item, index) => ({ city: item.name, country: item.country, value: 20 + index }));
  const data = joinRecordsToMapTilerBoundaries(records, result, {
    geometry: { field: "city", contextFields: ["country"] }, metricField: "value", aggregation: "mean"
  });
  assert.deepEqual(data.features.map(feature => feature.properties.__location), capitals.map(item => item.name));
  assert.deepEqual(data.features.map(feature => feature.properties.value), [20, 21, 22, 23]);
});

test("local fallback uses each country's configured levels and limits city-state geometry to its matching name", async () => {
  const cases = [capitals[0], capitals[1], capitals[3], { name: "Central", country: "Singapore" }];
  const contexts = contextsFor(cases); const requested = [];
  const result = await loadAdministrativeBoundaries(Object.keys(contexts), {
    contexts, strict: false,
    fetchImpl: async url => { requested.push(String(url)); return response(JSON.parse(await readFile(url, "utf8")).features); }
  });
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.features.map(feature => feature.properties.__admin_level), [0, 2, 1, 1]);
  assert.equal(result.features[1].properties.NAME_2, "Manila");
  assert.equal(result.features[2].properties.NAME_1, "Dili");
  assert.equal(result.features[3].properties.NAME_1, "Central");
  assert.ok(requested.every(url => !/VNM/.test(url)));
  assert.equal(requested.filter(url => url.endsWith("/SGP/SGP_ADM0.geojson")).length, 1);
});

test("alternate-level search keeps administrative parent context and exposes ambiguous polygons", async () => {
  const name = "Harbor, West, Philippines";
  const feature = { ...featureFor({ name: "Harbor", country: "Philippines", code: "ph", type: "municipality" }),
    place_name: name, context: [{ id: "region.west", text: "West" }], geometry: polygon };
  const resolved = await loadAdministrativeBoundaries([name], {
    apiKey: "test", country: "PHL", strict: false,
    fetchImpl: async () => response([feature, { ...feature, id: "municipality.east", place_name: "Harbor, East, Philippines", context: [{ id: "region.east", text: "East" }] }])
  });
  assert.equal(resolved.features.length, 1);
  assert.equal(resolved.features[0].id, feature.id);

  const ambiguous = await loadAdministrativeBoundaries(["Harbor, Philippines"], {
    apiKey: "test", country: "PHL", strict: false,
    fetchImpl: async rawUrl => new URL(rawUrl).searchParams.get("types") === "region" ? response([])
      : response([feature, { ...feature, id: "municipality.second" }])
  });
  assert.deepEqual(ambiguous.unmatched, ["Harbor, Philippines"]);
  assert.equal(ambiguous.candidates["Harbor, Philippines"].length, 2);
});

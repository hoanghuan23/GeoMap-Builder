import assert from "node:assert/strict";
import test from "node:test";
import { countryBoundaryUrl, loadCountryBoundaryData, resolveBoundaryCountry } from "../src/country-boundary-sources.js";
import { loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";

const vietnam = { type: "FeatureCollection", features: [{ type: "Feature",
  properties: { GID_0: "VNM", COUNTRY: "Vietnam" },
  geometry: { type: "Polygon", coordinates: [[[102, 8], [109, 8], [109, 23], [102, 8]]] }
}] };

test("Vietnam names and codes resolve to the VNM folder at every configured ADM level", () => {
  for (const alias of ["Việt Nam", "VIỆT NAM", " Việt NAM ", "Viet Nam", "Vietnam", "vn", "VNM"]) {
    assert.equal(resolveBoundaryCountry(alias), "VNM");
    for (let level = 0; level < 3; level++) {
      assert.ok(countryBoundaryUrl(alias, level).pathname.endsWith(`/administrative_division/VNM/VNM_ADM${level}.geojson`));
    }
  }
  for (const value of [null, "", "Iceland", "ISL", "../VNM"]) assert.equal(resolveBoundaryCountry(value), null);
  assert.equal(countryBoundaryUrl("VNM", 3), null);
  assert.equal(countryBoundaryUrl("ISL", 0), null);
});

test("country rows load ADM0 once, preserve source names and need no MapTiler requests", async () => {
  const names = ["Việt NAM", "Vietnam", "VN", "VNM"];
  const requests = [];
  const result = await loadAdministrativeBoundaries(names, {
    placeType: "country", country: null,
    fetchImpl: async url => { requests.push(String(url)); return { ok: true, json: async () => vietnam }; }
  });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].endsWith("/VNM/VNM_ADM0.geojson"));
  assert.deepEqual(result.matched, names);
  assert.deepEqual(result.features.map(feature => feature.properties.__data_location), names);
  assert.ok(result.features.every(feature => feature.properties.__country_code === "VNM" && feature.properties.__admin_level === 0));
});

test("Russia names and codes resolve to the RUS folder at every configured ADM level", () => {
  for (const alias of ["Nga", " LIÊN BANG NGA ", "Lien bang Nga", "Russia", "Russian Federation", "ru", "RUS"]) {
    assert.equal(resolveBoundaryCountry(alias), "RUS");
    for (let level = 0; level <= 3; level++) {
      assert.ok(countryBoundaryUrl(alias, level).pathname.endsWith(`/administrative_division/RUS/RUS_ADM${level}.geojson`));
    }
  }
  assert.equal(countryBoundaryUrl("RUS", 4), null);
  assert.equal(countryBoundaryUrl("Iceland", 0), null);
});

test("exact country names and codes distinguish Mỹ from Malaysia's MY alias", () => {
  for (const name of ["Mỹ", "MỸ", "My\u0303", "Hoa Kỳ", "USA"]) {
    assert.equal(resolveBoundaryCountry(name), "USA", name);
  }
  for (const name of ["MY", "my", "Malaysia", "MYS"]) {
    assert.equal(resolveBoundaryCountry(name), "MYS", name);
  }
});

test("unconfigured local countries never fall back to Vietnam files", async () => {
  const result = await loadAdministrativeBoundaries(["Reykjavík"], {
    country: "ISL", apiKey: "key", strict: false,
    fetchImpl: () => assert.fail("no Vietnam lookup is allowed for an unknown country")
  });
  assert.deepEqual(result.unmatched, ["Reykjavík"]);
  const countries = await loadAdministrativeBoundaries(["Iceland"], {
    placeType: "country", apiKey: "key", strict: false,
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      assert.equal(url.origin, "https://api.maptiler.com");
      assert.equal(url.searchParams.get("types"), "country");
      assert.equal(url.searchParams.has("country"), false);
      return { ok: true, json: async () => ({ features: [] }) };
    }
  });
  assert.deepEqual(countries.unmatched, ["Iceland"]);
});

test("local boundary loading reports missing files and invalid GeoJSON, with cancellation intact", async () => {
  await assert.rejects(loadCountryBoundaryData("VNM", 1, {
    fetchImpl: async () => ({ ok: false, status: 404 })
  }), /VNM ADM1 \(404\)/);
  await assert.rejects(loadCountryBoundaryData("VNM", 1, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ type: "Feature", features: [] }) })
  }), /FeatureCollection/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadCountryBoundaryData("VNM", 0, {
    signal: controller.signal, fetchImpl: () => assert.fail("an aborted lookup must not fetch")
  }), { name: "AbortError" });
});

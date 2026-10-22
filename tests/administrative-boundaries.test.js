import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { administrativeBoundaryLabel, loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { landOnlyBoundary } from "../src/map-search.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { WEATHER_PROVINCES } from "./fixtures/weather-34-fixture.js";

const polygon = { type: "Polygon", coordinates: [[[105, 20], [106, 20], [106, 21], [105, 20]]] };
const response = features => ({ ok: true, json: async () => ({ type: "FeatureCollection", features }) });
const localFetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) });
const commune = id => ({ type: "Feature", id, text: "Xã Tân Châu", place_name: "Xã Tân Châu, Việt Nam",
  place_type: ["municipality"], center: [105, 20], geometry: polygon });

test("country-folder GeoJSON resolves provinces/districts/towns, but never communes as districts", async () => {
  const names = ["tỉnh thái bình", "huyện An Phú", "thị xã Từ Sơn", "xã Tân Châu"];
  const requested = [];
  const boundaries = await loadAdministrativeBoundaries(names, {
    strict: false,
    fetchImpl: async url => { requested.push(String(url)); return localFetch(url); }
  });
  assert.deepEqual(boundaries.matched, names.slice(0, 3));
  assert.deepEqual(boundaries.unmatched, ["xã Tân Châu"]);
  assert.equal(boundaries.matchRate, .75);
  assert.equal(requested.length, 2, "workers share each required local file load");
  assert.ok(requested.every(url => /\/VNM\/VNM_ADM[12]\.geojson$/.test(url)));
  assert.deepEqual(boundaries.features.map(feature => feature.properties[`NAME_${feature.properties.__admin_level}`]), ["TháiBình", "AnPhú", "TừSơn"]);
  assert.ok(boundaries.features.every(feature => feature.id.startsWith("adm.VNM.")));
  const records = names.map((region, i) => ({ region, date: "2026-09-30", temperature: 25 + i }));
  const joined = joinRecordsToMapTilerBoundaries(records, boundaries, {
    geometry: { field: "region" }, metricField: "temperature"
  }, { filters: { date: "2026-09-30" } });
  assert.deepEqual(joined.features.map(feature => feature.properties.temperature), [25, 26, 27]);
  assert.ok(joined.features.every(feature => feature.properties.boundary_source === "Local ADM"));
  assert.equal(await landOnlyBoundary(boundaries.features[0], {
    fetchImpl: () => assert.fail("a local polygon must not be clipped again")
  }), boundaries.features[0]);
});

test("all 63 source provinces resolve from NAME_1 using only VNM_ADM1", async () => {
  const source = JSON.parse(await readFile(new URL("../administrative_division/VNM/VNM_ADM1.geojson", import.meta.url), "utf8"));
  const names = source.features.map(feature => feature.properties.NAME_1);
  assert.equal(names.length, 63);
  const urls = [];
  const result = await loadAdministrativeBoundaries(names, {
    fetchImpl: async url => { urls.push(String(url)); return localFetch(url); }
  });
  assert.equal(result.matchRate, 1);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.features.map(feature => feature.properties.GID_1), source.features.map(feature => feature.properties.GID_1));
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/VNM/VNM_ADM1.geojson"));
});

test("34-province weather data joins every name while preserving the source polygons", async () => {
  const source = JSON.parse(await readFile(new URL("../administrative_division/VNM/VNM_ADM1.geojson", import.meta.url), "utf8"));
  const result = await loadAdministrativeBoundaries(WEATHER_PROVINCES, { fetchImpl: localFetch });
  assert.equal(result.matchRate, 1);
  assert.deepEqual(result.unmatched, []);
  assert.equal(result.features.length, 34);
  assert.deepEqual(result.features.map(feature => feature.properties.__data_location), [...WEATHER_PROVINCES]);
  const hue = result.features.find(feature => feature.properties.__data_location === "Huế");
  assert.equal(hue.properties.NAME_1, "ThừaThiênHuế");
  for (const feature of result.features) {
    assert.deepEqual(feature.geometry, source.features.find(original => original.properties.GID_1 === feature.properties.GID_1).geometry);
  }
  const records = WEATHER_PROVINCES.map((province, index) => ({ province, value: index + 1 }));
  const joined = joinRecordsToMapTilerBoundaries(records, result, { geometry: { field: "province" }, metricField: "value" });
  assert.equal(joined.features.length, 34);
  assert.deepEqual(joined.features.map(feature => feature.properties.value), records.map(record => record.value));
});

test("TYPE_2 and NAME_1 disambiguate districts and towns of the same name", async () => {
  const names = ["Tân Châu", "thị xã Tân Châu", "huyện Tân Châu", "Tân Châu, tỉnh An Giang", "Tân Châu, tỉnh Tây Ninh"];
  const boundaries = await loadAdministrativeBoundaries(names, { placeType: "county", strict: false, fetchImpl: localFetch });
  assert.deepEqual(boundaries.unmatched, ["Tân Châu"]);
  assert.equal(boundaries.candidates["Tân Châu"].length, 2);
  assert.deepEqual(boundaries.candidates["Tân Châu"].map(administrativeBoundaryLabel).sort(), ["Tân Châu — An Giang", "Tân Châu — Tây Ninh"]);
  assert.deepEqual(boundaries.features.map(feature => feature.properties.__province_name), ["An Giang", "Tây Ninh", "An Giang", "Tây Ninh"]);
  assert.notEqual(boundaries.features[0].id, boundaries.features[1].id);
});

test("MapTiler province and commune polygons take priority without loading local files", async () => {
  const urls = [];
  const boundaries = await loadAdministrativeBoundaries(["Hà Nội", "xã Tân Châu"], {
    apiKey: "key", strict: false,
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl); urls.push(url);
      assert.equal(url.origin, "https://api.maptiler.com", "valid provider polygons must not be replaced by local geometry");
      return response(decodeURIComponent(url.pathname).includes("Hà Nội")
        ? [{ id: "region.hanoi", text: "Hà Nội", place_type: ["region"], geometry: polygon }]
        : [commune("municipality.tanchau")]);
    }
  });
  assert.equal(boundaries.matchRate, 1);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("types"), "region");
  assert.ok(urls.some(url => url.searchParams.get("types")?.split(",").includes("municipality")));
  assert.equal(boundaries.features[1].properties.__data_location, "xã Tân Châu");
  assert.equal(boundaries.features[1].properties.__data_place_type, "municipality");
  assert.ok(boundaries.features.every(feature => feature.properties.boundary_source === "MapTiler"));
  assert.equal(boundaries.features[0].geometry, polygon);
});

test("34-province input keeps the MapTiler geometry for every province", async () => {
  const boundaries = await loadAdministrativeBoundaries(WEATHER_PROVINCES, {
    apiKey: "key", fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      assert.equal(url.origin, "https://api.maptiler.com");
      const path = decodeURIComponent(url.pathname);
      const name = WEATHER_PROVINCES.find(name => path.includes(name === "TP. Hồ Chí Minh" ? "Hồ Chí Minh" : name));
      assert.ok(name);
      return response([{ id: `region.${name}`, text: name, place_type: ["region"], geometry: polygon }]);
    }
  });
  assert.equal(boundaries.matchRate, 1);
  assert.deepEqual(boundaries.matched, [...WEATHER_PROVINCES]);
  assert.ok(boundaries.features.every(feature => feature.geometry === polygon && feature.properties.boundary_source === "MapTiler"));
});

test("TP. Hồ Chí Minh uses the expanded MapTiler region and preserves the spreadsheet name", async () => {
  const name = "TP. Hồ Chí Minh";
  const suggestion = { id: "region.887", text: "Thành phố Hồ Chí Minh", place_name: "Thành phố Hồ Chí Minh, Việt Nam",
    place_type: ["region"], properties: { country_code: "vn" }, geometry: { type: "Point", coordinates: [106.7, 10.8] } };
  const expanded = { type: "MultiPolygon", coordinates: [
    [[[106.6, 10.7], [106.8, 10.7], [106.8, 10.9], [106.6, 10.9], [106.6, 10.7]]],
    [[[106.5, 11], [106.8, 11], [106.8, 11.3], [106.5, 11.3], [106.5, 11]]],
    [[[107.1, 10.4], [107.4, 10.4], [107.4, 10.7], [107.1, 10.7], [107.1, 10.4]]]
  ] };
  const urls = [];
  const boundaries = await loadAdministrativeBoundaries([name], {
    apiKey: "key", placeType: "region", country: "VNM", fetchImpl: async rawUrl => {
      const url = new URL(rawUrl); urls.push(url);
      assert.equal(url.origin, "https://api.maptiler.com", "the expanded region must not fall back to old ADM");
      if (url.pathname === "/geocoding/region.887.json") return response([{ ...suggestion, geometry: expanded }]);
      // Abbreviated autocomplete returns point-only places; a typed lookup returns the region.
      if (decodeURIComponent(url.pathname) === "/geocoding/Hồ Chí Minh, Việt Nam.json"
        && url.searchParams.get("types") === "region") return response([suggestion]);
      return response([{ id: "place.hcm", text: name, place_type: ["place"], geometry: { type: "MultiPoint", coordinates: [[106.7, 10.8]] } }]);
    }
  });
  assert.equal(urls.length, 2);
  assert.equal(boundaries.matchRate, 1);
  assert.deepEqual(boundaries.unmatched, []);
  const boundary = boundaries.features[0];
  assert.equal(boundary.id, "region.887");
  assert.equal(boundary.geometry, expanded);
  assert.equal(boundary.properties.boundary_source, "MapTiler");
  assert.equal(boundary.properties.__data_location, name);
  const joined = joinRecordsToMapTilerBoundaries([{ province: name, temperature: 28.5 }], boundaries, {
    geometry: { field: "province" }, metricField: "temperature"
  });
  assert.equal(joined.features.length, 1);
  assert.equal(joined.features[0].geometry, expanded);
  assert.equal(joined.features[0].properties.__location, name);
  assert.equal(joined.features[0].properties.__metric, 28.5);
});

test("HCM query override is limited to Vietnamese regions and explicit aliases take priority", async () => {
  for (const { name, options, expectedQuery, countryCode } of [
    { name: "TP. Hồ Chí Minh", options: { placeType: "county", country: "VNM" }, expectedQuery: "TP. Hồ Chí Minh", countryCode: "vn" },
    { name: "TP. Hồ Chí Minh", options: { placeType: "region", country: "THA" }, expectedQuery: "TP. Hồ Chí Minh", countryCode: "th" },
    { name: "TP. Cần Thơ", options: { placeType: "region", country: "VNM" }, expectedQuery: "TP. Cần Thơ", countryCode: "vn" },
    { name: "TP. Hồ Chí Minh", options: { aliases: { "TP. Hồ Chí Minh": "Sài Gòn" } }, expectedQuery: "Sài Gòn, Việt Nam", countryCode: "vn" }
  ]) {
    const urls = [];
    const result = await loadAdministrativeBoundaries([name], {
      apiKey: "key", ...options, fetchImpl: async rawUrl => {
        const url = new URL(rawUrl); urls.push(url);
        return response([{ id: "region.city", text: options.aliases ? "Sài Gòn" : name, place_type: ["region"],
          properties: { country_code: countryCode }, geometry: polygon }]);
      }
    });
    assert.equal(decodeURIComponent(urls[0].pathname), `/geocoding/${expectedQuery}.json`);
    assert.equal(result.features[0].properties.__data_location, name);
  }
});

test("same-name communes require a choice and can reuse the explicitly selected polygon", async () => {
  const first = { ...commune("municipality.first"), center: [106.17, 11.55] };
  const second = { ...commune("municipality.second"), center: [105.56, 18.90],
    geometry: { type: "MultiPolygon", coordinates: [[[[105.5, 18.8], [105.6, 18.8], [105.6, 18.9], [105.5, 18.8]]]] } };
  const reverseRequests = [];
  const result = await loadAdministrativeBoundaries(["xã Tân Châu"], {
    apiKey: "key", strict: false, fetchImpl: async rawUrl => {
      const url = new URL(rawUrl);
      if (/^\/geocoding\/\d/.test(url.pathname)) {
        reverseRequests.push(url);
        assert.equal(url.searchParams.get("types"), "region");
        assert.equal(url.searchParams.get("language"), "vi");
        const text = url.pathname.includes("106.17") ? "Tỉnh Tây Ninh" : "Hà Tĩnh";
        return response([{ id: `region.${text}`, text, place_type: ["region"] }]);
      }
      return response([first, second]);
    }
  });
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.unmatched, ["xã Tân Châu"]);
  assert.equal(result.candidates["xã Tân Châu"].length, 2);
  assert.equal(reverseRequests.length, 2);
  assert.deepEqual(result.candidates["xã Tân Châu"].map(administrativeBoundaryLabel), ["Xã Tân Châu — Tây Ninh", "Xã Tân Châu — Hà Tĩnh"]);
  for (const feature of result.candidates["xã Tân Châu"]) {
    const selected = await loadAdministrativeBoundaries(["xã Tân Châu"], {
      selections: { "xã Tân Châu": feature },
      fetchImpl: () => assert.fail("an explicit polygon selection should be reused")
    });
    assert.equal(selected.features[0].id, feature.id);
    assert.equal(selected.features[0].geometry, feature.geometry);
    assert.equal(selected.matchRate, 1);
  }
});

test("province metadata is reused without extra requests and province aliases narrow same-name communes", async () => {
  const first = { ...commune("municipality.first"), context: [{ id: "region.tayninh", text: "Tây Ninh" }] };
  const second = { ...commune("municipality.second"), properties: { __province_name: "An Giang" } };
  let requested = 0;
  const fetchImpl = async () => { requested++; return response([first, second]); };
  const ambiguous = await loadAdministrativeBoundaries(["xã Tân Châu"], { apiKey: "key", strict: false, fetchImpl });
  assert.equal(requested, 1);
  assert.deepEqual(ambiguous.candidates["xã Tân Châu"].map(administrativeBoundaryLabel), ["Xã Tân Châu — Tây Ninh", "Xã Tân Châu — An Giang"]);
  const narrowed = await loadAdministrativeBoundaries(["xã Tân Châu"], {
    apiKey: "key", aliases: { "xã Tân Châu": "xã Tân Châu, tỉnh An Giang" }, fetchImpl
  });
  assert.equal(narrowed.features[0].id, second.id);
  assert.equal(narrowed.features[0].properties.__data_location, "xã Tân Châu");
});

test("a province query cannot match the ward of the same name, and aliases preserve source rows", async () => {
  const ward = { ...commune("municipality.thaibinh"), text: "Phường Thái Bình", place_name: "Phường Thái Bình, Việt Nam" };
  const result = await loadAdministrativeBoundaries(["TB"], {
    apiKey: "key", aliases: { TB: "tỉnh thái bình" }, strict: false,
    fetchImpl: async url => String(url).startsWith("https:") ? response([ward]) : localFetch(url)
  });
  assert.equal(result.features[0].properties.NAME_1, "TháiBình");
  assert.equal(result.features[0].properties.__data_location, "TB");
  assert.equal(result.features[0].properties.__data_query, "tỉnh thái bình");
  assert.equal(result.features[0].properties.boundary_source, "Local ADM");
});

test("empty or failed MapTiler requests fall back to VNM_ADM; cancellation skips fallback", async () => {
  const controller = new AbortController();
  for (const failure of ["empty", "http", "network"]) {
    const urls = [];
    const resolved = await loadAdministrativeBoundaries(["tỉnh thái bình"], {
      apiKey: "key", fetchImpl: async url => {
        urls.push(String(url));
        if (String(url).startsWith("https:")) {
          if (failure === "network") throw new Error("Provider unavailable");
          return failure === "http" ? { ok: false, status: 503 } : response([]);
        }
        return localFetch(url);
      }
    });
    assert.equal(resolved.features[0].properties.boundary_source, "Local ADM");
    assert.equal(resolved.features[0].properties.NAME_1, "TháiBình");
    assert.equal(urls.length, 2);
    assert.ok(urls[0].startsWith("https://api.maptiler.com/"));
    assert.ok(urls[1].endsWith("/VNM/VNM_ADM1.geojson"));
  }
  await assert.rejects(loadAdministrativeBoundaries(["tỉnh thái bình"], {
    apiKey: "key", strict: false, signal: controller.signal,
    fetchImpl: async url => {
      assert.ok(String(url).startsWith("https://api.maptiler.com/"));
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }
  }), { name: "AbortError" });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { administrativeBoundaryLabel, loadAdministrativeBoundaries } from "../src/administrative-boundaries.js";
import { landOnlyBoundary } from "../src/map-search.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";

const polygon = { type: "Polygon", coordinates: [[[105, 20], [106, 20], [106, 21], [105, 20]]] };
const response = features => ({ ok: true, json: async () => ({ type: "FeatureCollection", features }) });
const localFetch = async url => ({ ok: true, json: async () => JSON.parse(await readFile(url, "utf8")) });
const commune = id => ({ type: "Feature", id, text: "Xã Tân Châu", place_name: "Xã Tân Châu, Việt Nam",
  place_type: ["municipality"], center: [105, 20], geometry: polygon });

test("real GADM files resolve the missing province/district/town, but never a commune as a district", async () => {
  const names = ["tỉnh thái bình", "huyện An Phú", "thị xã Từ Sơn", "xã Tân Châu"];
  const requested = [];
  const boundaries = await loadAdministrativeBoundaries(names, {
    strict: false,
    fetchImpl: async url => { requested.push(String(url)); return localFetch(url); }
  });
  assert.deepEqual(boundaries.matched, names.slice(0, 3));
  assert.deepEqual(boundaries.unmatched, ["xã Tân Châu"]);
  assert.equal(boundaries.matchRate, .75);
  assert.equal(requested.length, 3, "workers share each local file load");
  assert.deepEqual(boundaries.features.map(feature => feature.id), ["gadm.VNM.55_1", "gadm.VNM.1.1_1", "gadm.VNM.5.5_1"]);
  const records = names.map((region, i) => ({ region, date: "2026-09-30", temperature: 25 + i }));
  const joined = joinRecordsToMapTilerBoundaries(records, boundaries, {
    geometry: { field: "region" }, metricField: "temperature"
  }, { filters: { date: "2026-09-30" } });
  assert.deepEqual(joined.features.map(feature => feature.properties.temperature), [25, 26, 27]);
  assert.ok(joined.features.every(feature => feature.properties.boundary_source === "GADM"));
  assert.equal(await landOnlyBoundary(boundaries.features[0], {
    fetchImpl: () => assert.fail("a local GADM polygon must not be clipped again")
  }), boundaries.features[0]);
});

test("real district names use type and province context to disambiguate Tân Châu", async () => {
  const names = ["Tân Châu", "thị xã Tân Châu", "huyện Tân Châu", "Tân Châu, tỉnh An Giang"];
  const boundaries = await loadAdministrativeBoundaries(names, { placeType: "county", strict: false, fetchImpl: localFetch });
  assert.deepEqual(boundaries.unmatched, ["Tân Châu"]);
  assert.equal(boundaries.candidates["Tân Châu"].length, 2);
  assert.deepEqual(boundaries.candidates["Tân Châu"].map(administrativeBoundaryLabel), ["Tân Châu — An Giang", "Tân Châu — Tây Ninh"]);
  assert.deepEqual(boundaries.features.map(feature => feature.id), ["gadm.VNM.1.9_1", "gadm.VNM.53.7_1", "gadm.VNM.1.9_1"]);
});

test("mixed province/commune input uses municipality search, preserving MapTiler province geometry", async () => {
  const urls = [];
  const boundaries = await loadAdministrativeBoundaries(["Hà Nội", "xã Tân Châu"], {
    apiKey: "key", strict: false,
    fetchImpl: async rawUrl => {
      const url = new URL(rawUrl); urls.push(url);
      assert.equal(url.origin, "https://api.maptiler.com", "successful provider results must not load GADM");
      return response(decodeURIComponent(url.pathname).includes("Hà Nội")
        ? [{ id: "region.hanoi", text: "Hà Nội", place_type: ["region"], geometry: polygon }]
        : [commune("municipality.tanchau")]);
    }
  });
  assert.equal(boundaries.matchRate, 1);
  assert.equal(urls[0].searchParams.get("types"), "region");
  assert.ok(urls[1].searchParams.get("types").split(",").includes("municipality"));
  assert.equal(boundaries.features[1].properties.__data_location, "xã Tân Châu");
  assert.equal(boundaries.features[1].properties.__data_place_type, "municipality");
  assert.ok(boundaries.features.every(feature => feature.properties.boundary_source === "MapTiler"));
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
  assert.equal(result.features[0].id, "gadm.VNM.55_1");
  assert.equal(result.features[0].properties.__data_location, "TB");
  assert.equal(result.features[0].properties.__data_query, "tỉnh thái bình");
  assert.equal(result.features[0].properties.boundary_source, "GADM");
});

test("provider failure falls back locally; cancellation never starts a fallback", async () => {
  const controller = new AbortController();
  const resolved = await loadAdministrativeBoundaries(["tỉnh thái bình"], {
    apiKey: "key", fetchImpl: async url => {
      if (String(url).startsWith("https:")) throw new Error("Provider unavailable");
      return localFetch(url);
    }
  });
  assert.equal(resolved.features[0].properties.boundary_source, "GADM");
  await assert.rejects(loadAdministrativeBoundaries(["tỉnh thái bình"], {
    apiKey: "key", strict: false, signal: controller.signal,
    fetchImpl: async url => {
      assert.ok(String(url).startsWith("https:"));
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    }
  }), { name: "AbortError" });
});

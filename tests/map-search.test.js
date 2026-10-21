import assert from "node:assert/strict";
import test from "node:test";
import { buildAdministrativeGeocodingUrl, buildGeocodingUrl, buildProvinceGeocodingUrl, clipBoundaryToLand, createMapSearch, featureCenter, featureLabel, featuresBounds, focusMapOnFeature, focusMapOnFeatures, administrativeLevelForFeature, getMapTilerAdministrativeBoundary, getMapTilerFeature, getMapTilerProvinceBoundary, isBoundaryFeature, isVietnamFeature, landOnlyBoundary, localBoundaryNameAliases, loadMapTilerAdministrativeBoundaries, loadMapTilerProvinceBoundaries, renderSearchBoundary, searchLocalBoundaries, searchMapTiler, searchMapTilerBoundaries } from "../src/map-search.js";
import { WEATHER_PROVINCES } from "./fixtures/weather-34-fixture.js";

test("tolerant administrative loading trả match rate và giữ tên dữ liệu khi dùng alias", async () => {
  const polygon = { type: "Polygon", coordinates: [[[105, 20], [106, 20], [105, 20]]] };
  const fetchImpl = async url => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes("Sai Gon")) return { ok: true, json: async () => ({ features: [{ id: "region.sg", text: "Sai Gon", place_type: ["region"], geometry: polygon }] }) };
    return { ok: true, json: async () => ({ features: [] }) };
  };
  const result = await loadMapTilerAdministrativeBoundaries(["TP HCM", "Không tồn tại"], {
    apiKey: "key", aliases: { "TP HCM": "Sai Gon" }, strict: false, fetchImpl
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.__data_location, "TP HCM");
  assert.deepEqual(result.unmatched, ["Không tồn tại"]);
  assert.equal(result.matchRate, .5);
});

test("mock MapTiler kiểm đủ matched/unmatched trên bộ 34 địa danh", async () => {
  const names = [...WEATHER_PROVINCES];
  const missing = names.at(-1);
  const result = await loadMapTilerAdministrativeBoundaries(names, {
    apiKey: "key",
    strict: false,
    concurrency: 8,
    fetchImpl: async rawUrl => {
      const path = decodeURIComponent(new URL(rawUrl).pathname);
      const name = names.find(candidate => path.includes(`${candidate}, Việt Nam`));
      if (!name || name === missing) return { ok: true, json: async () => ({ features: [] }) };
      return {
        ok: true,
        json: async () => ({ features: [{
          id: `region.${name}`,
          text: name,
          place_name: `${name}, Việt Nam`,
          place_type: ["region"],
          geometry: { type: "Polygon", coordinates: [] }
        }] })
      };
    }
  });
  assert.equal(result.matched.length, 33);
  assert.deepEqual(result.unmatched, [missing]);
  assert.equal(result.features.length, 33);
  assert.equal(result.matchRate, 33 / 34);
});

test("buildGeocodingUrl limits administrative autocomplete to Vietnam", () => {
  const url = new URL(buildGeocodingUrl("Hưng Yên", "test-key", { lng: 105.85, lat: 20.65 }));
  assert.equal(decodeURIComponent(url.pathname), "/geocoding/Hưng Yên.json");
  assert.equal(url.searchParams.get("key"), "test-key");
  assert.equal(url.searchParams.get("language"), "vi");
  assert.equal(url.searchParams.get("country"), "vn");
  assert.match(url.searchParams.get("types"), /region/);
  assert.equal(url.searchParams.get("autocomplete"), "true");
  assert.equal(url.searchParams.get("proximity"), "105.85,20.65");
});

test("searchMapTiler returns GeoJSON suggestions", async () => {
  const expected = [{ id: "region.1", center: [105.85, 20.65], text: "Hưng Yên" }];
  const features = await searchMapTiler("Hưng Yên", {
    apiKey: "key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: expected }) })
  });
  assert.deepEqual(features, expected);
});

test("province lookup requests exact MapTiler region data without local GeoJSON", async () => {
  const url = new URL(buildProvinceGeocodingUrl("Phú Thọ", "test-key"));
  assert.equal(url.searchParams.get("types"), "region");
  assert.equal(url.searchParams.get("autocomplete"), "false");
  assert.match(decodeURIComponent(url.pathname), /Phú Thọ, Việt Nam/);

  const suggestion = { id: "region.2025", text: "Phú Thọ", place_name: "Phú Thọ, Việt Nam", place_type: ["region"], geometry: { type: "Point", coordinates: [105, 21] } };
  const polygon = { id: "region.2025", geometry: { type: "Polygon", coordinates: [[[104, 20], [106, 20], [104, 20]]] }, properties: {} };
  const requested = [];
  const result = await getMapTilerProvinceBoundary("Phú Thọ", {
    apiKey: "key",
    fetchImpl: async rawUrl => {
      const requestedUrl = new URL(rawUrl); requested.push(requestedUrl);
      return requestedUrl.pathname.endsWith("/region.2025.json")
        ? { ok: true, json: async () => ({ features: [polygon] }) }
        : { ok: true, json: async () => ({ features: [suggestion] }) };
    }
  });
  assert.equal(requested.length, 2);
  assert.equal(result.geometry.type, "Polygon");
  assert.equal(result.properties.__data_location, "Phú Thọ");
  assert.equal(result.properties.boundary_source, "MapTiler");
});

test("administrative boundary URL follows the AI-selected place type", () => {
  const url = new URL(buildAdministrativeGeocodingUrl("Ba Đình", "key", "county"));
  assert.equal(url.searchParams.get("types"), "county");
  assert.equal(url.searchParams.get("autocomplete"), "false");
});

test("Quảng provinces match prefixed MapTiler names without losing input locations", async () => {
  const names = ["Quảng Ninh", "Quảng Trị", "Quảng Ngãi"];
  const result = await loadMapTilerProvinceBoundaries(names, {
    apiKey: "key", strict: false,
    fetchImpl: async rawUrl => {
      const path = decodeURIComponent(new URL(rawUrl).pathname);
      const name = names.find(value => path.includes(`${value}, Việt Nam`));
      assert.ok(name);
      return { ok: true, json: async () => ({ features: [{
        id: `region.${name}`, text: `Tỉnh ${name}`, place_name: `Tỉnh ${name}, Việt Nam`,
        place_type: ["region"], geometry: { type: "Polygon", coordinates: [] }
      }] }) };
    }
  });
  assert.deepEqual(result.matched, names);
  assert.deepEqual(result.unmatched, []);
  assert.equal(result.matchRate, 1);
  assert.deepEqual(result.features.map(feature => feature.properties.__data_location), names);
});

test("administrative prefixes handle accents, abbreviations and town labels", async () => {
  const cases = [
    ["tỉnh thái bình", "Thái Bình", "region"],
    ["thủ đô Hà Nội", "Hà Nội", "region"],
    ["TP. Hà Nội", "Hà Nội", "region"],
    ["hanoi city", "Hà Nội", "region"],
    ["xã Tân Châu", "Tân Châu", "county"],
    ["huyện An Phú", "An Phú", "county"],
    ["quận Ba Đình", "Ba Đình", "county"],
    ["thị xã Từ Sơn", "Từ Sơn", "county"],
    ["thị trấn Mê", "Mê", "county"],
    ["phường Ba Đình", "Ba Đình", "county"]
  ];
  for (const [name, text, placeType] of cases) {
    const result = await getMapTilerAdministrativeBoundary(name, {
      apiKey: "key", placeType,
      fetchImpl: async () => ({ ok: true, json: async () => ({ features: [{
        id: `${placeType}.1`, text, place_type: [placeType],
        geometry: { type: "Polygon", coordinates: [] }
      }] }) })
    });
    assert.ok(result, name);
    assert.equal(result.properties.__data_location, name);
  }
});

test("administrative prefixes require a word boundary before the place name", async () => {
  const result = await getMapTilerAdministrativeBoundary("Quảng Trạch", {
    apiKey: "key", placeType: "county",
    fetchImpl: async () => ({ ok: true, json: async () => ({ features: [{
      id: "county.quangtrach", text: "Huyện Quảng Trạch", place_type: ["county"],
      geometry: { type: "Polygon", coordinates: [] }
    }] }) })
  });
  assert.ok(result);

  const unrelated = await getMapTilerProvinceBoundary("gninh", {
    apiKey: "key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ features: [{
      id: "region.quangninh", text: "Quảng Ninh", place_type: ["region"],
      geometry: { type: "Polygon", coordinates: [] }
    }] }) })
  });
  assert.equal(unrelated, null);
});

test("name normalization still requires the requested administrative level and a polygon", async () => {
  const feature = {
    id: "county.anphu", text: "An Phú", place_type: ["county"],
    geometry: { type: "Polygon", coordinates: [] }
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ features: [feature] }) });
  const wrongLevel = await getMapTilerProvinceBoundary("huyện An Phú", { apiKey: "key", fetchImpl });
  assert.equal(wrongLevel, null);
  feature.place_type = ["region"];
  feature.geometry = { type: "Point", coordinates: [105, 20] };
  const noPolygon = await getMapTilerProvinceBoundary("huyện An Phú", { apiKey: "key", fetchImpl });
  assert.equal(noPolygon, null);
});

test("bulk province loader preserves input order", async () => {
  const names = ["Hà Nội", "Hải Phòng"];
  const result = await loadMapTilerProvinceBoundaries(names, {
    apiKey: "key",
    concurrency: 2,
    fetchImpl: async rawUrl => {
      const path = decodeURIComponent(new URL(rawUrl).pathname);
      const name = path.includes("Hà Nội") ? "Hà Nội" : path.includes("Hải Phòng") ? "Hải Phòng" : "";
      if (name) return { ok: true, json: async () => ({ features: [{ id: `region.${name}`, text: name, place_name: `${name}, Việt Nam`, place_type: ["region"], geometry: { type: "Polygon", coordinates: [] } }] }) };
      throw new Error(`Unexpected URL: ${path}`);
    }
  });
  assert.deepEqual(result.features.map(feature => feature.properties.__data_location), names);
});

test("boundary suggestions inspect detail geometry and keep only polygons in search order", async () => {
  const suggestions = [
    { id: "place.city", center: [105, 9], geometry: { type: "Point", coordinates: [105, 9] } },
    { id: "region.province", center: [105, 9], place_name: "Tỉnh Cà Mau, Việt Nam", geometry: { type: "Point", coordinates: [105, 9] } },
    { id: "region.other", center: [103, 22], geometry: { type: "Point", coordinates: [103, 22] } },
    { id: "place.points", center: [105, 9], geometry: { type: "MultiPoint", coordinates: [[105, 9]] } }
  ];
  const geometries = ["Point", "Polygon", "MultiPolygon", "MultiPoint"];
  const requested = [];
  const results = await searchMapTilerBoundaries("Cà Mau", {
    apiKey: "key",
    fetchImpl: async url => {
      const path = decodeURIComponent(new URL(url).pathname);
      requested.push(path);
      const index = suggestions.findIndex(feature => path.endsWith(`/${feature.id}.json`));
      const features = index < 0 ? suggestions : [{ id: suggestions[index].id, geometry: { type: geometries[index], coordinates: [] } }];
      return { ok: true, json: async () => ({ features }) };
    }
  });
  assert.deepEqual(results.map(feature => feature.id), ["region.province", "region.other"]);
  assert.equal(results[0].place_name, "Tỉnh Cà Mau, Việt Nam");
  assert.deepEqual(results[0].center, [105, 9]);
  assert.equal(requested.length, 5);
});

test("boundary suggestions propagate cancellation before returning results", async () => {
  const controller = new AbortController();
  await assert.rejects(searchMapTilerBoundaries("Lai Châu", {
    apiKey: "key", signal: controller.signal,
    fetchImpl: async () => {
      controller.abort();
      return { ok: true, json: async () => ({ features: [] }) };
    }
  }), { name: "AbortError" });
});

test("boundary suggestions report detail API failures instead of an empty list", async () => {
  await assert.rejects(searchMapTilerBoundaries("Lai Châu", {
    apiKey: "key",
    fetchImpl: async url => new URL(url).pathname.endsWith("/region.715.json")
      ? { ok: false, status: 403 }
      : { ok: true, json: async () => ({ features: [{ id: "region.715", geometry: { type: "Point" } }] }) }
  }), { status: 403 });
});

test("getMapTilerFeature requests the full geometry by feature id", async () => {
  const polygon = { id: "region.771", geometry: { type: "Polygon", coordinates: [[[105, 20], [106, 20], [105, 20]]] } };
  let requestedUrl;
  const feature = await getMapTilerFeature("region.771", {
    apiKey: "key",
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return { ok: true, json: async () => ({ type: "FeatureCollection", features: [polygon] }) };
    }
  });
  assert.equal(requestedUrl.pathname, "/geocoding/region.771.json");
  assert.equal(requestedUrl.searchParams.get("language"), "vi");
  assert.deepEqual(feature, polygon);
});

test("clipBoundaryToLand removes MapTiler geometry outside the local GeoJSON land mask", () => {
  const feature = {
    type: "Feature",
    bbox: [0, 0, 4, 4],
    properties: { country_code: "vn" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] }
  };
  const land = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]] } }]
  };
  const clipped = clipBoundaryToLand(feature, land);
  assert.equal(clipped.geometry.type, "MultiPolygon");
  assert.equal(clipped.properties.land_clipped, true);
  assert.deepEqual(clipped.bbox, [0, 0, 2, 4]);
  assert.deepEqual(clipped.geometry.coordinates[0][0], [[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]);
});

test("local GeoJSON mask level follows the MapTiler administrative type", () => {
  assert.equal(administrativeLevelForFeature({ place_type: ["country"] }), 0);
  assert.equal(administrativeLevelForFeature({ place_type: ["region"] }), 1);
  assert.equal(administrativeLevelForFeature({ place_type: ["municipal_district"] }), 2);
  assert.equal(administrativeLevelForFeature({ place_type: ["place"] }), 2);
});

test("landOnlyBoundary loads matching local GeoJSON level and clips a Vietnam boundary", async () => {
  const feature = {
    type: "Feature",
    place_type: ["region"],
    properties: { country_code: "vn" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] }
  };
  const land = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [3, 0], [3, 4], [0, 4], [0, 0]]] } }] };
  let requestedUrl;
  const clipped = await landOnlyBoundary(feature, { fetchImpl: async url => {
    requestedUrl = String(url);
    return { ok: true, json: async () => land };
  } });
  assert.match(requestedUrl, /VNM\/VNM_ADM1\.geojson$/);
  assert.equal(clipped.properties.land_clipped, true);
  assert.equal(clipped.properties.land_mask, "VNM ADM1");
  assert.deepEqual(clipped.bbox, [0, 0, 3, 4]);
});

test("a MapTiler region spanning two old provinces keeps a single merged outline after clipping", async () => {
  const rectangle = (left, right) => ({ type: "Polygon", coordinates: [
    [[left, 0], [right, 0], [right, 3], [left, 3], [left, 0]]
  ] });
  const feature = { type: "Feature", place_type: ["region"],
    properties: { boundary_source: "MapTiler" }, geometry: rectangle(0, 4) };
  const land = { type: "FeatureCollection", features: [0, 2].map(left => ({ type: "Feature",
    properties: {}, geometry: rectangle(left, left + 2) })) };
  const urls = [];
  const clipped = await landOnlyBoundary(feature, {
    country: "VNM", fetchImpl: async url => {
      urls.push(String(url)); return { ok: true, json: async () => land };
    }
  });
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/VNM/VNM_ADM1.geojson"));
  assert.equal(clipped.properties.boundary_source, "MapTiler");
  assert.equal(clipped.properties.land_mask, "VNM ADM1");
  assert.deepEqual(clipped.bbox, [0, 0, 4, 3]);
  assert.equal(clipped.geometry.coordinates.length, 1);
  assert.equal(clipped.geometry.coordinates[0].length, 1, "old province boundaries must not become interior borders");
});

test("Vietnam detection supports properties and MapTiler context", () => {
  assert.equal(isVietnamFeature({ properties: { country_code: "vn" } }), true);
  assert.equal(isVietnamFeature({ context: [{ id: "country.vn", text: "Việt Nam" }] }), true);
  assert.equal(isVietnamFeature({ properties: { country_code: "fr" } }), false);
});

test("landOnlyBoundary keeps boundaries without configured local files unchanged", async () => {
  const feature = { type: "Feature", properties: { country_code: "is" }, geometry: { type: "Polygon", coordinates: [] } };
  assert.equal(await landOnlyBoundary(feature, {
    fetchImpl: () => assert.fail("an unconfigured country must not load local files")
  }), feature);
});

test("renderSearchBoundary adds only the clipped outline and clears its data", () => {
  const sources = new Map();
  const layers = new Map();
  const map = {
    isStyleLoaded: () => true,
    getSource: id => sources.get(id),
    addSource: (id, source) => sources.set(id, { ...source, setData(data) { this.data = data; } }),
    getLayer: id => layers.get(id),
    addLayer: layer => layers.set(layer.id, layer)
  };
  const polygon = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[105, 20], [106, 20], [105, 20]]] }, properties: { land_clipped: true } };
  assert.equal(isBoundaryFeature(polygon), true);
  assert.equal(renderSearchBoundary(map, polygon), true);
  assert.equal(sources.get("map-search-boundary").data.features[0], polygon);
  assert.equal(layers.has("map-search-boundary-fill"), false);
  assert.equal(layers.has("map-search-boundary-line"), true);
  assert.equal(renderSearchBoundary(map, null), false);
  assert.deepEqual(sources.get("map-search-boundary").data.features, []);
});

test("renderSearchBoundary displays multiple selected boundaries", () => {
  const source = { setData(data) { this.data = data; } };
  const map = { isStyleLoaded: () => true, getSource: () => source, getLayer: () => ({}), addSource() {}, addLayer() {} };
  const first = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] } };
  const second = { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[[[2, 2], [3, 2], [2, 2]]]] } };
  assert.equal(renderSearchBoundary(map, [first, null, second]), true);
  assert.deepEqual(source.data.features, [first, second]);
});

test("selection retries boundary rendering on idle after moving the map", async t => {
  const element = () => ({
    value: "", hidden: false, children: [], handlers: {},
    setAttribute() {}, removeAttribute() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, handler) { this.handlers[name] = handler; }
  });
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: get, createElement: element, addEventListener() {} };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const polygon = {
    type: "Feature", id: "region.726", place_type: ["region"], center: [1, 1], bbox: [0, 0, 2, 2],
    properties: { country_code: "vn" },
    geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }
  };
  const requested = [];
  t.mock.method(globalThis, "fetch", async url => {
    requested.push(String(url));
    return { ok: true, json: async () => ({ type: "FeatureCollection", features: [polygon] }) };
  });
  const sources = new Map(); const layers = new Map(); const handlers = {};
  let loaded = true;
  const map = {
    isStyleLoaded: () => loaded, getCenter: () => ({ lng: 1, lat: 1 }),
    fitBounds() { loaded = false; },
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    addSource(id, source) { sources.set(id, { ...source, setData(data) { this.data = data; } }); },
    addLayer(layer) { layers.set(layer.id, layer); },
    on(name, handler) { handlers[name] = handler; }
  };
  const dispose = createMapSearch({ map, apiKey: "key" });
  t.after(dispose);
  get("map-search-input").value = "Lâm Đồng";
  get("map-search-form").handlers.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requested.length, 1);
  assert.ok(requested[0].startsWith("https://api.maptiler.com/"), "search must prefer MapTiler over local ADM");
  const option = get("map-search-results").children[0];
  await option.handlers.click();
  assert.ok(requested.some(url => url.endsWith("/VNM/VNM_ADM1.geojson")), "selection uses VNM_ADM only as its land mask");
  assert.equal(sources.has("map-search-boundary"), false);
  loaded = true;
  handlers.idle();
  assert.equal(sources.get("map-search-boundary").data.features[0].geometry.type, "MultiPolygon");

  // Clicking an already selected result removes only that region.
  await option.handlers.click();
  assert.equal(sources.get("map-search-boundary").data.features.length, 0);

  // Selecting it again updates the existing source.
  await option.handlers.click();
  loaded = true;
  handlers.idle();
  assert.equal(sources.get("map-search-boundary").data.features.length, 1);

  // Clearing all while a render is pending must not restore the old selection.
  await option.handlers.click();
  option.handlers.click();
  get("map-search-clear-all").handlers.click();
  loaded = true;
  handlers.idle();
  assert.equal(sources.get("map-search-boundary").data.features.length, 0);
});

test("feature helpers use MapTiler center and place name", () => {
  const feature = { center: [106, 21], place_name: "Hưng Yên, Việt Nam", text: "Hưng Yên" };
  assert.deepEqual(featureCenter(feature), [106, 21]);
  assert.equal(featureLabel(feature), "Hưng Yên, Việt Nam");
});

test("local GeoJSON fallback finds Vietnamese names without requiring accents or spaces", async () => {
  const polygon = coordinates => ({ type: "Polygon", coordinates: [coordinates] });
  const collections = {
    0: { type: "FeatureCollection", features: [{ type: "Feature", properties: { GID_0: "VNM", COUNTRY: "Vietnam" }, geometry: polygon([[102, 8], [109, 8], [109, 23], [102, 8]]) }] },
    1: { type: "FeatureCollection", features: [{ type: "Feature", properties: { GID_0: "VNM", GID_1: "VNM.35_1", NAME_1: "LâmĐồng", VARNAME_1: "LamDong", NL_NAME_1: "NA", TYPE_1: "Tỉnh" }, geometry: polygon([[107, 11], [108, 11], [108, 12], [107, 11]]) }] },
    2: { type: "FeatureCollection", features: [] }
  };
  const fetchImpl = async url => {
    const level = Number(String(url).match(/VNM_ADM(\d)\.geojson/)?.[1]);
    return { ok: true, json: async () => collections[level] };
  };
  const results = await searchLocalBoundaries("lam dong", { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].text, "Lâm Đồng");
  assert.equal(results[0].properties.local_boundary, true);
  assert.deepEqual(results[0].bbox, [107, 11, 108, 12]);
});

test("local ADM search reads split aliases and skips NA without requesting parent geometry", async () => {
  const feature = { type: "Feature", properties: {
    GID_0: "VNM", GID_1: "VNM.1_1", GID_2: "VNM.1.1_1", NAME_1: "AnGiang", NAME_2: "AnPhú",
    VARNAME_2: "AnPhu|Alternate District;Other Name", NL_NAME_2: "Native Name|NA", TYPE_2: "Huyện"
  }, geometry: { type: "Polygon", coordinates: [[[105, 10], [106, 10], [106, 11], [105, 10]]] } };
  for (const query of ["An Phú", "Alternate District", "Other Name", "Native Name"]) {
    const urls = [];
    const result = await searchLocalBoundaries(query, {
      levels: [2], fetchImpl: async url => {
        urls.push(String(url)); return { ok: true, json: async () => ({ type: "FeatureCollection", features: [feature] }) };
      }
    });
    assert.equal(result.length, 1, query);
    assert.equal(result[0].id, "adm.VNM.1.1_1");
    assert.equal(result[0].text, "An Phú");
    assert.equal(result[0].properties.__province_name, "An Giang");
    assert.equal(result[0].place_name, "An Phú, An Giang, Việt Nam");
    assert.equal(urls.length, 1);
    assert.ok(urls[0].endsWith("/VNM/VNM_ADM2.geojson"));
  }
  assert.ok(!localBoundaryNameAliases(feature).includes("NA"));
  assert.equal(administrativeLevelForFeature(feature), 2);
  assert.equal(isVietnamFeature(feature), true);
});

test("focusMapOnFeature fits the clipped boundary", () => {
  let call;
  const map = { fitBounds: (...args) => { call = args; }, flyTo: () => assert.fail("should not fly") };
  assert.equal(focusMapOnFeature(map, { center: [106, 21], bbox: [105, 20, 107, 22] }), true);
  assert.deepEqual(call[0], [[105, 20], [107, 22]]);
  assert.equal(call[1].maxZoom, 14);
});

test("multiple feature focus fits the combined extent", () => {
  const features = [
    { bbox: [102, 8, 105, 12] },
    { geometry: { type: "Polygon", coordinates: [[[106, 20], [109, 20], [109, 23], [106, 20]]] } }
  ];
  assert.deepEqual(featuresBounds(features), [102, 8, 109, 23]);
  let fitted;
  const map = { fitBounds: bounds => { fitted = bounds; } };
  assert.equal(focusMapOnFeatures(map, features), true);
  assert.deepEqual(fitted, [[102, 8], [109, 23]]);
});

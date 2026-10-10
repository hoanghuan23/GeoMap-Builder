import assert from "node:assert/strict";
import test from "node:test";
import { buildGeocodingUrl, clipBoundaryToLand, featureCenter, featureLabel, focusMapOnFeature, gadmLevelForFeature, getMapTilerFeature, isBoundaryFeature, isVietnamFeature, landOnlyBoundary, renderSearchBoundary, searchMapTiler } from "../src/map-search.js";

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

test("clipBoundaryToLand removes MapTiler geometry outside the GADM land mask", () => {
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

test("GADM mask level follows the MapTiler administrative type", () => {
  assert.equal(gadmLevelForFeature({ place_type: ["country"] }), 0);
  assert.equal(gadmLevelForFeature({ place_type: ["region"] }), 1);
  assert.equal(gadmLevelForFeature({ place_type: ["municipal_district"] }), 2);
  assert.equal(gadmLevelForFeature({ place_type: ["place"] }), 2);
});

test("landOnlyBoundary loads matching GADM level and clips a Vietnam boundary", async () => {
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
  assert.match(requestedUrl, /gadm41_VNM_1\.json$/);
  assert.equal(clipped.properties.land_clipped, true);
  assert.equal(clipped.properties.land_mask, "GADM 4.1 VNM level 1");
  assert.deepEqual(clipped.bbox, [0, 0, 3, 4]);
});

test("Vietnam detection supports properties and MapTiler context", () => {
  assert.equal(isVietnamFeature({ properties: { country_code: "vn" } }), true);
  assert.equal(isVietnamFeature({ context: [{ id: "country.vn", text: "Việt Nam" }] }), true);
  assert.equal(isVietnamFeature({ properties: { country_code: "fr" } }), false);
});

test("landOnlyBoundary keeps non-Vietnam boundaries unchanged", async () => {
  const feature = { type: "Feature", properties: { country_code: "fr" }, geometry: { type: "Polygon", coordinates: [] } };
  assert.equal(await landOnlyBoundary(feature), feature);
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

test("feature helpers use MapTiler center and place name", () => {
  const feature = { center: [106, 21], place_name: "Hưng Yên, Việt Nam", text: "Hưng Yên" };
  assert.deepEqual(featureCenter(feature), [106, 21]);
  assert.equal(featureLabel(feature), "Hưng Yên, Việt Nam");
});

test("focusMapOnFeature fits the clipped boundary", () => {
  let call;
  const map = { fitBounds: (...args) => { call = args; }, flyTo: () => assert.fail("should not fly") };
  assert.equal(focusMapOnFeature(map, { center: [106, 21], bbox: [105, 20, 107, 22] }), true);
  assert.deepEqual(call[0], [[105, 20], [107, 22]]);
  assert.equal(call[1].maxZoom, 14);
});

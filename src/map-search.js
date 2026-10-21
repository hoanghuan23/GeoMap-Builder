import polygonClipping from "polygon-clipping";
import { normalizeDataSearchConfig, resolveDataSearchColumns } from "./data-search-config.js";
import {
  COUNTRY_BOUNDARY_SOURCES, loadCountryBoundaryData, resolveBoundaryCountry
} from "./country-boundary-sources.js";

const MAPTILER_GEOCODING_URL = "https://api.maptiler.com/geocoding";
const VIETNAM_BBOX = "102.14,8.18,109.47,23.4";
const ADMIN_TYPES = "country,region,subregion,county,joint_municipality,joint_submunicipality,municipality,municipal_district,locality,place";
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const SEARCH_BOUNDARY_SOURCE = "map-search-boundary";
const SEARCH_BOUNDARY_LINE = "map-search-boundary-line";
const mapTilerBoundaryCache = new Map();
const mapTilerRegionCache = new Map();

export function normalizePlaceWords(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function normalizePlaceName(value) {
  return normalizePlaceWords(value).replace(/ /g, "");
}

function displayAdministrativeName(value) {
  return String(value || "").replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2").trim();
}

export function buildGeocodingUrl(query, apiKey, center, country = "VNM") {
  const url = new URL(buildAdministrativeGeocodingUrl(query, apiKey, ADMIN_TYPES, country));
  url.pathname = `/geocoding/${encodeURIComponent(query)}.json`;
  url.searchParams.set("types", ADMIN_TYPES);
  url.searchParams.set("limit", "8");
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("fuzzyMatch", "true");
  if (Number.isFinite(center?.lng) && Number.isFinite(center?.lat)) {
    url.searchParams.set("proximity", `${center.lng},${center.lat}`);
  }
  return url.toString();
}

export async function searchMapTiler(query, { apiKey, center, placeType, country = "VNM", signal, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("MAPTILER_API_KEY_MISSING");
  const url = placeType === "country" ? buildAdministrativeGeocodingUrl(query, apiKey, "country")
    : buildGeocodingUrl(query, apiKey, center, country);
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    const error = new Error(`MapTiler geocoding failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data.features) ? data.features : [];
}

export async function getMapTilerFeature(id, { apiKey, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("MAPTILER_API_KEY_MISSING");
  const url = new URL(`${MAPTILER_GEOCODING_URL}/${encodeURIComponent(id)}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "vi");
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    const error = new Error(`MapTiler feature lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return Array.isArray(data.features) ? data.features[0] || null : null;
}

export async function getMapTilerRegion(center, { apiKey, signal, fetchImpl = fetch } = {}) {
  if (!Array.isArray(center) || center.length < 2 || !center.slice(0, 2).every(Number.isFinite)) return null;
  if (!apiKey) throw new Error("MAPTILER_API_KEY_MISSING");
  const coordinates = center.slice(0, 2).join(",");
  if (fetchImpl === fetch && mapTilerRegionCache.has(coordinates)) return mapTilerRegionCache.get(coordinates);
  const url = new URL(`${MAPTILER_GEOCODING_URL}/${coordinates}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "vi");
  url.searchParams.set("types", "region");
  const response = await fetchImpl(url, { signal });
  if (!response.ok) {
    const error = new Error(`MapTiler region lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const region = (data.features || []).find(feature => feature.place_type?.includes("region")) || null;
  if (region && fetchImpl === fetch) mapTilerRegionCache.set(coordinates, region);
  return region;
}

export function isBoundaryFeature(feature) {
  return ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type);
}

export async function searchMapTilerBoundaries(query, options) {
  const features = await searchMapTiler(query, options);
  const candidates = options.candidateFilter ? features.filter(options.candidateFilter) : features;
  const details = await Promise.allSettled(candidates.map(async feature => {
    if (isBoundaryFeature(feature)) return feature;
    if (!feature.id) return null;
    const detail = await getMapTilerFeature(feature.id, options);
    return isBoundaryFeature(detail) ? { ...feature, ...detail,
      properties: { ...(feature.properties || {}), ...(detail.properties || {}) } } : null;
  }));
  if (options.signal?.aborted) throw new DOMException("Search aborted", "AbortError");
  const failed = details.filter(result => result.status === "rejected");
  if (failed.length && failed.length === details.length) throw failed[0].reason;
  return details.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

export function buildAdministrativeGeocodingUrl(name, apiKey, placeType = "region", country = "VNM") {
  const isCountry = placeType === "country";
  const code = isCountry ? resolveBoundaryCountry(name) : null;
  const query = code && String(name).trim().toUpperCase() === code ? COUNTRY_BOUNDARY_SOURCES[code].name : String(name).trim();
  const scope = isCountry ? null : resolveBoundaryCountry(country);
  const countryName = COUNTRY_BOUNDARY_SOURCES[scope]?.name || String(country ?? "").trim();
  const lastPart = query.split(",").at(-1).trim();
  const qualified = !isCountry && countryName && normalizePlaceName(lastPart) !== normalizePlaceName(countryName)
    && (!scope || resolveBoundaryCountry(lastPart) !== scope) ? `${query}, ${countryName}` : query;
  const url = new URL(`${MAPTILER_GEOCODING_URL}/${encodeURIComponent(qualified)}.json`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "vi");
  if (!isCountry) {
    const countryCode = COUNTRY_BOUNDARY_SOURCES[scope]?.aliases.find(alias => /^[a-z]{2}$/i.test(alias));
    if (countryCode) url.searchParams.set("country", countryCode.toLowerCase());
    if (scope === "VNM") url.searchParams.set("bbox", VIETNAM_BBOX);
  }
  url.searchParams.set("types", placeType);
  url.searchParams.set("limit", "5");
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("fuzzyMatch", "true");
  return url.toString();
}

export function buildProvinceGeocodingUrl(name, apiKey) {
  return buildAdministrativeGeocodingUrl(name, apiKey, "region");
}

export function normalizedAdministrativeName(value) {
  // Preserve word boundaries so "quan" does not consume the start of "Quảng".
  const name = normalizePlaceWords(value)
    .replace(/^(?:tinh|thanh pho|tp|thu do|thi xa|thi tran|phuong|xa|quan|huyen)\s+(?=\S)/, "");
  return normalizePlaceName(name);
}

export function administrativeNameAliases(feature) {
  return [feature?.text, feature?.place_name?.split(",")[0], feature?.properties?.name,
    feature?.matching_text, feature?.matching_place_name?.split(",")[0],
    ...Object.entries(feature || {}).filter(([key]) => /^(?:text|place_name)_[a-z]{2}$/i.test(key)).map(([, value]) => String(value).split(",")[0])]
    .filter(value => typeof value === "string" && value.trim());
}

function provinceCandidateScore(feature, name) {
  const target = normalizedAdministrativeName(name);
  const candidates = administrativeNameAliases(feature).map(normalizedAdministrativeName).filter(Boolean);
  if (candidates.includes(target)) return 0;
  if (candidates.some(candidate => candidate.startsWith(target) || target.startsWith(candidate))) return 1;
  return 2;
}

const countryDisplayNames = ["vi", "en"].map(language => new Intl.DisplayNames([language], { type: "region" }));

export function countryCandidateScore(feature, name) {
  if (!feature?.place_type?.includes("country")) return 2;
  const properties = feature.properties || {};
  const code = String(properties.country_code || properties.short_code || feature.country_code || "").toUpperCase();
  const localizedNames = /^[A-Z]{2}$/.test(code) ? countryDisplayNames.map(names => names.of(code)) : [];
  const localCode = resolveBoundaryCountry(properties.__country_code || properties.GID_0 || code)
    || resolveBoundaryCountry(feature.text || feature.place_name);
  const targetCode = resolveBoundaryCountry(name);
  if (targetCode && localCode) return targetCode === localCode ? 0 : 2;
  const aliases = [feature.text, feature.place_name, feature.matching_text, feature.matching_place_name,
    properties.name, code, localCode, COUNTRY_BOUNDARY_SOURCES[localCode]?.name, ...localizedNames,
    ...(COUNTRY_BOUNDARY_SOURCES[localCode]?.aliases || []),
    ...Object.entries(feature).filter(([key]) => /^(?:text|place_name)_[a-z]{2}$/i.test(key)).map(([, value]) => value)]
    .filter(value => typeof value === "string" && value.trim())
    .flatMap(value => [value, value.replace(/\s*\([^)]*\)/g, "").trim(), ...[...value.matchAll(/\(([^)]+)\)/g)].map(match => match[1])])
    .map(normalizePlaceName);
  const target = normalizePlaceName(name);
  return target && aliases.includes(target) ? 0 : 2;
}

export function boundaryMatchesCountry(feature, country) {
  if (!country) return true;
  const contexts = (feature?.context || []).filter(item => item.id?.startsWith("country.") || item.place_type?.includes("country"));
  const properties = feature?.properties || {};
  const code = properties.__country_code || properties.GID_0 || properties.country_code || feature?.country_code;
  if (code) contexts.push({ text: code, properties: { country_code: code } });
  const lastPart = String(feature?.place_name || "").split(",").at(-1).trim();
  if (lastPart && lastPart !== feature?.text) contexts.push({ text: lastPart });
  return !contexts.length || contexts.some(context => countryCandidateScore({ ...context, place_type: ["country"] }, country) === 0);
}

export async function getMapTilerAdministrativeBoundary(name, { apiKey, placeType = "region", country = "VNM", signal, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("MAPTILER_API_KEY_MISSING");
  const normalizedName = placeType === "country" ? resolveBoundaryCountry(name) || normalizePlaceName(name) : normalizedAdministrativeName(name);
  const scope = placeType === "country" ? "global" : resolveBoundaryCountry(country) || normalizePlaceName(country) || "global";
  const cacheKey = `${scope}:${placeType}:${normalizedName}`;
  if (fetchImpl === fetch && mapTilerBoundaryCache.has(cacheKey)) return mapTilerBoundaryCache.get(cacheKey);
  const response = await fetchImpl(buildAdministrativeGeocodingUrl(name, apiKey, placeType, country), { signal });
  if (!response.ok) {
    const error = new Error(`MapTiler administrative lookup failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  const score = placeType === "country" ? countryCandidateScore : provinceCandidateScore;
  const target = placeType === "country" ? name : String(name).split(",")[0];
  const candidates = (data.features || [])
    .filter(feature => feature?.id && (feature.place_type || []).includes(placeType))
    .filter(feature => placeType === "country" || boundaryMatchesCountry(feature, country))
    .sort((a, b) => score(a, target) - score(b, target));
  const candidate = candidates[0];
  if (!candidate || score(candidate, target) > 1) return null;
  if (candidates.some(other => other.id !== candidate.id && score(other, target) === score(candidate, target))) return null;
  const detail = isBoundaryFeature(candidate)
    ? candidate
    : await getMapTilerFeature(candidate.id, { apiKey, signal, fetchImpl });
  if (!isBoundaryFeature(detail) || placeType !== "country" && !boundaryMatchesCountry(detail, country)) return null;
  const boundary = {
    ...candidate,
    ...detail,
    properties: {
      ...(candidate.properties || {}),
      ...(detail.properties || {}),
      __data_location: String(name),
      __data_place_type: placeType,
      boundary_source: "MapTiler"
    }
  };
  if (fetchImpl === fetch) mapTilerBoundaryCache.set(cacheKey, boundary);
  return boundary;
}

export async function getMapTilerProvinceBoundary(name, options = {}) {
  return getMapTilerAdministrativeBoundary(name, { ...options, placeType: "region" });
}

export async function loadMapTilerAdministrativeBoundaries(names, { apiKey, placeType = "region", signal, fetchImpl = fetch, concurrency = 4, onProgress, strict = true, aliases = {} } = {}) {
  const uniqueNames = [...new Set((names || []).map(name => String(name ?? "").trim()).filter(Boolean))];
  const results = new Array(uniqueNames.length);
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < uniqueNames.length) {
      if (signal?.aborted) throw new DOMException("Boundary loading aborted", "AbortError");
      const index = cursor++;
      const sourceName = uniqueNames[index];
      const queryName = String(aliases[sourceName] || sourceName).trim();
      try {
        const boundary = await getMapTilerAdministrativeBoundary(queryName, { apiKey, placeType, signal, fetchImpl });
        results[index] = boundary ? {
          ...boundary,
          properties: { ...(boundary.properties || {}), __data_location: sourceName, __data_query: queryName }
        } : null;
      } catch (error) {
        if (strict || error?.name === "AbortError") throw error;
        results[index] = null;
      }
      completed += 1;
      onProgress?.({ completed, total: uniqueNames.length, name: sourceName });
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), uniqueNames.length) }, worker));
  const missing = uniqueNames.filter((_, index) => !results[index]);
  if (strict && missing.length) throw new Error(`MapTiler không trả về polygon cho: ${missing.join(", ")}`);
  const features = results.filter(Boolean);
  return {
    type: "FeatureCollection",
    features,
    matched: uniqueNames.filter((_, index) => Boolean(results[index])),
    unmatched: missing,
    matchRate: features.length / Math.max(1, uniqueNames.length)
  };
}

export async function loadMapTilerProvinceBoundaries(names, options = {}) {
  return loadMapTilerAdministrativeBoundaries(names, { ...options, placeType: "region" });
}

function asMultiPolygon(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function geometryBounds(coordinates) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    value.forEach(visit);
  };
  visit(coordinates);
  return bounds.every(Number.isFinite) ? bounds : null;
}

function boxesOverlap(a, b) {
  return a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function isVietnamFeature(feature) {
  const candidates = [feature, feature?.properties, ...(feature?.context || [])];
  return candidates.some(value => {
    const countryCode = value?.GID_0 || value?.__country_code || value?.country_code || value?.short_code || value?.COUNTRY;
    return resolveBoundaryCountry(countryCode) === "VNM" || /^country\.(?:vn|vnm)(?:\.|$)/i.test(value?.id || "");
  }) || String(feature?.place_name || "").split(",").some(part => resolveBoundaryCountry(part) === "VNM");
}

export function administrativeLevelForFeature(feature) {
  const properties = feature?.properties || {};
  const level = properties.__admin_level ?? [4, 3, 2, 1, 0].find(level => properties[`GID_${level}`]);
  if (level != null) return Number(level);
  const type = feature?.place_type?.[0];
  if (type === "country") return 0;
  if (["region", "subregion"].includes(type)) return 1;
  return 2;
}

export function localBoundaryNameAliases(feature) {
  const properties = feature?.properties || {};
  const level = administrativeLevelForFeature(feature);
  const code = resolveBoundaryCountry(properties.__country_code || properties.GID_0);
  const source = COUNTRY_BOUNDARY_SOURCES[code];
  const names = [properties[`NAME_${level}`], properties[`VARNAME_${level}`], properties[`NL_NAME_${level}`],
    ...(level === 0 ? [properties.COUNTRY, code, source?.name, ...(source?.aliases || [])] : [])]
    .filter(value => value && String(value).trim().toUpperCase() !== "NA")
    .flatMap(value => String(value).split(/[|;]/)).map(value => value.trim()).filter(value => value && value.toUpperCase() !== "NA");
  const aliases = Object.entries(source?.nameAliases?.[level] || {}).flatMap(([name, aliases]) =>
    names.some(value => normalizePlaceName(value) === normalizePlaceName(name)) ? aliases : []);
  return [...new Set([...names, ...aliases])];
}

export function clipBoundaryToLand(feature, landData, level = 0, country = "VNM") {
  if (!isBoundaryFeature(feature)) return null;
  const boundary = asMultiPolygon(feature.geometry);
  const boundaryBounds = feature.bbox || geometryBounds(feature.geometry.coordinates);
  const landPolygons = (landData?.features || []).flatMap(landFeature =>
    asMultiPolygon(landFeature.geometry).filter(polygon => boxesOverlap(boundaryBounds, geometryBounds(polygon)))
  );
  if (!landPolygons.length) return null;
  const coordinates = polygonClipping.intersection(boundary, landPolygons);
  if (!coordinates.length) return null;
  return {
    ...feature,
    bbox: geometryBounds(coordinates),
    properties: { ...(feature.properties || {}), land_clipped: true, land_mask: `${country} ADM${level}` },
    geometry: { type: "MultiPolygon", coordinates }
  };
}

export async function searchLocalBoundaries(query, {
  country = "VNM", levels = [1, 2, 0], signal, fetchImpl = fetch, limit = 8
} = {}) {
  const parts = String(query ?? "").split(",").map(part => part.trim()).filter(Boolean);
  const queryCountry = resolveBoundaryCountry(query);
  const code = queryCountry || resolveBoundaryCountry(parts.at(-1)) || resolveBoundaryCountry(country);
  if (!code) return [];
  const source = COUNTRY_BOUNDARY_SOURCES[code];
  if (/^(?:xa|phuong|thi tran)\s+(?=\S)/.test(normalizePlaceWords(parts[0]))) return [];
  const needle = normalizedAdministrativeName(parts[0]);
  if (!needle) return [];
  const parents = parts.slice(1).filter(part => !resolveBoundaryCountry(part)).map(normalizedAdministrativeName);
  const requestedLevels = (queryCountry ? [0] : levels).filter(level => source.files[level]);
  const collections = await Promise.all(requestedLevels.map(level => loadCountryBoundaryData(code, level, { fetchImpl, signal })));
  if (signal?.aborted) throw new DOMException("Search aborted", "AbortError");
  const candidates = collections.flatMap((collection, collectionIndex) => (collection.features || []).flatMap(feature => {
    if (!isBoundaryFeature(feature)) return [];
    const level = requestedLevels[collectionIndex];
    const properties = feature.properties || {};
    if (level === 0 && properties.GID_0 && properties.GID_0 !== code) return [];
    const name = level === 0 ? source.name : displayAdministrativeName(properties[`NAME_${level}`]);
    if (!name) return [];
    const aliases = localBoundaryNameAliases({ properties: { ...properties, __admin_level: level, __country_code: code } })
      .map(normalizedAdministrativeName);
    const matchingAliases = aliases.filter(alias => alias.includes(needle));
    if (!matchingAliases.length) return [];
    const bbox = geometryBounds(feature.geometry?.coordinates);
    const center = bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : null;
    const province = level > 1 ? displayAdministrativeName(properties.NAME_1) : "";
    return [{
      ...feature,
      id: `adm.${properties[`GID_${level}`] || `${code}.ADM${level}.${normalizePlaceName(name)}`}`,
      bbox,
      center,
      text: name,
      place_name: level === 0 ? name : [name, province, source.name].filter(Boolean).join(", "),
      place_type: [level === 0 ? "country" : level === 1 ? "region" : "county"],
      properties: { ...properties, __country_code: code,
        __admin_level: level, __province_name: province, local_boundary: true, boundary_source: "Local ADM" },
      _searchScore: Math.min(...matchingAliases.map(alias => alias === needle ? 0 : alias.startsWith(needle) ? 1 : 2))
    }];
  }));
  const ranked = candidates
    .sort((a, b) => a._searchScore - b._searchScore || a.text.localeCompare(b.text, "vi"))
    .slice(0, parents.length ? Infinity : limit);
  if (signal?.aborted) throw new DOMException("Search aborted", "AbortError");
  return ranked.filter(feature => parents.every(parent => parent === normalizedAdministrativeName(feature.properties.__province_name)))
    .slice(0, limit).map(({ _searchScore, ...feature }) => feature);
}

export async function landOnlyBoundary(feature, { fetchImpl = fetch, signal, forceVietnam = false, country } = {}) {
  if (!isBoundaryFeature(feature)) return null;
  if (feature.properties?.local_boundary) return feature;
  const properties = feature.properties || {};
  const featureCountry = properties.__country_code || properties.GID_0 || properties.country_code || properties.short_code;
  // A country polygon determines its own mask; never clip another country to Vietnam.
  const isCountry = feature.place_type?.includes("country");
  const code = isCountry
    ? resolveBoundaryCountry(featureCountry) || resolveBoundaryCountry(feature.text || feature.place_name)
    : resolveBoundaryCountry(featureCountry || country) || (forceVietnam || isVietnamFeature(feature) ? "VNM" : null);
  if (!code) return feature;
  const source = COUNTRY_BOUNDARY_SOURCES[code];
  const requestedLevel = administrativeLevelForFeature(feature);
  const level = source.files[requestedLevel] ? requestedLevel : 0;
  if (!source.files[level]) return feature;
  const landData = await loadCountryBoundaryData(code, level, { fetchImpl, signal });
  if (signal?.aborted) throw new DOMException("Boundary clipping aborted", "AbortError");
  const clipped = clipBoundaryToLand(feature, landData, level, code);
  if (clipped || level === 0) return clipped;

  // The country outline remains a fallback when administrative vintages differ.
  const countryLand = await loadCountryBoundaryData(code, 0, { fetchImpl, signal });
  if (signal?.aborted) throw new DOMException("Boundary clipping aborted", "AbortError");
  return clipBoundaryToLand(feature, countryLand, 0, code);
}

export function renderSearchBoundary(map, feature) {
  if (!map?.isStyleLoaded?.()) return false;
  const boundaries = (Array.isArray(feature) ? feature : [feature]).filter(isBoundaryFeature);
  const hasBoundary = boundaries.length > 0;
  if (!hasBoundary && !map.getSource(SEARCH_BOUNDARY_SOURCE)) return false;
  const data = hasBoundary ? { type: "FeatureCollection", features: boundaries } : EMPTY_FEATURE_COLLECTION;
  if (!map.getSource(SEARCH_BOUNDARY_SOURCE)) map.addSource(SEARCH_BOUNDARY_SOURCE, { type: "geojson", data });
  else map.getSource(SEARCH_BOUNDARY_SOURCE).setData(data);
  if (!map.getLayer(SEARCH_BOUNDARY_LINE)) {
    map.addLayer({
      id: SEARCH_BOUNDARY_LINE,
      type: "line",
      source: SEARCH_BOUNDARY_SOURCE,
      paint: {
        "line-color": "#38bdf8",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.5, 10, 3],
        "line-opacity": .95
      }
    });
  }
  return hasBoundary;
}

export function featuresBounds(features) {
  const boxes = (features || []).map(feature => feature?.bbox || geometryBounds(feature?.geometry?.coordinates)).filter(Boolean);
  if (!boxes.length) return null;
  return boxes.reduce((bounds, box) => [
    Math.min(bounds[0], box[0]), Math.min(bounds[1], box[1]),
    Math.max(bounds[2], box[2]), Math.max(bounds[3], box[3])
  ], [...boxes[0]]);
}

export function focusMapOnFeatures(map, features) {
  const list = (features || []).filter(Boolean);
  if (!list.length) return false;
  const bbox = featuresBounds(list);
  if (!bbox || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return focusMapOnFeature(map, list.at(-1));
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding: { top: 125, right: 70, bottom: 70, left: 70 },
    maxZoom: 14,
    duration: 900
  });
  return true;
}

export function featureCenter(feature) {
  const center = feature?.center || (feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null);
  if (Array.isArray(center) && center.length >= 2 && center.every(Number.isFinite)) return center.slice(0, 2);
  const bounds = featuresBounds([feature]);
  return bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] : null;
}

export function featureLabel(feature) {
  return feature?.place_name || feature?.text || "Địa điểm chưa có tên";
}

export function focusMapOnFeature(map, feature) {
  const center = featureCenter(feature);
  const bbox = featuresBounds([feature]);
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite) && bbox[0] < bbox[2] && bbox[1] < bbox[3]) {
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 105, right: 60, bottom: 60, left: 60 },
      maxZoom: 14,
      duration: 900
    });
    return true;
  }
  if (!center) return false;
  const type = feature?.place_type?.[0];
  const zoomByType = { country: 5, region: 7, subregion: 8, county: 9, municipality: 10, municipal_district: 11, locality: 12, place: 12 };
  map.flyTo({ center, zoom: zoomByType[type] || 10, duration: 900, essential: true });
  return true;
}

function dataSearchValue(value) {
  return ["string", "number", "boolean"].includes(typeof value) ? String(value).trim() : "";
}

function dataSearchEntityKey(properties, fields) {
  const primary = dataSearchValue(properties?.[fields[0].name]);
  if (!primary) return null;
  const context = fields[0].role === "id" ? [] : fields.slice(1).filter(column => column.role === "geo");
  return JSON.stringify([primary, ...context.map(column => dataSearchValue(properties?.[column.name]))]);
}

/** Index only uploaded fields. AI supplies defaults; filtering never calls AI/geocoding. */
export function buildDataSearchIndex({ data, columns = [], titleField, chartType, search_bar, search_fields,
  filtered = false, sourceRecords, minFilteredObjects = 5 } = {}) {
  const config = normalizeDataSearchConfig({ ...(search_bar === undefined ? {} : { search_bar }),
    ...(search_fields === undefined ? {} : { search_fields }) }, columns);
  const fields = resolveDataSearchColumns({ columns, titleField, chartType, search_fields: config.search_fields });
  if (!fields.length) return { entries: [], fields: [], uniqueCount: 0, enabled: false, placeholder: "Tìm trong dữ liệu đã tải lên..." };
  const primary = fields[0];
  const entries = (data?.features || []).flatMap(feature => {
    if (!featureCenter(feature)) return [];
    const properties = feature.properties || {};
    const entityKey = dataSearchEntityKey(properties, fields);
    if (!entityKey) return [];
    const values = fields.flatMap(column => {
      const value = dataSearchValue(properties[column.name]);
      return value ? [{ column, value }] : [];
    });
    const label = values[0].value;
    const aliases = values.flatMap(({ column, value }) => {
      if (column.geoLevel !== "country") return [value];
      const code = resolveBoundaryCountry(value);
      const source = COUNTRY_BOUNDARY_SOURCES[code];
      return [value, code, source?.name, ...(source?.aliases || [])].filter(Boolean);
    });
    const terms = [...new Set(aliases.map(normalizePlaceName).filter(Boolean))];
    if (!terms.length) return [];
    const subtitle = values.filter(item => item.value !== label).slice(0, 2)
      .map(item => `${item.column.labelVi || item.column.name}: ${item.value}`).join(" · ") || primary.labelVi || primary.name;
    return [{ feature, label, subtitle, terms, entityKey }];
  });
  const uniqueCount = new Set(entries.map(entry => entry.entityKey)).size;
  const totalCount = Array.isArray(sourceRecords)
    ? new Set(sourceRecords.map(record => dataSearchEntityKey(record, fields)).filter(Boolean)).size : null;
  const reducedByFilter = filtered && (totalCount == null || uniqueCount < totalCount);
  const enabled = config.search_bar !== false && uniqueCount > 0
    && (!reducedByFilter || uniqueCount >= minFilteredObjects);
  const name = primary.geoLevel === "country" ? "quốc gia" : (primary.labelVi || primary.name).toLocaleLowerCase("vi");
  return { entries, fields: fields.map(column => column.name), uniqueCount, enabled, placeholder: `Tìm ${name} trong dữ liệu...` };
}

export function searchDataIndex(index, query, limit = 8) {
  const needle = normalizePlaceName(query);
  if (!needle) return [];
  const score = entry => entry.terms.some(term => term === needle) ? 0
    : entry.terms.some(term => term.startsWith(needle)) ? 1 : 2;
  return (index?.entries || []).filter(entry => entry.terms.some(term => term.includes(needle)))
    .sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label, "vi"))
    .slice(0, limit);
}

export function createMapSearch({ map, onSelect = null, minFilteredObjects = 5 }) {
  const root = document.getElementById("map-search");
  const form = document.getElementById("map-search-form");
  const input = document.getElementById("map-search-input");
  const results = document.getElementById("map-search-results");
  const clearButton = document.getElementById("map-search-clear");
  if (!root || !form || !input || !results || !clearButton) return { setData() {}, destroy() {} };

  let index = { entries: [] };
  let matches = [];
  let activeIndex = -1;
  let snapshot;

  const setOpen = open => {
    results.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    if (!open) input.removeAttribute("aria-activedescendant");
  };
  const reset = () => {
    input.value = "";
    clearButton.hidden = true;
    matches = [];
    activeIndex = -1;
    results.replaceChildren();
    setOpen(false);
  };
  const setActive = next => {
    const options = [...results.querySelectorAll(".map-search-result")];
    if (!options.length) return;
    activeIndex = (next + options.length) % options.length;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    input.setAttribute("aria-activedescendant", options[activeIndex].id);
    options[activeIndex].scrollIntoView({ block: "nearest" });
  };
  const choose = entry => {
    if (!entry || root.hidden || !index.entries.includes(entry)) return;
    input.value = entry.label;
    clearButton.hidden = false;
    setOpen(false);
    focusMapOnFeature(map, entry.feature);
    onSelect?.(entry.feature, featureCenter(entry.feature));
  };
  const runSearch = () => {
    if (root.hidden) return;
    clearButton.hidden = !input.value;
    matches = searchDataIndex(index, input.value);
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    results.replaceChildren();
    if (!normalizePlaceName(input.value)) { setOpen(false); return; }
    if (!matches.length) {
      const message = document.createElement("div");
      message.className = "map-search-message";
      message.textContent = "Không tìm thấy dữ liệu phù hợp với bộ lọc hiện tại.";
      results.append(message);
    }
    matches.forEach((entry, position) => {
      const button = document.createElement("button");
      const icon = document.createElement("span");
      const copy = document.createElement("span");
      const title = document.createElement("b");
      const subtitle = document.createElement("small");
      button.type = "button";
      button.id = `map-search-result-${position}`;
      button.className = "map-search-result";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      icon.className = "map-search-result-icon";
      icon.textContent = "⌖";
      title.textContent = entry.label;
      subtitle.textContent = entry.subtitle;
      copy.append(title, subtitle);
      button.append(icon, copy);
      button.addEventListener("mouseenter", () => setActive(position));
      button.addEventListener("click", () => choose(entry));
      results.append(button);
    });
    setOpen(true);
  };
  const keydown = event => {
    if (root.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.hidden) runSearch();
      setActive(activeIndex < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1)
        : activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runSearchIfClosed();
      choose(matches[activeIndex >= 0 ? activeIndex : 0]);
    } else if (event.key === "Escape") {
      setOpen(false);
      input.blur();
    }
  };
  const runSearchIfClosed = () => { if (results.hidden) runSearch(); };
  const submit = event => {
    event.preventDefault();
    runSearchIfClosed();
    choose(matches[activeIndex >= 0 ? activeIndex : 0]);
  };
  const clear = () => { reset(); input.focus(); };
  const outside = event => { if (!root.contains(event.target)) setOpen(false); };
  const listeners = [
    [input, "input", runSearch], [input, "focus", runSearch], [input, "keydown", keydown],
    [form, "submit", submit], [clearButton, "click", clear], [document, "pointerdown", outside]
  ];
  listeners.forEach(([element, event, handler]) => element.addEventListener(event, handler));
  root.hidden = true;
  input.disabled = true;
  reset();

  return {
    setData(next = {}) {
      const keys = ["data", "columns", "titleField", "chartType", "search_bar", "search_fields", "filtered", "sourceRecords"];
      if (snapshot && keys.every(key => snapshot[key] === next[key])) return;
      snapshot = { ...next };
      index = buildDataSearchIndex({ ...next, minFilteredObjects });
      reset();
      root.hidden = !index.enabled;
      input.disabled = root.hidden;
      input.placeholder = index.placeholder;
      input.setAttribute("aria-label", index.placeholder.replace(/\.\.\.$/, ""));
    },
    destroy() {
      listeners.forEach(([element, event, handler]) => element.removeEventListener(event, handler));
      index = { entries: [] };
      reset();
      root.hidden = true;
      input.disabled = true;
    }
  };
}

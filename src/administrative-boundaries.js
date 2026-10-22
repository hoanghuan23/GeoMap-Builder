import {
  administrativeNameAliases, boundaryMatchesCountry, countryCandidateScore, getMapTilerAdministrativeBoundary, getMapTilerRegion, isBoundaryFeature, normalizedAdministrativeName,
  localBoundaryNameAliases, normalizePlaceName, normalizePlaceWords, searchLocalBoundaries, searchMapTilerBoundaries
} from "./map-search.js";
import { COUNTRY_BOUNDARY_SOURCES, resolveBoundaryCountry } from "./country-boundary-sources.js";

function provinceName(feature) {
  const region = feature.context?.find(item => item.id?.startsWith("region.") || item.place_type?.includes("region"));
  return feature.properties?.__province_name
    || feature.properties?.NAME_1 || region?.text || "";
}

export function administrativeBoundaryLabel(feature) {
  const name = feature.text || feature.place_name?.split(",")[0] || "Địa danh chưa có tên";
  if (feature.place_type?.includes("country")) return name;
  const province = String(provinceName(feature)).replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")
    .replace(/^(?:tỉnh|thành\s*phố|tp\.?)\s+/iu, "").trim();
  if (!province) return `${name} — Chưa rõ tỉnh/thành`;
  return normalizedAdministrativeName(name) === normalizePlaceName(province) ? name : `${name} — ${province}`;
}

async function describeCandidates(features, options) {
  return Promise.all(features.map(async feature => {
    if (feature.place_type?.includes("country") || provinceName(feature) || !options.apiKey) return feature;
    const center = feature.center || (feature.bbox && [(feature.bbox[0] + feature.bbox[2]) / 2, (feature.bbox[1] + feature.bbox[3]) / 2]);
    try {
      const region = await getMapTilerRegion(center, options);
      if (!region?.text) return feature;
      return { ...feature, properties: { ...(feature.properties || {}), __province_name: region.text } };
    } catch (error) {
      if (error?.name === "AbortError" || options.signal?.aborted) throw error;
      return feature;
    }
  }));
}

function administrativeQuery(value, placeType, country) {
  const [label, ...context] = String(value ?? "").split(",");
  const words = normalizePlaceWords(label);
  const prefix = /^(tinh|thanh pho|tp|thu do|thi xa|thi tran|phuong|xa|quan|huyen)\s+(?=\S)/.exec(words);
  const type = prefix?.[1].replace(/ /g, "");
  const kind = type === "tinh" ? "region"
    : ["thanhpho", "tp", "thudo"].includes(type) ? "city"
    : ["huyen", "quan", "thixa"].includes(type) ? "district"
    : ["xa", "phuong", "thitran"].includes(type) ? "commune" : null;
  return {
    name: normalizePlaceName(placeType === "country" ? resolveBoundaryCountry(label) || label : prefix ? words.slice(prefix[0].length) : label),
    kind, type, placeType,
    parents: context.filter(part => !resolveBoundaryCountry(part) && normalizePlaceName(part) !== normalizePlaceName(country))
      .map(normalizedAdministrativeName).filter(Boolean)
  };
}

function mapTilerScore(feature, query, allowAlternateLevel = false) {
  if (query.placeType === "country") return countryCandidateScore(feature, query.name);
  const label = feature.text || feature.place_name?.split(",")[0] || feature.properties?.name;
  const candidate = administrativeQuery(label, feature.place_type?.[0]);
  if (query.kind && candidate.kind && query.kind !== candidate.kind
    && !(query.kind === "region" && candidate.kind === "city" && feature.place_type?.includes("region"))) return 2;
  if (["district", "commune"].includes(query.kind) && candidate.type && query.type !== candidate.type) return 2;
  const allowedTypes = query.kind === "commune" ? ["municipality", "municipal_district", "joint_submunicipality", "locality"]
    : query.kind === "district" ? ["county", "subregion", "joint_municipality", "municipality", "municipal_district"]
    : query.kind === "city" || allowAlternateLevel ? ["region", "subregion", "county", "joint_municipality", "municipality", "municipal_district", "place"] : [query.placeType];
  if (!(feature.place_type || []).some(type => allowedTypes.includes(type))) return 2;
  if (feature.properties?.kind === "virtual_place" || allowAlternateLevel && candidate.kind === "commune") return 2;
  const parents = [provinceName(feature), ...(feature.place_name || "").split(",").slice(1),
    ...(feature.context || []).flatMap(item => [item.text, ...administrativeNameAliases(item)])].map(normalizedAdministrativeName);
  if (!query.parents.every(parent => parents.includes(parent))) return 2;
  if (!query.name) return 2;
  const aliases = administrativeNameAliases(feature).map(normalizedAdministrativeName).filter(Boolean);
  if (aliases.includes(query.name)) return 0;
  return aliases.some(name => name.startsWith(query.name) || query.name.startsWith(name)) ? 1 : 2;
}

function withSource(feature, name, source) {
  return { ...feature, properties: {
    ...(feature.properties || {}), __data_location: name,
    __data_place_type: feature.place_type?.[0], boundary_source: source
  } };
}

async function localCandidates(name, query, options) {
  // Only configured ADM levels are available; communes must never match ADM2 districts.
  if (!query.name || query.kind === "commune") return [];
  const countryName = resolveBoundaryCountry(name);
  const levels = countryName || query.placeType === "country" ? [0] : query.kind === "region" ? [1] : query.kind === "district" ? [2]
    : query.kind === "city" ? [1, 2]
    : ["region", "subregion"].includes(query.placeType) ? [1] : [2];
  const expectedType = query.kind === "city" ? "thanhpho" : query.type;
  const matches = candidates => candidates.filter(feature => {
    if (!isBoundaryFeature(feature)) return false;
    const properties = feature.properties || {};
    const level = properties.__admin_level;
    if (expectedType && normalizePlaceName(properties[`TYPE_${level}`]) !== expectedType) return false;
    return localBoundaryNameAliases(feature).map(normalizedAdministrativeName).includes(query.name)
      && query.parents.every(parent => parent === normalizedAdministrativeName(properties.NAME_1));
  }).map(feature => withSource(feature, name, "Local ADM"));
  const preferred = matches(await searchLocalBoundaries(name, { ...options, levels, limit: Infinity }));
  if (preferred.length || query.kind || query.placeType === "country" || resolveBoundaryCountry(options.country) === "VNM") return preferred;
  // Administrative levels differ by country. Try configured levels until an exact name is found.
  const source = COUNTRY_BOUNDARY_SOURCES[resolveBoundaryCountry(options.country)];
  for (const level of Object.keys(source?.files || {}).map(Number).filter(level => level > 0 && !levels.includes(level)).sort((a, b) => a - b)) {
    const found = matches(await searchLocalBoundaries(name, { ...options, levels: [level], limit: Infinity }));
    if (found.length) return found;
  }
  return [];
}

async function resolveCandidates(name, { apiKey, placeType, country, signal, fetchImpl }) {
  const requestedCountry = placeType === "country";
  const lookupCountry = requestedCountry ? null : country === undefined
    ? resolveBoundaryCountry(String(name).split(",").at(-1)) || "VNM" : country;
  const code = requestedCountry ? resolveBoundaryCountry(name) : resolveBoundaryCountry(lookupCountry);
  const cityState = !requestedCountry && COUNTRY_BOUNDARY_SOURCES[code]?.cityState
    && resolveBoundaryCountry(String(name).split(",")[0]) === code;
  const isCountry = requestedCountry || cityState;
  const effectivePlaceType = isCountry ? "country" : placeType;
  // MapTiler autocomplete returns point-only places for this abbreviated province name.
  const providerName = code === "VNM" && placeType === "region" && normalizePlaceWords(name) === "tp ho chi minh"
    ? "Hồ Chí Minh" : name;
  const query = administrativeQuery(providerName, effectivePlaceType, lookupCountry);
  // Provider lookup works for every country; local files are an optional fallback.
  if (apiKey) {
    try {
      let candidates;
      const narrowLookup = isCountry || !query.parents.length && (!query.kind || query.kind === "region");
      if (narrowLookup) {
        const boundary = await getMapTilerAdministrativeBoundary(cityState ? COUNTRY_BOUNDARY_SOURCES[code].name : providerName, { apiKey, country: lookupCountry,
          placeType: query.kind === "region" ? "region" : effectivePlaceType, signal, fetchImpl });
        candidates = boundary ? [boundary] : [];
      } else {
        // Use the same administrative search as the search bar for explicit district/commune names.
        candidates = await searchMapTilerBoundaries(providerName, { apiKey, country: lookupCountry, signal, fetchImpl });
      }
      if (query.parents.length) {
        candidates = await describeCandidates(candidates.filter(feature => mapTilerScore(feature, { ...query, parents: [] }, !query.kind && !isCountry) < 2), { apiKey, signal, fetchImpl });
      }
      const ranked = candidates.filter(feature => isCountry || boundaryMatchesCountry(feature, lookupCountry))
        .map(feature => ({ feature, score: mapTilerScore(feature, query) }));
      const bestScore = Math.min(2, ...ranked.map(item => item.score));
      if (bestScore < 2) {
        return [...new Map(ranked.filter(item => item.score === bestScore)
          .map(({ feature }) => [feature.id, withSource(feature, name, "MapTiler")])).values()];
      }
      if (!isCountry && !query.kind) {
        let alternatives = candidates;
        if (narrowLookup) alternatives = await searchMapTilerBoundaries(providerName, { apiKey, country: lookupCountry, signal, fetchImpl,
          candidateFilter: feature => boundaryMatchesCountry(feature, lookupCountry) && mapTilerScore(feature, query, true) === 0 });
        const exact = alternatives.filter(feature => boundaryMatchesCountry(feature, lookupCountry) && mapTilerScore(feature, query, true) === 0);
        if (exact.length) return [...new Map(exact.map(feature => [feature.id, withSource(feature, name, "MapTiler")])).values()];
      }
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      // Keep local ADM files available when the provider is unavailable.
    }
  }
  return code ? localCandidates(name, query, { country: code, signal, fetchImpl }) : [];
}

export async function loadAdministrativeBoundaries(names, {
  apiKey, placeType = "region", country, signal, fetchImpl = fetch, concurrency = 4,
  onProgress, strict = true, aliases = {}, selections = {}, contexts = {}
} = {}) {
  const uniqueNames = [...new Set((names || []).map(name => String(name ?? "").trim()).filter(Boolean))];
  const results = new Array(uniqueNames.length);
  const candidates = {};
  // Share local file loads across workers, including when a custom fetch implementation is used.
  const localFiles = new Map();
  const sharedFetch = (url, options) => {
    if (!/\.geojson(?:$|\?)/i.test(String(url))) return fetchImpl(url, options);
    const key = String(url);
    if (!localFiles.has(key)) localFiles.set(key, Promise.resolve(fetchImpl(url, options)).then(async response => {
      const data = response.ok ? await response.json() : null;
      return { ok: response.ok, status: response.status, json: async () => data };
    }));
    return localFiles.get(key);
  };
  let cursor = 0; let completed = 0;
  const worker = async () => {
    while (cursor < uniqueNames.length) {
      if (signal?.aborted) throw new DOMException("Boundary loading aborted", "AbortError");
      const index = cursor++;
      const sourceName = uniqueNames[index];
      const queryName = String(aliases[sourceName] || sourceName).trim();
      const locationCountry = Object.hasOwn(contexts[sourceName] || {}, "country") ? contexts[sourceName].country : country;
      try {
        const selected = selections[sourceName];
        const matches = isBoundaryFeature(selected) ? [selected]
          : await resolveCandidates(queryName, { apiKey, placeType, country: locationCountry, signal, fetchImpl: fetchImpl === fetch ? fetch : sharedFetch });
        if (signal?.aborted) throw new DOMException("Boundary loading aborted", "AbortError");
        if (matches.length === 1) results[index] = { ...matches[0], properties: {
          ...(matches[0].properties || {}), __data_location: sourceName, __data_query: queryName,
          ...(locationCountry ? { __data_country: locationCountry } : {})
        } };
        else if (matches.length > 1) candidates[sourceName] = await describeCandidates(matches, {
          apiKey, signal, fetchImpl: fetchImpl === fetch ? fetch : sharedFetch
        });
      } catch (error) {
        if (strict || error?.name === "AbortError" || signal?.aborted) throw error;
      }
      completed += 1;
      onProgress?.({ completed, total: uniqueNames.length, name: sourceName });
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), uniqueNames.length) }, worker));
  const unmatched = uniqueNames.filter((_, index) => !results[index]);
  if (strict && unmatched.length) throw new Error(`Chưa tìm được ranh giới duy nhất cho: ${unmatched.join(", ")}`);
  const features = results.filter(Boolean);
  return { type: "FeatureCollection", features, candidates, unmatched,
    matched: uniqueNames.filter((_, index) => Boolean(results[index])),
    matchRate: features.length / Math.max(1, uniqueNames.length) };
}

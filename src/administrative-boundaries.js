import {
  getMapTilerAdministrativeBoundary, getMapTilerRegion, isBoundaryFeature, normalizedAdministrativeName,
  normalizePlaceName, normalizePlaceWords, searchGadmBoundaries, searchMapTilerBoundaries
} from "./map-search.js";

function provinceName(feature) {
  const region = feature.context?.find(item => item.id?.startsWith("region.") || item.place_type?.includes("region"));
  return feature.properties?.__province_name || feature.properties?.NAME_1 || region?.text || "";
}

export function administrativeBoundaryLabel(feature) {
  const name = feature.text || feature.place_name?.split(",")[0] || "Địa danh chưa có tên";
  const province = String(provinceName(feature)).replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2")
    .replace(/^(?:tỉnh|thành\s*phố|tp\.?)\s+/iu, "").trim();
  if (!province) return `${name} — Chưa rõ tỉnh/thành`;
  return normalizedAdministrativeName(name) === normalizePlaceName(province) ? name : `${name} — ${province}`;
}

async function describeCandidates(features, options) {
  return Promise.all(features.map(async feature => {
    if (provinceName(feature) || !options.apiKey) return feature;
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

function administrativeQuery(value, placeType) {
  const [label, ...context] = String(value ?? "").split(",");
  const words = normalizePlaceWords(label);
  const prefix = /^(tinh|thanh pho|tp|thu do|thi xa|thi tran|phuong|xa|quan|huyen)\s+(?=\S)/.exec(words);
  const type = prefix?.[1].replace(/ /g, "");
  const kind = type === "tinh" ? "region"
    : ["thanhpho", "tp", "thudo"].includes(type) ? "city"
    : ["huyen", "quan", "thixa"].includes(type) ? "district"
    : ["xa", "phuong", "thitran"].includes(type) ? "commune" : null;
  return {
    name: normalizePlaceName(prefix ? words.slice(prefix[0].length) : label),
    kind, type, placeType,
    parents: context.map(normalizedAdministrativeName).filter(name => name && !["vietnam", "viet nam", "vn"].includes(name))
  };
}

function mapTilerScore(feature, query) {
  const label = feature.text || feature.place_name?.split(",")[0] || feature.properties?.name;
  const candidate = administrativeQuery(label, feature.place_type?.[0]);
  if (query.kind && candidate.kind && query.kind !== candidate.kind
    && !(query.kind === "region" && candidate.kind === "city" && feature.place_type?.includes("region"))) return 2;
  if (["district", "commune"].includes(query.kind) && candidate.type && query.type !== candidate.type) return 2;
  const allowedTypes = query.kind === "commune" ? ["municipality", "municipal_district", "joint_submunicipality", "locality"]
    : query.kind === "district" ? ["county", "subregion", "joint_municipality", "municipality", "municipal_district"]
    : query.kind === "city" ? ["region", "county", "municipality", "place"] : [query.placeType];
  if (!(feature.place_type || []).some(type => allowedTypes.includes(type))) return 2;
  const context = normalizePlaceName([feature.place_name, provinceName(feature), ...(feature.context || []).map(item => item.text)].join(" "));
  if (!query.parents.every(parent => context.includes(parent))) return 2;
  if (!query.name || !candidate.name) return 2;
  if (candidate.name === query.name) return 0;
  return candidate.name.startsWith(query.name) || query.name.startsWith(candidate.name) ? 1 : 2;
}

function withSource(feature, name, source) {
  return { ...feature, properties: {
    ...(feature.properties || {}), __data_location: name,
    __data_place_type: feature.place_type?.[0], boundary_source: source
  } };
}

async function gadmCandidates(name, query, options) {
  // The bundled GADM data ends at level 2; a commune must not match a district of the same name.
  if (!query.name || query.kind === "commune") return [];
  const levels = query.kind === "region" ? [1] : query.kind === "district" ? [2]
    : query.kind === "city" ? [1, 2] : query.placeType === "country" ? [0]
    : ["region", "subregion"].includes(query.placeType) ? [1] : [2];
  const expectedType = query.kind === "city" ? "thanhpho" : query.type;
  const candidates = await searchGadmBoundaries(query.name, { ...options, limit: Infinity });
  return candidates.filter(feature => {
    if (!isBoundaryFeature(feature)) return false;
    const properties = feature.properties || {};
    const level = properties.GID_2 ? 2 : properties.GID_1 ? 1 : 0;
    if (!levels.includes(level)) return false;
    if (expectedType && normalizePlaceName(properties[`TYPE_${level}`]) !== expectedType) return false;
    const aliases = [properties[`NAME_${level}`], properties[`VARNAME_${level}`], properties[`NL_NAME_${level}`], level === 0 && properties.COUNTRY]
      .filter(value => value && value !== "NA").flatMap(value => String(value).split(/[|;]/)).map(normalizePlaceName);
    return aliases.includes(query.name) && query.parents.every(parent => parent === normalizePlaceName(properties.NAME_1));
  }).map(feature => withSource(feature, name, "GADM"));
}

async function resolveCandidates(name, { apiKey, placeType, signal, fetchImpl }) {
  const query = administrativeQuery(name, placeType);
  if (apiKey) {
    try {
      let candidates;
      if (!query.parents.length && (!query.kind || query.kind === "region")) {
        const boundary = await getMapTilerAdministrativeBoundary(name, { apiKey, placeType: query.kind === "region" ? "region" : placeType, signal, fetchImpl });
        candidates = boundary ? [boundary] : [];
      } else {
        // Use the same administrative search as the search bar for explicit district/commune names.
        candidates = await searchMapTilerBoundaries(name, { apiKey, signal, fetchImpl });
      }
      if (query.parents.length) {
        candidates = await describeCandidates(candidates.filter(feature => mapTilerScore(feature, { ...query, parents: [] }) < 2), { apiKey, signal, fetchImpl });
      }
      const ranked = candidates.map(feature => ({ feature, score: mapTilerScore(feature, query) }));
      const bestScore = Math.min(2, ...ranked.map(item => item.score));
      if (bestScore < 2) {
        return [...new Map(ranked.filter(item => item.score === bestScore)
          .map(({ feature }) => [feature.id, withSource(feature, name, "MapTiler")])).values()];
      }
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      // Local boundaries can still resolve the name when the provider is unavailable.
    }
  }
  return gadmCandidates(name, query, { signal, fetchImpl });
}

export async function loadAdministrativeBoundaries(names, {
  apiKey, placeType = "region", signal, fetchImpl = fetch, concurrency = 4,
  onProgress, strict = true, aliases = {}, selections = {}
} = {}) {
  const uniqueNames = [...new Set((names || []).map(name => String(name ?? "").trim()).filter(Boolean))];
  const results = new Array(uniqueNames.length);
  const candidates = {};
  // Share local file loads across workers, including when a custom fetch implementation is used.
  const localFiles = new Map();
  const sharedFetch = (url, options) => {
    if (!/gadm41_VNM_[012]\.json(?:$|\?)/.test(String(url))) return fetchImpl(url, options);
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
      try {
        const selected = selections[sourceName];
        const matches = isBoundaryFeature(selected) ? [selected]
          : await resolveCandidates(queryName, { apiKey, placeType, signal, fetchImpl: fetchImpl === fetch ? fetch : sharedFetch });
        if (signal?.aborted) throw new DOMException("Boundary loading aborted", "AbortError");
        if (matches.length === 1) results[index] = { ...matches[0], properties: {
          ...(matches[0].properties || {}), __data_location: sourceName, __data_query: queryName
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

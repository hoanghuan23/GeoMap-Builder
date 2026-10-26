import countries from "../administrative_division/COUNTRY_REGIONS/country_regions.json" with { type: "json" };
import { COUNTRY_BOUNDARY_SOURCES, countryLookupName } from "./country-boundary-sources.js";

const REGION_LABELS = {
  Africa: "Châu Phi", Americas: "Châu Mỹ", Asia: "Châu Á", Europe: "Châu Âu", Oceania: "Châu Đại Dương",
  "South-eastern Asia": "Đông Nam Á", "Eastern Asia": "Đông Á", "Southern Asia": "Nam Á",
  "Central Asia": "Trung Á", "Western Asia": "Tây Á", "Northern Europe": "Bắc Âu",
  "Southern Europe": "Nam Âu", "Western Europe": "Tây Âu", "Eastern Europe": "Đông Âu",
  "Northern Africa": "Bắc Phi", "Sub-Saharan Africa": "Châu Phi hạ Sahara",
  "Northern America": "Bắc Mỹ", "Latin America and the Caribbean": "Mỹ Latinh và Caribe",
  "Australia and New Zealand": "Úc và New Zealand", Melanesia: "Melanesia", Micronesia: "Micronesia", Polynesia: "Polynesia"
};

export const COUNTRY_REGION_CATALOG = Object.freeze(["subregion", "region"].flatMap(level =>
  [...new Set(countries.map(country => country[level]).filter(Boolean))].map(name =>
    Object.freeze({ id: `${level}:${name}`, level, name, label: REGION_LABELS[name] || name }))));
const regionById = new Map(COUNTRY_REGION_CATALOG.map(region => [region.id, region]));
const exactKey = value => String(value ?? "").normalize("NFC").trim().toLowerCase();
const foldedKey = value => exactKey(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/đ/g, "d").replace(/[^a-z0-9]/g, "");
let countryIndexes;

function indexes() {
  if (countryIndexes) return countryIndexes;
  const exact = new Map(); const folded = new Map(); const codes = new Map();
  const displayNames = ["vi", "en"].map(locale => new Intl.DisplayNames([locale], { type: "region" }));
  const add = (index, key, country) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(country);
  };
  for (const country of countries) {
    const source = COUNTRY_BOUNDARY_SOURCES[country.iso3];
    codes.set(country.iso3, country); codes.set(country.iso2, country);
    const names = [country.name, source?.name, ...(source?.aliases || []).filter(alias => ![country.iso3, country.iso2].includes(alias.toUpperCase())),
      ...displayNames.map(names => names.of(country.iso2))];
    for (const name of names.filter(Boolean)) {
      add(exact, exactKey(name), country);
      add(folded, foldedKey(name), country);
    }
  }
  countryIndexes = { exact, folded, codes };
  return countryIndexes;
}

/** Match complete names before removing annotations; ambiguous aliases never pick a country. */
export function resolveCountryRegion(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const { exact, folded, codes } = indexes();
  const unique = matches => matches?.size === 1 ? [...matches][0] : null;
  const match = name => {
    const text = name.trim();
    // Uppercase NGA is Nigeria's ISO3; the localized name Nga is Russia.
    return (/^[A-Z]{2,3}$/.test(text) ? codes.get(text) : null) || unique(exact.get(exactKey(text)))
      || codes.get(text.toUpperCase()) || unique(folded.get(foldedKey(text)));
  };
  return match(value) || match(countryLookupName(value));
}

export function summarizeCountryRegions(values) {
  const unique = [...new Set(values)];
  const matched = unique.map(resolveCountryRegion).filter(Boolean);
  if (!matched.length) return null;
  const resolved = [...new Map(matched.map(country => [country.iso3, country])).values()];
  return { matchedValueCount: matched.length, valueCount: unique.length, countryCount: resolved.length,
    regions: COUNTRY_REGION_CATALOG.flatMap(region => {
      const count = resolved.filter(country => country[region.level] === region.name).length;
      return count ? [{ id: region.id, countryCount: count }] : [];
    }) };
}

/** Missing/old AI metadata stays disabled; only a real country column can enable navigation. */
export function normalizeRegionNavigation(raw, columns = []) {
  if (!raw || !columns.some(column => column.name === raw.countryField && !column.name.startsWith("__")
    && column.role === "geo" && column.geoLevel === "country") || !Array.isArray(raw.regions)) return null;
  const regions = [...new Set(raw.regions.filter(id => regionById.has(id)))];
  return regions.length ? { countryField: raw.countryField, regions } : null;
}

function featureCountry(properties, layer) {
  const fields = (layer.columns || []).filter(column => column.role === "geo" && column.geoLevel === "country").map(column => column.name);
  if (fields.includes(layer.regionNavigation?.countryField)) fields.unshift(layer.regionNavigation.countryField);
  return fields.map(field => resolveCountryRegion(properties[field])).find(Boolean)
    || [properties.__resolved_country_code, properties.__country_code, properties.GID_0, properties.country_code]
      .map(resolveCountryRegion).find(Boolean) || null;
}

export function countryRegionMatches(properties, layer, regionId) {
  if (!regionId) return true;
  const region = regionById.get(regionId);
  const country = featureCountry(properties || {}, layer);
  return Boolean(region && country && country[region.level] === region.name);
}

/** Keep source data intact so clearing the selection restores all current countries. */
export function filterCountryRegionData(data, layer, regionId) {
  if (!regionId || !data || typeof data !== "object") return data;
  if (data.type === "FeatureCollection" || Array.isArray(data.features)) {
    return { ...data, features: data.features.filter(feature => countryRegionMatches(feature.properties, layer, regionId)) };
  }
  if (data.type === "Feature") return countryRegionMatches(data.properties, layer, regionId) ? data : { type: "FeatureCollection", features: [] };
  return data;
}

/** Only include countries in the current rendered data, independent of search visibility. */
export function buildCountryRegionNavigation(layers = []) {
  const groups = new Map();
  for (const layer of layers) {
    const config = normalizeRegionNavigation(layer.regionNavigation, layer.columns);
    if (!config) continue;
    for (const id of config.regions) {
      if (!groups.has(id)) groups.set(id, { ...regionById.get(id), countries: new Set(), features: new Set() });
    }
    // Options remain available when another filter or this dropdown hides their countries.
    for (const value of new Set((layer.sourceRecords || []).map(record => record[config.countryField]))) {
      const country = resolveCountryRegion(value);
      if (!country) continue;
      for (const id of config.regions) {
        const region = regionById.get(id);
        if (country[region.level] === region.name) groups.get(id).countries.add(country.iso3);
      }
    }
    for (const feature of layer.data?.features || []) {
      const country = featureCountry(feature.properties || {}, layer);
      if (!country || !feature.geometry) continue;
      for (const id of config.regions) {
        const region = regionById.get(id);
        if (country[region.level] !== region.name) continue;
        groups.get(id).countries.add(country.iso3);
        groups.get(id).features.add(feature);
      }
    }
  }
  return [...groups.values()].filter(group => group.countries.size > 0).map(({ countries, features, ...region }) =>
    ({ ...region, countryCount: countries.size, features: [...features] }));
}

import { COUNTRY_BOUNDARY_SOURCES } from "./country-boundary-fallbacks.js";

export { COUNTRY_BOUNDARY_SOURCES };

function normalizedCountry(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function resolveBoundaryCountry(value) {
  if (/[/\\]/.test(String(value ?? ""))) return null;
  const name = normalizedCountry(value);
  if (!name) return null;
  const countries = Object.entries(COUNTRY_BOUNDARY_SOURCES);
  const exactName = String(value).normalize("NFC").trim().toLowerCase();
  // Giữ phân biệt tên có dấu (Mỹ) với mã quốc gia (MY) trước khi bỏ dấu.
  const exact = countries.find(([code, source]) =>
    [code, source.name, ...source.aliases].some(alias => String(alias).normalize("NFC").trim().toLowerCase() === exactName)
  );
  return exact?.[0] || countries.find(([code, source]) =>
    [code, source.name, ...source.aliases].some(alias => normalizedCountry(alias) === name)
  )?.[0] || null;
}

/** A display label may qualify a country without changing the requested ADM0. */
export function countryLookupName(value) {
  const name = String(value ?? "").trim();
  if (resolveBoundaryCountry(name)) return name;
  return name.split(/\s*[—–]\s*|\s+-\s+/u)[0].replace(/\s*\([^()]*\)\s*$/u, "").trim() || name;
}

export function resolvedCountryProperties(feature) {
  const properties = feature.properties || {};
  if (!feature.place_type?.includes("country") && properties.__data_place_type !== "country" && properties.__admin_level !== 0) return {};
  const rawCode = properties.__country_code || properties.GID_0 || properties.country_code || properties.short_code || feature.country_code;
  const code = resolveBoundaryCountry(rawCode) || resolveBoundaryCountry(feature.text || feature.place_name)
    || String(rawCode || "").toUpperCase();
  const name = COUNTRY_BOUNDARY_SOURCES[code]?.name || feature.text || properties.NAME_0 || properties.name || feature.place_name;
  const key = code || feature.id || normalizedCountry(name);
  return key ? { __resolved_location_key: `country:${key}`, __resolved_location_name: name,
    ...(code ? { __resolved_country_code: code } : {}) } : {};
}

export function countryBoundaryUrl(country, level = 0) {
  const code = resolveBoundaryCountry(country);
  return COUNTRY_BOUNDARY_SOURCES[code]?.files[level] || null;
}

const boundaryPromises = new Map();

export async function loadCountryBoundaryData(country, level, { fetchImpl = fetch, signal } = {}) {
  const code = resolveBoundaryCountry(country);
  const url = countryBoundaryUrl(code, level);
  if (!url) throw new Error(`Chưa cấu hình ranh giới ${country} ADM${level}`);
  if (signal?.aborted) throw new DOMException("Boundary loading aborted", "AbortError");
  const load = async requestSignal => {
    const response = await fetchImpl(url, { signal: requestSignal });
    if (!response.ok) throw new Error(`Không thể tải ranh giới ${code} ADM${level} (${response.status})`);
    const data = await response.json();
    if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error(`Dữ liệu ${code} ADM${level} không phải FeatureCollection`);
    }
    return data;
  };
  let data;
  if (fetchImpl !== fetch) data = await load(signal);
  else {
    const key = `${code}:${level}`;
    if (!boundaryPromises.has(key)) {
      boundaryPromises.set(key, load().catch(error => { boundaryPromises.delete(key); throw error; }));
    }
    data = await boundaryPromises.get(key);
  }
  if (signal?.aborted) throw new DOMException("Boundary loading aborted", "AbortError");
  return data;
}

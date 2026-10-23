const ADMIN_LEVELS = ["country", "admin1", "admin2"];

export function preferredAdministrativeColumn(columns, profile = null) {
  const stats = new Map((profile?.columns || []).map(column => [column.name, column]));
  return (columns || []).filter(column => column.role === "geo" && ADMIN_LEVELS.includes(column.geoLevel)
    && (stats.get(column.name)?.uniqueCount == null || stats.get(column.name).uniqueCount > 0)
    && stats.get(column.name)?.nullPct !== 100)
    .sort((a, b) => ADMIN_LEVELS.indexOf(b.geoLevel) - ADMIN_LEVELS.indexOf(a.geoLevel))[0] || null;
}

export function administrativeContextFields(columns, regionField) {
  const region = (columns || []).find(column => column.name === regionField);
  const level = ADMIN_LEVELS.indexOf(region?.geoLevel);
  if (region?.role !== "geo" || level <= 0) return [];
  return columns.filter(column => column.role === "geo" && ADMIN_LEVELS.includes(column.geoLevel)
    && ADMIN_LEVELS.indexOf(column.geoLevel) < level)
    .sort((a, b) => ADMIN_LEVELS.indexOf(b.geoLevel) - ADMIN_LEVELS.indexOf(a.geoLevel))
    .map(column => column.name);
}

/** Parent values qualify lookup and grouping, while source column values stay intact. */
export function geographicLocationName(record, geometry) {
  const name = String(record?.[geometry?.field] ?? "").trim();
  if (!name) return "";
  return [name, ...(geometry.contextFields || []).map(field => String(record?.[field] ?? "").trim())]
    .filter(Boolean).join(", ");
}

// MapLibre may serialize array-valued GeoJSON properties in queried features.
export function sourceLocationNames(properties) {
  let value = properties?.__source_locations;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.filter(name => typeof name === "string" && name.trim()) : [];
}

const SEARCH_ROLES = new Set(["geo", "category", "text", "id"]);
const ADMIN_LEVELS = ["country", "admin1", "admin2"];

export function isDataSearchColumn(column) {
  return typeof column?.name === "string" && column.name.length > 0 && !column.name.startsWith("__")
    && SEARCH_ROLES.has(column.role) && !["point_lat", "point_lng", "h3"].includes(column.geoLevel);
}

// Preserve absent keys so old responses keep the existing search defaults.
export function normalizeDataSearchConfig(raw, columns = []) {
  const config = {};
  if (Object.hasOwn(raw, "search_bar")) config.search_bar = raw.search_bar === true;
  if (Object.hasOwn(raw, "search_fields")) {
    const names = new Set(columns.filter(isDataSearchColumn).map(column => column.name));
    config.search_fields = Array.isArray(raw.search_fields)
      ? [...new Set(raw.search_fields.filter(name => typeof name === "string" && names.has(name)))] : [];
    if (!config.search_fields.length) config.search_bar = false;
  }
  return config;
}

export function resolveDataSearchColumns({ columns = [], search_fields, titleField, chartType } = {}) {
  const available = columns.filter(isDataSearchColumn);
  const byName = new Map(available.map(column => [column.name, column]));
  let fields = search_fields === undefined ? available
    : (normalizeDataSearchConfig({ search_fields }, columns).search_fields).map(name => byName.get(name));
  if (!fields.length) return [];
  const title = byName.get(titleField);
  // The active geometry binding controls the primary geographic level/route.
  // For Point, keep an AI-selected name; promote the known name ahead of a city or ID.
  const useTitle = title && (search_fields === undefined || ["choropleth", "map_line"].includes(chartType)
    || chartType === "point" && (fields[0].role === "geo" || fields[0].role === "id" && title.role !== "id"));
  if (useTitle) fields = [title, ...fields.filter(column => column.name !== title.name)];
  if (chartType === "choropleth") {
    const level = ADMIN_LEVELS.indexOf(fields[0].geoLevel);
    if (level < 0) return [];
    fields = fields.filter(column => !ADMIN_LEVELS.includes(column.geoLevel) || ADMIN_LEVELS.indexOf(column.geoLevel) <= level);
  }
  return fields;
}

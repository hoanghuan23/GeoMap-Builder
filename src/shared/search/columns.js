const SEARCH_ROLES = new Set(["geo", "category", "text", "id"]);

export function isDataSearchColumn(column) {
  return typeof column?.name === "string" && column.name.length > 0 && !column.name.startsWith("__")
    && SEARCH_ROLES.has(column.role) && !["point_lat", "point_lng", "h3"].includes(column.geoLevel);
}


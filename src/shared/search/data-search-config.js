import { mapRegistry } from "../../maps/registry.js";
import { isDataSearchColumn } from "./columns.js";
export { isDataSearchColumn } from "./columns.js";

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
  if(title && search_fields === undefined)fields=[title,...fields.filter(column=>column.name!==title.name)];
  return mapRegistry[chartType]?.searchColumns?.(fields,title) || fields;
}

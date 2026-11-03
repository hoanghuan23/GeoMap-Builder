import { normalizeRoadText } from "../../shared/data/text-utils.js";
import { coordinatePair } from "../../shared/data/coordinates.js";

export function pointEntityField(columns = [], bindings = {}) {
  return bindings.region || columns.find(column => column.role === "id" && column.name !== bindings.x)?.name || null;
}

export function pointTitleField(columns = []) {
  return columns.find(column => /(^| )(ten|name)( |$)/.test(normalizeRoadText(column.name)) && ["category", "text"].includes(column.role))?.name
    || columns.find(column => column.role === "id")?.name || null;
}

export function pointIdentity(properties, columns, bindings) {
  const field = pointEntityField(columns, bindings);
  const value = properties?.[field];
  if (field && value != null && String(value).trim()) return JSON.stringify([field, String(value).trim()]);
  return JSON.stringify(coordinatePair(properties, bindings));
}


import { numericMapValue } from "./map-value.js";

function isEmpty(value) {
  return value == null || typeof value === "string" && value.trim() === "";
}

function serializableValue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return String(value);
}

function distinctKey(value) {
  if (isEmpty(value)) return "missing:";
  const serialized = serializableValue(value);
  return `${typeof serialized}:${String(serialized)}`;
}

function aggregate(values, aggregation) {
  if (aggregation === "count") return values.length;
  const numbers = values.map(numericMapValue).filter(value => value != null);
  if (!numbers.length) return null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  if (aggregation === "mean") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return numbers.length === 1 ? numbers[0] : null;
}

export function summarizeFeatureProperties(records, columns, { metricField = null, metricAggregation = null } = {}) {
  const source = Array.isArray(records) ? records : [];
  const properties = {};
  for (const column of columns || []) {
    const name = column?.name;
    if (!name || column.role === "ignore") continue;
    const values = source.map(record => record?.[name]);
    const present = values.filter(value => !isEmpty(value));
    if (!present.length) continue;
    if (column.role === "measure") {
      const aggregation = name === metricField && metricAggregation ? metricAggregation : column.aggDefault;
      const value = aggregate(present, aggregation);
      if (value != null) properties[name] = value;
      continue;
    }
    const states = new Map();
    for (const value of values) {
      const key = distinctKey(value);
      if (!states.has(key)) states.set(key, isEmpty(value) ? null : serializableValue(value));
    }
    if (states.size === 1) properties[name] = serializableValue(present[0]);
    else properties[name] = `Nhiều giá trị (${states.size})`;
  }
  return properties;
}

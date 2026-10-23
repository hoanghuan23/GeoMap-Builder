import { humanizeField } from "../charts/data-transformers.js";
import { serializeTabularValue } from "../tabular-data.js";
import { timeValueInfo, timeValuesAreComparable, uniqueTimeValues } from "../time-values.js";

export const POINT_COLOR = "#00d084";
export const POINT_COLORS = Object.freeze(["#5b8ff9", "#f58b61", "#63c785", "#f6bd16", "#9270ca", "#6dc8ec", "#d9548a", "#2f9e9e"]);
export const POINT_GROUP_LIMIT = 8;
export const POINT_DEFAULT_GROUPS = 5;
export const DEFAULT_POINT_STYLE = Object.freeze({
  color: POINT_COLOR,
  size: 100,
  opacity: .95,
  showBorder: true,
  borderColor: "#ffffff",
  borderWidth: 1,
  showLegend: true
});

function colorValue(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function mergePointStyle(input = {}) {
  const clamp = (key, min, max) => {
    const value = Number(input[key] ?? DEFAULT_POINT_STYLE[key]);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DEFAULT_POINT_STYLE[key];
  };
  return {
    color: colorValue(input.color, POINT_COLOR),
    size: clamp("size", 50, 200),
    opacity: clamp("opacity", 0, 1),
    showBorder: input.showBorder !== false,
    borderColor: colorValue(input.borderColor, DEFAULT_POINT_STYLE.borderColor),
    borderWidth: clamp("borderWidth", 0, 4),
    showLegend: input.showLegend !== false
  };
}

function numberValue(value) {
  if (typeof value !== "number" && typeof value !== "string" || typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function groupKey(value) {
  return value == null || String(value).trim() === "" ? null : String(value);
}

function fieldLabel(column) {
  return column.labelVi || humanizeField(column.name);
}

/** Build once per Point suggestion from the normalized source records. */
export function createPointModel(records, columns, { lat, lng }) {
  const measures = columns.filter(column => column.role === "measure" && ![lat, lng].includes(column.name));
  const features = records.flatMap((record, index) => {
    const latitude = numberValue(record?.[lat]);
    const longitude = numberValue(record?.[lng]);
    if (latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const properties = Object.fromEntries(Object.entries(record).map(([field, value]) => [field, serializeTabularValue(value)]));
    for (const column of measures) properties[column.name] = numberValue(properties[column.name]);
    return [{ type: "Feature", id: index, properties, geometry: { type: "Point", coordinates: [longitude, latitude] } }];
  });
  const groups = columns.filter(column => ![lat, lng].includes(column.name) && (
    ["category", "text"].includes(column.role)
    || column.role === "geo" && !["point_lat", "point_lng", "h3"].includes(column.geoLevel)
  )).flatMap(column => {
    const counts = new Map();
    for (const feature of features) {
      const key = groupKey(feature.properties[column.name]);
      if (key != null) counts.set(key, (counts.get(key) || 0) + 1);
      if (counts.size > 80) return [];
    }
    if (!counts.size) return [];
    const values = [...counts].map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi"));
    return [{ ...column, label: fieldLabel(column), values }];
  });
  let timeColumn = null;
  let times = [];
  for (const column of columns.filter(column => column.role === "time")) {
    const values = uniqueTimeValues(features.map(feature => feature.properties), column);
    if (!values.length || !timeValuesAreComparable(values, column)) continue;
    timeColumn = column;
    times = values.map(value => String(serializeTabularValue(value)));
    break;
  }
  return {
    data: { type: "FeatureCollection", features },
    measures: measures.map(column => ({ ...column, label: fieldLabel(column) })),
    groups, timeColumn, times,
    totalRecords: records.length,
    coordinateCount: features.length,
    coordinateRate: records.length ? features.length / records.length : 0
  };
}

export function normalizePointSelection(model, saved = {}) {
  const metric = model.measures.find(column => column.name === saved.metricField)
    || model.measures.find(column => model.data.features.some(feature => feature.properties[column.name] != null)) || model.measures[0];
  const group = model.groups.find(column => column.name === saved.groupField)
    || model.groups.find(column => column.values.length > 1) || model.groups[0];
  const validKeys = new Set(group?.values.map(item => item.key));
  let selectedValues = [...new Set(saved.selectedValues || [])].filter(key => validKeys.has(key)).slice(0, POINT_GROUP_LIMIT);
  if (!selectedValues.length) selectedValues = group?.values.slice(0, POINT_DEFAULT_GROUPS).map(item => item.key) || [];
  const time = model.times.includes(saved.time) ? saved.time : model.times.at(-1) || null;
  return {
    metricField: metric?.name || null,
    groupField: group?.name || null,
    mode: group && saved.mode !== "all" ? "pick" : "all",
    selectedValues, time
  };
}

function assignColors(keys, previous) {
  const colors = Object.create(null);
  const used = new Set();
  for (const key of keys) {
    const color = previous[key];
    if (POINT_COLORS.includes(color) && !used.has(color)) { colors[key] = color; used.add(color); }
  }
  for (const key of keys) {
    if (Object.hasOwn(colors, key)) continue;
    const color = POINT_COLORS.find(candidate => !used.has(candidate));
    colors[key] = color;
    used.add(color);
  }
  return colors;
}

function radiusExpression(metric, size = 100) {
  const scale = size / 100;
  if (!metric) return ["interpolate", ["linear"], ["zoom"], 4, 4 * scale, 10, 6 * scale, 16, 10 * scale];
  const atZoom = (small, large) => {
    small *= scale; large *= scale;
    const value = ["get", metric.field];
    const scaled = metric.min == null ? small : metric.min === metric.max ? (small + large) / 2
      : ["interpolate", ["linear"], value, metric.min, small, metric.max, large];
    return ["case", ["==", ["typeof", value], "number"], scaled, small];
  };
  return ["interpolate", ["linear"], ["zoom"], 4, atZoom(3, 7), 10, atZoom(4, 12), 16, atZoom(7, 18)];
}

export function pointPaint(input = {}, metric = null, color = null) {
  const style = mergePointStyle(input);
  return {
    "circle-color": metric ? ["case", ["==", ["typeof", ["get", metric.field]], "number"], color ?? style.color, "rgba(0, 0, 0, 0)"] : color ?? style.color,
    "circle-radius": radiusExpression(metric, style.size),
    "circle-opacity": style.opacity,
    "circle-stroke-color": style.borderColor,
    "circle-stroke-width": style.showBorder ? style.borderWidth : 0,
    "circle-stroke-opacity": style.opacity
  };
}

/** One result supplies the source, paint, legend, controls and counts. No source mutation. */
export function buildPointView(model, saved = {}, previousColors = {}, inputStyle = {}) {
  const style = mergePointStyle(inputStyle);
  const selection = normalizePointSelection(model, saved);
  const group = model.groups.find(column => column.name === selection.groupField);
  const selected = new Set(selection.selectedValues);
  const paletteColors = assignColors(selection.selectedValues, previousColors);
  const colors = Object.fromEntries(selection.selectedValues.map(key => [key, colorValue(inputStyle.groupColors?.[key], paletteColors[key])]));
  const selectedTime = model.timeColumn ? timeValueInfo(selection.time, model.timeColumn) : null;
  const features = model.data.features.filter(feature => {
    if (selection.mode === "pick" && !selected.has(groupKey(feature.properties[selection.groupField]))) return false;
    if (model.timeColumn) {
      const time = timeValueInfo(feature.properties[model.timeColumn.name], model.timeColumn);
      if (!time || time.key !== selectedTime?.key) return false;
    }
    return true;
  });
  const measure = model.measures.find(column => column.name === selection.metricField);
  let metric = null;
  if (measure) {
    let min = Infinity; let max = -Infinity; let missingCount = 0;
    for (const feature of features) {
      const value = feature.properties[measure.name];
      if (value == null) { missingCount += 1; continue; }
      min = Math.min(min, value); max = Math.max(max, value);
    }
    metric = { field: measure.name, label: measure.label, unit: measure.unit || "", min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null, missingCount };
  }
  const counts = new Map();
  for (const feature of features) {
    const key = groupKey(feature.properties[selection.groupField]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const legendRows = metric && selection.mode === "pick"
    ? selection.selectedValues.map(key => ({ key, label: key, color: colors[key], count: counts.get(key) || 0 }))
    : [{ key: "all", label: group ? `Tất cả ${group.label.toLocaleLowerCase("vi")}` : "Tất cả điểm", color: style.color, count: features.length }];
  const color = metric && selection.mode === "pick"
    ? ["match", ["to-string", ["get", selection.groupField]], ...legendRows.flatMap(row => [row.key, row.color]), POINT_COLOR]
    : style.color;
  return {
    selection, colors, paletteColors, metric, style,
    data: { type: "FeatureCollection", features },
    paint: pointPaint(style, metric, color),
    legendTitle: group?.label || "Điểm dữ liệu", legendRows,
    stats: { visibleCount: features.length, totalCount: model.coordinateCount, coordinateRate: model.coordinateRate }
  };
}

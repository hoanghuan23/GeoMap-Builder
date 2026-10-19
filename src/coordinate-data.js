import { normalizeRoadText } from "./congestion-data.js";
import { compareTimeValues, timeValueInfo } from "./time-values.js";
import { summarizeFeatureProperties } from "./feature-properties.js";

export function coordinateBindings(columns = []) {
  const lat = columns.find(column => column.geoLevel === "point_lat" || /^(lat|latitude|vi do)$/.test(normalizeRoadText(column.name)));
  const lng = columns.find(column => column.geoLevel === "point_lng" || /^(lng|lon|longitude|kinh do)$/.test(normalizeRoadText(column.name)));
  return lat && lng ? { lat: lat.name, lng: lng.name } : null;
}

export function coordinatePair(record, { lat, lng }) {
  const valid = value => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
  if (!valid(record?.[lat]) || !valid(record?.[lng])) return null;
  const latitude = Number(record[lat]); const longitude = Number(record[lng]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? [longitude, latitude] : null;
}

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

export function isCoordinateLine(suggestion) {
  return suggestion?.chartType === "map_line" && Boolean(suggestion.bindings?.lat && suggestion.bindings?.lng);
}

export function stationaryEntities(records, columns, bindings) {
  const field = pointEntityField(columns, bindings);
  if (!field) return false;
  const groups = new Map();
  for (const record of records) {
    const value = record[field]; const pair = coordinatePair(record, bindings);
    if (value == null || value === "" || !pair) continue;
    const key = String(value); const group = groups.get(key) || { count: 0, locations: new Set() };
    group.count++; group.locations.add(JSON.stringify(pair)); groups.set(key, group);
  }
  return groups.size > 1 && [...groups.values()].every(group => group.locations.size === 1)
    && [...groups.values()].some(group => group.count > 1);
}

export function inferCoordinateLine(records, columns) {
  const bindings = coordinateBindings(columns);
  if (!bindings || stationaryEntities(records, columns, bindings)) return null;
  const group = columns.find(column => ["id", "category", "text"].includes(column.role)
    && /route|track|trip|tuyen|hanh trinh|vehicle|phuong tien/.test(normalizeRoadText(column.name)));
  const order = columns.find(column => /^(stt|thu tu|sequence|seq|order|point index|index)$/.test(normalizeRoadText(column.name)))
    || columns.find(column => column.role === "time");
  const hasObjects = columns.some(column => ![bindings.lat, bindings.lng, order?.name, group?.name].includes(column.name)
    && ["id", "category", "text", "geo"].includes(column.role));
  if (!group && hasObjects) return null;
  const result = { ...bindings, ...(group ? { region: group.name } : {}), ...(order ? { x: order.name } : {}) };
  const data = buildCoordinateLines(records, columns, result);
  return data.features.length && data.stats.coordinateRate >= .7 ? result : null;
}

export function buildCoordinateLines(records, columns, bindings) {
  const groups = new Map();
  const orderColumn = columns.find(column => column.name === bindings.x);
  for (const [index, record] of records.entries()) {
    const value = bindings.region ? record[bindings.region] : "Chuỗi tọa độ";
    if (value == null || String(value).trim() === "") continue;
    const key = String(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ record, index });
  }
  let matchedRows = 0;
  const features = [];
  for (const [key, rows] of groups) {
    if (orderColumn) rows.sort((a, b) => {
      const left = a.record[orderColumn.name]; const right = b.record[orderColumn.name];
      if (orderColumn.role === "time") return compareTimeValues(left, right, orderColumn) || a.index - b.index;
      const numeric = value => value != null && String(value).trim() !== "" && Number.isFinite(Number(value));
      return (numeric(left) && numeric(right) ? Number(left) - Number(right) : String(left ?? "").localeCompare(String(right ?? ""), "vi", { numeric: true })) || a.index - b.index;
    });
    const paths = []; let path = []; const valid = [];
    const finish = () => { if (path.length >= 2) paths.push(path); path = []; };
    for (const { record } of rows) {
      const pair = coordinatePair(record, bindings);
      const ordered = !orderColumn || (orderColumn.role === "time" ? timeValueInfo(record[orderColumn.name], orderColumn) : record[orderColumn.name] != null && String(record[orderColumn.name]).trim() !== "");
      if (!pair || !ordered) { finish(); continue; }
      valid.push(record);
      if (!path.length || pair.some((value, index) => value !== path.at(-1)[index])) path.push(pair);
    }
    finish();
    if (!paths.length) continue;
    matchedRows += valid.length;
    features.push({ type: "Feature", properties: { ...summarizeFeatureProperties(valid, columns), __path_key: key },
      geometry: paths.length === 1 ? { type: "LineString", coordinates: paths[0] } : { type: "MultiLineString", coordinates: paths } });
  }
  const coordinateCount = records.filter(record => coordinatePair(record, bindings)).length;
  return { type: "FeatureCollection", features,
    stats: { totalRows: records.length, matchedRows, segmentCount: features.length, coordinateRate: records.length ? coordinateCount / records.length : 0 } };
}

import { coordinatePair } from "../../shared/data/coordinates.js";
import { compareTimeValues, timeValueInfo } from "../../shared/data/time-values.js";
import { summarizeFeatureProperties } from "../../shared/geography/feature-properties.js";

export function isCoordinateLine(suggestion) {
  return suggestion?.chartType === "map_line" && Boolean(suggestion.bindings?.lat && suggestion.bindings?.lng);
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

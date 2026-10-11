import { RENDERERS } from "./plan-schema.js";

export function numeric(value) {
  return value == null || value === "" || typeof value === "boolean" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
}

function flatten(value, prefix = "", output = Object.create(null)) {
  for (const [key, child] of Object.entries(value || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child) && !(child instanceof Date)) flatten(child, path, output);
    else if (!Array.isArray(child)) output[path] = child instanceof Date ? child.toISOString() : child;
  }
  return output;
}

function validateGeometry(geometry) {
  const position = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
  const line = coords => Array.isArray(coords) && coords.length >= 2 && coords.every(position);
  const ring = coords => line(coords) && coords.length >= 4 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1];
  const polygon = coords => Array.isArray(coords) && coords.length > 0 && coords.every(ring);
  const checks = { Point: position, MultiPoint: c => Array.isArray(c) && c.length > 0 && c.every(position),
    LineString: line, MultiLineString: c => Array.isArray(c) && c.length > 0 && c.every(line),
    Polygon: polygon, MultiPolygon: c => Array.isArray(c) && c.length > 0 && c.every(polygon) };
  if (!geometry || !checks[geometry.type]?.(geometry.coordinates)) throw new Error("Geometry hoặc tọa độ GeoJSON không hợp lệ; cần EPSG:4326.");
}

function describe(records) {
  const stats = new Map();
  for (const row of records) for (const [path, value] of Object.entries(row)) {
    if (!stats.has(path)) stats.set(path, { path, count: 0, numericCount: 0, min: Infinity, max: -Infinity, values: new Set() });
    const s = stats.get(path);
    if (value == null || value === "") continue;
    s.count++; s.values.add(value);
    const number = numeric(value);
    if (number !== null) { s.numericCount++; s.min = Math.min(s.min, number); s.max = Math.max(s.max, number); }
  }
  return [...stats.values()].map(s => ({
    path: s.path, type: s.count && s.count === s.numericCount ? "number" : "string", count: s.count,
    missing: records.length - s.count, uniqueCount: s.values.size,
    min: s.numericCount ? s.min : null, max: s.numericCount ? s.max : null,
    time: s.values.size > 0 && [...s.values].every(v => typeof v === "string" && /^(?:\d{2}:\d{2}(?::\d{2})?|\d{4}-\d{2}-\d{2}(?:[T ].*)?)$/.test(v)),
    values: [...s.values].slice(0, 20)
  }));
}

/** Walk containers once; never descend into every polygon coordinate or table row. */
export function profileInput(input) {
  const datasets = []; const seen = new Set();
  const add = (value, path, kind) => {
    const features = kind === "geojson" ? (value.type === "FeatureCollection" ? value.features : value.type === "Feature" ? [value] : [{ type: "Feature", properties: {}, geometry: value }]) : null;
    if (features && (!Array.isArray(features) || features.some(f => !f?.geometry))) throw new Error(`Geometry không hợp lệ tại ${path}.`);
    features?.forEach(f => validateGeometry(f.geometry));
    const records = features ? features.map(f => flatten({ properties: f.properties || {} })) : value.map(r => flatten(r));
    datasets.push({ path, kind, records, features, fields: describe(records), rowCount: records.length,
      geometryTypes: features ? [...new Set(features.map(f => f.geometry.type))] : [] });
  };
  const visit = (value, path = "$") => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (["FeatureCollection", "Feature", "Point", "MultiPoint", "Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(value.type)) { add(value, path, "geojson"); return; }
    if (Array.isArray(value)) {
      if (value.length && value.every(r => r && typeof r === "object" && !Array.isArray(r))) {
        if (value.every(r => r.type === "Feature")) add({ type: "FeatureCollection", features: value }, path, "geojson");
        else if (value.every(r => r.type === "FeatureCollection")) value.forEach((r, i) => visit(r, `${path}[${i}]`));
        else {
          add(value, path, "table");
          value.forEach((r, i) => {
            for (const [key, child] of Object.entries(r)) if (child && typeof child === "object" && !(child instanceof Date)) visit(child, `${path}[${i}].${key}`);
          });
        }
      }
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (["metadata", "style_rules"].includes(key)) continue;
      visit(child, path === "$" ? key : `${path}.${key}`);
    }
  };
  visit(input);
  // Relationships are established from complete key sets, not sample coincidence.
  const joins = [];
  for (const spatial of datasets.filter(d => d.kind === "geojson")) {
    for (const table of datasets.filter(d => d.kind === "table")) {
      for (const left of spatial.fields.filter(f => f.uniqueCount === spatial.rowCount && f.count === spatial.rowCount)) {
        const keys = new Set(spatial.records.map(r => r[left.path]));
        for (const right of table.fields.filter(f => f.type === left.type)) {
          const values = new Set(table.records.map(r => r[right.path]).filter(v => v != null));
          if (values.size && [...values].every(v => keys.has(v))) joins.push({ source: spatial.path, target: table.path, sourceKey: left.path, targetKey: right.path });
        }
      }
    }
  }
  const metadata = input?.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const styleRules = input?.style_rules || null;
  const payload = { metadata, styleRules, joins, renderers: RENDERERS,
    datasets: datasets.map(({ records, features, ...d }) => ({ ...d, samples: records.slice(0, 20) })) };
  return { datasets, metadata, styleRules, joins, payload };
}

export function metricFields(dataset) {
  return dataset.fields.filter(f => f.type === "number" && !/(^|[._])(id|code|index|lat|lng|lon|latitude|longitude|year|rank)($|[._])/i.test(f.path));
}
export function coordinateFields(dataset) {
  const latitude = new Set(["lat", "latitude", "vĩ độ", "vi do"]);
  const longitude = new Set(["lng", "lon", "long", "longitude", "kinh độ", "kinh do"]);
  const name = f => f.path.split(".").at(-1).trim().toLowerCase();
  return { latitude: dataset.fields.find(f => latitude.has(name(f)))?.path || null,
    longitude: dataset.fields.find(f => longitude.has(name(f)))?.path || null };
}

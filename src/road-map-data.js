import { CONGESTION_COLORS, congestionLevel, normalizeRoadText } from "./congestion-data.js";
import { BAR_COLORS } from "./charts/data-transformers.js";

export const ROAD_NETWORKS = Object.freeze([
  ["an_giang", "An Giang"], ["bac_ninh", "Bắc Ninh"], ["ca_mau", "Cà Mau"], ["can_tho", "Cần Thơ"],
  ["cao_bang", "Cao Bằng"], ["da_nang", "Đà Nẵng"], ["dak_lak", "Đắk Lắk"], ["dien_bien", "Điện Biên"],
  ["dong_nai", "Đồng Nai"], ["dong_thap", "Đồng Tháp"], ["gia_lai", "Gia Lai"], ["ha_tinh", "Hà Tĩnh"],
  ["hai_phong", "Hải Phòng"], ["hanoi", "Hà Nội"], ["ho_chi_minh", "Hồ Chí Minh"], ["hue", "Huế"],
  ["hung_yen", "Hưng Yên"], ["khanh_hoa", "Khánh Hòa"], ["lai_chau", "Lai Châu"], ["lam_dong", "Lâm Đồng"],
  ["lang_son", "Lạng Sơn"], ["lao_cai", "Lào Cai"], ["nghe_an", "Nghệ An"], ["ninh_binh", "Ninh Bình"],
  ["phu_tho", "Phú Thọ"], ["quang_ngai", "Quảng Ngãi"], ["quang_ninh", "Quảng Ninh"], ["quang_tri", "Quảng Trị"],
  ["son_la", "Sơn La"], ["tay_ninh", "Tây Ninh"], ["thai_nguyen", "Thái Nguyên"], ["thanh_hoa", "Thanh Hóa"],
  ["tuyen_quang", "Tuyên Quang"], ["vinh_long", "Vĩnh Long"]
].map(([id, label]) => Object.freeze({ id, label })));

const ROAD_AREA_FIELD_NAMES = new Set([
  "khu vuc", "tinh", "tinh thanh", "tinh thanh pho", "thanh pho", "dia phuong",
  "province", "city", "region", "area"
]);

function normalizedRoadArea(value) {
  const normalized = normalizeRoadText(value)
    .replace(/^(tinh|thanh pho|tp)\s+/, "")
    .replace(/\s+viet nam$/, "")
    .trim();
  if (["hn", "hanoi"].includes(normalized)) return "ha noi";
  if (["hcm", "tphcm", "sai gon", "saigon"].includes(normalized)) return "ho chi minh";
  return normalized;
}

export function roadAreaField(columns = []) {
  const named = columns.find(column => ROAD_AREA_FIELD_NAMES.has(normalizeRoadText(column.name)));
  return named?.name || columns.find(column => column.role === "geo" && column.geoLevel === "admin1")?.name || null;
}

export function roadRefField(columns = []) {
  return columns.find(column => /^(ma duong|ma tuyen|route ref|route code|road code|ref)$/.test(normalizeRoadText(column.name)))?.name || null;
}

export function roadNameField(columns = []) {
  return columns.find(column => ["category", "geo"].includes(column.role)
    && /(^| )(ten duong|ten tuyen|tuyen duong|road name|route name|street name)( |$)/.test(normalizeRoadText(column.name)))?.name || null;
}

export function roadNetworkForArea(value) {
  const area = normalizedRoadArea(value);
  return ROAD_NETWORKS.find(network => normalizedRoadArea(network.label) === area
    || normalizeRoadText(network.id) === area)?.id || null;
}

export function roadNetworksFromRecords(records = [], columns = []) {
  const field = roadAreaField(columns);
  if (!field) return { field: null, networkIds: [], unknownAreas: [] };
  const networkIds = []; const unknownAreas = [];
  for (const value of new Set(records.map(row => row?.[field]).filter(value => value != null && String(value).trim()))) {
    const id = roadNetworkForArea(value);
    const target = id ? networkIds : unknownAreas;
    const item = id || String(value).trim();
    if (!target.includes(item)) target.push(item);
  }
  return { field, networkIds, unknownAreas };
}

export function roadValueColumns(columns, records, roadField) {
  return columns.filter(column => column.role === "measure" || column.role === "category" && column.name !== roadField
    && new Set(records.map(row => row[column.name]).filter(value => value != null && value !== "")).size <= 12);
}

function aggregate(values, aggregation) {
  const numbers = values.filter(value => value != null && value !== "").map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  if (aggregation === "count") return numbers.length;
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  const sum = numbers.reduce((total, number) => total + number, 0);
  return aggregation === "sum" ? sum : sum / numbers.length;
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) if (value != null && value !== "") counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const indexCache = new WeakMap();
function indexRoads(roads) {
  if (indexCache.has(roads)) return indexCache.get(roads);
  const byName = new Map(); const byRef = new Map();
  for (const feature of roads.features) {
    if (!["LineString", "MultiLineString"].includes(feature.geometry?.type)) continue;
    for (const [property, index] of [["name", byName], ["ref", byRef]]) {
      const raw = feature.properties?.[property];
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        const key = property === "ref" ? normalizeRoadText(value).replace(/ /g, "") : normalizeRoadText(value);
        if (key) (index.get(key) || index.set(key, []).get(key)).push(feature);
      }
    }
  }
  const indexes = { byName, byRef };
  indexCache.set(roads, indexes);
  return indexes;
}

export function joinRoadRecords(records, roads, { roadField, valueField, columns = [], aggregation = "mean" }) {
  if (roads?.type !== "FeatureCollection" || !Array.isArray(roads.features)) throw new Error("Mạng đường không hợp lệ.");
  const refField = roadRefField(columns);
  const { byName, byRef } = indexRoads(roads);
  const groups = new Map();
  for (const row of records) {
    const name = normalizeRoadText(row[roadField]);
    if (!name) continue;
    const ref = normalizeRoadText(row[refField]).replace(/ /g, "");
    const key = JSON.stringify([name, ref]);
    if (!groups.has(key)) groups.set(key, { name, ref, rows: [] });
    groups.get(key).rows.push(row);
  }
  const features = []; const unmatched = []; let matchedRows = 0;
  for (const group of groups.values()) {
    const named = byName.get(group.name) || [];
    const referenced = byRef.get(group.ref) || [];
    const exact = group.ref ? named.filter(feature => referenced.includes(feature)) : [];
    // Route refs such as CT.01 and QL.1 span multiple provinces and roads. When
    // the source row supplies a ref, require it and the road name to identify
    // the same geometry instead of silently falling back to either field.
    const matched = group.ref ? exact : named;
    if (!matched.length) { unmatched.push(String(group.rows[0][roadField])); continue; }
    matchedRows += group.rows.length;
    const properties = { ...group.rows[0] };
    for (const column of columns) {
      const values = group.rows.map(row => row[column.name]);
      properties[column.name] = column.role === "measure"
        ? aggregate(values, column.name === valueField ? aggregation : column.aggDefault || "mean")
        : mostFrequent(values);
    }
    for (const feature of matched) features.push({ type: "Feature", geometry: feature.geometry, properties: { ...feature.properties, ...properties } });
  }
  return { type: "FeatureCollection", features, stats: { totalRows: records.length, matchedRows, unmatched, segmentCount: features.length } };
}

export function joinRoadRecordsByArea(records, roadGeometries, { areaField = null, roadField, valueField, columns = [], aggregation = "mean" }) {
  const field = areaField || roadAreaField(columns);
  if (!field) throw new Error("Thiếu cột Khu vực để xác định mạng đường.");
  const grouped = new Map(); const unresolved = [];
  for (const row of records) {
    const network = roadNetworkForArea(row?.[field]);
    if (!network || !roadGeometries?.[network]) { unresolved.push(String(row?.[roadField] ?? "")); continue; }
    if (!grouped.has(network)) grouped.set(network, []);
    grouped.get(network).push(row);
  }
  const features = []; const unmatched = [...unresolved]; let matchedRows = 0;
  for (const [network, networkRecords] of grouped) {
    const joined = joinRoadRecords(networkRecords, roadGeometries[network], { roadField, valueField, columns, aggregation });
    features.push(...joined.features); unmatched.push(...joined.stats.unmatched); matchedRows += joined.stats.matchedRows;
  }
  return {
    type: "FeatureCollection",
    features,
    stats: { totalRows: records.length, matchedRows, unmatched, segmentCount: features.length }
  };
}

export function roadMapStyle(data, column, colorOverrides = {}) {
  const field = column?.name;
  const values = data.features.map(feature => feature.properties[field]).filter(value => value != null && value !== "");
  const colorFor = (key, fallback) => /^#[0-9a-f]{6}$/i.test(colorOverrides[key] || "") ? colorOverrides[key] : fallback;
  if (column?.role === "measure") {
    const numbers = values.map(Number).filter(Number.isFinite);
    if (!numbers.length) return { color: "#94a3b8", rows: [] };
    const min = Math.min(...numbers); const max = Math.max(...numbers);
    const colors = /toc do|speed|ty le toc do/.test(normalizeRoadText(field))
      ? ["#dc2626", "#f97316", "#eab308", "#22c55e"] : ["#22c55e", "#eab308", "#f97316", "#dc2626"];
    if (min === max) {
      const key = "measure-0"; const color = colorFor(key, colors[0]);
      return { color, rows: [{ key, label: String(min), color }] };
    }
    const stops = colors.map((color, index) => ({
      key: `measure-${index}`,
      value: min + (max - min) * index / (colors.length - 1),
      color: colorFor(`measure-${index}`, color)
    }));
    return {
      color: ["case", ["==", ["typeof", ["get", field]], "number"], ["interpolate", ["linear"], ["to-number", ["get", field], min], ...stops.flatMap(stop => [stop.value, stop.color])], "#94a3b8"],
      rows: stops.map(stop => ({ key: stop.key, label: stop.value.toLocaleString("vi-VN", { maximumFractionDigits: 1 }), color: stop.color }))
    };
  }
  const isCongestion = /muc do un tac|congestion|traffic status/.test(normalizeRoadText(field));
  const severity = Object.keys(CONGESTION_COLORS);
  const categories = [...new Set(values.map(String))].sort((a, b) => isCongestion
    ? severity.indexOf(congestionLevel(a)) - severity.indexOf(congestionLevel(b)) : a.localeCompare(b, "vi"));
  const rows = categories.map((value, index) => {
    const key = `category:${value}`;
    const fallback = isCongestion ? CONGESTION_COLORS[congestionLevel(value)] || "#94a3b8" : BAR_COLORS[index % BAR_COLORS.length];
    return { key, label: value, color: colorFor(key, fallback) };
  });
  return { color: rows.length ? ["match", ["to-string", ["get", field]], ...rows.flatMap(row => [row.label, row.color]), "#94a3b8"] : "#94a3b8", rows };
}

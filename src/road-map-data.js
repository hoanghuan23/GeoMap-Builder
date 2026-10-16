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

export function inferRoadNetwork(fileName, records = [], columns = []) {
  const context = [fileName, ...columns.filter(column => column.role === "geo" && ["admin1", "admin2"].includes(column.geoLevel))
    .flatMap(column => [...new Set(records.map(row => row[column.name]))])].map(normalizeRoadText).join(" ");
  const padded = ` ${context} `;
  const matches = ROAD_NETWORKS.filter(network => padded.includes(` ${normalizeRoadText(network.label)} `)
    || padded.includes(` ${normalizeRoadText(network.id)} `)
    || network.id === "hanoi" && /\b(hn|hanoi)\b/.test(context));
  // Do not silently put an unknown or multi-province dataset on the Hanoi network.
  return matches.length === 1 ? matches[0].id : null;
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
  const refField = columns.find(column => /^(ma duong|ma tuyen|route ref|route code|road code|ref)$/.test(normalizeRoadText(column.name)))?.name;
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
    const matched = exact.length ? exact : named.length ? named : referenced;
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

export function roadMapStyle(data, column) {
  const field = column?.name;
  const values = data.features.map(feature => feature.properties[field]).filter(value => value != null && value !== "");
  if (column?.role === "measure") {
    const numbers = values.map(Number).filter(Number.isFinite);
    if (!numbers.length) return { color: "#94a3b8", rows: [] };
    const min = Math.min(...numbers); const max = Math.max(...numbers);
    const colors = /toc do|speed|ty le toc do/.test(normalizeRoadText(field))
      ? ["#dc2626", "#f97316", "#eab308", "#22c55e"] : ["#22c55e", "#eab308", "#f97316", "#dc2626"];
    if (min === max) return { color: colors[0], rows: [{ label: String(min), color: colors[0] }] };
    const stops = colors.map((color, index) => ({ value: min + (max - min) * index / (colors.length - 1), color }));
    return {
      color: ["case", ["==", ["typeof", ["get", field]], "number"], ["interpolate", ["linear"], ["to-number", ["get", field], min], ...stops.flatMap(stop => [stop.value, stop.color])], "#94a3b8"],
      rows: stops.map(stop => ({ label: stop.value.toLocaleString("vi-VN", { maximumFractionDigits: 1 }), color: stop.color }))
    };
  }
  const isCongestion = /muc do un tac|congestion|traffic status/.test(normalizeRoadText(field));
  const severity = Object.keys(CONGESTION_COLORS);
  const categories = [...new Set(values.map(String))].sort((a, b) => isCongestion
    ? severity.indexOf(congestionLevel(a)) - severity.indexOf(congestionLevel(b)) : a.localeCompare(b, "vi"));
  const rows = categories.map((value, index) => ({ label: value, color: isCongestion ? CONGESTION_COLORS[congestionLevel(value)] || "#94a3b8" : BAR_COLORS[index % BAR_COLORS.length] }));
  return { color: rows.length ? ["match", ["to-string", ["get", field]], ...rows.flatMap(row => [row.label, row.color]), "#94a3b8"] : "#94a3b8", rows };
}

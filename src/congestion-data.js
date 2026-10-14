export const CONGESTION_COLORS = Object.freeze({
  "Thông thoáng": "#22c55e",
  "Đông": "#eab308",
  "Ùn tắc": "#f97316",
  "Tắc nghẽn nặng": "#dc2626"
});

const FIELD_ALIASES = Object.freeze({
  roadName: ["ten duong", "tên đường", "road name", "road_name", "name"],
  routeRef: ["ma tuyen", "mã tuyến", "ma duong", "mã đường", "route ref", "route_ref", "ref"],
  timestamp: ["thoi diem", "thời điểm", "timestamp", "time", "datetime"],
  speed: ["toc do tb km h", "tốc độ tb km h", "tốc độ tb (km/h)", "toc do trung binh km h", "tốc độ trung bình (km/h)", "average speed", "speed"],
  freeFlowSpeed: ["toc do thong thoang km h", "tốc độ thông thoáng km h", "tốc độ thông thoáng (km/h)", "free flow speed", "free_flow_speed"],
  ratio: ["ty le", "tỷ lệ", "ty le toc do", "tỷ lệ tốc độ", "ratio"],
  level: ["muc do", "mức độ", "muc do un tac", "mức độ ùn tắc", "level", "status"],
  volume: ["luu luong xe", "lưu lượng xe", "traffic volume", "volume"]
});

export function normalizeRoadText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function canonicalRef(value) {
  return normalizeRoadText(value).replace(/\s+/g, "");
}

function fieldMap(record) {
  return new Map(Object.keys(record || {}).map(key => [normalizeRoadText(key), key]));
}

function sourceField(map, alias) {
  return FIELD_ALIASES[alias].map(normalizeRoadText).map(name => map.get(name)).find(Boolean);
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampText(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
    const pad = part => String(part).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }
  return String(value ?? "").trim();
}

export function congestionLevel(value, ratio = null) {
  const normalized = normalizeRoadText(value);
  if (/thong thoang|binh thuong|tot/.test(normalized)) return "Thông thoáng";
  if (/nang|nghiem trong|ket xe/.test(normalized)) return "Tắc nghẽn nặng";
  if (/un tac|tac nghen/.test(normalized)) return "Ùn tắc";
  if (/dong|cham/.test(normalized)) return "Đông";
  if (!Number.isFinite(ratio)) return null;
  if (ratio >= .7) return "Thông thoáng";
  if (ratio >= .4) return "Đông";
  if (ratio >= .2) return "Ùn tắc";
  return "Tắc nghẽn nặng";
}

export function normalizeCongestionRecords(records) {
  if (!Array.isArray(records) || !records.length) return null;
  const fields = fieldMap(records[0]);
  const roadName = sourceField(fields, "roadName");
  const timestamp = sourceField(fields, "timestamp");
  const level = sourceField(fields, "level");
  const speed = sourceField(fields, "speed");
  const freeFlowSpeed = sourceField(fields, "freeFlowSpeed");
  if (!roadName || !timestamp || (!level && !(speed && freeFlowSpeed))) return null;
  const routeRef = sourceField(fields, "routeRef");
  const ratioField = sourceField(fields, "ratio");
  const volume = sourceField(fields, "volume");
  const normalized = records.map(row => {
    const averageSpeed = numeric(row[speed]);
    const clearSpeed = numeric(row[freeFlowSpeed]);
    const suppliedRatio = numeric(row[ratioField]);
    const ratio = suppliedRatio ?? (averageSpeed != null && clearSpeed > 0 ? Math.min(1, averageSpeed / clearSpeed) : null);
    return {
      roadName: String(row[roadName] ?? "").trim(),
      routeRef: String(row[routeRef] ?? "").trim(),
      timestamp: timestampText(row[timestamp]),
      speed: averageSpeed,
      freeFlowSpeed: clearSpeed,
      ratio,
      level: congestionLevel(row[level], ratio),
      volume: numeric(row[volume])
    };
  }).filter(row => row.roadName && row.timestamp && row.level);
  return normalized.length ? normalized : null;
}

function propertyValues(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function indexRoads(roads) {
  const byName = new Map();
  const byRef = new Map();
  for (const feature of roads?.features || []) {
    for (const value of propertyValues(feature.properties?.name)) {
      const key = normalizeRoadText(value);
      if (key) (byName.get(key) || byName.set(key, []).get(key)).push(feature);
    }
    for (const value of propertyValues(feature.properties?.ref)) {
      const key = canonicalRef(value);
      if (key) (byRef.get(key) || byRef.set(key, []).get(key)).push(feature);
    }
  }
  return { byName, byRef };
}

export function joinCongestionToRoads(records, roads) {
  if (!records?.length) throw new Error("Không có bản ghi ùn tắc hợp lệ.");
  if (roads?.type !== "FeatureCollection") throw new Error("Dữ liệu tuyến đường Hà Nội không hợp lệ.");
  const indexes = indexRoads(roads);
  const times = [...new Set(records.map(row => row.timestamp))].sort();
  const byTime = new Map();
  for (const time of times) {
    const rows = records.filter(row => row.timestamp === time);
    const features = [];
    const unmatched = [];
    for (const row of rows) {
      const named = indexes.byName.get(normalizeRoadText(row.roadName)) || [];
      const matched = named.length ? named : indexes.byRef.get(canonicalRef(row.routeRef)) || [];
      if (!matched.length) { unmatched.push(row.roadName); continue; }
      for (const feature of matched) {
        features.push({
          ...feature,
          properties: {
            ...(feature.properties || {}), traffic_road_name: row.roadName, traffic_route_ref: row.routeRef,
            traffic_timestamp: row.timestamp, traffic_speed: row.speed, traffic_free_flow_speed: row.freeFlowSpeed,
            traffic_ratio: row.ratio, traffic_level: row.level, traffic_volume: row.volume
          }
        });
      }
    }
    byTime.set(time, {
      type: "FeatureCollection",
      features,
      stats: { totalRows: rows.length, matchedRows: rows.length - unmatched.length, unmatched, segmentCount: features.length }
    });
  }
  return { records, times, byTime };
}

export function congestionAtTime(data, time) {
  return data?.byTime?.get(time) || { type: "FeatureCollection", features: [], stats: { totalRows: 0, matchedRows: 0, unmatched: [], segmentCount: 0 } };
}

export function congestionLineColorExpression() {
  return ["match", ["get", "traffic_level"],
    "Thông thoáng", CONGESTION_COLORS["Thông thoáng"],
    "Đông", CONGESTION_COLORS["Đông"],
    "Ùn tắc", CONGESTION_COLORS["Ùn tắc"],
    "Tắc nghẽn nặng", CONGESTION_COLORS["Tắc nghẽn nặng"],
    "#94a3b8"];
}

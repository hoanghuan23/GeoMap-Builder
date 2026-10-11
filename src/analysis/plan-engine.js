import { assertSchema } from "./plan-schema.js";
import { numeric, metricFields, coordinateFields } from "./data-profile.js";

const CHARTS = ["bar", "line-chart", "pie", "halfPie"];
const SOURCE_INDEX = Symbol("sourceIndex");
export const isChartPlan = plan => CHARTS.includes(plan.renderer);
export function normalizeColors(rules) {
  const stops = rules?.stops;
  if (!Array.isArray(stops) || !stops.length || stops.length > 20) return [];
  if (stops.some((s, i) => !s || typeof s !== "object" ||
    (i < stops.length - 1 && !Number.isFinite(s.max)) ||
    (i > 0 && s.min != null && s.min !== stops[i - 1].max))) return [];
  const colors = stops.map(s => ({ max: Number.isFinite(s.max) ? s.max : null, color: s.color }));
  return validColors(colors) ? colors : [];
}
function validColors(colors) {
  return !colors.length || colors.length <= 20 && colors.every((c, i) => /^#[\da-f]{6}$/i.test(c.color) &&
    (i === colors.length - 1 ? c.max === null : Number.isFinite(c.max) && (i === 0 || c.max > colors[i - 1].max)));
}
export function defaultColors(field) {
  if (!field || field.min === null) return [];
  const palette = ["#eff6ff", "#60a5fa", "#3b82f6", "#1d4ed8", "#172554"];
  return palette.map((color, i) => ({ max: i === 4 ? null : field.min + (field.max - field.min || 1) * (i + 1) / 5, color }));
}

/** A conservative fallback; all decisions use discovered paths and relationships. */
export function localPlan(profile, preferredSource = null) {
  const spatial = profile.datasets.filter(d => d.kind === "geojson");
  if (!preferredSource && spatial.length > 1) throw new Error("Có nhiều lớp không gian. Hãy chọn nguồn dữ liệu để tiếp tục.");
  const source = preferredSource ? profile.datasets.find(d => d.path === preferredSource) : spatial[0] || profile.datasets.find(d => metricFields(d).length);
  if (!source) throw new Error("Không tìm thấy tập dữ liệu có thể hiển thị.");
  const relations = profile.joins.filter(j => j.source === source.path && metricFields(profile.datasets.find(d => d.path === j.target)).length);
  if (relations.length > 1) throw new Error("Có nhiều phép nối phù hợp. Hãy chọn bảng và khóa nối.");
  const relation = relations[0]; const values = relation ? profile.datasets.find(d => d.path === relation.target) : source;
  const metrics = metricFields(values);
  const metric = metrics.find(f => f.path.split(".").pop() === profile.metadata.metric) || metrics[0];
  const coords = coordinateFields(source);
  const renderer = source.geometryTypes.some(t => /Polygon/.test(t)) ? "polygon" : source.geometryTypes.some(t => /LineString/.test(t)) ? "line"
    : source.kind === "geojson" || coords.latitude && coords.longitude ? "circle" : "bar";
  const colors = profile.styleRules?.metric === metric?.path.split(".").pop() ? normalizeColors(profile.styleRules) : [];
  return {
    version: 1, source: source.path, renderer, metric: metric?.path || null,
    category: source.fields.find(f => f.time)?.path || source.fields.find(f => f.type === "string" && f.path !== "type" && !f.path.endsWith("geometry_type") && f.uniqueCount > 1)?.path ||
      source.fields.find(f => f.path !== metric?.path && f.uniqueCount > 1)?.path || null,
    latitude: coords.latitude, longitude: coords.longitude,
    join: relation ? { source: relation.target, sourceKey: relation.sourceKey, targetKey: relation.targetKey } : null,
    time: values.fields.find(f => f.time) ? { field: values.fields.find(f => f.time).path } : null,
    unit: profile.metadata.unit || "", reason: "Phân tích cục bộ: chọn nguồn, trường số và phép nối từ cấu trúc dữ liệu.",
    colors: colors.length ? colors : defaultColors(metric), operations: []
  };
}

export function validatePlan(plan, profile) {
  assertSchema(plan);
  const source = profile.datasets.find(d => d.path === plan.source);
  if (!source) throw new Error("Nguồn dữ liệu không tồn tại.");
  const values = plan.join ? profile.datasets.find(d => d.path === plan.join.source) : source;
  if (!values) throw new Error("Bảng nối không tồn tại.");
  const requireField = (dataset, field) => {
    if (!field || !dataset.fields.some(f => f.path === field)) throw new Error(`Trường không tồn tại: ${field || "chưa chọn"}.`);
  };
  if (plan.join) {
    if (source.kind !== "geojson" || values.kind !== "table" || isChartPlan(plan)) throw new Error("Phép nối cần lớp GeoJSON và bảng đo cho bản đồ.");
    requireField(source, plan.join.sourceKey); requireField(values, plan.join.targetKey);
    const unique = new Set();
    for (const row of source.records) {
      const key = row[plan.join.sourceKey];
      if (key == null || unique.has(key)) throw new Error("Khóa geometry thiếu hoặc trùng. Hãy chỉnh mapping.");
      unique.add(key);
    }
  }
  if (plan.metric) requireField(values, plan.metric);
  if (plan.category) requireField(source, plan.category);
  if (plan.time) requireField(values, plan.time.field);
  if (profile.metadata.crs && !["EPSG:4326", "WGS84", "WGS 84"].includes(profile.metadata.crs)) throw new Error("Cần chuyển tọa độ về EPSG:4326 trước khi hiển thị.");
  if (isChartPlan(plan) && (!plan.metric || !plan.category || plan.join)) throw new Error("Biểu đồ cần danh mục và chỉ số hợp lệ.");
  if (plan.renderer === "metro") {
    if (!profile.datasets.some(d => d.path === "metro_route") || !profile.datasets.some(d => d.path === "stations")) throw new Error("Thiếu các lớp Metro.");
  } else if (!isChartPlan(plan)) {
    const geometries = source.geometryTypes;
    if (plan.renderer === "polygon" && !geometries.some(t => /Polygon/.test(t))) throw new Error("Renderer polygon cần geometry diện tích.");
    if (plan.renderer === "line" && !geometries.some(t => /LineString/.test(t))) throw new Error("Renderer line cần geometry đường.");
    if (["point", "circle", "heatmap"].includes(plan.renderer) && !geometries.some(t => /Point/.test(t))) {
      requireField(source, plan.latitude); requireField(source, plan.longitude);
    }
    if (plan.renderer === "heatmap" && !plan.metric) throw new Error("Heatmap cần chỉ số số.");
  }
  if (!validColors(plan.colors)) throw new Error("Ngưỡng hoặc mã màu không hợp lệ.");
  let fields = new Set(values.fields.map(f => f.path));
  if (plan.operations.length > 20) throw new Error("Quá nhiều phép xử lý.");
  for (const op of plan.operations) {
    if (op.op === "select") {
      if (!op.fields.length || op.fields.some(f => !fields.has(f))) throw new Error("Trường chọn không hợp lệ.");
      fields = new Set(op.fields);
    } else {
      if (!fields.has(op.field)) throw new Error(`Trường xử lý không tồn tại: ${op.field}.`);
      const methods = { cast: ["number", "string"], filter: ["eq", "gt", "lt"], aggregate: ["sum", "mean", "min", "max", "count"], sort: ["asc", "desc"] };
      if (!methods[op.op]?.includes(op.method)) throw new Error("Phương thức xử lý không hợp lệ.");
      if (op.op === "aggregate") {
        if (!plan.join && source.kind === "geojson" && !isChartPlan(plan)) throw new Error("Không tổng hợp geometry; hãy tổng hợp bảng đo trước phép nối.");
        if (op.fields.some(f => !fields.has(f))) throw new Error("Trường nhóm không tồn tại.");
        fields = new Set([...op.fields, op.field]);
      }
    }
  }
  const needed = [plan.metric, plan.time?.field, plan.join?.targetKey, !plan.join ? plan.category : null].filter(Boolean);
  if (needed.some(f => !fields.has(f))) throw new Error("Phép xử lý đã loại trường cần cho render.");
  return plan;
}

export function transformRows(input, operations) {
  let rows = input.map(r => ({ ...r }));
  for (const op of operations) {
    if (op.op === "select") rows = rows.map(r => ({ ...Object.fromEntries(op.fields.map(f => [f, r[f]])), [SOURCE_INDEX]: r[SOURCE_INDEX] }));
    if (op.op === "cast") rows = rows.map(r => ({ ...r, [op.field]: op.method === "number" ? numeric(r[op.field]) : r[op.field] == null ? null : String(r[op.field]) }));
    if (op.op === "filter") rows = rows.filter(r => op.method === "eq" ? r[op.field] === op.value : numeric(r[op.field]) !== null && numeric(op.value) !== null && (op.method === "gt" ? numeric(r[op.field]) > numeric(op.value) : numeric(r[op.field]) < numeric(op.value)));
    if (op.op === "sort") rows.sort((a, b) => (typeof a[op.field] === "number" && typeof b[op.field] === "number" ? a[op.field] - b[op.field] : String(a[op.field]).localeCompare(String(b[op.field]))) * (op.method === "desc" ? -1 : 1));
    if (op.op === "aggregate") {
      const groups = new Map();
      for (const r of rows) { const key = JSON.stringify(op.fields.map(f => r[f])); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
      rows = [...groups.values()].map(group => {
        const numbers = group.map(r => numeric(r[op.field])).filter(v => v !== null);
        const sum = numbers.reduce((a, b) => a + b, 0);
        const result = op.method === "count" ? group.length : !numbers.length ? null : op.method === "sum" ? sum : op.method === "mean" ? sum / numbers.length : numbers.reduce((a, b) => op.method === "min" ? Math.min(a, b) : Math.max(a, b));
        return { ...Object.fromEntries(op.fields.map(f => [f, group[0][f]])), [op.field]: result };
      });
    }
  }
  return rows;
}

export function compilePlan(plan, profile) {
  validatePlan(plan, profile);
  const source = profile.datasets.find(d => d.path === plan.source);
  const values = plan.join ? profile.datasets.find(d => d.path === plan.join.source) : source;
  const rows = transformRows(values.records.map((r, i) => ({ ...r, [SOURCE_INDEX]: i })), plan.operations)
    .map(r => plan.metric ? { ...r, [plan.metric]: numeric(r[plan.metric]) } : r);
  if (plan.metric && !rows.some(r => r[plan.metric] !== null)) throw new Error("Chỉ số không có giá trị số hợp lệ.");
  const times = plan.time ? [...new Set(rows.map(r => r[plan.time.field]).filter(v => v != null && v !== "").map(String))].sort() : [];
  if (plan.time && !times.length) throw new Error("Không có mốc thời gian hợp lệ.");
  const byTime = new Map();
  const geometryKeys = plan.join ? new Set(source.records.map(r => r[plan.join.sourceKey])) : null;
  let matchingKeys = 0;
  if (plan.join) for (const row of rows) {
    const time = plan.time ? String(row[plan.time.field] ?? "") : "";
    if (!byTime.has(time)) byTime.set(time, new Map());
    const index = byTime.get(time); const key = row[plan.join.targetKey];
    if (key == null || index.has(key)) throw new Error("Khóa đo trùng hoặc thiếu theo thời gian. Hãy chỉnh mapping hoặc tổng hợp dữ liệu.");
    index.set(key, row);
    if (geometryKeys.has(key)) matchingKeys++;
  }
  if (plan.join && !matchingKeys) throw new Error("Khóa bảng đo không khớp lớp không gian. Hãy chỉnh mapping.");
  // Prefer file rules for this metric. Thresholds are fixed across all time frames.
  const rules = profile.styleRules?.metric === plan.metric?.split(".").pop() ? normalizeColors(profile.styleRules) : [];
  const field = values.fields.find(f => f.path === plan.metric);
  const colors = rules.length ? rules : plan.colors.length ? plan.colors : defaultColors(field);
  return { plan, source, rows, times, colors,
    atTime(time = times[0]) {
      if (isChartPlan(plan)) return rows;
      const index = byTime.get(plan.time ? time : "") || new Map();
      const selected = !plan.join && plan.time ? rows.filter(r => String(r[plan.time.field]) === time) : rows;
      const items = plan.join ? source.records.map((r, i) => ({ r, feature: source.features[i], value: index.get(r[plan.join.sourceKey]) }))
        : selected.map(r => ({ r, value: r, feature: source.features?.[r[SOURCE_INDEX]] }));
      return { type: "FeatureCollection", features: items.map(({ r, value, feature }) => {
        let geometry = feature?.geometry;
        if (!geometry && plan.latitude && plan.longitude) {
          const lat = numeric(r[plan.latitude]); const lon = numeric(r[plan.longitude]);
          if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error("Tọa độ không hợp lệ.");
          geometry = { type: "Point", coordinates: [lon, lat] };
        }
        if (!geometry) throw new Error("Phép biến đổi không giữ được geometry. Hãy chỉnh mapping.");
        return { type: "Feature", geometry, properties: { ...(feature?.properties || r),
          __value: plan.metric ? numeric(value?.[plan.metric]) : null,
          __time: time || "", __id: plan.join ? r[plan.join.sourceKey] : feature?.properties?.cell_id || "",
          __unit: plan.unit } };
      }) };
    }
  };
}

export function colorForValue(value, colors, missing = "#64748b") {
  const n = numeric(value);
  return n === null || !colors.length ? missing : (colors.find(c => c.max === null || n <= c.max)?.color || missing);
}
export function fillForColors(colors, fallback = "#6c5ce7") {
  if (!colors.length) return fallback;
  return ["case", ["==", ["get", "__value"], null], "#64748b",
    ...colors.filter(c => c.max !== null).flatMap(c => [["<=", ["get", "__value"], c.max], c.color]), colors.at(-1).color];
}

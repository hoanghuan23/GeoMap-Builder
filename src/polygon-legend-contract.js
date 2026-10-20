import { AGGREGATION_VALUES, measureAggregation } from "./measure-semantics.js";

export const LEGEND_SCHEMA_VERSION = 2;
export const LEGEND_MAX_STOPS = 12;
export const LEGEND_REQUEST_TIMEOUT_MS = 30_000;
const UNIT_SOURCES = ["explicit", "inferred", "unknown"];
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const LEGEND_KEYS = ["legendSchemaVersion", "field", "aggregation", "type", "mode", "title", "unit", "domain", "center", "stops", "reason"];

function legendSchema(type) {
  return {
    type: "object", additionalProperties: false, required: LEGEND_KEYS,
    properties: {
      legendSchemaVersion: { type: "integer", enum: [LEGEND_SCHEMA_VERSION] },
      field: { type: "string" },
      aggregation: nullable({ type: "string", enum: AGGREGATION_VALUES }),
      type: { type: "string", enum: [type] },
      mode: { type: "string", enum: type === "diverging" ? ["semantic"] : ["auto", "semantic"] },
      title: { type: "string" }, unit: nullable({ type: "string" }),
      domain: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      center: type === "diverging" ? { type: "number" } : { type: "null" },
      stops: {
        type: "array", minItems: type === "diverging" ? 3 : 2, maxItems: LEGEND_MAX_STOPS,
        items: {
          type: "object", additionalProperties: false, required: ["value", "color"],
          properties: { value: { type: "number" }, color: { type: "string" } }
        }
      },
      reason: { type: "string" }
    }
  };
}

export const POLYGON_LEGEND_SCHEMA = Object.freeze({ anyOf: [legendSchema("continuous"), legendSchema("diverging")] });
export const POLYGON_LEGENDS_RESPONSE_SCHEMA = Object.freeze({
  type: "object", additionalProperties: false, required: ["legends"],
  properties: { legends: { type: "array", maxItems: 200, items: POLYGON_LEGEND_SCHEMA } }
});

/** Canonicalize unit spelling only; never convert or infer numeric values. */
export function normalizeLegendUnit(unit) {
  if (typeof unit !== "string" || !unit.trim()) return null;
  const text = unit.trim();
  if (["°c", "℃", "celsius"].includes(text.toLowerCase())) return "°C";
  if (["°f", "℉", "fahrenheit"].includes(text.toLowerCase())) return "°F";
  return text;
}

export function polygonLegendTarget(column, aggregation = measureAggregation(column)) {
  return {
    field: column?.name,
    aggregation: aggregation ?? null,
    unit: aggregation === "count" ? "bản ghi" : normalizeLegendUnit(column?.unit)
  };
}

export function polygonLegendKey(target) {
  return JSON.stringify([target?.field, target?.aggregation ?? null, normalizeLegendUnit(target?.unit)]);
}

export function normalizePolygonLegendRecommendation(raw, target = {}, { onFallback } = {}) {
  if (raw == null) return null;
  const fail = (code, reason) => { onFallback?.(reason, code); return null; };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("INVALID_LEGEND", "Cấu hình chú giải không phải object.");
  if (raw.legendSchemaVersion !== LEGEND_SCHEMA_VERSION) return fail("LEGACY_LEGEND", "Chú giải cũ hoặc version không được hỗ trợ.");
  if (LEGEND_KEYS.some(key => !Object.hasOwn(raw, key)) || Object.keys(raw).some(key => !LEGEND_KEYS.includes(key))) {
    return fail("INVALID_SHAPE", "Cấu hình chú giải thiếu trường hoặc có trường không được hỗ trợ.");
  }
  if (typeof raw.field !== "string" || !raw.field.trim() || raw.field.length > 500
    || raw.aggregation !== null && !AGGREGATION_VALUES.includes(raw.aggregation)) return fail("INVALID_TARGET", "Trường hoặc phép tổng hợp không hợp lệ.");
  if (target.role != null && target.role !== "measure" || target.field != null && raw.field !== target.field
    || Object.hasOwn(target, "aggregation") && raw.aggregation !== target.aggregation) return fail("TARGET_MISMATCH", "Chú giải không khớp trường hoặc phép tổng hợp đang hiển thị.");
  if (raw.unit !== null && (typeof raw.unit !== "string" || !raw.unit.trim() || raw.unit.length > 80)) return fail("INVALID_UNIT", "Đơn vị chú giải không hợp lệ.");
  const unit = normalizeLegendUnit(raw.unit);
  if (Object.hasOwn(target, "unit") && unit !== normalizeLegendUnit(target.unit)) return fail("UNIT_MISMATCH", "Đơn vị chú giải không khớp giá trị đang hiển thị.");
  if (!["continuous", "diverging"].includes(raw.type) || !["auto", "semantic"].includes(raw.mode)
    || raw.type === "diverging" && raw.mode !== "semantic") return fail("UNSUPPORTED_SCALE", "Loại hoặc chế độ chú giải chưa được hỗ trợ.");
  if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 160
    || typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 800) return fail("INVALID_TEXT", "Tiêu đề hoặc giải thích chú giải không hợp lệ.");
  if (!Array.isArray(raw.domain) || raw.domain.length !== 2 || !raw.domain.every(Number.isFinite)
    || raw.domain[0] >= raw.domain[1] || !Number.isFinite(raw.domain[1] - raw.domain[0])) return fail("INVALID_DOMAIN", "Miền chú giải phải có hai số hữu hạn tăng dần.");
  if (!Array.isArray(raw.stops) || raw.stops.length < 2 || raw.stops.length > LEGEND_MAX_STOPS) return fail("INVALID_STOPS", "Số mốc màu không hợp lệ.");
  for (let i = 0; i < raw.stops.length; i += 1) {
    const stop = raw.stops[i];
    if (!stop || Object.keys(stop).some(key => !["value", "color"].includes(key)) || !Number.isFinite(stop.value)
      || typeof stop.color !== "string" || !/^#[0-9a-f]{6}$/i.test(stop.color)
      || i > 0 && stop.value <= raw.stops[i - 1].value) return fail("INVALID_STOPS", "Mốc màu phải tăng nghiêm ngặt và có màu hex hợp lệ.");
  }
  if (raw.stops[0].value !== raw.domain[0] || raw.stops.at(-1).value !== raw.domain[1]) return fail("DOMAIN_COVERAGE", "Hai mốc màu biên phải trùng miền chú giải.");
  if (raw.type === "continuous" ? raw.center !== null : !Number.isFinite(raw.center)
    || raw.center <= raw.domain[0] || raw.center >= raw.domain[1] || !raw.stops.some(stop => stop.value === raw.center)) {
    return fail("INVALID_CENTER", "Thang diverging cần mốc tâm nằm giữa hai phía; continuous không có tâm.");
  }
  return {
    legendSchemaVersion: LEGEND_SCHEMA_VERSION, field: raw.field, aggregation: raw.aggregation,
    type: raw.type, mode: raw.mode, title: raw.title.trim(), unit, domain: [...raw.domain], center: raw.center,
    stops: raw.stops.map(stop => ({ value: stop.value, color: stop.color.toLowerCase() })), reason: raw.reason.trim()
  };
}

/** Validate each target independently, rejecting unknown and ambiguous duplicates. */
export function normalizePolygonLegendBatch(raw, targets) {
  const expected = new Map(targets.map(target => [polygonLegendKey(target), target]));
  const errors = new Set(Array.isArray(raw?.validationErrors) ? raw.validationErrors.filter(error => typeof error === "string") : []);
  const candidates = new Map();
  for (const item of Array.isArray(raw?.legends) ? raw.legends : []) {
    const key = polygonLegendKey(item);
    if (!expected.has(key)) { errors.add(`UNKNOWN_TARGET: ${item?.field || "(trống)"}`); continue; }
    const items = candidates.get(key) || []; items.push(item); candidates.set(key, items);
  }
  const legends = [];
  for (const [key, target] of expected) {
    const items = candidates.get(key) || [];
    if (items.length > 1) errors.add(`DUPLICATE_TARGET: ${target.field}`);
    const legend = items.length === 1 ? normalizePolygonLegendRecommendation(items[0], target, {
      onFallback: (reason, code) => errors.add(`${code}: ${target.field}: ${reason}`)
    }) : null;
    if (legend) legends.push(legend);
    else errors.add(`MISSING_LEGEND: ${target.field} (${target.aggregation ?? "none"})`);
  }
  return { legends, validationErrors: [...errors] };
}

/** Whitelist the summary payload so samples, source records and geometry cannot leak. */
export function normalizePolygonLegendRequest(body) {
  if (!Array.isArray(body?.targets) || !body.targets.length || body.targets.length > 200) throw new Error("Danh sách chỉ số chú giải không hợp lệ.");
  const seen = new Set();
  const targets = body.targets.map(raw => {
    const stats = raw?.renderStatistics;
    if (typeof raw?.field !== "string" || !raw.field.trim() || raw.field.length > 500
      || raw.aggregation !== null && !AGGREGATION_VALUES.includes(raw.aggregation)
      || raw.unit !== null && (typeof raw.unit !== "string" || !raw.unit.trim() || raw.unit.length > 80)
      || !stats || !["min", "max", "mean", "p10", "p50", "p90"].every(key => Number.isFinite(stats[key]))
      || !Number.isInteger(stats.validCount) || stats.validCount < 1 || !Number.isInteger(stats.missingCount) || stats.missingCount < 0
      || stats.min > stats.max || stats.p10 < stats.min || stats.p90 > stats.max || stats.p10 > stats.p50 || stats.p50 > stats.p90) {
      throw new Error("Metadata hoặc thống kê Polygon không hợp lệ.");
    }
    const target = {
      field: raw.field, aggregation: raw.aggregation, unit: normalizeLegendUnit(raw.unit),
      labelVi: typeof raw.labelVi === "string" ? raw.labelVi.slice(0, 160) : raw.field,
      unitSource: raw.unit == null ? "unknown" : UNIT_SOURCES.includes(raw.unitSource) ? raw.unitSource : "inferred",
      semanticType: typeof raw.semanticType === "string" ? raw.semanticType.slice(0, 120) : null,
      renderStatistics: Object.fromEntries(["min", "max", "mean", "p10", "p50", "p90", "validCount", "missingCount"].map(key => [key, stats[key]]))
    };
    const key = polygonLegendKey(target);
    if (seen.has(key)) throw new Error("Chỉ số chú giải bị trùng.");
    seen.add(key);
    return target;
  });
  const context = body.context || {};
  if (typeof context.regionField !== "string" || !context.regionField.trim()
    || !Number.isInteger(context.matchedRegionCount) || context.matchedRegionCount < 1) throw new Error("Ngữ cảnh Polygon không hợp lệ.");
  const scalar = value => value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
  const filters = Object.fromEntries(Object.entries(context.filters || {}).filter(([, value]) => scalar(value)
    || Array.isArray(value) && value.every(scalar)));
  return { targets, context: {
    regionField: context.regionField, matchedRegionCount: context.matchedRegionCount, filters,
    timeRange: Array.isArray(context.timeRange) && context.timeRange.length === 2 && context.timeRange.every(scalar) ? [...context.timeRange] : null
  } };
}

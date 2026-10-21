import { AGGREGATION_VALUES, measureAggregation } from "./measure-semantics.js";

export const LEGEND_MAX_STOPS = 12;
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const LEGEND_KEYS = ["aggregation", "type", "mode", "title", "unit", "domain", "center", "stops", "reason"];
const LEGACY_LEGEND_KEYS = ["legendSchemaVersion", "field"];

function legendSchema(type) {
  return {
    type: "object", additionalProperties: false, required: LEGEND_KEYS,
    properties: {
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
  // Accept the former v2 metadata on input, but never emit it in normalized output.
  if (Object.hasOwn(raw, "legendSchemaVersion") && raw.legendSchemaVersion !== 2) return fail("LEGACY_LEGEND", "Chú giải cũ hoặc version không được hỗ trợ.");
  if (LEGEND_KEYS.some(key => !Object.hasOwn(raw, key))
    || Object.keys(raw).some(key => !LEGEND_KEYS.includes(key) && !LEGACY_LEGEND_KEYS.includes(key))) {
    return fail("INVALID_SHAPE", "Cấu hình chú giải thiếu trường hoặc có trường không được hỗ trợ.");
  }
  if (Object.hasOwn(raw, "field") && (typeof raw.field !== "string" || !raw.field.trim() || raw.field.length > 500)
    || raw.aggregation !== null && !AGGREGATION_VALUES.includes(raw.aggregation)) return fail("INVALID_TARGET", "Trường hoặc phép tổng hợp không hợp lệ.");
  if (target.role != null && target.role !== "measure" || Object.hasOwn(raw, "field") && target.field != null && raw.field !== target.field
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
    aggregation: raw.aggregation,
    type: raw.type, mode: raw.mode, title: raw.title.trim(), unit, domain: [...raw.domain], center: raw.center,
    stops: raw.stops.map(stop => ({ value: stop.value, color: stop.color.toLowerCase() })), reason: raw.reason.trim()
  };
}

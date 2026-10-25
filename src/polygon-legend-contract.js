import { AGGREGATION_VALUES, measureAggregation } from "./measure-semantics.js";

export const LEGEND_MAX_STOPS = 12;
const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const LEGEND_KEYS = ["aggregation", "type", "mode", "title", "unit", "domain", "center", "stops", "reason"];
const LEGACY_LEGEND_KEYS = ["legendSchemaVersion", "field"];

function legendSchema(type) {
  const categorical = type === "categorical";
  return {
    type: "object", additionalProperties: false, required: categorical ? [...LEGEND_KEYS, "combinations"] : LEGEND_KEYS,
    properties: {
      aggregation: categorical ? { type: "null" } : nullable({ type: "string", enum: AGGREGATION_VALUES }),
      type: { type: "string", enum: [type] },
      mode: { type: "string", enum: categorical || type === "diverging" ? ["semantic"] : ["auto", "semantic"] },
      title: { type: "string" }, unit: categorical ? { type: "null" } : nullable({ type: "string" }),
      domain: categorical ? { type: "null" } : { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      center: type === "diverging" ? { type: "number" } : { type: "null" },
      stops: {
        type: "array", minItems: categorical ? 1 : type === "diverging" ? 3 : 2, maxItems: LEGEND_MAX_STOPS,
        items: {
          type: "object", additionalProperties: false, required: ["value", "color"],
          properties: { value: { type: categorical ? "string" : "number" }, color: { type: "string" } }
        }
      },
      ...(categorical ? { combinations: {
        type: "array", maxItems: 64, items: {
          type: "object", additionalProperties: false, required: ["values", "color"], properties: {
            values: { type: "array", items: { type: "string" }, minItems: 2, maxItems: LEGEND_MAX_STOPS }, color: { type: "string" }
          }
        }
      } } : {}),
      reason: { type: "string" }
    }
  };
}

export const POLYGON_LEGEND_SCHEMA = Object.freeze({ anyOf: [legendSchema("continuous"), legendSchema("diverging"), legendSchema("categorical")] });
/** Canonicalize unit spelling only; never convert or infer numeric values. */
export function normalizeLegendUnit(unit) {
  if (typeof unit !== "string" || !unit.trim()) return null;
  const text = unit.trim();
  if (["°c", "℃", "celsius"].includes(text.toLowerCase())) return "°C";
  if (["°f", "℉", "fahrenheit"].includes(text.toLowerCase())) return "°F";
  return text;
}

export function polygonLegendTarget(column, aggregation = measureAggregation(column)) {
  if (column?.role === "category") return { field: column.name, aggregation: null, unit: null };
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
  const keys = raw.type === "categorical" ? [...LEGEND_KEYS, "combinations"] : LEGEND_KEYS;
  if (keys.some(key => !Object.hasOwn(raw, key))
    || Object.keys(raw).some(key => !keys.includes(key) && !LEGACY_LEGEND_KEYS.includes(key))) {
    return fail("INVALID_SHAPE", "Cấu hình chú giải thiếu trường hoặc có trường không được hỗ trợ.");
  }
  if (Object.hasOwn(raw, "field") && (typeof raw.field !== "string" || !raw.field.trim() || raw.field.length > 500)
    || raw.aggregation !== null && !AGGREGATION_VALUES.includes(raw.aggregation)) return fail("INVALID_TARGET", "Trường hoặc phép tổng hợp không hợp lệ.");
  if (target.role != null && target.role !== (raw.type === "categorical" ? "category" : "measure") || Object.hasOwn(raw, "field") && target.field != null && raw.field !== target.field
    || Object.hasOwn(target, "aggregation") && raw.aggregation !== target.aggregation) return fail("TARGET_MISMATCH", "Chú giải không khớp trường hoặc phép tổng hợp đang hiển thị.");
  if (raw.unit !== null && (typeof raw.unit !== "string" || !raw.unit.trim() || raw.unit.length > 80)) return fail("INVALID_UNIT", "Đơn vị chú giải không hợp lệ.");
  const unit = normalizeLegendUnit(raw.unit);
  if (Object.hasOwn(target, "unit") && unit !== normalizeLegendUnit(target.unit)) return fail("UNIT_MISMATCH", "Đơn vị chú giải không khớp giá trị đang hiển thị.");
  if (raw.type === "categorical") {
    if (raw.aggregation !== null || raw.unit !== null || raw.domain !== null || raw.center !== null || raw.mode !== "semantic") return fail("INVALID_CATEGORY_SCALE", "Chú giải phân loại không dùng phép gộp, đơn vị hoặc miền số.");
    if (typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 160 || typeof raw.reason !== "string" || !raw.reason.trim() || raw.reason.length > 800) return fail("INVALID_TEXT", "Tiêu đề hoặc giải thích chú giải không hợp lệ.");
    if (!Array.isArray(raw.stops) || !raw.stops.length || raw.stops.length > LEGEND_MAX_STOPS) return fail("INVALID_STOPS", "Số nhóm màu không hợp lệ.");
    const values = new Set(); const colors = new Set();
    for (const stop of raw.stops) {
      if (!stop || Object.keys(stop).some(key => !["value", "color"].includes(key)) || typeof stop.value !== "string" || !stop.value.trim() || stop.value.length > 500
        || typeof stop.color !== "string" || !/^#[0-9a-f]{6}$/i.test(stop.color) || values.has(stop.value) || colors.has(stop.color.toLowerCase())) return fail("INVALID_STOPS", "Mỗi phân loại cần giá trị gốc và màu HEX riêng, không trùng lặp.");
      values.add(stop.value); colors.add(stop.color.toLowerCase());
    }
    if (!Array.isArray(raw.combinations) || raw.combinations.length > 64) return fail("INVALID_COMBINATIONS", "Danh sách tổ hợp phân loại không hợp lệ.");
    const combinationKeys = new Set();
    for (const combination of raw.combinations) {
      if (!combination || Object.keys(combination).some(key => !["values", "color"].includes(key))
        || !Array.isArray(combination.values) || combination.values.length < 2 || combination.values.length > LEGEND_MAX_STOPS
        || new Set(combination.values).size !== combination.values.length || combination.values.some(value => !values.has(value))
        || typeof combination.color !== "string" || !/^#[0-9a-f]{6}$/i.test(combination.color) || colors.has(combination.color.toLowerCase())) return fail("INVALID_COMBINATIONS", "Mỗi tổ hợp cần các phân loại gốc khác nhau và một màu HEX riêng.");
      const key = JSON.stringify([...combination.values].sort());
      if (combinationKeys.has(key)) return fail("INVALID_COMBINATIONS", "Tổ hợp phân loại bị trùng.");
      combinationKeys.add(key); colors.add(combination.color.toLowerCase());
    }
    return { aggregation: null, type: "categorical", mode: "semantic", title: raw.title.trim(), unit: null, domain: null, center: null,
      stops: raw.stops.map(stop => ({ value: stop.value, color: stop.color.toLowerCase() })),
      combinations: raw.combinations.map(combination => ({ values: [...combination.values].sort(), color: combination.color.toLowerCase() })), reason: raw.reason.trim() };
  }
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

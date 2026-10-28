import { TIME_GRANULARITIES } from "./time-values.js";
import { measureAggregation } from "./measure-semantics.js";
import { normalizePolygonLegendRecommendation, normalizeLegendUnit, polygonLegendTarget, POLYGON_LEGEND_SCHEMA } from "./polygon-legend-contract.js";
import { normalizeDataSearchConfig } from "./data-search-config.js";
import { COUNTRY_REGION_CATALOG, normalizeRegionNavigation } from "./country-regions.js";
import { GEOGRAPHIC_SCOPES_SCHEMA, normalizeGeographicScopes } from "./geographic-scopes.js";

import { POPUP_CONTENT_SCHEMA, normalizePopupContent } from "./popup-content-contract.js";

const ROLE_VALUES = Object.freeze(["geo", "time", "measure", "category", "id", "text", "ignore"]);
const AGG_VALUES = Object.freeze(["sum", "mean", "max", "min", "count"]);
const POPUP_TYPES = Object.freeze(["info", "info_image", "bar", "line"]);

export function normalizePopupSuggestions(raw) {
  const byName = new Map();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || !POPUP_TYPES.includes(item.name) || !Number.isFinite(item.confidence)
      || item.confidence < 0 || item.confidence > 1) continue;
    const previous = byName.get(item.name);
    if (!previous || item.confidence > previous.confidence) byName.set(item.name, { name: item.name, confidence: item.confidence });
  }
  // Map preserves the first occurrence when duplicate entries have their score updated.
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence);
}

export function normalizeMetricButtons(raw, columns, suggestion, profile) {
  if (!["choropleth", "map_line", "point", "hex_h3"].includes(suggestion.chartType)) return [];
  const byName = new Map(columns.map(column => [column.name, column]));
  const profiles = new Map((profile?.columns || []).map(column => [column.name, column]));
  const excluded = new Set([suggestion.bindings.lat, suggestion.bindings.lng, suggestion.bindings.x, suggestion.bindings.region]);
  const seen = new Set(); const buttons = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const column = byName.get(item?.field);
    const category = ["map_line", "choropleth"].includes(suggestion.chartType) && column?.role === "category"
      && Number(profiles.get(item.field)?.uniqueCount) > 0 && Number(profiles.get(item.field)?.uniqueCount) <= 12;
    if (!column || seen.has(item.field) || excluded.has(item.field) || item.field.startsWith("__")
      || ["point_lat", "point_lng", "h3"].includes(column.geoLevel) || column.role !== "measure" && !category) continue;
    const clean = value => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim() : "";
    const label = clean(item.label); const icon = clean(item.icon);
    if (!label || label.length > 80 || !icon || Array.from(icon).length > 12 || /[<>]/.test(icon)
      || typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) continue;
    seen.add(item.field);
    buttons.push({ field: item.field, label, icon, color: item.color.toLowerCase() });
  }
  return buttons;
}


export const AI_CHART_REGISTRY = Object.freeze({
  arc_flow: Object.freeze({
    label: "Bản đồ Arc Flow 3D", icon: "arc_flow", renderer: "deck.gl",
    slots: Object.freeze({
      source: Object.freeze(["id", "category", "text", "geo"]), target: Object.freeze(["id", "category", "text", "geo"]),
      sourceLat: Object.freeze(["geo", "measure"]), sourceLng: Object.freeze(["geo", "measure"]),
      targetLat: Object.freeze(["geo", "measure"]), targetLng: Object.freeze(["geo", "measure"]),
      value: Object.freeze(["measure"]), time: Object.freeze(["time"]), group: Object.freeze(["category", "id", "text", "time"])
    })
  }),
  choropleth: Object.freeze({
    label: "Bản đồ Polygon",
    slots: Object.freeze({ region: Object.freeze(["geo"]), value: Object.freeze(["measure", "category"]) }),
    icon: "polygon",
    renderer: "MapLibre"
  }),
  point: Object.freeze({
    label: "Bản đồ Point",
    slots: Object.freeze({ lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), region: Object.freeze(["id", "category", "text", "geo"]) }),
    icon: "point",
    renderer: "MapLibre"
  }),
  hex_h3: Object.freeze({
    label: "Biểu đồ lục giác",
    slots: Object.freeze({ lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), value: Object.freeze(["measure"]) }),
    icon: "hexagon",
    renderer: "H3"
  }),
  map_line: Object.freeze({
    label: "Bản đồ Line",
    slots: Object.freeze({ region: Object.freeze(["category", "geo", "id", "text"]), value: Object.freeze(["measure", "category"]),
      lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), x: Object.freeze(["time", "id", "measure", "category"]) }),
    icon: "line",
    renderer: "MapLibre"
  }),
  line: Object.freeze({
    label: "Biểu đồ đường",
    slots: Object.freeze({ x: Object.freeze(["time"]), y: Object.freeze(["measure"]), series: Object.freeze(["category", "geo"]) }),
    icon: "line",
    renderer: "Recharts"
  }),
  bar: Object.freeze({
    label: "Biểu đồ cột",
    slots: Object.freeze({ x: Object.freeze(["category", "geo", "time"]), y: Object.freeze(["measure"]) }),
    icon: "singleBar",
    renderer: "Recharts"
  })
});

// Only these map types are accepted by the upload/AI interface. The other
// registry entries remain internal chart/legacy renderers, not input models.
export const AI_MAP_REGISTRY = Object.freeze(Object.fromEntries(["choropleth", "map_line", "point", "arc_flow"].map(type => [type, AI_CHART_REGISTRY[type]])));

export function supportedChartsForPrompt() {
  return Object.fromEntries(Object.entries(AI_MAP_REGISTRY).map(([chartType, spec]) => [chartType, { slots: spec.slots }]));
}

function nullable(schema) {
  return { anyOf: [schema, { type: "null" }] };
}

const LEGEND_SCHEMA = { anyOf: [...POLYGON_LEGEND_SCHEMA.anyOf, { type: "null" }] };

export const ANALYSIS_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["datasetTitle", "grain", "columns", "suggestions", "search_bar", "search_fields", "regionNavigation", "popupContent"],
  properties: {
    popupContent: POPUP_CONTENT_SCHEMA,
    datasetTitle: { type: "string" },
    grain: { type: "string" },
    search_bar: { type: "boolean", description: "Có nên bật tìm kiếm mặc định theo số đối tượng và lợi ích tìm nhanh; không dùng ngưỡng 30 cứng." },
    search_fields: { type: "array", items: { type: "string" }, description: "Tên cột gốc có thật để tìm đối tượng: tên định danh chính trước, ngữ cảnh sau; không chọn cột đo lường." },
    regionNavigation: nullable({
      type: "object", additionalProperties: false, required: ["countryField", "regions"],
      description: "Dropdown lọc khu vực khi dữ liệu chứa tên/mã quốc gia; null khi không phù hợp. Dùng các ID khu vực có sẵn, theo thứ tự AI đề xuất.",
      properties: {
        countryField: { type: "string", description: "Tên cột gốc chứa quốc gia, role geo và geoLevel country." },
        regions: { type: "array", minItems: 1, maxItems: COUNTRY_REGION_CATALOG.length,
          items: { type: "string", enum: COUNTRY_REGION_CATALOG.map(region => region.id) } }
      }
    }),
    columns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "labelVi", "geoLevel", "country", "timeParse", "granularity", "unit", "unitSource", "aggDefault", "semanticType", "legend"],
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ROLE_VALUES },
          labelVi: nullable({ type: "string" }),
          geoLevel: nullable({ type: "string", enum: ["country", "admin1", "admin2", "point_lat", "point_lng", "h3"] }),
          country: nullable({ type: "string" }),
          timeParse: nullable({ type: "string", enum: ["iso", "excel_serial", "unix_s", "unix_ms", "text"] }),
          granularity: nullable({ type: "string", enum: TIME_GRANULARITIES }),
          unit: { ...nullable({ type: "string" }), description: "Đơn vị đo của dữ liệu, được xác định từ tên cột và ngữ cảnh toàn bảng, ví dụ °C, °F, mm, %, triệu đồng. Giữ đơn vị kể cả khi legend.mode là auto; chỉ null khi không xác định được." },
          unitSource: { type: "string", enum: ["explicit", "inferred", "unknown"] },
          aggDefault: nullable({ type: "string", enum: AGG_VALUES }),
          semanticType: nullable({ type: "string" }),
          legend: LEGEND_SCHEMA
        }
      }
    },
    suggestions: {
      type: "array",
      maxItems: Object.keys(AI_MAP_REGISTRY).length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "chartType", "title", "bindings", "agg", "confidence", "reason", "legend", "popupSuggestions", "metricButtons", "geographicScopes"],
        properties: {
          geographicScopes: GEOGRAPHIC_SCOPES_SCHEMA,
          id: { type: "string" },
          chartType: { type: "string", enum: Object.keys(AI_MAP_REGISTRY) },
          title: { type: "string" },
          bindings: {
            type: "object",
            additionalProperties: false,
            required: ["region", "value", "lat", "lng", "x", "y", "series", "source", "target", "sourceLat", "sourceLng", "targetLat", "targetLng", "time", "group"],
            properties: {
              source: nullable({ type: "string" }), target: nullable({ type: "string" }),
              sourceLat: nullable({ type: "string" }), sourceLng: nullable({ type: "string" }),
              targetLat: nullable({ type: "string" }), targetLng: nullable({ type: "string" }),
              time: nullable({ type: "string" }), group: nullable({ type: "string" }),
              region: nullable({ type: "string" }),
              value: nullable({ type: "string" }),
              lat: nullable({ type: "string" }),
              lng: nullable({ type: "string" }),
              x: nullable({ type: "string" }),
              y: nullable({ anyOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }] }),
              series: nullable({ type: "string" })
            }
          },
          agg: nullable({ type: "string", enum: AGG_VALUES }),
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" },
          legend: LEGEND_SCHEMA,
          metricButtons: {
            type: "array",
            description: "Các nút chọn chỉ số do AI thiết kế riêng cho bản đồ này, theo đúng thứ tự hiển thị; [] nếu không cần chọn nhanh.",
            items: {
              type: "object", additionalProperties: false, required: ["field", "label", "icon", "color"],
              properties: {
                field: { type: "string", description: "Tên cột gốc có thật, phù hợp để tô màu Polygon/Line hoặc làm kích thước Point." },
                label: { type: "string", minLength: 1, maxLength: 80, description: "Nhãn tiếng Việt ngắn, giữ đúng ý nghĩa cột; không tự đổi đơn vị." },
                icon: { type: "string", minLength: 1, maxLength: 12, description: "Một emoji hoặc ký hiệu Unicode phù hợp nội dung chỉ số; không sinh HTML, SVG, URL hay code." },
                color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Màu nền biểu tượng do AI chọn theo ý nghĩa chỉ số." }
              }
            }
          },
          popupSuggestions: {
            type: "array", minItems: 1, maxItems: POPUP_TYPES.length,
            items: {
              type: "object", additionalProperties: false, required: ["name", "confidence"],
              properties: {
                name: { type: "string", enum: POPUP_TYPES },
                confidence: { type: "number", minimum: 0, maximum: 1 }
              }
            }
          }
        }
      }
    }
  }
});

function cleanOptional(value, allowed = null) {
  if (value == null || value === "") return null;
  return !allowed || allowed.includes(value) ? value : null;
}

function unclassifiedColumn(column) {
  return {
    name: String(column?.name || ""),
    role: "ignore",
    labelVi: null,
    geoLevel: null,
    country: null,
    timeParse: null,
    granularity: null,
    unit: null,
    unitSource: "unknown",
    aggDefault: null,
    semanticType: null,
    legend: null,
    source: "rule"
  };
}

function normalizeColumn(raw, fallback) {
  if (!raw || !ROLE_VALUES.includes(raw.role)) return fallback;
  return {
    name: fallback.name,
    role: raw.role,
    labelVi: typeof raw.labelVi === "string" && raw.labelVi.trim() ? raw.labelVi.trim() : null,
    geoLevel: raw.role === "geo" ? cleanOptional(raw.geoLevel, ["country", "admin1", "admin2", "point_lat", "point_lng", "h3"]) : null,
    country: raw.role === "geo" && typeof raw.country === "string" && raw.country.trim() ? raw.country.trim().toUpperCase() : null,
    timeParse: cleanOptional(raw.timeParse, ["iso", "excel_serial", "unix_s", "unix_ms", "text"]) || (raw.role === "time" ? fallback.timeParse : null),
    granularity: cleanOptional(raw.granularity, TIME_GRANULARITIES) || (raw.role === "time" ? fallback.granularity : null),
    unit: raw.role === "category" ? null : normalizeLegendUnit(raw.unit),
    unitSource: raw.role === "category" || !normalizeLegendUnit(raw.unit) ? "unknown" : ["explicit", "inferred", "unknown"].includes(raw.unitSource) ? raw.unitSource : "inferred",
    aggDefault: raw.role === "category" ? null : cleanOptional(raw.aggDefault, AGG_VALUES),
    semanticType: raw.role === "measure" && typeof raw.semanticType === "string" && raw.semanticType.trim() ? raw.semanticType.trim().slice(0, 120) : null,
    legend: ["measure", "category"].includes(raw.role) ? raw.legend ?? null : null,
    source: raw.source === "rule" ? "rule" : "ai"
  };
}

function list(value) {
  return Array.isArray(value) ? value : [value];
}

function validateSuggestion(raw, roleOf, fieldNames, seenIds, profile) {
  const spec = AI_CHART_REGISTRY[raw?.chartType];
  if (!spec || typeof raw.id !== "string" || !raw.id.trim() || seenIds.has(raw.id)) return null;
  const b = raw.bindings || {};
  const coordinateLine = raw.chartType === "map_line" && b.lat && b.lng;
  const nativeKind = raw.chartType === "choropleth" ? "area" : raw.chartType === "map_line" ? "line" : null;
  const nativeGeometry = profile?.spatial?.nativeGeometry === true && profile.spatial.geometryKinds?.includes(nativeKind);
  const required = raw.chartType === "arc_flow" ? ["source", "target", "sourceLat", "sourceLng", "targetLat", "targetLng", "value"]
    : nativeGeometry ? [] : coordinateLine ? ["lat", "lng"] : ["choropleth", "map_line"].includes(raw.chartType) ? ["region"]
    : raw.chartType === "point" ? ["lat", "lng"]
      : raw.chartType === "hex_h3" ? ["lat", "lng", "value"]
        : raw.chartType === "line" ? ["x", "y"] : ["x", "y"];
  const normalizedBindings = {};
  for (const slot of required) {
    const value = b[slot];
    if (slot === "y" && raw.chartType === "bar" && value === "count") {
      normalizedBindings.y = "count";
      continue;
    }
    const names = list(value).filter(name => typeof name === "string" && name);
    if (!names.length || raw.chartType === "arc_flow" && (typeof value !== "string" || names.length !== 1)
      || names.some(name => !fieldNames.has(name) || !spec.slots[slot]?.includes(roleOf.get(name)))) return null;
    normalizedBindings[slot] = slot === "y" && raw.chartType === "line" ? [...new Set(names)] : names[0];
  }
  if (raw.chartType === "arc_flow" && new Set(required.map(slot => b[slot])).size !== required.length) return null;
  for (const slot of raw.chartType === "arc_flow" ? ["time", "group"] : nativeGeometry ? ["region", "value"] : coordinateLine ? ["region", "x", "value"] : raw.chartType === "point" ? ["region"] : ["choropleth", "map_line"].includes(raw.chartType) ? ["value"] : []) {
    if (b[slot] == null || b[slot] === "") continue;
    const roles = nativeGeometry && slot === "region" ? ["geo", "category", "id", "text"] : spec.slots[slot];
    if (typeof b[slot] !== "string" || !fieldNames.has(b[slot]) || !roles?.includes(roleOf.get(b[slot]))) return null;
    normalizedBindings[slot] = b[slot];
  }
  if (["choropleth", "map_line"].includes(raw.chartType)) normalizedBindings.value ??= null;
  if (raw.chartType === "line" && typeof b.series === "string" && b.series) {
    if (!fieldNames.has(b.series) || !spec.slots.series.includes(roleOf.get(b.series))) return null;
    normalizedBindings.series = b.series;
  }
  seenIds.add(raw.id);
  return {
    id: raw.id,
    chartType: raw.chartType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : raw.chartType,
    bindings: normalizedBindings,
    agg: ["choropleth", "map_line"].includes(raw.chartType) && (!normalizedBindings.value || roleOf.get(normalizedBindings.value) === "category") ? null : AGG_VALUES.includes(raw.agg) ? raw.agg : null,
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    reason: typeof raw.reason === "string" ? raw.reason.trim() : "",
    legend: ["choropleth", "map_line"].includes(raw.chartType) && normalizedBindings.value ? raw.legend ?? null : null,
    popupSuggestions: normalizePopupSuggestions(raw.popupSuggestions),
    source: "ai"
  };
}

/** An unavailable analysis retains data without making semantic or visualization decisions. */
export function fallbackAnalysis(profile, { datasetTitle = "Dữ liệu tải lên" } = {}) {
  return { datasetTitle, grain: "Chưa có kết quả phân tích AI", columns: (profile?.columns || []).map(unclassifiedColumn),
    suggestions: [], search_bar: false, search_fields: [], source: "rule" };
}

export function validateAndNormalizeAnalysis(raw, profile) {
  const fallback = fallbackAnalysis(profile, { datasetTitle: raw?.datasetTitle || "Dữ liệu tải lên" });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback, validationErrors: ["AI không trả về object hợp lệ."] };
  const actualColumns = profile?.columns || [];
  const fieldNames = new Set(actualColumns.map(column => column.name));
  const rawByName = new Map();
  const errors = Array.isArray(raw.validationErrors) ? raw.validationErrors.filter(error => typeof error === "string") : [];
  for (const column of Array.isArray(raw.columns) ? raw.columns : []) {
    if (!fieldNames.has(column?.name)) { errors.push(`Bỏ cột lạ: ${column?.name || "(trống)"}`); continue; }
    if (!ROLE_VALUES.includes(column?.role)) { errors.push(`Bỏ khai báo cột không hợp lệ: ${column.name}`); continue; }
    if (rawByName.has(column.name)) { errors.push(`Bỏ khai báo cột trùng: ${column.name}`); continue; }
    rawByName.set(column.name, column);
  }
  const columns = actualColumns.map(column => normalizeColumn(rawByName.get(column.name), unclassifiedColumn(column)));
  const roleOf = new Map(columns.map(column => [column.name, column.role]));
  const seenIds = new Set();
  const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : null;
  const suggestionsByType = new Map();
  for (const rawSuggestion of rawSuggestions || []) {
    const suggestion = validateSuggestion(rawSuggestion, roleOf, fieldNames, seenIds, profile);
    if (!suggestion) {
      errors.push(`Bỏ suggestion không hợp lệ: ${rawSuggestion?.id || rawSuggestion?.chartType || "(trống)"}`);
      continue;
    }
    suggestion.metricButtons = raw.source === "rule" ? [] : normalizeMetricButtons(rawSuggestion.metricButtons, columns, suggestion, profile);
    suggestion.geographicScopes = suggestion.chartType === "choropleth" ? normalizeGeographicScopes(
      rawSuggestion.geographicScopes, profile, suggestion.bindings.region, reason => errors.push(reason)
    ) : [];
    const existing = suggestionsByType.get(suggestion.chartType);
    if (!existing || suggestion.confidence > existing.confidence) suggestionsByType.set(suggestion.chartType, suggestion);
  }
  const suggestions = [...suggestionsByType.values()].sort((a, b) => b.confidence - a.confidence);
  for (const column of columns) {
    const mapSuggestions = suggestions.filter(item => ["choropleth", "map_line"].includes(item.chartType) && item.bindings.value === column.name);
    const defaultTarget = { ...polygonLegendTarget(column), role: column.role };
    column.legend = normalizePolygonLegendRecommendation(column.legend, defaultTarget, {
      onFallback: reason => errors.push(`Legend ${column.name}: ${reason}`)
    });
    for (const suggestion of mapSuggestions) {
      const target = { ...polygonLegendTarget(column, suggestion.agg || measureAggregation(column)), role: column.role };
      const suggestionLegend = normalizePolygonLegendRecommendation(suggestion.legend, target, {
        onFallback: reason => errors.push(`Legend ${suggestion.id}: ${reason}`)
      });
      // The column is authoritative for its default aggregation; suggestions can override other aggregations.
      suggestion.legend = normalizePolygonLegendRecommendation(column.legend, target) || suggestionLegend;
      // Only seed a column default when the suggestion uses that same aggregation.
      if (!column.legend) column.legend = normalizePolygonLegendRecommendation(suggestion.legend, defaultTarget);
    }
  }
  // An explicit empty list is the AI's suitability decision, not a failed response.
  if (!suggestions.length && rawSuggestions?.length !== 0) return { ...fallback, validationErrors: errors.length ? errors : ["AI không có suggestion hợp lệ."] };
  const source = raw.source === "rule" ? "rule" : "ai";
  return {
    datasetTitle: typeof raw.datasetTitle === "string" && raw.datasetTitle.trim() ? raw.datasetTitle.trim() : fallback.datasetTitle,
    grain: typeof raw.grain === "string" && raw.grain.trim() ? raw.grain.trim() : fallback.grain,
    columns,
    ...(raw.popupContent ? { popupContent: normalizePopupContent(raw.popupContent, columns) } : {}),
    suggestions: suggestions.map(suggestion => ({ ...suggestion, source })),
    ...normalizeDataSearchConfig(raw, columns),
    ...(Object.hasOwn(raw, "regionNavigation") ? { regionNavigation: source === "ai" ? normalizeRegionNavigation(raw.regionNavigation, columns) : null } : {}),
    source,
    validationErrors: [...new Set(errors)]
  };
}

export const ANALYSIS_ROLES = ROLE_VALUES;
export const ANALYSIS_AGGREGATIONS = AGG_VALUES;

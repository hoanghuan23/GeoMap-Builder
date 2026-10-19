import { inferTimeGranularity, TIME_GRANULARITIES } from "./time-values.js";
import { inferMeasureAggregation } from "./measure-semantics.js";

const ROLE_VALUES = Object.freeze(["geo", "time", "measure", "category", "id", "text", "ignore"]);
const AGG_VALUES = Object.freeze(["sum", "mean", "max", "min", "count"]);

const LOCATION_HINT = /(tỉnh|thành phố|province|city|district|quận|huyện|địa điểm|location|region|khu vực|area|state)/i;
const ADMINISTRATIVE_LOCATION_HINT = /(tỉnh|thành phố|province|city|district|quận|huyện|khu vực|region|area|state)/i;
const TIME_HINT = /(^|[\s_.-])(ngày|ngay|date|datetime|timestamp|time|thời điểm|thoi diem|tháng|thang|month|năm|nam|year|quarter|quý|quy|week|tuần|tuan|period|kỳ|ky)([\s_.-]|$)/i;
const ROAD_NAME_HINT = /(^|[\s_.-])(tên đường|ten duong|tên tuyến|ten tuyen|tuyến đường|tuyen duong|road[\s_.-]*name|route[\s_.-]*name|street[\s_.-]*name)([\s_.-]|$)/i;
const ID_HINT = /(^|[\s_.-])(id|mã|ma|code|index|rank)([\s_.-]|$)/i;
const LAT_HINT = /(^|[\s_.-])(lat|latitude|vĩ độ|vi do)([\s_.-]|$)/i;
const LNG_HINT = /(^|[\s_.-])(lng|lon|long|longitude|kinh độ|kinh do)([\s_.-]|$)/i;

export const AI_CHART_REGISTRY = Object.freeze({
  choropleth: Object.freeze({
    label: "Bản đồ Polygon",
    slots: Object.freeze({ region: Object.freeze(["geo"]), value: Object.freeze(["measure"]) }),
    icon: "polygon",
    renderer: "MapLibre"
  }),
  point: Object.freeze({
    label: "Biểu đồ Point",
    slots: Object.freeze({ lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]) }),
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
    slots: Object.freeze({ region: Object.freeze(["category", "geo"]), value: Object.freeze(["measure", "category"]) }),
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

export function supportedChartsForPrompt() {
  return Object.fromEntries(Object.entries(AI_CHART_REGISTRY).map(([chartType, spec]) => [chartType, { slots: spec.slots }]));
}

function nullable(schema) {
  return { anyOf: [schema, { type: "null" }] };
}

export const ANALYSIS_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["datasetTitle", "grain", "columns", "suggestions"],
  properties: {
    datasetTitle: { type: "string" },
    grain: { type: "string" },
    columns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role", "labelVi", "geoLevel", "country", "timeParse", "granularity", "unit", "aggDefault"],
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ROLE_VALUES },
          labelVi: nullable({ type: "string" }),
          geoLevel: nullable({ type: "string", enum: ["country", "admin1", "admin2", "point_lat", "point_lng", "h3"] }),
          country: nullable({ type: "string" }),
          timeParse: nullable({ type: "string", enum: ["iso", "excel_serial", "unix_s", "unix_ms", "text"] }),
          granularity: nullable({ type: "string", enum: TIME_GRANULARITIES }),
          unit: nullable({ type: "string" }),
          aggDefault: nullable({ type: "string", enum: AGG_VALUES })
        }
      }
    },
    suggestions: {
      type: "array",
      maxItems: Object.keys(AI_CHART_REGISTRY).length,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "chartType", "title", "bindings", "agg", "confidence", "reason"],
        properties: {
          id: { type: "string" },
          chartType: { type: "string", enum: Object.keys(AI_CHART_REGISTRY) },
          title: { type: "string" },
          bindings: {
            type: "object",
            additionalProperties: false,
            required: ["region", "value", "lat", "lng", "x", "y", "series"],
            properties: {
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
          reason: { type: "string" }
        }
      }
    }
  }
});

function cleanOptional(value, allowed = null) {
  if (value == null || value === "") return null;
  return !allowed || allowed.includes(value) ? value : null;
}

function inferredRole(column) {
  const name = String(column?.name || "");
  if (LAT_HINT.test(name)) return { role: "geo", geoLevel: "point_lat" };
  if (LNG_HINT.test(name)) return { role: "geo", geoLevel: "point_lng" };
  if (ID_HINT.test(name)) return { role: "id" };
  if (TIME_HINT.test(name) || column?.inferredType === "date") {
    return { role: "time", timeParse: column?.dateHint || (column?.inferredType === "date" ? "iso" : "text"), granularity: column?.temporalGranularity || inferTimeGranularity(name) };
  }
  if (LOCATION_HINT.test(name) && column?.inferredType !== "number") return { role: "geo", geoLevel: /quận|huyện|district/i.test(name) ? "admin2" : "admin1", country: "VN" };
  if (column?.inferredType === "number") return { role: "measure", aggDefault: inferMeasureAggregation(column) };
  if (ROAD_NAME_HINT.test(name)) return { role: "category" };
  if (Number(column?.uniqueCount) > 0 && Number(column.uniqueCount) <= 80) return { role: "category" };
  return { role: "text" };
}

export function inferColumnInfo(column) {
  const inferred = inferredRole(column);
  return {
    name: String(column?.name || ""),
    role: inferred.role,
    labelVi: null,
    geoLevel: inferred.geoLevel || null,
    country: inferred.country || null,
    timeParse: inferred.timeParse || null,
    granularity: inferred.granularity || null,
    unit: null,
    aggDefault: inferred.aggDefault || null,
    source: "rule"
  };
}

function normalizeColumn(raw, fallback) {
  if (!raw || !ROLE_VALUES.includes(raw.role)) return fallback;
  // Administrative names remain geographic dimensions even if AI calls them categories.
  const isAdministrativeRegion = fallback.role === "geo" && ADMINISTRATIVE_LOCATION_HINT.test(fallback.name)
    && ["geo", "category", "text"].includes(raw.role);
  const isRoadName = fallback.role === "category" && ROAD_NAME_HINT.test(fallback.name)
    && ["geo", "category", "text"].includes(raw.role);
  return {
    name: fallback.name,
    role: isAdministrativeRegion ? "geo" : isRoadName ? "category" : raw.role,
    labelVi: typeof raw.labelVi === "string" && raw.labelVi.trim() ? raw.labelVi.trim() : null,
    geoLevel: isRoadName ? null : isAdministrativeRegion
      ? cleanOptional(raw.geoLevel, ["country", "admin1", "admin2"]) || fallback.geoLevel
      : cleanOptional(raw.geoLevel, ["country", "admin1", "admin2", "point_lat", "point_lng", "h3"]),
    country: !isRoadName && typeof raw.country === "string" && raw.country.trim() ? raw.country.trim().toUpperCase() : null,
    timeParse: cleanOptional(raw.timeParse, ["iso", "excel_serial", "unix_s", "unix_ms", "text"]) || (raw.role === "time" ? fallback.timeParse : null),
    granularity: cleanOptional(raw.granularity, TIME_GRANULARITIES) || (raw.role === "time" ? fallback.granularity : null),
    unit: typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : null,
    aggDefault: cleanOptional(raw.aggDefault, AGG_VALUES),
    source: "ai"
  };
}

function list(value) {
  return Array.isArray(value) ? value : [value];
}

function validateSuggestion(raw, roleOf, fieldNames, seenIds) {
  const spec = AI_CHART_REGISTRY[raw?.chartType];
  if (!spec || typeof raw.id !== "string" || !raw.id.trim() || seenIds.has(raw.id)) return null;
  const b = raw.bindings || {};
  const required = ["choropleth", "map_line"].includes(raw.chartType) ? ["region", "value"]
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
    if (!names.length || names.some(name => !fieldNames.has(name) || !spec.slots[slot]?.includes(roleOf.get(name)))) return null;
    normalizedBindings[slot] = slot === "y" && raw.chartType === "line" ? [...new Set(names)] : names[0];
  }
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
    agg: AGG_VALUES.includes(raw.agg) ? raw.agg : null,
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    reason: typeof raw.reason === "string" ? raw.reason.trim() : "",
    source: "ai"
  };
}

export function fallbackAnalysis(profile, { datasetTitle = "Dữ liệu tải lên" } = {}) {
  const columns = (profile?.columns || []).map(inferColumnInfo);
  const byRole = role => columns.filter(column => column.role === role);
  const measures = byRole("measure");
  const geo = byRole("geo");
  const time = byRole("time")[0];
  const category = byRole("category").find(column => ROAD_NAME_HINT.test(column.name)) || byRole("category")[0];
  const lat = geo.find(column => column.geoLevel === "point_lat");
  const lng = geo.find(column => column.geoLevel === "point_lng");
  const region = geo.find(column => ["admin1", "admin2", "country"].includes(column.geoLevel));
  const regionProfile = profile?.columns?.find(column => column.name === region?.name);
  const groupingRegion = Number(regionProfile?.uniqueCount) > 1 ? region : null;
  const suggestions = [];
  const road = byRole("category").find(column => ROAD_NAME_HINT.test(column.name));
  const roadValue = byRole("category").find(column => /mức độ ùn tắc|muc do un tac|traffic status|congestion/i.test(column.name)) || measures[0];
  if (road && roadValue) suggestions.push({ id: "rule-map-line", chartType: "map_line", title: "Biểu đồ mạng lưới", bindings: { region: road.name, value: roadValue.name }, agg: roadValue.aggDefault, confidence: .8, reason: "Ghép tên tuyến với mạng đường có sẵn để thể hiện dữ liệu theo vị trí thực tế.", source: "rule" });
  if (region && measures[0]) suggestions.push({ id: "rule-choropleth", chartType: "choropleth", title: `${measures[0].name} theo ${region.name}`, bindings: { region: region.name, value: measures[0].name }, agg: measures[0].aggDefault, confidence: .72, reason: "Nhận diện theo quy tắc từ cột địa danh và chỉ số số.", source: "rule" });
  if (lat && lng) suggestions.push({ id: "rule-point", chartType: "point", title: "Vị trí các bản ghi", bindings: { lat: lat.name, lng: lng.name }, agg: null, confidence: .95, reason: "Mỗi dòng có một cặp kinh độ, vĩ độ nên được hiển thị trực tiếp bằng điểm.", source: "rule" });
  if (time && measures.length) suggestions.push({ id: "rule-line", chartType: "line", title: `Xu hướng theo ${time.name}`, bindings: { x: time.name, y: [measures[0].name], ...(groupingRegion || category ? { series: (groupingRegion || category).name } : {}) }, agg: null, confidence: .68, reason: "Nhận diện theo quy tắc từ cột thời gian và chỉ số số.", source: "rule" });
  const x = groupingRegion || category || region;
  if (x) suggestions.push({ id: "rule-bar", chartType: "bar", title: measures[0] ? `${measures[0].name} theo ${x.name}` : `Số bản ghi theo ${x.name}`, bindings: { x: x.name, y: measures[0]?.name || "count" }, agg: measures[0] ? measures[0].aggDefault : "count", confidence: .65, reason: "Nhận diện theo quy tắc từ cột phân loại.", source: "rule" });
  return { datasetTitle, grain: "Một dòng tương ứng một bản ghi dữ liệu", columns, suggestions, source: "rule" };
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
  const columns = actualColumns.map(column => normalizeColumn(rawByName.get(column.name), inferColumnInfo(column)));
  const roleOf = new Map(columns.map(column => [column.name, column.role]));
  const seenIds = new Set();
  const rawSuggestions = Array.isArray(raw.suggestions) ? raw.suggestions : null;
  const suggestionsByType = new Map();
  for (const rawSuggestion of rawSuggestions || []) {
    const suggestion = validateSuggestion(rawSuggestion, roleOf, fieldNames, seenIds);
    if (!suggestion) {
      errors.push(`Bỏ suggestion không hợp lệ: ${rawSuggestion?.id || rawSuggestion?.chartType || "(trống)"}`);
      continue;
    }
    const existing = suggestionsByType.get(suggestion.chartType);
    if (!existing || suggestion.confidence > existing.confidence) suggestionsByType.set(suggestion.chartType, suggestion);
  }
  const suggestions = [...suggestionsByType.values()].sort((a, b) => b.confidence - a.confidence);
  // An explicit empty list is the AI's suitability decision, not a failed response.
  if (!suggestions.length && rawSuggestions?.length !== 0) return { ...fallback, validationErrors: errors.length ? errors : ["AI không có suggestion hợp lệ."] };
  const source = raw.source === "rule" ? "rule" : "ai";
  return {
    datasetTitle: typeof raw.datasetTitle === "string" && raw.datasetTitle.trim() ? raw.datasetTitle.trim() : fallback.datasetTitle,
    grain: typeof raw.grain === "string" && raw.grain.trim() ? raw.grain.trim() : fallback.grain,
    columns,
    suggestions: suggestions.map(suggestion => ({ ...suggestion, source })),
    source,
    validationErrors: errors
  };
}

export const ANALYSIS_ROLES = ROLE_VALUES;
export const ANALYSIS_AGGREGATIONS = AGG_VALUES;

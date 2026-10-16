import { fallbackAnalysis, validateAndNormalizeAnalysis } from "./ai-chart-contract.js";
import { normalizeTabularRecords, profileTabularData } from "./tabular-data.js";

const LOCATION_HINT = /(tỉnh|thành phố|province|city|district|quận|huyện|địa điểm|location|region|khu vực|area)/i;
const TIME_HINT = /(ngày|date|time|tháng|month|năm|year)/i;

function isDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime());
}

/** Backward-compatible facade for callers that still use the old profile name. */
export function summarizeTabularData(records, { maxSamples = 5, maxUnique = 10_000, includeSamples = true } = {}) {
  const profile = profileTabularData(records, { includeSamples, maxSamples, uniqueCap: maxUnique });
  return {
    ...profile,
    columns: profile.columns.map(column => ({ ...column, uniqueValues: column.samples || [] })),
    samples: profile.head || []
  };
}

export function fallbackMapRecommendation(records) {
  const profile = profileTabularData(records, { includeSamples: false });
  const location = profile.columns.find(column => LOCATION_HINT.test(column.name) && column.inferredType === "text");
  const time = profile.columns.find(column => TIME_HINT.test(column.name) || column.inferredType === "date");
  const metrics = profile.columns.filter(column => column.inferredType === "number" && column.name !== time?.name);
  if (!location || !metrics.length) return null;
  return {
    canRenderMap: true,
    visualization: "polygon",
    geometry: { field: location.name, provider: "maptiler", placeType: /quận|huyện|district/i.test(location.name) ? "county" : "region" },
    metricField: metrics[0].name,
    numericFields: metrics.map(column => column.name),
    filters: [
      { field: location.name, label: location.name, control: "select", allowAll: true },
      ...(time ? [{ field: time.name, label: time.name, control: "date-select", allowAll: false }] : [])
    ],
    title: `${metrics[0].name} theo ${location.name}`,
    explanation: "Nhận diện theo quy tắc dự phòng: dữ liệu có địa phương và các chỉ số số.",
    confidence: .7,
    source: "rule"
  };
}

export async function requestAiDataAnalysis(records, { signal, includeSamples = false, profile: suppliedProfile = null, source = null } = {}) {
  const profile = suppliedProfile || profileTabularData(records, { includeSamples });
  let analysis;
  let fallbackReason = "";
  try {
    const response = await fetch("/api/ai/analyze-map-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile, ...(source ? { source } : {}) }),
      signal
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `AI HTTP ${response.status}`);
    analysis = validateAndNormalizeAnalysis(await response.json(), profile);
    if (analysis.source !== "ai") fallbackReason = analysis.validationErrors?.join("; ") || "AI không có đề xuất hợp lệ.";
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("AI analysis fallback:", error);
    fallbackReason = error?.message || "Không thể gọi AI.";
    analysis = fallbackAnalysis(profile);
  }
  const normalized = normalizeTabularRecords(records, analysis.columns);
  return { analysis, profile, records: normalized.records, validRowRate: normalized.validRowRate, fallbackReason };
}

/** Compatibility adapter for the former map-only pipeline. */
export async function requestAiMapRecommendation(records, options = {}) {
  const pipeline = await requestAiDataAnalysis(records, options);
  const suggestion = pipeline.analysis.suggestions.find(item => item.chartType === "choropleth");
  if (!suggestion) return null;
  const columns = new Map(pipeline.analysis.columns.map(column => [column.name, column]));
  const time = pipeline.analysis.columns.find(column => column.role === "time");
  const region = columns.get(suggestion.bindings.region);
  return {
    canRenderMap: true,
    visualization: "polygon",
    geometry: { field: suggestion.bindings.region, provider: "maptiler", placeType: region?.geoLevel === "admin2" ? "county" : "region" },
    metricField: suggestion.bindings.value,
    numericFields: pipeline.analysis.columns.filter(column => column.role === "measure").map(column => column.name),
    filters: [
      { field: suggestion.bindings.region, label: region?.labelVi || suggestion.bindings.region, control: "select", allowAll: true },
      ...(time ? [{ field: time.name, label: time.labelVi || time.name, control: "date-select", allowAll: false }] : [])
    ],
    title: suggestion.title,
    explanation: suggestion.reason,
    confidence: suggestion.confidence,
    source: pipeline.analysis.source,
    aggregation: suggestion.agg || columns.get(suggestion.bindings.value)?.aggDefault || "mean",
    pipeline
  };
}

export function displayFilterValue(value, control = "") {
  const date = isDate(value) ? value : control === "date-select" ? new Date(value) : null;
  if (date && !Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return String(value ?? "");
}

export function comparableFilterValue(value) {
  return isDate(value) ? value.toISOString() : String(value ?? "");
}

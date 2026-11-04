import { AI_MAP_REGISTRY, fallbackAnalysis, validateAndNormalizeAnalysis } from "./ai-chart-contract.js";
import { normalizeTabularRecords, profileTabularData } from "./tabular-data.js";
import { validateDocumentText } from "./text-data.js";
import { applyGeographicEnrichment } from './geographic-enrichment.js';


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

export function fallbackMapRecommendation() {
  return null;
}

export async function requestAiTextAnalysis(text, { signal, source = null } = {}) {
  const content = validateDocumentText(text);
  const response = await fetch("/api/ai/analyze-map-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: content, ...(source ? { source } : {}) }),
    signal
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `AI HTTP ${response.status}`);
  const result = await response.json();
  const records = result?.records;
  if (!Array.isArray(records) || !records.length || records.some(record => !record || typeof record !== "object" || Array.isArray(record))) {
    throw new Error("AI không trả về bản ghi văn bản hợp lệ.");
  }
  // The entire document has already been analyzed. Do not send another profile request.
  const profile = profileTabularData(records, { includeSamples: false });
  const analysis = validateAndNormalizeAnalysis(result.analysis, profileTabularData(records));
  analysis.suggestions = analysis.suggestions.filter(item => Object.hasOwn(AI_MAP_REGISTRY, item.chartType));
  const normalized = normalizeTabularRecords(records, analysis.columns);
  return { analysis, profile, ...normalized, rawRecords: records,
    fallbackReason: analysis.source === "ai" ? "" : analysis.validationErrors?.join("; ") || "AI không có đề xuất hợp lệ." };
}

export async function requestAiDataAnalysis(records, { signal, includeSamples = true, profile: suppliedProfile = null, source = null } = {}) {
  const profile = suppliedProfile || profileTabularData(records, { includeSamples });
  let analysis;
  let enrichedRecords = records;
  let enrichedProfile = profile;
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
    if (analysis.geographicEnrichment?.length) {
      enrichedRecords = applyGeographicEnrichment(records, analysis.geographicEnrichment);
      enrichedProfile = { ...profile, ...profileTabularData(enrichedRecords, { includeSamples: profile.samplesIncluded === true }) };
    }
    if (analysis.source !== "ai") fallbackReason = analysis.validationErrors?.join("; ") || "AI không có đề xuất hợp lệ.";
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("AI analysis unavailable:", error);
    fallbackReason = error?.message || "Không thể gọi AI.";
    analysis = fallbackAnalysis(profile);
  }
  analysis.suggestions = analysis.suggestions.filter(item => Object.hasOwn(AI_MAP_REGISTRY, item.chartType));
  const normalized = normalizeTabularRecords(enrichedRecords, analysis.columns);
  return { analysis, profile: enrichedProfile, records: normalized.records, validRowRate: normalized.validRowRate, fallbackReason };
}

export function displayFilterValue(value, control = "") {
  const date = isDate(value) ? value : ["date-select", "datetime-select"].includes(control) ? new Date(value) : null;
  if (date && !Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    ...(control === "datetime-select" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {})
  }).format(date);
  return String(value ?? "");
}

export function comparableFilterValue(value) {
  return isDate(value) ? value.toISOString() : String(value ?? "");
}

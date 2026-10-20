import { normalizePolygonLegendRecommendation, polygonLegendKey, polygonLegendTarget } from "./polygon-legend-contract.js";
import { resolveAggregation, withSuggestionMetric } from "./ai-chart-pipeline.js";
import { joinRecordsToMapTilerBoundaries } from "./vietnam-admin-data.js";

export const POLYGON_NO_DATA_COLOR = "#cbd5e1";
const FALLBACK_COLORS = ["#e2e8f0", "#94a3b8", "#475569"];
const featuresOf = data => Array.isArray(data) ? data : data?.type === "Feature" ? [data] : data?.features || [];

export function summarizePolygonLegendValues(data, field) {
  const features = featuresOf(data);
  const values = typeof field === "string" ? features.map(feature => feature?.properties?.[field])
    .filter(value => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b) : [];
  const quantile = p => {
    if (!values.length) return null;
    const index = (values.length - 1) * p; const lower = Math.floor(index); const fraction = index - lower;
    return fraction === 0 ? values[lower] : values[lower] * (1 - fraction) + values[lower + 1] * fraction;
  };
  return {
    min: values[0] ?? null, max: values.at(-1) ?? null,
    mean: values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null,
    p10: quantile(.1), p50: quantile(.5), p90: quantile(.9), validCount: values.length, missingCount: features.length - values.length
  };
}

/** Project each metric with exactly the aggregation used when that metric is selected. */
export function buildPolygonLegendTargets({ suggestion, records, boundaries, columns, filters = {} }) {
  return columns.filter(column => column.role === "measure").flatMap(column => {
    const metricSuggestion = column.name === suggestion.bindings.value ? suggestion : withSuggestionMetric(suggestion, column.name, columns);
    const aggregation = resolveAggregation(metricSuggestion, columns);
    const data = joinRecordsToMapTilerBoundaries(records, boundaries, {
      geometry: { field: suggestion.bindings.region }, metricField: column.name, aggregation
    }, { filters, columns });
    const renderStatistics = summarizePolygonLegendValues(data, column.name);
    return renderStatistics.validCount ? [{
      ...polygonLegendTarget(column, aggregation), labelVi: column.labelVi || column.name,
      unitSource: aggregation === "count" ? "explicit" : column.unitSource || (column.unit ? "inferred" : "unknown"),
      semanticType: column.semanticType || null, renderStatistics
    }] : [];
  });
}

/** MapLibre interpolate(linear) and the CSS srgb gradient interpolate these same channels. */
export function samplePolygonLegendColor(stops, value) {
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops.at(-1)[0]) return stops.at(-1)[1];
  const right = stops.findIndex(stop => stop[0] >= value);
  const [a, first] = stops[right - 1]; const [b, second] = stops[right];
  const t = (value - a) / (b - a);
  return `#${[1, 3, 5].map(offset => Math.round(parseInt(first.slice(offset, offset + 2), 16) * (1 - t)
    + parseInt(second.slice(offset, offset + 2), 16) * t).toString(16).padStart(2, "0")).join("")}`;
}

export function polygonLegendLabels(scale, width = 280) {
  if (!scale.hasData || !scale.stops.length) return [];
  const position = value => scale.min === scale.max ? 50 : (value - scale.min) / (scale.max - scale.min) * 100;
  const format = value => new Intl.NumberFormat("vi-VN", { maximumSignificantDigits: 5 }).format(value);
  const chosen = [...new Set([scale.min, ...(scale.center == null ? [] : [scale.center]), scale.max])];
  for (const [value] of scale.stops) {
    if (chosen.includes(value)) continue;
    if (chosen.every(other => Math.abs(position(value) - position(other)) * width / 100 > Math.max(48, (format(value).length + format(other).length) * 3.3))) chosen.push(value);
  }
  const labels = chosen.sort((a, b) => a - b).map(value => ({ value, text: format(value), position: position(value), row: 0 }));
  labels.forEach((label, index) => {
    if (index && (label.position - labels[index - 1].position) * width / 100 < 48) label.row = labels[index - 1].row ? 0 : 1;
  });
  return labels;
}

/** One immutable-by-convention result supplies polygon, regional H3, controls and legend. */
export function resolvePolygonLegendConfig({ suggestion, columnMetadata, aggregatedFeatures, aggregation, legendRecommendations = [], status = "ready", onFallback }) {
  const field = suggestion?.bindings?.value;
  const columns = Array.isArray(columnMetadata) ? columnMetadata : columnMetadata?.columns || [];
  const column = columns.find(item => item.name === field);
  const effectiveAggregation = aggregation === undefined ? resolveAggregation(suggestion, columns) : aggregation;
  const target = polygonLegendTarget(column, effectiveAggregation);
  const stats = summarizePolygonLegendValues(aggregatedFeatures, column?.role === "measure" ? field : undefined);
  const failures = [];
  const key = polygonLegendKey(target);
  const cached = typeof legendRecommendations?.get === "function" ? legendRecommendations.get(key)
    : legendRecommendations.find(item => polygonLegendKey(item) === key);
  let recommendation = null;
  for (const raw of [suggestion?.legend, cached, column?.legend]) {
    recommendation = normalizePolygonLegendRecommendation(raw, { ...target, role: column?.role || "unknown" }, {
      onFallback: (reason, code) => failures.push({ code, reason })
    });
    if (recommendation) break;
  }
  const scale = {
    field, aggregation: effectiveAggregation ?? null, type: recommendation?.type || "continuous", mode: recommendation?.mode || "auto",
    source: recommendation ? "ai" : "technical-fallback", status: recommendation ? "ready" : status === "pending" ? "pending" : "fallback",
    title: recommendation?.title || (effectiveAggregation === "count" ? "Số bản ghi" : column?.labelVi || field || "Chú giải"), unit: target.unit,
    reason: recommendation?.reason || failures[0]?.reason || "Chưa có cấu hình AI hợp lệ; dùng thang màu dự phòng theo dữ liệu.",
    dataMin: stats.min, dataMax: stats.max, min: null, max: null, center: recommendation?.center ?? null,
    stops: [], ticks: [], colors: [], positions: [], gradient: "", hasData: stats.validCount > 0, noDataColor: POLYGON_NO_DATA_COLOR
  };
  if (!recommendation && status !== "pending") onFallback?.(failures[0] || { code: "MISSING_LEGEND", reason: scale.reason });
  if (!scale.hasData) { scale.status = "no-data"; return scale; }
  const aiStops = recommendation?.stops.map(stop => [stop.value, stop.color]);
  if (recommendation?.mode === "semantic") scale.stops = aiStops;
  else if (stats.min === stats.max || !Number.isFinite(stats.max - stats.min)) {
    const color = aiStops ? samplePolygonLegendColor(aiStops, recommendation.domain[0] + (recommendation.domain[1] - recommendation.domain[0]) / 2) : FALLBACK_COLORS[1];
    scale.stops = [[stats.min, color]]; scale.status = stats.min === stats.max ? "constant" : "fallback";
  } else if (recommendation) {
    const [min, max] = recommendation.domain;
    scale.stops = aiStops.map(([value, color], index) => [index === 0 ? stats.min : index === aiStops.length - 1 ? stats.max
      : stats.min + (value - min) / (max - min) * (stats.max - stats.min), color]);
    if (scale.stops.some(([value], index) => index > 0 && value <= scale.stops[index - 1][0])) {
      // Very small numeric ranges can collapse distinct mapped stops at IEEE-754 precision.
      scale.stops = [[stats.min, aiStops[0][1]], [stats.max, aiStops.at(-1)[1]]];
    }
  } else {
    scale.stops = FALLBACK_COLORS.map((color, index) => [stats.min + (stats.max - stats.min) * index / 2, color]);
    if (scale.stops[1][0] <= stats.min || scale.stops[1][0] >= stats.max) scale.stops = [scale.stops[0], scale.stops[2]];
  }
  scale.min = scale.stops[0][0]; scale.max = scale.stops.at(-1)[0];
  scale.colors = scale.stops.map(stop => stop[1]);
  scale.positions = scale.stops.map(([value]) => scale.min === scale.max ? 50 : (value - scale.min) / (scale.max - scale.min) * 100);
  scale.ticks = polygonLegendLabels(scale).map(label => label.value);
  scale.gradient = scale.colors.length === 1 ? scale.colors[0] : `linear-gradient(90deg in srgb, ${scale.colors.map((color, index) => `${color} ${Number(scale.positions[index].toFixed(6))}%`).join(", ")})`;
  return scale;
}

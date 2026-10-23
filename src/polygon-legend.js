import { normalizePolygonLegendRecommendation, polygonLegendTarget } from "./polygon-legend-contract.js";
import { resolveAggregation } from "./ai-chart-pipeline.js";
import { MAP_NO_DATA_COLOR } from "./map-value.js";

export const POLYGON_NO_DATA_COLOR = MAP_NO_DATA_COLOR;
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
  const chosen = [...new Set([scale.min, ...(scale.center == null ? [] : [scale.center]), ...scale.stops.map(([value]) => value), scale.max])];
  const labels = chosen.sort((a, b) => a - b).map(value => ({ value, text: format(value), position: position(value), row: 0 }));
  const widths = labels.map(label => label.text.length * 6);
  const lefts = labels.map((label, index) => {
    const x = label.position * width / 100;
    return labels.length > 1 && index === 0 ? x : index === labels.length - 1 && labels.length > 1 ? x - widths[index] : x - widths[index] / 2;
  });
  const gap = 8;
  // Keep the actual tick positions; only nudge text when one row has enough room.
  if (widths.reduce((sum, value) => sum + value, 0) + gap * (labels.length - 1) <= width) {
    const packed = [...lefts];
    for (let index = 1; index < packed.length; index++) packed[index] = Math.max(packed[index], packed[index - 1] + widths[index - 1] + gap);
    packed[packed.length - 1] = Math.min(packed.at(-1), width - widths.at(-1));
    for (let index = packed.length - 2; index >= 0; index--) packed[index] = Math.min(packed[index], packed[index + 1] - widths[index] - gap);
    return labels.map((label, index) => ({ ...label, offset: packed[index] - lefts[index] }));
  }
  const rowEnds = [];
  labels.forEach((label, index) => {
    const left = lefts[index];
    let row = rowEnds.findIndex(end => left >= end + gap);
    if (row === -1) row = rowEnds.length;
    label.row = row;
    rowEnds[row] = left + widths[index];
  });
  return labels;
}

/** One immutable-by-convention result supplies polygon, regional H3, controls and legend. */
export function resolvePolygonLegendConfig({ suggestion, columnMetadata, aggregatedFeatures, aggregation, onFallback }) {
  const field = suggestion?.bindings?.value;
  const columns = Array.isArray(columnMetadata) ? columnMetadata : columnMetadata?.columns || [];
  const column = columns.find(item => item.name === field);
  const effectiveAggregation = aggregation === undefined ? resolveAggregation(suggestion, columns) : aggregation;
  const target = polygonLegendTarget(column, effectiveAggregation);
  const stats = summarizePolygonLegendValues(aggregatedFeatures, column?.role === "measure" ? field : undefined);
  const failures = [];
  let recommendation = null;
  for (const raw of [suggestion?.legend, column?.legend]) {
    recommendation = normalizePolygonLegendRecommendation(raw, { ...target, role: column?.role || "unknown" }, {
      onFallback: (reason, code) => failures.push({ code, reason })
    });
    if (recommendation) break;
  }
  const scale = {
    field, aggregation: effectiveAggregation ?? null, type: recommendation?.type || "continuous", mode: recommendation?.mode || "auto",
    source: recommendation ? "ai" : "technical-fallback", status: recommendation ? "ready" : "fallback",
    title: recommendation?.title || (effectiveAggregation === "count" ? "Số bản ghi" : column?.labelVi || field || "Chú giải"), unit: target.unit,
    reason: recommendation?.reason || failures[0]?.reason || "Chưa có cấu hình AI hợp lệ; dùng thang màu dự phòng theo dữ liệu.",
    dataMin: stats.min, dataMax: stats.max, min: null, max: null, center: recommendation?.center ?? null,
    stops: [], ticks: [], colors: [], positions: [], gradient: "", hasData: stats.validCount > 0, noDataColor: POLYGON_NO_DATA_COLOR
  };
  if (!recommendation) onFallback?.(failures[0] || { code: "MISSING_LEGEND", reason: scale.reason });
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

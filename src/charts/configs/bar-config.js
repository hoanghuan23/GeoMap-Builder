export const DEFAULT_BAR_CONFIG = Object.freeze({
  limit: 20,
  sort: "none",
  orientation: "vertical",
  barWidth: 32,
  barGap: 20,
  showGrid: true,
  showLegend: true,
  showTooltip: true,
  showDataLabels: false,
});

const BOOLEAN_KEYS = ["showGrid", "showLegend", "showTooltip", "showDataLabels"];

export function mergeBarConfig(config = {}) {
  const merged = { ...DEFAULT_BAR_CONFIG, ...config };
  merged.limit = merged.limit === "all" ? "all" : Math.max(1, Number(merged.limit) || DEFAULT_BAR_CONFIG.limit);
  merged.sort = ["desc", "asc", "none"].includes(merged.sort) ? merged.sort : DEFAULT_BAR_CONFIG.sort;
  merged.orientation = merged.orientation === "horizontal" ? "horizontal" : "vertical";
  merged.barWidth = Math.min(100, Math.max(5, Number(merged.barWidth) || DEFAULT_BAR_CONFIG.barWidth));
  merged.barGap = Math.min(60, Math.max(0, Number(merged.barGap) || 0));
  for (const key of BOOLEAN_KEYS) merged[key] = Boolean(merged[key]);
  return merged;
}

export function prepareBarData(data, config, series) {
  const result = [...data];
  const metric = series[0]?.key;
  if (metric && config.sort !== "none") {
    const direction = config.sort === "asc" ? 1 : -1;
    result.sort((a, b) => (Number(a[metric]) - Number(b[metric])) * direction);
  }
  return config.limit === "all" ? result : result.slice(0, config.limit);
}

import { buildBarChartOption, buildLineChartOption, resolveAggregation } from "./ai-chart-pipeline.js";
import { comparableFilterValue } from "./ai-data-analysis.js";
import { filterTimeRange, timeValueInfo, timeValuesAreComparable, uniqueTimeValues } from "./time-values.js";
import { roadAreaField, roadNetworkForArea, roadRefField } from "./road-map-data.js";
import { normalizeRoadText } from "./congestion-data.js";

export function mapDisplaySuggestions(suggestions = [], selectedSuggestionId = null) {
  const selected = suggestions.find(item => item.id === selectedSuggestionId);
  // Polygon and road maps own their popup charts. Point/H3 and standalone
  // charts retain their existing choices and initial selection.
  if (selected && !["choropleth", "map_line"].includes(selected.chartType)) return suggestions;
  if (!selected && suggestions.some(item => item.available && ["point", "hex_h3"].includes(item.chartType))) return suggestions;
  return suggestions.some(item => ["choropleth", "map_line"].includes(item.chartType) && (item.available || item.repairable))
    ? suggestions.filter(item => !["bar", "line"].includes(item.chartType)) : suggestions;
}

export function popupTimeColumn(columns = []) {
  return columns.find(column => column.role === "time") || null;
}

export function createPopupChartSelection(records, columns, metricField, kind) {
  const time = popupTimeColumn(columns);
  const times = time ? uniqueTimeValues(records, time) : [];
  const metric = columns.find(column => column.name === metricField && column.role === "measure")?.name
    || columns.find(column => column.role === "measure")?.name || "count";
  const range = { from: times.length ? comparableFilterValue(times[0]) : null, to: times.length ? comparableFilterValue(times.at(-1)) : null };
  return kind === "bar"
    ? { variant: "single", metrics: [metric], aggregation: "auto", ...range }
    : { measure: metric, ...range };
}

function regionKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
}

export function popupRegionValue(feature, regionField) {
  return feature?.properties?.__location ?? feature?.properties?.[regionField];
}

function roadIdentity(properties, regionField, columns) {
  const area = properties?.[roadAreaField(columns)];
  return JSON.stringify([
    roadNetworkForArea(area) || normalizeRoadText(area),
    normalizeRoadText(properties?.[regionField]),
    normalizeRoadText(properties?.[roadRefField(columns)]).replace(/ /g, "")
  ]);
}

export function popupFeaturesMatch(feature, other, regionField, { chartType = "choropleth", columns = [] } = {}) {
  if (chartType === "map_line") return roadIdentity(feature?.properties, regionField, columns) === roadIdentity(other?.properties, regionField, columns);
  return regionKey(popupRegionValue(feature, regionField)) === regionKey(popupRegionValue(other, regionField));
}

export function popupRegionRecords(records, feature, regionField, options = {}) {
  const value = popupRegionValue(feature, regionField);
  return regionKey(value) ? records.filter(record => popupFeaturesMatch({ properties: record }, feature, regionField, options)) : [];
}

export function buildPopupChart({ records, columns, feature, regionField, kind, selection, chartType = "choropleth" }) {
  const empty = message => ({ config: null, message });
  const region = popupRegionValue(feature, regionField);
  let selected = popupRegionRecords(records, feature, regionField, { chartType, columns });
  if (!selected.length) return empty(chartType === "map_line" ? "Không có dữ liệu cho tuyến vừa chọn." : "Không có dữ liệu cho vùng vừa chọn.");
  const time = popupTimeColumn(columns);
  if (kind === "line" && !time) return empty("Biểu đồ đường cần cột thời gian.");
  if (time) {
    const times = uniqueTimeValues(selected, time);
    if (times.length && !timeValuesAreComparable(times, time)) return empty("Các mốc thời gian chưa cùng hệ quy chiếu.");
    selected = filterTimeRange(selected, time, selection.from, selection.to);
    selected = selected.filter(record => timeValueInfo(record[time.name], time));
  }
  if (!selected.length) return empty("Không có dữ liệu trong khoảng thời gian đã chọn.");
  const metrics = kind === "line" ? [selection.measure] : selection.metrics;
  const choices = new Set(columns.filter(column => column.role === "measure").map(column => column.name));
  if (kind === "bar") choices.add("count");
  if (!metrics?.length || metrics.some(metric => !choices.has(metric))) return empty("Chưa có chỉ số hợp lệ để vẽ biểu đồ.");
  const x = time?.name || regionField;
  const suggestion = { id: "map-popup", chartType: kind, title: `Dữ liệu của ${region}`, reason: "", agg: null, bindings: { x, y: kind === "line" ? metrics : metrics[0] } };
  // Multiple observations need an explicit, meaningful aggregation. Do not turn
  // an unknown aggregation into a silent average or a missing chart point.
  for (const metric of metrics) {
    const aggregation = metric === "count" ? "count" : kind === "bar" && ["sum", "mean", "min", "max"].includes(selection.aggregation)
      ? selection.aggregation : resolveAggregation({ bindings: { y: metric } }, columns);
    if (aggregation) continue;
    const counts = new Map();
    for (const record of selected) {
      const value = record[metric];
      if (value == null || value === "" || !Number.isFinite(Number(value))) continue;
      const key = time ? timeValueInfo(record[x], time).key : regionKey(record[x]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    if ([...counts.values()].some(count => count > 1)) return empty(`Chỉ số ${metric} có nhiều bản ghi tại một mốc nhưng chưa xác định phép gộp.`);
  }
  const option = kind === "bar"
    ? buildBarChartOption(suggestion, selected, columns, { ...selection, top: "all", preserveEmptyPoints: true })
    : buildLineChartOption(suggestion, selected, columns, { measure: selection.measure, seriesField: null, preserveEmptyPoints: true });
  const config = option.config;
  const validRows = config.data.filter(row => config.series.some(series => Number.isFinite(row[series.key])));
  if (!validRows.length) return empty("Không có số liệu hợp lệ cho chỉ số đã chọn.");
  if (kind === "line" && validRows.length < 2) return empty("Biểu đồ đường cần ít nhất hai mốc thời gian có số liệu.");
  const hasTime = time && selected.some(record => {
    const value = timeValueInfo(record[time.name], time)?.value;
    return value instanceof Date && Boolean(value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds());
  });
  return { config: { ...config, title: `${kind === "line" ? "Biểu đồ đường" : "Biểu đồ cột"} · ${region}`, subtitle: "", limit: "all", sort: "none",
    preserveMissingValues: true, animate: false, timeColumn: hasTime ? { ...time, granularity: "datetime" } : time }, message: "" };
}

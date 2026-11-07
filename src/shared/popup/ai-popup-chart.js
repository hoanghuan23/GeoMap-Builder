import { buildBarChartOption, buildLineChartOption, resolveAggregation } from "../import/ai-chart-pipeline.js";
import { comparableFilterValue } from "../import/ai-data-analysis.js";
import { filterTimeRange, timeValueInfo, timeValuesAreComparable, uniqueTimeValues } from "../data/time-values.js";
import { mapRegistry } from '../../maps/registry.js';
import { popupRegionValue, regionKey, regionTitle } from './subject.js';
export { popupRegionValue } from './subject.js';
import { normalizePopupSuggestions } from "../import/ai-chart-contract.js";
import { createPieSelection, buildPieChartData, pieChartFields } from './pie-chart-data.js';
import { measureUnit } from '../data/measure-semantics.js';

export function mapDisplaySuggestions(suggestions = [], selectedSuggestionId = null) {
  return suggestions.filter(item => Object.hasOwn(mapRegistry, item.chartType));
}

export function popupTimeColumn(columns = []) {
  return columns.find(column => column.role === "time") || null;
}

export function popupChartColumns(columns, bindings = {}) {
  const dimensions = new Set([bindings.lat, bindings.lng, bindings.x, bindings.sourceLat, bindings.sourceLng, bindings.targetLat, bindings.targetLng]);
  return columns.map(column => column.role === "measure" && dimensions.has(column.name) ? { ...column, role: "ignore" } : column);
}

export function popupDisplayOptions(suggestion, columns = []) {
  const chartColumns = popupChartColumns(columns, suggestion?.bindings);
  const time = popupTimeColumn(chartColumns);
  const hasMeasure = chartColumns.some(column => column.role === "measure");
  const options = normalizePopupSuggestions(suggestion?.popupSuggestions).map(item => {
    let unavailableReason = '';
    if (item.name === 'pie') {
      const pie = createPieSelection(chartColumns, suggestion?.bindings?.value, suggestion?.bindings, item.pie);
      const { groups, measures } = pieChartFields(chartColumns, suggestion?.bindings);
      const components = pie.metrics.map(name => measures.find(column => column.name === name));
      const valid = pie.groupField
        ? groups.some(column => column.name === pie.groupField) && (pie.measure === 'count' || measures.some(column => column.name === pie.measure))
        : components.length >= 2 && components.every(Boolean) && new Set(components.map(measureUnit)).size === 1;
      if (!valid) unavailableReason = 'Cần cột phân nhóm và giá trị hợp lệ hoặc ít nhất hai chỉ số thành phần cùng đơn vị.';
    } else if (item.name === 'info_image' && !suggestion?.popupContent?.imageFields?.length && !suggestion?.hasJoinedImages) unavailableReason = 'Chưa có trường hình ảnh hợp lệ';
    else if (item.name === 'line') unavailableReason = !time ? 'Cần cột thời gian để vẽ biểu đồ đường' : !hasMeasure ? 'Cần chỉ số đo hợp lệ để vẽ biểu đồ đường' : '';
    return { ...item, available: !unavailableReason, unavailableReason, fallback: false };
  });
  return options.some(item => item.available) ? options
    : [{ name: "info", confidence: null, available: true, unavailableReason: "", fallback: true }];
}

export function createPopupChartSelection(records, columns, metricField, kind, bindings = {}, pieBinding = null) {
  columns = popupChartColumns(columns, bindings);
  const time = popupTimeColumn(columns);
  const times = time ? uniqueTimeValues(records, time) : [];
  const metric = columns.find(column => column.name === metricField && column.role === "measure")?.name
    || columns.find(column => column.role === "measure")?.name || "count";
  const range = { from: times.length ? comparableFilterValue(times[0]) : null, to: times.length ? comparableFilterValue(times.at(-1)) : null };
  if (kind === 'pie') return { ...createPieSelection(columns, metricField, bindings, pieBinding), ...range, from: range.to };
  return kind === "bar"
    ? { variant: "single", metrics: [metric], aggregation: "auto", ...range }
    : { measure: metric, ...range };
}

export function popupFeaturesMatch(feature, other, regionField, { chartType = "choropleth", columns = [], bindings = {} } = {}) {
  if (bindings.nativeIdentity) return feature?.properties?.[bindings.nativeIdentity] === other?.properties?.[bindings.nativeIdentity];
  return mapRegistry[chartType]?.popup?.matches(feature, other, regionField, { columns, bindings }) ?? false;
}

export function popupRegionRecords(records, feature, regionField, options = {}) {
  const rules = mapRegistry[options.chartType || 'choropleth']?.popup;
  return rules?.acceptsSubject(feature, regionField, options)
    ? records.filter(record => popupFeaturesMatch({ properties: record }, feature, regionField, options)) : [];
}

export function buildPopupChart({ records, columns, feature, regionField, kind, selection, chartType = "choropleth", bindings = {}, colorRecords = records }) {
  columns = popupChartColumns(columns, bindings);
  const empty = message => ({ config: null, message });
  const rules = mapRegistry[chartType]?.popup;
  const region = rules?.title(feature, regionField, columns) || regionTitle(feature, regionField);
  let selected = popupRegionRecords(records, feature, regionField, { chartType, columns, bindings });
  if (!selected.length) return empty(rules?.emptyMessage || 'Không có dữ liệu cho đối tượng vừa chọn.');
  const time = popupTimeColumn(columns);
  if (kind === "line" && !time) return empty("Biểu đồ đường cần cột thời gian.");
  if (time) {
    const times = uniqueTimeValues(selected, time);
    if (times.length && !timeValuesAreComparable(times, time)) return empty("Các mốc thời gian chưa cùng hệ quy chiếu.");
    selected = filterTimeRange(selected, time, selection.from, selection.to);
    selected = selected.filter(record => timeValueInfo(record[time.name], time));
  }
  if (!selected.length) return empty("Không có dữ liệu trong khoảng thời gian đã chọn.");
  if (kind === 'pie') {
    try { return { config: buildPieChartData(selected, columns, selection, region, bindings, colorRecords), message: '' }; }
    catch (error) { return empty(error.message); }
  }
  const metrics = kind === "line" ? [selection.measure] : selection.metrics;
  const choices = new Set(columns.filter(column => column.role === "measure").map(column => column.name));
  if (kind === "bar") choices.add("count");
  if (!metrics?.length || metrics.some(metric => !choices.has(metric))) return empty("Chưa có chỉ số hợp lệ để vẽ biểu đồ.");
  // Explicit bar calculations summarize the whole filtered range, not each time bucket.
  const summarizeRange = kind === "bar" && ["sum", "mean", "min", "max"].includes(selection.aggregation);
  const x = summarizeRange ? "__popup_object" : time?.name || regionField || "__popup_object";
  if (x === "__popup_object") selected = selected.map(record => ({ ...record, [x]: region }));
  const suggestion = { id: "map-popup", chartType: kind, title: `Dữ liệu của ${region}`, reason: "", agg: null, bindings: { x, y: kind === "line" ? metrics : metrics[0] } };
  // Multiple observations need an explicit, meaningful aggregation. Do not turn
  // an unknown aggregation into a silent average or a missing chart point.
  for (const metric of metrics) {
    const aggregation = metric === "count" ? "count" : summarizeRange
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
    preserveMissingValues: true, animate: false, timeColumn: summarizeRange ? null : hasTime ? { ...time, granularity: "datetime" } : time }, message: "" };
}

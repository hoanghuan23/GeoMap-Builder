import { buildBarChartOption, buildLineChartOption, resolveAggregation } from "./ai-chart-pipeline.js";
import { comparableFilterValue } from "./ai-data-analysis.js";
import { filterTimeRange, timeValueInfo, timeValuesAreComparable, uniqueTimeValues } from "./time-values.js";
import { roadAreaField, roadNetworkForArea, roadRefField } from "./road-map-data.js";
import { normalizeRoadText } from "./text-utils.js";
import { isCoordinateLine, pointIdentity, pointTitleField } from "./coordinate-data.js";
import { administrativeContextFields, sourceLocationNames } from "./geographic-grain.js";
import { normalizePopupSuggestions } from "./ai-chart-contract.js";

export function mapDisplaySuggestions(suggestions = [], selectedSuggestionId = null) {
  return suggestions.filter(item => ["choropleth", "map_line", "point"].includes(item.chartType));
}

export function popupTimeColumn(columns = []) {
  return columns.find(column => column.role === "time") || null;
}

export function popupChartColumns(columns, bindings = {}) {
  const dimensions = new Set([bindings.lat, bindings.lng, bindings.x]);
  return columns.map(column => column.role === "measure" && dimensions.has(column.name) ? { ...column, role: "ignore" } : column);
}

export function popupDisplayOptions(suggestion, columns = []) {
  const chartColumns = popupChartColumns(columns, suggestion?.bindings);
  const time = popupTimeColumn(chartColumns);
  const hasMeasure = chartColumns.some(column => column.role === "measure");
  const options = normalizePopupSuggestions(suggestion?.popupSuggestions).map(item => {
    const unavailableReason = item.name !== "line" ? "" : !time ? "Cần cột thời gian để vẽ biểu đồ đường"
      : !hasMeasure ? "Cần chỉ số đo hợp lệ để vẽ biểu đồ đường" : "";
    return { ...item, available: !unavailableReason, unavailableReason, fallback: false };
  });
  return options.some(item => item.available) ? options
    : [{ name: "info", confidence: null, available: true, unavailableReason: "", fallback: true }];
}

export function createPopupChartSelection(records, columns, metricField, kind, bindings = {}) {
  columns = popupChartColumns(columns, bindings);
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

export function popupFeaturesMatch(feature, other, regionField, { chartType = "choropleth", columns = [], bindings = {} } = {}) {
  if (bindings.nativeIdentity) return feature?.properties?.[bindings.nativeIdentity] === other?.properties?.[bindings.nativeIdentity];
  if (chartType === "point") return pointIdentity(feature?.properties, columns, bindings) === pointIdentity(other?.properties, columns, bindings);
  if (isCoordinateLine({ chartType, bindings })) return !bindings.region || String(feature?.properties?.[bindings.region] ?? "").trim() === String(other?.properties?.[bindings.region] ?? "").trim();
  if (chartType === "map_line") return roadIdentity(feature?.properties, regionField, columns) === roadIdentity(other?.properties, regionField, columns);
  const locations = sourceLocationNames(feature?.properties); const otherLocations = sourceLocationNames(other?.properties);
  if (locations.length || otherLocations.length) {
    const left = locations.length ? locations : [popupRegionValue(feature, regionField)];
    const right = otherLocations.length ? otherLocations : [popupRegionValue(other, regionField)];
    return left.some(name => right.some(otherName => regionKey(name) === regionKey(otherName)));
  }
  if (regionKey(popupRegionValue(feature, regionField)) !== regionKey(popupRegionValue(other, regionField))) return false;
  const fields = administrativeContextFields(columns, regionField);
  return fields.every(field => regionKey(feature?.properties?.[field]) === regionKey(other?.properties?.[field]));
}

export function popupRegionRecords(records, feature, regionField, options = {}) {
  const value = popupRegionValue(feature, regionField);
  return regionKey(value) || options.chartType === "point" || isCoordinateLine({ chartType: options.chartType, bindings: options.bindings })
    ? records.filter(record => popupFeaturesMatch({ properties: record }, feature, regionField, options)) : [];
}

export function buildPopupChart({ records, columns, feature, regionField, kind, selection, chartType = "choropleth", bindings = {} }) {
  columns = popupChartColumns(columns, bindings);
  const empty = message => ({ config: null, message });
  const region = chartType === "point" ? feature?.properties?.[pointTitleField(columns)] || "Điểm dữ liệu"
    : popupRegionValue(feature, regionField) || feature?.properties?.__path_key || "Chuỗi tọa độ";
  let selected = popupRegionRecords(records, feature, regionField, { chartType, columns, bindings });
  if (!selected.length) return empty(chartType === "map_line" ? "Không có dữ liệu cho tuyến vừa chọn." : chartType === "point" ? "Không có dữ liệu cho điểm vừa chọn." : "Không có dữ liệu cho vùng vừa chọn.");
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

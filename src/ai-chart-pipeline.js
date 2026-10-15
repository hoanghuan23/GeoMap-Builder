import { BAR_COLORS, humanizeField } from "./charts/data-transformers.js";
import { LINE_COLORS } from "./charts/line-chart.js";
import { serializeTabularValue } from "./tabular-data.js";
import { latLngToCell } from "h3-js";

const AGGREGATIONS = new Set(["sum", "mean", "min", "max", "count"]);
const SUM_HINT = /(tổng|total|amount|doanh thu|revenue|lượng mưa|rain|count|số lượng)/i;

function columnMap(columns) {
  return new Map((columns || []).map(column => [column.name, column]));
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveAggregation(suggestion, columns) {
  if (AGGREGATIONS.has(suggestion?.agg)) return suggestion.agg;
  const valueName = suggestion?.bindings?.value || first(suggestion?.bindings?.y);
  const column = columnMap(columns).get(valueName);
  if (AGGREGATIONS.has(column?.aggDefault)) return column.aggDefault;
  return SUM_HINT.test(valueName || "") ? "sum" : "mean";
}

export function withSuggestionMetric(suggestion, metric, columns) {
  const slot = suggestion.chartType === "bar" ? "y" : "value";
  const updated = { ...suggestion, bindings: { ...suggestion.bindings, [slot]: metric }, agg: null };
  const byName = columnMap(columns);
  const label = field => byName.get(field)?.labelVi || humanizeField(field);
  const metricLabel = metric === "count" ? "Số bản ghi" : label(metric);
  const dimension = suggestion.chartType === "bar" ? suggestion.bindings.x : suggestion.bindings.region;
  updated.agg = metric === "count" ? "count" : resolveAggregation(updated, columns);
  updated.title = dimension ? `${metricLabel} theo ${label(dimension)}` : `${metricLabel} theo ô H3`;
  return updated;
}

function aggregate(values, aggregation) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (aggregation === "count") return values.length;
  if (!numbers.length) return null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function displayCategory(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function groupRecords(records, field) {
  const groups = new Map();
  for (const record of records) {
    const value = record?.[field];
    if (value == null || value === "") continue;
    const key = value instanceof Date ? value.toISOString() : String(value);
    if (!groups.has(key)) groups.set(key, { value, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()];
}

function isFiniteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function validMeasureRecords(records, field) {
  return records.filter(record => isFiniteValue(record?.[field]));
}

export function buildBarChartOption(suggestion, records, columns, { top = 12 } = {}) {
  const { x, y } = suggestion.bindings;
  const aggregation = y === "count" ? "count" : resolveAggregation(suggestion, columns);
  const valueKey = y === "count" ? "__count" : y;
  const groups = groupRecords(records, x).map(group => ({
    [x]: displayCategory(group.value),
    [valueKey]: aggregate(y === "count" ? group.records : group.records.map(record => record[y]).filter(value => value != null), aggregation),
    __records: group.records
  })).filter(row => Number.isFinite(row[valueKey]));
  groups.sort((a, b) => Math.abs(b[valueKey]) - Math.abs(a[valueKey]) || String(a[x]).localeCompare(String(b[x]), "vi"));
  const topCount = top === "all" ? Infinity : Math.max(1, Number(top) || 12);
  let data = groups;
  if (groups.length > topCount) {
    const visible = groups.slice(0, topCount);
    const remainder = groups.slice(topCount);
    const raw = remainder.flatMap(row => row.__records);
    visible.push({
      [x]: "Khác",
      [valueKey]: aggregate(y === "count" ? raw : raw.map(record => record[y]).filter(value => value != null), aggregation),
      __records: raw
    });
    data = visible;
  }
  data = data.map(({ __records, ...row }) => row);
  const valueColumn = columnMap(columns).get(y);
  return {
    id: suggestion.id,
    label: suggestion.title,
    icon: "singleBar",
    aiSuggestion: true,
    totalCategories: groups.length,
    config: {
      chartKind: "bar",
      variant: "single",
      title: suggestion.title,
      subtitle: suggestion.reason,
      unit: valueColumn?.unit || "",
      sourcePath: "$",
      xField: x,
      series: [{ key: valueKey, label: y === "count" ? "Số bản ghi" : valueColumn?.labelVi || humanizeField(y), color: BAR_COLORS[0] }],
      data,
      aggregation,
      showGrid: true,
      showLegend: false,
      showTooltip: true,
      showDataLabels: true
    }
  };
}

function lineSeriesKey(seriesValue, measure, multipleMeasures) {
  return multipleMeasures ? `${seriesValue} · ${measure}` : String(seriesValue);
}

export function buildLineChartOption(suggestion, records, columns, { selectedSeries = null, measure = null, defaultSeriesLimit = 5, maxSeries = 8 } = {}) {
  const { x, series } = suggestion.bindings;
  const allMeasures = Array.isArray(suggestion.bindings.y) ? suggestion.bindings.y : [suggestion.bindings.y];
  // có series: chỉ 1 measure (mặc định cột đầu, hoặc cột người dùng chọn); không series: vẽ nhiều measure
  const measures = series ? [allMeasures.includes(measure) ? measure : allMeasures[0]] : allMeasures;
  const byName = columnMap(columns);
  const labelOf = field => byName.get(field)?.labelVi || humanizeField(field);
  const aggregation = resolveAggregation({ ...suggestion, bindings: { ...suggestion.bindings, y: measures } }, columns);
  const xGroups = groupRecords(records, x).sort((a, b) => {
    const left = a.value instanceof Date ? a.value.getTime() : String(a.value);
    const right = b.value instanceof Date ? b.value.getTime() : String(b.value);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const available = [];
  if (series) {
    const counts = new Map();
    for (const record of records) {
      if (record?.[series] == null || record[series] === "") continue;
      for (const m of measures) {
        if (!Number.isFinite(Number(record?.[m]))) continue;
        const key = lineSeriesKey(record[series], m, measures.length > 1);
        const item = counts.get(key) || { key, label: key, seriesValue: record[series], measure: m, count: 0 };
        item.count += 1; counts.set(key, item);
      }
    }
    available.push(...[...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi")));
  } else {
    available.push(...measures.map(m => ({ key: m, label: labelOf(m), measure: m, count: validMeasureRecords(records, m).length })));
  }
  const requested = Array.isArray(selectedSeries) ? new Set(selectedSeries) : null;
  const selected = (requested ? available.filter(item => requested.has(item.key)) : available.slice(0, defaultSeriesLimit)).slice(0, maxSeries);
  const data = xGroups.map(group => {
    const row = { [x]: displayCategory(group.value) };
    for (const item of selected) {
      const matching = series ? group.records.filter(record => String(record?.[series]) === String(item.seriesValue)) : group.records;
      row[item.key] = aggregate(matching.map(record => record[item.measure]).filter(value => value != null), aggregation);
    }
    return row;
  }).filter(row => selected.some(item => Number.isFinite(row[item.key])));
  const rangeText = data.length ? ` · ${data[0][x]} – ${data.at(-1)[x]}` : "";
  return {
    id: suggestion.id,
    label: suggestion.title,
    icon: "line",
    aiSuggestion: true,
    availableSeries: available,
    selectedSeries: selected.map(item => item.key),
    availableMeasures: allMeasures.map(name => ({ key: name, label: labelOf(name) })),
    activeMeasure: measures[0],
    config: {
      chartKind: "line",
      variant: "line",
      // khi có series và nhiều measure, tiêu đề theo measure đang chọn; ngược lại giữ tiêu đề AI
      title: series && allMeasures.length > 1 ? `${labelOf(measures[0])} theo ${labelOf(x).toLowerCase()}` : suggestion.title,
      subtitle: `${selected.length}/${available.length} chuỗi${rangeText}`,
      unit: measures.length === 1 ? byName.get(measures[0])?.unit || "" : "",
      sourcePath: "$",
      xField: x,
      series: selected.map((item, index) => ({ key: item.key, label: item.label, color: LINE_COLORS[index % LINE_COLORS.length] })),
      data,
      aggregation,
      showGrid: true,
      showLegend: true,
      showTooltip: true,
      showDataLabels: false
    }
  };
}

export function defaultTimeFilter(records, columns, chartType) {
  if (!["choropleth", "hex_h3"].includes(chartType)) return null;
  const time = (columns || []).find(column => column.role === "time");
  if (!time) return null;
  const values = [...new Map(records.map(record => record?.[time.name]).filter(value => value instanceof Date && !Number.isNaN(value.getTime())).map(value => [value.toISOString(), value])).values()]
    .sort((a, b) => a.getTime() - b.getTime());
  if (values.length < 2) return null;
  return { column: time.name, control: "date-select", default: values.at(-1).toISOString(), values: values.map(value => value.toISOString()) };
}

export function applyPipelineFilters(records, filters = {}) {
  return records.filter(record => Object.entries(filters).every(([field, selected]) => {
    if (selected == null || selected === "" || Array.isArray(selected) && !selected.length) return true;
    const comparable = serializeTabularValue(record?.[field]);
    return Array.isArray(selected) ? selected.includes(String(comparable)) : String(comparable) === String(selected);
  }));
}

function requiredCoverage(suggestion, validRowRate) {
  const fields = Object.values(suggestion.bindings).flatMap(value => Array.isArray(value) ? value : [value]).filter(value => value && value !== "count");
  return fields.length ? Math.min(...fields.map(field => Number(validRowRate?.[field] || 0))) : 0;
}

export function evaluateSuggestion(suggestion, records, columns, validRowRate, { mapTilerAvailable = true, h3Resolution = 6 } = {}) {
  let feasibilityScore = requiredCoverage(suggestion, validRowRate);
  let available = true;
  let unavailableReason = "";
  if (suggestion.chartType === "bar") {
    const groups = groupRecords(records, suggestion.bindings.x).length;
    feasibilityScore = Math.min(feasibilityScore || 1, Math.min(1, groups / 2));
    if (groups < 2) { available = false; unavailableReason = "Cần ít nhất hai nhóm dữ liệu."; }
  } else if (suggestion.chartType === "line") {
    const groups = groupRecords(records, suggestion.bindings.x).length;
    feasibilityScore = Math.min(feasibilityScore, Math.min(1, groups / 2));
    if (groups < 2) { available = false; unavailableReason = "Cần ít nhất hai mốc thời gian hợp lệ."; }
  } else if (suggestion.chartType === "choropleth") {
    const groups = groupRecords(records, suggestion.bindings.region).length;
    feasibilityScore = Math.min(feasibilityScore, Math.min(1, groups / 2));
    if (!mapTilerAvailable) { available = false; unavailableReason = "Chưa cấu hình MAPTILER_API_KEY."; }
    else if (groups < 2) { available = false; unavailableReason = "Cần ít nhất hai địa danh hợp lệ."; }
  } else if (suggestion.chartType === "hex_h3") {
    const { lat, lng, value } = suggestion.bindings;
    const coordinateRows = records.filter(record => {
      if (!isFiniteValue(record?.[lat]) || !isFiniteValue(record?.[lng])) return false;
      const latitude = Number(record[lat]); const longitude = Number(record[lng]);
      return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    });
    const coordinateRate = records.length ? coordinateRows.length / records.length : 0;
    const cells = new Set(coordinateRows.flatMap(record => {
      const latitude = Number(record?.[lat]); const longitude = Number(record?.[lng]);
      return isFiniteValue(record?.[value]) ? [latLngToCell(latitude, longitude, h3Resolution)] : [];
    }));
    feasibilityScore = Math.min(feasibilityScore, coordinateRate);
    if (coordinateRate < .7) { available = false; unavailableReason = "Ít hơn 70% dòng có tọa độ hợp lệ."; }
    else if (cells.size < 2) { available = false; unavailableReason = "Cần ít nhất hai ô H3 có giá trị hợp lệ."; }
  }
  const effectiveConfidence = Math.min(1, Math.max(0, .6 * suggestion.confidence + .4 * feasibilityScore));
  return { ...suggestion, feasibilityScore, effectiveConfidence, available, unavailableReason };
}

export function prepareSuggestions(analysis, records, validRowRate, options = {}) {
  return analysis.suggestions.map(suggestion => evaluateSuggestion(suggestion, records, analysis.columns, validRowRate, options))
    .sort((a, b) => b.effectiveConfidence - a.effectiveConfidence || a.title.localeCompare(b.title, "vi"));
}

export function chartOptionForSuggestion(suggestion, records, columns, options = {}) {
  if (suggestion.chartType === "bar") return buildBarChartOption(suggestion, records, columns, options);
  if (suggestion.chartType === "line") return buildLineChartOption(suggestion, records, columns, options);
  return null;
}

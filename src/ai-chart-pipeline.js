import { BAR_COLORS, humanizeField } from "./charts/data-transformers.js";
import { formatLineX, LINE_COLORS } from "./charts/line-chart.js";
import { serializeTabularValue } from "./tabular-data.js";
import { chartTimeValue, compareTimeValues, timeValueInfo, timeValuesAreComparable, uniqueTimeValues } from "./time-values.js";
import { AGGREGATION_VALUES, measureAggregation, measureUnit } from "./measure-semantics.js";
import { latLngToCell } from "h3-js";
import { roadAreaField, roadNameField, roadValueColumns } from "./road-map-data.js";
import { normalizeRoadText } from "./congestion-data.js";

const AGGREGATIONS = new Set(AGGREGATION_VALUES);
const TOTAL_HINT = /(tổng|total)/i;
const LATITUDE_HINT = /(^|[\s_.-])(lat|latitude|vĩ độ|vi do)([\s_.-]|$)/i;
const LONGITUDE_HINT = /(^|[\s_.-])(lng|lon|long|longitude|kinh độ|kinh do)([\s_.-]|$)/i;

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
  return measureAggregation(column);
}

export function withSuggestionMetric(suggestion, metric, columns) {
  const slot = suggestion.chartType === "bar" ? "y" : "value";
  const updated = { ...suggestion, bindings: { ...suggestion.bindings, [slot]: metric }, agg: null };
  const byName = columnMap(columns);
  const label = field => byName.get(field)?.labelVi || humanizeField(field);
  const metricLabel = metric === "count" ? "Số bản ghi" : label(metric);
  const dimension = suggestion.chartType === "bar" ? suggestion.bindings.x : suggestion.bindings.region;
  updated.agg = suggestion.chartType === "map_line" && byName.get(metric)?.role !== "measure" ? null
    : metric === "count" ? "count" : resolveAggregation(updated, columns);
  updated.title = dimension ? `${metricLabel} theo ${label(dimension)}` : `${metricLabel} theo ô H3`;
  return updated;
}

function aggregate(values, aggregation) {
  const numbers = values.filter(isFiniteValue).map(Number);
  if (aggregation === "count") return values.length;
  if (!numbers.length) return null;
  if (!aggregation) return numbers.length === 1 ? numbers[0] : null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return aggregation === "mean" ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function displayCategory(value, includeTime = false) {
  if (value instanceof Date) return includeTime ? value.toISOString() : value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function groupRecords(records, field, column = null) {
  const groups = new Map();
  for (const record of records) {
    const value = record?.[field];
    if (value == null || value === "") continue;
    const time = column?.role === "time" ? timeValueInfo(value, column) : null;
    if (column?.role === "time" && !time) continue;
    const key = time?.key || (value instanceof Date ? value.toISOString() : String(value));
    if (!groups.has(key)) groups.set(key, { value, records: [] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()];
}

function isFiniteValue(value) {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
}

function validMeasureRecords(records, field) {
  return records.filter(record => isFiniteValue(record?.[field]));
}

export function barMetricOptions(columns) {
  return [
    { key: "count", label: "Số bản ghi", unit: "" },
    ...(columns || []).filter(column => column.role === "measure" && column.name !== "count")
      .map(column => ({ key: column.name, label: column.labelVi || humanizeField(column.name), unit: column.unit || "" }))
  ];
}

export function defaultBarMetrics(suggestion, columns, variant = "single") {
  const available = barMetricOptions(columns).map(item => item.key);
  const requested = first(suggestion?.bindings?.y);
  const primary = available.includes(requested) ? requested : available[0];
  if (variant !== "grouped") return primary ? [primary] : [];
  const byName = columnMap(columns);
  const measures = available.filter(key => key !== "count" && key !== primary
    && primary !== "count" && measureUnit(byName.get(key)) === measureUnit(byName.get(primary)));
  return [primary, ...measures].filter(Boolean).slice(0, 2);
}

export function normalizeBarSelection(suggestion, columns, saved = {}) {
  const available = new Set(barMetricOptions(columns).map(item => item.key));
  let variant = saved.variant === "grouped" ? "grouped" : "single";
  let metrics = [...new Set(saved.metrics || [])].filter(metric => available.has(metric));
  if (metrics.length < (variant === "grouped" ? 2 : 1)) metrics = defaultBarMetrics(suggestion, columns, variant);
  if (variant === "grouped" && metrics.length < 2) variant = "single";
  return {
    variant,
    metrics: variant === "single" ? metrics.slice(0, 1) : metrics,
    aggregation: AGGREGATIONS.has(saved.aggregation) && saved.aggregation !== "count" ? saved.aggregation : "auto"
  };
}

export function defaultBarLimit(suggestion, columns) {
  return columnMap(columns).get(suggestion.bindings.x)?.role === "time" ? "all" : 12;
}

export function buildBarChartOption(suggestion, records, columns, { top = null, metrics = null, variant = "single", aggregation = null, preserveEmptyPoints = false } = {}) {
  const { x } = suggestion.bindings;
  const byName = columnMap(columns);
  const available = new Set(barMetricOptions(columns).map(item => item.key));
  const requested = Array.isArray(metrics) ? metrics : defaultBarMetrics(suggestion, columns, variant);
  const metricNames = [...new Set(requested)].filter(metric => available.has(metric));
  const effectiveMetrics = (variant === "grouped" && metricNames.length >= 2 ? metricNames : metricNames.slice(0, 1));
  const selectedAggregation = AGGREGATIONS.has(aggregation) && aggregation !== "count" ? aggregation : null;
  const descriptors = effectiveMetrics.map(metric => {
    const metricSuggestion = {
      ...suggestion,
      agg: metric === first(suggestion.bindings.y) ? suggestion.agg : null,
      bindings: { ...suggestion.bindings, y: metric }
    };
    return {
      metric,
      key: metric === "count" ? "__count" : metric,
      label: metric === "count" ? "Số bản ghi" : byName.get(metric)?.labelVi || humanizeField(metric),
      unit: metric === "count" ? "" : byName.get(metric)?.unit || "",
      aggregation: metric === "count" ? "count" : selectedAggregation || resolveAggregation(metricSuggestion, columns)
    };
  });
  const valueFor = (descriptor, groupedRecords) => aggregate(
    descriptor.metric === "count"
      ? groupedRecords
      : groupedRecords.map(record => record[descriptor.metric]).filter(value => value != null),
    descriptor.aggregation
  );
  const timeDimension = byName.get(x)?.role === "time";
  const groups = groupRecords(records, x, byName.get(x)).map(group => ({
    [x]: timeDimension ? chartTimeValue(group.value, byName.get(x)) : displayCategory(group.value),
    ...Object.fromEntries(descriptors.map(descriptor => [descriptor.key, valueFor(descriptor, group.records)])),
    __dimensionValue: group.value,
    __records: group.records
  })).filter(row => preserveEmptyPoints || descriptors.some(descriptor => Number.isFinite(row[descriptor.key])));
  const primaryKey = descriptors[0]?.key;
  groups.sort(timeDimension
    ? (a, b) => compareTimeValues(a.__dimensionValue, b.__dimensionValue, byName.get(x))
    : (a, b) => Math.abs(b[primaryKey]) - Math.abs(a[primaryKey]) || String(a[x]).localeCompare(String(b[x]), "vi"));
  const limit = top ?? defaultBarLimit(suggestion, columns);
  const topCount = limit === "all" ? Infinity : Math.max(1, Number(limit) || 12);
  let data = groups;
  if (groups.length > topCount) {
    const visible = groups.slice(0, topCount);
    const remainder = groups.slice(topCount);
    const raw = remainder.flatMap(row => row.__records);
    if (!timeDimension) visible.push({
      [x]: "Khác",
      ...Object.fromEntries(descriptors.map(descriptor => [descriptor.key, valueFor(descriptor, raw)])),
      __records: raw
    });
    data = visible;
  }
  data = data.map(({ __dimensionValue, __records, ...row }) => row);
  const grouped = descriptors.length >= 2;
  const xLabel = byName.get(x)?.labelVi || humanizeField(x);
  const title = grouped
    ? `So sánh nhiều chỉ số theo ${xLabel.toLocaleLowerCase("vi")}`
    : descriptors[0] && descriptors[0].metric !== first(suggestion.bindings.y)
      ? `${descriptors[0].label} theo ${xLabel.toLocaleLowerCase("vi")}`
      : suggestion.title;
  const units = [...new Set(descriptors.map(item => item.unit))];
  return {
    id: suggestion.id,
    label: title,
    icon: grouped ? "groupedBar" : "singleBar",
    aiSuggestion: true,
    totalCategories: groups.length,
    config: {
      chartKind: "bar",
      variant: grouped ? "grouped" : "single",
      title,
      subtitle: suggestion.reason,
      unit: units.length === 1 ? units[0] : "",
      sourcePath: "$",
      xField: x,
      series: descriptors.map((item, index) => ({ key: item.key, label: item.label, color: BAR_COLORS[index % BAR_COLORS.length] })),
      data,
      aggregation: descriptors[0]?.aggregation || null,
      aggregations: Object.fromEntries(descriptors.map(item => [item.key, item.aggregation])),
      showGrid: true,
      showLegend: grouped,
      showTooltip: true,
      showDataLabels: true
    }
  };
}

function lineSeriesKey(seriesValue, measure, multipleMeasures) {
  return multipleMeasures ? `${seriesValue} · ${measure}` : String(seriesValue);
}

export function buildLineChartOption(suggestion, records, columns, { selectedSeries = null, measure = null, seriesField, scopeLabel = "", defaultSeriesLimit = 5, maxSeries = 8, preserveEmptyPoints = false } = {}) {
  const { x } = suggestion.bindings;
  // undefined keeps the AI suggestion, null aggregates all records, and a field splits the lines by that dimension.
  const series = seriesField === undefined ? suggestion.bindings.series : seriesField;
  const byName = columnMap(columns);
  const labelOf = field => byName.get(field)?.labelVi || humanizeField(field);
  const aiMeasures = Array.isArray(suggestion.bindings.y) ? suggestion.bindings.y : [suggestion.bindings.y];
  const columnMeasures = (columns || []).filter(column => column.role === "measure").map(column => column.name);
  const measureNames = columnMeasures.length ? columnMeasures : aiMeasures;
  const picked = measure && measureNames.includes(measure) ? measure : null;
  const requestedMeasures = picked ? [picked] : series ? [aiMeasures[0]] : aiMeasures;
  const primaryUnit = measureUnit(byName.get(requestedMeasures[0]));
  const measures = requestedMeasures.filter(name => measureUnit(byName.get(name)) === primaryUnit);
  // A user-picked metric must use that column's aggregation instead of the original AI suggestion's aggregation.
  const aggregation = resolveAggregation({
    ...suggestion,
    agg: picked ? null : suggestion.agg,
    bindings: { ...suggestion.bindings, y: measures }
  }, columns);
  const aggregations = new Map(measures.map(name => [name, resolveAggregation({
    ...suggestion, agg: name === aiMeasures[0] && !picked ? suggestion.agg : null, bindings: { y: [name] }
  }, columns)]));
  const xGroups = groupRecords(records, x, byName.get(x)).sort((a, b) => compareTimeValues(a.value, b.value, byName.get(x)));
  const includeTime = xGroups.some(group => group.value instanceof Date
    && !group.value.toISOString().endsWith("T00:00:00.000Z"));
  const available = [];
  if (series) {
    const counts = new Map();
    for (const record of records) {
      if (record?.[series] == null || record[series] === "") continue;
      for (const m of measures) {
        if (!isFiniteValue(record?.[m])) continue;
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
    const row = { [x]: includeTime ? displayCategory(group.value, true) : chartTimeValue(group.value, byName.get(x)) };
    for (const item of selected) {
      const matching = series ? group.records.filter(record => String(record?.[series]) === String(item.seriesValue)) : group.records;
      row[item.key] = aggregate(matching.map(record => record[item.measure]), aggregations.get(item.measure));
    }
    return row;
  }).filter(row => preserveEmptyPoints || selected.some(item => Number.isFinite(row[item.key])));

  const aggWord = { sum: "Tổng", mean: "Trung bình", max: "Cao nhất", min: "Thấp nhất", count: "Số lượng" }[aggregation] || "";
  const xLabel = labelOf(x).toLowerCase();
  let title = suggestion.title;
  if (measures.length === 1 && (picked || !series)) {
    title = series ? `${labelOf(measures[0])} theo ${xLabel}` : `${aggWord} ${labelOf(measures[0]).toLowerCase()} theo ${xLabel}`;
  }
  const rangeLabel = value => includeTime ? formatLineX(value, true) : value;
  const rangeText = data.length ? ` · ${rangeLabel(data[0][x])} – ${rangeLabel(data.at(-1)[x])}` : "";
  const subtitle = series
    ? `${selected.length}/${available.length} chuỗi${rangeText}`
    : `${scopeLabel ? `${aggWord} ${scopeLabel}` : "Gộp tất cả dòng dữ liệu"}${rangeText}`;

  return {
    id: suggestion.id,
    label: suggestion.title,
    icon: "line",
    aiSuggestion: true,
    availableSeries: available,
    selectedSeries: selected.map(item => item.key),
    availableMeasures: measureNames.map(name => ({ key: name, label: labelOf(name) })),
    activeMeasure: measures[0],
    maxSeries,
    config: {
      chartKind: "line",
      variant: "line",
      title,
      subtitle,
      unit: byName.get(measures[0])?.unit || "",
      sourcePath: "$",
      xField: x,
      series: selected.map((item, index) => ({ key: item.key, label: item.label, color: LINE_COLORS[index % LINE_COLORS.length] })),
      data,
      aggregation,
      aggregations: Object.fromEntries(aggregations),
      showGrid: true,
      showLegend: true,
      showTooltip: true,
      showDataLabels: false
    }
  };
}

export function defaultTimeFilter(records, columns, chartType) {
  if (!["choropleth", "hex_h3", "map_line"].includes(chartType)) return null;
  const time = (columns || []).find(column => column.role === "time");
  if (!time) return null;
  const values = uniqueTimeValues(records, time);
  if (values.length < 2 || !timeValuesAreComparable(values, time)) return null;
  const hasTime = values.some(value => value instanceof Date && (value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds()));
  const control = values.every(value => value instanceof Date) ? hasTime ? "datetime-select" : "date-select" : "select";
  return { column: time.name, control, default: String(serializeTabularValue(values.at(-1))), values: values.map(value => String(serializeTabularValue(value))) };
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
  if (["bar", "line"].includes(suggestion.chartType)) {
    const dimension = columnMap(columns).get(suggestion.bindings.x);
    const metrics = [suggestion.bindings.y].flat();
    const groups = groupRecords(records, suggestion.bindings.x, dimension).filter(group =>
      group.records.some(record => metrics.some(metric => metric === "count" || isFiniteValue(record?.[metric]))));
    const aggregationGroups = suggestion.chartType === "line" && suggestion.bindings.series
      ? groups.flatMap(group => groupRecords(group.records, suggestion.bindings.series)) : groups;
    feasibilityScore = Math.min(feasibilityScore, Math.min(1, groups.length / 2));
    if (groups.length < 2) {
      available = false;
      unavailableReason = suggestion.chartType === "line" ? "Cần ít nhất hai mốc thời gian hợp lệ có số liệu." : "Cần ít nhất hai nhóm dữ liệu có số liệu.";
    } else if (dimension?.role === "time" && !timeValuesAreComparable(groups.map(group => group.value), dimension)) {
      available = false;
      unavailableReason = "Các giá trị thời gian chưa cùng hệ quy chiếu (kỳ lặp và ngày có năm).";
    } else if (metrics.some((metric, index) => metric !== "count" && !resolveAggregation({ ...suggestion, agg: index === 0 ? suggestion.agg : null, bindings: { y: metric } }, columns)
      && aggregationGroups.some(group => validMeasureRecords(group.records, metric).length > 1))) {
      available = false;
      unavailableReason = "Có nhiều bản ghi trong một nhóm nhưng chưa xác định được phép gộp có ý nghĩa cho chỉ số.";
    }
  } else if (suggestion.chartType === "map_line") {
    const groups = groupRecords(records, suggestion.bindings.region).length;
    if (!groups) { available = false; unavailableReason = "Không có tên tuyến hợp lệ để ghép với mạng đường."; }
  } else if (suggestion.chartType === "choropleth") {
    const groups = groupRecords(records, suggestion.bindings.region).length;
    feasibilityScore = Math.min(feasibilityScore, Math.min(1, groups / 2));
    if (!mapTilerAvailable) { available = false; unavailableReason = "Chưa cấu hình MAPTILER_API_KEY."; }
    else if (groups < 2) { available = false; unavailableReason = "Cần ít nhất hai địa danh hợp lệ."; }
  } else if (suggestion.chartType === "point") {
    const { lat, lng } = suggestion.bindings;
    const coordinateRows = records.filter(record => {
      if (!isFiniteValue(record?.[lat]) || !isFiniteValue(record?.[lng])) return false;
      const latitude = Number(record[lat]); const longitude = Number(record[lng]);
      return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    });
    const coordinateRate = records.length ? coordinateRows.length / records.length : 0;
    feasibilityScore = Math.min(feasibilityScore, coordinateRate);
    if (coordinateRate < .7) { available = false; unavailableReason = "Ít hơn 70% dòng có tọa độ hợp lệ."; }
    else if (!coordinateRows.length) { available = false; unavailableReason = "Không có tọa độ hợp lệ để hiển thị."; }
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

function complementaryTimeBar(analysis, records) {
  // A valid line establishes the analysis intent. Do not override an explicit
  // empty AI decision or silently collapse a series/category/geographic grain.
  const line = analysis.suggestions?.find(suggestion => suggestion.chartType === "line");
  if (!line || line.bindings.series) return null;
  const byName = columnMap(analysis.columns);
  const time = byName.get(line.bindings.x);
  if (time?.role !== "time") return null;
  const groups = groupRecords(records, time.name, time);
  if (groups.length < 2 || !timeValuesAreComparable(groups.map(group => group.value), time)) return null;
  if (analysis.columns.some(column => ["category", "geo"].includes(column.role)
    && groupRecords(records, column.name).length > 1)) return null;
  const measures = [line.bindings.y].flat().map(name => byName.get(name)).filter(column => column?.role === "measure");
  if (!measures.length) return null;
  const primary = measures[0];
  const components = measures.filter(column => measureUnit(column) === measureUnit(primary));
  const total = components.length >= 2 ? analysis.columns.find(column => {
    if (column.role !== "measure" || components.includes(column) || measureUnit(column) !== measureUnit(primary)
      || !TOTAL_HINT.test(`${column.name} ${column.labelVi || ""}`)) return false;
    const comparable = records.filter(record => [column, ...components].every(item => isFiniteValue(record?.[item.name])));
    return comparable.length >= 2 && comparable.every(record => {
      const sum = components.reduce((value, item) => value + Number(record[item.name]), 0);
      return Math.abs(Number(record[column.name]) - sum) <= Math.max(1, Math.abs(sum)) * 1e-8;
    });
  }) : null;
  const measure = total || primary;
  const validGroups = groups.filter(group => group.records.some(record => isFiniteValue(record?.[measure.name])));
  if (validGroups.length < 2) return null;
  const agg = measureAggregation(measure) || (measure === primary && AGGREGATIONS.has(line.agg) ? line.agg : null);
  if (!agg && validGroups.some(group => validMeasureRecords(group.records, measure.name).length > 1)) return null;
  let id = "time-bar";
  for (let suffix = 2; analysis.suggestions.some(suggestion => suggestion.id === id); suffix++) id = `time-bar-${suffix}`;
  return {
    id,
    chartType: "bar",
    title: `${measure.labelVi || humanizeField(measure.name)} theo ${(time.labelVi || humanizeField(time.name)).toLocaleLowerCase("vi")}`,
    bindings: { x: time.name, y: measure.name },
    agg,
    confidence: .82,
    reason: "Cùng chiều thời gian với biểu đồ đường; có thể so sánh độ lớn giữa các kỳ mà vẫn giữ grain và phép tính của chỉ số.",
    source: "rule"
  };
}

export function prepareSuggestions(analysis, records, validRowRate, options = {}) {
  const latitude = analysis.columns.find(column => column.geoLevel === "point_lat" || LATITUDE_HINT.test(column.name));
  const longitude = analysis.columns.find(column => column.geoLevel === "point_lng" || LONGITUDE_HINT.test(column.name));
  let suggestions = analysis.suggestions || [];
  const roadField = roadNameField(analysis.columns);
  if (roadField && roadAreaField(analysis.columns) && suggestions.length && !suggestions.some(item => item.chartType === "map_line")) {
    const values = roadValueColumns(analysis.columns, records, roadField);
    const value = values.find(column => /muc do un tac|congestion|traffic status/.test(normalizeRoadText(column.name)))
      || values.find(column => column.role === "measure");
    if (value) {
      let id = "road-map";
      for (let suffix = 2; suggestions.some(item => item.id === id); suffix++) id = `road-map-${suffix}`;
      suggestions = [{ id, chartType: "map_line", title: "Bản đồ Line", bindings: { region: roadField, value: value.name },
        agg: value.role === "measure" ? measureAggregation(value) : null, confidence: .85, source: "rule",
        reason: "Dữ liệu có khu vực, tên tuyến và chỉ số quan sát; có thể ghép mạng đường để xem phân bố và biểu đồ riêng của từng tuyến." }, ...suggestions];
    }
  }
  const region = analysis.columns.find(column => column.role === "geo" && ["country", "admin1", "admin2"].includes(column.geoLevel));
  if (!latitude && !longitude && !roadField && region && !suggestions.some(suggestion => suggestion.chartType === "choropleth")) {
    const groups = groupRecords(records, region.name);
    const measure = analysis.columns.find(column => column.role === "measure"
      && groups.filter(group => group.records.some(record => isFiniteValue(record?.[column.name]))).length >= 2);
    if (measure) {
      const regionLabel = region.labelVi || humanizeField(region.name);
      suggestions = [{
        id: "regional-choropleth",
        chartType: "choropleth",
        title: `Bản đồ polygon theo ${regionLabel.toLocaleLowerCase("vi")}`,
        bindings: { region: region.name, value: measure.name },
        agg: resolveAggregation({ bindings: { value: measure.name } }, analysis.columns),
        confidence: .85,
        reason: "Dữ liệu có địa danh hành chính và chỉ số theo từng vùng; có thể so sánh các vùng bằng màu sắc và lọc theo thời gian.",
        source: "rule"
      }, ...suggestions];
    }
  }
  if (!suggestions.some(suggestion => suggestion.chartType === "bar")) {
    const bar = complementaryTimeBar(analysis, records);
    if (bar) suggestions = [...suggestions, bar];
  }
  if (latitude && longitude) {
    suggestions = suggestions.filter(suggestion => suggestion.chartType !== "hex_h3");
    if (!suggestions.some(suggestion => suggestion.chartType === "point")) {
      suggestions = [{
        id: "coordinate-point",
        chartType: "point",
        title: "Vị trí các bản ghi",
        bindings: { lat: latitude.name, lng: longitude.name },
        agg: null,
        confidence: .95,
        reason: "Mỗi dòng có một cặp kinh độ, vĩ độ nên được hiển thị trực tiếp bằng điểm.",
        source: "rule"
      }, ...suggestions];
    }
  }
  return suggestions.map(suggestion => evaluateSuggestion(suggestion, records, analysis.columns, validRowRate, options))
    .sort((a, b) => latitude && longitude
      ? Number(b.chartType === "point") - Number(a.chartType === "point") || b.effectiveConfidence - a.effectiveConfidence || a.title.localeCompare(b.title, "vi")
      : b.effectiveConfidence - a.effectiveConfidence || a.title.localeCompare(b.title, "vi"));
}

export function chartOptionForSuggestion(suggestion, records, columns, options = {}) {
  if (suggestion.chartType === "bar") return buildBarChartOption(suggestion, records, columns, options);
  if (suggestion.chartType === "line") return buildLineChartOption(suggestion, records, columns, options);
  return null;
}

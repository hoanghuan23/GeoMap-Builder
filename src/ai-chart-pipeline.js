import { BAR_COLORS, humanizeField } from "./charts/data-transformers.js";
import { formatLineX, LINE_COLORS } from "./charts/line-chart.js";
import { serializeTabularValue } from "./tabular-data.js";
import { latLngToCell } from "h3-js";

const AGGREGATIONS = new Set(["sum", "mean", "min", "max", "count"]);
const SUM_HINT = /(tổng|total|amount|doanh thu|revenue|lượng mưa|rain|count|số lượng)/i;
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
  updated.agg = suggestion.chartType === "map_line" && byName.get(metric)?.role !== "measure" ? null
    : metric === "count" ? "count" : resolveAggregation(updated, columns);
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

function displayCategory(value, includeTime = false) {
  if (value instanceof Date) return includeTime ? value.toISOString() : value.toISOString().slice(0, 10);
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
  const measures = available.filter(key => key !== "count" && key !== primary);
  return [primary, ...measures, ...available.filter(key => key !== primary && !measures.includes(key))].filter(Boolean).slice(0, 2);
}

export function buildBarChartOption(suggestion, records, columns, { top = 12, metrics = null, variant = "single", aggregation = null } = {}) {
  const { x } = suggestion.bindings;
  const byName = columnMap(columns);
  const available = new Set(barMetricOptions(columns).map(item => item.key));
  const requested = Array.isArray(metrics) ? metrics : defaultBarMetrics(suggestion, columns, variant);
  const metricNames = [...new Set(requested)].filter(metric => available.has(metric));
  const effectiveMetrics = (variant === "grouped" && metricNames.length >= 2 ? metricNames : metricNames.slice(0, 1));
  const selectedAggregation = ["sum", "mean"].includes(aggregation) ? aggregation : null;
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
  const groups = groupRecords(records, x).map(group => ({
    [x]: displayCategory(group.value),
    ...Object.fromEntries(descriptors.map(descriptor => [descriptor.key, valueFor(descriptor, group.records)])),
    __records: group.records
  })).filter(row => descriptors.length && descriptors.every(descriptor => Number.isFinite(row[descriptor.key])));
  const primaryKey = descriptors[0]?.key;
  groups.sort((a, b) => Math.abs(b[primaryKey]) - Math.abs(a[primaryKey]) || String(a[x]).localeCompare(String(b[x]), "vi"));
  const topCount = top === "all" ? Infinity : Math.max(1, Number(top) || 12);
  let data = groups;
  if (groups.length > topCount) {
    const visible = groups.slice(0, topCount);
    const remainder = groups.slice(topCount);
    const raw = remainder.flatMap(row => row.__records);
    visible.push({
      [x]: "Khác",
      ...Object.fromEntries(descriptors.map(descriptor => [descriptor.key, valueFor(descriptor, raw)])),
      __records: raw
    });
    data = visible;
  }
  data = data.map(({ __records, ...row }) => row);
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

export function buildLineChartOption(suggestion, records, columns, { selectedSeries = null, measure = null, seriesField, scopeLabel = "", defaultSeriesLimit = 5, maxSeries = 8 } = {}) {
  const { x } = suggestion.bindings;
  // undefined keeps the AI suggestion, null aggregates all records, and a field splits the lines by that dimension.
  const series = seriesField === undefined ? suggestion.bindings.series : seriesField;
  const byName = columnMap(columns);
  const labelOf = field => byName.get(field)?.labelVi || humanizeField(field);
  const aiMeasures = Array.isArray(suggestion.bindings.y) ? suggestion.bindings.y : [suggestion.bindings.y];
  const columnMeasures = (columns || []).filter(column => column.role === "measure").map(column => column.name);
  const measureNames = columnMeasures.length ? columnMeasures : aiMeasures;
  const picked = measure && measureNames.includes(measure) ? measure : null;
  const measures = picked ? [picked] : series ? [aiMeasures[0]] : aiMeasures;
  // A user-picked metric must use that column's aggregation instead of the original AI suggestion's aggregation.
  const aggregation = resolveAggregation({
    ...suggestion,
    agg: picked ? null : suggestion.agg,
    bindings: { ...suggestion.bindings, y: measures }
  }, columns);
  const xGroups = groupRecords(records, x).sort((a, b) => {
    const left = a.value instanceof Date ? a.value.getTime() : String(a.value);
    const right = b.value instanceof Date ? b.value.getTime() : String(b.value);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const includeTime = xGroups.some(group => group.value instanceof Date
    && !group.value.toISOString().endsWith("T00:00:00.000Z"));
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
    const row = { [x]: displayCategory(group.value, includeTime) };
    for (const item of selected) {
      const matching = series ? group.records.filter(record => String(record?.[series]) === String(item.seriesValue)) : group.records;
      row[item.key] = aggregate(matching.map(record => record[item.measure]).filter(value => value != null), aggregation);
    }
    return row;
  }).filter(row => selected.some(item => Number.isFinite(row[item.key])));

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
  if (!["choropleth", "hex_h3", "map_line"].includes(chartType)) return null;
  const time = (columns || []).find(column => column.role === "time");
  if (!time) return null;
  const values = [...new Map(records.map(record => record?.[time.name]).filter(value => value instanceof Date && !Number.isNaN(value.getTime())).map(value => [value.toISOString(), value])).values()]
    .sort((a, b) => a.getTime() - b.getTime());
  if (values.length < 2) return null;
  const hasTime = values.some(value => value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds());
  return { column: time.name, control: hasTime ? "datetime-select" : "date-select", default: values.at(-1).toISOString(), values: values.map(value => value.toISOString()) };
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

export function prepareSuggestions(analysis, records, validRowRate, options = {}) {
  const latitude = analysis.columns.find(column => column.geoLevel === "point_lat" || LATITUDE_HINT.test(column.name));
  const longitude = analysis.columns.find(column => column.geoLevel === "point_lng" || LONGITUDE_HINT.test(column.name));
  let suggestions = analysis.suggestions || [];
  const region = analysis.columns.find(column => column.role === "geo" && ["country", "admin1", "admin2"].includes(column.geoLevel));
  if (!latitude && !longitude && region && !suggestions.some(suggestion => suggestion.chartType === "choropleth")) {
    const groups = groupRecords(records, region.name);
    const measure = analysis.columns.find(column => column.role === "measure"
      && groups.filter(group => group.records.some(record => isFiniteValue(record?.[column.name]))).length >= 2);
    if (measure) {
      const regionLabel = region.labelVi || humanizeField(region.name);
      suggestions = [{
        id: "regional-choropleth",
        chartType: "choropleth",
        title: `Biểu đồ vùng theo ${regionLabel.toLocaleLowerCase("vi")}`,
        bindings: { region: region.name, value: measure.name },
        agg: resolveAggregation({ bindings: { value: measure.name } }, analysis.columns),
        confidence: .85,
        reason: "Dữ liệu có địa danh hành chính và chỉ số theo từng vùng; có thể so sánh các vùng bằng màu sắc và lọc theo thời gian.",
        source: "rule"
      }, ...suggestions];
    }
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

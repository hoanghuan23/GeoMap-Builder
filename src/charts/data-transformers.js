const CATEGORY_HINTS = ["country", "province", "region", "category", "name", "label", "city", "state"];
const METRIC_HINTS = ["score", "happiness_score", "value", "average_score", "total", "amount"];
const COMPARISON_HINTS = ["gdp_per_capita", "social_support", "freedom", "healthy_life_expectancy"];
const NON_METRIC_PATTERN = /(^|_)(id|rank|index|code|year|edition|latitude|longitude|lat|lng|lon)($|_)/i;
const RANK_PATTERN = /(^|[._])(rank|ranking|order|position)($|[._])/i;

export const BAR_COLORS = Object.freeze(["#63c785", "#f58b61", "#5b8ff9", "#f6bd16", "#9270ca", "#6dc8ec"]);

export function normalizedFieldName(value) {
  return String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
}

export function humanizeField(value) {
  const text = String(value).replaceAll("_", " ").replaceAll(".", " · ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isDateValue(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;
  const text = value.trim();
  return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(text) && !Number.isNaN(Date.parse(text));
}

function valueType(value) {
  if (value == null) return "null";
  if (isDateValue(value)) return "Date";
  if (Array.isArray(value)) return "Array";
  if (value instanceof Date) return "Date";
  if (typeof value === "string") return "String";
  if (typeof value === "number") return "Number";
  if (typeof value === "boolean") return "Boolean";
  return "Object";
}

/** Flatten nested scalar values while retaining Object/Array paths in the schema. */
export function flattenDataRecord(record, output = {}, prefix = "", schemaValues = null) {
  for (const [key, value] of Object.entries(record || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (schemaValues) {
      if (!schemaValues.has(path)) schemaValues.set(path, []);
      schemaValues.get(path).push(value);
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      flattenDataRecord(value, output, path, schemaValues);
    } else if (!Array.isArray(value)) {
      output[path] = value instanceof Date ? value.toISOString() : value;
    }
  }
  return output;
}

function schemaFor(records) {
  const valuesByPath = new Map();
  const flatRecords = records.map(record => flattenDataRecord(record, {}, "", valuesByPath));
  const fields = [...valuesByPath.entries()].map(([path, rawValues]) => {
    const present = rawValues.filter(value => value != null && value !== "");
    const types = [...new Set(rawValues.map(valueType))];
    const scalarValues = present.filter(value => !Array.isArray(value) && (typeof value !== "object" || value instanceof Date));
    const numericValues = scalarValues.filter(value => typeof value === "number" && Number.isFinite(value));
    const inferredType = scalarValues.length && scalarValues.every(isDateValue)
      ? "Date"
      : scalarValues.length && scalarValues.every(value => typeof value === "number")
        ? "Number"
        : types.length === 1 ? types[0] : types.find(type => type !== "null") || "null";
    return {
      path,
      label: humanizeField(path),
      type: inferredType,
      types,
      validCount: scalarValues.length,
      numericCount: numericValues.length,
      nullable: rawValues.length < records.length || rawValues.some(value => value == null || value === "")
    };
  });
  return { fields, records: flatRecords };
}

function findHint(fields, hints) {
  return hints.map(hint => fields.find(field => normalizedFieldName(field.path) === hint)).find(Boolean);
}

function inspectDataset(records, path) {
  const { fields, records: flatRecords } = schemaFor(records);
  const categoryFields = fields.filter(field => ["String", "Date"].includes(field.type) && field.validCount > 0);
  const rankFields = fields.filter(field => field.type === "Number" && field.numericCount > 0 && RANK_PATTERN.test(field.path));
  const numericFields = fields.filter(field => field.type === "Number" && field.numericCount > 0 && !NON_METRIC_PATTERN.test(normalizedFieldName(field.path)));
  const allCategoryFields = [...categoryFields, ...rankFields.filter(field => !categoryFields.includes(field))];
  const suggestedCategory = findHint(categoryFields, CATEGORY_HINTS) || categoryFields[0] || rankFields[0];
  const firstMetric = findHint(numericFields, METRIC_HINTS) || numericFields[0];
  const comparison = [
    ...COMPARISON_HINTS.map(hint => numericFields.find(field => normalizedFieldName(field.path) === hint)).filter(Boolean),
    ...numericFields.filter(field => field !== firstMetric)
  ].filter((field, index, all) => all.indexOf(field) === index);
  const suggestedMetrics = [firstMetric, ...comparison].filter((field, index, all) => field && all.indexOf(field) === index);
  const score = (suggestedCategory ? 8 : 0) + numericFields.length * 4 + categoryFields.length * 2 + Math.min(records.length, 10);
  return {
    path,
    label: path === "$" ? "Dữ liệu chính" : humanizeField(path.split(".").pop()),
    rowCount: records.length,
    records: flatRecords,
    fields,
    categoryFields: allCategoryFields,
    numericFields,
    suggestedCategory: suggestedCategory?.path || null,
    suggestedMetrics: suggestedMetrics.map(field => field.path),
    score
  };
}

/** Discover every object-array in a JSON-like value and build its reusable schema once. */
export function analyzeDataSets(input) {
  const datasets = [];
  const seen = new Set();
  const visit = (value, path = "$") => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const meaningful = value.filter(item => item != null);
      const objects = value.filter(item => item && typeof item === "object" && !Array.isArray(item));
      if (objects.length && objects.length === meaningful.length) datasets.push(inspectDataset(objects, path));
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, path === "$" ? key : `${path}.${key}`);
  };
  visit(input);
  return datasets.sort((a, b) => b.score - a.score || b.rowCount - a.rowCount);
}

export function requiredMetricCount(variant) {
  if (variant === "single") return { min: 1, max: 1, message: "Cột đơn cần đúng 1 chỉ số." };
  if (variant === "double") return { min: 2, max: 2, message: "Cột đôi cần đúng 2 chỉ số." };
  if (variant === "line") return { min: 1, max: Infinity, message: "Biểu đồ đường cần ít nhất 1 chỉ số." };
  if (["pie", "halfPie"].includes(variant)) return { min: 1, max: Infinity, message: "Biểu đồ tròn cần ít nhất 1 chỉ số." };
  return { min: 2, max: Infinity, message: "Cột ghép cần từ 2 chỉ số trở lên." };
}

/** Apply the selection rule for each bar variant while preserving click order. */
export function nextMetricSelection(currentMetrics, key, variant) {
  const current = [...new Set(currentMetrics || [])];
  if (variant === "single") return [key];
  if (current.includes(key)) return current.filter(item => item !== key);
  if (variant === "double" && current.length >= 2) return [...current.slice(-1), key];
  return [...current, key];
}

export function validateBarMapping(dataset, mapping, variant) {
  if (!dataset) return { valid: false, message: "Hãy chọn một tập dữ liệu." };
  if (!dataset.categoryFields.some(field => field.path === mapping.xField)) return { valid: false, message: "Hãy chọn một trường danh mục hợp lệ." };
  const selected = [...new Set(mapping.metrics || [])];
  if (selected.some(key => !dataset.numericFields.some(field => field.path === key))) return { valid: false, message: "Một chỉ số đã chọn không còn hợp lệ với tập dữ liệu." };
  const rule = requiredMetricCount(variant);
  if (selected.length < rule.min || selected.length > rule.max) return { valid: false, message: rule.message };
  if (!dataForBarMapping(dataset, mapping).length) return { valid: false, message: "Không có bản ghi nào chứa đủ danh mục và các chỉ số đã chọn." };
  return { valid: true, message: "" };
}

export function dataForBarMapping(dataset, mapping) {
  const metrics = mapping.metrics || [];
  return (dataset?.records || []).filter(record => {
    const category = record[mapping.xField];
    return category != null && String(category).trim() !== ""
      && metrics.every(key => typeof record[key] === "number" && Number.isFinite(record[key]));
  });
}

export function seriesFromFields(fields) {
  return fields.map((key, index) => ({ key, label: humanizeField(key), color: BAR_COLORS[index % BAR_COLORS.length] }));
}

/** Preserve existing series colors without allowing two visible series to share a palette color. */
export function reconcileSeriesColors(nextSeries, previousSeries = [], palette = BAR_COLORS) {
  const previousByKey = new Map(previousSeries.map(item => [item.key, item]));
  const used = new Set();
  return nextSeries.map((item, index) => {
    const previousColor = previousByKey.get(item.key)?.color;
    const preferred = previousColor && !used.has(previousColor) ? previousColor : null;
    const available = palette.find(color => !used.has(color));
    const color = preferred || available || item.color || palette[index % palette.length];
    used.add(color);
    return { ...item, color };
  });
}

export function createBarOptions(dataset, titlePrefix = dataset?.label || "Dữ liệu") {
  if (!dataset?.suggestedCategory || !dataset.numericFields.length) return [];
  const base = { xField: dataset.suggestedCategory, unit: "", sourcePath: dataset.path };
  const suggested = dataset.suggestedMetrics;
  const first = suggested[0];
  const dataFor = metrics => dataForBarMapping(dataset, { xField: base.xField, metrics });
  const options = [{
    id: "single_bar", label: "Cột đơn", icon: "singleBar",
    config: { ...base, data: dataFor([first]), variant: "single", title: `${humanizeField(first)} theo ${humanizeField(base.xField).toLowerCase()}`, series: seriesFromFields([first]) }
  }];
  if (dataset.numericFields.length >= 2) {
    const pair = suggested.slice(0, 2);
    const group = suggested.slice(0, Math.min(4, suggested.length));
    options.push({ id: "double_bar", label: "Cột đôi", icon: "doubleBar", config: { ...base, data: dataFor(pair), variant: "double", title: `So sánh hai chỉ số · ${titlePrefix}`, series: seriesFromFields(pair) } });
    options.push({ id: "grouped_bar", label: "Cột ghép", icon: "groupedBar", config: { ...base, data: dataFor(group), variant: "grouped", title: `So sánh nhiều chỉ số · ${titlePrefix}`, series: seriesFromFields(group) } });
  }
  return options.filter(option => option.config.data.length);
}

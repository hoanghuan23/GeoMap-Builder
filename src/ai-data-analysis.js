const LOCATION_HINT = /(tỉnh|thành phố|province|city|district|quận|huyện|địa điểm|location|region|khu vực|area)/i;
const TIME_HINT = /(ngày|date|time|tháng|month|năm|year)/i;

function isDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime());
}

function jsonValue(value) {
  if (isDate(value)) return value.toISOString().slice(0, 10);
  return value;
}

export function summarizeTabularData(records, { maxSamples = 8, maxUnique = 80 } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error("File không có bản ghi dữ liệu.");
  const fields = [...new Set(records.flatMap(record => Object.keys(record || {})))];
  const columns = fields.map(name => {
    const values = records.map(record => record?.[name]).filter(value => value !== "" && value != null);
    const uniqueValues = [...new Map(values.map(value => [String(jsonValue(value)), jsonValue(value)])).values()];
    const numericCount = values.filter(value => typeof value === "number" && Number.isFinite(value)).length;
    const dateCount = values.filter(isDate).length;
    return {
      name,
      inferredType: dateCount === values.length ? "date" : numericCount === values.length ? "number" : "text",
      uniqueCount: uniqueValues.length,
      uniqueValues: uniqueValues.slice(0, maxUnique)
    };
  });
  return {
    rowCount: records.length,
    columns,
    samples: records.slice(0, maxSamples).map(record => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, jsonValue(value)])))
  };
}

export function fallbackMapRecommendation(records) {
  const summary = summarizeTabularData(records);
  const location = summary.columns.find(column => LOCATION_HINT.test(column.name) && column.inferredType === "text");
  const time = summary.columns.find(column => TIME_HINT.test(column.name) || column.inferredType === "date");
  const metrics = summary.columns.filter(column => column.inferredType === "number" && column.name !== time?.name);
  if (!location || !metrics.length) return null;
  return {
    canRenderMap: true,
    visualization: "polygon",
    geometry: { field: location.name, provider: "maptiler", placeType: "region" },
    metricField: metrics[0].name,
    numericFields: metrics.map(column => column.name),
    filters: [
      { field: location.name, label: location.name, control: "select", allowAll: true },
      ...(time ? [{ field: time.name, label: time.name, control: "date-select", allowAll: false }] : [])
    ],
    title: `${metrics[0].name} theo ${location.name}`,
    explanation: "Nhận diện theo quy tắc dự phòng: dữ liệu có địa phương và các chỉ số số.",
    confidence: 0.7,
    source: "rule"
  };
}

export async function requestAiMapRecommendation(records, { signal } = {}) {
  const fallback = fallbackMapRecommendation(records);
  if (!fallback) return null;
  const profile = summarizeTabularData(records);
  try {
    const response = await fetch("/api/ai/analyze-map-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile }),
      signal
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `AI HTTP ${response.status}`);
    const recommendation = await response.json();
    const fieldNames = new Set(Object.keys(records[0] || {}));
    const numericFields = new Set(profile.columns.filter(column => column.inferredType === "number").map(column => column.name));
    if (!recommendation.canRenderMap || recommendation.visualization !== "polygon") return null;
    if (!fieldNames.has(recommendation.geometry?.field) || !fieldNames.has(recommendation.metricField)) return fallback;
    if (!numericFields.has(recommendation.metricField)) return fallback;
    recommendation.numericFields = [
      recommendation.metricField,
      ...recommendation.numericFields.filter(field => numericFields.has(field) && field !== recommendation.metricField)
    ];
    const seenFilters = new Set();
    recommendation.filters = recommendation.filters.filter(filter => {
      if (!fieldNames.has(filter.field) || seenFilters.has(filter.field)) return false;
      seenFilters.add(filter.field);
      return true;
    });
    if (!seenFilters.has(recommendation.geometry.field)) {
      recommendation.filters.unshift({
        field: recommendation.geometry.field,
        label: recommendation.geometry.field,
        control: "select",
        allowAll: true
      });
      seenFilters.add(recommendation.geometry.field);
    }
    const temporalColumn = profile.columns.find(column =>
      column.uniqueCount > 1 && (column.inferredType === "date" || TIME_HINT.test(column.name))
    );
    if (temporalColumn && !seenFilters.has(temporalColumn.name)) {
      recommendation.filters.push({
        field: temporalColumn.name,
        label: temporalColumn.name,
        control: "date-select",
        allowAll: false
      });
    }
    return { ...recommendation, source: "ai" };
  } catch (error) {
    console.warn("AI recommendation fallback:", error);
    return { ...fallback, fallbackReason: error.message };
  }
}

export function displayFilterValue(value, control = "") {
  const date = isDate(value) ? value : control === "date-select" ? new Date(value) : null;
  if (date && !Number.isNaN(date.getTime())) return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return String(value ?? "");
}

export function comparableFilterValue(value) {
  return isDate(value) ? value.toISOString() : String(value ?? "");
}

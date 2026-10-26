import { summarizeFeatureProperties } from "./feature-properties.js";
import { geographicLocationName } from "./geographic-grain.js";
import { categoryColorProperties, categoryValue, featureCategoryValues } from "./categorical-color.js";
import { numericMapValue } from "./map-value.js";

function normalizedName(value) {
  return String(value ?? "").split(",").map(part => part
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()).join("\u001f");
}

function comparableValue(value) {
  return value instanceof Date ? value.toISOString() : String(value ?? "");
}

function matchesFilter(value, selectedValue) {
  const comparable = comparableValue(value);
  if (Array.isArray(selectedValue)) return !selectedValue.length || selectedValue.includes(comparable);
  return !selectedValue || comparable === selectedValue;
}

function isFiniteValue(value) {
  return (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
}

function aggregate(values, aggregation) {
  if (aggregation === "count") return values.length;
  const numbers = values.map(numericMapValue).filter(value => value != null);
  if (!numbers.length) return null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters = {}, columns = null, includeMissingMetric = false } = {}) {
  const { metricField } = recommendation;
  const categorical = columns?.find(column => column.name === metricField)?.role === "category";
  const locationField = recommendation.geometry.field;
  const byLocation = new Map((boundaries?.features || []).map(feature => [
    normalizedName(feature.properties?.__data_location || feature.text || feature.place_name?.split(",")[0]),
    feature
  ]));
  const selected = records.filter(record => Object.entries(filters).every(([field, selectedValue]) =>
    matchesFilter(record[field], selectedValue)
  ));
  const aggregation = categorical ? null : recommendation.aggregation || recommendation.agg;
  const groups = aggregation ? [...selected.reduce((groups, record) => {
    const location = geographicLocationName(record, recommendation.geometry);
    if (!location) return groups;
    const group = groups.get(location) || [];
    group.push(record); groups.set(location, group);
    return groups;
  }, new Map())].map(([location, records]) => ({ location, records }))
    : selected.map(record => ({ location: geographicLocationName(record, recommendation.geometry), records: [record] }));
  const features = groups.flatMap(group => {
    const locationName = group.location;
    const boundary = byLocation.get(normalizedName(locationName));
    if (!boundary?.geometry) return [];
    const recordProperties = columns?.length
      ? summarizeFeatureProperties(group.records, columns, { metricField, metricAggregation: aggregation })
      : {
          ...group.records[0],
          ...(aggregation ? { [metricField]: aggregate(group.records.map(record => record[metricField]).filter(value => value != null), aggregation) } : {})
        };
    const metric = recordProperties[metricField];
    const hasMetric = categorical ? categoryValue(metric) !== null : isFiniteValue(metric);
    if (metricField && !hasMetric && !includeMissingMetric) return [];
    const boundaryProperties = { ...(boundary.properties || {}) };
    for (const column of columns || []) delete boundaryProperties[column?.name];
    const properties = {
      ...boundaryProperties,
      ...recordProperties,
      __location: String(group.records[0]?.[locationField] ?? "").trim(),
      ...(recommendation.geometry.contextFields?.length ? { __location_context: recommendation.geometry.contextFields } : {}),
      __metric: categorical ? null : numericMapValue(metric),
      ...(categorical ? categoryColorProperties(metricField, group.records.map(record => record[metricField])) : {}),
      __record_count: group.records.length,
      boundary_source: boundary.properties?.boundary_source || "MapTiler"
    };
    for (const [field, value] of Object.entries(properties)) {
      if (value instanceof Date) properties[field] = value.toISOString();
    }
    return [{ type: "Feature", properties, geometry: boundary.geometry, bbox: boundary.bbox }];
  });
  return { type: "FeatureCollection", features };
}

/** Consolidate display geometry only; source rows and metric aggregation stay independent. */
export function collapseCountryFeatures(data, locationField, { categoryField = null } = {}) {
  const groups = new Map();
  for (const [index, feature] of (data.features || []).entries()) {
    const key = feature.properties?.__resolved_location_key || (categoryField ? feature.properties?.__data_location : null) || `feature:${index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }
  return { ...data, features: [...groups.values()].map(features => {
    if (features.length === 1) return features[0];
    const feature = features[0];
    const properties = feature.properties;
    const name = properties.__resolved_location_name || properties.__location;
    return { ...feature, properties: { ...properties, [locationField]: name, __location: name,
      __source_locations: [...new Set(features.map(item => item.properties.__location || item.properties.__data_location))],
      ...(categoryField ? categoryColorProperties(categoryField, features.flatMap(item => featureCategoryValues(item.properties, categoryField))) : {}),
      __record_count: features.reduce((sum, item) => sum + (item.properties.__record_count || 1), 0) } };
  }) };
}

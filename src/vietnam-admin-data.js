import { summarizeFeatureProperties } from "./feature-properties.js";
import { geographicLocationName } from "./geographic-grain.js";
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

function aggregate(values, aggregation) {
  if (aggregation === "count") return values.length;
  const numbers = values.map(numericMapValue).filter(value => value != null);
  if (!numbers.length) return null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters = {}, columns = null } = {}) {
  const { metricField } = recommendation;
  const locationField = recommendation.geometry.field;
  const byLocation = new Map((boundaries?.features || []).map(feature => [
    normalizedName(feature.properties?.__data_location || feature.text || feature.place_name?.split(",")[0]),
    feature
  ]));
  const selected = records.filter(record => Object.entries(filters).every(([field, selectedValue]) =>
    matchesFilter(record[field], selectedValue)
  ));
  const aggregation = recommendation.aggregation || recommendation.agg;
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
    const boundaryProperties = { ...(boundary.properties || {}) };
    for (const column of columns || []) delete boundaryProperties[column?.name];
    const properties = {
      ...boundaryProperties,
      ...recordProperties,
      __location: String(group.records[0]?.[locationField] ?? "").trim(),
      ...(recommendation.geometry.contextFields?.length ? { __location_context: recommendation.geometry.contextFields } : {}),
      __metric: numericMapValue(recordProperties[metricField]),
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

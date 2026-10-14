function normalizedName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
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
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters = {} } = {}) {
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
  const rows = aggregation ? [...selected.reduce((groups, record) => {
    const location = String(record?.[locationField] ?? "").trim();
    if (!location) return groups;
    const group = groups.get(location) || [];
    group.push(record); groups.set(location, group);
    return groups;
  }, new Map())].map(([location, group]) => ({
    ...group[0],
    [locationField]: location,
    [metricField]: aggregate(group.map(record => record[metricField]).filter(value => value != null), aggregation),
    __record_count: group.length
  })) : selected;
  const features = rows.flatMap(record => {
    const locationName = String(record[locationField] ?? "").trim();
    const boundary = byLocation.get(normalizedName(locationName));
    if (!boundary?.geometry) return [];
    const properties = {
      ...(boundary.properties || {}),
      ...record,
      __location: locationName,
      __metric: Number(record[metricField]),
      boundary_source: "MapTiler"
    };
    for (const [field, value] of Object.entries(properties)) {
      if (value instanceof Date) properties[field] = value.toISOString();
    }
    return [{ type: "Feature", properties, geometry: boundary.geometry, bbox: boundary.bbox }];
  });
  return { type: "FeatureCollection", features };
}

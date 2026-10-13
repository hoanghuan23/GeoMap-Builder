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

export function joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters = {} } = {}) {
  const { metricField } = recommendation;
  const locationField = recommendation.geometry.field;
  const byLocation = new Map((boundaries?.features || []).map(feature => [
    normalizedName(feature.properties?.__data_location || feature.text || feature.place_name?.split(",")[0]),
    feature
  ]));
  const selected = records.filter(record => Object.entries(filters).every(([field, selectedValue]) =>
    !selectedValue || comparableValue(record[field]) === selectedValue
  ));
  const features = selected.flatMap(record => {
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

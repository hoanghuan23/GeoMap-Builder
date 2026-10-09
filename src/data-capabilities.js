const MAP_TYPES = [
  { id: "point", label: "Point", icon: "point", renderer: "MapLibre", accepts: profile => profile.hasPoints },
  { id: "circle", label: "Circle", icon: "circle", renderer: "MapLibre", accepts: profile => profile.hasPoints },
  { id: "h3", label: "H3 Hexagon", icon: "hexagon", renderer: "H3", accepts: profile => profile.hasArea || profile.hasPoints },
  { id: "heatmap", label: "Heatmap", icon: "heatmap", renderer: "MapLibre", accepts: profile => profile.hasPoints && profile.numericFields.length > 0 },
  { id: "line", label: "Line", icon: "line", renderer: "MapLibre", accepts: profile => profile.hasLines },
  { id: "polygon", label: "Polygon", icon: "polygon", renderer: "MapLibre", accepts: profile => profile.hasArea }
];

function geometriesFrom(data) {
  if (!data) return [];
  if (data.type === "FeatureCollection") return data.features?.flatMap(feature => geometriesFrom(feature)) || [];
  if (data.type === "Feature") return geometriesFrom(data.geometry);
  if (data.type === "GeometryCollection") return data.geometries?.flatMap(geometriesFrom) || [];
  return typeof data.type === "string" ? [data] : [];
}

function propertiesFrom(data) {
  if (data?.type === "FeatureCollection") return data.features?.map(feature => feature?.properties || {}) || [];
  if (data?.type === "Feature") return [data.properties || {}];
  return [];
}

function classifyFields(records) {
  const valuesByField = new Map();
  for (const record of records) {
    for (const [field, value] of Object.entries(record)) {
      if (value == null || value === "") continue;
      const values = valuesByField.get(field) || [];
      values.push(value); valuesByField.set(field, values);
    }
  }
  const numericFields = []; const textFields = [];
  for (const [field, values] of valuesByField) {
    if (values.length && values.every(value => Number.isFinite(Number(value)))) numericFields.push(field);
    else textFields.push(field);
  }
  return { numericFields, textFields };
}

export function analyzeSpatialData(data, overrides = {}) {
  const geometries = geometriesFrom(data); const geometryTypes = [...new Set(geometries.map(geometry => geometry.type))];
  const fields = classifyFields(propertiesFrom(data));
  const hasType = (...types) => geometryTypes.some(type => types.includes(type));
  return {
    featureCount: data?.type === "FeatureCollection" ? data.features?.length || 0 : geometries.length,
    geometryTypes,
    numericFields: overrides.numericFields || fields.numericFields,
    textFields: overrides.textFields || fields.textFields,
    hasPoints: overrides.hasPoints ?? hasType("Point", "MultiPoint"),
    hasLines: overrides.hasLines ?? hasType("LineString", "MultiLineString"),
    hasArea: overrides.hasArea ?? hasType("Polygon", "MultiPolygon")
  };
}

export function analyzeCsvData(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() || "").split(",").map(value => value.trim());
  const rows = lines.map(line => line.split(",").map(value => value.trim()));
  const records = rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
  const fields = classifyFields(records); const coordinateNames = new Set(["lat", "latitude", "vĩ độ", "lng", "lon", "longitude", "kinh độ"]);
  const isCoordinate = field => coordinateNames.has(field.trim().toLowerCase());
  return analyzeSpatialData(null, {
    hasPoints: true,
    numericFields: fields.numericFields.filter(field => !isCoordinate(field)),
    textFields: fields.textFields.filter(field => !isCoordinate(field))
  });
}

export function compatibleMapTypes(profile) {
  return MAP_TYPES.filter(type => type.accepts(profile));
}

export function describeDataProfile(profile) {
  const geometry = profile.geometryTypes.length ? profile.geometryTypes.join(", ") : profile.hasPoints ? "Point (lat/lng)" : "không xác định";
  const value = profile.numericFields.length ? ` · ${profile.numericFields.length} cột số` : "";
  return `${geometry}${value}`;
}

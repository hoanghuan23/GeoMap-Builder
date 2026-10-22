import polygonClipping from "polygon-clipping";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });

function featuresFrom(data) {
  if (!data) return [];
  if (data.type === "FeatureCollection") return data.features || [];
  if (data.type === "Feature") return [data];
  return typeof data.type === "string" ? [{ type: "Feature", properties: {}, geometry: data }] : [];
}

function polygonsFromGeometry(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  if (geometry?.type === "GeometryCollection") return geometry.geometries?.flatMap(polygonsFromGeometry) || [];
  return [];
}

function maskMultiPolygon(mask) {
  const polygons = featuresFrom(mask).flatMap(feature => polygonsFromGeometry(feature.geometry));
  if (!polygons.length) return null;
  return polygons.length === 1 ? [polygons[0]] : polygonClipping.union(...polygons.map(polygon => [polygon]));
}

export function geometryKinds(data) {
  const kinds = new Set();
  const collect = geometry => {
    if (!geometry) return;
    if (geometry.type === "GeometryCollection") geometry.geometries?.forEach(collect);
    else if (["Polygon", "MultiPolygon"].includes(geometry.type)) kinds.add("area");
    else if (["LineString", "MultiLineString"].includes(geometry.type)) kinds.add("line");
    else if (["Point", "MultiPoint"].includes(geometry.type)) kinds.add("point");
  };
  featuresFrom(data).forEach(feature => collect(feature.geometry));
  return [...kinds];
}

/** Expose Point properties and geometry as rows for the existing AI pipeline. */
export function pointGeoJSONToRecords(data) {
  const kinds = geometryKinds(data);
  if (kinds.length !== 1 || kinds[0] !== "point") return null;
  const features = featuresFrom(data);
  const names = new Set(features.flatMap(feature => Object.keys(feature.properties || {})));
  const unusedField = base => {
    let name = base;
    for (let suffix = 2; names.has(name); suffix++) name = `${base}_${suffix}`;
    names.add(name);
    return name;
  };
  // Separate fields ensure geometry stays authoritative without overwriting properties.
  const lat = unusedField("__geojson_latitude");
  const lng = unusedField("__geojson_longitude");
  const id = features.some(feature => feature.id != null) ? unusedField("__geojson_feature_id") : null;
  const rowsFrom = (geometry, properties) => {
    if (geometry?.type === "GeometryCollection") return geometry.geometries?.flatMap(item => rowsFrom(item, properties)) || [];
    const positions = geometry?.type === "Point" ? [geometry.coordinates]
      : geometry?.type === "MultiPoint" ? geometry.coordinates : [];
    return (positions || []).map(position => {
      const valid = Array.isArray(position) && position.length >= 2
        && position.slice(0, 2).every(value => typeof value === "number" && Number.isFinite(value))
        && Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
      return { [lat]: valid ? position[1] : null, [lng]: valid ? position[0] : null, ...properties };
    });
  };
  const records = features.flatMap(feature => rowsFrom(feature.geometry, {
    ...feature.properties,
    ...(id ? { [id]: feature.id ?? null } : {})
  }));
  return records.length ? { records, bindings: { lat, lng } } : null;
}

export function clipGeoJSONToPolygon(data, mask) {
  const clip = maskMultiPolygon(mask);
  if (!clip) return EMPTY_FEATURE_COLLECTION;
  const features = featuresFrom(data).flatMap(feature => {
    const polygons = polygonsFromGeometry(feature.geometry);
    if (!polygons.length) return [];
    const intersection = polygonClipping.intersection(polygons, clip);
    if (!intersection.length) return [];
    const geometry = intersection.length === 1
      ? { type: "Polygon", coordinates: intersection[0] }
      : { type: "MultiPolygon", coordinates: intersection };
    return [{ ...feature, geometry }];
  });
  return { type: "FeatureCollection", features };
}

export function featureCount(data) {
  return featuresFrom(data).length;
}

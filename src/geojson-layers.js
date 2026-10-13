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

export function isHexagonGeoJSON(data, name = "") {
  const features = featuresFrom(data);
  if (!features.length || !geometryKinds(data).includes("area")) return false;
  if (/hex(agon)?s?/i.test(name)) return true;
  return features.some(feature => {
    const properties = feature.properties || {};
    return /hex/i.test(String(properties.geometry_type || "")) || properties.h3 != null;
  });
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

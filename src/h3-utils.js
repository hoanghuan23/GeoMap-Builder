import { polygonToCells, latLngToCell, cellToBoundary, cellToLatLng } from "h3-js";
import { numericMapValue } from "./map-value.js";

function geometriesFromGeoJSON(data) {
  if (!data) return [];
  if (data.type === "FeatureCollection") return data.features?.flatMap(geometriesFromGeoJSON) || [];
  if (data.type === "Feature") return geometriesFromGeoJSON(data.geometry);
  if (data.type === "GeometryCollection") return data.geometries?.flatMap(geometriesFromGeoJSON) || [];
  return [data];
}

function toH3Polygon(polygon) { return polygon.map(ring => ring.map(([lng, lat]) => [lat, lng])); }

export function geoJSONToCells(data, resolution) {
  const cells = [];
  for (const geometry of geometriesFromGeoJSON(data)) {
    if (geometry?.type === "Polygon") cells.push(...polygonToCells(toH3Polygon(geometry.coordinates), resolution));
    if (geometry?.type === "MultiPolygon") geometry.coordinates.forEach(polygon => cells.push(...polygonToCells(toH3Polygon(polygon), resolution)));
    if (geometry?.type === "Point") cells.push(latLngToCell(geometry.coordinates[1], geometry.coordinates[0], resolution));
    if (geometry?.type === "MultiPoint") geometry.coordinates.forEach(([lng, lat]) => cells.push(latLngToCell(lat, lng, resolution)));
  }
  return [...new Set(cells)];
}

export function cellsToFeatureCollection(cells) {
  return { type:"FeatureCollection", features: cells.map(cell => {
    const boundary = cellToBoundary(cell).map(([lat,lng]) => [lng,lat]); boundary.push(boundary[0]);
    const [lat,lng] = cellToLatLng(cell);
    return { type:"Feature", properties:{ h3:cell, center_lat:lat, center_lng:lng }, geometry:{type:"Polygon",coordinates:[boundary]} };
  }) };
}

function geoJSONFeatures(data) {
  if (!data) return [];
  if (data.type === "FeatureCollection") return data.features || [];
  if (data.type === "Feature") return [data];
  return [{ type: "Feature", properties: {}, geometry: data }];
}

export function geoJSONToH3FeatureCollection(data, resolution) {
  const propertiesByCell = new Map();
  for (const feature of geoJSONFeatures(data)) {
    for (const cell of geoJSONToCells(feature.geometry, resolution)) {
      if (!propertiesByCell.has(cell)) propertiesByCell.set(cell, { ...(feature.properties || {}) });
    }
  }
  const collection = cellsToFeatureCollection([...propertiesByCell.keys()]);
  for (const feature of collection.features) {
    Object.assign(feature.properties, propertiesByCell.get(feature.properties.h3));
  }
  return collection;
}

const LATITUDE_FIELDS = new Set(["lat", "latitude", "vĩ độ", "vi do"]);
const LONGITUDE_FIELDS = new Set(["lng", "lon", "long", "longitude", "kinh độ", "kinh do"]);

function coordinateField(headers, aliases) {
  return headers.find(header => aliases.has(String(header).trim().toLowerCase()));
}

function isFiniteValue(value) {
  return numericMapValue(value) != null;
}

export function recordsToPointGeoJSON(records, { latField = null, lngField = null } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error("File không có bản ghi dữ liệu.");
  const headers = [...new Set(records.flatMap(record => record && typeof record === "object" ? Object.keys(record) : []))];
  const latitudeField = latField && headers.includes(latField) ? latField : coordinateField(headers, LATITUDE_FIELDS);
  const longitudeField = lngField && headers.includes(lngField) ? lngField : coordinateField(headers, LONGITUDE_FIELDS);
  if (!latitudeField || !longitudeField) throw new Error("Dữ liệu cần có cột latitude/longitude hoặc lat/lng.");

  const features = records.flatMap(record => {
    if (!record || typeof record !== "object") return [];
    if (!isFiniteValue(record[latitudeField]) || !isFiniteValue(record[longitudeField])) return [];
    const latitude = Number(record[latitudeField]); const longitude = Number(record[longitudeField]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const properties = Object.fromEntries(Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value
    ]));
    return [{ type: "Feature", properties, geometry: { type: "Point", coordinates: [longitude, latitude] } }];
  });
  if (!features.length) throw new Error("Không tìm thấy tọa độ hợp lệ trong file.");
  return { type: "FeatureCollection", features };
}

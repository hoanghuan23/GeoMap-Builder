import { polygonToCells, latLngToCell, cellToBoundary, cellToLatLng, cellToParent, getResolution } from "h3-js";
import { summarizeFeatureProperties } from "./feature-properties.js";

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

export function cellAtMaxResolution(cell, maxResolution = 5) {
  return getResolution(cell) > maxResolution ? cellToParent(cell, maxResolution) : cell;
}

export function h3CellCenter(cell) {
  const [latitude, longitude] = cellToLatLng(cell);
  return [longitude, latitude];
}

export function csvPointsToGeoJSON(text) {
  const lines = text.trim().split(/\r?\n/); const originalHeaders = lines.shift().split(",").map(x => x.trim()); const headers = originalHeaders.map(x => x.toLowerCase());
  const latIndex = headers.findIndex(x => ["lat","latitude","vĩ độ"].includes(x)); const lngIndex = headers.findIndex(x => ["lng","lon","longitude","kinh độ"].includes(x));
  if (latIndex < 0 || lngIndex < 0) throw new Error("CSV cần có cột lat và lng.");
  const features = lines.map(line => line.split(",").map(value => value.trim())).filter(row => Number.isFinite(Number(row[latIndex])) && Number.isFinite(Number(row[lngIndex]))).map(row => ({
    type: "Feature",
    properties: Object.fromEntries(originalHeaders.map((header, index) => [header, Number.isFinite(Number(row[index])) && row[index] !== "" ? Number(row[index]) : row[index] ?? ""])),
    geometry: { type: "Point", coordinates: [Number(row[lngIndex]), Number(row[latIndex])] }
  }));
  if (!features.length) throw new Error("CSV không có tọa độ hợp lệ.");
  return { type: "FeatureCollection", features };
}

const LATITUDE_FIELDS = new Set(["lat", "latitude", "vĩ độ", "vi do"]);
const LONGITUDE_FIELDS = new Set(["lng", "lon", "long", "longitude", "kinh độ", "kinh do"]);

function coordinateField(headers, aliases) {
  return headers.find(header => aliases.has(String(header).trim().toLowerCase()));
}

function isFiniteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function recordsToPointGeoJSON(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("File không có bản ghi dữ liệu.");
  const headers = [...new Set(records.flatMap(record => record && typeof record === "object" ? Object.keys(record) : []))];
  const latitudeField = coordinateField(headers, LATITUDE_FIELDS);
  const longitudeField = coordinateField(headers, LONGITUDE_FIELDS);
  if (!latitudeField || !longitudeField) throw new Error("Dữ liệu cần có cột latitude/longitude hoặc lat/lng.");

  const features = records.flatMap(record => {
    if (!record || typeof record !== "object") return [];
    if (!isFiniteValue(record[latitudeField]) || !isFiniteValue(record[longitudeField])) return [];
    const latitude = Number(record[latitudeField]); const longitude = Number(record[longitudeField]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    const properties = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === latitudeField || key === longitudeField) continue;
      properties[key] = typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;
    }
    return [{ type: "Feature", properties, geometry: { type: "Point", coordinates: [longitude, latitude] } }];
  });
  if (!features.length) throw new Error("Không tìm thấy tọa độ hợp lệ trong file.");
  return { type: "FeatureCollection", features };
}

function aggregateNumbers(values, aggregation) {
  if (aggregation === "count") return values.length;
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  if (aggregation === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (aggregation === "min") return Math.min(...numbers);
  if (aggregation === "max") return Math.max(...numbers);
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function recordsToAggregatedH3(records, { latField, lngField, valueField, aggregation = "mean", resolution = 6, columns = null } = {}) {
  const groups = new Map();
  let coordinateRows = 0;
  for (const record of records || []) {
    if (!isFiniteValue(record?.[latField]) || !isFiniteValue(record?.[lngField])) continue;
    const latitude = Number(record?.[latField]); const longitude = Number(record?.[lngField]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    coordinateRows += 1;
    if (!isFiniteValue(record?.[valueField])) continue;
    const value = Number(record[valueField]);
    const cell = latLngToCell(latitude, longitude, resolution);
    const group = groups.get(cell) || { values: [], records: [] };
    group.values.push(value); group.records.push(record); groups.set(cell, group);
  }
  const collection = cellsToFeatureCollection([...groups.keys()]);
  for (const feature of collection.features) {
    const group = groups.get(feature.properties.h3);
    if (columns?.length) {
      const { h3, center_lat, center_lng } = feature.properties;
      Object.assign(feature.properties, summarizeFeatureProperties(group.records, columns, {
        metricField: valueField,
        metricAggregation: aggregation
      }), { h3, center_lat, center_lng });
    }
    feature.properties[valueField] = aggregateNumbers(group.values, aggregation);
    feature.properties.__metric = feature.properties[valueField];
    feature.properties.__record_count = group.records.length;
  }
  return {
    data: collection,
    stats: {
      totalRows: records?.length || 0,
      coordinateRows,
      coordinateRate: records?.length ? coordinateRows / records.length : 0,
      cellCount: collection.features.length
    }
  };
}

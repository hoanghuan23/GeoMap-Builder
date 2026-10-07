import { polygonToCells, latLngToCell, cellToBoundary, cellToLatLng, cellToParent, cellToCenterChild, getResolution } from "https://cdn.jsdelivr.net/npm/h3-js@4.1.0/+esm";

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

export function weatherCellFor(displayCell, weatherResolution) {
  const resolution = getResolution(displayCell);
  if (resolution > weatherResolution) return cellToParent(displayCell, weatherResolution);
  if (resolution < weatherResolution) return cellToCenterChild(displayCell, weatherResolution);
  return displayCell;
}

export function cellsToFeatureCollection(cells, weatherResolution, weatherRecords, trafficRecords = new Map()) {
  return { type:"FeatureCollection", features: cells.map(cell => {
    const boundary = cellToBoundary(cell).map(([lat,lng]) => [lng,lat]); boundary.push(boundary[0]);
    const [lat,lng] = cellToLatLng(cell); const weatherCell = weatherCellFor(cell, weatherResolution); const weather = weatherRecords.get(weatherCell); const traffic = trafficRecords.get(cell);
    return { type:"Feature", properties:{ h3:cell, weather_h3:weatherCell, center_lat:lat, center_lng:lng, temperature:weather?.temperature ?? null, humidity:weather?.humidity ?? null, updated_at:weather?.updatedAt ?? null, traffic_density:traffic?.density ?? null, current_speed:traffic?.currentSpeed ?? null, free_flow_speed:traffic?.freeFlowSpeed ?? null, speed_ratio:traffic?.speedRatio ?? null, traffic_status:traffic?.status ?? null, traffic_confidence:traffic?.confidence ?? null, traffic_updated_at:traffic?.updatedAt ?? null }, geometry:{type:"Polygon",coordinates:[boundary]} };
  }) };
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

export function recordsToPointGeoJSON(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("File không có bản ghi dữ liệu.");
  const headers = [...new Set(records.flatMap(record => record && typeof record === "object" ? Object.keys(record) : []))];
  const latitudeField = coordinateField(headers, LATITUDE_FIELDS);
  const longitudeField = coordinateField(headers, LONGITUDE_FIELDS);
  if (!latitudeField || !longitudeField) throw new Error("Dữ liệu cần có cột latitude/longitude hoặc lat/lng.");

  const features = records.flatMap(record => {
    if (!record || typeof record !== "object") return [];
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

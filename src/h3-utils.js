import { polygonToCells, cellToBoundary, cellToLatLng, cellToParent, cellToCenterChild, getResolution } from "https://cdn.jsdelivr.net/npm/h3-js@4.1.0/+esm";

function polygonsFromGeoJSON(data) {
  const geometries = data.type === "FeatureCollection" ? data.features.map(f => f.geometry) : data.type === "Feature" ? [data.geometry] : [data];
  return geometries.flatMap(g => g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : []);
}

function toH3Polygon(polygon) { return polygon.map(ring => ring.map(([lng, lat]) => [lat, lng])); }

export function geoJSONToCells(data, resolution) {
  const cells = [];
  for (const polygon of polygonsFromGeoJSON(data)) cells.push(...polygonToCells(toH3Polygon(polygon), resolution));
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
  const lines = text.trim().split(/\r?\n/); const headers = lines.shift().split(",").map(x => x.trim().toLowerCase());
  const latIndex = headers.findIndex(x => ["lat","latitude","vĩ độ"].includes(x)); const lngIndex = headers.findIndex(x => ["lng","lon","longitude","kinh độ"].includes(x));
  if (latIndex < 0 || lngIndex < 0) throw new Error("CSV cần có cột lat và lng.");
  const points = lines.map(line => line.split(",").map(Number)).filter(row => Number.isFinite(row[latIndex]) && Number.isFinite(row[lngIndex])).map(row => [row[lngIndex],row[latIndex]]);
  if (points.length < 3) throw new Error("CSV cần ít nhất 3 tọa độ để tạo vùng."); points.push(points[0]);
  return {type:"FeatureCollection",features:[{type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[points]}}]};
}

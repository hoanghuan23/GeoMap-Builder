import { getHexagonAreaAvg, getHexagonEdgeLengthAvg } from "h3-js";
import { geoJSONToH3FeatureCollection } from "./h3-utils.js";
import { CONFIG } from "./config.js";

function polygonBounds(data) {
  if (!data) return [];
  if (data.type === "FeatureCollection") return data.features.flatMap(polygonBounds);
  if (data.type === "Feature") return polygonBounds(data.geometry);
  if (data.type === "GeometryCollection") return data.geometries.flatMap(polygonBounds);
  const polygons = data.type === "Polygon" ? [data.coordinates] : data.type === "MultiPolygon" ? data.coordinates : [];
  return polygons.filter(polygon => polygon[0]?.length).map(polygon => {
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    for (const [lng, lat] of polygon[0]) {
      west = Math.min(west, lng); east = Math.max(east, lng);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    return { west, east, south, north };
  });
}

// Preflight before H3 allocates cells, including a first request at resolution 15.
function estimatedCells(bounds, resolution) {
  const edge = getHexagonEdgeLengthAvg(resolution, "km");
  const area = getHexagonAreaAvg(resolution, "km2");
  return bounds.reduce((total, { west, east, south, north }) => {
    const closestLatitude = south <= 0 && north >= 0 ? 0 : Math.min(Math.abs(south), Math.abs(north));
    const width = (east - west) * 111.32 * Math.cos(closestLatitude * Math.PI / 180);
    const height = (north - south) * 111.32;
    // Include boundary cells and variation in H3 cell area.
    return total + Math.ceil((width + 4 * edge) * (height + 4 * edge) / (area * .4));
  }, 0);
}

export function buildRegionHexGrid(data, requestedResolution = CONFIG.DEFAULT_RESOLUTION, maxCells = CONFIG.MAX_RENDER_CELLS) {
  if (!Number.isInteger(requestedResolution) || requestedResolution < 0 || requestedResolution > 15) {
    throw new RangeError("Độ phân giải H3 phải là số nguyên từ 0 đến 15.");
  }
  if (!Number.isInteger(maxCells) || maxCells < 1) throw new RangeError("Giới hạn số ô phải là số nguyên dương.");
  const bounds = polygonBounds(data);
  if (!bounds.length) return { data: { type: "FeatureCollection", features: [] }, resolution: requestedResolution };
  let resolution = requestedResolution;
  while (resolution > 0 && estimatedCells(bounds, resolution) > maxCells) resolution -= 1;
  let collection = geoJSONToH3FeatureCollection(data, resolution);
  while (resolution > 0 && collection.features.length > maxCells) {
    resolution -= 1;
    collection = geoJSONToH3FeatureCollection(data, resolution);
  }
  if (collection.features.length > maxCells) throw new Error("Vùng quá lớn để hiển thị trong giới hạn số ô.");
  return { data: collection, resolution };
}

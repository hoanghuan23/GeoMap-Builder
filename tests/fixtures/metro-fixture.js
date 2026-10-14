const times = Array.from({ length: 18 }, (_, index) => `${String(index + 5).padStart(2, "0")}:30`);
const boundaryRing = [[106.5, 10.6], [106.95, 10.6], [106.95, 11.05], [106.5, 11.05], [106.5, 10.6]];
const ids = [...Array.from({ length: 19 }, (_, index) => `hex_${String(index + 1).padStart(4, "0")}`), "hex_3980"];

function hexagon(centerLng, centerLat, radius = .002) {
  const ring = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * index;
    return [centerLng + Math.cos(angle) * radius, centerLat + Math.sin(angle) * radius];
  });
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

const centers = ids.map((_, index) => {
  if (index === 0) return [106.62, 10.69];
  if (index === 1) return [106.84, 10.92];
  return [106.65 + index % 6 * .025, 10.72 + Math.floor(index / 6) * .035];
});

const travelTimes = ids.flatMap((cellId, cellIndex) => times.map((departureTime, timeIndex) => {
  const motorbike = 18 + cellIndex * .4 + timeIndex * .2;
  const bus = motorbike * (1.2 + (cellIndex % 4) * .35 + timeIndex * .01);
  return { cell_id: cellId, departure_time: departureTime, bus_minutes: bus, motorbike_minutes: motorbike, ratio: bus / motorbike };
}));

const firstRows = new Map(travelTimes.filter(row => row.departure_time === "05:30").map(row => [row.cell_id, row]));

export const metroFixture = {
  metadata: { cell_count: ids.length, travel_time_count: travelTimes.length, departure_times: times },
  boundary: { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Test boundary" }, geometry: { type: "Polygon", coordinates: [boundaryRing] } }] },
  hexagons: {
    type: "FeatureCollection",
    features: ids.map((cellId, index) => ({
      type: "Feature",
      properties: { cell_id: cellId, ratio_0530: firstRows.get(cellId).ratio },
      geometry: hexagon(...centers[index])
    }))
  },
  stations: {
    type: "FeatureCollection",
    features: Array.from({ length: 13 }, (_, index) => ({ type: "Feature", properties: { name: `Ga ${index + 1}` }, geometry: { type: "Point", coordinates: [106.66 + index * .01, 10.78] } }))
  },
  metro_route: { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Tuyến thử" }, geometry: { type: "LineString", coordinates: [[106.66, 10.78], [106.82, 10.78]] } }] },
  travel_times: travelTimes
};

export const TRAVEL_COLORS = Object.freeze(["#53d7e8", "#168c50", "#e5b00d", "#f06b24"]);

export function readMetroData(data) {
  if (!data?.hexagons || !data?.boundary || !data?.stations || !data?.metro_route) return null;
  for (const key of ["hexagons", "boundary", "stations", "metro_route"]) {
    if (data[key].type !== "FeatureCollection" || !Array.isArray(data[key].features)) {
      throw new Error(`Lớp ${key} cần là GeoJSON FeatureCollection.`);
    }
  }
  if (!data.hexagons.features.length) throw new Error("Không có ô dữ liệu để hiển thị.");
  const records = Array.isArray(data.travel_times) ? data.travel_times : [];
  const times = [...new Set(records.map(row => row.departure_time).filter(time => typeof time === "string" && time))].sort();
  if (!times.length) throw new Error("Không có thời gian xuất phát trong travel_times.");
  const byTime = new Map(times.map(time => [time, new Map()]));
  for (const row of records) byTime.get(row.departure_time)?.set(row.cell_id, row);
  return { ...data, times, byTime };
}

export function metroCellsAtTime(data, time) {
  const rows = data.byTime.get(time) || new Map();
  return {
    type: "FeatureCollection",
    features: data.hexagons.features.map(feature => {
      const row = rows.get(feature.properties?.cell_id);
      const bus = row?.bus_minutes;
      const bike = row?.motorbike_minutes;
      const valid = typeof bus === "number" && Number.isFinite(bus) && bus >= 0 && typeof bike === "number" && Number.isFinite(bike) && bike > 0;
      // Join by cell and departure time; the static ratio_0530 can differ from travel_times.
      const { ratio_0530, ...properties } = feature.properties || {};
      return { ...feature, properties: { ...properties, departure_time: time,
        bus_minutes: valid ? bus : null, motorbike_minutes: valid ? bike : null,
        ratio: valid ? bus / bike : null } };
    })
  };
}

export function travelFillExpression(palette, fallback) {
  if (!palette) return fallback;
  const ramps = {
    travel: TRAVEL_COLORS,
    diverging: ["#313695", "#74add1", "#f46d43", "#a50026"],
    viridis: ["#440154", "#31688e", "#35b779", "#fde725"],
    blue: ["#eff6ff", "#93c5fd", "#3b82f6", "#1d4ed8"]
  };
  const colors = ramps[palette];
  if (!colors) return fallback;
  return ["case", ["==", ["get", "ratio"], null], "#64748b",
    ["step", ["get", "ratio"], colors[0], 1, colors[1], 2, colors[2], 3, colors[3]]];
}

export function travelLegendColors(palette) {
  const expression = travelFillExpression(palette, "#64748b");
  return Array.isArray(expression) ? [expression[3][2], expression[3][4], expression[3][6], expression[3][8]] : null;
}

export const CONFIG = Object.freeze({
  DEFAULT_DATA_URL: new URL("../gadm41_VNM_0.json", import.meta.url).href,
  DEFAULT_RESOLUTION: 5,
  WEATHER_RESOLUTION: 3,
  REQUEST_INTERVAL_MS: 1100,
  CACHE_TTL_MS: 15 * 60 * 1000,
  CACHE_KEY: "openweather-h3-weather-v2",
  API_KEY: import.meta.env.VITE_OPENWEATHER_API_KEY || "",
  TOMTOM_API_KEY: import.meta.env.VITE_TOMTOM_API_KEY || "",
  TRAFFIC_CACHE_KEY: "tomtom-h3-traffic-v1",
  TRAFFIC_CACHE_TTL_MS: 5 * 60 * 1000,
  TRAFFIC_REQUEST_INTERVAL_MS: 120,
  MAX_TRAFFIC_CELLS: 300,
  MAX_RENDER_CELLS: 120000
});

export const PALETTES = {
  thermal: [[10,"#313695"],[15,"#4575b4"],[20,"#74add1"],[25,"#abd9e9"],[28,"#ffffbf"],[30,"#fdae61"],[33,"#f46d43"],[36,"#d73027"],[40,"#a50026"]],
  viridis: [[10,"#440154"],[18,"#31688e"],[26,"#35b779"],[34,"#fde725"],[40,"#fff6a0"]],
  blue: [[10,"#eff6ff"],[18,"#bfdbfe"],[26,"#60a5fa"],[34,"#2563eb"],[40,"#1e3a8a"]]
};

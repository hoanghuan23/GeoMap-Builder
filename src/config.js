export const CONFIG = Object.freeze({
  DEFAULT_RESOLUTION: 5,
  MAX_RENDER_CELLS: 120000,
  MAPTILER_API_KEY: import.meta.env?.MAPTILER_API_KEY || "",
  OPENWEATHER_API_KEY: import.meta.env?.VITE_OPENWEATHER_API_KEY || ""
});

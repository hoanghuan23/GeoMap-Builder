const CURRENT_WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";
const WEATHER_CACHE_PREFIX = "geomap:openweather:v1:";
export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;

function weatherCacheKey(h3Index) {
  return `${WEATHER_CACHE_PREFIX}${h3Index}`;
}

export function readCachedWeather(h3Index, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  if (!h3Index || !storage) return null;
  const key = weatherCacheKey(h3Index);
  try {
    const entry = JSON.parse(storage.getItem(key));
    if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now || !entry.data) {
      storage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    try { storage.removeItem(key); } catch { /* localStorage có thể bị trình duyệt chặn. */ }
    return null;
  }
}

export function writeCachedWeather(h3Index, data, { storage = globalThis.localStorage, now = Date.now(), ttlMs = WEATHER_CACHE_TTL_MS } = {}) {
  const entry = { data, expiresAt: now + ttlMs };
  if (!h3Index || !storage) return entry;
  try { storage.setItem(weatherCacheKey(h3Index), JSON.stringify(entry)); } catch { /* Vẫn dùng cache trong bộ nhớ nếu storage đầy/bị chặn. */ }
  return entry;
}

export function buildCurrentWeatherUrl(latitude, longitude, apiKey) {
  const url = new URL(CURRENT_WEATHER_URL);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("appid", apiKey);
  url.searchParams.set("units", "metric");
  url.searchParams.set("lang", "vi");
  return url.toString();
}

export async function fetchCurrentWeather(latitude, longitude, { apiKey, signal, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("OPENWEATHER_API_KEY_MISSING");
  const response = await fetchImpl(buildCurrentWeatherUrl(latitude, longitude, apiKey), { signal });
  if (!response.ok) {
    const error = new Error(`OpenWeather request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  return {
    temperature: Number(data?.main?.temp),
    humidity: Number(data?.main?.humidity),
    visibility: Number(data?.visibility),
    windSpeed: Number(data?.wind?.speed),
    windDirection: Number(data?.wind?.deg),
    description: data?.weather?.[0]?.description || ""
  };
}

export function formatVisibility(metres) {
  if (!Number.isFinite(metres)) return "--";
  if (metres >= 1000) return `${Number((metres / 1000).toFixed(1))} km`;
  return `${Math.round(metres)} m`;
}

export function windDirectionLabel(degrees) {
  if (!Number.isFinite(degrees)) return "";
  const directions = ["B", "ĐB", "Đ", "ĐN", "N", "TN", "T", "TB"];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 45) % directions.length];
}

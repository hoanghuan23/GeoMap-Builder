import { cellToLatLng } from "https://cdn.jsdelivr.net/npm/h3-js@4.1.0/+esm";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function loadWeather({ cells, records, apiKey, intervalMs, signal, onRecord, onProgress }) {
  const pending = cells.filter(cell => !records.has(cell)); let loaded = cells.length - pending.length;
  onProgress?.(loaded, cells.length);
  if (!apiKey) throw new Error("Thiếu VITE_OPENWEATHER_API_KEY trong file .env.");
  for (let index = 0; index < pending.length; index++) {
    if (signal.aborted) return;
    const cell = pending[index]; const [lat,lon] = cellToLatLng(cell);
    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.search = new URLSearchParams({lat,lon,appid:apiKey,units:"metric"});
    const response = await fetch(url, {signal});
    if (response.status === 429) { const error = new Error("OpenWeather đang giới hạn tốc độ (HTTP 429)."); error.rateLimited = true; throw error; }
    if (!response.ok) { console.warn("OpenWeather:", response.status, await response.text()); continue; }
    const data = await response.json();
    if (Number.isFinite(data?.main?.temp)) {
      const record = {temperature:data.main.temp, humidity:Number.isFinite(data.main.humidity) ? data.main.humidity : null, updatedAt:(data.dt || Math.floor(Date.now()/1000))*1000};
      records.set(cell, record); loaded++; onRecord?.(cell, record); onProgress?.(loaded, cells.length);
    }
    if (index < pending.length - 1) await sleep(intervalMs);
  }
}

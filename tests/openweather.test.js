import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentWeatherUrl, fetchCurrentWeather, formatVisibility, readCachedWeather, WEATHER_CACHE_TTL_MS, windDirectionLabel, writeCachedWeather } from "../src/openweather.js";

test("OpenWeather URL requests metric current weather at the H3 cell centre", () => {
  const url = new URL(buildCurrentWeatherUrl(21.0285, 105.8542, "secret"));
  assert.equal(url.origin + url.pathname, "https://api.openweathermap.org/data/2.5/weather");
  assert.equal(url.searchParams.get("lat"), "21.0285");
  assert.equal(url.searchParams.get("lon"), "105.8542");
  assert.equal(url.searchParams.get("appid"), "secret");
  assert.equal(url.searchParams.get("units"), "metric");
  assert.equal(url.searchParams.get("lang"), "vi");
});

test("fetchCurrentWeather returns only popup weather fields", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      main: { temp: 29.4, humidity: 73 }, visibility: 8500,
      wind: { speed: 3.2, deg: 45 }, weather: [{ description: "mây rải rác" }]
    })
  });
  assert.deepEqual(await fetchCurrentWeather(21, 105, { apiKey: "key", fetchImpl }), {
    temperature: 29.4,
    humidity: 73,
    visibility: 8500,
    windSpeed: 3.2,
    windDirection: 45,
    description: "mây rải rác"
  });
});

test("weather formatters use concise Vietnamese units and directions", () => {
  assert.equal(formatVisibility(8500), "8.5 km");
  assert.equal(formatVisibility(750), "750 m");
  assert.equal(windDirectionLabel(45), "ĐB");
  assert.equal(windDirectionLabel(270), "T");
});

test("weather cache survives reload and expires after 15 minutes", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const weather = { temperature: 30, humidity: 70 };
  const start = 1_000_000;
  writeCachedWeather("85475b37fffffff", weather, { storage, now: start });

  assert.deepEqual(readCachedWeather("85475b37fffffff", { storage, now: start + WEATHER_CACHE_TTL_MS - 1 })?.data, weather);
  assert.equal(readCachedWeather("85475b37fffffff", { storage, now: start + WEATHER_CACHE_TTL_MS }), null);
  assert.equal(values.size, 0);
});

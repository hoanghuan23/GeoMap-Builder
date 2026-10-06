export function loadWeatherCache(key, ttlMs) {
  const records = new Map();
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (!cached || Date.now() - cached.savedAt > ttlMs) {
      localStorage.removeItem(key);
      return records;
    }
    for (const [cell, value] of Object.entries(cached.records || cached.temperatures || {})) {
      if (Number.isFinite(value)) records.set(cell, { temperature: value, humidity: null, updatedAt: cached.savedAt });
      else if (value && Number.isFinite(value.temperature)) records.set(cell, value);
    }
  } catch (error) { console.warn("Không đọc được cache OpenWeather:", error); }
  return records;
}

export function saveWeatherCache(key, records) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), records: Object.fromEntries(records) })); }
  catch (error) { console.warn("Không lưu được cache OpenWeather:", error); }
}

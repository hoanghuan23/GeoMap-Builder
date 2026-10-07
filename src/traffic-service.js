const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function loadTrafficCache(key, ttlMs) {
  const records = new Map();
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (!cached || Date.now() - cached.savedAt > ttlMs) {
      localStorage.removeItem(key);
      return records;
    }
    for (const [cell, value] of Object.entries(cached.records || {})) {
      if (value && Number.isFinite(value.density)) records.set(cell, value);
    }
  } catch (error) { console.warn("Không đọc được cache TomTom Traffic:", error); }
  return records;
}

export function saveTrafficCache(key, records) {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), records: Object.fromEntries(records) })); }
  catch (error) { console.warn("Không lưu được cache TomTom Traffic:", error); }
}

function trafficStatus(speedRatio) {
  if (speedRatio >= 0.8) return "Thông thoáng";
  if (speedRatio >= 0.5) return "Đông";
  if (speedRatio >= 0.25) return "Tắc";
  return "Tắc nặng";
}

export async function loadTraffic({ features, records, apiKey, intervalMs, signal, onRecord, onProgress }) {
  if (!apiKey) throw new Error("Thiếu VITE_TOMTOM_API_KEY trong file .env.");
  const pending = features.filter(feature => !records.has(feature.properties.h3));
  let loaded = features.length - pending.length;
  onProgress?.(loaded, features.length);

  for (let index = 0; index < pending.length; index++) {
    if (signal.aborted) return;
    const { h3, center_lat: lat, center_lng: lng } = pending[index].properties;
    const url = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/15/json");
    url.search = new URLSearchParams({ key: apiKey, point: `${lat},${lng}`, unit: "kmph" });
    const response = await fetch(url, { signal });
    if (response.status === 429) throw new Error("TomTom đang giới hạn tốc độ (HTTP 429). Vui lòng thử lại sau.");
    if (!response.ok) {
      console.warn("TomTom Traffic:", response.status, await response.text());
      onProgress?.(loaded, features.length);
      continue;
    }
    const traffic = (await response.json())?.flowSegmentData;
    if (Number.isFinite(traffic?.currentSpeed) && Number.isFinite(traffic?.freeFlowSpeed) && traffic.freeFlowSpeed > 0) {
      const ratio = Math.max(0, Math.min(1, traffic.currentSpeed / traffic.freeFlowSpeed));
      const record = {
        currentSpeed: traffic.currentSpeed,
        freeFlowSpeed: traffic.freeFlowSpeed,
        speedRatio: ratio * 100,
        density: (1 - ratio) * 100,
        status: trafficStatus(ratio),
        confidence: Number.isFinite(traffic.confidence) ? traffic.confidence : null,
        updatedAt: Date.now()
      };
      records.set(h3, record);
      loaded++;
      onRecord?.(h3, record);
    }
    onProgress?.(loaded, features.length);
    if (index < pending.length - 1) await sleep(intervalMs);
  }
}

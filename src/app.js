import { CONFIG, PALETTES } from "./config.js";
import { loadWeatherCache, saveWeatherCache } from "./cache.js";
import { geoJSONToCells, cellsToFeatureCollection, csvPointsToGeoJSON } from "./h3-utils.js";
import { loadWeather } from "./weather-service.js";

const $ = id => document.getElementById(id);
const state = {
  resolution: CONFIG.DEFAULT_RESOLUTION, boundary: null, h3Data: { type: "FeatureCollection", features: [] },
  weather: loadWeatherCache(CONFIG.CACHE_KEY, CONFIG.CACHE_TTL_MS), palette: "thermal", displayMode: "data",
  property: "temperature", page: 1, pageSize: 10, query: "", abortController: null, baselineCount: null
};
let map; let toastTimer; let renderTimer;

function showToast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }
function setStatus(message, hide = false) { const el = $("status"); el.textContent = message; el.style.display = "block"; if (hide) setTimeout(() => el.style.display = "none", 2200); }
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }
function formatTime(value) { return value ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--"; }

function fillExpression() {
  if (state.displayMode === "fixed") return $("fixed-color").value;
  const property = state.property; const stops = PALETTES[state.palette];
  const mapped = property === "humidity" ? stops.map(([v, c], i) => [i * (100 / (stops.length - 1)), c]) : stops;
  return ["case", ["==", ["get", property], null], "#64748b", ["interpolate", ["linear"], ["get", property], ...mapped.flat()]];
}

function applyStyle() {
  if (!map?.getLayer("h3-fill")) return;
  map.setPaintProperty("h3-fill", "fill-color", fillExpression());
  map.setPaintProperty("h3-fill", "fill-opacity", Number($("opacity").value));
  map.setPaintProperty("h3-border", "line-color", $("border-color").value);
  map.setPaintProperty("h3-border", "line-width", Number($("line-width").value));
  map.setLayoutProperty("h3-border", "visibility", $("show-border").checked ? "visible" : "none");
}

function addMapLayers() {
  map.addSource("h3-grid", { type: "geojson", data: state.h3Data });
  map.addLayer({ id: "h3-fill", type: "fill", source: "h3-grid", paint: { "fill-color": fillExpression(), "fill-opacity": .72 } });
  map.addLayer({ id: "h3-border", type: "line", source: "h3-grid", paint: { "line-color": "#ffffff", "line-width": .5, "line-opacity": .75 } });
  map.addSource("vietnam-boundary", { type: "geojson", data: state.boundary });
  map.addLayer({ id: "vietnam-border", type: "line", source: "vietnam-boundary", paint: { "line-color": "#00e65c", "line-width": 2 } });
  map.on("click", "h3-fill", event => {
    const p = event.features?.[0]?.properties; if (!p) return;
    new maplibregl.Popup({ offset: 8 }).setLngLat(event.lngLat).setHTML(`<div style="font:12px Inter;line-height:1.8"><b>H3:</b> ${p.h3}<br><b>Nhiệt độ:</b> ${p.temperature == null ? "Không có dữ liệu" : fmt(Number(p.temperature)) + " °C"}<br><b>Độ ẩm:</b> ${p.humidity == null ? "Không có dữ liệu" : fmt(Number(p.humidity), 0) + "%"}<br><b>Tâm ô:</b> ${fmt(Number(p.center_lat), 5)}, ${fmt(Number(p.center_lng), 5)}</div>`).addTo(map);
  });
  map.on("mouseenter", "h3-fill", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "h3-fill", () => map.getCanvas().style.cursor = "");
}

function estimateCellCount(resolution) {
  if (!state.baselineCount) return 0;
  return Math.round(state.baselineCount * Math.pow(7, resolution - CONFIG.DEFAULT_RESOLUTION));
}

async function rebuildGrid({ fit = false } = {}) {
  state.abortController?.abort();
  const estimate = estimateCellCount(state.resolution);
  if (estimate > CONFIG.MAX_RENDER_CELLS) {
    const previous = state.resolution; state.resolution = Math.min(7, CONFIG.DEFAULT_RESOLUTION + Math.floor(Math.log(CONFIG.MAX_RENDER_CELLS / state.baselineCount) / Math.log(7)));
    $("resolution").value = state.resolution; $("resolution-value").value = state.resolution;
    showToast(`Resolution ${previous} ước tính ${estimate.toLocaleString("vi-VN")} ô, vượt giới hạn an toàn.`); return;
  }
  setStatus(`Đang tạo H3 resolution ${state.resolution}…`);
  await new Promise(resolve => setTimeout(resolve, 20));
  try {
    const cells = geoJSONToCells(state.boundary, state.resolution);
    if (!state.baselineCount && state.resolution === CONFIG.DEFAULT_RESOLUTION) state.baselineCount = cells.length;
    state.h3Data = cellsToFeatureCollection(cells, CONFIG.WEATHER_RESOLUTION, state.weather);
    const source = map.getSource("h3-grid"); if (source) source.setData(state.h3Data);
    $("cell-count").textContent = cells.length.toLocaleString("vi-VN"); $("cell-label").textContent = `Tổng số cell (res ${state.resolution})`;
    state.page = 1; updateDashboard();
    if (fit) fitBoundary();
    const weatherCells = [...new Set(state.h3Data.features.map(f => f.properties.weather_h3))];
    startWeatherLoad(weatherCells);
  } catch (error) { console.error(error); setStatus("Không thể tạo lưới H3."); showToast(error.message || "Dữ liệu không hợp lệ."); }
}

function startWeatherLoad(weatherCells) {
  const controller = new AbortController(); state.abortController = controller;
  const featuresByParent = new Map();
  for (const feature of state.h3Data.features) { const key = feature.properties.weather_h3; const list = featuresByParent.get(key) || []; list.push(feature); featuresByParent.set(key, list); }
  loadWeather({
    cells: weatherCells, records: state.weather, apiKey: CONFIG.API_KEY, intervalMs: CONFIG.REQUEST_INTERVAL_MS, signal: controller.signal,
    onProgress: (loaded, total) => setStatus(`Đang tải thời tiết: ${loaded}/${total} vùng…`),
    onRecord: (cell, record) => { if (controller.signal.aborted) return; for (const feature of featuresByParent.get(cell) || []) Object.assign(feature.properties, { temperature: record.temperature, humidity: record.humidity, updated_at: record.updatedAt }); saveWeatherCache(CONFIG.CACHE_KEY, state.weather); scheduleRender(); }
  }).then(() => { if (!controller.signal.aborted) { scheduleRender(); setStatus(`Đã cập nhật dữ liệu cho ${state.h3Data.features.length.toLocaleString("vi-VN")} ô H3.`, true); } }).catch(error => { if (error.name !== "AbortError") { console.error(error); setStatus(error.message); showToast(error.message); } });
}

function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => { map.getSource("h3-grid")?.setData(state.h3Data); updateDashboard(); }, 120); }
function updateDashboard() { updateLegend(); updateStatistics(); renderTable(); }
function updateLegend() {
  const humidity = state.property === "humidity"; $("legend-title").textContent = humidity ? "Độ ẩm (%)" : "Nhiệt độ (°C)";
  $("legend-labels").innerHTML = (humidity ? ["0", "25", "50", "75", "100"] : ["≤10", "20", "25", "30", "≥40"]).map(x => `<span>${x}</span>`).join("");
  const colors = PALETTES[state.palette].map(x => x[1]).join(","); $("legend-gradient").style.background = `linear-gradient(90deg,${colors})`;
  const dates = state.h3Data.features.map(f => f.properties.updated_at).filter(Boolean); $("legend-updated").textContent = `Cập nhật: ${dates.length ? formatTime(Math.max(...dates)) : "--"}`;
}
function updateStatistics() {
  const key = state.property; const values = state.h3Data.features.map(f => f.properties[key]).filter(Number.isFinite); const unit = key === "humidity" ? "%" : "°C"; const title = key === "humidity" ? "Độ ẩm" : "Nhiệt độ";
  $("min-label").textContent = `${title} thấp nhất`; $("max-label").textContent = `${title} cao nhất`; $("avg-label").textContent = `${title} trung bình`;
  $("stat-min").textContent = values.length ? `${fmt(Math.min(...values))} ${unit}` : "--"; $("stat-max").textContent = values.length ? `${fmt(Math.max(...values))} ${unit}` : "--"; $("stat-avg").textContent = values.length ? `${fmt(values.reduce((a, b) => a + b, 0) / values.length)} ${unit}` : "--";
}

function filteredFeatures() { const q = state.query.trim().toLowerCase(); return q ? state.h3Data.features.filter(f => f.properties.h3.toLowerCase().includes(q)) : state.h3Data.features; }
function renderTable() {
  const all = filteredFeatures(); const pages = Math.max(1, Math.ceil(all.length / state.pageSize)); state.page = Math.min(state.page, pages); const start = (state.page - 1) * state.pageSize; const rows = all.slice(start, start + state.pageSize);
  $("data-body").innerHTML = rows.length ? rows.map((f, i) => { const p = f.properties; return `<tr><td>${start + i + 1}</td><td><b>${p.h3}</b></td><td>${fmt(p.center_lat, 5)}, ${fmt(p.center_lng, 5)}</td><td>${fmt(p.temperature)}</td><td>${fmt(p.humidity, 0)}</td><td>${formatTime(p.updated_at)}</td><td>•••</td></tr>` }).join("") : `<tr><td colspan="7" class="empty-row">Không tìm thấy dữ liệu.</td></tr>`;
  const end = Math.min(start + state.pageSize, all.length); $("table-summary").textContent = `Hiển thị ${rows.length} / ${all.length.toLocaleString("vi-VN")} bản ghi`; $("pagination-info").textContent = `${all.length ? start + 1 : 0}–${end} của ${all.length.toLocaleString("vi-VN")}`;
  $("prev-page").disabled = state.page <= 1; $("next-page").disabled = state.page >= pages;
  const nums = [1, state.page - 1, state.page, state.page + 1, pages].filter((v, i, a) => v > 0 && v <= pages && a.indexOf(v) === i).sort((a, b) => a - b); let last = 0; $("page-buttons").innerHTML = nums.map(n => { const gap = n - last > 1 ? "<em>…</em>" : ""; last = n; return `${gap}<button class="${n === state.page ? "active" : ""}" data-page="${n}">${n}</button>` }).join("");
}

function fitBoundary() {
  const coords = [];
  const walk = (x) => {
    if (!Array.isArray(x)) return;

    if (x.length >= 2 && typeof x[0] === "number" && typeof x[1] === "number") {
      coords.push(x);
      return x;
    }
    x.forEach(walk);
  };

  walk(state.boundary);

  if (!coords.length) return;

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibrgel.LngLatBounds(coords[0], coords[0])
  );

  map.fitBounds(bounds, { 
    padding: {
      top: 55,
      bottom: 33,
      left: 40,
      right: 250
    },
    duration: 700
  });
}

async function readSpatialFile(file) {
  if (file.name.toLowerCase().endsWith(".zip")) throw new Error("ZIP/Shapefile sẽ được hỗ trợ ở phiên bản tiếp theo.");
  const text = await file.text(); return file.name.toLowerCase().endsWith(".csv") ? csvPointsToGeoJSON(text) : JSON.parse(text);
}
async function replaceBoundary(data, name) {
  if (!data) throw new Error("Không tìm thấy dữ liệu."); geoJSONToCells(data, Math.min(state.resolution, 3)); state.boundary = data;
  map.getSource("vietnam-boundary")?.setData(data); $("file-name").textContent = name; $("file-note").textContent = "Dữ liệu đã tải · đang sử dụng"; state.baselineCount = null; await rebuildGrid({ fit: true });
}

function bindUI() {
  $("resolution").addEventListener("input", e => $("resolution-value").value = e.target.value); $("resolution").addEventListener("change", async e => { state.resolution = Number(e.target.value); await rebuildGrid(); });
  $("opacity").addEventListener("input", e => { $("opacity-value").value = `${Math.round(e.target.value * 100)}%`; applyStyle(); }); $("line-width").addEventListener("input", e => { $("line-width-value").value = `${e.target.value} px`; applyStyle(); });
  for (const id of ["fixed-color", "border-color"]) { $(id).addEventListener("input", e => { $(`${id}-value`).textContent = e.target.value.toUpperCase(); applyStyle(); }); }
  $("show-border").addEventListener("change", applyStyle); $("display-mode").addEventListener("change", e => { state.displayMode = e.target.value; applyStyle(); });
  $("data-property").addEventListener("change", e => { state.property = e.target.value; applyStyle(); updateDashboard(); });
  document.querySelectorAll(".palette").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".palette").forEach(x => x.classList.remove("active")); el.classList.add("active"); state.palette = el.dataset.palette; applyStyle(); updateLegend(); }));
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab,.tab-panel").forEach(x => x.classList.remove("active")); tab.classList.add("active"); document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active"); }));
  document.querySelectorAll(".map-type").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".map-type").forEach(x => x.classList.remove("active")); button.classList.add("active"); if (button.dataset.type !== "H3 Hexagon") showToast(`${button.dataset.type}: UI đã sẵn sàng, công cụ xử lý sẽ được bổ sung sau.`); }));
  $("spatial-file").addEventListener("change", async e => { const file = e.target.files[0]; if (!file) return; try { setStatus(`Đang đọc ${file.name}…`); await replaceBoundary(await readSpatialFile(file), file.name); } catch (error) { showToast(error.message); setStatus("Không thể đọc file.", true); } });
  $("apply-coordinates").addEventListener("click", async () => { try { const raw = $("coordinate-input").value.trim(); let data; if (raw.startsWith("{")) data = JSON.parse(raw); else { const ring = raw.split(/\n/).map(line => line.split(",").map(Number)); if (ring.length < 3 || ring.some(p => p.length < 2 || p.some(Number.isNaN))) throw new Error("Cần ít nhất 3 dòng lng,lat."); ring.push(ring[0]); data = { type: "Polygon", coordinates: [ring] }; } await replaceBoundary(data, "Tọa độ nhập trực tiếp"); } catch (error) { showToast(error.message); } });
  $("style-toggle").addEventListener("click", () => { const open = $("style-toggle").getAttribute("aria-expanded") === "true"; $("style-toggle").setAttribute("aria-expanded", String(!open)); $("style-controls").style.display = open ? "none" : "block"; });
  $("build-map").addEventListener("click", () => rebuildGrid());
  $("reset-map").addEventListener("click", async () => { const response = await fetch(CONFIG.DEFAULT_DATA_URL); state.boundary = await response.json(); state.resolution = CONFIG.DEFAULT_RESOLUTION; state.palette = "thermal"; state.displayMode = "data"; state.property = "temperature"; state.baselineCount = null; $("resolution").value = 5; $("resolution-value").value = 5; $("display-mode").value = "data"; $("data-property").value = "temperature"; $("opacity").value = .72; $("opacity-value").value = "72%"; $("file-name").textContent = "gadm41_VNM_0.json"; $("file-note").textContent = "Dữ liệu mặc định · đang sử dụng"; document.querySelectorAll(".palette").forEach(x => x.classList.toggle("active", x.dataset.palette === "thermal")); map.getSource("vietnam-boundary")?.setData(state.boundary); await rebuildGrid({ fit: true }); applyStyle(); });
  $("table-search").addEventListener("input", e => { state.query = e.target.value; state.page = 1; renderTable(); }); $("page-size").addEventListener("change", e => { state.pageSize = Number(e.target.value); state.page = 1; renderTable(); });
  $("prev-page").addEventListener("click", () => { state.page--; renderTable(); }); $("next-page").addEventListener("click", () => { state.page++; renderTable(); }); $("page-buttons").addEventListener("click", e => { if (e.target.dataset.page) { state.page = Number(e.target.dataset.page); renderTable(); } });
  $("zoom-in").addEventListener("click", () => map.zoomIn()); $("zoom-out").addEventListener("click", () => map.zoomOut()); $("fullscreen").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector(".map-panel").requestFullscreen());
  $("map-toolbar").addEventListener("click", e => { const button = e.target.closest("button"); if (!button) return; document.querySelectorAll("#map-toolbar button").forEach(x => x.classList.remove("active")); button.classList.add("active"); map.dragPan[button.dataset.tool === "select" ? "disable" : "enable"](); if (!["select", "pan"].includes(button.dataset.tool)) showToast(`Công cụ ${button.title}: giao diện đã sẵn sàng.`); });
  $("export-data").addEventListener("click", exportCSV);
}

function exportCSV() {
  const rows = [["H3 Index", "Latitude", "Longitude", "Temperature C", "Humidity %", "Updated at"], ...filteredFeatures().map(({ properties: p }) => [p.h3, p.center_lat, p.center_lng, p.temperature ?? "", p.humidity ?? "", p.updated_at ? new Date(p.updated_at).toISOString() : ""])];
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(x => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `geomap-h3-res-${state.resolution}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

async function init() {
  bindUI(); map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/dark", center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  map.once("style.load", async () => { try { const response = await fetch(CONFIG.DEFAULT_DATA_URL); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.boundary = await response.json(); addMapLayers(); await rebuildGrid({ fit: true }); } catch (error) { console.error(error); setStatus("Không tải được dữ liệu ranh giới Việt Nam."); } });
  map.on("error", event => console.warn("MapLibre:", event.error?.message || event.error));
}
init();

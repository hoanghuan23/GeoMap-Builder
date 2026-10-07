import { CONFIG, PALETTES } from "./config.js";
import { loadWeatherCache, saveWeatherCache } from "./cache.js";
import { geoJSONToCells, cellsToFeatureCollection, csvPointsToGeoJSON, recordsToPointGeoJSON } from "./h3-utils.js";
import { loadWeather } from "./weather-service.js";
import { loadTraffic, loadTrafficCache, saveTrafficCache } from "./traffic-service.js";
import { analyzeSpatialData, analyzeCsvData, compatibleMapTypes, describeDataProfile } from "./data-capabilities.js";

const $ = id => document.getElementById(id);
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const state = {
  resolution: CONFIG.DEFAULT_RESOLUTION, boundary: null, sourceBoundary: null, h3Data: { type: "FeatureCollection", features: [] },
  weather: loadWeatherCache(CONFIG.CACHE_KEY, CONFIG.CACHE_TTL_MS),
  traffic: loadTrafficCache(CONFIG.TRAFFIC_CACHE_KEY, CONFIG.TRAFFIC_CACHE_TTL_MS), palette: "thermal", displayMode: "data",
  property: "temperature", page: 1, pageSize: 10, query: "", weatherController: null, trafficController: null, baselineCount: null,
  trafficApplied: false, weatherApplied: false, mapType: null, dataProfile: null,
  pointData: { type: "FeatureCollection", features: [] }
};
let map; let toastTimer; let renderTimer;

function showToast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }
function setStatus(message, hide = false) { const el = $("status"); el.textContent = message; el.style.display = "block"; if (hide) setTimeout(() => el.style.display = "none", 2200); }
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }
function formatTime(value) { return value ? new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--"; }

function fillExpression() {
  if (state.displayMode === "fixed") return $("fixed-color").value;
  const property = state.property;
  if (property === "traffic_density") return ["case", ["==", ["get", property], null], "#64748b", ["interpolate", ["linear"], ["get", property], 0, "#22c55e", 25, "#84cc16", 50, "#facc15", 75, "#f97316", 100, "#dc2626"]];
  const stops = PALETTES[state.palette];
  const mapped = property === "humidity" ? stops.map(([v, c], i) => [i * (100 / (stops.length - 1)), c]) : stops;
  return ["case", ["==", ["get", property], null], "#64748b", ["interpolate", ["linear"], ["get", property], ...mapped.flat()]];
}

function applyStyle() {
  if (!map?.getLayer("h3-fill")) return;
  map.setPaintProperty("h3-fill", "fill-color", fillExpression());
  map.setPaintProperty("h3-fill", "fill-opacity", Number($("opacity").value));
  map.setPaintProperty("h3-border", "line-color", $("border-color").value);
  map.setPaintProperty("h3-border", "line-width", Number($("line-width").value));
  applyMapLayerVisibility();
}

function applyMapLayerVisibility() {
  if (!map) return;
  const showLayers = $("show-map-layers")?.checked ?? false;
  const showH3 = showLayers && state.mapType === "h3";
  if (map.getLayer("h3-fill")) map.setLayoutProperty("h3-fill", "visibility", showH3 ? "visible" : "none");
  if (map.getLayer("h3-border")) map.setLayoutProperty("h3-border", "visibility", showH3 && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("point-marker")) map.setLayoutProperty("point-marker", "visibility", showLayers && state.mapType === "point" ? "visible" : "none");
  if (map.getLayer("point-circle")) map.setLayoutProperty("point-circle", "visibility", showLayers && state.mapType === "circle" ? "visible" : "none");
  if (map.getLayer("point-heatmap")) map.setLayoutProperty("point-heatmap", "visibility", showLayers && state.mapType === "heatmap" ? "visible" : "none");
  if (map.getLayer("vietnam-border")) map.setLayoutProperty("vietnam-border", "visibility", "visible");
  if (map.getLayer("tomtom-traffic-layer")) map.setLayoutProperty("tomtom-traffic-layer", "visibility", state.trafficApplied ? "visible" : "none");
  if (map.getLayer("tomtom-traffic-mask")) map.setLayoutProperty("tomtom-traffic-mask", "visibility", state.trafficApplied ? "visible" : "none");
}

function coordinatesFromBoundary() {
  const coordinates = [];
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) coordinates.push(value);
    else value.forEach(walk);
  };
  const collect = geometry => geometry?.type === "GeometryCollection" ? geometry.geometries?.forEach(collect) : walk(geometry?.coordinates);
  if (state.boundary?.type === "FeatureCollection") state.boundary.features?.forEach(feature => collect(feature.geometry));
  else if (state.boundary?.type === "Feature") collect(state.boundary.geometry);
  else collect(state.boundary);
  return coordinates;
}

function trafficTileBounds() {
  const coordinates = coordinatesFromBoundary();
  if (!coordinates.length) return undefined;
  return coordinates.reduce((bounds, [lng, lat]) => [Math.min(bounds[0], lng), Math.min(bounds[1], lat), Math.max(bounds[2], lng), Math.max(bounds[3], lat)], [180, 90, -180, -90]);
}

function trafficMaskData() {
  const holes = [];
  const collect = geometry => {
    if (!geometry) return;
    if (geometry.type === "Polygon" && geometry.coordinates?.[0]) holes.push([...geometry.coordinates[0]].reverse());
    else if (geometry.type === "MultiPolygon") geometry.coordinates?.forEach(polygon => polygon?.[0] && holes.push([...polygon[0]].reverse()));
    else if (geometry.type === "GeometryCollection") geometry.geometries?.forEach(collect);
  };
  if (state.boundary?.type === "FeatureCollection") state.boundary.features?.forEach(feature => collect(feature.geometry));
  else if (state.boundary?.type === "Feature") collect(state.boundary.geometry);
  else collect(state.boundary);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes] } };
}

function createTrafficLayer() {
  if (!CONFIG.TOMTOM_API_KEY) throw new Error("Thiếu VITE_TOMTOM_API_KEY trong file .env.");
  if (map.getLayer("tomtom-traffic-mask")) map.removeLayer("tomtom-traffic-mask");
  if (map.getSource("tomtom-traffic-mask")) map.removeSource("tomtom-traffic-mask");
  if (map.getLayer("tomtom-traffic-layer")) map.removeLayer("tomtom-traffic-layer");
  if (map.getSource("tomtom-traffic")) map.removeSource("tomtom-traffic");
  const source = { type: "raster", tiles: [`https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${encodeURIComponent(CONFIG.TOMTOM_API_KEY)}`], tileSize: 256 };
  const bounds = trafficTileBounds(); if (bounds) source.bounds = bounds;
  map.addSource("tomtom-traffic", source);
  map.addLayer({ id: "tomtom-traffic-layer", type: "raster", source: "tomtom-traffic", paint: { "raster-opacity": .9 } }, "h3-fill");
  map.addSource("tomtom-traffic-mask", { type: "geojson", data: trafficMaskData() });
  map.addLayer({ id: "tomtom-traffic-mask", type: "fill", source: "tomtom-traffic-mask", paint: { "fill-color": "#090d12", "fill-opacity": .96 } }, "h3-fill");
}

function invalidateTrafficApplication() {
  state.trafficApplied = false;
  state.trafficController?.abort();
  applyMapLayerVisibility();
}

function addMapLayers() {
  map.addSource("h3-grid", { type: "geojson", data: state.h3Data });
  map.addLayer({ id: "h3-fill", type: "fill", source: "h3-grid", paint: { "fill-color": fillExpression(), "fill-opacity": .72 } });
  map.addLayer({ id: "h3-border", type: "line", source: "h3-grid", paint: { "line-color": "#ffffff", "line-width": .5, "line-opacity": .75 } });
  map.addSource("point-data", { type: "geojson", data: state.pointData });
  map.addLayer({ id: "point-heatmap", type: "heatmap", source: "point-data", maxzoom: 16, paint: {
    "heatmap-weight": 1, "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, .7, 12, 2.5],
    "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(33,102,172,0)", .2, "#2c7bb6", .4, "#00a6ca", .6, "#fdae61", .8, "#f46d43", 1, "#d73027"],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 12, 28], "heatmap-opacity": .82
  } });
  map.addLayer({ id: "point-circle", type: "circle", source: "point-data", paint: { "circle-radius": 7, "circle-color": "#7c5cff", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.25, "circle-opacity": .86 } });
  map.addLayer({ id: "point-marker", type: "circle", source: "point-data", paint: { "circle-radius": 4, "circle-color": "#00d084", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-opacity": .95 } });
  map.addSource("vietnam-boundary", { type: "geojson", data: state.boundary || EMPTY_FEATURE_COLLECTION });
  map.addLayer({ id: "vietnam-border", type: "line", source: "vietnam-boundary", paint: { "line-color": "#00e65c", "line-width": 2 } });
  applyMapLayerVisibility();
  map.on("click", "h3-fill", event => {
    const p = event.features?.[0]?.properties; if (!p) return;
    const traffic = p.traffic_density == null ? "Không có dữ liệu" : `${fmt(Number(p.traffic_density))}% (${p.traffic_status})`;
    new maplibregl.Popup({ offset: 8 }).setLngLat(event.lngLat).setHTML(`<div style="font:12px Inter;line-height:1.8"><b>H3:</b> ${p.h3}<br><b>Mật độ giao thông:</b> ${traffic}<br><b>Tốc độ hiện tại:</b> ${p.current_speed == null ? "--" : fmt(Number(p.current_speed), 0) + " km/h"}<br><b>Tốc độ thông thoáng:</b> ${p.free_flow_speed == null ? "--" : fmt(Number(p.free_flow_speed), 0) + " km/h"}<br><b>Nhiệt độ:</b> ${p.temperature == null ? "Không có dữ liệu" : fmt(Number(p.temperature)) + " °C"}<br><b>Độ ẩm:</b> ${p.humidity == null ? "Không có dữ liệu" : fmt(Number(p.humidity), 0) + "%"}<br><b>Tâm ô:</b> ${fmt(Number(p.center_lat), 5)}, ${fmt(Number(p.center_lng), 5)}</div>`).addTo(map);
  });
  map.on("mouseenter", "h3-fill", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "h3-fill", () => map.getCanvas().style.cursor = "");
  map.on("click", "point-circle", event => {
    const feature = event.features?.[0]; if (!feature) return;
    const rows = Object.entries(feature.properties || {}).map(([key, value]) => `<b>${key}:</b> ${String(value)}`).join("<br>");
    new maplibregl.Popup({ offset: 9 }).setLngLat(feature.geometry.coordinates).setHTML(`<div style="font:12px Inter;line-height:1.8">${rows || "Điểm dữ liệu"}</div>`).addTo(map);
  });
  map.on("mouseenter", "point-circle", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "point-circle", () => map.getCanvas().style.cursor = "");
  map.on("click", "point-marker", event => {
    const feature = event.features?.[0]; if (!feature) return;
    const rows = Object.entries(feature.properties || {}).map(([key, value]) => `<b>${key}:</b> ${String(value)}`).join("<br>");
    new maplibregl.Popup({ offset: 7 }).setLngLat(feature.geometry.coordinates).setHTML(`<div style="font:12px Inter;line-height:1.8">${rows || "Điểm dữ liệu"}</div>`).addTo(map);
  });
  map.on("mouseenter", "point-marker", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "point-marker", () => map.getCanvas().style.cursor = "");
}

function pointFeatureCollection(data) {
  const features = [];
  const collect = feature => {
    const geometry = feature?.geometry;
    if (geometry?.type === "Point") features.push(feature);
    else if (geometry?.type === "MultiPoint") geometry.coordinates?.forEach(coordinates => features.push({ type: "Feature", properties: { ...(feature.properties || {}) }, geometry: { type: "Point", coordinates } }));
  };
  if (data?.type === "FeatureCollection") data.features?.forEach(collect);
  else if (data?.type === "Feature") collect(data);
  return { type: "FeatureCollection", features };
}

function applyPointStyle() {
  if (!map?.getLayer("point-circle")) return;
  const field = state.dataProfile?.numericFields?.[0];
  const values = field ? state.pointData.features.map(feature => Number(feature.properties?.[field])).filter(Number.isFinite) : [];
  const min = values.length ? Math.min(...values) : 0; const max = values.length ? Math.max(...values) : 0;
  if (field && max > min) {
    map.setPaintProperty("point-circle", "circle-radius", ["interpolate", ["linear"], ["to-number", ["get", field], min], min, 5, max, 16]);
    map.setPaintProperty("point-heatmap", "heatmap-weight", ["interpolate", ["linear"], ["to-number", ["get", field], min], min, .15, max, 1]);
  } else {
    map.setPaintProperty("point-circle", "circle-radius", 7); map.setPaintProperty("point-heatmap", "heatmap-weight", 1);
  }
}

function estimateCellCount(resolution) {
  if (!state.baselineCount) return 0;
  return Math.round(state.baselineCount * Math.pow(7, resolution - CONFIG.DEFAULT_RESOLUTION));
}

async function rebuildGrid({ fit = false, fetchWeather = false, fetchTraffic = false, preserveTraffic = false } = {}) {
  if (!state.boundary) { setStatus("Hãy upload dữ liệu không gian trước."); return; }
  if (!preserveTraffic) invalidateTrafficApplication();
  state.weatherController?.abort(); state.trafficController?.abort();
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
    const visibleWeather = fetchWeather || state.weatherApplied ? state.weather : new Map();
    state.h3Data = cellsToFeatureCollection(cells, CONFIG.WEATHER_RESOLUTION, visibleWeather, state.traffic);
    const source = map.getSource("h3-grid"); if (source) source.setData(state.h3Data);
    $("cell-count").textContent = cells.length.toLocaleString("vi-VN"); $("cell-label").textContent = `Tổng số cell (res ${state.resolution})`;
    state.page = 1; updateDashboard();
    if (fit) fitBoundary();
    if (fetchWeather) {
      const weatherCells = [...new Set(state.h3Data.features.map(f => f.properties.weather_h3))];
      startWeatherLoad(weatherCells);
    }
    if (fetchTraffic) startTrafficLoad();
    if (!fetchWeather && !fetchTraffic) {
      setStatus(`Đã vẽ ${cells.length.toLocaleString("vi-VN")} ô H3.`, true);
    }
  } catch (error) { console.error(error); setStatus("Không thể tạo lưới H3."); showToast(error.message || "Dữ liệu không hợp lệ."); }
}

function startWeatherLoad(weatherCells) {
  const controller = new AbortController(); state.weatherController = controller;
  const featuresByParent = new Map();
  for (const feature of state.h3Data.features) { const key = feature.properties.weather_h3; const list = featuresByParent.get(key) || []; list.push(feature); featuresByParent.set(key, list); }
  loadWeather({
    cells: weatherCells, records: state.weather, apiKey: CONFIG.API_KEY, intervalMs: CONFIG.REQUEST_INTERVAL_MS, signal: controller.signal,
    onProgress: (loaded, total) => setStatus(`Đang tải thời tiết: ${loaded}/${total} vùng…`),
    onRecord: (cell, record) => { if (controller.signal.aborted) return; for (const feature of featuresByParent.get(cell) || []) Object.assign(feature.properties, { temperature: record.temperature, humidity: record.humidity, updated_at: record.updatedAt }); saveWeatherCache(CONFIG.CACHE_KEY, state.weather); scheduleRender(); }
  }).then(() => { if (!controller.signal.aborted) { scheduleRender(); setStatus(`Đã cập nhật dữ liệu cho ${state.h3Data.features.length.toLocaleString("vi-VN")} ô H3.`, true); } }).catch(error => { if (error.name !== "AbortError") { console.error(error); setStatus(error.message); showToast(error.message); } });
}

function startTrafficLoad() {
  if (state.h3Data.features.length > CONFIG.MAX_TRAFFIC_CELLS) {
    const message = `Vùng hiện tại có ${state.h3Data.features.length.toLocaleString("vi-VN")} ô. Hãy chọn một tỉnh/thành hoặc giảm resolution xuống tối đa ${CONFIG.MAX_TRAFFIC_CELLS} ô để lấy dữ liệu giao thông.`;
    setStatus(message); showToast(message); return;
  }
  const controller = new AbortController(); state.trafficController = controller;
  const featuresByCell = new Map(state.h3Data.features.map(feature => [feature.properties.h3, feature]));
  loadTraffic({
    features: state.h3Data.features, records: state.traffic, apiKey: CONFIG.TOMTOM_API_KEY,
    intervalMs: CONFIG.TRAFFIC_REQUEST_INTERVAL_MS, signal: controller.signal,
    onProgress: (loaded, total) => setStatus(`Đang tải giao thông: ${loaded}/${total} ô…`),
    onRecord: (cell, record) => {
      if (controller.signal.aborted) return;
      const feature = featuresByCell.get(cell); if (!feature) return;
      Object.assign(feature.properties, { traffic_density: record.density, current_speed: record.currentSpeed, free_flow_speed: record.freeFlowSpeed, speed_ratio: record.speedRatio, traffic_status: record.status, traffic_confidence: record.confidence, traffic_updated_at: record.updatedAt });
      saveTrafficCache(CONFIG.TRAFFIC_CACHE_KEY, state.traffic); scheduleRender();
    }
  }).then(() => { if (!controller.signal.aborted) { scheduleRender(); setStatus("Đã cập nhật dữ liệu giao thông TomTom.", true); } }).catch(error => { if (error.name !== "AbortError") { console.error(error); setStatus(error.message); showToast(error.message); } });
}

function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => { map.getSource("h3-grid")?.setData(state.h3Data); updateDashboard(); }, 120); }
function updateDashboard() { updateLegend(); updateStatistics(); renderTable(); }
function updateLegend() {
  const traffic = state.property === "traffic_density"; const humidity = state.property === "humidity";
  $("legend-card").hidden = traffic ? !state.trafficApplied : !state.weatherApplied;
  $("legend-title").textContent = traffic ? "Mật độ giao thông (%)" : humidity ? "Độ ẩm (%)" : "Nhiệt độ (°C)";
  $("legend-labels").innerHTML = (traffic || humidity ? ["0", "25", "50", "75", "100"] : ["≤10", "20", "25", "30", "≥40"]).map(x => `<span>${x}</span>`).join("");
  const colors = traffic ? ["#22c55e", "#84cc16", "#facc15", "#f97316", "#dc2626"] : PALETTES[state.palette].map(x => x[1]); $("legend-gradient").style.background = `linear-gradient(90deg,${colors.join(",")})`;
  $("legend-source").textContent = traffic ? "TomTom Traffic" : "OpenWeather";
  const dateKey = traffic ? "traffic_updated_at" : "updated_at"; const dates = state.h3Data.features.map(f => f.properties[dateKey]).filter(Boolean); $("legend-updated").textContent = `Cập nhật: ${dates.length ? formatTime(Math.max(...dates)) : "--"}`;
}
function updateStatistics() {
  const key = state.property; const values = state.h3Data.features.map(f => f.properties[key]).filter(Number.isFinite); const unit = key === "humidity" || key === "traffic_density" ? "%" : "°C"; const title = key === "traffic_density" ? "Mật độ" : key === "humidity" ? "Độ ẩm" : "Nhiệt độ";
  $("min-label").textContent = `${title} thấp nhất`; $("max-label").textContent = `${title} cao nhất`; $("avg-label").textContent = `${title} trung bình`;
  $("stat-min").textContent = values.length ? `${fmt(Math.min(...values))} ${unit}` : "--"; $("stat-max").textContent = values.length ? `${fmt(Math.max(...values))} ${unit}` : "--"; $("stat-avg").textContent = values.length ? `${fmt(values.reduce((a, b) => a + b, 0) / values.length)} ${unit}` : "--";
}

function filteredFeatures() { const q = state.query.trim().toLowerCase(); return q ? state.h3Data.features.filter(f => f.properties.h3.toLowerCase().includes(q)) : state.h3Data.features; }
function renderTable() {
  const all = filteredFeatures(); const pages = Math.max(1, Math.ceil(all.length / state.pageSize)); state.page = Math.min(state.page, pages); const start = (state.page - 1) * state.pageSize; const rows = all.slice(start, start + state.pageSize);
  const traffic = state.property === "traffic_density";
  $("table-title").textContent = traffic ? "Dữ liệu mật độ giao thông" : "Dữ liệu thuộc tính";
  $("data-head").classList.toggle("traffic-head", traffic);
  $("data-head").innerHTML = traffic
    ? "<tr><th>#</th><th>H3 INDEX</th><th>TÂM Ô (LAT, LNG)</th><th>MẬT ĐỘ (%)</th><th>TỐC ĐỘ / TỰ DO (KM/H)</th><th>TRẠNG THÁI</th><th>CẬP NHẬT</th></tr>"
    : "<tr><th>#</th><th>H3 INDEX</th><th>TÂM Ô (LAT, LNG)</th><th>NHIỆT ĐỘ (°C)</th><th>ĐỘ ẨM (%)</th><th>THỜI GIAN CẬP NHẬT</th><th></th></tr>";
  $("data-body").innerHTML = rows.length ? rows.map((f, i) => { const p = f.properties; return traffic
    ? `<tr><td>${start + i + 1}</td><td><b>${p.h3}</b></td><td>${fmt(p.center_lat, 5)}, ${fmt(p.center_lng, 5)}</td><td>${p.traffic_density == null ? "--" : fmt(p.traffic_density) + "%"}</td><td>${fmt(p.current_speed, 0)} / ${fmt(p.free_flow_speed, 0)}</td><td>${p.traffic_status || "--"}</td><td>${formatTime(p.traffic_updated_at)}</td></tr>`
    : `<tr><td>${start + i + 1}</td><td><b>${p.h3}</b></td><td>${fmt(p.center_lat, 5)}, ${fmt(p.center_lng, 5)}</td><td>${fmt(p.temperature)}</td><td>${fmt(p.humidity, 0)}</td><td>${formatTime(p.updated_at)}</td><td>•••</td></tr>`; }).join("") : `<tr><td colspan="7" class="empty-row">Không tìm thấy dữ liệu.</td></tr>`;
  const end = Math.min(start + state.pageSize, all.length); $("table-summary").textContent = `Hiển thị ${rows.length} / ${all.length.toLocaleString("vi-VN")} bản ghi`; $("pagination-info").textContent = `${all.length ? start + 1 : 0}–${end} của ${all.length.toLocaleString("vi-VN")}`;
  $("prev-page").disabled = state.page <= 1; $("next-page").disabled = state.page >= pages;
  const nums = [1, state.page - 1, state.page, state.page + 1, pages].filter((v, i, a) => v > 0 && v <= pages && a.indexOf(v) === i).sort((a, b) => a - b); let last = 0; $("page-buttons").innerHTML = nums.map(n => { const gap = n - last > 1 ? "<em>…</em>" : ""; last = n; return `${gap}<button class="${n === state.page ? "active" : ""}" data-page="${n}">${n}</button>` }).join("");
}

function provinceNames(data) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) return [];
  return [...new Set(data.features.map(feature => feature?.properties?.NAME_1).filter(name => typeof name === "string" && name.trim()))]
    .sort((a, b) => a.localeCompare(b, "vi"));
}

function formatProvinceName(name) {
  return name.replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2");
}

function setupProvinceFilter(data) {
  const names = provinceNames(data); const field = $("province-filter-field"); const options = $("province-filter-options");
  options.replaceChildren(...names.map(name => {
    const label = document.createElement("label"); const input = document.createElement("input"); const text = document.createElement("span");
    input.type = "checkbox"; input.value = name; text.textContent = formatProvinceName(name); label.append(input, text); return label;
  }));
  $("province-filter-label").textContent = "Tất cả tỉnh/thành"; $("province-filter-menu").hidden = true; $("province-filter-toggle").setAttribute("aria-expanded", "false"); field.hidden = names.length === 0;
}

function selectedProvinceNames() {
  return [...document.querySelectorAll('#province-filter-options input:checked')].map(input => input.value);
}

function updateProvinceFilterLabel(names = selectedProvinceNames()) {
  $("province-filter-label").textContent = names.length === 0 ? "Tất cả tỉnh/thành" : names.length === 1 ? formatProvinceName(names[0]) : `${names.length} tỉnh/thành đã chọn`;
}

function boundaryForProvinces(data, names) {
  if (!names.length || data?.type !== "FeatureCollection") return data;
  const selected = new Set(names); return { ...data, features: data.features.filter(feature => selected.has(feature?.properties?.NAME_1)) };
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

  const collectGeometry = geometry => {
    if (!geometry) return;
    if (geometry.type === "GeometryCollection") geometry.geometries?.forEach(collectGeometry);
    else walk(geometry.coordinates);
  };
  if (state.boundary?.type === "FeatureCollection") state.boundary.features?.forEach(feature => collectGeometry(feature.geometry));
  else if (state.boundary?.type === "Feature") collectGeometry(state.boundary.geometry);
  else collectGeometry(state.boundary);

  if (!coords.length) return;

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0])
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

function renderCompatibleMapTypes(data, profile = analyzeSpatialData(data)) {
  const types = compatibleMapTypes(profile); const grid = $("map-type-grid"); state.dataProfile = profile;
  if (!types.some(type => type.id === state.mapType)) state.mapType = types[0]?.id || null;
  grid.replaceChildren(...types.map(type => {
    const button = document.createElement("button"); const icon = document.createElement("span");
    button.type = "button"; button.className = `map-type${type.id === state.mapType ? " active" : ""}`; button.dataset.type = type.id; button.dataset.label = type.label;
    button.title = `${type.label} · ${type.renderer}`; icon.textContent = type.icon; button.append(icon, type.label); return button;
  }));
  grid.classList.toggle("is-empty", types.length === 0);
  if (!types.length) grid.textContent = "Dữ liệu này chưa phù hợp với renderer hiện có.";
  $("map-type-summary").textContent = types.length
    ? `Phát hiện ${describeDataProfile(profile)} · ${types.length} kiểu bản đồ phù hợp`
    : `Phát hiện ${describeDataProfile(profile)} · chưa có kiểu bản đồ phù hợp`;
}

function clearUploadedData() {
  state.boundary = null; state.sourceBoundary = null; state.h3Data = { type: "FeatureCollection", features: [] };
  state.pointData = { type: "FeatureCollection", features: [] };
  state.mapType = null; state.dataProfile = null; state.baselineCount = null; state.page = 1;
  $("map-type-grid").className = "map-type-grid is-empty"; $("map-type-grid").textContent = "Chưa có dữ liệu để phân tích.";
  $("map-type-summary").textContent = "Danh sách sẽ tự cập nhật sau khi dữ liệu được đọc.";
  $("selected-file").hidden = true; $("spatial-file").value = ""; setupProvinceFilter(EMPTY_FEATURE_COLLECTION);
  map?.getSource("h3-grid")?.setData(state.h3Data); map?.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("point-data")?.setData(state.pointData);
}

async function readSpatialFile(file) {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "zip") throw new Error("ZIP/Shapefile sẽ được hỗ trợ ở phiên bản tiếp theo.");
  if (["xlsx", "xls"].includes(extension)) {
    if (!globalThis.XLSX) throw new Error("Không tải được thư viện đọc Excel. Vui lòng kiểm tra kết nối mạng.");
    const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = globalThis.XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: true });
    const data = recordsToPointGeoJSON(records);
    return { data, profile: analyzeSpatialData(data) };
  }
  const text = await file.text();
  if (extension === "csv") return { data: csvPointsToGeoJSON(text), profile: analyzeCsvData(text) };
  const parsed = JSON.parse(text);
  const data = Array.isArray(parsed) ? recordsToPointGeoJSON(parsed) : Array.isArray(parsed?.data) ? recordsToPointGeoJSON(parsed.data) : parsed;
  return { data, profile: analyzeSpatialData(data) };
}
async function replaceBoundary(data, name, profile = null) {
  if (!data) throw new Error("Không tìm thấy dữ liệu."); geoJSONToCells(data, Math.min(state.resolution, 3)); state.sourceBoundary = data; state.boundary = data; setupProvinceFilter(data);
  renderCompatibleMapTypes(data, profile || analyzeSpatialData(data));
  state.pointData = pointFeatureCollection(data); map.getSource("point-data")?.setData(state.pointData); applyPointStyle();
  map.getSource("vietnam-boundary")?.setData(data); $("file-name").textContent = name; $("file-note").textContent = "Dữ liệu đã tải · đang sử dụng"; $("selected-file").hidden = false; state.baselineCount = null; await rebuildGrid({ fit: true }); applyMapLayerVisibility();
}

function bindUI() {
  $("resolution").addEventListener("input", e => $("resolution-value").value = e.target.value); $("resolution").addEventListener("change", async e => { state.resolution = Number(e.target.value); await rebuildGrid(); });
  $("opacity").addEventListener("input", e => { $("opacity-value").value = `${Math.round(e.target.value * 100)}%`; applyStyle(); }); $("line-width").addEventListener("input", e => { $("line-width-value").value = `${e.target.value} px`; applyStyle(); });
  for (const id of ["fixed-color", "border-color"]) { $(id).addEventListener("input", e => { $(`${id}-value`).textContent = e.target.value.toUpperCase(); applyStyle(); }); }
  $("show-border").addEventListener("change", applyStyle); $("display-mode").addEventListener("change", e => { state.displayMode = e.target.value; applyStyle(); });
  $("data-property").addEventListener("change", e => { state.property = e.target.value; applyStyle(); updateDashboard(); });
  document.querySelectorAll(".palette").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".palette").forEach(x => x.classList.remove("active")); el.classList.add("active"); state.palette = el.dataset.palette; applyStyle(); updateLegend(); }));
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab,.tab-panel").forEach(x => x.classList.remove("active")); tab.classList.add("active"); document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active"); }));
  $("map-type-grid").addEventListener("click", event => { const button = event.target.closest(".map-type"); if (!button) return; document.querySelectorAll(".map-type").forEach(x => x.classList.remove("active")); button.classList.add("active"); state.mapType = button.dataset.type; applyMapLayerVisibility(); setStatus(`Đang hiển thị kiểu ${button.dataset.label}.`, true); });
  $("spatial-file").addEventListener("change", async e => { const file = e.target.files[0]; if (!file) return; try { setStatus(`Đang đọc ${file.name}…`); const result = await readSpatialFile(file); await replaceBoundary(result.data, file.name, result.profile); } catch (error) { showToast(error.message); setStatus("Không thể đọc file.", true); } });
  $("province-filter-toggle").addEventListener("click", () => {
    const menu = $("province-filter-menu"); const open = menu.hidden; menu.hidden = !open; $("province-filter-toggle").setAttribute("aria-expanded", String(open));
  });
  $("province-filter-options").addEventListener("change", () => updateProvinceFilterLabel());
  $("clear-provinces").addEventListener("click", () => { document.querySelectorAll('#province-filter-options input:checked').forEach(input => input.checked = false); updateProvinceFilterLabel([]); });
  $("apply-provinces").addEventListener("click", async () => {
    const names = selectedProvinceNames(); const toggle = $("province-filter-toggle"); state.boundary = boundaryForProvinces(state.sourceBoundary, names); state.baselineCount = null;
    map.getSource("vietnam-boundary")?.setData(state.boundary); $("file-note").textContent = names.length ? `Đang lọc: ${names.map(formatProvinceName).join(", ")}` : "Dữ liệu đã tải · đang sử dụng";
    $("province-filter-menu").hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.disabled = true;
    try { await rebuildGrid({ fit: true }); } finally { toggle.disabled = false; }
  });
  document.addEventListener("click", event => { if (!event.target.closest("#province-filter")) { $("province-filter-menu").hidden = true; $("province-filter-toggle").setAttribute("aria-expanded", "false"); } });
  $("apply-coordinates").addEventListener("click", async () => { try { const raw = $("coordinate-input").value.trim(); let data; if (raw.startsWith("{")) data = JSON.parse(raw); else { const ring = raw.split(/\n/).map(line => line.split(",").map(Number)); if (ring.length < 3 || ring.some(p => p.length < 2 || p.some(Number.isNaN))) throw new Error("Cần ít nhất 3 dòng lng,lat."); ring.push(ring[0]); data = { type: "Polygon", coordinates: [ring] }; } await replaceBoundary(data, "Tọa độ nhập trực tiếp"); } catch (error) { showToast(error.message); } });
  for (const [toggleId, controlsId] of [["feature-toggle", "feature-controls"], ["style-toggle", "style-controls"]]) {
    $(toggleId).addEventListener("click", () => { const open = $(toggleId).getAttribute("aria-expanded") === "true"; $(toggleId).setAttribute("aria-expanded", String(!open)); $(controlsId).style.display = open ? "none" : ""; });
  }
  $("show-map-layers").addEventListener("change", e => { $("show-map-layers-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt"; applyMapLayerVisibility(); });
  $("fetch-weather").addEventListener("change", e => {
    $("fetch-weather-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt";
    if (e.target.checked) setStatus('Đã chọn dữ liệu thời tiết. Nhấn "Tạo bản đồ" để tải và hiển thị.', true);
    else { state.weatherApplied = false; state.weatherController?.abort(); updateLegend(); }
  });
  $("fetch-traffic").addEventListener("change", e => {
    $("fetch-traffic-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt";
    invalidateTrafficApplication();
    if (e.target.checked) setStatus('Đã chọn dữ liệu giao thông. Nhấn "Tạo bản đồ" để tải và hiển thị.', true);
    else if (state.property === "traffic_density") { state.property = "temperature"; $("data-property").value = state.property; applyStyle(); updateDashboard(); }
  });
  $("build-map").addEventListener("click", async () => {
    const fetchWeather = $("fetch-weather").checked;
    const fetchTraffic = $("fetch-traffic").checked;
    try {
      if (!state.boundary) throw new Error("Vui lòng upload dữ liệu không gian trước khi tạo bản đồ.");
      if (fetchTraffic) {
        state.property = "traffic_density"; $("data-property").value = state.property;
        createTrafficLayer(); state.trafficApplied = true;
      } else {
        invalidateTrafficApplication();
      }
      state.weatherApplied = false; updateLegend();
      await rebuildGrid({ fetchWeather, fetchTraffic, preserveTraffic: true });
      state.weatherApplied = fetchWeather;
      applyStyle(); applyMapLayerVisibility(); updateDashboard();
    } catch (error) { console.error(error); invalidateTrafficApplication(); setStatus(error.message); showToast(error.message); }
  });
  $("reset-map").addEventListener("click", () => { state.resolution = CONFIG.DEFAULT_RESOLUTION; state.palette = "thermal"; state.displayMode = "data"; state.property = "temperature"; state.weatherApplied = false; invalidateTrafficApplication(); clearUploadedData(); $("resolution").value = 5; $("resolution-value").value = 5; $("display-mode").value = "data"; $("data-property").value = "temperature"; $("opacity").value = .72; $("opacity-value").value = "72%"; $("show-map-layers").checked = false; $("show-map-layers-status").textContent = "Đang tắt"; $("fetch-weather").checked = false; $("fetch-weather-status").textContent = "Đang tắt"; $("fetch-traffic").checked = false; $("fetch-traffic-status").textContent = "Đang tắt"; document.querySelectorAll(".palette").forEach(x => x.classList.toggle("active", x.dataset.palette === "thermal")); applyStyle(); updateDashboard(); setStatus("Đã làm lại. Hãy upload dữ liệu để bắt đầu.", true); });
  $("table-search").addEventListener("input", e => { state.query = e.target.value; state.page = 1; renderTable(); }); $("page-size").addEventListener("change", e => { state.pageSize = Number(e.target.value); state.page = 1; renderTable(); });
  $("prev-page").addEventListener("click", () => { state.page--; renderTable(); }); $("next-page").addEventListener("click", () => { state.page++; renderTable(); }); $("page-buttons").addEventListener("click", e => { if (e.target.dataset.page) { state.page = Number(e.target.dataset.page); renderTable(); } });
  $("zoom-in").addEventListener("click", () => map.zoomIn()); $("zoom-out").addEventListener("click", () => map.zoomOut()); $("fullscreen").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector(".map-panel").requestFullscreen());
  $("map-toolbar").addEventListener("click", e => { const button = e.target.closest("button"); if (!button) return; document.querySelectorAll("#map-toolbar button").forEach(x => x.classList.remove("active")); button.classList.add("active"); map.dragPan[button.dataset.tool === "select" ? "disable" : "enable"](); if (!["select", "pan"].includes(button.dataset.tool)) showToast(`Công cụ ${button.title}: giao diện đã sẵn sàng.`); });
  $("export-data").addEventListener("click", exportCSV);
}

function exportCSV() {
  const traffic = state.property === "traffic_density";
  const rows = traffic
    ? [["H3 Index", "Latitude", "Longitude", "Traffic density %", "Current speed km/h", "Free flow speed km/h", "Status", "Confidence", "Updated at"], ...filteredFeatures().map(({ properties: p }) => [p.h3, p.center_lat, p.center_lng, p.traffic_density ?? "", p.current_speed ?? "", p.free_flow_speed ?? "", p.traffic_status ?? "", p.traffic_confidence ?? "", p.traffic_updated_at ? new Date(p.traffic_updated_at).toISOString() : ""])]
    : [["H3 Index", "Latitude", "Longitude", "Temperature C", "Humidity %", "Updated at"], ...filteredFeatures().map(({ properties: p }) => [p.h3, p.center_lat, p.center_lng, p.temperature ?? "", p.humidity ?? "", p.updated_at ? new Date(p.updated_at).toISOString() : ""])];
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(x => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${traffic ? "tomtom-traffic" : "weather"}-h3-res-${state.resolution}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

async function init() {
  bindUI(); map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/dark", center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  map.once("style.load", () => { addMapLayers(); setupProvinceFilter(EMPTY_FEATURE_COLLECTION); updateDashboard(); setStatus("Hãy upload dữ liệu không gian để bắt đầu."); });
  map.on("error", event => console.warn("MapLibre:", event.error?.message || event.error));
}
init();

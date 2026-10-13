import { CONFIG } from "./config.js";
import { cellAtMaxResolution, geoJSONToCells, geoJSONToH3FeatureCollection, h3CellCenter, recordsToPointGeoJSON } from "./h3-utils.js";
import { analyzeSpatialData, compatibleMapTypes, describeDataProfile } from "./data-capabilities.js";
import { BarRenderer, analyzeBarData } from "./charts/bar-chart.js";
import { createLineOption, LINE_COLORS, lineSeriesFromFields, LineRenderer } from "./charts/line-chart.js";
import {
  clearPieStylePanel,
  createPieOptions,
  DEFAULT_PIE_CONFIG,
  mergePieConfig,
  PIE_COLORS,
  pieSeriesFromFields,
  PieRenderer,
  renderPieStylePanel
} from "./charts/pie-chart.js";
import { DEFAULT_BAR_CONFIG, mergeBarConfig } from "./charts/configs/bar-config.js";
import { clearBarStylePanel, renderBarStylePanel } from "./charts/components/bar-style-panel.jsx";
import { clearDataMappingPanel, renderDataMappingPanel } from "./charts/components/data-mapping-panel.jsx";
import { BAR_COLORS, dataForBarMapping, humanizeField, reconcileSeriesColors, seriesFromFields, validateBarMapping } from "./charts/data-transformers.js";
import { renderChartIcon } from "./charts/chart-icons.js";
import { renderMapIcon } from "./renderers/map-icons.js";
import { PolygonRenderer } from "./renderers/polygon-renderer.js";
import { polygonColorField, polygonFillExpression, polygonLegendScale } from "./renderers/polygon-style.js";
import { createMapSearch, landOnlyBoundary, loadMapTilerAdministrativeBoundaries } from "./map-search.js";
import { readMetroData, metroCellsAtTime, travelFillExpression, travelLegendColors } from "./metro-data.js";
import { fetchCurrentWeather, formatVisibility, readCachedWeather, WEATHER_CACHE_TTL_MS, windDirectionLabel, writeCachedWeather } from "./openweather.js";
import { TEMPERATURE_STOPS, temperatureFillExpression, temperatureLegendGradient } from "./renderers/weather-style.js";
import { clipGeoJSONToPolygon, featureCount, geometryKinds, isHexagonGeoJSON } from "./geojson-layers.js";
import { comparableFilterValue, displayFilterValue, requestAiMapRecommendation } from "./ai-data-analysis.js";
import { joinRecordsToMapTilerBoundaries } from "./vietnam-admin-data.js";
import { deterministicLayerOrder, mapLayerIdsInOrder, requestAiLayerOrder } from "./layer-order.js";

const $ = id => document.getElementById(id);
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const MAP_STYLES = Object.freeze({
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark"
});
const MAP_STYLE_LABELS = Object.freeze({ liberty: "Liberty", bright: "Sáng", dark: "Tối" });
const SUPPORTED_VIEW_TYPES = Object.freeze([
  { label: "Point", icon: "point", kind: "map" },
  { label: "Circle", icon: "circle", kind: "map" },
  { label: "H3 Hexagon", icon: "hexagon", kind: "map" },
  { label: "Heatmap", icon: "heatmap", kind: "map" },
  { label: "Line", icon: "line", kind: "map" },
  { label: "Polygon", icon: "polygon", kind: "map" },
  { label: "Cột đơn", icon: "singleBar", kind: "chart" },
  { label: "Cột đôi", icon: "doubleBar", kind: "chart" },
  { label: "Cột ghép", icon: "groupedBar", kind: "chart" },
  { label: "Biểu đồ đường", icon: "line", kind: "chart" },
  { label: "Pie chart", icon: "pieChart", kind: "chart" },
  { label: "Half pie", icon: "halfPie", kind: "chart" }
]);
const state = {
  resolution: CONFIG.DEFAULT_RESOLUTION, boundary: null, sourceBoundary: null, h3Data: { type: "FeatureCollection", features: [] },
  page: 1, pageSize: 10, query: "", baselineCount: null,
  mapType: null, dataProfile: null,
  pointData: { type: "FeatureCollection", features: [] },
  chartConfig: null, chartOptions: [], chartAnalysis: null, chartMapping: null, mappingWarning: "", activeChartKind: null,
  barStyle: { ...DEFAULT_BAR_CONFIG }, pieStyle: { ...DEFAULT_PIE_CONFIG }, polygonPalette: null,
  metroData: null, metroTime: null, metroPopup: null, lineData: EMPTY_FEATURE_COLLECTION,
  dataOrigin: null,
  uploadLayers: [], uploadedFiles: [], uploadedFileKeys: new Set(), uploadLayerSequence: 0,
  metroParts: {}, separateMetroActive: false,
  aiDataset: null,
  mapStyle: "dark"
};
let map; let toastTimer; let cellPopup; let layerOrderTimer;
let layerOrderRevision = 0;
let mapLayerEventsBound = false;
let mapReady = false;
let pendingMapStyle = null;
let mapStyleLoadTimer = null;
const weatherCache = new Map();
const MAX_WEATHER_SAMPLES = 50;
let weatherLoadRevision = 0;

function cellCenter(feature) {
  const p = feature.properties || {};
  if (Number.isFinite(p.center_lng) && Number.isFinite(p.center_lat)) return [p.center_lng, p.center_lat];
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  const vertices = polygons.flatMap(polygon => polygon[0].slice(0, -1));
  return vertices.reduce((center, point) => [center[0] + point[0] / vertices.length, center[1] + point[1] / vertices.length], [0, 0]);
}

function showCellFocus(feature, layerId) {
  const data = { type: "FeatureCollection", features: [feature] };
  if (!map.getSource("selected-cell")) {
    map.addSource("selected-cell", { type: "geojson", data });
    map.addLayer({ id: "cell-focus-dim", type: "background", paint: { "background-color": "#000000", "background-opacity": .55 } });
    map.addLayer({ id: "cell-focus-fill", type: "fill", source: "selected-cell", paint: { "fill-color": "#168c50", "fill-opacity": 1 } });
    map.addLayer({ id: "cell-focus-border", type: "line", source: "selected-cell", paint: { "line-color": "#ffffff", "line-width": 3 } });
  } else map.getSource("selected-cell").setData(data);
  map.setPaintProperty("cell-focus-fill", "fill-color", map.getPaintProperty(layerId, "fill-color"));
  for (const id of ["cell-focus-dim", "cell-focus-fill", "cell-focus-border"]) {
    map.moveLayer(id);
    map.setLayoutProperty(id, "visibility", "visible");
  }
}

function openCellPopup(popup, feature, layerId) {
  cellPopup?.remove();
  cellPopup = popup;
  const container = map.getContainer();
  popup.on("close", () => {
    if (cellPopup !== popup) return;
    cellPopup = null;
    container.classList.remove("cell-popup-open");
    for (const id of ["cell-focus-dim", "cell-focus-fill", "cell-focus-border"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    }
    map.getSource("selected-cell")?.setData(EMPTY_FEATURE_COLLECTION);
    if (state.metroPopup === popup) state.metroPopup = null;
  });
  showCellFocus(feature, layerId);
  popup.setLngLat(cellCenter(feature)).addTo(map);
  container.classList.add("cell-popup-open");
  return popup;
}

function chartRenderer(kind = state.chartConfig?.chartKind) {
  return kind === "line" ? LineRenderer : kind === "pie" ? PieRenderer : BarRenderer;
}

function renderChartCanvas() {
  if (!state.chartConfig) return;
  const nextKind = ["line", "pie"].includes(state.chartConfig.chartKind) ? state.chartConfig.chartKind : "bar";
  if (state.activeChartKind && state.activeChartKind !== nextKind) chartRenderer(state.activeChartKind).clear($("chart-canvas"));
  chartRenderer(nextKind).render($("chart-canvas"), state.chartConfig);
  state.activeChartKind = nextKind;
}

function clearChartCanvas() {
  if (state.activeChartKind) chartRenderer(state.activeChartKind).clear($("chart-canvas"));
  else $("chart-canvas")?.replaceChildren();
  state.activeChartKind = null;
}

function showToast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }
function setStatus(message, hide = false) { const el = $("status"); el.textContent = message; el.hidden = false; if (hide) setTimeout(() => { el.hidden = true; }, 2200); }
function setDataPanelVisible(visible) { $("data-panel").hidden = !visible; document.querySelector(".content-area").classList.toggle("table-hidden", !visible); map?.resize(); }
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }

function weatherPopupContent(feature, weather = null, message = "") {
  const card = document.createElement("div");
  card.className = "weather-popup";
  const title = document.createElement("strong");
  title.textContent = weather?.description ? weather.description.charAt(0).toUpperCase() + weather.description.slice(1) : "Thời tiết tại ô H3";
  const index = document.createElement("small");
  index.textContent = feature.properties?.h3 || "";
  card.append(title, index);
  if (message) {
    const status = document.createElement("p");
    status.className = "weather-popup-status";
    status.textContent = message;
    card.append(status);
    return card;
  }
  const grid = document.createElement("dl");
  const values = [
    ["Nhiệt độ", `${fmt(weather.temperature)} °C`],
    ["Độ ẩm", `${fmt(weather.humidity, 0)}%`],
    ["Tầm nhìn", formatVisibility(weather.visibility)],
    ["Gió", `${fmt(weather.windSpeed)} m/s${windDirectionLabel(weather.windDirection) ? ` · ${windDirectionLabel(weather.windDirection)}` : ""}`]
  ];
  for (const [label, value] of values) {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    group.append(term, description);
    grid.append(group);
  }
  card.append(grid);
  return card;
}

function weatherForCell(feature) {
  const h3 = feature.properties?.weather_h3 || cellAtMaxResolution(feature.properties?.h3, 5);
  const now = Date.now();
  const memoryEntry = weatherCache.get(h3);
  if (memoryEntry?.expiresAt > now) return memoryEntry.promise;
  weatherCache.delete(h3);
  const storedEntry = readCachedWeather(h3, { now });
  if (storedEntry) {
    const promise = Promise.resolve(storedEntry.data);
    weatherCache.set(h3, { promise, expiresAt: storedEntry.expiresAt });
    return promise;
  }
  const [longitude, latitude] = h3CellCenter(h3);
  const request = fetchCurrentWeather(latitude, longitude, { apiKey: CONFIG.OPENWEATHER_API_KEY })
    .then(weather => {
      writeCachedWeather(h3, weather, { now });
      return weather;
    })
    .catch(error => {
      weatherCache.delete(h3);
      throw error;
    });
  weatherCache.set(h3, { promise: request, expiresAt: now + WEATHER_CACHE_TTL_MS });
  return request;
}

function weatherGroups(features) {
  let resolution = Math.min(state.resolution, 5);
  let groups;
  do {
    groups = new Map();
    for (const feature of features) {
      const weatherH3 = cellAtMaxResolution(feature.properties.h3, resolution);
      feature.properties.weather_h3 = weatherH3;
      feature.properties.weather_resolution = resolution;
      if (!groups.has(weatherH3)) groups.set(weatherH3, []);
      groups.get(weatherH3).push(feature);
    }
    if (groups.size <= MAX_WEATHER_SAMPLES || resolution === 0) break;
    resolution -= 1;
  } while (true);
  return { groups, resolution };
}

function applyWeatherToFeatures(features, weather) {
  for (const feature of features) {
    Object.assign(feature.properties, {
      temperature: weather.temperature,
      humidity: weather.humidity,
      visibility: weather.visibility,
      wind_speed: weather.windSpeed,
      wind_direction: weather.windDirection,
      weather_description: weather.description
    });
  }
}

async function loadWeatherForGrid() {
  const revision = ++weatherLoadRevision;
  if (state.dataOrigin !== "search" || !$("show-weather").checked || !state.h3Data.features.length || !CONFIG.OPENWEATHER_API_KEY) {
    applyStyle();
    return;
  }
  const { groups, resolution } = weatherGroups(state.h3Data.features);
  state.weatherResolution = resolution;
  const queue = [...groups.values()];
  let completed = 0;
  let failed = 0;
  setStatus(`Đang tải thời tiết cho ${queue.length} vùng H3 đại diện…`);
  const worker = async () => {
    while (queue.length && revision === weatherLoadRevision) {
      const features = queue.shift();
      try {
        const weather = await weatherForCell(features[0]);
        if (revision !== weatherLoadRevision) return;
        applyWeatherToFeatures(features, weather);
      } catch (error) {
        failed += 1;
        console.warn("Không thể tải thời tiết cho vùng H3:", error);
      }
      completed += 1;
      if (completed % 5 === 0) map.getSource("h3-grid")?.setData(state.h3Data);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  if (revision !== weatherLoadRevision) return;
  map.getSource("h3-grid")?.setData(state.h3Data);
  applyStyle();
  const loaded = groups.size - failed;
  setStatus(`Đã tải thời tiết cho ${loaded}/${groups.size} vùng H3 đại diện.`, true);
}

function renderSupportedChartCatalog() {
  const grid = $("supported-chart-grid");
  grid.replaceChildren(...SUPPORTED_VIEW_TYPES.map(type => {
    const item = document.createElement("div");
    const icon = document.createElement("span");
    const label = document.createElement("span");
    item.className = "supported-chart-type";
    item.setAttribute("role", "listitem");
    if (type.kind === "map") renderMapIcon(icon, type.icon);
    else renderChartIcon(icon, type.icon);
    label.textContent = type.label;
    item.append(icon, label);
    return item;
  }));
}

function showSupportedChartCatalog(visible) {
  $("supported-chart-catalog").hidden = !visible;
}

function updateModelSections() {
  const hasModel = Boolean(state.mapType);
  const isChart = Boolean(state.chartConfig);
  $("metro-time-section").hidden = true;
  $("metro-layer-controls").hidden = !state.metroData || isChart;
  $("line-toggle-field").hidden = isChart || !state.lineData.features.length;
  $("travel-palette").hidden = !state.metroData;
  $("weather-toggle-field").hidden = state.dataOrigin !== "search" || isChart;
  $("chart-data-mapping-section").hidden = !isChart;
  $("resolution-section").hidden = !hasModel || isChart || state.mapType !== "h3";
  $("feature-section").hidden = !hasModel || isChart;
  $("style-section").hidden = !hasModel || (!isChart && !["h3", "polygon"].includes(state.mapType));
  $("cell-stats-card").hidden = !hasModel || isChart || state.mapType !== "h3";
  if (!isChart) {
    const isPolygon = state.mapType === "polygon";
    const isWeather = state.dataOrigin === "search" && state.mapType === "h3";
    const isAiThematic = Boolean(state.aiDataset) && ["h3", "polygon"].includes(state.mapType);
    $("style-description").textContent = isWeather ? "Bảng màu nhiệt độ, độ mờ và đường viền" : isPolygon ? "Màu cố định, dải màu, độ mờ và đường viền" : "Màu sắc, độ mờ và đường viền";
    $("polygon-color-ramp").hidden = !isPolygon && !isWeather && !isAiThematic;
    $("border-color-field").hidden = isPolygon && !state.metroData;
    $("show-border-field").hidden = false;
    $("line-width-field").hidden = false;
    if (isPolygon || isWeather || isAiThematic) syncPolygonPaletteControls();
  }
}

function fillExpression() {
  return $("fixed-color").value;
}

function syncPolygonPaletteControls() {
  const isWeather = state.dataOrigin === "search" && state.mapType === "h3";
  const thematicData = state.mapType === "h3" ? state.h3Data : state.boundary;
  const colorField = isWeather ? { field: "temperature" } : state.metroData ? { field: "ratio" } : polygonColorField(thematicData, state.dataProfile);
  $("polygon-color-field").textContent = isWeather ? "Theo nhiệt độ (°C)" : state.metroData ? "Xe buýt / xe máy" : colorField ? `Theo ${humanizeField(colorField.field)}` : "Cần thuộc tính dữ liệu";
  document.querySelectorAll("#polygon-color-ramp .palette").forEach(button => {
    button.disabled = !colorField || (isWeather && button.dataset.palette === "travel");
    button.classList.toggle("active", button.dataset.palette === state.polygonPalette);
  });
}

function renderWeatherLegend() {
  const legend = $("weather-legend");
  const isWeatherMap = state.dataOrigin === "search" && state.mapType === "h3";
  const isAiMap = Boolean(state.aiDataset) && ["h3", "polygon"].includes(state.mapType);
  const show = $("show-map-layers").checked && ((isWeatherMap && $("show-weather").checked) || isAiMap);
  legend.hidden = !show;
  if (!show) return;
  const palette = TEMPERATURE_STOPS[state.polygonPalette] ? state.polygonPalette : "diverging";
  if (isWeatherMap) {
    $("weather-legend-title").textContent = "Nhiệt độ không khí (°C)";
    $("weather-legend-scale").style.background = temperatureLegendGradient(palette);
    $("weather-legend-labels").replaceChildren(...TEMPERATURE_STOPS[palette].map(([value]) => Object.assign(document.createElement("span"), { textContent: String(value) })));
    $("weather-legend-note").textContent = `Dữ liệu OpenWeather · H3 res ${state.weatherResolution ?? state.resolution}`;
    return;
  }
  const data = state.mapType === "h3" ? state.h3Data : state.boundary;
  const scale = polygonLegendScale(data, state.dataProfile, state.polygonPalette);
  if (!scale) { legend.hidden = true; return; }
  const metric = state.aiDataset.recommendation.metricField;
  const hasTemperatureUnit = /nhi[eệ]t|temperature|temp/i.test(metric);
  $("weather-legend-title").textContent = `${metric}${hasTemperatureUnit ? " (°C)" : ""}`;
  $("weather-legend-scale").style.background = scale.gradient;
  $("weather-legend-labels").replaceChildren(...scale.values.map(value => Object.assign(document.createElement("span"), { textContent: Number(value.toFixed(1)).toLocaleString("vi-VN") })));
  $("weather-legend-note").textContent = state.mapType === "h3" ? `Dữ liệu tải lên · H3 res ${state.resolution}` : "Dữ liệu tải lên · Polygon";
}

function applyStyle() {
  if (!map) return;
  const color = fillExpression();
  const opacity = Number($("opacity").value);
  const borderColor = $("border-color").value;
  const borderWidth = Number($("line-width").value);
  if (map.getLayer("h3-fill")) {
    const weatherColor = state.dataOrigin === "search" && $("show-weather").checked
      ? temperatureFillExpression(state.polygonPalette, color)
      : state.aiDataset
      ? polygonFillExpression(state.h3Data, state.dataProfile, state.polygonPalette, color)
      : color;
    map.setPaintProperty("h3-fill", "fill-color", weatherColor);
    map.setPaintProperty("h3-fill", "fill-opacity", opacity);
    map.setPaintProperty("h3-border", "line-color", borderColor);
    map.setPaintProperty("h3-border", "line-width", borderWidth);
  }
  if (map.getLayer("polygon-fill")) {
    map.setPaintProperty("polygon-fill", "fill-color", state.metroData ? travelFillExpression(state.polygonPalette, color) : polygonFillExpression(state.boundary, state.dataProfile, state.polygonPalette, color));
    map.setPaintProperty("polygon-fill", "fill-opacity", opacity);
    map.setPaintProperty("polygon-border", "line-color", borderColor);
    map.setPaintProperty("polygon-border", "line-width", borderWidth);
  }
  applyMapLayerVisibility();
  renderMetroLegend();
  renderWeatherLegend();
}

function applyMapLayerVisibility() {
  if (!map) return;
  const showLayers = $("show-map-layers")?.checked ?? false;
  const showH3 = showLayers && state.mapType === "h3";
  const showPolygon = showLayers && state.mapType === "polygon" && (!state.metroData || $("show-metro-cells").checked);
  if (map.getLayer("h3-fill")) map.setLayoutProperty("h3-fill", "visibility", showH3 ? "visible" : "none");
  if (map.getLayer("h3-border")) map.setLayoutProperty("h3-border", "visibility", showH3 && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("point-marker")) map.setLayoutProperty("point-marker", "visibility", showLayers && state.mapType === "point" ? "visible" : "none");
  if (map.getLayer("point-circle")) map.setLayoutProperty("point-circle", "visibility", showLayers && state.mapType === "circle" ? "visible" : "none");
  if (map.getLayer("point-heatmap")) map.setLayoutProperty("point-heatmap", "visibility", showLayers && state.mapType === "heatmap" ? "visible" : "none");
  if (map.getLayer("polygon-fill")) map.setLayoutProperty("polygon-fill", "visibility", showPolygon ? "visible" : "none");
  if (map.getLayer("polygon-border")) map.setLayoutProperty("polygon-border", "visibility", showPolygon && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("vietnam-border")) map.setLayoutProperty("vietnam-border", "visibility", showLayers && (!state.metroData || $("show-metro-boundary").checked) ? "visible" : "none");
  for (const id of ["metro-stations", "metro-station-labels"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", showLayers && state.metroData && $("show-metro-stations").checked ? "visible" : "none");
  }
  if (map.getLayer("data-lines")) map.setLayoutProperty("data-lines", "visibility", showLayers && $("show-map-lines").checked && (state.metroData || state.mapType === "line") ? "visible" : "none");
  for (const layer of state.uploadLayers) {
    for (const layerId of layer.layerIds || []) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", showLayers ? "visible" : "none");
    }
  }
  $("metro-legend").hidden = !state.metroData || !showPolygon;
  if (!showPolygon) { state.metroPopup?.remove(); state.metroPopup = null; }
  if (!showH3 && !showPolygon) cellPopup?.remove();
  renderWeatherLegend();
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
  PolygonRenderer.render(map, state.boundary || EMPTY_FEATURE_COLLECTION, {
    sourceId: "polygon-data",
    fillLayerId: "polygon-fill",
    borderLayerId: "polygon-border",
    fillPaint: { "fill-color": "#389e55", "fill-opacity": .32 },
    borderPaint: { "line-color": "#00e65c", "line-width": 2 }
  });
  map.moveLayer("vietnam-border");
  map.addSource("line-data", { type: "geojson", data: state.lineData });
  map.addLayer({ id: "data-lines", type: "line", source: "line-data", paint: { "line-color": "#c52e64", "line-width": 3 } });
  map.addSource("metro-station-data", { type: "geojson", data: EMPTY_FEATURE_COLLECTION });
  map.addLayer({ id: "metro-stations", type: "circle", source: "metro-station-data", paint: { "circle-radius": 4, "circle-color": "#c52e64", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "metro-station-labels", type: "symbol", source: "metro-station-data", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top" }, paint: { "text-color": "#ffffff", "text-halo-color": "#151a23", "text-halo-width": 2 } });
  applyMapLayerVisibility();
  if (mapLayerEventsBound) return;
  mapLayerEventsBound = true;
  map.on("click", "polygon-fill", event => {
    if (state.metroData) showMetroComparison(event);
    else if (state.aiDataset) showAiPolygonDetails(event);
  });
  map.on("click", "metro-stations", event => {
    const feature = event.features?.[0]; if (!feature) return;
    const label = document.createElement("strong"); label.textContent = feature.properties?.name || "Ga Metro";
    new maplibregl.Popup({ offset: 8 }).setLngLat(event.lngLat).setDOMContent(label).addTo(map);
  });
  for (const id of ["polygon-fill", "metro-stations"]) {
    map.on("mouseenter", id, () => { if (state.metroData || state.aiDataset) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => map.getCanvas().style.cursor = "");
  }
  map.on("click", "h3-fill", event => {
    const p = event.features?.[0]?.properties; if (!p) return;
    const feature = state.h3Data.features.find(cell => cell.properties.h3 === p.h3) || event.features[0];
    if (state.aiDataset) {
      const popup = new maplibregl.Popup({ offset: 12, maxWidth: "360px", className: "ai-weather-popup" })
        .setDOMContent(aiWeatherPopupContent(feature));
      openCellPopup(popup, feature, "h3-fill");
      return;
    }
    if (state.dataOrigin !== "search" || !$("show-weather").checked) {
      openCellPopup(new maplibregl.Popup({ offset: 8 }).setHTML(`<div style="font:12px Inter;line-height:1.8"><b>H3:</b> ${p.h3}<br><b>Tâm ô:</b> ${fmt(Number(p.center_lat), 5)}, ${fmt(Number(p.center_lng), 5)}</div>`), feature, "h3-fill");
      return;
    }
    const missingKey = !CONFIG.OPENWEATHER_API_KEY;
    const popup = new maplibregl.Popup({ offset: 8, maxWidth: "300px", className: "weather-cell-popup" })
      .setDOMContent(weatherPopupContent(feature, null, missingKey ? "Chưa cấu hình VITE_OPENWEATHER_API_KEY." : "Đang tải dữ liệu thời tiết…"));
    openCellPopup(popup, feature, "h3-fill");
    if (missingKey) return;
    weatherForCell(feature).then(weather => {
      if (cellPopup === popup) popup.setDOMContent(weatherPopupContent(feature, weather));
    }).catch(error => {
      console.error("OpenWeather:", error);
      const message = error.status === 401 ? "API key OpenWeather không hợp lệ hoặc chưa được kích hoạt." : "Không thể tải dữ liệu thời tiết. Vui lòng thử lại.";
      if (cellPopup === popup) popup.setDOMContent(weatherPopupContent(feature, null, message));
    });
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

function addUploadedLayerToMap(layer) {
  const kinds = geometryKinds(layer.data);
  map.addSource(layer.sourceId, { type: "geojson", data: layer.data });
  layer.layerIds = [];
  if (kinds.includes("area")) {
    const fillId = `${layer.id}-fill`; const borderId = `${layer.id}-border`;
    map.addLayer({ id: fillId, type: "fill", source: layer.sourceId, paint: { "fill-color": layer.role === "hexagon" ? "#00e65c" : "#8b5cf6", "fill-opacity": layer.role === "hexagon" ? .62 : .3 } });
    map.addLayer({ id: borderId, type: "line", source: layer.sourceId, paint: { "line-color": layer.role === "hexagon" ? "#032b17" : "#c4b5fd", "line-width": layer.role === "hexagon" ? .55 : 1.5 } });
    layer.layerIds.push(fillId, borderId);
  }
  if (kinds.includes("line")) {
    const lineId = `${layer.id}-line`;
    map.addLayer({ id: lineId, type: "line", source: layer.sourceId, paint: { "line-color": "#f43f5e", "line-width": 3 } });
    layer.layerIds.push(lineId);
  }
  if (kinds.includes("point")) {
    const pointId = `${layer.id}-point`;
    map.addLayer({ id: pointId, type: "circle", source: layer.sourceId, paint: { "circle-radius": 5, "circle-color": "#f43f5e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } });
    layer.layerIds.push(pointId);
  }
}

function restoreUploadedLayers() {
  for (const layer of state.uploadLayers) addUploadedLayerToMap(layer);
  applyMapLayerVisibility();
  scheduleUploadLayerOrder();
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

function renderUploadedFiles() {
  const list = $("uploaded-layer-list");
  if (!list) return;
  list.replaceChildren(...state.uploadedFiles.map(file => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const detail = document.createElement("em");
    const remove = document.createElement("button");
    name.textContent = file.name;
    detail.textContent = file.detail;
    remove.type = "button";
    remove.className = "remove-uploaded-layer";
    remove.dataset.uploadId = file.id;
    remove.setAttribute("aria-label", `Xóa ${file.name}`);
    remove.title = `Xóa ${file.name}`;
    remove.textContent = "×";
    item.append(name, detail, remove);
    return item;
  }));
  if (!state.uploadedFiles.length) return;
  $("remove-current-file").hidden = true;
  $("file-name").textContent = `${state.uploadedFiles.length} lớp dữ liệu`;
  $("file-note").textContent = "Các file được xếp chồng theo từng lớp";
  $("selected-file").hidden = false;
}

function uploadLayerOrderInput() {
  return state.uploadLayers.map(layer => ({
    id: layer.id,
    name: layer.name,
    role: layer.role,
    geometryKinds: geometryKinds(layer.originalData),
    featureCount: layer.featureCount,
    layerIds: layer.layerIds
  }));
}

function applyUploadLayerOrder(orderedLayerIds) {
  const layers = uploadLayerOrderInput();
  for (const mapLayerId of mapLayerIdsInOrder(layers, orderedLayerIds)) {
    if (map?.getLayer(mapLayerId)) map.moveLayer(mapLayerId);
  }
}

function scheduleUploadLayerOrder() {
  const layers = uploadLayerOrderInput();
  applyUploadLayerOrder(deterministicLayerOrder(layers));
  clearTimeout(layerOrderTimer);
  const revision = ++layerOrderRevision;
  if (layers.length < 2) return;
  layerOrderTimer = setTimeout(async () => {
    const recommendation = await requestAiLayerOrder(layers);
    if (revision !== layerOrderRevision) return;
    applyUploadLayerOrder(recommendation.order);
  }, 350);
}

function clearUploadLayers() {
  clearTimeout(layerOrderTimer);
  layerOrderRevision++;
  for (const layer of state.uploadLayers) {
    for (const layerId of [...(layer.layerIds || [])].reverse()) {
      if (map?.getLayer(layerId)) map.removeLayer?.(layerId);
    }
    if (layer.sourceId && map?.getSource(layer.sourceId)) map.removeSource?.(layer.sourceId);
  }
  state.uploadLayers = [];
  state.uploadedFiles = [];
  state.uploadedFileKeys.clear();
  state.uploadLayerSequence = 0;
  state.metroParts = {};
  state.separateMetroActive = false;
}

function hasPolygonMask() {
  return geometryKinds(state.boundary || state.sourceBoundary).includes("area");
}

function uploadLayerData(layer) {
  if (layer.role !== "hexagon") return layer.originalData;
  if (!hasPolygonMask()) return layer.originalData;
  return clipGeoJSONToPolygon(layer.originalData, state.boundary || state.sourceBoundary);
}

function refreshClippedUploadLayers() {
  for (const layer of state.uploadLayers.filter(item => item.role === "hexagon")) {
    layer.data = uploadLayerData(layer);
    layer.featureCount = featureCount(layer.data);
    map?.getSource(layer.sourceId)?.setData(layer.data);
    const summary = state.uploadedFiles.find(file => file.id === layer.id);
    if (summary) summary.detail = hasPolygonMask()
      ? `${layer.featureCount.toLocaleString("vi-VN")} ô trong vùng`
      : `${layer.featureCount.toLocaleString("vi-VN")} ô`;
  }
  renderUploadedFiles();
}

function addUploadedGeoJSONLayer(data, name, { forceRole = null, id: requestedId = null, register = true, fileKey = null } = {}) {
  const kinds = geometryKinds(data);
  const role = forceRole || (isHexagonGeoJSON(data, name) ? "hexagon" : kinds.length === 1 ? kinds[0] : "mixed");
  const sequence = ++state.uploadLayerSequence;
  const id = requestedId || `uploaded-${sequence}`;
  const sourceId = `${id}-source`;
  const layer = { id, name, role, sourceId, layerIds: [], originalData: data, data, featureCount: featureCount(data) };
  layer.data = uploadLayerData(layer);
  layer.featureCount = featureCount(layer.data);
  addUploadedLayerToMap(layer);
  state.uploadLayers.push(layer);
  if (register) {
    state.uploadedFiles.push({
      id,
      name,
      fileKey,
      data,
      role,
      detail: role === "hexagon"
        ? hasPolygonMask() ? `${layer.featureCount.toLocaleString("vi-VN")} ô trong vùng` : `${layer.featureCount.toLocaleString("vi-VN")} ô`
        : `${featureCount(data).toLocaleString("vi-VN")} đối tượng`
    });
  }
  renderUploadedFiles();
  applyMapLayerVisibility();
  scheduleUploadLayerOrder();
  if (!hasPolygonMask()) fitGeoJSON(layer.data);
  return layer;
}

function syncMapStyleControls(loading = false) {
  const selectedStyle = pendingMapStyle || state.mapStyle;
  document.querySelectorAll(".basemap-option").forEach(button => {
    const active = button.dataset.mapStyle === selectedStyle;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = loading;
  });
  $("basemap-selection").replaceChildren(
    loading ? "Đang chuyển nền: " : "Minh họa lựa chọn nền: ",
    Object.assign(document.createElement("b"), { textContent: MAP_STYLE_LABELS[selectedStyle] })
  );
}

function selectMapStyle(styleKey) {
  if (!MAP_STYLES[styleKey] || styleKey === state.mapStyle || pendingMapStyle || !map) return;
  pendingMapStyle = styleKey;
  cellPopup?.remove();
  syncMapStyleControls(true);
  setStatus(`Đang chuyển sang nền ${MAP_STYLE_LABELS[styleKey]}…`);
  clearTimeout(mapStyleLoadTimer);
  mapStyleLoadTimer = setTimeout(() => {
    if (pendingMapStyle !== styleKey) return;
    pendingMapStyle = null;
    syncMapStyleControls(false);
    setStatus(`Không thể tải nền ${MAP_STYLE_LABELS[styleKey]}. Vui lòng thử lại.`, true);
  }, 15000);
  try {
    map.setStyle(MAP_STYLES[styleKey], { diff: false });
  } catch (error) {
    clearTimeout(mapStyleLoadTimer);
    pendingMapStyle = null;
    syncMapStyleControls(false);
    console.error("Không thể đổi nền bản đồ:", error);
    setStatus(`Không thể tải nền ${MAP_STYLE_LABELS[styleKey]}.`, true);
  }
}

function clearMetroData() {
  state.metroPopup?.remove(); state.metroPopup = null;
  state.metroData = null; state.metroTime = null; state.lineData = EMPTY_FEATURE_COLLECTION;
  if (state.polygonPalette === "travel") state.polygonPalette = null;
  map?.getSource("metro-station-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("line-data")?.setData(EMPTY_FEATURE_COLLECTION);
  $("metro-legend").hidden = true;
  $("metro-departure").replaceChildren();
}

function renderMetroLegend() {
  const legend = $("metro-legend");
  if (!state.metroData) { legend.hidden = true; return; }
  legend.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = `Tỷ lệ thời gian xe buýt/xe máy · ${state.metroTime}`;
  legend.append(heading);
  const colors = travelLegendColors(state.polygonPalette);
  if (colors) {
    const row = document.createElement("div"); row.className = "metro-legend-scale";
    ["Dưới 1 lần", "1–2 lần", "2–3 lần", "≥ 3 lần"].forEach((text, index) => {
      const item = document.createElement("span"); const swatch = document.createElement("i");
      swatch.style.backgroundColor = colors[index]; item.append(swatch, text); row.append(item);
    });
    legend.append(row);
  }
  const note = document.createElement("small"); note.textContent = "Dữ liệu mô phỏng · Bấm vào ô để xem thời gian. Ô xám: thiếu dữ liệu.";
  legend.append(note);
}

function showMetroComparison(event) {
  if (!state.metroData) return;
  const clicked = event.features?.[0]; if (!clicked?.properties) return;
  const feature = state.boundary.features.find(cell => cell.properties.cell_id === clicked.properties.cell_id) || clicked;
  const p = feature.properties;
  state.metroPopup?.remove();
  const card = document.createElement("div"); card.className = "metro-comparison";
  if (p.ratio == null || !Number.isFinite(Number(p.ratio))) {
    const note = document.createElement("p"); note.textContent = "Không có thời gian di chuyển ở giờ này."; card.append(note);
  } else {
    const ratio = Number(p.bus_minutes) / Number(p.motorbike_minutes);
    const summary = document.createElement("p"); summary.className = "metro-comparison-summary";
    summary.textContent = ratio > 1 ? "Xe buýt chậm hơn xe máy" : ratio < 1 ? "Thời gian xe buýt bằng" : "Thời gian xe buýt và xe máy bằng nhau";
    const ratioDisplay = document.createElement("div"); ratioDisplay.className = "metro-comparison-ratio";
    const ratioValue = document.createElement("strong"); ratioValue.textContent = fmt(ratio, 2);
    const ratioUnit = document.createElement("span"); ratioUnit.textContent = "lần";
    ratioDisplay.append(ratioValue, ratioUnit);
    const chart = document.createElement("div"); chart.className = "metro-comparison-bars";
    const step = Math.max(10, Math.ceil(Math.max(Number(p.bus_minutes), Number(p.motorbike_minutes)) / 60) * 10);
    const max = step * 6;
    const axis = document.createElement("div"); axis.className = "metro-comparison-axis";
    const unit = document.createElement("span"); unit.className = "metro-comparison-axis-unit"; unit.textContent = "phút";
    axis.append(unit);
    for (let tick = 0; tick <= 6; tick++) {
      const row = document.createElement("div"); row.className = "metro-comparison-tick";
      row.style.bottom = `${tick / 6 * 100}%`;
      const label = document.createElement("span"); label.textContent = String(tick * step);
      row.append(label); axis.append(row);
    }
    chart.append(axis);
    [["Xe buýt (1)", Number(p.bus_minutes)], ["Xe máy (2)", Number(p.motorbike_minutes)]].forEach(([name, minutes]) => {
      const column = document.createElement("div"); const value = document.createElement("b"); const bar = document.createElement("i"); const label = document.createElement("span");
      column.className = "metro-comparison-column";
      column.style.height = `${Math.max(1, minutes / max * 100)}%`;
      value.textContent = `${Number(minutes.toFixed(1))}′`; label.textContent = name;
      column.append(value, bar, label); chart.append(column);
    });
    card.append(summary, ratioDisplay, chart);
  }
  const footnote = document.createElement("small"); footnote.className = "metro-comparison-notes";
  for (const text of ["(1) Thời gian di chuyển bằng xe buýt.", "(2) Thời gian di chuyển bằng xe máy.", `Số liệu mô phỏng · Giờ xuất phát ${state.metroTime}.`]) {
    const line = document.createElement("div"); line.textContent = text; footnote.append(line);
  }
  card.append(footnote);
  const center = map.project(cellCenter(feature));
  const anchor = "left";
  const ring = feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0][0];
  const offset = Math.max(...ring.map(point => Math.abs(map.project(point).x - center.x))) + 16;
  state.metroPopup = openCellPopup(new maplibregl.Popup({ anchor, offset, maxWidth: "380px", className: "metro-comparison-popup" }).setDOMContent(card), feature, "polygon-fill");
}

function aiWeatherPopupContent(feature) {
  const { recommendation } = state.aiDataset;
  const card = document.createElement("div");
  card.className = "weather-popup";
  const title = document.createElement("strong");
  title.textContent = feature.properties?.[recommendation.geometry.field] || "Khu vực dữ liệu";
  const list = document.createElement("dl");
  const detailFields = [...new Set([...(recommendation.filters || []).map(filter => filter.field), ...recommendation.numericFields])];
  for (const field of detailFields) {
    if (feature.properties?.[field] == null || feature.properties[field] === "") continue;
    const row = document.createElement("div");
    const term = document.createElement("dt"); const value = document.createElement("dd");
    const filter = recommendation.filters.find(item => item.field === field);
    term.textContent = filter?.label || field; value.textContent = displayFilterValue(feature.properties[field], filter?.control);
    row.append(term, value); list.append(row);
  }
  card.append(title, list);
  return card;
}

function showAiPolygonDetails(event) {
  const feature = event.features?.[0];
  if (!feature || !state.aiDataset) return;
  const card = aiWeatherPopupContent(feature);
  new maplibregl.Popup({ offset: 12, maxWidth: "360px", className: "ai-weather-popup" }).setLngLat(event.lngLat).setDOMContent(card).addTo(map);
}

function updateMetroTime() {
  if (!state.metroData) return;
  state.metroPopup?.remove(); state.metroPopup = null;
  state.metroTime = $("metro-departure").value;
  state.boundary = metroCellsAtTime(state.metroData, state.metroTime);
  state.sourceBoundary = state.boundary;
  state.dataProfile = analyzeSpatialData(state.boundary);
  map.getSource("polygon-data")?.setData(state.boundary);
  syncPolygonPaletteControls(); applyStyle();
}

async function replaceMetroData(data, name) {
  await replaceBoundary(metroCellsAtTime(data, data.times[0]), name, null, { preservePolygons: true });
  state.metroData = data; state.metroTime = data.times[0]; state.mapType = "polygon"; state.polygonPalette = "travel";
  state.lineData = data.metro_route;
  map.getSource("vietnam-boundary")?.setData(data.boundary);
  map.getSource("metro-station-data")?.setData(data.stations);
  map.getSource("line-data")?.setData(state.lineData);
  $("metro-departure").replaceChildren(...data.times.map(time => {
    const option = document.createElement("option"); option.value = time; option.textContent = time; return option;
  }));
  for (const id of ["show-map-layers", "show-metro-cells", "show-metro-boundary", "show-metro-stations", "show-map-lines"]) $(id).checked = true;
  $("show-map-layers-status").textContent = "Đang bật";
  renderCompatibleMapTypes(state.boundary); applyStyle();
  $("file-note").textContent = `${data.hexagons.features.length} ô · ${data.stations.features.length} ga · Dữ liệu mô phỏng`;
  setStatus("Đã hiển thị vùng dữ liệu, đường bao, các ga và tuyến Metro.", true);
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

async function rebuildGrid({ fit = false } = {}) {
  if (!state.boundary) { setStatus("Hãy upload dữ liệu không gian trước."); return; }
  const estimate = estimateCellCount(state.resolution);
  if (estimate > CONFIG.MAX_RENDER_CELLS) {
    const previous = state.resolution;
    state.resolution = Math.max(3, Math.min(7, CONFIG.DEFAULT_RESOLUTION + Math.floor(Math.log(CONFIG.MAX_RENDER_CELLS / state.baselineCount) / Math.log(7))));
    $("resolution").value = state.resolution; $("resolution-value").value = state.resolution;
    showToast(`Resolution ${previous} ước tính ${estimate.toLocaleString("vi-VN")} ô, vượt giới hạn an toàn.`);
    return rebuildGrid({ fit });
  }
  setStatus(`Đang tạo H3 resolution ${state.resolution}…`);
  await new Promise(resolve => setTimeout(resolve, 20));
  try {
    state.h3Data = geoJSONToH3FeatureCollection(state.boundary, state.resolution);
    const cellCount = state.h3Data.features.length;
    if (!state.baselineCount) {
      state.baselineCount = Math.max(1, Math.round(cellCount / Math.pow(7, state.resolution - CONFIG.DEFAULT_RESOLUTION)));
    }
    const source = map.getSource("h3-grid"); if (source) source.setData(state.h3Data);
    $("cell-count").textContent = cellCount.toLocaleString("vi-VN"); $("cell-label").textContent = `Tổng số cell (res ${state.resolution})`;
    state.page = 1; updateDashboard();
    if (fit) fitBoundary();
    syncPolygonPaletteControls();
    applyStyle();
    setStatus(`Đã vẽ ${cellCount.toLocaleString("vi-VN")} ô H3.`, true);
    if (state.dataOrigin === "search" && $("show-weather").checked) void loadWeatherForGrid();
  } catch (error) { console.error(error); setStatus("Không thể tạo lưới H3."); showToast(error.message || "Dữ liệu không hợp lệ."); }
}
function updateDashboard() { renderTable(); }

function filteredFeatures() { const q = state.query.trim().toLowerCase(); return q ? state.h3Data.features.filter(f => f.properties.h3.toLowerCase().includes(q)) : state.h3Data.features; }
function renderTable() {
  const all = filteredFeatures(); const pages = Math.max(1, Math.ceil(all.length / state.pageSize)); state.page = Math.min(state.page, pages); const start = (state.page - 1) * state.pageSize; const rows = all.slice(start, start + state.pageSize);
  $("data-body").innerHTML = rows.length ? rows.map((f, i) => { const p = f.properties; return `<tr><td>${start + i + 1}</td><td><b>${p.h3}</b></td><td>${fmt(p.center_lat, 5)}, ${fmt(p.center_lng, 5)}</td><td>•••</td></tr>`; }).join("") : `<tr><td colspan="4" class="empty-row">Không tìm thấy dữ liệu.</td></tr>`;
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

function fitGeoJSON(data) {
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
  if (data?.type === "FeatureCollection") data.features?.forEach(feature => collectGeometry(feature.geometry));
  else if (data?.type === "Feature") collectGeometry(data.geometry);
  else collectGeometry(data);

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

function fitBoundary() { fitGeoJSON(state.boundary); }

function renderCompatibleMapTypes(data, profile = analyzeSpatialData(data)) {
  const types = compatibleMapTypes(profile).filter(type => !state.metroData || type.id === "polygon"); const grid = $("map-type-grid"); state.dataProfile = profile;
  showSupportedChartCatalog(false);
  if (!types.some(type => type.id === state.mapType)) state.mapType = types[0]?.id || null;
  grid.replaceChildren(...types.map(type => {
    const button = document.createElement("button"); const icon = document.createElement("span");
    button.type = "button"; button.className = `map-type${type.id === state.mapType ? " active" : ""}`; button.dataset.type = type.id; button.dataset.label = type.label;
    button.title = `${type.label} · ${type.renderer}`; renderMapIcon(icon, type.icon); button.append(icon, type.label); return button;
  }));
  grid.classList.toggle("is-empty", types.length === 0);
  if (!types.length) grid.textContent = "Dữ liệu này chưa phù hợp với renderer hiện có.";
  $("map-type-summary").textContent = types.length
    ? `Phát hiện ${describeDataProfile(profile)} · ${types.length} kiểu bản đồ phù hợp`
    : `Phát hiện ${describeDataProfile(profile)} · chưa có kiểu bản đồ phù hợp`;
  updateModelSections();
}

function clearUploadedData() {
  weatherLoadRevision += 1;
  clearMetroData();
  clearUploadLayers();
  state.boundary = null; state.sourceBoundary = null; state.h3Data = { type: "FeatureCollection", features: [] };
  state.pointData = { type: "FeatureCollection", features: [] };
  state.mapType = null; state.dataProfile = null; state.chartConfig = null; state.chartOptions = []; state.chartAnalysis = null; state.chartMapping = null; state.mappingWarning = ""; state.baselineCount = null; state.page = 1; state.dataOrigin = null; state.aiDataset = null;
  $("ai-data-filters").hidden = true;
  updateModelSections();
  clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  showChartStyleControls(false);
  clearDataMappingPanel($("data-mapping-controls"));
  $("map-type-grid").className = "map-type-grid is-empty"; $("map-type-grid").textContent = "Chưa có dữ liệu để đề xuất mô hình.";
  $("map-type-summary").textContent = "";
  showSupportedChartCatalog(true);
  $("selected-file").hidden = true; $("remove-current-file").hidden = true; $("spatial-file").value = ""; $("uploaded-layer-list")?.replaceChildren(); setupProvinceFilter(EMPTY_FEATURE_COLLECTION);
  map?.getSource("h3-grid")?.setData(state.h3Data); map?.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("point-data")?.setData(state.pointData);
  map?.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION);
}

async function resetConfiguration() {
  state.resolution = CONFIG.DEFAULT_RESOLUTION;
  state.barStyle = mergeBarConfig();
  state.pieStyle = mergePieConfig();
  state.polygonPalette = state.metroData ? "travel" : (state.dataOrigin === "search" || state.aiDataset) ? "diverging" : null;

  $("resolution").value = CONFIG.DEFAULT_RESOLUTION;
  $("resolution-value").value = CONFIG.DEFAULT_RESOLUTION;
  $("fixed-color").value = "#6c5ce7";
  $("fixed-color-value").textContent = "#6C5CE7";
  $("opacity").value = .72;
  $("opacity-value").value = "72%";
  $("show-border").checked = true;
  $("border-color").value = "#ffffff";
  $("border-color-value").textContent = "#FFFFFF";
  $("line-width").value = .5;
  $("line-width-value").value = "0.5 px";
  if (!state.chartConfig) syncPolygonPaletteControls();
  $("show-map-layers").checked = true;
  $("show-map-layers-status").textContent = "Đang bật";
  $("show-weather").checked = true;
  $("show-weather-status").textContent = "Đang bật";
  for (const id of ["show-metro-cells", "show-metro-boundary", "show-metro-stations", "show-map-lines"]) $(id).checked = true;

  if (state.chartConfig) {
    const defaultOption = state.chartOptions.find(option => option.id === state.mapType);
    if (defaultOption) {
      const defaultSeries = Array.isArray(defaultOption.config.series)
        ? defaultOption.config.series.map(item => ({ ...item }))
        : [];
      const chartStyle = defaultOption.config.chartKind === "pie" ? state.pieStyle : state.barStyle;
      state.chartConfig = { ...defaultOption.config, ...chartStyle, series: defaultSeries };
      state.chartMapping = {
        datasetPath: defaultOption.config.sourcePath,
        xField: defaultOption.config.xField,
        metrics: defaultSeries.map(item => item.key)
      };
      state.mappingWarning = "";
    } else {
      state.chartConfig = { ...state.chartConfig, ...state.barStyle };
    }
    renderChartCanvas();
    renderChartDataMapping();
    renderChartStyleControls();
  } else if (state.metroData) {
    $("metro-departure").value = state.metroData.times[0]; updateMetroTime();
  } else if (state.boundary) {
    await rebuildGrid();
  }

  applyStyle();
  applyMapLayerVisibility();
  updateDashboard();
}

function deleteData() {
  clearUploadedData();
  setDataPanelVisible(false);
  state.query = "";
  $("table-search").value = "";
  $("coordinate-input").value = "";
  $("cell-count").textContent = "0";
  $("cell-label").textContent = `Tổng số cell (res ${state.resolution})`;
  applyMapLayerVisibility();
  updateDashboard();
}

function renderChartStyleControls() {
  if (!state.chartConfig) return;
  if (state.chartConfig.chartKind === "pie") {
    clearBarStylePanel($("bar-style-controls"));
    $("style-description").textContent = "Dữ liệu, kích thước hình tròn, màu sắc, nhãn và chú giải";
    renderPieStylePanel($("bar-style-controls"), {
      config: { ...state.pieStyle, variant: state.chartConfig.variant },
      rowCount: state.chartConfig.data.length,
      series: state.chartConfig.series,
      onChange(nextConfig) {
        state.pieStyle = mergePieConfig(nextConfig);
        state.chartConfig = { ...state.chartConfig, ...state.pieStyle };
        renderChartCanvas();
        renderChartStyleControls();
      },
      onSeriesChange(index, color) {
        state.chartConfig = {
          ...state.chartConfig,
          series: state.chartConfig.series.map((item, itemIndex) => itemIndex === index ? { ...item, color } : item)
        };
        renderChartCanvas();
        renderChartStyleControls();
      }
    });
    return;
  }
  clearPieStylePanel($("bar-style-controls"));
  $("style-description").textContent = state.chartConfig.chartKind === "line"
    ? "Màu đường, nhãn, chú giải và tooltip"
    : "Dữ liệu, màu sắc, kích thước cột, nhãn và trục";
  renderBarStylePanel($("bar-style-controls"), {
    config: state.barStyle,
    chartKind: state.chartConfig.chartKind || "bar",
    rowCount: state.chartConfig.data.length,
    series: state.chartConfig.series,
    onChange(nextConfig) {
      state.barStyle = mergeBarConfig(nextConfig);
      state.chartConfig = { ...state.chartConfig, ...state.barStyle };
      renderChartCanvas();
      renderChartStyleControls();
    },
    onSeriesChange(index, color) {
      state.chartConfig = {
        ...state.chartConfig,
        series: state.chartConfig.series.map((item, itemIndex) => itemIndex === index ? { ...item, color } : item)
      };
      renderChartCanvas();
      renderChartStyleControls();
    }
  });
}

function renderChartDataMapping() {
  if (!state.chartAnalysis || !state.chartMapping || !state.chartConfig) return;
  renderDataMappingPanel($("data-mapping-controls"), {
    analysis: state.chartAnalysis,
    ...state.chartMapping,
    variant: state.chartConfig.variant,
    warning: state.mappingWarning,
    onChange: applyChartMappingChange,
    onResetMetrics: resetDisplayedMetrics
  });
}

function resetDisplayedMetrics() {
  const dataset = state.chartAnalysis?.datasets.find(item => item.path === state.chartMapping?.datasetPath);
  if (!dataset) return;
  const variant = state.chartConfig?.variant;
  const count = variant === "single" ? 1 : variant === "double" ? 2 : variant === "line"
    ? Math.min(3, dataset.suggestedMetrics.length)
    : ["pie", "halfPie"].includes(variant)
    ? Math.min(6, dataset.suggestedMetrics.length)
    : Math.min(4, dataset.suggestedMetrics.length);
  applyChartMappingChange({ metrics: dataset.suggestedMetrics.slice(0, count) });
  showToast("Đã đặt lại chỉ số hiển thị.");
}

function applyChartMappingChange(change) {
  let mapping = { ...state.chartMapping, ...change };
  if (change.datasetPath) {
    const nextDataset = state.chartAnalysis.datasets.find(dataset => dataset.path === change.datasetPath);
    const count = state.chartConfig.variant === "single" ? 1 : state.chartConfig.variant === "double" ? 2 : state.chartConfig.variant === "line" ? Math.min(3, nextDataset.suggestedMetrics.length) : ["pie", "halfPie"].includes(state.chartConfig.variant) ? Math.min(6, nextDataset.suggestedMetrics.length) : Math.min(4, nextDataset.suggestedMetrics.length);
    mapping = { datasetPath: nextDataset.path, xField: nextDataset.suggestedCategory, metrics: nextDataset.suggestedMetrics.slice(0, count) };
  }
  state.chartMapping = mapping;
  const dataset = state.chartAnalysis.datasets.find(item => item.path === mapping.datasetPath);
  const validation = validateBarMapping(dataset, mapping, state.chartConfig.variant);
  state.mappingWarning = validation.message;
  if (validation.valid) {
    const defaultSeries = state.chartConfig.chartKind === "line" ? lineSeriesFromFields(mapping.metrics) : state.chartConfig.chartKind === "pie" ? pieSeriesFromFields(mapping.metrics) : seriesFromFields(mapping.metrics);
    const palette = state.chartConfig.chartKind === "line" ? LINE_COLORS : state.chartConfig.chartKind === "pie" ? PIE_COLORS : BAR_COLORS;
    const series = reconcileSeriesColors(defaultSeries, state.chartConfig.series, palette);
    state.chartConfig = {
      ...state.chartConfig,
      data: dataForBarMapping(dataset, mapping),
      sourcePath: dataset.path,
      xField: mapping.xField,
      series,
      title: state.chartConfig.variant === "line"
        ? `Xu hướng theo ${humanizeField(mapping.xField).toLowerCase()}`
        : state.chartConfig.chartKind === "pie"
        ? mapping.metrics.length === 1
          ? `${humanizeField(mapping.metrics[0])} theo ${humanizeField(mapping.xField).toLowerCase()}`
          : `Cơ cấu các chỉ số theo ${humanizeField(mapping.xField).toLowerCase()}`
        : state.chartConfig.variant === "single"
        ? `${humanizeField(mapping.metrics[0])} theo ${humanizeField(mapping.xField).toLowerCase()}`
        : `${state.chartConfig.variant === "double" ? "So sánh hai chỉ số" : "So sánh nhiều chỉ số"} · ${dataset.label}`
    };
    renderChartCanvas();
    renderChartStyleControls();
  }
  renderChartDataMapping();
}

function showChartStyleControls(show) {
  $("map-style-controls").hidden = show;
  $("bar-style-controls").hidden = !show;
  $("style-description").textContent = show ? "Tùy chỉnh biểu đồ" : "Màu sắc, độ mờ và đường viền";
  if (show) renderChartStyleControls();
  else {
    clearBarStylePanel($("bar-style-controls"));
    clearPieStylePanel($("bar-style-controls"));
  }
}

function clearAiMapState() {
  state.aiDataset = null;
  $("ai-data-filters").hidden = true;
  $("ai-filter-controls").replaceChildren();
}

function normalizeTravelTimeRecords(records) {
  if (!Array.isArray(records) || !records.length) return null;
  const requiredFields = ["cell_id", "departure_time", "bus_minutes", "motorbike_minutes"];
  if (!records.every(row => row && typeof row === "object" && requiredFields.every(field => field in row))) return null;
  const timeText = value => {
    if (typeof value === "number" && value >= 0 && value < 1) {
      const minutes = Math.round(value * 24 * 60) % (24 * 60);
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    }
    if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
      return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
    }
    return String(value ?? "").trim();
  };
  const numberValue = value => typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  return records.map(row => ({
    ...row,
    cell_id: String(row.cell_id ?? "").trim(),
    departure_time: timeText(row.departure_time),
    bus_minutes: numberValue(row.bus_minutes),
    motorbike_minutes: numberValue(row.motorbike_minutes),
    ...(row.ratio === undefined || row.ratio === "" ? {} : { ratio: numberValue(row.ratio) })
  }));
}

async function readSpatialFile(file) {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "zip") throw new Error("ZIP/Shapefile sẽ được hỗ trợ ở phiên bản tiếp theo.");
  if (["xlsx", "xls"].includes(extension)) {
    if (!globalThis.XLSX) throw new Error("Không tải được thư viện đọc Excel. Vui lòng kiểm tra kết nối mạng.");
    const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = globalThis.XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: true });
    const travelRecords = normalizeTravelTimeRecords(records);
    if (travelRecords) return { kind: "metro-part", role: "travel_times", data: travelRecords };
    try {
      const data = recordsToPointGeoJSON(records);
      return { data, profile: analyzeSpatialData(data) };
    } catch {
      const recommendation = await requestAiMapRecommendation(records);
      if (recommendation?.canRenderMap) return { kind: "ai-map", records, recommendation };
      return { kind: "chart", analysis: analyzeBarData(records) };
    }
  }
  const text = await file.text();
  if (extension === "csv") {
    if (!globalThis.XLSX) throw new Error("Không tải được thư viện đọc CSV. Vui lòng kiểm tra kết nối mạng.");
    const workbook = globalThis.XLSX.read(text, { type: "string", raw: true });
    const records = globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true });
    const travelRecords = normalizeTravelTimeRecords(records);
    if (travelRecords) return { kind: "metro-part", role: "travel_times", data: travelRecords };
    try {
      const data = recordsToPointGeoJSON(records);
      return { data, profile: analyzeSpatialData(data) };
    } catch {
      const recommendation = await requestAiMapRecommendation(records);
      if (recommendation?.canRenderMap) return { kind: "ai-map", records, recommendation };
      return { kind: "chart", analysis: analyzeBarData(records) };
    }
  }
  const parsed = JSON.parse(text);
  const metro = readMetroData(parsed);
  if (metro) return { kind: "metro", data: metro };
  const rawTravelRecords = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.travel_times) ? parsed.travel_times
    : Array.isArray(parsed?.data) ? parsed.data
    : null;
  const travelRecords = normalizeTravelTimeRecords(rawTravelRecords);
  if (travelRecords) {
    return { kind: "metro-part", role: "travel_times", data: travelRecords };
  }
  if (typeof parsed?.type === "string") return { data: parsed, profile: analyzeSpatialData(parsed) };
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
  if (records) {
    try {
      const data = recordsToPointGeoJSON(records);
      return { data, profile: analyzeSpatialData(data) };
    } catch {
      const recommendation = await requestAiMapRecommendation(records);
      if (recommendation?.canRenderMap) return { kind: "ai-map", records, recommendation };
    }
  }
  return { kind: "chart", analysis: analyzeBarData(parsed) };
}

function uniqueRecordValues(records, field) {
  if (!field) return [];
  const values = new Map();
  for (const record of records) {
    const value = record?.[field];
    if (value == null || value === "") continue;
    values.set(comparableFilterValue(value), value);
  }
  return [...values.entries()];
}

function populateAiFilters(dataset) {
  const { records, recommendation } = dataset;
  const controls = $("ai-filter-controls");
  const initialFilters = {};
  controls.replaceChildren(...recommendation.filters.flatMap(filter => {
    const values = uniqueRecordValues(records, filter.field).sort((a, b) =>
      filter.control === "date-select" ? a[0].localeCompare(b[0]) : String(a[1]).localeCompare(String(b[1]), "vi")
    );
    if (values.length < 2) return [];
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = filter.label || filter.field;
    if (filter.field === recommendation.geometry.field) {
      const multiselect = document.createElement("div");
      const toggle = document.createElement("button");
      const menu = document.createElement("div");
      const toggleText = document.createElement("span");
      const chevron = document.createElement("span");
      multiselect.className = "ai-multiselect";
      toggle.type = "button";
      toggle.className = "ai-multiselect-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggleText.textContent = `Chọn ${caption.textContent.toLocaleLowerCase("vi")}`;
      chevron.textContent = "⌄";
      chevron.setAttribute("aria-hidden", "true");
      toggle.append(toggleText, chevron);
      menu.className = "ai-multiselect-menu";
      menu.hidden = true;
      menu.replaceChildren(...values.map(([value, raw]) => {
        const option = document.createElement("label");
        const input = document.createElement("input");
        const text = document.createElement("span");
        input.type = "checkbox";
        input.className = "ai-generated-filter";
        input.dataset.field = filter.field;
        input.value = value;
        text.textContent = displayFilterValue(raw, filter.control);
        option.append(input, text);
        return option;
      }));
      multiselect.append(toggle, menu);
      initialFilters[filter.field] = [];
      label.append(caption, multiselect);
      return [label];
    }
    const select = document.createElement("select");
    select.className = "ai-generated-filter";
    select.dataset.field = filter.field;
    select.setAttribute("aria-label", `Lọc theo ${caption.textContent}`);
    const options = filter.allowAll ? [["", `Tất cả ${caption.textContent.toLocaleLowerCase("vi")}`], ...values] : values;
    select.replaceChildren(...options.map(([value, raw]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "" ? raw : displayFilterValue(raw, filter.control);
      return option;
    }));
    initialFilters[filter.field] = select.value;
    label.append(caption, select);
    return [label];
  }));
  $("ai-data-filters").hidden = controls.children.length === 0;
  return initialFilters;
}

function selectedAiFilters() {
  const filters = {};
  for (const control of document.querySelectorAll("#ai-filter-controls .ai-generated-filter")) {
    if (control.type === "checkbox") {
      if (!filters[control.dataset.field]) filters[control.dataset.field] = [];
      if (control.checked) filters[control.dataset.field].push(control.value);
    } else filters[control.dataset.field] = control.value;
  }
  return filters;
}

async function filteredAiBoundary({ fit = false } = {}) {
  if (!state.aiDataset) return;
  const { records, boundaries, recommendation } = state.aiDataset;
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: selectedAiFilters() });
  state.boundary = data; state.sourceBoundary = data;
  state.baselineCount = null;
  const numericFields = [recommendation.metricField, ...recommendation.numericFields.filter(field => field !== recommendation.metricField)];
  state.dataProfile = analyzeSpatialData(data, { numericFields });
  map.getSource("polygon-data")?.setData(data);
  map.getSource("vietnam-boundary")?.setData(data);
  if (state.mapType === "h3") await rebuildGrid({ fit });
  else {
    syncPolygonPaletteControls(); applyStyle();
    if (fit && data.features.length) fitBoundary();
  }
  $("file-note").textContent = `${data.features.length} khu vực · ${recommendation.metricField} · ${recommendation.source === "ai" ? "GPT-5.6 Luna đề xuất" : "quy tắc dự phòng"}`;
}

async function replaceAiMapData(records, recommendation, name) {
  if (!CONFIG.MAPTILER_API_KEY) throw new Error("Cần cấu hình MAPTILER_API_KEY để tải ranh giới hành chính.");
  const locations = uniqueRecordValues(records, recommendation.geometry.field).map(([, value]) => value);
  const geometryLabel = recommendation.filters.find(filter => filter.field === recommendation.geometry.field)?.label || recommendation.geometry.field;
  setStatus(`Đang tải ranh giới MapTiler cho ${locations.length} giá trị ${geometryLabel}…`);
  const mapTilerBoundaries = await loadMapTilerAdministrativeBoundaries(locations, {
    apiKey: CONFIG.MAPTILER_API_KEY,
    placeType: recommendation.geometry.placeType,
    onProgress: ({ completed, total }) => setStatus(`Đang tải ranh giới MapTiler… ${completed}/${total}`)
  });
  setStatus("Đang chuẩn hóa ranh giới tỉnh/thành…");
  const boundaries = {
    ...mapTilerBoundaries,
    features: await Promise.all(mapTilerBoundaries.features.map(async boundary =>
      await landOnlyBoundary(boundary, { forceVietnam: true }) || boundary
    ))
  };
  const initialFilters = populateAiFilters({ records, recommendation });
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: initialFilters });
  if (!data.features.length) throw new Error(`Không ghép được trường ${geometryLabel} với ranh giới hành chính.`);
  const numericFields = [recommendation.metricField, ...recommendation.numericFields.filter(field => field !== recommendation.metricField)];
  const profile = analyzeSpatialData(data, { numericFields });
  await replaceBoundary(data, name, profile, { preservePolygons: true, preserveAi: true });
  state.aiDataset = { records, recommendation, boundaries };
  state.dataOrigin = "ai"; state.mapType = "polygon"; state.polygonPalette = "diverging";
  renderCompatibleMapTypes(data, profile);
  await filteredAiBoundary();
  $("map-type-summary").textContent = `${recommendation.explanation} · Độ tin cậy ${Math.round(recommendation.confidence * 100)}%`;
  setStatus(`Đã tạo bản đồ ${recommendation.title}.`, true);
}

function selectChartOption(type) {
  const option = state.chartOptions.find(item => item.id === type);
  if (!option) return false;
  const chartStyle = option.config.chartKind === "pie" ? state.pieStyle : state.barStyle;
  state.mapType = option.id; state.chartConfig = { ...option.config, ...chartStyle };
  state.chartMapping = { datasetPath: option.config.sourcePath, xField: option.config.xField, metrics: option.config.series.map(item => item.key) };
  state.mappingWarning = "";
  document.querySelectorAll("#map-type-grid .map-type").forEach(button => button.classList.toggle("active", button.dataset.type === type));
  renderChartCanvas(); renderChartDataMapping(); renderChartStyleControls();
  updateModelSections();
  setStatus(`Đang hiển thị kiểu ${option.label}.`, true);
  return true;
}

function replaceChartData(analysis, name) {
  clearAiMapState();
  clearMetroData();
  state.dataOrigin = "upload";
  const primaryDataset = analysis.datasets.find(dataset => dataset.path === analysis.sourcePath) || analysis.datasets[0];
  const lineOption = createLineOption(primaryDataset, analysis.titlePrefix);
  const pieOptions = createPieOptions(primaryDataset, `Cơ cấu các chỉ số · ${analysis.titlePrefix}`);
  const options = [...analysis.options, ...(lineOption ? [lineOption] : []), ...pieOptions];
  state.chartAnalysis = { ...analysis, options }; state.chartOptions = options; state.boundary = null; state.sourceBoundary = null; state.dataProfile = null;
  state.h3Data = { type: "FeatureCollection", features: [] }; state.pointData = { type: "FeatureCollection", features: [] };
  map.getSource("h3-grid")?.setData(state.h3Data); map.getSource("point-data")?.setData(state.pointData); map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION);
  setupProvinceFilter(EMPTY_FEATURE_COLLECTION);
  showSupportedChartCatalog(false);
  $("map-type-grid").className = "map-type-grid";
  $("map-type-grid").replaceChildren(...options.map(option => {
    const button = document.createElement("button"); const icon = document.createElement("span");
    button.type = "button"; button.className = "map-type"; button.dataset.type = option.id; button.dataset.label = option.label;
    button.title = `${option.label} · Recharts`; renderChartIcon(icon, option.icon); button.append(icon, option.label); return button;
  }));
  $("map-type-summary").textContent = `Tìm thấy ${analysis.rowCount} bản ghi tại ${analysis.sourcePath} · ${analysis.numericFields.length} trường số · ${options.length} kiểu biểu đồ phù hợp`;
  $("file-name").textContent = name; $("file-note").textContent = "Dữ liệu biểu đồ đã tải · đang sử dụng"; $("remove-current-file").hidden = false; $("selected-file").hidden = false;
  const canvas = $("chart-canvas"); canvas.hidden = false; document.querySelector(".map-panel").classList.add("chart-mode");
  setDataPanelVisible(false); showChartStyleControls(true); selectChartOption(options[0].id);
}
async function replaceBoundary(data, name, profile = null, { preservePolygons = false, preserveAi = false } = {}) {
  weatherLoadRevision += 1;
  if (!preserveAi) clearAiMapState();
  clearMetroData();
  state.chartConfig = null; state.chartOptions = []; state.chartAnalysis = null; state.chartMapping = null; state.mappingWarning = ""; clearDataMappingPanel($("data-mapping-controls")); clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  showChartStyleControls(false);
  if (!data) throw new Error("Không tìm thấy dữ liệu.");
  state.dataOrigin = "upload";
  if (preservePolygons) state.mapType = "polygon";
  else geoJSONToCells(data, Math.min(state.resolution, 3));
  state.sourceBoundary = data; state.boundary = data; setupProvinceFilter(data);
  renderCompatibleMapTypes(data, profile || analyzeSpatialData(data));
  state.pointData = pointFeatureCollection(data); map.getSource("point-data")?.setData(state.pointData); applyPointStyle();
  const features = data.type === "FeatureCollection" ? data.features : data.type === "Feature" ? [data] : [{ type: "Feature", properties: {}, geometry: data }];
  state.lineData = { type: "FeatureCollection", features: features.filter(feature => ["LineString", "MultiLineString"].includes(feature.geometry?.type)) };
  map.getSource("line-data")?.setData(state.lineData);
  map.getSource("polygon-data")?.setData(data); updateModelSections();
  map.getSource("vietnam-boundary")?.setData(data); $("file-name").textContent = name; $("file-note").textContent = "Dữ liệu đã tải · đang sử dụng"; $("remove-current-file").hidden = false; $("selected-file").hidden = false; state.baselineCount = null;
  if (preservePolygons) {
    state.h3Data = EMPTY_FEATURE_COLLECTION; map.getSource("h3-grid")?.setData(state.h3Data); updateDashboard(); fitBoundary();
  } else await rebuildGrid({ fit: true });
  refreshClippedUploadLayers();
  applyStyle();
}

function renderSearchMapTypes() {
  const grid = $("map-type-grid");
  const types = [
    { id: "h3", label: "H3 Hexagon", icon: "hexagon", renderer: "H3" },
    { id: "polygon", label: "Polygon", icon: "polygon", renderer: "MapLibre" }
  ];
  grid.replaceChildren(...types.map(type => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    button.type = "button";
    button.className = `map-type${type.id === state.mapType ? " active" : ""}`;
    button.dataset.type = type.id;
    button.dataset.label = type.label;
    button.title = `${type.label} · ${type.renderer}`;
    renderMapIcon(icon, type.icon);
    button.append(icon, type.label);
    return button;
  }));
  grid.classList.remove("is-empty");
  $("map-type-summary").textContent = "Khu vực tìm kiếm · H3 Hexagon hoặc Polygon theo ranh giới đã chọn";
  showSupportedChartCatalog(false);
}

async function applySearchBoundaries(boundaries) {
  if (state.dataOrigin && state.dataOrigin !== "search") return;
  if (!boundaries.length) {
    if (state.dataOrigin === "search") {
      clearUploadedData();
      setDataPanelVisible(false);
      applyMapLayerVisibility();
      updateDashboard();
    }
    return;
  }

  clearMetroData();
  cellPopup?.remove();
  state.dataOrigin = "search";
  state.polygonPalette = state.polygonPalette && state.polygonPalette !== "travel" ? state.polygonPalette : "diverging";
  state.resolution = CONFIG.DEFAULT_RESOLUTION;
  state.baselineCount = null;
  state.boundary = { type: "FeatureCollection", features: boundaries };
  state.sourceBoundary = state.boundary;
  state.mapType = "h3";
  state.dataProfile = analyzeSpatialData(state.boundary);
  state.pointData = EMPTY_FEATURE_COLLECTION;
  state.lineData = EMPTY_FEATURE_COLLECTION;
  $("resolution").value = CONFIG.DEFAULT_RESOLUTION;
  $("resolution-value").value = CONFIG.DEFAULT_RESOLUTION;
  $("selected-file").hidden = true;
  map.getSource("point-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("line-data")?.setData(EMPTY_FEATURE_COLLECTION);
  // Keep the selected administrative boundaries available for Polygon mode.
  // Layer visibility ensures they are only filled after the user chooses Polygon.
  map.getSource("polygon-data")?.setData(state.boundary);
  map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  renderSearchMapTypes();
  updateModelSections();
  await rebuildGrid();
  refreshClippedUploadLayers();
  applyStyle();
}

async function processSpatialFile(file) {
  if (!file) return;
  try {
    setStatus(`Đang đọc ${file.name}…`);
    const result = await readSpatialFile(file);
    if (result.kind === "metro") await replaceMetroData(result.data, file.name);
    else if (result.kind === "ai-map") await replaceAiMapData(result.records, result.recommendation, file.name);
    else if (result.kind === "chart") replaceChartData(result.analysis, file.name);
    else await replaceBoundary(result.data, file.name, result.profile);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Không thể đọc file.");
    setStatus("Không thể đọc file.", true);
  }
}

function metroPartRole(data, name = "") {
  const kinds = geometryKinds(data);
  if (isHexagonGeoJSON(data, name)) return "hexagons";
  if (kinds.includes("point") && /stations?|ga[-_ ]?/i.test(name)) return "stations";
  if (kinds.includes("line") && /(metro[-_ ]?route|route|tuyen)/i.test(name)) return "metro_route";
  return null;
}

function removeDynamicUploadLayer(id) {
  const layer = state.uploadLayers.find(item => item.id === id);
  if (!layer) return;
  for (const layerId of [...layer.layerIds].reverse()) {
    if (map?.getLayer(layerId)) map.removeLayer?.(layerId);
  }
  if (map?.getSource(layer.sourceId)) map.removeSource?.(layer.sourceId);
  state.uploadLayers = state.uploadLayers.filter(item => item.id !== id);
  scheduleUploadLayerOrder();
}

async function activateSeparateMetroData() {
  const { hexagons, stations, metro_route: route, travel_times: times } = state.metroParts;
  if (!hexagons || !times) return false;
  for (const part of [hexagons, stations, route].filter(Boolean)) removeDynamicUploadLayer(part.id);
  const data = readMetroData({
    hexagons: hexagons.data,
    boundary: EMPTY_FEATURE_COLLECTION,
    stations: stations?.data || EMPTY_FEATURE_COLLECTION,
    metro_route: route?.data || EMPTY_FEATURE_COLLECTION,
    travel_times: times.data
  });
  if (!data) return false;
  const partCount = [hexagons, stations, route, times].filter(Boolean).length;
  await replaceMetroData(data, `${partCount} lớp dữ liệu Metro`);
  state.separateMetroActive = true;
  renderUploadedFiles();
  setStatus(`Đã ghép ${partCount} file thành bản đồ Metro.`, true);
  return true;
}

function deactivateSeparateMetroData() {
  state.separateMetroActive = false;
  clearMetroData();
  state.boundary = null; state.sourceBoundary = null; state.mapType = null; state.dataProfile = null;
  map?.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("metro-station-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("line-data")?.setData(EMPTY_FEATURE_COLLECTION);
  for (const [role, part] of Object.entries(state.metroParts)) {
    if (role === "travel_times" || !part?.data) continue;
    removeDynamicUploadLayer(part.id);
    const forceRole = role === "hexagons" ? "hexagon" : role === "stations" ? "point" : "line";
    addUploadedGeoJSONLayer(part.data, part.name, { forceRole, id: part.id, register: false });
  }
  updateModelSections();
  applyMapLayerVisibility();
}

async function removeUploadedFile(id) {
  const file = state.uploadedFiles.find(item => item.id === id);
  if (!file) return;
  removeDynamicUploadLayer(id);
  let removedMetroPart = false;
  for (const [role, part] of Object.entries(state.metroParts)) {
    if (part?.id !== id) continue;
    delete state.metroParts[role];
    removedMetroPart = true;
  }
  state.uploadedFiles = state.uploadedFiles.filter(item => item.id !== id);
  if (file.fileKey) state.uploadedFileKeys.delete(file.fileKey);
  if (removedMetroPart && state.separateMetroActive) {
    const canRemainActive = state.metroParts.hexagons && state.metroParts.travel_times;
    if (canRemainActive) await activateSeparateMetroData();
    else deactivateSeparateMetroData();
  }
  if (file.role === "base") {
    state.boundary = null; state.sourceBoundary = null; state.mapType = null; state.dataProfile = null;
    map?.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION);
    map?.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
    map?.getSource("h3-grid")?.setData(EMPTY_FEATURE_COLLECTION);
    refreshClippedUploadLayers();
    updateModelSections();
    applyMapLayerVisibility();
  }
  renderUploadedFiles();
  if (!state.uploadedFiles.length) $("selected-file").hidden = true;
  setStatus(`Đã xóa lớp ${file.name}.`, true);
}

async function processSpatialFiles(files) {
  const candidates = [...(files || [])];
  if (!candidates.length) return;
  const selected = [];
  const duplicates = [];
  for (const file of candidates) {
    const key = uploadFileKey(file);
    if (state.uploadedFileKeys.has(key)) duplicates.push(file);
    else {
      state.uploadedFileKeys.add(key);
      selected.push({ file, key });
    }
  }
  if (!selected.length) {
    const message = candidates.length === 1
      ? `${candidates[0].name} đã được tải lên.`
      : `${candidates.length} file đã được tải lên trước đó.`;
    showToast(message);
    setStatus(message, true);
    return;
  }
  setStatus(`Đang đọc ${selected.length} file…`);
  const loaded = await Promise.all(selected.map(async ({ file, key }) => {
    try { return { file, key, result: await readSpatialFile(file) }; }
    catch (error) { return { file, key, error }; }
  }));
  const failures = loaded.filter(item => item.error);
  for (const failure of failures) state.uploadedFileKeys.delete(failure.key);
  for (const failure of failures) console.error(failure.file.name, failure.error);
  const valid = loaded.filter(item => !item.error);
  if (!valid.length) {
    showToast(failures[0]?.error?.message || "Không thể đọc các file đã chọn.");
    setStatus("Không thể đọc file.", true);
    return;
  }

  const metro = valid.find(item => item.result.kind === "metro");
  if (metro) {
    await replaceMetroData(metro.result.data, metro.file.name);
    if (valid.length === 1) {
      if (duplicates.length) showToast(`Đã bỏ qua file trùng: ${duplicates.map(file => file.name).join(", ")}`);
      return;
    }
  }
  const spatial = valid.filter(item => !item.result.kind && item.result.data);
  const metroParts = valid.filter(item => item.result.kind === "metro-part");
  const aiMaps = valid.filter(item => item.result.kind === "ai-map");
  const charts = valid.filter(item => item.result.kind === "chart");
  if (!spatial.length && !metroParts.length && aiMaps.length) {
    const item = aiMaps[0];
    await replaceAiMapData(item.result.records, item.result.recommendation, item.file.name);
    if (duplicates.length) showToast(`Đã bỏ qua file trùng: ${duplicates.map(file => file.name).join(", ")}`);
    return;
  }
  if (!spatial.length && !metroParts.length && charts.length) {
    replaceChartData(charts[0].result.analysis, charts[0].file.name);
    if (duplicates.length) showToast(`Đã bỏ qua file trùng: ${duplicates.map(file => file.name).join(", ")}`);
    return;
  }

  // Khi chưa có vùng làm mặt nạ, polygon thường đầu tiên trở thành lớp nền.
  // Hexagon không bao giờ tự trở thành mặt nạ của chính nó.
  const base = !state.boundary && spatial.find(item => geometryKinds(item.result.data).includes("area") && !isHexagonGeoJSON(item.result.data, item.file.name));
  if (base) {
    await replaceBoundary(base.result.data, base.file.name, base.result.profile, { preservePolygons: true });
    const id = `base-${++state.uploadLayerSequence}`;
    state.uploadedFiles.push({ id, name: base.file.name, fileKey: base.key, data: base.result.data, role: "base", detail: `${featureCount(base.result.data).toLocaleString("vi-VN")} vùng nền` });
  }

  const overlays = spatial.filter(item => item !== base);
  overlays.sort((a, b) => {
    const rank = item => isHexagonGeoJSON(item.result.data, item.file.name) ? 0 : geometryKinds(item.result.data).includes("line") ? 1 : 2;
    return rank(a) - rank(b);
  });
  for (const item of overlays) {
    const role = metroPartRole(item.result.data, item.file.name);
    const forceRole = role === "hexagons" ? "hexagon" : role === "stations" ? "point" : role === "metro_route" ? "line" : null;
    const layer = addUploadedGeoJSONLayer(item.result.data, item.file.name, { forceRole, fileKey: item.key });
    if (role) state.metroParts[role] = { id: layer.id, name: item.file.name, data: item.result.data };
  }
  for (const item of metroParts) {
    const id = `uploaded-${++state.uploadLayerSequence}`;
    state.metroParts[item.result.role] = { id, name: item.file.name, data: item.result.data };
    state.uploadedFiles.push({ id, name: item.file.name, fileKey: item.key, data: item.result.data, role: "travel_times", detail: `${item.result.data.length.toLocaleString("vi-VN")} dòng` });
  }
  refreshClippedUploadLayers();
  const metroActivated = await activateSeparateMetroData();
  renderUploadedFiles();
  const added = overlays.length + metroParts.length + (base ? 1 : 0);
  const suffix = [
    failures.length ? `${failures.length} file lỗi` : "",
    duplicates.length ? `${duplicates.length} file trùng bị bỏ qua` : ""
  ].filter(Boolean).map(text => `, ${text}`).join("");
  if (!metroActivated) setStatus(`Đã thêm ${added} lớp dữ liệu${suffix}.`, true);
  if (failures.length) showToast(`Không đọc được: ${failures.map(item => item.file.name).join(", ")}`);
  else if (duplicates.length) showToast(`Đã bỏ qua file trùng: ${duplicates.map(file => file.name).join(", ")}`);
}

function uploadFileKey(file) {
  return JSON.stringify([
    file?.name || "",
    Number.isFinite(file?.size) ? file.size : null,
    Number.isFinite(file?.lastModified) ? file.lastModified : null,
    file?.type || ""
  ]);
}

function bindFileDropZone() {
  const input = $("spatial-file");
  const dropZone = document.querySelector(".drop-zone");
  let dragDepth = 0;

  input.addEventListener("change", event => {
    const files = [...event.target.files];
    event.target.value = "";
    processSpatialFiles(files);
  });

  dropZone.addEventListener("dragenter", event => {
    event.preventDefault();
    dragDepth += 1;
    dropZone.classList.add("is-dragging");
  });
  dropZone.addEventListener("dragover", event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  dropZone.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropZone.classList.remove("is-dragging");
  });
  dropZone.addEventListener("drop", event => {
    event.preventDefault();
    dragDepth = 0;
    dropZone.classList.remove("is-dragging");
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) {
      showToast("Không tìm thấy file để tải lên.");
      return;
    }
    processSpatialFiles(files);
  });
}

function bindUI() {
  $("basemap-options").addEventListener("click", event => {
    const option = event.target.closest(".basemap-option");
    if (option) selectMapStyle(option.dataset.mapStyle);
  });
  $("ai-filter-controls").addEventListener("change", async event => {
    if (!event.target.matches(".ai-generated-filter")) return;
    const shouldFit = event.target.dataset.field === state.aiDataset?.recommendation.geometry.field;
    await filteredAiBoundary({ fit: shouldFit });
  });
  $("ai-filter-controls").addEventListener("click", event => {
    const toggle = event.target.closest(".ai-multiselect-toggle");
    if (!toggle) return;
    const menu = toggle.nextElementSibling;
    const open = menu.hidden;
    document.querySelectorAll(".ai-multiselect-menu").forEach(item => { item.hidden = true; });
    document.querySelectorAll(".ai-multiselect-toggle").forEach(item => item.setAttribute("aria-expanded", "false"));
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  $("clear-ai-data").addEventListener("click", () => {
    deleteData();
    setStatus("Đã xóa dữ liệu.", true);
  });
  $("metro-departure").addEventListener("change", updateMetroTime);
  for (const id of ["show-metro-cells", "show-metro-boundary", "show-metro-stations", "show-map-lines"]) $(id).addEventListener("change", applyMapLayerVisibility);
  $("resolution").addEventListener("input", e => $("resolution-value").value = e.target.value); $("resolution").addEventListener("change", async e => { state.resolution = Number(e.target.value); await rebuildGrid(); });
  $("opacity").addEventListener("input", e => { $("opacity-value").value = `${Math.round(e.target.value * 100)}%`; applyStyle(); }); $("line-width").addEventListener("input", e => { $("line-width-value").value = `${e.target.value} px`; applyStyle(); });
  for (const id of ["fixed-color", "border-color"]) { $(id).addEventListener("input", e => { $(`${id}-value`).textContent = e.target.value.toUpperCase(); if (id === "fixed-color" && (state.mapType === "polygon" || state.dataOrigin === "search" || state.aiDataset)) { state.polygonPalette = null; syncPolygonPaletteControls(); } applyStyle(); }); }
  $("polygon-color-ramp").addEventListener("click", event => {
    const button = event.target.closest(".palette");
    if (!button || button.disabled) return;
    state.polygonPalette = button.dataset.palette;
    syncPolygonPaletteControls();
    applyStyle();
  });
  $("show-border").addEventListener("change", applyStyle);
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab,.tab-panel").forEach(x => x.classList.remove("active")); tab.classList.add("active"); document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active"); }));
  $("map-type-grid").addEventListener("click", async event => {
    const button = event.target.closest(".map-type");
    if (!button) return;
    if (selectChartOption(button.dataset.type)) return;
    document.querySelectorAll(".map-type").forEach(x => x.classList.remove("active"));
    button.classList.add("active");
    state.mapType = button.dataset.type;
    updateModelSections();
    if (state.mapType === "h3" && state.boundary && !state.h3Data.features.length) await rebuildGrid();
    else applyStyle();
    setStatus(`Đang hiển thị kiểu ${button.dataset.label}.`, true);
  });
  bindFileDropZone();
  $("uploaded-layer-list").addEventListener("click", event => {
    const button = event.target.closest(".remove-uploaded-layer");
    if (button?.dataset.uploadId) removeUploadedFile(button.dataset.uploadId);
  });
  $("remove-current-file").addEventListener("click", () => {
    deleteData();
    setStatus("Đã xóa file dữ liệu.", true);
  });
  $("province-filter-toggle").addEventListener("click", () => {
    const menu = $("province-filter-menu"); const open = menu.hidden; menu.hidden = !open; $("province-filter-toggle").setAttribute("aria-expanded", String(open));
  });
  $("province-filter-options").addEventListener("change", () => updateProvinceFilterLabel());
  $("clear-provinces").addEventListener("click", () => { document.querySelectorAll('#province-filter-options input:checked').forEach(input => input.checked = false); updateProvinceFilterLabel([]); });
  $("apply-provinces").addEventListener("click", async () => {
    const names = selectedProvinceNames(); const toggle = $("province-filter-toggle"); state.boundary = boundaryForProvinces(state.sourceBoundary, names); state.baselineCount = null;
    map.getSource("vietnam-boundary")?.setData(state.boundary); $("file-note").textContent = names.length ? `Đang lọc: ${names.map(formatProvinceName).join(", ")}` : "Dữ liệu đã tải · đang sử dụng";
    map.getSource("polygon-data")?.setData(state.boundary);
    $("province-filter-menu").hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.disabled = true;
    try { await rebuildGrid({ fit: true }); refreshClippedUploadLayers(); } finally { toggle.disabled = false; }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("#province-filter")) { $("province-filter-menu").hidden = true; $("province-filter-toggle").setAttribute("aria-expanded", "false"); }
    if (!event.target.closest(".ai-multiselect")) {
      document.querySelectorAll(".ai-multiselect-menu").forEach(menu => { menu.hidden = true; });
      document.querySelectorAll(".ai-multiselect-toggle").forEach(toggle => toggle.setAttribute("aria-expanded", "false"));
    }
  });
  $("apply-coordinates").addEventListener("click", async () => { try { const raw = $("coordinate-input").value.trim(); let data; if (raw.startsWith("{")) data = JSON.parse(raw); else { const ring = raw.split(/\n/).map(line => line.split(",").map(Number)); if (ring.length < 3 || ring.some(p => p.length < 2 || p.some(Number.isNaN))) throw new Error("Cần ít nhất 3 dòng lng,lat."); ring.push(ring[0]); data = { type: "Polygon", coordinates: [ring] }; } await replaceBoundary(data, "Tọa độ nhập trực tiếp"); } catch (error) { showToast(error.message); } });
  for (const [toggleId, controlsId] of [["feature-toggle", "feature-controls"], ["style-toggle", "style-controls"]]) {
    $(toggleId).addEventListener("click", () => { const open = $(toggleId).getAttribute("aria-expanded") === "true"; $(toggleId).setAttribute("aria-expanded", String(!open)); $(controlsId).style.display = open ? "none" : ""; });
  }
  $("show-map-layers").addEventListener("change", e => { $("show-map-layers-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt"; applyMapLayerVisibility(); });
  $("show-weather").addEventListener("change", e => {
    $("show-weather-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt";
    if (!e.target.checked) { weatherLoadRevision += 1; cellPopup?.remove(); applyStyle(); }
    else void loadWeatherForGrid();
  });
  $("reset-config").addEventListener("click", async () => {
    try {
      await resetConfiguration();
      setStatus("Đã đặt lại cấu hình mặc định.", true);
    } catch (error) { console.error(error); setStatus("Không thể đặt lại cấu hình."); showToast(error.message); }
  });
  $("clear-data").addEventListener("click", () => {
    deleteData();
    setStatus("Đã xóa dữ liệu. Hãy upload dữ liệu để bắt đầu.", true);
  });
  $("close-data-panel").addEventListener("click", () => setDataPanelVisible(false));
  $("table-search").addEventListener("input", e => { state.query = e.target.value; state.page = 1; renderTable(); }); $("page-size").addEventListener("change", e => { state.pageSize = Number(e.target.value); state.page = 1; renderTable(); });
  $("prev-page").addEventListener("click", () => { state.page--; renderTable(); }); $("next-page").addEventListener("click", () => { state.page++; renderTable(); }); $("page-buttons").addEventListener("click", e => { if (e.target.dataset.page) { state.page = Number(e.target.dataset.page); renderTable(); } });
  $("zoom-in").addEventListener("click", () => map.zoomIn()); $("zoom-out").addEventListener("click", () => map.zoomOut()); $("fullscreen").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector(".map-panel").requestFullscreen());
  $("map-toolbar").addEventListener("click", e => { const button = e.target.closest("button"); if (!button) return; document.querySelectorAll("#map-toolbar button").forEach(x => x.classList.remove("active")); button.classList.add("active"); map.dragPan[button.dataset.tool === "select" ? "disable" : "enable"](); if (!["select", "pan"].includes(button.dataset.tool)) showToast(`Công cụ ${button.title}: giao diện đã sẵn sàng.`); });
  $("export-data").addEventListener("click", exportCSV);
}

function exportCSV() {
  const rows = [["H3 Index", "Latitude", "Longitude"], ...filteredFeatures().map(({ properties: p }) => [p.h3, p.center_lat, p.center_lng])];
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(x => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `h3-res-${state.resolution}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

async function init() {
  renderSupportedChartCatalog();
  bindUI(); syncMapStyleControls();
  map = new maplibregl.Map({ container: "map", style: MAP_STYLES[state.mapStyle], center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  createMapSearch({ map, apiKey: CONFIG.MAPTILER_API_KEY, onBoundariesChange: applySearchBoundaries });
  map.on("style.load", () => {
    const switchedStyle = pendingMapStyle;
    if (switchedStyle) state.mapStyle = switchedStyle;
    pendingMapStyle = null;
    clearTimeout(mapStyleLoadTimer);
    syncMapStyleControls(false);
    try {
      addMapLayers();
      restoreUploadedLayers();
      applyStyle();
    } catch (error) {
      console.error("Không thể phục hồi lớp dữ liệu sau khi đổi nền:", error);
      setStatus("Nền đã đổi nhưng một số lớp dữ liệu chưa thể phục hồi.", true);
    }
    if (!mapReady) {
      mapReady = true;
      setupProvinceFilter(EMPTY_FEATURE_COLLECTION);
      updateDashboard();
    } else if (switchedStyle) {
      setStatus(`Đã chuyển sang nền ${MAP_STYLE_LABELS[state.mapStyle]}.`, true);
    }
  });
  map.on("error", event => console.warn("MapLibre:", event.error?.message || event.error));
}
init();

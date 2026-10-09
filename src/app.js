import { CONFIG } from "./config.js";
import { geoJSONToCells, cellsToFeatureCollection, recordsToPointGeoJSON } from "./h3-utils.js";
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
import { polygonColorField, polygonFillExpression } from "./renderers/polygon-style.js";

const $ = id => document.getElementById(id);
const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const state = {
  resolution: CONFIG.DEFAULT_RESOLUTION, boundary: null, sourceBoundary: null, h3Data: { type: "FeatureCollection", features: [] },
  page: 1, pageSize: 10, query: "", baselineCount: null,
  mapType: null, dataProfile: null,
  pointData: { type: "FeatureCollection", features: [] },
  chartConfig: null, chartOptions: [], chartAnalysis: null, chartMapping: null, mappingWarning: "", activeChartKind: null,
  barStyle: { ...DEFAULT_BAR_CONFIG }, pieStyle: { ...DEFAULT_PIE_CONFIG }, polygonPalette: null
};
let map; let toastTimer;

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
function setStatus(message, hide = false) { const el = $("status"); el.textContent = message; el.style.display = "block"; if (hide) setTimeout(() => el.style.display = "none", 2200); }
function setDataPanelVisible(visible) { $("data-panel").hidden = !visible; document.querySelector(".content-area").classList.toggle("table-hidden", !visible); map?.resize(); }
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }

function updateModelSections() {
  const hasModel = Boolean(state.mapType);
  const isChart = Boolean(state.chartConfig);
  $("display-config-section").hidden = !hasModel || isChart || state.mapType !== "h3";
  $("chart-data-mapping-section").hidden = !isChart;
  $("feature-section").hidden = !hasModel || isChart;
  $("style-section").hidden = !hasModel || (!isChart && !["h3", "polygon"].includes(state.mapType));
  $("cell-stats-card").hidden = !hasModel || isChart || state.mapType !== "h3";
  if (!isChart) {
    const isPolygon = state.mapType === "polygon";
    $("style-description").textContent = isPolygon ? "Màu cố định, dải màu, độ mờ và đường viền" : "Màu sắc, độ mờ và đường viền";
    $("polygon-color-ramp").hidden = !isPolygon;
    $("border-color-field").hidden = isPolygon;
    $("show-border-field").hidden = false;
    $("line-width-field").hidden = false;
    if (isPolygon) syncPolygonPaletteControls();
  }
}

function fillExpression() {
  return $("fixed-color").value;
}

function syncPolygonPaletteControls() {
  const colorField = polygonColorField(state.boundary, state.dataProfile);
  $("polygon-color-field").textContent = colorField ? `Theo ${humanizeField(colorField.field)}` : "Cần thuộc tính dữ liệu";
  document.querySelectorAll("#polygon-color-ramp .palette").forEach(button => {
    button.disabled = !colorField;
    button.classList.toggle("active", button.dataset.palette === state.polygonPalette);
  });
}

function applyStyle() {
  if (!map) return;
  const color = fillExpression();
  const opacity = Number($("opacity").value);
  const borderColor = $("border-color").value;
  const borderWidth = Number($("line-width").value);
  if (map.getLayer("h3-fill")) {
    map.setPaintProperty("h3-fill", "fill-color", color);
    map.setPaintProperty("h3-fill", "fill-opacity", opacity);
    map.setPaintProperty("h3-border", "line-color", borderColor);
    map.setPaintProperty("h3-border", "line-width", borderWidth);
  }
  if (map.getLayer("polygon-fill")) {
    map.setPaintProperty("polygon-fill", "fill-color", polygonFillExpression(state.boundary, state.dataProfile, state.polygonPalette, color));
    map.setPaintProperty("polygon-fill", "fill-opacity", opacity);
    map.setPaintProperty("polygon-border", "line-color", borderColor);
    map.setPaintProperty("polygon-border", "line-width", borderWidth);
  }
  applyMapLayerVisibility();
}

function applyMapLayerVisibility() {
  if (!map) return;
  const showLayers = $("show-map-layers")?.checked ?? false;
  const showH3 = showLayers && state.mapType === "h3";
  const showPolygon = showLayers && state.mapType === "polygon";
  if (map.getLayer("h3-fill")) map.setLayoutProperty("h3-fill", "visibility", showH3 ? "visible" : "none");
  if (map.getLayer("h3-border")) map.setLayoutProperty("h3-border", "visibility", showH3 && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("point-marker")) map.setLayoutProperty("point-marker", "visibility", showLayers && state.mapType === "point" ? "visible" : "none");
  if (map.getLayer("point-circle")) map.setLayoutProperty("point-circle", "visibility", showLayers && state.mapType === "circle" ? "visible" : "none");
  if (map.getLayer("point-heatmap")) map.setLayoutProperty("point-heatmap", "visibility", showLayers && state.mapType === "heatmap" ? "visible" : "none");
  if (map.getLayer("polygon-fill")) map.setLayoutProperty("polygon-fill", "visibility", showPolygon ? "visible" : "none");
  if (map.getLayer("polygon-border")) map.setLayoutProperty("polygon-border", "visibility", showPolygon && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("vietnam-border")) map.setLayoutProperty("vietnam-border", "visibility", "visible");
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
    sourceId: "vietnam-boundary",
    fillLayerId: "polygon-fill",
    borderLayerId: "polygon-border",
    fillPaint: { "fill-color": "#389e55", "fill-opacity": .32 },
    borderPaint: { "line-color": "#00e65c", "line-width": 2 }
  });
  applyMapLayerVisibility();
  map.on("click", "h3-fill", event => {
    const p = event.features?.[0]?.properties; if (!p) return;
    new maplibregl.Popup({ offset: 8 }).setLngLat(event.lngLat).setHTML(`<div style="font:12px Inter;line-height:1.8"><b>H3:</b> ${p.h3}<br><b>Tâm ô:</b> ${fmt(Number(p.center_lat), 5)}, ${fmt(Number(p.center_lng), 5)}</div>`).addTo(map);
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

async function rebuildGrid({ fit = false } = {}) {
  if (!state.boundary) { setStatus("Hãy upload dữ liệu không gian trước."); return; }
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
    state.h3Data = cellsToFeatureCollection(cells);
    const source = map.getSource("h3-grid"); if (source) source.setData(state.h3Data);
    $("cell-count").textContent = cells.length.toLocaleString("vi-VN"); $("cell-label").textContent = `Tổng số cell (res ${state.resolution})`;
    state.page = 1; updateDashboard();
    if (fit) fitBoundary();
    setStatus(`Đã vẽ ${cells.length.toLocaleString("vi-VN")} ô H3.`, true);
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
  state.boundary = null; state.sourceBoundary = null; state.h3Data = { type: "FeatureCollection", features: [] };
  state.pointData = { type: "FeatureCollection", features: [] };
  state.mapType = null; state.dataProfile = null; state.chartConfig = null; state.chartOptions = []; state.chartAnalysis = null; state.chartMapping = null; state.mappingWarning = ""; state.baselineCount = null; state.page = 1;
  updateModelSections();
  clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  showChartStyleControls(false);
  clearDataMappingPanel($("data-mapping-controls"));
  $("map-type-grid").className = "map-type-grid is-empty"; $("map-type-grid").textContent = "Chưa có dữ liệu để phân tích.";
  $("map-type-summary").textContent = "Danh sách sẽ tự cập nhật sau khi dữ liệu được đọc.";
  $("selected-file").hidden = true; $("spatial-file").value = ""; setupProvinceFilter(EMPTY_FEATURE_COLLECTION);
  map?.getSource("h3-grid")?.setData(state.h3Data); map?.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  map?.getSource("point-data")?.setData(state.pointData);
}

async function resetConfiguration() {
  state.resolution = CONFIG.DEFAULT_RESOLUTION;
  state.barStyle = mergeBarConfig();
  state.pieStyle = mergePieConfig();
  state.polygonPalette = null;

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

async function readSpatialFile(file) {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "zip") throw new Error("ZIP/Shapefile sẽ được hỗ trợ ở phiên bản tiếp theo.");
  if (["xlsx", "xls"].includes(extension)) {
    if (!globalThis.XLSX) throw new Error("Không tải được thư viện đọc Excel. Vui lòng kiểm tra kết nối mạng.");
    const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = globalThis.XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: true });
    try {
      const data = recordsToPointGeoJSON(records);
      return { data, profile: analyzeSpatialData(data) };
    } catch {
      return { kind: "chart", analysis: analyzeBarData(records) };
    }
  }
  const text = await file.text();
  if (extension === "csv") {
    if (!globalThis.XLSX) throw new Error("Không tải được thư viện đọc CSV. Vui lòng kiểm tra kết nối mạng.");
    const workbook = globalThis.XLSX.read(text, { type: "string", raw: true });
    const records = globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true });
    try {
      const data = recordsToPointGeoJSON(records);
      return { data, profile: analyzeSpatialData(data) };
    } catch {
      return { kind: "chart", analysis: analyzeBarData(records) };
    }
  }
  const parsed = JSON.parse(text);
  if (typeof parsed?.type === "string") return { data: parsed, profile: analyzeSpatialData(parsed) };
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
  if (records) {
    try {
      const data = recordsToPointGeoJSON(records);
      return { data, profile: analyzeSpatialData(data) };
    } catch { /* Không có tọa độ: tiếp tục phân tích như dữ liệu biểu đồ. */ }
  }
  return { kind: "chart", analysis: analyzeBarData(parsed) };
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
  const primaryDataset = analysis.datasets.find(dataset => dataset.path === analysis.sourcePath) || analysis.datasets[0];
  const lineOption = createLineOption(primaryDataset, analysis.titlePrefix);
  const pieOptions = createPieOptions(primaryDataset, `Cơ cấu các chỉ số · ${analysis.titlePrefix}`);
  const options = [...analysis.options, ...(lineOption ? [lineOption] : []), ...pieOptions];
  state.chartAnalysis = { ...analysis, options }; state.chartOptions = options; state.boundary = null; state.sourceBoundary = null; state.dataProfile = null;
  state.h3Data = { type: "FeatureCollection", features: [] }; state.pointData = { type: "FeatureCollection", features: [] };
  map.getSource("h3-grid")?.setData(state.h3Data); map.getSource("point-data")?.setData(state.pointData); map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  setupProvinceFilter(EMPTY_FEATURE_COLLECTION);
  $("map-type-grid").className = "map-type-grid";
  $("map-type-grid").replaceChildren(...options.map(option => {
    const button = document.createElement("button"); const icon = document.createElement("span");
    button.type = "button"; button.className = "map-type"; button.dataset.type = option.id; button.dataset.label = option.label;
    button.title = `${option.label} · Recharts`; renderChartIcon(icon, option.icon); button.append(icon, option.label); return button;
  }));
  $("map-type-summary").textContent = `Tìm thấy ${analysis.rowCount} bản ghi tại ${analysis.sourcePath} · ${analysis.numericFields.length} trường số · ${options.length} kiểu biểu đồ phù hợp`;
  $("file-name").textContent = name; $("file-note").textContent = "Dữ liệu biểu đồ đã tải · đang sử dụng"; $("selected-file").hidden = false;
  const canvas = $("chart-canvas"); canvas.hidden = false; document.querySelector(".map-panel").classList.add("chart-mode");
  setDataPanelVisible(false); showChartStyleControls(true); selectChartOption(options[0].id);
}
async function replaceBoundary(data, name, profile = null) {
  state.chartConfig = null; state.chartOptions = []; state.chartAnalysis = null; state.chartMapping = null; state.mappingWarning = ""; clearDataMappingPanel($("data-mapping-controls")); clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  showChartStyleControls(false);
  if (!data) throw new Error("Không tìm thấy dữ liệu."); geoJSONToCells(data, Math.min(state.resolution, 3)); state.sourceBoundary = data; state.boundary = data; setupProvinceFilter(data);
  renderCompatibleMapTypes(data, profile || analyzeSpatialData(data));
  state.pointData = pointFeatureCollection(data); map.getSource("point-data")?.setData(state.pointData); applyPointStyle();
  map.getSource("vietnam-boundary")?.setData(data); $("file-name").textContent = name; $("file-note").textContent = "Dữ liệu đã tải · đang sử dụng"; $("selected-file").hidden = false; state.baselineCount = null; await rebuildGrid({ fit: true }); applyStyle();
}

async function processSpatialFile(file) {
  if (!file) return;
  try {
    setStatus(`Đang đọc ${file.name}…`);
    const result = await readSpatialFile(file);
    if (result.kind === "chart") replaceChartData(result.analysis, file.name);
    else await replaceBoundary(result.data, file.name, result.profile);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Không thể đọc file.");
    setStatus("Không thể đọc file.", true);
  }
}

function bindFileDropZone() {
  const input = $("spatial-file");
  const dropZone = document.querySelector(".drop-zone");
  let dragDepth = 0;

  input.addEventListener("change", event => processSpatialFile(event.target.files?.[0]));

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
    if (files.length > 1) showToast("Chỉ có thể tải một file mỗi lần; đang đọc file đầu tiên.");
    processSpatialFile(files[0]);
  });
}

function bindUI() {
  $("resolution").addEventListener("input", e => $("resolution-value").value = e.target.value); $("resolution").addEventListener("change", async e => { state.resolution = Number(e.target.value); await rebuildGrid(); });
  $("opacity").addEventListener("input", e => { $("opacity-value").value = `${Math.round(e.target.value * 100)}%`; applyStyle(); }); $("line-width").addEventListener("input", e => { $("line-width-value").value = `${e.target.value} px`; applyStyle(); });
  for (const id of ["fixed-color", "border-color"]) { $(id).addEventListener("input", e => { $(`${id}-value`).textContent = e.target.value.toUpperCase(); if (id === "fixed-color" && state.mapType === "polygon") { state.polygonPalette = null; syncPolygonPaletteControls(); } applyStyle(); }); }
  $("polygon-color-ramp").addEventListener("click", event => {
    const button = event.target.closest(".palette");
    if (!button || button.disabled) return;
    state.polygonPalette = button.dataset.palette;
    syncPolygonPaletteControls();
    applyStyle();
  });
  $("show-border").addEventListener("change", applyStyle);
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab,.tab-panel").forEach(x => x.classList.remove("active")); tab.classList.add("active"); document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active"); }));
  $("map-type-grid").addEventListener("click", event => { const button = event.target.closest(".map-type"); if (!button) return; if (selectChartOption(button.dataset.type)) return; document.querySelectorAll(".map-type").forEach(x => x.classList.remove("active")); button.classList.add("active"); state.mapType = button.dataset.type; updateModelSections(); applyStyle(); setStatus(`Đang hiển thị kiểu ${button.dataset.label}.`, true); });
  bindFileDropZone();
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
  bindUI(); map = new maplibregl.Map({ container: "map", style: "https://tiles.openfreemap.org/styles/dark", center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  map.once("style.load", () => { addMapLayers(); setupProvinceFilter(EMPTY_FEATURE_COLLECTION); updateDashboard(); setStatus("Hãy upload dữ liệu không gian để bắt đầu."); });
  map.on("error", event => console.warn("MapLibre:", event.error?.message || event.error));
}
init();

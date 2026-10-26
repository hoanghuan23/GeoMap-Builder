import { jsonDatasets } from "./json-datasets.js";
import { startMapWorkspace } from "./map-workspace-ui.js";
import { nativeMapDataset, nativeMapView } from "./native-map-data.js";
import { CONFIG } from "./config.js";
import { geoJSONToCells, geoJSONToH3FeatureCollection, recordsToAggregatedH3, recordsToPointGeoJSON } from "./h3-utils.js";
import { buildRegionHexGrid } from "./region-hex-grid.js";
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
import { BAR_COLORS, dataForBarMapping, defaultMetricSelection, humanizeField, reconcileSeriesColors, seriesFromFields, validateBarMapping } from "./charts/data-transformers.js";
import { renderChartIcon } from "./charts/chart-icons.js";
import { renderMapIcon } from "./renderers/map-icons.js";
import { PointRenderer } from "./renderers/point-renderer.js";
import { buildPointView, createPointModel, DEFAULT_POINT_STYLE, mergePointStyle, normalizePointSelection, pointPaint, POINT_DEFAULT_GROUPS, POINT_GROUP_LIMIT } from "./renderers/point-style.js";
import { PolygonRenderer } from "./renderers/polygon-renderer.js";
import { polygonColorField, polygonFillExpression, polygonLegendScale } from "./renderers/polygon-style.js";
import { categoryColorProperties, featureCategoryValues } from "./categorical-color.js";
import { polygonLegendLabels, resolvePolygonLegendConfig } from "./polygon-legend.js";
import { polygonLegendKey, polygonLegendTarget } from "./polygon-legend-contract.js";
import { createMapSearch, focusMapOnFeature, landOnlyBoundary } from "./map-search.js";
import { administrativeBoundaryLabel, loadAdministrativeBoundaries } from "./administrative-boundaries.js";
import { clipGeoJSONToPolygon, featureCount, geometryKinds, pointGeoJSONToRecords } from "./geojson-layers.js";
import { comparableFilterValue, displayFilterValue, requestAiDataAnalysis } from "./ai-data-analysis.js";
import { keepSelectOpenAfterMouseClick } from "./select-control.js";
import { createAiPopupContent } from "./ai-popup.js";
import { administrativeContextFields, geographicLocationName, applyPipelineFilters, barMetricOptions, chartOptionForSuggestion, defaultBarLimit, defaultBarMetrics, defaultTimeFilter, normalizeBarSelection, prepareSuggestions, resolveAggregation, withSuggestionMetric } from "./ai-chart-pipeline.js";
import { compareTimeValues, filterTimeRange, formatTimeValue, timeValueInfo, uniqueTimeValues } from "./time-values.js";
import { AI_CHART_REGISTRY } from "./ai-chart-contract.js";
import { buildPopupChart, createPopupChartSelection, mapDisplaySuggestions, popupChartColumns, popupDisplayOptions, popupFeaturesMatch, popupRegionRecords, popupTimeColumn } from "./ai-popup-chart.js";
import { parseSpreadsheetFile, profileRecordsInWorker } from "./tabular-worker-client.js";
import { collapseCountryFeatures, joinRecordsToMapTilerBoundaries } from "./vietnam-admin-data.js";
import { deterministicLayerOrder, mapLayerIdsInOrder, requestAiLayerOrder } from "./layer-order.js";
import { joinRoadRecordsByArea, roadAreaField, ROAD_NETWORKS, roadMapStyle, roadNetworksFromRecords, roadValueColumns } from "./road-map-data.js";
import { roadNetworkUrl } from "./road-network-assets.js";
import { buildCoordinateLines, isCoordinateLine, pointTitleField } from "./coordinate-data.js";

const EMPTY_FEATURE_COLLECTION = Object.freeze({ type: "FeatureCollection", features: [] });
const DEFAULT_ROAD_DISPLAY_STYLE = Object.freeze({ width: 3, opacity: 1, showLegend: true });
const MAP_STYLES = Object.freeze({
  map4d: {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      "iotlink-map4d": {
        type: "raster",
        tiles: ["https://rtile.map4d.vn/all/2d/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: '<a href="https://map4d.vn/">© Map4D · IOTLink</a>'
      }
    },
    layers: [
      { id: "map4d-background", type: "background", paint: { "background-color": "#91d6e9" } },
      { id: "map4d-basemap", type: "raster", source: "iotlink-map4d" }
    ]
  },
  satellite: {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      "esri-imagery": {
        type: "raster",
        tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
      },
      "esri-labels": {
        type: "raster",
        tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community"
      }
    },
    layers: [
      { id: "satellite-background", type: "background", paint: { "background-color": "#172b3d" } },
      { id: "satellite-imagery", type: "raster", source: "esri-imagery" },
      { id: "satellite-labels", type: "raster", source: "esri-labels" }
    ]
  },
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  dark: "https://tiles.openfreemap.org/styles/dark"
});
const MAP_STYLE_LABELS = Object.freeze({ map4d: "Map4D · IOTLink", satellite: "Vệ tinh", liberty: "Liberty", bright: "Sáng", dark: "Tối" });
const SUPPORTED_VIEW_TYPES = Object.freeze([
  { label: "Bản đồ Polygon", icon: "polygon", kind: "map" },
  { label: "Bản đồ Line", icon: "line", kind: "map" },
  { label: "Bản đồ Point", icon: "point", kind: "map" }
]);

function renderSupportedMapCatalog(document) {
  const grid = document.getElementById("supported-chart-grid");
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

export function createMapLayerRuntime(options) {
const document = options.document;
const maplibregl = options.maplibregl || globalThis.maplibregl;
const $ = id => document.getElementById(id);
const controlId = control => control.dataset?.controlId || control.id;
const state = {
  resolution: CONFIG.DEFAULT_RESOLUTION, boundary: null, sourceBoundary: null, h3Data: { type: "FeatureCollection", features: [] },
  page: 1, pageSize: 10, query: "", baselineCount: null,
  mapType: null, dataProfile: null,
  regionHexEnabled: false, regionHexResolution: CONFIG.DEFAULT_RESOLUTION,
  pointData: { type: "FeatureCollection", features: [] },
  chartConfig: null, chartOptions: [], chartAnalysis: null, chartMapping: null, mappingWarning: "", activeChartKind: null,
  barStyle: { ...DEFAULT_BAR_CONFIG }, pieStyle: { ...DEFAULT_PIE_CONFIG }, pointStyle: { ...DEFAULT_POINT_STYLE },
  roadDisplayStyle: { ...DEFAULT_ROAD_DISPLAY_STYLE }, polygonPalette: null,
  lineData: EMPTY_FEATURE_COLLECTION,
  dataOrigin: null,
  uploadLayers: [], uploadedFiles: [], uploadedFileKeys: new Set(), uploadLayerSequence: 0, primaryUploadId: null,
  aiDataset: null, pendingSheet: null,
  mapStyle: "liberty"
};
let map; let mapSearch; let toastTimer; let statusTimer; let cellPopup; let pointPopup; let layerOrderTimer; let tabularAbortController; let aiBoundaryAbortController;
let mapPopupView = null;
let layerOrderRevision = 0;
let mapLayerEventsBound = false;
const uploadedPointerLayerIds = new Set();
let mapReady = false;
let pendingMapStyle = null;
let mapStyleLoadTimer = null;
let tabularLoadRevision = 0;
let aiBoundaryRevision = 0;
let dataSearchProfile;
let dataSearchColumns = [];
let mapMetricControlView = null;

function createAbortController() {
  return typeof AbortController === "function" ? new AbortController() : { signal: undefined, abort() {} };
}

function cancelAiBoundaryLoad() {
  aiBoundaryAbortController?.abort();
  aiBoundaryAbortController = null;
  aiBoundaryRevision += 1;
}

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
function setStatus(message, hide = false) {
  if (options.onStatus) { options.onStatus(message, hide); return; }
  const el = $("status");
  clearTimeout(statusTimer);
  el.textContent = message;
  el.hidden = false;
  if (hide) statusTimer = setTimeout(() => { el.hidden = true; }, 2200);
}
function setDataPanelVisible(visible) { $("data-panel").hidden = !visible; document.querySelector(".content-area").classList.toggle("table-hidden", !visible); map?.resize(); }
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }

function renderSupportedChartCatalog() {
  renderSupportedMapCatalog(document);
}

function showSupportedChartCatalog(visible) {
  $("supported-chart-catalog").hidden = !visible;
}

function isRegionHexMode() {
  return state.mapType === "polygon" && state.regionHexEnabled;
}

function syncRegionHexControls() {
  $("show-region-hex").checked = state.regionHexEnabled;
  $("region-hex-resolution-control").hidden = !state.regionHexEnabled;
  $("region-hex-resolution").disabled = !state.regionHexEnabled;
  $("region-hex-resolution").value = state.regionHexResolution;
  $("region-hex-resolution-value").value = state.regionHexResolution;
}

function updateModelSections() {
  const hasModel = Boolean(state.mapType);
  const isChart = Boolean(state.chartConfig);
  const isPoint = !isChart && state.mapType === "point";
  const isRoad = Boolean(activeRoadSuggestion());
  $("line-toggle-field").hidden = isChart || isRoad || !state.lineData.features.length;
  $("line-toggle-label").textContent = activeRoadSuggestion() ? "Hiển thị tuyến đường" : "Hiển thị đường nối giữa các điểm";
  $("chart-data-mapping-section").hidden = !isChart || !state.chartMapping;
  $("resolution-section").hidden = !hasModel || isChart || state.mapType !== "h3";
  $("feature-section").hidden = !hasModel || isChart;
  $("region-hex-controls").hidden = isChart || state.mapType !== "polygon";
  syncRegionHexControls();
  $("style-section").hidden = !hasModel || (!isChart && !["h3", "polygon", "point"].includes(state.mapType) && !isRoad);
  $("map-style-controls").hidden = isChart || isPoint || isRoad;
  $("point-style-controls").hidden = !isPoint;
  $("road-style-controls").hidden = !isRoad;
  $("cell-stats-card").hidden = !hasModel || isChart || state.mapType !== "h3";
  const activeAiSuggestion = state.aiDataset?.suggestions?.find(item => item.id === state.aiDataset.selectedSuggestionId);
  $("ai-filter-description").textContent = activePointSuggestion()
    ? "Chọn chỉ số, nhóm điểm và thời gian hiển thị"
    : activeMapPopupSuggestion()
    ? "Chọn cách hiển thị và chỉ số dữ liệu"
    : activeAiSuggestion?.chartType === "bar"
      ? "Chọn cách hiển thị và chỉ số dữ liệu"
      : "Chọn chỉ số, nhóm dữ liệu và khoảng thời gian";
  if (!isChart) {
    const isPolygon = state.mapType === "polygon";
    const isAiThematic = Boolean(state.aiDataset) && ["h3", "polygon"].includes(state.mapType);
    $("style-description").textContent = isRoad ? "Màu sắc, độ dày, độ mờ và chú giải tuyến" : isPoint ? "Kích thước, màu sắc, độ mờ, đường viền và chú giải" : isPolygon ? "Màu cố định, dải màu, độ mờ và đường viền" : "Màu sắc, độ mờ và đường viền";
    $("polygon-color-ramp").hidden = !isPolygon && !isAiThematic;
    $("border-color-field").hidden = isPolygon;
    $("show-border-field").hidden = false;
    $("line-width-field").hidden = false;
    if (isPolygon || isAiThematic) syncPolygonPaletteControls();
  }
  if (isPoint) renderPointStyleControls();
  if (isRoad) renderRoadStyleControls();
  renderPointLegend();
  renderRoadLegend();
  if (!activePointSuggestion()) { pointPopup?.remove(); pointPopup = null; }
  if (!activeMapPopupSuggestion()) closeMapPopup();
  syncDataSearch();
  renderMapMetricControls();
}

function fillExpression() {
  return $("fixed-color").value;
}

function usesDefaultPolygonColor() {
  const suggestion = activePolygonSuggestion();
  return Boolean(suggestion) && !suggestion.bindings.value;
}

function usesCategoricalPolygonColor() {
  const field = activePolygonSuggestion()?.bindings.value;
  return Boolean(field) && state.aiDataset.analysis.columns.some(column => column.name === field && column.role === "category");
}

function activePolygonLegendScale() {
  const suggestion = activePolygonSuggestion();
  if (!suggestion?.bindings.value || state.mapType !== "polygon") return null;
  const dataset = state.aiDataset; const columns = dataset.analysis.columns;
  const cache = dataset.polygonLegendScaleCache ||= { resolved: null, logged: new Set() };
  const column = columns.find(item => item.name === suggestion.bindings.value);
  const aggregation = resolveAggregation(suggestion, columns);
  const key = polygonLegendKey(polygonLegendTarget(column, aggregation));
  const cached = cache.resolved;
  if (cached && cached.data === state.boundary && cached.key === key
    && cached.columnLegend === column?.legend && cached.suggestionLegend === suggestion.legend && cached.title === column?.labelVi) return cached.scale;
  const scale = resolvePolygonLegendConfig({ suggestion, columnMetadata: columns, aggregatedFeatures: state.boundary,
    aggregation,
    onFallback: ({ code, reason }) => {
      const logKey = `${key}:${code}`;
      if (cache.logged.has(logKey)) return;
      cache.logged.add(logKey); console.debug("Polygon legend fallback", { code, field: suggestion.bindings.value, aggregation, reason });
    } });
  cache.resolved = { data: state.boundary, key, columnLegend: column?.legend,
    suggestionLegend: suggestion.legend, title: column?.labelVi, scale };
  return scale;
}

function syncPolygonPaletteControls(resolvedScale = activePolygonLegendScale()) {
  const thematicData = state.mapType === "h3" ? state.h3Data : state.boundary;
  const fixed = usesDefaultPolygonColor();
  const colorField = fixed ? null : resolvedScale ? { field: resolvedScale.field } : polygonColorField(thematicData, state.dataProfile);
  const managed = Boolean(resolvedScale);
  $("fixed-color").disabled = managed;
  $("polygon-color-label").textContent = fixed ? "Màu mặc định" : managed ? "Chú giải màu" : "Dải màu";
  $("polygon-palette-options").hidden = managed || fixed;
  $("polygon-palette-help").hidden = managed || fixed;
  const summary = $("polygon-legend-summary");
  summary.hidden = !managed;
  if (managed) {
    const status = !resolvedScale.hasData ? "Không có dữ liệu"
      : resolvedScale.source === "ai" ? "Chú giải do AI đề xuất" : "Chú giải dự phòng";
    summary.textContent = `${resolvedScale.title}${resolvedScale.unit ? ` (${resolvedScale.unit})` : ""} · ${status}`;
    summary.style.setProperty("--legend-gradient", resolvedScale.gradient || resolvedScale.noDataColor);
    summary.title = resolvedScale.reason;
  }
  $("polygon-color-field").textContent = fixed ? "Màu mặc định" : colorField ? `Theo ${humanizeField(colorField.field)}` : "Cần thuộc tính dữ liệu";
  document.querySelectorAll("#polygon-color-ramp .palette").forEach(button => {
    button.disabled = managed || !colorField;
    button.classList.toggle("active", !managed && button.dataset.palette === state.polygonPalette);
  });
}

function renderWeatherLegend(resolvedScale = activePolygonLegendScale()) {
  const legend = $("weather-legend");
  const isAiMap = Boolean(state.aiDataset) && ["h3", "polygon"].includes(state.mapType);
  const show = $("show-map-layers").checked && isAiMap && !usesDefaultPolygonColor();
  legend.hidden = !show;
  if (!show) return;
  const mode = $("weather-legend-mode");
  mode.hidden = !resolvedScale;
  const data = state.mapType === "h3" ? state.h3Data : state.boundary;
  const scale = polygonLegendScale(data, state.dataProfile, state.polygonPalette, resolvedScale);
  if (!scale) { legend.hidden = true; return; }
  const categorical = scale.type === "categorical";
  $("weather-legend-labels").classList.toggle("positioned", Boolean(resolvedScale) && !categorical);
  $("weather-legend-labels").classList.toggle("categorical", categorical);
  $("weather-legend-scale").hidden = categorical;
  const metric = state.aiDataset.recommendation.metricField;
  const column = state.aiDataset.analysis.columns.find(item => item.name === metric);
  const unit = resolvedScale ? scale.unit : column?.unit || "";
  const title = resolvedScale ? scale.title : column?.labelVi || metric;
  $("weather-legend-title").textContent = `${title}${unit && !title.includes(unit) ? ` (${unit})` : ""}`;
  mode.textContent = categorical ? "Theo phân loại" : scale.source === "technical-fallback" ? "Chú giải dự phòng"
    : scale.mode === "semantic" ? "Theo ngữ nghĩa" : "Theo dữ liệu";
  mode.title = scale.reason || "";
  if (categorical) renderCategoricalPolygonLegend(scale);
  else {
    $("weather-legend-scale").style.background = scale.gradient;
    const labels = resolvedScale ? polygonLegendLabels(scale, Math.max(100, (legend.clientWidth || 330) - 40))
      : scale.values.map(value => ({ value, text: Number(value.toFixed(1)).toLocaleString("vi-VN") }));
    $("weather-legend-scale").replaceChildren(...labels.filter(item => item.position != null).map(item => {
      const tick = document.createElement("i");
      tick.className = "polygon-legend-tick";
      tick.style.left = `${item.position}%`;
      return tick;
    }));
    $("weather-legend-labels").style.height = resolvedScale ? `${(Math.max(0, ...labels.map(item => item.row)) + 1) * 14}px` : "";
    $("weather-legend-labels").replaceChildren(...labels.map(item => {
      const label = document.createElement("span");
      label.textContent = item.text;
      if (item.position != null) {
        label.style.left = item.offset ? `calc(${item.position}% + ${item.offset}px)` : `${item.position}%`;
        label.style.top = `${item.row * 14}px`;
      }
      return label;
    }));
  }
  const time = state.aiDataset.analysis.columns.find(item => item.role === "time");
  const period = time && state.aiDataset.filters?.[time.name] ? formatTimeValue(state.aiDataset.filters[time.name], time) : "";
  $("weather-legend-note").textContent = [period,
    categorical && scale.mixed.some(entry => !entry.color) ? "Chưa có màu AI cho một số tổ hợp phân loại." : "",
    categorical && scale.unmappedValues.length ? `Chưa có màu AI cho: ${scale.unmappedValues.join(", ")}.` : "",
    isRegionHexMode() ? `Dữ liệu tải lên · H3 res ${state.regionHexResolution}` : state.mapType === "h3" ? `Dữ liệu tải lên · H3 res ${state.resolution}` : "Dữ liệu tải lên · Polygon"].filter(Boolean).join(" · ");
}

function renderCategoricalPolygonLegend(scale) {
  const rows = [...scale.entries.map(entry => ({ label: entry.value, background: entry.color, count: entry.count })),
    ...scale.mixed.map(entry => {
      const values = entry.values;
      return { label: `Bao gồm ${values.slice(0, -1).join(", ")} và ${values.at(-1)}${entry.color ? "" : " (chưa có màu AI)"}`,
        background: entry.color || scale.noDataColor, count: entry.count, mixed: true };
    })];
  $("weather-legend-labels").style.height = "";
  $("weather-legend-labels").replaceChildren(...rows.map(item => {
    const row = document.createElement("div"); row.className = "categorical-legend-row";
    if (item.mixed) row.className += " categorical-legend-mixed";
    const swatch = document.createElement("i"); swatch.style.background = item.background; swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.textContent = item.label;
    const count = document.createElement("b"); count.textContent = String(item.count);
    row.append(swatch, label, count); return row;
  }));
}

function applyStyle() {
  syncDataSearch();
  if (!map) return;
  const resolvedScale = activePolygonLegendScale();
  if (resolvedScale) syncPolygonPaletteControls(resolvedScale);
  else {
    $("fixed-color").disabled = false;
    $("polygon-legend-summary").hidden = true;
  }
  const color = fillExpression();
  const opacity = Number($("opacity").value);
  const borderColor = $("border-color").value;
  const borderWidth = Number($("line-width").value);
  if (map.getLayer("h3-fill")) {
    const h3Color = !usesDefaultPolygonColor() && (state.aiDataset || isRegionHexMode())
      ? polygonFillExpression(isRegionHexMode() ? state.boundary : state.h3Data, state.dataProfile, state.polygonPalette, color, resolvedScale)
      : color;
    map.setPaintProperty("h3-fill", "fill-color", h3Color);
    map.setPaintProperty("h3-fill", "fill-opacity", opacity);
    map.setPaintProperty("h3-border", "line-color", borderColor);
    map.setPaintProperty("h3-border", "line-width", borderWidth);
  }
  if (map.getLayer("polygon-fill")) {
    map.setPaintProperty("polygon-fill", "fill-color", usesDefaultPolygonColor() ? color
      : polygonFillExpression(state.boundary, state.dataProfile, state.polygonPalette, color, resolvedScale));
    map.setPaintProperty("polygon-fill", "fill-opacity", opacity);
    map.setPaintProperty("polygon-border", "line-color", borderColor);
    map.setPaintProperty("polygon-border", "line-width", borderWidth);
  }
  if (map.getLayer("data-lines")) {
    map.setPaintProperty("data-lines", "line-color", activeRoadSuggestion() ? state.aiDataset.roadStyle?.color || "#94a3b8" : "#c52e64");
    map.setPaintProperty("data-lines", "line-width", activeRoadSuggestion() ? state.roadDisplayStyle.width : 3);
    map.setPaintProperty("data-lines", "line-opacity", activeRoadSuggestion() ? state.roadDisplayStyle.opacity : 1);
  }
  if (map.getLayer("point-marker")) {
    const view = activePointSuggestion() ? state.aiDataset.activePointView : null;
    for (const [property, value] of Object.entries(view?.paint || pointPaint(state.pointStyle))) map.setPaintProperty("point-marker", property, value);
  }
  applyMapLayerVisibility(resolvedScale);
  options.onChange?.();
}

function applyMapLayerVisibility(resolvedScale = activePolygonLegendScale()) {
  if (!map) return;
  const showLayers = $("show-map-layers")?.checked ?? false;
  if (!showLayers) closeMapPopup();
  const showH3 = showLayers && (state.mapType === "h3" || isRegionHexMode());
  const showPolygon = showLayers && state.mapType === "polygon" && !isRegionHexMode();
  if (map.getLayer("h3-fill")) map.setLayoutProperty("h3-fill", "visibility", showH3 ? "visible" : "none");
  if (map.getLayer("h3-border")) map.setLayoutProperty("h3-border", "visibility", showH3 && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("point-marker")) map.setLayoutProperty("point-marker", "visibility", showLayers && state.mapType === "point" ? "visible" : "none");
  if (map.getLayer("point-heatmap")) map.setLayoutProperty("point-heatmap", "visibility", showLayers && state.mapType === "heatmap" ? "visible" : "none");
  if (map.getLayer("polygon-fill")) map.setLayoutProperty("polygon-fill", "visibility", showPolygon ? "visible" : "none");
  if (map.getLayer("polygon-border")) map.setLayoutProperty("polygon-border", "visibility", showPolygon && $("show-border").checked ? "visible" : "none");
  if (map.getLayer("vietnam-border")) map.setLayoutProperty("vietnam-border", "visibility", showLayers && !isRegionHexMode() ? "visible" : "none");
  const showDataLines = activeRoadSuggestion() ? true : $("show-map-lines").checked;
  if (map.getLayer("data-lines")) map.setLayoutProperty("data-lines", "visibility", showLayers && showDataLines && state.mapType === "line" ? "visible" : "none");
  for (const layer of state.uploadLayers) {
    for (const layerId of layer.layerIds || []) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", showLayers ? "visible" : "none");
    }
  }
  if (!showH3 && !showPolygon) cellPopup?.remove();
  renderWeatherLegend(resolvedScale);
  renderPointLegend();
  renderRoadLegend();
  if (state.mapType !== "point" || !showLayers) { pointPopup?.remove(); pointPopup = null; }
  options.onChange?.();
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
  PointRenderer.render(map, state.pointData, {
    sourceId: "point-data",
    layerId: "point-marker",
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 6, 16, 10] }
  });
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
  applyMapLayerVisibility();
  if (mapLayerEventsBound) return;
  mapLayerEventsBound = true;
  map.on("click", "polygon-fill", event => {
    if (state.aiDataset) showAiPolygonDetails(event);
    else if (event.features?.[0]) showUploadedFeaturePopup(event.features[0], { name: state.fileName || "Vùng dữ liệu", role: "area" }, event.lngLat);
  });
  map.on("click", "data-lines", event => {
    const suggestion = activeRoadSuggestion(); const feature = event.features?.[0];
    if (!feature) return;
    if (!suggestion) { showUploadedFeaturePopup(feature, { name: state.fileName || "Tuyến dữ liệu", role: "line" }, event.lngLat); return; }
    openMapPopup(feature, event.lngLat, "data-lines");
  });
  for (const id of ["polygon-fill", "data-lines"]) {
    map.on("mouseenter", id, () => { if (state.aiDataset) map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => map.getCanvas().style.cursor = "");
  }
  map.on("click", "h3-fill", event => {
    const p = event.features?.[0]?.properties; if (!p) return;
    const feature = state.h3Data.features.find(cell => cell.properties.h3 === p.h3) || event.features[0];
    if (activePolygonSuggestion() && isRegionHexMode()) {
      openMapPopup(feature, event.lngLat, "h3-fill");
      return;
    }
    if (state.aiDataset) {
      const popup = new maplibregl.Popup({ offset: 12, maxWidth: "360px", className: "ai-weather-popup" })
        .setDOMContent(aiWeatherPopupContent(feature));
      openCellPopup(popup, feature, "h3-fill");
      return;
    }
    openCellPopup(new maplibregl.Popup({ offset: 8 }).setHTML(`<div style="font:12px Inter;line-height:1.8"><b>H3:</b> ${p.h3}<br><b>Tâm ô:</b> ${fmt(Number(p.center_lat), 5)}, ${fmt(Number(p.center_lng), 5)}</div>`), feature, "h3-fill");
  });
  map.on("mouseenter", "h3-fill", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "h3-fill", () => map.getCanvas().style.cursor = "");
  map.on("click", "point-marker", event => {
    const feature = event.features?.[0]; if (!feature) return;
    const activeSuggestion = state.aiDataset?.suggestions?.find(item => item.id === state.aiDataset.selectedSuggestionId);
    if (activeSuggestion?.chartType === "point") {
      openMapPopup(feature, event.lngLat, "point-marker");
      return;
    }
    showUploadedFeaturePopup(feature, { name: state.fileName || "Điểm dữ liệu", role: "point" }, event.lngLat || feature.geometry.coordinates);
  });
  map.on("mouseenter", "point-marker", () => map.getCanvas().style.cursor = "pointer"); map.on("mouseleave", "point-marker", () => map.getCanvas().style.cursor = "");
  map.on("click", event => {
    const layerIds = state.uploadLayers.flatMap(layer => layer.layerIds || []).filter(id => map.getLayer(id));
    if (!layerIds.length) return;
    const rendered = map.queryRenderedFeatures(event.point, { layers: layerIds });
    const feature = rendered[0];
    if (!feature) return;
    const uploadLayer = state.uploadLayers.find(layer => layer.layerIds?.includes(feature.layer?.id));
    showUploadedFeaturePopup(feature, uploadLayer, event.lngLat);
  });
}

function bindUploadedLayerPointer(layerId) {
  if (uploadedPointerLayerIds.has(layerId)) return;
  uploadedPointerLayerIds.add(layerId);
  map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
}

function showUploadedFeaturePopup(feature, uploadLayer, lngLat) {
  const properties = feature.properties || {};
  const card = document.createElement("div");
  card.className = "data-feature-popup";
  const title = document.createElement("strong");
  title.textContent = uploadLayer?.name || "Đối tượng dữ liệu";
  card.append(title);
  const details = Object.entries(properties).filter(([name, value]) => !name.startsWith("__") && value != null);
  if (details.length) {
    const list = document.createElement("dl");
    for (const [label, value] of details) {
      const row = document.createElement("div");
      const term = document.createElement("dt"); term.textContent = label;
      const description = document.createElement("dd"); description.textContent = String(value);
      row.append(term, description); list.append(row);
    }
    card.append(list);
  }
  new maplibregl.Popup({ offset: 9, maxWidth: "330px" }).setLngLat(lngLat).setDOMContent(card).addTo(map);
}

function addUploadedLayerToMap(layer) {
  const kinds = geometryKinds(layer.data);
  map.addSource(layer.sourceId, { type: "geojson", data: layer.data });
  layer.layerIds = [];
  if (kinds.includes("area")) {
    const fillId = `${layer.id}-fill`; const borderId = `${layer.id}-border`;
    map.addLayer({ id: fillId, type: "fill", source: layer.sourceId, paint: { "fill-color": "#8b5cf6", "fill-opacity": .3 } });
    map.addLayer({ id: borderId, type: "line", source: layer.sourceId, paint: { "line-color": "#c4b5fd", "line-width": 1.5 } });
    layer.layerIds.push(fillId, borderId);
  }
  if (kinds.includes("line")) {
    const lineId = `${layer.id}-line`;
    map.addLayer({ id: lineId, type: "line", source: layer.sourceId, paint: { "line-color": "#f43f5e", "line-width": 3 } });
    layer.layerIds.push(lineId);
  }
  if (kinds.includes("point")) {
    const pointId = `${layer.id}-point`;
    map.addLayer({ id: pointId, type: "circle", source: layer.sourceId, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 5.5, 15, 8], "circle-color": "#f43f5e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.25, "circle-opacity": .9 } });
    layer.layerIds.push(pointId);
  }
  layer.layerIds.forEach(bindUploadedLayerPointer);
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

function registerPrimaryUpload(file, { role = "primary", data = null, detail = "" } = {}) {
  const previous = state.uploadedFiles.find(item => item.id === state.primaryUploadId);
  if (previous?.fileKey) state.uploadedFileKeys.delete(previous.fileKey);
  state.uploadedFiles = state.uploadedFiles.filter(item => item.id !== state.primaryUploadId);
  const id = `primary-${++state.uploadLayerSequence}`;
  const fileKey = uploadFileKey(file);
  state.primaryUploadId = id;
  state.uploadedFileKeys.add(fileKey);
  state.uploadedFiles.unshift({ id, name: file.name, fileKey, role, data, detail });
}

function setCurrentFileNote(note) {
  const file = state.uploadedFiles.find(item => item.id === state.primaryUploadId);
  if (file) {
    file.detail = note;
    renderUploadedFiles();
  } else $("file-note").textContent = note;
}

function showCurrentFile(name, note) {
  $("file-name").textContent = name;
  $("remove-current-file").hidden = state.uploadedFiles.length > 0;
  $("selected-file").hidden = false;
  setCurrentFileNote(note);
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
    name.title = file.name;
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
  $("file-name").textContent = `${state.uploadedFiles.length} tệp dữ liệu`;
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
  mapSearch?.refreshHighlight();
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
  state.primaryUploadId = null;
  state.uploadedFileKeys.clear();
  state.uploadLayerSequence = 0;
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
  const role = forceRole || (kinds.length === 1 ? kinds[0] : "mixed");
  const sequence = ++state.uploadLayerSequence;
  const id = requestedId || `uploaded-${sequence}`;
  const sourceId = `${id}-source`;
  const layer = {
    id, name, role, sourceId, layerIds: [], originalData: data, data,
    featureCount: featureCount(data)
  };
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
    loading ? "Đang chuyển nền: " : "Nền đang dùng: ",
    Object.assign(document.createElement("b"), { textContent: MAP_STYLE_LABELS[selectedStyle] })
  );
  // Keep attribution tied to the loaded style while another style is loading.
  $("satellite-attribution").hidden = state.mapStyle !== "satellite";
  $("map4d-attribution").hidden = state.mapStyle !== "map4d";
  $("vector-attribution").hidden = !["liberty", "bright", "dark"].includes(state.mapStyle);
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

function aiWeatherPopupContent(feature) {
  const { recommendation } = state.aiDataset;
  const columns = state.aiDataset.analysis?.columns || [];
  const scale = activePolygonLegendScale();
  const displayedColumns = columns.filter(column => !column.name.startsWith("__")).map(column => {
    if (column.name === scale?.field) return { ...column, unit: scale.unit,
      labelVi: scale.aggregation === "count" ? "Số bản ghi" : column.labelVi };
    return column.role === "time" && recommendation.filters?.some(filter => filter.field === column.name && filter.control === "datetime-select")
      ? { ...column, granularity: "datetime" } : column;
  });
  const records = (!recommendation.metricField || usesCategoricalPolygonColor()) && feature.properties?.__source_locations
    ? popupRegionRecords(applyPipelineFilters(state.aiDataset.records, state.aiDataset.filters || {}), feature,
      recommendation.geometry.field, { chartType: "choropleth", columns, bindings: activePolygonSuggestion()?.bindings }) : [];
  return createAiPopupContent(document, feature, displayedColumns,
    state.aiDataset.nativeTitleField || (activeMapPopupSuggestion()?.chartType === "point"
      ? pointTitleField(displayedColumns) || state.aiDataset.analysis.search_fields?.[0] : recommendation.geometry?.field), {
        records,
        datasetTitle: state.aiDataset.analysis?.datasetTitle?.trim()
          || String(state.aiDataset.fileName || state.fileName || "").replace(/\.[^/.]+$/, "")
      });
}

function showAiPolygonDetails(event) {
  const feature = event.features?.[0];
  if (!feature || !state.aiDataset) return;
  if (activePolygonSuggestion()) {
    openMapPopup(feature, event.lngLat);
    return;
  }
  const card = aiWeatherPopupContent(feature);
  new maplibregl.Popup({ offset: 12, maxWidth: "360px", className: "ai-weather-popup" }).setLngLat(event.lngLat).setDOMContent(card).addTo(map);
}

function activePolygonSuggestion() {
  const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
  return suggestion?.chartType === "choropleth" ? suggestion : null;
}

function activeMapPopupSuggestion() {
  const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
  return ["choropleth", "map_line", "point"].includes(suggestion?.chartType) ? suggestion : null;
}

function popupSelectionFor(suggestion = activeMapPopupSuggestion()) {
  const dataset = state.aiDataset;
  dataset.popupSelections ||= {};
  const available = popupDisplayOptions(suggestion, dataset.analysis.columns).filter(item => item.available);
  const selection = dataset.popupSelections[suggestion.id] ||= { mode: available[0].name, bar: null, line: null };
  if (!available.some(item => item.name === selection.mode)) selection.mode = available[0].name;
  if (selection.mode !== "info" && !selection[selection.mode]) {
    const metric = suggestion.chartType === "point" ? pointSelectionFor(suggestion).metricField : dataset.recommendation.metricField;
    selection[selection.mode] = createPopupChartSelection(dataset.records, dataset.analysis.columns, metric, selection.mode, suggestion.bindings);
  }
  return selection;
}

function clearMapPopupChart(view) {
  if (view?.chartContainer) {
    chartRenderer(view.chartKind).clear(view.chartContainer);
    view.chartContainer = null;
  }
}

function closeMapPopup() {
  const view = mapPopupView;
  if (!view) return;
  mapPopupView = null;
  clearMapPopupChart(view);
  view.popup.remove();
}

function renderMapPopup(view) {
  clearMapPopupChart(view);
  const dataset = state.aiDataset;
  const selection = popupSelectionFor();
  const card = selection.mode === "info" ? aiWeatherPopupContent(view.feature) : document.createElement("div");
  let chart;
  if (selection.mode !== "info") {
    card.className = "weather-popup ai-popup-chart-only";
    const dimensionFilters = Object.fromEntries(Object.entries(dataset.filters || {}).filter(([field]) =>
      dataset.analysis.columns.some(column => column.name === field && column.role !== "time")));
    const records = activePolygonSuggestion() ? applyPipelineFilters(dataset.records, dimensionFilters) : dataset.records;
    chart = buildPopupChart({ records, columns: dataset.analysis.columns,
      feature: view.feature, regionField: dataset.recommendation.geometry.field,
      kind: selection.mode, selection: selection[selection.mode], chartType: activeMapPopupSuggestion().chartType, bindings: activeMapPopupSuggestion().bindings });
    const container = document.createElement("div");
    container.className = chart.config ? "ai-popup-chart" : "weather-popup-status";
    if (!chart.config) { container.textContent = chart.message; container.setAttribute("role", "status"); }
    else { view.chartContainer = container; view.chartKind = selection.mode; }
    card.append(container);
  }
  view.popup.setDOMContent(card);
  const popupElement = view.popup.getElement();
  popupElement.classList.toggle("has-popup-chart", selection.mode !== "info");
  sizeMapPopup(view);
  if (chart?.config) chartRenderer(selection.mode).render(view.chartContainer, chart.config);
}

function sizeMapPopup(view) {
  const popupElement = view.popup.getElement();
  const mapContainer = map.getContainer();
  popupElement.style.setProperty("--popup-map-width", `${Math.max(0, mapContainer.clientWidth - 32)}px`);
  popupElement.style.setProperty("--popup-map-height", `${Math.max(0, mapContainer.clientHeight - 32)}px`);
  // Keep the whole card inside the map, including after changing its type or
  // resizing the sidebar. The tip is hidden, so a centered card can be clamped.
  const point = map.project(view.lngLat);
  const halfWidth = popupElement.offsetWidth / 2;
  const halfHeight = popupElement.offsetHeight / 2;
  view.popup.setLngLat(map.unproject([
    Math.max(halfWidth + 16, Math.min(mapContainer.clientWidth - halfWidth - 16, point.x)),
    Math.max(halfHeight + 16, Math.min(mapContainer.clientHeight - halfHeight - 16, point.y))
  ]));
}

function openMapPopup(feature, lngLat, layerId = null) {
  closeMapPopup();
  cellPopup?.remove();
  const popup = new maplibregl.Popup({ anchor: "center", maxWidth: "520px", className: "ai-weather-popup ai-map-popup" })
    .setDOMContent(document.createElement("div"));
  const view = { popup, feature, lngLat, layerId, chartContainer: null, chartKind: null };
  mapPopupView = view;
  popup.on("close", () => {
    clearMapPopupChart(view);
    if (mapPopupView === view) mapPopupView = null;
  });
  view.ownerId = options.id;
  if (layerId === "h3-fill") openCellPopup(popup, feature, layerId);
  else popup.setLngLat(lngLat).addTo(map);
  renderMapPopup(view);
}

function refreshMapPopup() {
  const view = mapPopupView;
  if (!view) return;
  const suggestion = activeMapPopupSuggestion();
  if (!suggestion) { closeMapPopup(); return; }
  const field = suggestion.bindings.region;
  const features = view.layerId === "point-marker" ? state.pointData.features : view.layerId === "data-lines" ? state.lineData.features : view.layerId === "h3-fill" ? state.h3Data.features : state.boundary?.features;
  const feature = (view.layerId === "point-marker" && view.feature.id != null ? features?.find(item => item.id === view.feature.id) : null) || features?.find(item => view.layerId === "h3-fill"
    ? item.properties.h3 === view.feature.properties.h3
    : popupFeaturesMatch(item, view.feature, field, { chartType: suggestion.chartType, columns: state.aiDataset.analysis.columns, bindings: suggestion.bindings }));
  if (!feature) { closeMapPopup(); return; }
  view.feature = feature;
  if (view.layerId === "h3-fill") showCellFocus(feature, view.layerId);
  renderMapPopup(view);
}

function applyHeatmapWeight() {
  if (!map?.getLayer("point-heatmap")) return;
  const field = state.dataProfile?.numericFields?.[0];
  const values = field ? state.pointData.features.map(feature => Number(feature.properties?.[field])).filter(Number.isFinite) : [];
  const min = values.length ? Math.min(...values) : 0; const max = values.length ? Math.max(...values) : 0;
  if (field && max > min) {
    map.setPaintProperty("point-heatmap", "heatmap-weight", ["interpolate", ["linear"], ["to-number", ["get", field], min], min, .15, max, 1]);
  } else {
    map.setPaintProperty("point-heatmap", "heatmap-weight", 1);
  }
}

function estimateCellCount(resolution) {
  if (!state.baselineCount) return 0;
  return Math.round(state.baselineCount * Math.pow(7, resolution - CONFIG.DEFAULT_RESOLUTION));
}

let regionHexBuildRevision = 0;

async function rebuildRegionHexGrid({ fit = false } = {}) {
  const revision = ++regionHexBuildRevision;
  const boundary = state.boundary;
  const requestedResolution = state.regionHexResolution;
  if (!boundary || !isRegionHexMode()) return;
  setStatus(`Đang tạo lưới lục giác ở độ phân giải ${requestedResolution}…`);
  await new Promise(resolve => setTimeout(resolve, 20));
  if (revision !== regionHexBuildRevision || boundary !== state.boundary || !isRegionHexMode()) return;
  try {
    const result = buildRegionHexGrid(boundary, requestedResolution, CONFIG.MAX_RENDER_CELLS);
    state.h3Data = result.data;
    state.regionHexResolution = result.resolution;
    syncRegionHexControls();
    map.getSource("h3-grid")?.setData(state.h3Data);
    const count = result.data.features.length;
    $("region-hex-note").textContent = result.resolution !== requestedResolution
      ? `Đã dùng độ phân giải ${result.resolution} để giữ số ô trong giới hạn ${CONFIG.MAX_RENDER_CELLS.toLocaleString("vi-VN")} ô.`
      : !count ? "Chưa có ô ở độ phân giải này. Tăng độ phân giải để hiển thị vùng nhỏ." : "";
    $("cell-count").textContent = count.toLocaleString("vi-VN");
    $("cell-label").textContent = `Tổng số cell (res ${result.resolution})`;
    state.page = 1; updateDashboard();
    syncPolygonPaletteControls(); applyStyle();
    if (fit && count) fitBoundary();
    setStatus(`Đã vẽ ${count.toLocaleString("vi-VN")} ô lục giác.`, true);
  } catch (error) {
    state.regionHexEnabled = false;
    syncRegionHexControls(); applyStyle();
    $("region-hex-note").textContent = error.message || "Không thể tạo lưới lục giác.";
    setStatus("Không thể tạo lưới lục giác.", true);
  }
}

async function rebuildGrid({ fit = false } = {}) {
  if (isRegionHexMode()) return rebuildRegionHexGrid({ fit });
  const selectedAiSuggestion = state.aiDataset?.suggestions?.find(item => item.id === state.aiDataset.selectedSuggestionId);
  if (selectedAiSuggestion?.chartType === "hex_h3") return refreshAiH3({ fit });
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
  } catch (error) { console.error(error); setStatus("Không thể tạo lưới H3."); showToast(error.message || "Dữ liệu không hợp lệ."); }
}
function updateDashboard() { renderTable(); }

function filteredFeatures() { const q = state.query.trim().toLowerCase(); return q ? state.h3Data.features.filter(f => f.properties.h3.toLowerCase().includes(q)) : state.h3Data.features; }
function renderTable() {
  if (options.renderTable?.(state)) return;
  const all = filteredFeatures(); const pages = Math.max(1, Math.ceil(all.length / state.pageSize)); state.page = Math.min(state.page, pages); const start = (state.page - 1) * state.pageSize; const rows = all.slice(start, start + state.pageSize);
  $("data-body").innerHTML = rows.length ? rows.map((f, i) => { const p = f.properties; return `<tr><td>${start + i + 1}</td><td><b>${p.h3}</b></td><td>${fmt(p.center_lat, 5)}, ${fmt(p.center_lng, 5)}</td><td>•••</td></tr>`; }).join("") : `<tr><td colspan="4" class="empty-row">Không tìm thấy dữ liệu.</td></tr>`;
  const end = Math.min(start + state.pageSize, all.length); $("table-summary").textContent = `Hiển thị ${rows.length} / ${all.length.toLocaleString("vi-VN")} bản ghi`; $("pagination-info").textContent = `${all.length ? start + 1 : 0}–${end} của ${all.length.toLocaleString("vi-VN")}`;
  $("prev-page").disabled = state.page <= 1; $("next-page").disabled = state.page >= pages;
  const nums = [1, state.page - 1, state.page, state.page + 1, pages].filter((v, i, a) => v > 0 && v <= pages && a.indexOf(v) === i).sort((a, b) => a - b); let last = 0; $("page-buttons").innerHTML = nums.map(n => { const gap = n - last > 1 ? "<em>…</em>" : ""; last = n; return `${gap}<button class="${n === state.page ? "active" : ""}" data-page="${n}">${n}</button>` }).join("");
}

function boundaryProvinceName(feature) {
  const properties = feature?.properties || {};
  return properties.__province_name
    || properties.NAME_1;
}

function provinceNames(data) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) return [];
  return [...new Set(data.features.map(boundaryProvinceName).filter(name => typeof name === "string" && name.trim()))]
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
  const selected = new Set(names); return { ...data, features: data.features.filter(feature => selected.has(boundaryProvinceName(feature))) };
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
  const types = compatibleMapTypes(profile); const grid = $("map-type-grid"); state.dataProfile = profile;
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

function clearUploadedData({ preserveUploads = false } = {}) {
  closeMapPopup();
  regionHexBuildRevision += 1;
  state.regionHexEnabled = false; state.regionHexResolution = CONFIG.DEFAULT_RESOLUTION;
  $("region-hex-note").textContent = "";
  tabularAbortController?.abort(); tabularAbortController = null; tabularLoadRevision += 1;
  cancelAiBoundaryLoad();
  if (!preserveUploads) clearUploadLayers();
  state.primaryUploadId = null;
  state.boundary = null; state.sourceBoundary = null; state.h3Data = { type: "FeatureCollection", features: [] };
  state.pointData = { type: "FeatureCollection", features: [] };
  state.lineData = EMPTY_FEATURE_COLLECTION;
  map?.getSource("line-data")?.setData(state.lineData);
  state.mapType = null; state.dataProfile = null; state.chartConfig = null; state.chartOptions = []; state.chartAnalysis = null; state.chartMapping = null; state.mappingWarning = ""; state.baselineCount = null; state.page = 1; state.dataOrigin = null; state.aiDataset = null; state.pendingSheet = null;
  $("sheet-selector-field").hidden = true; $("sheet-selector").replaceChildren();
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
  regionHexBuildRevision += 1;
  state.regionHexEnabled = false; state.regionHexResolution = CONFIG.DEFAULT_RESOLUTION;
  $("region-hex-note").textContent = "";
  syncRegionHexControls();
  state.resolution = CONFIG.DEFAULT_RESOLUTION;
  state.barStyle = mergeBarConfig();
  state.pieStyle = mergePieConfig();
  state.pointStyle = mergePointStyle();
  state.roadDisplayStyle = { ...DEFAULT_ROAD_DISPLAY_STYLE };
  if (activeRoadSuggestion()) state.aiDataset.roadColorOverrides = Object.create(null);
  state.polygonPalette = state.aiDataset ? "diverging" : null;

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
  $("road-line-width").value = DEFAULT_ROAD_DISPLAY_STYLE.width;
  $("road-line-width-value").value = `${DEFAULT_ROAD_DISPLAY_STYLE.width} px`;
  $("road-line-opacity").value = DEFAULT_ROAD_DISPLAY_STYLE.opacity;
  $("road-line-opacity-value").value = "100%";
  $("road-show-legend").checked = DEFAULT_ROAD_DISPLAY_STYLE.showLegend;
  if (!state.chartConfig) syncPolygonPaletteControls();
  $("show-map-layers").checked = true;
  $("show-map-layers-status").textContent = "Đang bật";
  cellPopup?.remove();
  for (const id of ["show-map-lines"]) $(id).checked = true;

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
  } else if (state.mapType === "point") {
    if (state.aiDataset) state.aiDataset.pointColorOverrides = Object.create(null);
    refreshPointStyle(); renderPointStyleControls();
  } else if (activeRoadSuggestion()) {
    const suggestion = activeRoadSuggestion();
    state.aiDataset.roadStyle = roadMapStyle(state.lineData, state.aiDataset.analysis.columns.find(column => column.name === suggestion.bindings.value));
    renderRoadStyleControls();
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
  const activeAiSuggestion = state.aiDataset?.suggestions?.find(item => item.id === state.aiDataset.selectedSuggestionId);
  const isAiBar = activeAiSuggestion?.chartType === "bar" && state.chartConfig.chartKind === "bar";
  const panelConfig = isAiBar
    ? { ...state.barStyle, limit: state.aiDataset.barLimits?.[activeAiSuggestion.id] ?? defaultBarLimit(activeAiSuggestion, state.aiDataset.analysis.columns) }
    : state.chartConfig.chartKind === "line"
      ? { ...state.barStyle, showDataLabels: Boolean(state.chartConfig.showDataLabels) }
      : state.barStyle;
  $("style-description").textContent = state.chartConfig.chartKind === "line"
    ? "Màu đường, nhãn, chú giải và tooltip"
    : "Dữ liệu, màu sắc, kích thước cột, nhãn và trục";
  renderBarStylePanel($("bar-style-controls"), {
    config: panelConfig,
    chartKind: state.chartConfig.chartKind || "bar",
    rowCount: isAiBar ? state.aiDataset.activeChartOption?.totalCategories || state.chartConfig.data.length : state.chartConfig.data.length,
    series: state.chartConfig.series,
    onChange(nextConfig) {
      state.barStyle = mergeBarConfig(nextConfig);
      if (state.chartConfig.chartKind === "line") state.lineLabelsOn = Boolean(nextConfig.showDataLabels);
      if (isAiBar && nextConfig.limit !== panelConfig.limit) {
        state.aiDataset.barLimits[activeAiSuggestion.id] = nextConfig.limit;
        activateAiChartSuggestion(activeAiSuggestion);
        return;
      }
      state.chartConfig = { ...state.chartConfig, ...state.barStyle, ...(isAiBar ? { limit: "all" } : {}) };
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
  applyChartMappingChange({ metrics: defaultMetricSelection(dataset, variant) });
  showToast("Đã đặt lại chỉ số hiển thị.");
}

function applyChartMappingChange(change) {
  let mapping = { ...state.chartMapping, ...change };
  if (change.datasetPath) {
    const nextDataset = state.chartAnalysis.datasets.find(dataset => dataset.path === change.datasetPath);
    mapping = { datasetPath: nextDataset.path, xField: nextDataset.suggestedCategory, metrics: defaultMetricSelection(nextDataset, state.chartConfig.variant) };
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
        : `So sánh nhiều chỉ số · ${dataset.label}`
    };
    renderChartCanvas();
    renderChartStyleControls();
  }
  renderChartDataMapping();
}

function showChartStyleControls(show) {
  const isPoint = !show && state.mapType === "point";
  const isRoad = !show && Boolean(activeRoadSuggestion());
  $("map-style-controls").hidden = show || isPoint || isRoad;
  $("point-style-controls").hidden = !isPoint;
  $("road-style-controls").hidden = !isRoad;
  $("bar-style-controls").hidden = !show;
  $("style-description").textContent = show ? "Tùy chỉnh biểu đồ" : isRoad ? "Màu sắc, độ dày, độ mờ và chú giải tuyến" : "Màu sắc, độ mờ và đường viền";
  if (show) renderChartStyleControls();
  else {
    clearBarStylePanel($("bar-style-controls"));
    clearPieStylePanel($("bar-style-controls"));
  }
}

function roadColorOverridesFor(suggestion) {
  const dataset = state.aiDataset;
  dataset.roadColorOverrides ||= Object.create(null);
  return dataset.roadColorOverrides[suggestion.bindings.value || dataset.recommendation?.metricField || "__path"] ||= Object.create(null);
}

function aiLineStyle(data, suggestion) {
  const dataset = state.aiDataset;
  const field = suggestion.bindings.value || dataset.recommendation.metricField;
  const column = dataset.analysis.columns.find(item => item.name === field);
  const colors = roadColorOverridesFor(suggestion);
  const color = colors.path || "#00d084";
  return column ? roadMapStyle(data, column, colors) : { color, rows: [{ key: "path", label: "Màu tuyến", color }] };
}

function renderRoadStyleControls() {
  const suggestion = activeRoadSuggestion();
  const rows = suggestion ? state.aiDataset.roadStyle?.rows || [] : [];
  $("road-line-width").value = state.roadDisplayStyle.width;
  $("road-line-width-value").value = `${state.roadDisplayStyle.width} px`;
  $("road-line-opacity").value = state.roadDisplayStyle.opacity;
  $("road-line-opacity-value").value = `${Math.round(state.roadDisplayStyle.opacity * 100)}%`;
  $("road-show-legend").checked = state.roadDisplayStyle.showLegend;
  $("road-color-field").hidden = !rows.length;
  $("road-style-colors").replaceChildren(...rows.map(item => {
    const row = document.createElement("label"); row.className = "bar-color-row";
    const label = document.createElement("span"); label.textContent = item.label; label.title = item.label;
    const control = document.createElement("span"); control.className = "color-control";
    const input = Object.assign(document.createElement("input"), { type: "color", value: item.color, className: "road-style-color" });
    input.dataset.key = item.key; input.setAttribute("aria-label", `Màu ${item.label}`);
    const code = document.createElement("code"); code.textContent = item.color.toUpperCase();
    control.append(input, code); row.append(label, control);
    return row;
  }));
}

function clearAiMapState() {
  closeMapPopup();
  cancelAiBoundaryLoad();
  pointPopup?.remove(); pointPopup = null;
  state.aiDataset = null;
  renderMapMetricControls();
  mapSearch?.setData();
  $("ai-line-legend").hidden = true;
  $("point-legend").hidden = true;
  $("ai-data-filters").hidden = true;
  $("ai-filter-controls").replaceChildren();
}

async function analyzeTabularRecords(records, profile, { signal, source = null } = {}) {
  const pipeline = await requestAiDataAnalysis(records, {
    signal,
    includeSamples: Boolean($("ai-include-samples")?.checked),
    profile,
    source
  });
  let spatialData = null;
  try { spatialData = recordsToPointGeoJSON(pipeline.records); } catch { /* Tabular data without coordinates. */ }
  return { kind: "ai-pipeline", pipeline: { ...pipeline, rawRecords: records, spatialData } };
}

async function parseSpreadsheetUpload(file, options) {
  if (typeof parseSpreadsheetFile === "function") return parseSpreadsheetFile(file, options);
  if (!globalThis.XLSX) throw new Error("Không tải được thư viện đọc bảng dữ liệu.");
  const workbook = globalThis.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames || [];
  if (!options.sheetName && sheetNames.length > 1) return { needsSheet: true, sheetNames };
  const selectedSheet = options.sheetName && sheetNames.includes(options.sheetName) ? options.sheetName : sheetNames[0];
  const records = globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[selectedSheet], { defval: "", raw: true });
  return { records, profile: typeof summarizeTabularData === "function" ? summarizeTabularData(records, { includeSamples: options.includeSamples }) : null };
}

async function readSpatialFile(file, { sheetName = null, signal } = {}) {
  if (options.preparsedResults?.has(file)) return options.preparsedResults.get(file);
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "zip") throw new Error("ZIP/Shapefile sẽ được hỗ trợ ở phiên bản tiếp theo.");
  if (["xlsx", "xls", "csv"].includes(extension)) {
    const parsed = await parseSpreadsheetUpload(file, {
      extension,
      sheetName,
      includeSamples: Boolean($("ai-include-samples")?.checked),
      signal
    });
    if (parsed.needsSheet) return { kind: "sheet-selection", sheetNames: parsed.sheetNames, file };
    return analyzeTabularRecords(parsed.records, parsed.profile, {
      signal,
      source: { fileName: file.name, sheetName: parsed.sheetName || sheetName || null, extension }
    });
  }
  const text = await file.text();
  const datasets = jsonDatasets(JSON.parse(text));
  if (datasets.length !== 1) throw new Error("File chứa nhiều tập dữ liệu; hãy nhập qua danh sách dữ liệu để phân tích từng tập.");
  const parsed = datasets[0].data;
  if (typeof parsed?.type === "string") {
    const points = pointGeoJSONToRecords(parsed);
    if (points) {
      const profiled = await profileRecordsInWorker(points.records, { includeSamples: Boolean($("ai-include-samples")?.checked), signal });
      setStatus(`Đang phân tích ${file.name} bằng AI…`);
      const result = await analyzeTabularRecords(points.records, { ...profiled.profile, spatial: { geometryKinds: ["point"], nativeGeometry: true, coordinateBindings: points.bindings } }, {
        signal,
        source: { fileName: file.name, extension }
      });
      result.pipeline.pointSelectionDefaults = { mode: "all" };
      return { ...result, data: parsed };
    }
    const records = parsed.type === "FeatureCollection" ? parsed.features.map(feature => feature.properties || {}) : [parsed.properties || {}];
    if (!records.length) throw new Error("GeoJSON không có đối tượng để phân tích.");
    const includeSamples = Boolean($("ai-include-samples")?.checked);
    const profiled = records.some(record => Object.keys(record).length)
      ? await profileRecordsInWorker(records, { includeSamples, signal })
      : { profile: { rowCount: records.length, columns: [], samplesIncluded: includeSamples } };
    const nativePipeline = await requestAiDataAnalysis(records, { signal, includeSamples,
      profile: { ...profiled.profile, spatial: { geometryKinds: geometryKinds(parsed), nativeGeometry: true } },
      source: { fileName: file.name, extension } });
    return { data: parsed, profile: analyzeSpatialData(parsed), spatialAnalysis: nativePipeline.analysis, nativePipeline };
  }
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
  if (records) {
    const profiled = await profileRecordsInWorker(records, { includeSamples: Boolean($("ai-include-samples")?.checked), signal });
    return analyzeTabularRecords(records, profiled.profile, {
      signal,
      source: { fileName: file.name, extension }
    });
  }
  throw new Error("Dữ liệu đầu vào cần địa danh hành chính, tên đường hoặc tọa độ để tạo bản đồ Polygon, Line hoặc Point.");
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

function lineSelectionFor(dataset, suggestion) {
  dataset.lineSelections ||= {};
  return dataset.lineSelections[suggestion.id] ||= {
    measure: null,
    scope: suggestion.bindings.series ? "pick" : "all",
    picked: [],
    from: null,
    to: null
  };
}

function barSelectionFor(dataset, suggestion) {
  dataset.barSelections ||= {};
  return dataset.barSelections[suggestion.id] = normalizeBarSelection(suggestion, dataset.analysis.columns, dataset.barSelections[suggestion.id]);
}

function aiLineRegionField(dataset, suggestion) {
  if (suggestion.bindings.series) return suggestion.bindings.series;
  const columns = dataset.analysis.columns;
  const geo = columns.find(column => column.role === "geo" && ["admin1", "admin2", "country"].includes(column.geoLevel));
  return (geo || columns.find(column => column.role === "category"))?.name || null;
}

function mapMetricColumns(dataset, suggestion) {
  if (!dataset || !suggestion) return [];
  if (suggestion.chartType === "point") return pointModelFor(suggestion).measures;
  const columns = dataset.analysis.columns.filter(column =>
    !column.name.startsWith("__") && !["point_lat", "point_lng", "h3"].includes(column.geoLevel)
    && (!isCoordinateLine(suggestion) || ![suggestion.bindings.lat, suggestion.bindings.lng, suggestion.bindings.x].includes(column.name)));
  return suggestion.chartType === "map_line" ? roadValueColumns(columns, dataset.records, suggestion.bindings.region)
    : columns.filter(column => column.role === "measure" || suggestion.chartType === "choropleth" && column.role === "category"
      && (column.legend?.type === "categorical" || column.name === suggestion.bindings.value));
}

function mapMetricButtons(dataset, suggestion) {
  const columns = new Map(mapMetricColumns(dataset, suggestion).map(column => [column.name, column]));
  return (Array.isArray(suggestion?.metricButtons) ? suggestion.metricButtons : []).flatMap(button => {
    const column = columns.get(button?.field);
    if (!column || typeof button.label !== "string" || !button.label.trim() || typeof button.icon !== "string"
      || !button.icon.trim() || !/^#[0-9a-f]{6}$/i.test(button.color || "")) return [];
    return [{ ...button, unit: column.unit }];
  });
}

function renderMapMetricControls() {
  const control = $("map-metric-control");
  if (!control) return;
  const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  const mapTypes = { choropleth: ["polygon", "h3"], hex_h3: ["h3"], map_line: ["line"], point: ["point"] };
  const buttons = !state.chartConfig && mapTypes[suggestion?.chartType]?.includes(state.mapType) ? mapMetricButtons(dataset, suggestion) : [];
  control.hidden = buttons.length < 2;
  if (control.hidden) {
    $("map-metric-list").replaceChildren();
    mapMetricControlView = null;
    return;
  }
  const field = suggestion.chartType === "point" ? pointSelectionFor(suggestion).metricField : dataset.recommendation?.metricField;
  const key = JSON.stringify(buttons);
  if (mapMetricControlView?.dataset !== dataset || mapMetricControlView.suggestionId !== suggestion.id || mapMetricControlView.key !== key) {
    const elements = buttons.map(item => {
      const { field, label, unit, icon, color } = item;
      const button = document.createElement("button"); button.type = "button"; button.className = "map-metric-button";
      button.dataset.metricField = field; button.title = unit ? `${label} (${unit})` : label;
      const copy = document.createElement("span"); copy.className = "map-metric-label";
      const title = document.createElement("span"); title.textContent = label; copy.append(title);
      if (unit) {
        const unitText = document.createElement("small"); unitText.textContent = unit; copy.append(unitText);
      }
      const preview = document.createElement("span"); preview.className = "map-metric-preview"; preview.setAttribute("aria-hidden", "true");
      preview.textContent = icon; preview.style.setProperty("--metric-color", color);
      button.append(copy, preview);
      return button;
    });
    $("map-metric-list").replaceChildren(...elements);
    mapMetricControlView = { dataset, suggestionId: suggestion.id, key, buttons: elements };
  }
  for (const button of mapMetricControlView.buttons) {
    const selected = button.dataset.metricField === field;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  const collapsed = dataset.metricControlCollapsed === true;
  $("map-metric-list").hidden = collapsed;
  $("map-metric-toggle").setAttribute("aria-expanded", String(!collapsed));
  $("map-metric-toggle").title = collapsed ? "Mở danh sách chỉ số" : "Thu gọn danh sách chỉ số";
  const selected = buttons.find(button => button.field === field);
  const column = dataset.analysis.columns.find(column => column.name === field);
  $("map-metric-caption").textContent = collapsed ? selected?.label || column?.labelVi || column?.name || "Chỉ số bản đồ" : "Chỉ số bản đồ";
  $("map-metric-count").textContent = String(buttons.length);
}

async function changeAiMapMetric(field) {
  const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  if (!suggestion || !["choropleth", "hex_h3", "map_line", "point"].includes(suggestion.chartType)
    || !mapMetricColumns(dataset, suggestion).some(column => column.name === field)) return;
  if (suggestion.chartType === "point") {
    pointSelectionFor(suggestion).metricField = field;
    for (const select of document.querySelectorAll("#ai-filter-controls .ai-point-metric")) select.value = field;
    refreshPointView(suggestion);
  } else {
    Object.assign(suggestion, withSuggestionMetric(suggestion, field, dataset.analysis.columns));
    dataset.recommendation = recommendationForSuggestion(suggestion);
    for (const select of document.querySelectorAll("#ai-filter-controls .ai-metric-selector")) select.value = field;
    renderMapMetricControls();
    if (suggestion.chartType === "hex_h3") await refreshAiH3();
    else await filteredAiBoundary();
  }
}

function populateAiFilters(dataset) {
  const selected = dataset.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  if (selected?.chartType === "choropleth") return populatePolygonFilters(dataset, selected);
  const { records, recommendation } = dataset;
  const controls = $("ai-filter-controls");
  const initialFilters = {};
  const savedFilters = dataset.filters || {};
  const metricControls = [];
  const suggestion = dataset.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  const measureColumns = mapMetricColumns(dataset, suggestion);
  if (recommendation.metricField && (measureColumns.length > 1 || suggestion?.chartType === "map_line" && measureColumns.length)) {
    const label = document.createElement("label"); const caption = document.createElement("span"); const select = keepSelectOpenAfterMouseClick(document.createElement("select"));
    caption.textContent = suggestion?.chartType === "map_line" ? "Chỉ số tô màu bản đồ" : "Chỉ số";
    select.className = "ai-metric-selector"; select.setAttribute("aria-label", "Chọn chỉ số hiển thị");
    select.replaceChildren(...measureColumns.map(column => Object.assign(document.createElement("option"), {
      value: column.name,
      textContent: column.labelVi || humanizeField(column.name)
    })));
    select.value = recommendation.metricField; label.append(caption, select); metricControls.push(label);
  }
  const filterControls = recommendation.filters.flatMap(filter => {
    const column = dataset.analysis.columns.find(item => item.name === filter.field);
    const values = uniqueRecordValues(records, filter.field).sort((a, b) =>
      column?.role === "time" ? compareTimeValues(a[1], b[1], column) : String(a[1]).localeCompare(String(b[1]), "vi")
    );
    if (!values.length || values.length < 2 && !filter.showSingle) return [];
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = filter.label || filter.field;
    if (filter.toggle || filter.field === recommendation.geometry.field) {
      const multiselect = document.createElement("div");
      const toggle = document.createElement("button");
      const menu = document.createElement("div");
      const toggleText = document.createElement("span");
      const chevron = document.createElement("span");
      const selectedValues = values.filter(([value]) => Array.isArray(savedFilters[filter.field]) && savedFilters[filter.field].includes(value));
      multiselect.className = "ai-multiselect";
      toggle.type = "button";
      toggle.className = "ai-multiselect-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggleText.textContent = selectedValues.length === 1 ? displayFilterValue(selectedValues[0][1], filter.control)
        : selectedValues.length > 1 ? `${selectedValues.length} giá trị đã chọn`
          : filter.emptyLabel || `Chọn ${caption.textContent.toLocaleLowerCase("vi")}`;
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
        if (filter.singleToggle) input.dataset.singleToggle = "true";
        input.value = value;
        input.checked = Array.isArray(savedFilters[filter.field]) && savedFilters[filter.field].includes(value);
        text.textContent = displayFilterValue(raw, filter.control);
        option.append(input, text);
        return option;
      }));
      multiselect.append(toggle, menu);
      initialFilters[filter.field] = selectedValues.map(([value]) => value);
      label.append(caption, multiselect);
      return [label];
    }
    const select = keepSelectOpenAfterMouseClick(document.createElement("select"));
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
    if (savedFilters[filter.field] != null && options.some(([value]) => value === String(savedFilters[filter.field]))) {
      select.value = String(savedFilters[filter.field]);
    } else if (filter.default != null && options.some(([value]) => value === comparableFilterValue(filter.default))) {
      select.value = comparableFilterValue(filter.default);
    }
    initialFilters[filter.field] = select.value;
    label.append(caption, select);
    return [label];
  });
  if (suggestion?.chartType === "map_line") {
    const mapControls = document.createElement("div"); mapControls.className = "ai-popup-map-controls";
    mapControls.append(...metricControls, ...filterControls);
    controls.replaceChildren(...buildMapPopupControls(dataset, suggestion), mapControls);
  } else controls.replaceChildren(...metricControls, ...filterControls);
  dataset.filters = initialFilters;
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

function recommendationForSuggestion(suggestion) {
  const dataset = state.aiDataset;
  const columns = new Map(dataset.analysis.columns.map(column => [column.name, column]));
  const coordinateLine = isCoordinateLine(suggestion);
  const coordinateMap = coordinateLine || suggestion.chartType === "point";
  const valueField = suggestion.bindings.value || (Array.isArray(suggestion.bindings.y) ? suggestion.bindings.y[0] : suggestion.bindings.y)
    || (coordinateMap ? dataset.analysis.columns.find(column => column.role === "measure" && ![suggestion.bindings.lat, suggestion.bindings.lng, suggestion.bindings.x].includes(column.name))?.name : null) || null;
  const regionField = suggestion.bindings.region;
  const region = columns.get(regionField);
  const contextFields = suggestion.chartType === "choropleth" ? administrativeContextFields(dataset.analysis.columns, regionField) : [];
  const areaField = suggestion.chartType === "map_line" && !coordinateLine ? roadAreaField(dataset.analysis.columns) : null;
  const area = columns.get(areaField);
  const timeFilter = coordinateLine ? null : defaultTimeFilter(dataset.records, dataset.analysis.columns, suggestion.chartType);
  return {
    canRenderMap: true,
    visualization: suggestion.chartType === "map_line" ? "line" : suggestion.chartType === "choropleth" ? "polygon" : suggestion.chartType === "point" ? "point" : "h3",
    geometry: coordinateMap ? { field: regionField || null, latField: suggestion.bindings.lat, lngField: suggestion.bindings.lng, provider: "coordinates", placeType: coordinateLine ? "line" : "point" } : regionField
      ? { field: regionField, provider: suggestion.chartType === "map_line" ? "local-roads" : "maptiler",
        placeType: region?.geoLevel === "country" ? "country" : region?.geoLevel === "admin2" ? "county" : "region",
        country: region?.geoLevel === "country" || contextFields.some(field => columns.get(field)?.geoLevel === "country") ? null : region?.country || null,
        ...(contextFields.length ? { contextFields } : {}) }
      : { field: null, latField: suggestion.bindings.lat, lngField: suggestion.bindings.lng, provider: "coordinates", placeType: "point" },
    metricField: valueField,
    numericFields: dataset.analysis.columns.filter(column => column.role === "measure").map(column => column.name),
    filters: [
      ...(areaField && areaField !== regionField ? [{
        field: areaField, label: area?.labelVi || areaField, control: "select",
        toggle: true, singleToggle: true, showSingle: true, emptyLabel: "Chọn khu vực", fit: true
      }] : []),
      ...(regionField ? [{ field: regionField, label: region?.labelVi || regionField, control: "select", allowAll: true }] : []),
      ...(timeFilter ? [{ field: timeFilter.column, label: columns.get(timeFilter.column)?.labelVi || timeFilter.column, control: timeFilter.control, allowAll: false, default: timeFilter.default }] : [])
    ],
    title: suggestion.title,
    explanation: suggestion.reason,
    confidence: suggestion.effectiveConfidence,
    source: dataset.analysis.source,
    aggregation: valueField ? resolveAggregation(suggestion, dataset.analysis.columns) : null
  };
}

function createAiSuggestionButton(suggestion) {
  const button = document.createElement("button");
  const icon = document.createElement("span");
  const title = document.createElement("span");
  const reason = document.createElement("span");
  const score = document.createElement("span");
  button.type = "button";
  button.className = `map-type ai-suggestion${suggestion.id === state.aiDataset?.selectedSuggestionId ? " active" : ""}`;
  button.dataset.aiSuggestion = suggestion.id;
  button.dataset.type = suggestion.id;
  button.disabled = !suggestion.available && !suggestion.repairable;
  button.title = suggestion.available ? suggestion.reason : suggestion.repairable ? `${suggestion.unavailableReason} Bấm để sửa alias.` : suggestion.unavailableReason;
  if (["choropleth", "point", "hex_h3", "map_line"].includes(suggestion.chartType)) {
    renderMapIcon(icon, AI_CHART_REGISTRY[suggestion.chartType].icon);
  }
  else renderChartIcon(icon, suggestion.chartType === "line" ? "line" : "singleBar");
  title.className = "ai-suggestion-title"; title.textContent = AI_CHART_REGISTRY[suggestion.chartType].label;
  reason.className = "ai-suggestion-reason"; reason.textContent = suggestion.available ? suggestion.reason : suggestion.unavailableReason;
  score.className = "ai-suggestion-score"; score.textContent = `${Math.round(suggestion.effectiveConfidence * 100)}%${suggestion.effectiveConfidence < .6 ? " ⚠" : ""}`;
  button.append(icon, title, reason, score);
  return button;
}

function renderAiSuggestionGrid() {
  if (!state.aiDataset) return;
  const grid = $("map-type-grid");
  const suggestions = mapDisplaySuggestions(state.aiDataset.suggestions, state.aiDataset.selectedSuggestionId);
  const suggestionButtons = suggestions.map(createAiSuggestionButton);
  const suggestionHeading = document.createElement("div");
  suggestionHeading.className = "ai-manual-heading ai-suggestion-heading";
  suggestionHeading.textContent = suggestions.length
    ? "AI đề xuất"
    : "Chưa có kiểu bản đồ phù hợp được đề xuất";
  grid.className = "map-type-grid has-ai-suggestions";
  grid.replaceChildren(suggestionHeading, ...suggestionButtons);
  const source = "AI";
  $("map-type-summary").textContent = `${state.aiDataset.analysis.datasetTitle} · ${state.aiDataset.analysis.grain} · ${suggestions.length} đề xuất từ ${source}`;
  showSupportedChartCatalog(false);
}

function clearMapForAiChart() {
  closeMapPopup();
  state.boundary = null; state.sourceBoundary = null; state.h3Data = EMPTY_FEATURE_COLLECTION; state.pointData = EMPTY_FEATURE_COLLECTION;
  state.lineData = EMPTY_FEATURE_COLLECTION;
  map.getSource("line-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("h3-grid")?.setData(EMPTY_FEATURE_COLLECTION); map.getSource("point-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION); map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
}

function aiField(caption, control) {
  const label = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = caption;
  label.append(text, control);
  return label;
}

function aiSelect(className, choices, value) {
  const select = document.createElement("select");
  select.className = className;
  select.replaceChildren(...choices.map(([optionValue, text]) =>
    Object.assign(document.createElement("option"), { value: optionValue, textContent: text })));
  select.value = value;
  return keepSelectOpenAfterMouseClick(select);
}

function buildMapPopupControls(dataset, suggestion) {
  const columns = dataset.analysis.columns;
  const selection = popupSelectionFor(suggestion);
  const group = document.createElement("div");
  group.className = "ai-control-group";
  const caption = document.createElement("span"); caption.textContent = "Kiểu hiển thị popup";
  const types = document.createElement("div");
  types.className = "ai-popup-types";
  types.setAttribute("role", "group"); types.setAttribute("aria-label", "Kiểu hiển thị popup");
  const subject = suggestion.chartType === "map_line" ? "tuyến" : suggestion.chartType === "point" ? "điểm" : "vùng";
  const labels = {
    info: ["Chỉ hiển thị thông tin", "Hiển thị các chỉ số dưới dạng thẻ thông tin", null],
    bar: ["Biểu đồ cột", `Hiển thị biểu đồ cột của ${subject} được chọn`, "singleBar"],
    line: ["Biểu đồ đường", `Hiển thị biểu đồ đường của ${subject} được chọn`, "line"]
  };
  for (const option of popupDisplayOptions(suggestion, columns)) {
    const mode = option.name;
    const [label, description, iconName] = labels[mode];
    const button = document.createElement("button"); const icon = document.createElement("span");
    const copy = document.createElement("span"); const title = document.createElement("b");
    const detail = document.createElement("small"); const check = document.createElement("span");
    button.type = "button"; button.className = `ai-popup-type${selection.mode === mode ? " active" : ""}`;
    button.dataset.popupMode = mode; button.setAttribute("aria-pressed", String(selection.mode === mode));
    button.disabled = !option.available;
    if (button.disabled) button.title = option.unavailableReason;
    icon.className = "ai-popup-type-icon"; icon.setAttribute("aria-hidden", "true");
    if (iconName) { renderChartIcon(icon, iconName); icon.className = "chart-type-icon ai-popup-type-icon"; }
    else icon.textContent = "▦";
    title.textContent = option.fallback ? "Hiển thị mặc định" : label;
    detail.textContent = option.unavailableReason || description; copy.append(title, detail);
    check.className = "ai-popup-type-check"; check.textContent = "✓"; check.setAttribute("aria-hidden", "true");
    button.append(icon, copy);
    if (Number.isFinite(option.confidence)) {
      const score = document.createElement("span"); score.className = "ai-popup-type-score";
      score.textContent = `${Math.round(option.confidence * 100)}%`;
      score.setAttribute("aria-label", `Độ phù hợp do AI đề xuất: ${score.textContent}`);
      button.append(score);
    }
    button.append(check); types.append(button);
  }
  group.append(caption, types);
  const nodes = [group];
  if (selection.mode !== "info") nodes.push(buildMapPopupSettings(dataset, selection));
  return nodes;
}

function polygonDimensionChoices(dataset, suggestion) {
  const geoOrder = { country: 0, admin1: 1, admin2: 2 };
  const priority = column => column.role === "geo" ? geoOrder[column.geoLevel] ?? 3 : 4;
  const columns = dataset.analysis.columns.filter(column =>
    !column.name.startsWith("__") && !["point_lat", "point_lng", "h3"].includes(column.geoLevel)
    && (column.role === "geo" || column.role === "category" || column.name === suggestion.bindings.region)
  ).sort((a, b) => priority(a) - priority(b));
  let records = dataset.records;
  return columns.flatMap(column => {
    const choices = uniqueRecordValues(records, column.name).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "vi"));
    // Keep the dimension visible even if the selected parent has no value for it.
    if (!choices.length && !uniqueRecordValues(dataset.records, column.name).length) return [];
    const saved = dataset.filters?.[column.name];
    const value = choices.some(([key]) => key === saved) ? saved : "";
    if (value !== "") records = applyPipelineFilters(records, { [column.name]: value });
    return [{ column, choices, value }];
  });
}

function populatePolygonFilters(dataset, suggestion) {
  const columns = dataset.analysis.columns;
  const time = popupTimeColumn(columns);
  const nodes = buildMapPopupControls(dataset, suggestion);
  const mapControls = document.createElement("div"); mapControls.className = "ai-popup-map-controls";
  const measures = mapMetricColumns(dataset, suggestion);
  if (measures.length) mapControls.append(aiField("Chỉ số tô màu bản đồ", aiSelect("ai-metric-selector",
    measures.map(column => [column.name, column.labelVi || humanizeField(column.name)]), dataset.recommendation.metricField)));
  const filters = {};
  const times = time ? uniqueTimeValues(dataset.records, time) : [];
  if (times.length) {
    const choices = times.map(value => [comparableFilterValue(value), formatTimeValue(value, time,
      value instanceof Date && Boolean(value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds()))]);
    const saved = dataset.filters?.[time.name];
    const value = choices.some(([key]) => key === saved) ? saved : choices.at(-1)[0];
    const control = aiSelect("ai-generated-filter", choices, value);
    control.dataset.field = time.name; control.setAttribute("aria-label", "Ngày hiển thị bản đồ");
    filters[time.name] = value;
    mapControls.append(aiField("Ngày hiển thị", control));
  }
  for (const { column, choices, value } of polygonDimensionChoices(dataset, suggestion)) {
    const caption = column.labelVi || humanizeField(column.name);
    const control = aiSelect("ai-generated-filter", [["", `Tất cả ${caption.toLocaleLowerCase("vi")}`], ...choices], value);
    control.dataset.field = column.name;
    control.dataset.dimensionFilter = "true";
    control.setAttribute("aria-label", `Lọc theo ${caption}`);
    filters[column.name] = value;
    mapControls.append(aiField(caption, control));
  }
  nodes.push(mapControls);
  $("ai-filter-controls").replaceChildren(...nodes);
  $("ai-data-filters").hidden = false;
  dataset.filters = filters;
  return filters;
}

function buildMapPopupSettings(dataset, selection) {
  const settings = document.createElement("div"); settings.className = "ai-popup-settings";
  const columns = popupChartColumns(dataset.analysis.columns, activeMapPopupSuggestion()?.bindings);
  const config = selection[selection.mode];
  if (selection.mode === "bar") {
    const variants = document.createElement("div"); variants.className = "ai-bar-chart-types";
    for (const [variant, label, iconName] of [["single", "Cột đơn", "singleBar"], ["grouped", "Cột ghép", "groupedBar"]]) {
      const button = document.createElement("button"); const icon = document.createElement("span"); const text = document.createElement("span");
      button.type = "button"; button.className = `ai-bar-chart-type${config.variant === variant ? " active" : ""}`;
      button.dataset.popupBarVariant = variant; button.setAttribute("aria-pressed", String(config.variant === variant));
      button.disabled = variant === "grouped" && defaultBarMetrics({ bindings: { y: config.metrics[0] } }, columns, "grouped").length < 2;
      renderChartIcon(icon, iconName); text.textContent = label; button.append(icon, text); variants.append(button);
    }
    settings.append(aiField("Hình thức hiển thị", variants));
  }
  const metrics = selection.mode === "bar" ? barMetricOptions(columns)
    : columns.filter(column => column.role === "measure").map(column => ({ key: column.name, label: column.labelVi || humanizeField(column.name) }));
  if (selection.mode === "bar" && config.variant === "grouped") {
    const picker = document.createElement("div"); picker.className = "ai-bar-metric-list";
    for (const metric of metrics) {
      const input = document.createElement("input"); input.type = "checkbox";
      input.className = "ai-popup-metric-checkbox"; input.value = metric.key; input.checked = config.metrics.includes(metric.key);
      const label = document.createElement("label"); const text = document.createElement("span"); text.textContent = metric.label;
      label.append(input, text); picker.append(label);
    }
    const field = document.createElement("div"); field.className = "ai-control-group";
    const caption = document.createElement("span"); caption.textContent = "Chỉ số (tối thiểu 2)";
    field.append(caption, picker); settings.append(field);
  } else settings.append(aiField("Chỉ số biểu đồ", aiSelect("ai-popup-metric", metrics.map(item => [item.key, item.label]),
    selection.mode === "bar" ? config.metrics[0] : config.measure)));
  if (selection.mode === "bar") {
    const aggregation = aiSelect("ai-popup-aggregation", [["auto", "Theo dữ liệu"], ["sum", "Tổng (SUM)"],
      ["mean", "Trung bình (AVG)"], ["min", "Nhỏ nhất (MIN)"], ["max", "Lớn nhất (MAX)"]], config.aggregation);
    aggregation.disabled = config.metrics.every(metric => metric === "count");
    settings.append(aiField("Cách tính giá trị", aggregation));
  }
  const time = popupTimeColumn(columns);
  const times = time ? uniqueTimeValues(dataset.records, time) : [];
  if (times.length) {
    const choices = times.map(value => [comparableFilterValue(value), formatTimeValue(value, time,
      value instanceof Date && Boolean(value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds()))]);
    const road = activeMapPopupSuggestion()?.chartType === "map_line";
    for (const [edge, label] of [["from", road ? "Biểu đồ từ thời điểm" : "Biểu đồ từ ngày"], ["to", road ? "Đến thời điểm" : "Đến ngày"]]) {
      const control = aiSelect("ai-popup-range", choices, config[edge]); control.dataset.edge = edge;
      settings.append(aiField(label, control));
    }
  }
  return settings;
}

function refreshMapPopupControls() {
  if (activeMapPopupSuggestion()?.chartType === "point") populatePointControls(activeMapPopupSuggestion());
  else populateAiFilters(state.aiDataset);
  if (activePolygonSuggestion()) renderGeoRepair(state.aiDataset.geoMatch?.unmatched || []);
  refreshMapPopup();
}

function changeMapPopupControl(control) {
  if (!activeMapPopupSuggestion()) return;
  const selection = popupSelectionFor();
  const config = selection[selection.mode];
  if (!config) return;
  if (control.matches(".ai-popup-metric")) {
    if (selection.mode === "bar") { config.metrics = [control.value]; config.aggregation = "auto"; }
    else config.measure = control.value;
  } else if (control.matches(".ai-popup-metric-checkbox")) {
    const checked = [...document.querySelectorAll("#ai-filter-controls .ai-popup-metric-checkbox:checked")];
    if (checked.length < 2) { control.checked = true; showToast("Cột ghép cần ít nhất 2 chỉ số."); return; }
    config.metrics = checked.map(input => input.value);
  } else if (control.matches(".ai-popup-aggregation")) config.aggregation = control.value;
  else if (control.matches(".ai-popup-range")) {
    const edge = control.dataset.edge;
    config[edge] = control.value;
    if (compareTimeValues(config.from, config.to, popupTimeColumn(state.aiDataset.analysis.columns)) > 0) {
      config[edge === "from" ? "to" : "from"] = control.value;
    }
  }
  refreshMapPopupControls();
}

function buildAiSeriesPicker(option) {
  const box = document.createElement("div");
  box.className = "ai-series-picker";
  const search = Object.assign(document.createElement("input"), {
    type: "search",
    className: "ai-series-search",
    placeholder: "Tìm…"
  });
  const counter = document.createElement("span");
  counter.dataset.role = "series-count";
  counter.textContent = `${option.selectedSeries.length}/${option.maxSeries}`;
  const reset = Object.assign(document.createElement("button"), {
    type: "button",
    className: "ai-series-reset secondary-button",
    textContent: "Đặt lại (top 5)"
  });
  const head = document.createElement("div");
  head.className = "ai-series-head";
  head.append(counter, reset);
  const list = document.createElement("div");
  list.className = "ai-series-list";
  list.replaceChildren(...option.availableSeries.map(item => {
    const row = document.createElement("label");
    const input = document.createElement("input");
    const text = document.createElement("span");
    input.type = "checkbox";
    input.className = "ai-series-filter";
    input.value = item.key;
    input.checked = option.selectedSeries.includes(item.key);
    text.textContent = item.label;
    row.append(input, text);
    return row;
  }));
  box.append(search, head, list);
  return box;
}

function populateAiLineSelection(option, suggestion) {
  const dataset = state.aiDataset;
  const sel = lineSelectionFor(dataset, suggestion);
  const columns = new Map(dataset.analysis.columns.map(column => [column.name, column]));
  const labelOf = name => columns.get(name)?.labelVi || humanizeField(name);
  const nodes = [];
  if (option.availableMeasures.length > 1) {
    nodes.push(aiField("Chỉ số", aiSelect(
      "ai-line-measure-selector",
      option.availableMeasures.map(item => [item.key, item.label]),
      option.activeMeasure
    )));
  }
  const regionField = aiLineRegionField(dataset, suggestion);
  if (regionField) {
    const regionLabel = labelOf(regionField);
    nodes.push(aiField(regionLabel, aiSelect("ai-line-scope", [
      ["all", `Gộp tất cả ${regionLabel.toLowerCase()}`],
      ["pick", `Chọn từng ${regionLabel.toLowerCase()}`]
    ], sel.scope)));
    if (sel.scope === "pick") nodes.push(buildAiSeriesPicker(option));
  }
  const time = dataset.analysis.columns.find(column => column.name === suggestion.bindings.x && column.role === "time");
  const times = time ? uniqueTimeValues(dataset.records, time) : [];
  if (times.length > 1) {
    const hasTime = times.some(value => value instanceof Date && !value.toISOString().endsWith("T00:00:00.000Z"));
    const choices = times.map(value => [comparableFilterValue(value), formatTimeValue(value, time, hasTime)]);
    const from = aiSelect("ai-line-range", choices, sel.from ?? choices[0][0]);
    const to = aiSelect("ai-line-range", choices, sel.to ?? choices.at(-1)[0]);
    from.dataset.edge = "from";
    to.dataset.edge = "to";
    nodes.push(aiField(`${labelOf(time.name)} từ`, from), aiField("đến", to));
  }
  $("ai-filter-controls").replaceChildren(...nodes);
  $("ai-data-filters").hidden = nodes.length === 0;
}

function syncAiLineSelection(option) {
  const selected = new Set(option.selectedSeries);
  document.querySelectorAll("#ai-filter-controls .ai-series-filter").forEach(input => {
    input.checked = selected.has(input.value);
  });
  const counter = document.querySelector("#ai-filter-controls [data-role='series-count']");
  if (counter) counter.textContent = `${option.selectedSeries.length}/${option.maxSeries}`;
}

function populateAiBarMetric(suggestion) {
  const controls = $("ai-filter-controls");
  const dataset = state.aiDataset;
  const selection = barSelectionFor(dataset, suggestion);
  const choices = barMetricOptions(dataset.analysis.columns);
  controls.replaceChildren();
  const typeField = document.createElement("div");
  const typeCaption = document.createElement("span");
  const typeOptions = document.createElement("div");
  typeField.className = "ai-control-group"; typeCaption.textContent = "Hình thức hiển thị"; typeOptions.className = "ai-bar-chart-types";
  for (const item of [
    { variant: "single", label: "Cột đơn", icon: "singleBar" },
    { variant: "grouped", label: "Cột ghép", icon: "groupedBar" }
  ]) {
    const button = document.createElement("button"); const icon = document.createElement("span"); const text = document.createElement("span");
    button.type = "button"; button.className = `ai-bar-chart-type${selection.variant === item.variant ? " active" : ""}`;
    button.dataset.barVariant = item.variant; button.setAttribute("aria-pressed", String(selection.variant === item.variant));
    button.disabled = item.variant === "grouped" && defaultBarMetrics(suggestion, dataset.analysis.columns, "grouped").length < 2;
    renderChartIcon(icon, item.icon); text.textContent = item.label; button.append(icon, text); typeOptions.append(button);
  }
  typeField.append(typeCaption, typeOptions);

  let metricControl;
  if (selection.variant === "single") {
    const select = keepSelectOpenAfterMouseClick(document.createElement("select"));
    select.className = "ai-chart-metric-selector"; select.setAttribute("aria-label", "Chọn chỉ số cho biểu đồ cột");
    select.replaceChildren(...choices.map(item => Object.assign(document.createElement("option"), { value: item.key, textContent: item.label })));
    select.value = selection.metrics[0];
    metricControl = select;
  } else {
    const picker = document.createElement("div"); const head = document.createElement("div"); const list = document.createElement("div");
    picker.className = "ai-bar-metric-picker"; head.className = "ai-bar-metric-head"; list.className = "ai-bar-metric-list";
    head.textContent = `${selection.metrics.length} đã chọn · Tối thiểu 2`;
    list.replaceChildren(...choices.map(item => {
      const row = document.createElement("label"); const input = document.createElement("input"); const text = document.createElement("span");
      input.type = "checkbox"; input.className = "ai-bar-metric-checkbox"; input.value = item.key; input.checked = selection.metrics.includes(item.key);
      text.textContent = item.label; row.append(input, text); return row;
    }));
    picker.append(head, list); metricControl = picker;
  }
  const metricField = document.createElement("div"); const metricCaption = document.createElement("span");
  metricField.className = "ai-control-group"; metricCaption.textContent = "Chỉ số"; metricField.append(metricCaption, metricControl);
  const aggregationControl = aiSelect("ai-bar-aggregation-selector", [
    ["auto", "Theo từng chỉ số"],
    ["sum", "Tổng (SUM)"],
    ["mean", "Trung bình (AVG)"],
    ["min", "Nhỏ nhất (MIN)"],
    ["max", "Lớn nhất (MAX)"]
  ], selection.aggregation);
  aggregationControl.disabled = selection.metrics.every(metric => metric === "count");
  if (aggregationControl.disabled) aggregationControl.title = "Số bản ghi luôn đếm số dòng dữ liệu.";
  controls.append(typeField, metricField, aiField("Cách tính giá trị", aggregationControl));
  $("ai-data-filters").hidden = false;
}

function activateAiChartSuggestion(suggestion, { rebuildControls = true } = {}) {
  const dataset = state.aiDataset;
  const isLine = suggestion.chartType === "line";
  const sel = isLine ? lineSelectionFor(dataset, suggestion) : null;
  const regionField = isLine ? aiLineRegionField(dataset, suggestion) : null;
  const time = isLine ? dataset.analysis.columns.find(column => column.name === suggestion.bindings.x && column.role === "time") : null;
  const records = isLine && time && sel.from && sel.to
    ? filterTimeRange(dataset.records, time, sel.from, sel.to)
    : dataset.records;
  const top = suggestion.chartType === "bar" ? dataset.barLimits?.[suggestion.id] ?? defaultBarLimit(suggestion, dataset.analysis.columns) : undefined;
  const barSelection = suggestion.chartType === "bar" ? barSelectionFor(dataset, suggestion) : null;
  const lineOptions = isLine ? {
    measure: sel.measure,
    seriesField: !regionField || sel.scope === "all" ? null : regionField,
    selectedSeries: sel.scope === "pick" && sel.picked.length ? sel.picked : null,
    scopeLabel: regionField && sel.scope === "all"
      ? `${uniqueRecordValues(dataset.records, regionField).length} ${(dataset.analysis.columns.find(column => column.name === regionField)?.labelVi || humanizeField(regionField)).toLowerCase()}`
      : ""
  } : {};
  const option = chartOptionForSuggestion(suggestion, records, dataset.analysis.columns, {
    top,
    ...(barSelection ? { variant: barSelection.variant, metrics: barSelection.metrics, aggregation: barSelection.aggregation } : {}),
    ...lineOptions
  });
  if (!option?.config?.data?.length) throw new Error("Không còn dữ liệu hợp lệ để dựng biểu đồ.");
  dataset.activeChartOption = option;
  clearMapForAiChart();
  state.mapType = suggestion.id; state.chartMapping = null; state.mappingWarning = "";
  const chartStyle = option.config.chartKind === "pie" ? state.pieStyle : state.barStyle;
  // line dùng chung barStyle nhưng nhãn số mặc định tắt; chỉ bật khi người dùng tự bật
  const lineOverrides = option.config.chartKind === "line" ? { showDataLabels: state.lineLabelsOn ?? false } : {};
  state.chartConfig = { ...option.config, ...chartStyle, ...lineOverrides, ...(suggestion.chartType === "bar" ? { limit: "all" } : {}) };
  $("chart-canvas").hidden = false; document.querySelector(".map-panel").classList.add("chart-mode");
  setDataPanelVisible(false); showChartStyleControls(true); renderChartCanvas();
  if (isLine) {
    if (rebuildControls) populateAiLineSelection(option, suggestion);
    else syncAiLineSelection(option);
  }
  else populateAiBarMetric(suggestion);
  updateModelSections(); renderAiSuggestionGrid();
  setStatus(`Đang hiển thị ${suggestion.title}.`, true);
}

function renderGeoRepair(unmatched = []) {
  const controls = $("ai-filter-controls");
  controls.querySelector(".geo-repair")?.remove();
  if (!unmatched.length) return;
  const panel = document.createElement("div"); const title = document.createElement("b"); const button = document.createElement("button");
  panel.className = "geo-repair"; title.textContent = `Chưa khớp ${unmatched.length} địa danh`;
  panel.append(title, ...unmatched.map(name => {
    const row = document.createElement("label"); const original = document.createElement("span"); const input = document.createElement("input");
    row.className = "geo-repair-row"; original.textContent = name; input.className = "geo-alias-input"; input.dataset.location = name;
    input.value = state.aiDataset.geoAliases?.[name] || ""; input.placeholder = "Tên địa danh, tỉnh/thành";
    const fields = document.createElement("div"); fields.className = "geo-repair-fields";
    const candidates = state.aiDataset.geoMatch?.candidates?.[name] || [];
    if (candidates.length > 1) {
      const choice = document.createElement("select"); choice.className = "geo-boundary-choice"; choice.dataset.location = name;
      choice.setAttribute("aria-label", `Chọn ranh giới cho ${name}`);
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = `Có ${candidates.length} kết quả — chọn vùng`; choice.append(placeholder);
      const labels = candidates.map(administrativeBoundaryLabel);
      for (const [index, feature] of candidates.entries()) {
        const option = document.createElement("option"); option.value = feature.id;
        const center = feature.center || (feature.bbox && [(feature.bbox[0] + feature.bbox[2]) / 2, (feature.bbox[1] + feature.bbox[3]) / 2]);
        const duplicate = labels.indexOf(labels[index]) !== labels.lastIndexOf(labels[index]);
        option.textContent = `${labels[index]}${duplicate && center ? ` (${center[1].toFixed(3)}, ${center[0].toFixed(3)})` : ""}`;
        choice.append(option);
      }
      choice.value = state.aiDataset.geoSelections?.[name]?.id || "";
      choice.addEventListener("change", () => {
        const feature = candidates.find(candidate => candidate.id === choice.value);
        if (feature) focusMapOnFeature(map, feature);
      });
      fields.append(choice);
    }
    fields.append(input); row.append(original, fields); return row;
  }));
  button.type = "button"; button.className = "secondary-button apply-geo-aliases"; button.textContent = "Thử ghép lại"; panel.append(button); controls.append(panel); $("ai-data-filters").hidden = false;
}

function activePointSuggestion() {
  if (state.mapType !== "point" || state.chartConfig) return null;
  const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  return suggestion?.chartType === "point" ? suggestion : null;
}

function pointModelFor(suggestion) {
  const dataset = state.aiDataset;
  dataset.pointModels ||= Object.create(null);
  return dataset.pointModels[suggestion.id] ||= createPointModel(dataset.records, dataset.analysis.columns, suggestion.bindings);
}

function pointSelectionFor(suggestion) {
  const dataset = state.aiDataset;
  dataset.pointSelections ||= Object.create(null);
  return dataset.pointSelections[suggestion.id] ||= normalizePointSelection(pointModelFor(suggestion), {
    ...dataset.pointSelectionDefaults,
    metricField: mapMetricButtons(dataset, suggestion)[0]?.field
  });
}

function populatePointControls(suggestion) {
  const model = pointModelFor(suggestion);
  const selection = pointSelectionFor(suggestion);
  const group = model.groups.find(column => column.name === selection.groupField);
  const nodes = [];
  if (model.measures.length) {
    nodes.push(aiField("Chỉ số", aiSelect("ai-point-metric", model.measures.map(column => [column.name, column.label]), selection.metricField)));
  }
  if (model.groups.length) {
    nodes.push(aiField("Hiển thị theo", aiSelect("ai-point-group", model.groups.map(column => [column.name, column.label]), selection.groupField)));
  }
  if (group) {
    const label = group.label.toLocaleLowerCase("vi");
    nodes.push(aiField(group.label, aiSelect("ai-point-mode", [["all", `Tất cả ${label}`], ["pick", `Chọn từng ${label}`]], selection.mode)));
    if (selection.mode === "pick") {
      const box = document.createElement("div"); box.className = "ai-series-picker ai-point-picker";
      const search = Object.assign(document.createElement("input"), { type: "search", className: "ai-series-search", placeholder: "Tìm…" });
      search.setAttribute("aria-label", `Tìm ${label}`);
      const counter = document.createElement("span"); counter.dataset.role = "point-group-count";
      counter.textContent = `${selection.selectedValues.length}/${POINT_GROUP_LIMIT}`;
      const reset = Object.assign(document.createElement("button"), { type: "button", className: "ai-point-reset secondary-button", textContent: `Đặt lại (top ${POINT_DEFAULT_GROUPS})` });
      const head = document.createElement("div"); head.className = "ai-series-head"; head.append(counter, reset);
      const list = document.createElement("div"); list.className = "ai-series-list";
      list.replaceChildren(...group.values.map(item => {
        const row = document.createElement("label");
        const input = Object.assign(document.createElement("input"), { type: "checkbox", className: "ai-point-value", value: item.key, checked: selection.selectedValues.includes(item.key) });
        const swatch = document.createElement("i"); swatch.className = "point-group-swatch"; swatch.setAttribute("aria-hidden", "true");
        const text = document.createElement("span"); text.textContent = item.label;
        const count = document.createElement("small"); count.textContent = item.count.toLocaleString("vi-VN");
        row.append(input, swatch, text, count);
        return row;
      }));
      box.append(search, head, list); nodes.push(box);
    }
  }
  if (model.timeColumn) {
    const choices = model.times.map(value => {
      const date = timeValueInfo(value, model.timeColumn)?.value;
      const hasTime = date instanceof Date && !date.toISOString().endsWith("T00:00:00.000Z");
      return [value, formatTimeValue(value, model.timeColumn, hasTime)];
    });
    const time = aiSelect("ai-point-time", choices, selection.time);
    const label = model.timeColumn.labelVi || humanizeField(model.timeColumn.name);
    time.setAttribute("aria-label", `${label} hiển thị bản đồ`);
    nodes.push(aiField(label, time));
  }
  const mapControls = document.createElement("div"); mapControls.className = "ai-popup-map-controls";
  mapControls.append(...nodes);
  $("ai-filter-controls").replaceChildren(...buildMapPopupControls(state.aiDataset, suggestion), mapControls);
  $("ai-data-filters").hidden = false;
  syncPointControls();
}

function syncPointControls() {
  const view = state.aiDataset?.activePointView;
  if (!view) return;
  const selected = new Set(view.selection.selectedValues);
  document.querySelectorAll("#ai-filter-controls .ai-point-value").forEach(input => {
    input.checked = selected.has(input.value);
    const swatch = input.parentElement.querySelector(".point-group-swatch");
    swatch.style.background = input.checked ? view.colors[input.value] : "#dce3ed";
  });
  const counter = document.querySelector("#ai-filter-controls [data-role='point-group-count']");
  if (counter) counter.textContent = `${selected.size}/${POINT_GROUP_LIMIT}`;
  document.querySelectorAll("#ai-filter-controls .ai-point-time").forEach(select => { select.value = view.selection.time; });
}

function pointMetricText(metric) {
  if (!metric) return "";
  const label = metric.unit && !metric.label.toLocaleLowerCase("vi").includes(metric.unit.toLocaleLowerCase("vi")) ? `${metric.label} (${metric.unit})` : metric.label;
  const format = value => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
  const range = metric.min == null ? "Không có giá trị hợp lệ" : metric.min === metric.max ? format(metric.min) : `${format(metric.min)} – ${format(metric.max)}`;
  return `Kích thước theo ${label}: ${range}${metric.missingCount ? ` · ${metric.missingCount.toLocaleString("vi-VN")} điểm thiếu chỉ số (cỡ nhỏ nhất)` : ""}`;
}

function pointColorOverridesFor(suggestion) {
  const dataset = state.aiDataset;
  dataset.pointColorOverrides ||= Object.create(null);
  const byField = dataset.pointColorOverrides[suggestion.id] ||= Object.create(null);
  return byField[pointSelectionFor(suggestion).groupField] ||= Object.create(null);
}

function renderPointStyleControls() {
  const style = mergePointStyle(state.pointStyle);
  for (const [id, key] of [["point-size", "size"], ["point-opacity", "opacity"], ["point-border-width", "borderWidth"], ["point-color", "color"], ["point-border-color", "borderColor"]]) $(id).value = style[key];
  $("point-size-value").value = `${style.size}%`;
  $("point-opacity-value").value = `${Math.round(style.opacity * 100)}%`;
  $("point-border-width-value").value = `${style.borderWidth} px`;
  $("point-color-value").textContent = style.color.toUpperCase();
  $("point-border-color-value").textContent = style.borderColor.toUpperCase();
  $("point-show-border").checked = style.showBorder;
  $("point-show-legend").checked = style.showLegend;
  const view = activePointSuggestion() ? state.aiDataset.activePointView : null;
  const grouped = Boolean(view?.metric) && view.selection.mode === "pick";
  $("point-fixed-color-field").hidden = grouped;
  $("point-group-color-field").hidden = !grouped;
  $("point-show-legend-field").hidden = !view?.metric;
  $("point-group-colors").replaceChildren(...(grouped ? view.legendRows.map(item => {
    const row = document.createElement("label"); row.className = "bar-color-row";
    const label = document.createElement("span"); label.textContent = item.label; label.title = item.label;
    const control = document.createElement("span"); control.className = "color-control";
    const input = Object.assign(document.createElement("input"), { type: "color", value: item.color, className: "point-group-color" });
    input.dataset.value = item.key; input.setAttribute("aria-label", `Màu ${item.label}`);
    const code = document.createElement("code"); code.textContent = item.color.toUpperCase();
    control.append(input, code); row.append(label, control);
    return row;
  }) : []));
}

function buildActivePointView(suggestion) {
  const dataset = state.aiDataset;
  const model = pointModelFor(suggestion);
  const selection = pointSelectionFor(suggestion);
  dataset.pointColors ||= Object.create(null);
  const byField = dataset.pointColors[suggestion.id] ||= Object.create(null);
  const view = buildPointView(model, selection, byField[selection.groupField], { ...state.pointStyle, groupColors: pointColorOverridesFor(suggestion) });
  byField[view.selection.groupField] = view.paletteColors;
  dataset.pointSelections[suggestion.id] = view.selection;
  dataset.activePointView = view;
  return view;
}

function refreshPointStyle() {
  const suggestion = activePointSuggestion();
  if (suggestion) { buildActivePointView(suggestion); syncPointControls(); }
  applyStyle();
}

function renderPointLegend() {
  const legend = $("point-legend");
  const view = state.aiDataset?.activePointView;
  legend.hidden = !activePointSuggestion() || !view?.metric || !state.pointStyle.showLegend || !$("show-map-layers").checked || !view.stats.visibleCount;
  if (legend.hidden) return;
  const heading = document.createElement("div"); heading.className = "point-legend-heading";
  const title = document.createElement("strong"); title.textContent = view.legendTitle;
  const count = document.createElement("span"); count.textContent = `${view.stats.visibleCount.toLocaleString("vi-VN")} điểm`;
  heading.append(title, count);
  const list = document.createElement("div"); list.className = "point-legend-rows";
  for (const item of view.legendRows) {
    const row = document.createElement("div"); row.className = "point-legend-row";
    const swatch = document.createElement("i"); swatch.style.background = item.color; swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span"); label.textContent = item.label;
    const amount = document.createElement("b"); amount.textContent = item.count.toLocaleString("vi-VN");
    row.append(swatch, label, amount); list.append(row);
  }
  const note = document.createElement("small");
  note.textContent = [view.selection.time ? formatTimeValue(view.selection.time, popupTimeColumn(state.aiDataset.analysis.columns)) : "",
    pointMetricText(view.metric) || "Kích thước điểm thay đổi theo mức thu phóng"].filter(Boolean).join(" · ");
  legend.replaceChildren(heading, list, note);
}

function refreshPointView(suggestion, { rebuildControls = false } = {}) {
  const dataset = state.aiDataset;
  const model = pointModelFor(suggestion);
  const view = buildActivePointView(suggestion);
  dataset.spatialData = model.data;
  pointPopup?.remove(); pointPopup = null;
  state.h3Data = EMPTY_FEATURE_COLLECTION; state.pointData = view.data;
  state.boundary = view.data; state.sourceBoundary = model.data; state.mapType = "point";
  state.dataProfile = analyzeSpatialData(view.data, { numericFields: model.measures.map(column => column.name) });
  map.getSource("h3-grid")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("point-data")?.setData(view.data);
  map.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  if (rebuildControls) populatePointControls(suggestion);
  else syncPointControls();
  updateModelSections(); applyStyle();
  setCurrentFileNote(`${view.stats.visibleCount.toLocaleString("vi-VN")}/${view.stats.totalCount.toLocaleString("vi-VN")} điểm · ${Math.round(view.stats.coordinateRate * 100)}% tọa độ hợp lệ`);
  refreshMapPopup();
  setStatus(view.stats.visibleCount ? `Đang hiển thị ${view.stats.visibleCount.toLocaleString("vi-VN")} điểm dữ liệu.` : "Không có điểm phù hợp với bộ lọc. Hãy chọn nhóm hoặc thời gian khác.", view.stats.visibleCount > 0);
}

function activeRoadSuggestion() {
  const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  return state.mapType === "line" && !state.chartConfig && suggestion?.chartType === "map_line" ? suggestion : null;
}

function renderRoadLegend() {
  const legend = $("ai-line-legend");
  const suggestion = activeRoadSuggestion();
  legend.hidden = !suggestion || !state.roadDisplayStyle.showLegend || !state.lineData.features.length || !$("show-map-layers").checked;
  if (legend.hidden) return;
  const dataset = state.aiDataset;
  const field = suggestion.bindings.value || dataset.recommendation.metricField;
  if (!field) { legend.hidden = true; return; }
  const column = dataset.analysis.columns.find(column => column.name === field);
  const heading = document.createElement("div"); heading.className = "point-legend-heading";
  const title = document.createElement("strong"); title.textContent = column?.labelVi || field || "Chuỗi tọa độ";
  heading.append(title);
  const rows = document.createElement("div"); rows.className = "point-legend-rows";
  for (const item of dataset.roadStyle?.rows || []) {
    const row = document.createElement("div"); row.className = "point-legend-row";
    const swatch = document.createElement("i"); swatch.style.background = item.color;
    const label = document.createElement("span"); label.textContent = item.label;
    row.append(swatch, label); rows.append(row);
  }
  const note = document.createElement("small");
  const timeFilter = dataset.recommendation.filters.find(filter => ["date-select", "datetime-select"].includes(filter.control));
  const time = timeFilter ? displayFilterValue(dataset.filters[timeFilter.field], timeFilter.control) : "";
  note.textContent = `${time ? `${time} · ` : ""}${state.lineData.stats.matchedRows}/${state.lineData.stats.totalRows} bản ghi khớp · ${state.lineData.features.length.toLocaleString("vi-VN")} đoạn đường`;
  legend.replaceChildren(heading, rows, note);
}

function refreshAiRoadMap({ fit = false } = {}) {
  if (state.aiDataset?.nativeGeometry) return refreshNativeMap({ fit });
  const suggestion = activeRoadSuggestion(); const dataset = state.aiDataset;
  if (isCoordinateLine(suggestion)) return refreshAiCoordinateLine({ fit });
  if (!suggestion || !dataset.roadArea?.field || !dataset.roadArea.networkIds.every(id => dataset.roadGeometries?.[id])) return;
  dataset.filters = selectedAiFilters();
  const records = applyPipelineFilters(dataset.records, dataset.filters);
  const data = joinRoadRecordsByArea(records, dataset.roadGeometries, {
    areaField: dataset.roadArea.field,
    roadField: suggestion.bindings.region, valueField: suggestion.bindings.value,
    columns: dataset.analysis.columns, aggregation: resolveAggregation(suggestion, dataset.analysis.columns)
  });
  state.lineData = data;
  dataset.roadStyle = aiLineStyle(data, suggestion);
  map.getSource("line-data")?.setData(data);
  updateModelSections(); applyStyle();
  refreshMapPopup();
  if (fit && data.features.length) fitGeoJSON(data);
  const stats = data.stats;
  const areaLabels = dataset.roadArea.networkIds.map(id => ROAD_NETWORKS.find(network => network.id === id)?.label || id);
  const skipped = dataset.roadArea.unknownAreas.length ? ` Bỏ qua khu vực chưa hỗ trợ: ${dataset.roadArea.unknownAreas.join(", ")}.` : "";
  setCurrentFileNote(`${stats.matchedRows}/${stats.totalRows} bản ghi khớp · ${stats.segmentCount.toLocaleString("vi-VN")} đoạn đường`);
  setStatus(data.features.length ? `Đang hiển thị Bản đồ Line tại ${areaLabels.join(", ")}.${skipped}`
    : `Không có tuyến khớp. Hãy kiểm tra Khu vực, tên/mã đường hoặc bộ lọc đã chọn.${skipped}`, data.features.length > 0);
}

function refreshAiCoordinateLine({ fit = false } = {}) {
  const dataset = state.aiDataset; const suggestion = activeRoadSuggestion();
  if (!isCoordinateLine(suggestion)) return;
  dataset.filters = selectedAiFilters();
  const data = buildCoordinateLines(applyPipelineFilters(dataset.records, dataset.filters), dataset.analysis.columns, suggestion.bindings);
  state.lineData = data;
  dataset.roadStyle = aiLineStyle(data, suggestion);
  map.getSource("line-data")?.setData(data);
  updateModelSections(); applyStyle(); refreshMapPopup();
  if (fit && data.features.length) fitGeoJSON(data);
  setCurrentFileNote(`${data.features.length} tuyến · ${Math.round(data.stats.coordinateRate * 100)}% tọa độ hợp lệ`);
  setStatus(data.features.length ? "Đang hiển thị các chuỗi tọa độ trên Bản đồ Line."
    : "Chưa có chuỗi gồm ít nhất hai tọa độ khác nhau. Kiểm tra nhóm tuyến, cột thứ tự hoặc dữ liệu tọa độ.", data.features.length > 0);
}

async function loadAiRoadNetwork({ fit = false } = {}) {
  cancelAiBoundaryLoad();
  const dataset = state.aiDataset; const suggestion = activeRoadSuggestion();
  if (!dataset || !suggestion) return null;
  const area = roadNetworksFromRecords(dataset.records, dataset.analysis.columns);
  dataset.roadArea = area; dataset.roadGeometries ||= {};
  state.lineData = EMPTY_FEATURE_COLLECTION;
  map.getSource("line-data")?.setData(EMPTY_FEATURE_COLLECTION);
  closeMapPopup();
  updateModelSections(); applyStyle();
  if (!area.field) { setStatus("Cần cột Khu vực để tự động xác định mạng đường thuộc tỉnh/thành phố nào."); return true; }
  if (!area.networkIds.length) {
    const values = area.unknownAreas.length ? `: ${area.unknownAreas.join(", ")}` : "";
    setStatus(`Không nhận diện được mạng đường từ cột ${area.field}${values}.`);
    return true;
  }
  const missing = area.networkIds.filter(id => !dataset.roadGeometries[id]);
  if (!missing.length) { refreshAiRoadMap({ fit }); return true; }
  const controller = createAbortController(); aiBoundaryAbortController = controller;
  const revision = aiBoundaryRevision;
  const isCurrent = () => revision === aiBoundaryRevision && dataset === state.aiDataset && dataset.selectedSuggestionId === suggestion.id;
  setStatus("Đang tải mạng đường để ghép dữ liệu tuyến…");
  try {
    const loaded = await Promise.all(missing.map(async id => {
      const url = roadNetworkUrl(id);
      if (!url) throw new Error(`Chưa có dữ liệu mạng đường cho ${ROAD_NETWORKS.find(network => network.id === id)?.label || id}.`);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Không tải được mạng đường (HTTP ${response.status}).`);
      const geometry = await response.json();
      if (geometry?.type !== "FeatureCollection" || !Array.isArray(geometry.features)) throw new Error("Mạng đường không hợp lệ.");
      return [id, geometry];
    }));
    if (!isCurrent()) return null;
    for (const [id, geometry] of loaded) dataset.roadGeometries[id] = geometry;
    refreshAiRoadMap({ fit });
    return true;
  } catch (error) {
    if (error?.name === "AbortError" || !isCurrent()) return null;
    setStatus(`Không thể hiển thị tuyến: ${error.message}`);
    return true;
  } finally {
    if (aiBoundaryAbortController === controller) aiBoundaryAbortController = null;
  }
}

async function activateAiRoadMap(suggestion) {
  const dataset = state.aiDataset;
  dataset.recommendation = recommendationForSuggestion(suggestion);
  populateAiFilters(dataset);
  state.chartConfig = null; state.chartMapping = null; state.mappingWarning = "";
  clearChartCanvas(); clearMapForAiChart();
  state.mapType = "line"; state.dataProfile = null;
  $("show-map-lines").checked = true;
  $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  setDataPanelVisible(false); showChartStyleControls(false);
  renderAiSuggestionGrid();
  map.resize();
  if (isCoordinateLine(suggestion)) {
    cancelAiBoundaryLoad(); refreshAiCoordinateLine({ fit: true }); return true;
  }
  return loadAiRoadNetwork({ fit: true });
}

function activateAiPoint(suggestion) {
  cancelAiBoundaryLoad();
  const dataset = state.aiDataset;
  const firstActivation = !dataset.pointSelections?.[suggestion.id];
  dataset.recommendation = recommendationForSuggestion(suggestion);
  state.chartConfig = null; state.chartMapping = null; state.mappingWarning = "";
  clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  setDataPanelVisible(false); showChartStyleControls(false);
  refreshPointView(suggestion, { rebuildControls: true });
  renderAiSuggestionGrid();
  if (firstActivation) fitGeoJSON(pointModelFor(suggestion).data);
  return true;
}

async function refreshAiH3({ fit = false } = {}) {
  const dataset = state.aiDataset; const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  if (!dataset || suggestion?.chartType !== "hex_h3") return;
  const filters = selectedAiFilters(); dataset.filters = filters;
  const records = applyPipelineFilters(dataset.records, filters);
  const aggregation = resolveAggregation(suggestion, dataset.analysis.columns);
  const result = recordsToAggregatedH3(records, {
    latField: suggestion.bindings.lat,
    lngField: suggestion.bindings.lng,
    valueField: suggestion.bindings.value,
    aggregation,
    resolution: state.resolution,
    columns: dataset.analysis.columns
  });
  if (result.stats.coordinateRate < .7 || result.stats.cellCount < 2) throw new Error("Không đủ tọa độ hợp lệ để tạo ít nhất hai ô H3.");
  if (!dataset.spatialData) {
    dataset.spatialData = {
      type: "FeatureCollection",
      features: dataset.records.flatMap(record => {
        if (record?.[suggestion.bindings.lat] == null || record?.[suggestion.bindings.lat] === "" || record?.[suggestion.bindings.lng] == null || record?.[suggestion.bindings.lng] === "") return [];
        const latitude = Number(record?.[suggestion.bindings.lat]); const longitude = Number(record?.[suggestion.bindings.lng]);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
        return [{ type: "Feature", properties: { ...record }, geometry: { type: "Point", coordinates: [longitude, latitude] } }];
      })
    };
  }
  state.h3Data = result.data; state.pointData = dataset.spatialData || EMPTY_FEATURE_COLLECTION;
  state.boundary = state.pointData; state.sourceBoundary = state.pointData; state.mapType = "h3";
  state.dataProfile = analyzeSpatialData(result.data, { numericFields: [suggestion.bindings.value].filter(Boolean) });
  map.getSource("h3-grid")?.setData(result.data); map.getSource("point-data")?.setData(state.pointData);
  map.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION); map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  $("cell-count").textContent = result.stats.cellCount.toLocaleString("vi-VN"); $("cell-label").textContent = `Tổng số cell (res ${state.resolution})`;
  updateModelSections(); syncPolygonPaletteControls(); applyStyle(); updateDashboard();
  if (fit) fitGeoJSON(state.pointData);
  setCurrentFileNote(`${result.stats.cellCount} ô H3 · ${Math.round(result.stats.coordinateRate * 100)}% tọa độ hợp lệ`);
}

async function activateAiH3(suggestion) {
  cancelAiBoundaryLoad();
  const dataset = state.aiDataset;
  dataset.recommendation = recommendationForSuggestion(suggestion);
  populateAiFilters(dataset);
  state.chartConfig = null; state.chartMapping = null; clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode"); showChartStyleControls(false);
  state.polygonPalette = state.polygonPalette || "viridis";
  await refreshAiH3({ fit: true }); renderAiSuggestionGrid();
  setStatus(`Đã tạo ${suggestion.title}.`, true);
  return true;
}

async function selectAiSuggestion(id) {
  const suggestion = state.aiDataset?.suggestions.find(item => item.id === id);
  if (!suggestion) return false;
  if (state.aiDataset.selectedSuggestionId !== id) closeMapPopup();
  if (!suggestion.available && suggestion.repairable) {
    cancelAiBoundaryLoad();
    state.aiDataset.selectedSuggestionId = id;
    state.aiDataset.recommendation = recommendationForSuggestion(suggestion);
    populateAiFilters(state.aiDataset);
    renderGeoRepair(suggestion.geoUnmatched || []);
    renderAiSuggestionGrid();
    setStatus("Hãy nhập alias cho địa danh chưa khớp rồi chọn Thử ghép lại.", true);
    return true;
  }
  if (!suggestion.available) return false;
  state.aiDataset.selectedSuggestionId = id;
  if (state.aiDataset.nativeGeometry) { activateNativeMap(suggestion); return true; }
  if (["bar", "line"].includes(suggestion.chartType)) {
    cancelAiBoundaryLoad();
    activateAiChartSuggestion(suggestion);
    return true;
  }
  if (suggestion.chartType === "point") return activateAiPoint(suggestion);
  if (suggestion.chartType === "map_line") return activateAiRoadMap(suggestion);
  if (suggestion.chartType === "choropleth") return activateAiChoropleth(suggestion);
  return activateAiH3(suggestion);
}

async function filteredAiBoundary({ fit = false } = {}) {
  if (!state.aiDataset) return;
  if (state.aiDataset.nativeGeometry) return refreshNativeMap({ fit });
  const selected = state.aiDataset.suggestions?.find(item => item.id === state.aiDataset.selectedSuggestionId);
  if (selected?.chartType === "hex_h3") return refreshAiH3({ fit });
  if (selected?.chartType === "map_line") return refreshAiRoadMap({ fit });
  if (selected?.chartType !== "choropleth") return;
  const { records, boundaries, recommendation } = state.aiDataset;
  const filters = selectedAiFilters(); state.aiDataset.filters = filters;
  const searchBoundary = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, {
    filters, columns: state.aiDataset.analysis.columns, includeMissingMetric: true
  });
  const categorical = usesCategoricalPolygonColor();
  const joined = categorical ? collapseCountryFeatures(searchBoundary, recommendation.geometry.field, { categoryField: recommendation.metricField }) : searchBoundary;
  const data = categorical ? { ...joined, features: joined.features.filter(feature => featureCategoryValues(feature.properties, recommendation.metricField).length) } : recommendation.metricField
    ? { ...searchBoundary, features: searchBoundary.features.filter(feature => Number.isFinite(feature.properties.__metric)) }
    : collapseCountryFeatures(searchBoundary, recommendation.geometry.field);
  state.aiDataset.searchBoundary = categorical ? joined : recommendation.metricField ? searchBoundary : data;
  state.boundary = data; state.sourceBoundary = data;
  state.baselineCount = null;
  const numericFields = [recommendation.metricField, ...recommendation.numericFields].filter((field, index, fields) => recommendation.numericFields.includes(field) && fields.indexOf(field) === index);
  state.dataProfile = analyzeSpatialData(data, { numericFields, hasArea: true });
  map.getSource("polygon-data")?.setData(data);
  map.getSource("vietnam-boundary")?.setData(data);
  if (state.mapType === "h3" || isRegionHexMode()) await rebuildGrid({ fit });
  else {
    syncPolygonPaletteControls(); applyStyle();
    if (fit && data.features.length) fitBoundary();
  }
  setCurrentFileNote(`${data.features.length} khu vực · ${recommendation.metricField || "Màu mặc định"} · ${recommendation.source === "ai" ? "GPT-5.6 Luna đề xuất" : "quy tắc dự phòng"}`);
  refreshMapPopup();
}

async function activateAiChoropleth(suggestion) {
  cancelAiBoundaryLoad();
  const controller = createAbortController();
  aiBoundaryAbortController = controller;
  const revision = aiBoundaryRevision;
  const dataset = state.aiDataset;
  const records = dataset.records;
  const recommendation = recommendationForSuggestion(suggestion);
  const name = dataset.fileName;
  dataset.recommendation = recommendation;
  const countryField = recommendation.geometry.contextFields?.find(field => dataset.analysis.columns.find(column => column.name === field)?.geoLevel === "country");
  const contexts = Object.fromEntries(records.map(record => [geographicLocationName(record, recommendation.geometry), {
    country: countryField ? String(record[countryField] ?? "").trim() || null
      : recommendation.geometry.country || (recommendation.geometry.placeType === "country" ? null : "VNM")
  }]).filter(([name]) => name));
  const locations = Object.keys(contexts);
  const geometryLabel = recommendation.filters.find(filter => filter.field === recommendation.geometry.field)?.label || recommendation.geometry.field;
  setStatus(`Đang ghép ranh giới cho ${locations.length} giá trị ${geometryLabel}…`);
  let resolvedBoundaries; let boundaries;
  try {
    resolvedBoundaries = await loadAdministrativeBoundaries(locations, {
      apiKey: CONFIG.MAPTILER_API_KEY,
      placeType: recommendation.geometry.placeType,
      country: recommendation.geometry.country,
      contexts,
      strict: false,
      aliases: dataset.geoAliases || {},
      selections: dataset.geoSelections || {},
      signal: controller.signal,
      onProgress: ({ completed, total }) => setStatus(`Đang ghép ranh giới… ${completed}/${total}`)
    });
    if (revision !== aiBoundaryRevision || dataset !== state.aiDataset || dataset.selectedSuggestionId !== suggestion.id) return null;
    setStatus("Đang chuẩn hóa ranh giới hành chính…");
    boundaries = {
      ...resolvedBoundaries,
      features: await Promise.all(resolvedBoundaries.features.map(async boundary =>
        await landOnlyBoundary(boundary, {
          country: recommendation.geometry.placeType === "country" ? undefined
            : countryField ? contexts[boundary.properties?.__data_location]?.country
              : recommendation.geometry.country || "VNM",
          signal: controller.signal
        }) || boundary
      ))
    };
    if (revision !== aiBoundaryRevision || dataset !== state.aiDataset || dataset.selectedSuggestionId !== suggestion.id) return null;
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw error;
  } finally {
    if (aiBoundaryAbortController === controller) aiBoundaryAbortController = null;
  }
  dataset.boundaries = boundaries;
  dataset.geoMatch = { matched: resolvedBoundaries.matched, unmatched: resolvedBoundaries.unmatched, matchRate: resolvedBoundaries.matchRate, candidates: resolvedBoundaries.candidates };
  suggestion.boundaryBaseFeasibility ??= suggestion.feasibilityScore;
  suggestion.feasibilityScore = Math.min(suggestion.boundaryBaseFeasibility, resolvedBoundaries.matchRate);
  suggestion.effectiveConfidence = suggestion.confidence;
  const initialFilters = populateAiFilters(dataset);
  renderGeoRepair(resolvedBoundaries.unmatched);
  if (boundaries.features.length < 1 || resolvedBoundaries.matchRate < .7) {
    suggestion.available = false;
    suggestion.repairable = resolvedBoundaries.unmatched.length > 0;
    suggestion.geoUnmatched = resolvedBoundaries.unmatched;
    suggestion.unavailableReason = `Chỉ khớp ${boundaries.features.length}/${locations.length} địa danh (${Math.round(resolvedBoundaries.matchRate * 100)}%). Hãy sửa tên hoặc chọn vùng chưa khớp.`;
    clearMapForAiChart(); clearChartCanvas(); state.chartConfig = null; state.mapType = null;
    $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
    updateModelSections(); renderAiSuggestionGrid();
    setStatus(suggestion.unavailableReason, true);
    return false;
  }
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: initialFilters, columns: dataset.analysis.columns });
  const numericFields = [recommendation.metricField, ...recommendation.numericFields].filter((field, index, fields) => recommendation.numericFields.includes(field) && fields.indexOf(field) === index);
  // A period with no metric values still supports switching to another period or metric.
  const profile = analyzeSpatialData(data, { numericFields, hasArea: true });
  await replaceBoundary(data, name, profile, { preservePolygons: true, preserveAi: true });
  dataset.recommendation = recommendation; dataset.boundaries = boundaries;
  state.aiDataset = dataset;
  suggestion.repairable = false; suggestion.geoUnmatched = [];
  state.dataOrigin = "ai"; state.mapType = "polygon"; state.polygonPalette = "diverging";
  await filteredAiBoundary();
  renderAiSuggestionGrid();
  setStatus(`Đã tạo bản đồ ${recommendation.title}.`, true);
  return true;
}

async function replaceAiMapData(records, recommendation, name) {
  const profile = { rowCount: records.length, columns: recommendation.numericFields.map(field => ({ name: field, inferredType: "number" })) };
  const pipeline = await requestAiDataAnalysis(records, { profile, source: { fileName: name } });
  return replaceAiPipelineData({ ...pipeline, rawRecords: records }, name);
}

async function replaceAiPipelineData(pipeline, name) {
  clearAiMapState(); clearChartCanvas();
  state.chartConfig = null; state.chartMapping = null; state.mappingWarning = ""; state.activeChartKind = null;
  state.mapType = null; state.dataProfile = null;
  state.dataOrigin = "ai"; state.boundary = null; state.sourceBoundary = null; state.h3Data = EMPTY_FEATURE_COLLECTION; state.pointData = EMPTY_FEATURE_COLLECTION;
  map.getSource("h3-grid")?.setData(EMPTY_FEATURE_COLLECTION); map.getSource("point-data")?.setData(EMPTY_FEATURE_COLLECTION);
  map.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION); map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
  state.chartAnalysis = null; state.chartOptions = [];
  const suggestions = prepareSuggestions(pipeline.analysis, pipeline.records, pipeline.validRowRate, { mapOnly: true });
  state.aiDataset = {
    ...pipeline,
    fileName: name,
    roadArea: roadNetworksFromRecords(pipeline.records, pipeline.analysis.columns),
    roadGeometries: {},
    suggestions,
    selectedSuggestionId: null,
    geoAliases: {},
    geoSelections: {},
    lineSelections: {},
    barSelections: {},
    barLimits: {},
    popupSelections: {},
    recommendation: null,
    boundaries: null
  };
  showCurrentFile(name, `${pipeline.records.length.toLocaleString("vi-VN")} bản ghi · ${pipeline.analysis.source === "ai" ? "AI đã phân tích" : "AI chưa phân tích được dữ liệu"}`);
  $("chart-canvas").hidden = true;
  document.querySelector(".map-panel").classList.remove("chart-mode"); setDataPanelVisible(false); showChartStyleControls(false);
  renderAiSuggestionGrid();
  let selected = false;
  const visibleSuggestions = mapDisplaySuggestions(suggestions);
  const initialSuggestions = visibleSuggestions;
  for (const suggestion of initialSuggestions.filter(item => item.available)) {
    const result = await selectAiSuggestion(suggestion.id);
    if (result === null) return;
    if (result) { selected = true; break; }
  }
  if (!selected) {
    updateModelSections();
    setStatus(pipeline.fallbackReason || "AI chưa đề xuất được bản đồ khả dụng. Xem kết quả phân tích và lý do của từng đề xuất.");
  }
}

function selectChartOption(type) {
  const option = state.chartOptions.find(item => item.id === type);
  if (!option) return false;
  if (state.aiDataset) {
    state.aiDataset.selectedSuggestionId = null;
    $("ai-filter-controls").replaceChildren(); $("ai-data-filters").hidden = true;
  }
  const chartStyle = option.config.chartKind === "pie" ? state.pieStyle : state.barStyle;
  const lineOverrides = option.config.chartKind === "line" ? { showDataLabels: state.lineLabelsOn ?? false } : {};
  state.mapType = option.id; state.chartConfig = { ...option.config, ...chartStyle, ...lineOverrides };
  state.chartMapping = { datasetPath: option.config.sourcePath, xField: option.config.xField, metrics: option.config.series.map(item => item.key) };
  state.mappingWarning = "";
  document.querySelectorAll("#map-type-grid .map-type").forEach(button => button.classList.toggle("active", button.dataset.type === type));
  renderChartCanvas(); renderChartDataMapping(); renderChartStyleControls();
  updateModelSections();
  if (state.aiDataset) renderAiSuggestionGrid();
  setStatus(`Đang hiển thị kiểu ${option.label}.`, true);
  return true;
}

function replaceChartData(analysis, name) {
  clearAiMapState();
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
  showCurrentFile(name, "Dữ liệu biểu đồ đã tải · đang sử dụng");
  const canvas = $("chart-canvas"); canvas.hidden = false; document.querySelector(".map-panel").classList.add("chart-mode");
  setDataPanelVisible(false); showChartStyleControls(true); selectChartOption(options[0].id);
}
async function replaceBoundary(data, name, profile = null, { preservePolygons = false, preserveAi = false } = {}) {
  regionHexBuildRevision += 1;
  state.regionHexEnabled = false; state.regionHexResolution = CONFIG.DEFAULT_RESOLUTION;
  $("region-hex-note").textContent = "";
  if (!preserveAi) clearAiMapState();
  state.chartConfig = null; state.chartOptions = []; state.chartAnalysis = null; state.chartMapping = null; state.mappingWarning = ""; clearDataMappingPanel($("data-mapping-controls")); clearChartCanvas(); $("chart-canvas").hidden = true; document.querySelector(".map-panel").classList.remove("chart-mode");
  showChartStyleControls(false);
  if (!data) throw new Error("Không tìm thấy dữ liệu.");
  state.dataOrigin = "upload";
  if (preservePolygons) state.mapType = "polygon";
  else geoJSONToCells(data, Math.min(state.resolution, 3));
  state.sourceBoundary = data; state.boundary = data;
  setupProvinceFilter(preserveAi ? EMPTY_FEATURE_COLLECTION : data);
  renderCompatibleMapTypes(data, profile || analyzeSpatialData(data));
  state.pointData = pointFeatureCollection(data); map.getSource("point-data")?.setData(state.pointData); applyHeatmapWeight();
  const features = data.type === "FeatureCollection" ? data.features : data.type === "Feature" ? [data] : [{ type: "Feature", properties: {}, geometry: data }];
  state.lineData = { type: "FeatureCollection", features: features.filter(feature => ["LineString", "MultiLineString"].includes(feature.geometry?.type)) };
  map.getSource("line-data")?.setData(state.lineData);
  map.getSource("polygon-data")?.setData(data); updateModelSections();
  map.getSource("vietnam-boundary")?.setData(data); showCurrentFile(name, "Dữ liệu đã tải · đang sử dụng"); state.baselineCount = null;
  if (preservePolygons) {
    state.h3Data = EMPTY_FEATURE_COLLECTION; map.getSource("h3-grid")?.setData(state.h3Data); updateDashboard(); fitBoundary();
  } else await rebuildGrid({ fit: true });
  refreshClippedUploadLayers();
  applyStyle();
}

// Search follows the active filters and retains regions with a missing color metric.
function currentDataSearch() {
  if (!state.mapType || state.chartConfig || !state.aiDataset && !state.dataProfile) { return {}; }
  const suggestion = activeMapPopupSuggestion();
  const dataset = state.aiDataset;
  const data = state.mapType === "point" ? state.pointData
    : state.mapType === "line" ? state.lineData
      : suggestion?.chartType === "choropleth" && dataset?.searchBoundary ? dataset.searchBoundary : state.boundary;
  if (state.aiDataset && !suggestion) { return {}; }
  if (!state.aiDataset && dataSearchProfile !== state.dataProfile) {
    dataSearchProfile = state.dataProfile;
    dataSearchColumns = (state.dataProfile.textFields || [])
      .filter(name => !name.startsWith("__"))
      .map(name => ({ name, role: "text" }));
  }
  const columns = state.aiDataset?.analysis.columns || state.spatialAnalysis?.columns || dataSearchColumns;
  const titleField = state.aiDataset?.nativeTitleField || (suggestion?.chartType === "point" ? pointTitleField(columns)
    : state.aiDataset?.recommendation?.geometry?.field);
  const pointSelection = dataset?.activePointView?.selection;
  const filtered = dataset ? Object.values(dataset.filters || {}).some(value =>
    Array.isArray(value) ? value.length > 0 : value != null && value !== "")
    || suggestion?.chartType === "point" && Boolean(pointSelection?.mode === "pick" || pointSelection?.time)
    : selectedProvinceNames().length > 0;
  return { data, columns, titleField, chartType: dataset?.nativeGeometry ? undefined : suggestion?.chartType,
    search_bar: dataset?.analysis.search_bar ?? state.spatialAnalysis?.search_bar, search_fields: dataset?.analysis.search_fields || state.spatialAnalysis?.search_fields,
    regionNavigation: dataset?.analysis.regionNavigation ?? state.spatialAnalysis?.regionNavigation,
    filtered, sourceRecords: dataset?.records, locationKeys: dataset?.boundaries?.locationKeys };
}

function syncDataSearch() {
  const data = currentDataSearch();
  mapSearch?.setData(data.data ? data : undefined);
}

function showSheetSelection(file, sheetNames, fileKey = null) {
  state.pendingSheet = { file, fileKey };
  $("sheet-selector").replaceChildren(...sheetNames.map(name => Object.assign(document.createElement("option"), { value: name, textContent: name })));
  $("sheet-selector-field").hidden = false;
  setStatus(`${file.name} có ${sheetNames.length} sheet. Hãy chọn sheet cần phân tích.`);
}

async function applyReadResult(result, file) {
  if (result.kind === "sheet-selection") return showSheetSelection(file, result.sheetNames);
  registerPrimaryUpload(file, { data: result.data });
  if (result.nativePipeline) {
    const dataset = nativeMapDataset(result.data, result.nativePipeline, file.name);
    if (dataset) {
      state.aiDataset = dataset; state.dataOrigin = "ai";
      if (dataset.suggestions.length) activateNativeMap(dataset.suggestions[0]);
      else {
        state.mapType = null;
        showCurrentFile(file.name, dataset.fallbackReason || "AI chưa đề xuất được bản đồ phù hợp với geometry.");
        renderAiSuggestionGrid(); updateModelSections();
      }
      renderUploadedFiles(); return;
    }
  }
  if (result.kind === "ai-pipeline") await replaceAiPipelineData(result.pipeline, file.name);
  else if (result.kind === "ai-map") await replaceAiMapData(result.records, result.recommendation, file.name);
  else if (result.kind === "chart") replaceChartData(result.analysis, file.name);
  else throw new Error("Chưa có kết quả phân tích AI cho dữ liệu này.");
  renderUploadedFiles();
}

function activateNativeMap(suggestion) {
  const dataset = state.aiDataset;
  dataset.selectedSuggestionId = suggestion.id;
  dataset.recommendation = recommendationForSuggestion(suggestion);
  dataset.recommendation.geometry.provider = "native";
  dataset.recommendation.filters = dataset.recommendation.filters.filter(filter => !filter.field.startsWith("__"));
  state.mapType = suggestion.chartType === "choropleth" ? "polygon" : "line";
  populateAiFilters(dataset); renderAiSuggestionGrid(); refreshNativeMap();
}

function refreshNativeMap({ fit = false } = {}) {
  const dataset = state.aiDataset;
  dataset.filters = selectedAiFilters();
  const data = nativeMapView(dataset, dataset.filters);
  if (usesCategoricalPolygonColor()) for (const feature of data.features) feature.properties = { ...feature.properties,
    ...categoryColorProperties(dataset.recommendation.metricField, featureCategoryValues(feature.properties, dataset.recommendation.metricField)) };
  state.boundary = data;
  state.sourceBoundary = { type: "FeatureCollection", features: dataset.nativeGeometry.features };
  state.dataProfile = analyzeSpatialData(data, { numericFields: [dataset.recommendation.metricField, ...dataset.recommendation.numericFields]
    .filter((field, index, fields) => dataset.recommendation.numericFields.includes(field) && fields.indexOf(field) === index) });
  if (state.mapType === "line") {
    state.lineData = data; dataset.roadStyle = aiLineStyle(data, activeRoadSuggestion());
    map.getSource("line-data")?.setData(data);
  } else {
    map.getSource("polygon-data")?.setData(data); map.getSource("vietnam-boundary")?.setData(data);
  }
  updateModelSections(); applyStyle(); refreshMapPopup();
  if (isRegionHexMode()) rebuildRegionHexGrid();
  if (fit) fitGeoJSON(data);
}

async function processSpatialFile(file) {
  if (!file) return;
  cancelAiBoundaryLoad();
  tabularAbortController?.abort();
  tabularAbortController = createAbortController();
  const revision = ++tabularLoadRevision;
  try {
    setStatus(`Đang đọc ${file.name}…`);
    const result = await readSpatialFile(file, { signal: tabularAbortController.signal });
    if (revision !== tabularLoadRevision) return;
    await applyReadResult(result, file);
  } catch (error) {
    if (error?.name === "AbortError") return;
    console.error(error);
    showToast(error.message || "Không thể đọc file.");
    setStatus("Không thể đọc file.", true);
  }
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

async function removeUploadedFile(id) {
  const file = state.uploadedFiles.find(item => item.id === id);
  if (!file) return;
  removeDynamicUploadLayer(id);
  state.uploadedFiles = state.uploadedFiles.filter(item => item.id !== id);
  if (file.fileKey) state.uploadedFileKeys.delete(file.fileKey);
  if (id === state.primaryUploadId || file.role === "base") {
    clearUploadedData({ preserveUploads: true });
    refreshClippedUploadLayers();
    applyMapLayerVisibility();
    updateDashboard();
  }
  renderUploadedFiles();
  if (!state.uploadedFiles.length) $("selected-file").hidden = true;
  setStatus(`Đã xóa lớp ${file.name}.`, true);
}

async function processSpatialFiles(files) {
  const candidates = [...(files || [])];
  if (!candidates.length) return;
  cancelAiBoundaryLoad();
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
  tabularAbortController?.abort();
  tabularAbortController = createAbortController();
  const revision = ++tabularLoadRevision;
  setStatus(`Đang đọc ${selected.length} file…`);
  const loaded = await Promise.all(selected.map(async ({ file, key }) => {
    try { return { file, key, result: await readSpatialFile(file, { signal: tabularAbortController.signal }) }; }
    catch (error) { return { file, key, error }; }
  }));
  if (revision !== tabularLoadRevision) return;
  const failures = loaded.filter(item => item.error);
  for (const failure of failures) state.uploadedFileKeys.delete(failure.key);
  for (const failure of failures) console.error(failure.file.name, failure.error);
  const valid = loaded.filter(item => !item.error);
  if (!valid.length) {
    showToast(failures[0]?.error?.message || "Không thể đọc các file đã chọn.");
    setStatus("Không thể đọc file.", true);
    return;
  }

  const sheetSelection = valid.find(item => item.result.kind === "sheet-selection");
  if (sheetSelection) {
    showSheetSelection(sheetSelection.file, sheetSelection.result.sheetNames, sheetSelection.key);
    return;
  }

  // A runtime renders one analyzed dataset. The workspace owns multi-dataset composition.
  if (valid.length > 1) throw new Error("Nhập nhiều tập dữ liệu qua danh sách dữ liệu để AI đánh giá kết hợp.");
  await applyReadResult(valid[0].result, valid[0].file);
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
  $("map-metric-toggle").addEventListener("click", () => {
    if (!state.aiDataset) return;
    state.aiDataset.metricControlCollapsed = !state.aiDataset.metricControlCollapsed;
    renderMapMetricControls();
  });
  $("map-metric-list").addEventListener("click", async event => {
    const button = event.target.closest(".map-metric-button");
    if (button) await changeAiMapMetric(button.dataset.metricField);
  });
  $("basemap-options").addEventListener("click", event => {
    const option = event.target.closest(".basemap-option");
    if (option) selectMapStyle(option.dataset.mapStyle);
  });
  $("point-style-controls").addEventListener("input", event => {
    const control = event.target;
    if (control.matches(".point-group-color")) {
      const suggestion = activePointSuggestion();
      if (!suggestion) return;
      pointColorOverridesFor(suggestion)[control.dataset.value] = control.value;
      control.nextElementSibling.textContent = control.value.toUpperCase();
    } else {
      const key = { "point-size": "size", "point-opacity": "opacity", "point-border-width": "borderWidth", "point-color": "color", "point-border-color": "borderColor" }[controlId(control)];
      if (!key) return;
      state.pointStyle = mergePointStyle({ ...state.pointStyle, [key]: control.type === "color" ? control.value : Number(control.value) });
      if (control.type === "color") $(`${controlId(control)}-value`).textContent = control.value.toUpperCase();
      else $(`${controlId(control)}-value`).value = key === "size" ? `${state.pointStyle.size}%` : key === "opacity" ? `${Math.round(state.pointStyle.opacity * 100)}%` : `${state.pointStyle.borderWidth} px`;
    }
    refreshPointStyle();
  });
  $("point-style-controls").addEventListener("change", event => {
    const key = { "point-show-border": "showBorder", "point-show-legend": "showLegend" }[controlId(event.target)];
    if (!key) return;
    state.pointStyle = mergePointStyle({ ...state.pointStyle, [key]: event.target.checked });
    refreshPointStyle();
  });
  $("road-style-controls").addEventListener("input", event => {
    const key = { "road-line-width": "width", "road-line-opacity": "opacity" }[controlId(event.target)];
    if (!key) return;
    state.roadDisplayStyle = { ...state.roadDisplayStyle, [key]: Number(event.target.value) };
    $(`${controlId(event.target)}-value`).value = key === "width" ? `${event.target.value} px` : `${Math.round(event.target.value * 100)}%`;
    applyStyle();
  });
  $("road-style-controls").addEventListener("change", event => {
    if (event.target.matches(".road-style-color")) {
      const suggestion = activeRoadSuggestion();
      if (!suggestion) return;
      roadColorOverridesFor(suggestion)[event.target.dataset.key] = event.target.value;
      state.aiDataset.roadStyle = aiLineStyle(state.lineData, suggestion);
      applyStyle(); renderRoadStyleControls();
      return;
    }
    if (controlId(event.target) === "road-show-legend") {
      state.roadDisplayStyle = { ...state.roadDisplayStyle, showLegend: event.target.checked };
      renderRoadLegend();
    }
  });
  $("ai-filter-controls").addEventListener("change", async event => {
    if (event.target.matches(".ai-popup-metric, .ai-popup-metric-checkbox, .ai-popup-aggregation, .ai-popup-range")) {
      changeMapPopupControl(event.target);
      return;
    }
    if (event.target.matches(".ai-point-metric, .ai-point-group, .ai-point-mode, .ai-point-value, .ai-point-time")) {
      const suggestion = activePointSuggestion();
      if (!suggestion) return;
      const selection = pointSelectionFor(suggestion);
      const control = event.target;
      let rebuildControls = false;
      if (control.matches(".ai-point-metric")) { await changeAiMapMetric(control.value); return; }
      else if (control.matches(".ai-point-group")) {
        selection.groupField = control.value;
        selection.selectedValues = [];
        state.aiDataset.pointSelections[suggestion.id] = normalizePointSelection(pointModelFor(suggestion), selection);
        rebuildControls = true;
      } else if (control.matches(".ai-point-mode")) { selection.mode = control.value; rebuildControls = true; }
      else if (control.matches(".ai-point-value")) {
        const values = control.checked ? [...selection.selectedValues, control.value] : selection.selectedValues.filter(value => value !== control.value);
        if (values.length > POINT_GROUP_LIMIT || !values.length) {
          control.checked = !control.checked;
          showToast(values.length ? `Chỉ có thể hiển thị tối đa ${POINT_GROUP_LIMIT} nhóm.` : "Cần chọn ít nhất một nhóm.");
          return;
        }
        selection.selectedValues = values;
      } else if (control.matches(".ai-point-time")) selection.time = control.value;
      refreshPointView(suggestion, { rebuildControls });
      return;
    }
    const activeLine = () => {
      const dataset = state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      return suggestion?.chartType === "line" ? suggestion : null;
    };
    if (event.target.matches(".ai-bar-aggregation-selector")) {
      const dataset = state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      if (suggestion?.chartType !== "bar" || !["auto", "sum", "mean", "min", "max"].includes(event.target.value)) return;
      barSelectionFor(dataset, suggestion).aggregation = event.target.value;
      activateAiChartSuggestion(suggestion);
      return;
    }
    if (event.target.matches(".ai-chart-metric-selector")) {
      const dataset = state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      if (suggestion?.chartType !== "bar") return;
      const selection = barSelectionFor(dataset, suggestion);
      selection.variant = "single"; selection.metrics = [event.target.value]; selection.aggregation = "auto";
      Object.assign(suggestion, withSuggestionMetric(suggestion, event.target.value, dataset.analysis.columns));
      activateAiChartSuggestion(suggestion);
      return;
    }
    if (event.target.matches(".ai-bar-metric-checkbox")) {
      const dataset = state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      if (suggestion?.chartType !== "bar") return;
      const checked = [...document.querySelectorAll("#ai-filter-controls .ai-bar-metric-checkbox:checked")];
      if (checked.length < 2) {
        event.target.checked = true;
        showToast("Cột ghép cần ít nhất 2 chỉ số.");
        return;
      }
      const selection = barSelectionFor(dataset, suggestion);
      selection.variant = "grouped"; selection.metrics = checked.map(input => input.value);
      activateAiChartSuggestion(suggestion);
      return;
    }
    if (event.target.matches(".ai-metric-selector")) {
      await changeAiMapMetric(event.target.value);
      return;
    }
    if (event.target.matches(".ai-line-measure-selector")) {
      const suggestion = activeLine();
      if (!suggestion) return;
      lineSelectionFor(state.aiDataset, suggestion).measure = event.target.value;
      activateAiChartSuggestion(suggestion, { rebuildControls: false });
      return;
    }
    if (event.target.matches(".ai-line-scope")) {
      const suggestion = activeLine();
      if (!suggestion) return;
      lineSelectionFor(state.aiDataset, suggestion).scope = event.target.value;
      activateAiChartSuggestion(suggestion);
      return;
    }
    if (event.target.matches(".ai-line-range")) {
      const suggestion = activeLine();
      if (!suggestion) return;
      const sel = lineSelectionFor(state.aiDataset, suggestion);
      const [from, to] = ["from", "to"].map(edge => document.querySelector(`#ai-filter-controls .ai-line-range[data-edge='${edge}']`));
      if (!from || !to) return;
      const time = state.aiDataset.analysis.columns.find(column => column.name === suggestion.bindings.x);
      if (compareTimeValues(from.value, to.value, time) > 0) (event.target === from ? to : from).value = event.target.value;
      sel.from = from.value;
      sel.to = to.value;
      activateAiChartSuggestion(suggestion, { rebuildControls: false });
      return;
    }
    if (event.target.matches(".ai-series-filter")) {
      const suggestion = activeLine();
      if (!suggestion) return;
      const checked = [...document.querySelectorAll("#ai-filter-controls .ai-series-filter:checked")];
      const limit = state.aiDataset.activeChartOption?.maxSeries ?? 8;
      if (checked.length > limit) { event.target.checked = false; showToast(`Chỉ có thể hiển thị tối đa ${limit} chuỗi.`); return; }
      if (!checked.length) { event.target.checked = true; showToast("Cần chọn ít nhất một chuỗi."); return; }
      const sel = lineSelectionFor(state.aiDataset, suggestion);
      sel.scope = "pick";
      sel.picked = checked.map(input => input.value);
      activateAiChartSuggestion(suggestion, { rebuildControls: false });
      return;
    }
    if (!event.target.matches(".ai-generated-filter")) return;
    if (event.target.dataset.dimensionFilter === "true" && activePolygonSuggestion()) {
      state.aiDataset.filters = selectedAiFilters();
      populateAiFilters(state.aiDataset);
    }
    if (event.target.dataset.singleToggle === "true" && event.target.checked) {
      for (const control of document.querySelectorAll("#ai-filter-controls .ai-generated-filter")) {
        if (control !== event.target && control.dataset.field === event.target.dataset.field) control.checked = false;
      }
    }
    if (event.target.type === "checkbox") {
      const picker = event.target.closest(".ai-multiselect");
      const summary = picker?.querySelector(".ai-multiselect-toggle span");
      const checked = picker ? [...picker.querySelectorAll(".ai-generated-filter:checked")] : [];
      if (summary) summary.textContent = checked.length === 0
        ? state.aiDataset.recommendation.filters.find(filter => filter.field === event.target.dataset.field)?.emptyLabel || `Chọn ${event.target.dataset.field.toLocaleLowerCase("vi")}`
        : checked.length === 1 ? checked[0].value : `${checked.length} giá trị đã chọn`;
    }
    const filter = state.aiDataset?.recommendation?.filters.find(item => item.field === event.target.dataset.field);
    const shouldFit = event.target.dataset.dimensionFilter === "true" || filter?.fit || event.target.dataset.field === state.aiDataset?.recommendation?.geometry?.field;
    await filteredAiBoundary({ fit: shouldFit });
  });
  $("ai-filter-controls").addEventListener("click", event => {
    const popupType = event.target.closest(".ai-popup-type");
    if (popupType) {
      if (!activeMapPopupSuggestion() || popupType.disabled) return;
      const selection = popupSelectionFor();
      selection.mode = popupType.dataset.popupMode;
      popupSelectionFor();
      refreshMapPopupControls();
      return;
    }
    const popupVariant = event.target.closest("[data-popup-bar-variant]");
    if (popupVariant) {
      if (!activeMapPopupSuggestion() || popupVariant.disabled) return;
      const selection = popupSelectionFor();
      if (selection.mode !== "bar") return;
      selection.bar.variant = popupVariant.dataset.popupBarVariant;
      selection.bar.metrics = defaultBarMetrics({ bindings: { y: selection.bar.metrics[0] } }, popupChartColumns(state.aiDataset.analysis.columns, activeMapPopupSuggestion().bindings), selection.bar.variant);
      refreshMapPopupControls();
      return;
    }
    const barVariant = event.target.closest(".ai-bar-chart-type");
    if (barVariant) {
      const dataset = state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      if (suggestion?.chartType !== "bar") return;
      const selection = barSelectionFor(dataset, suggestion);
      const variant = barVariant.dataset.barVariant;
      if (!variant || selection.variant === variant) return;
      selection.variant = variant;
      selection.metrics = defaultBarMetrics(suggestion, dataset.analysis.columns, variant);
      if (variant === "single" && selection.metrics[0]) {
        Object.assign(suggestion, withSuggestionMetric(suggestion, selection.metrics[0], dataset.analysis.columns));
      }
      activateAiChartSuggestion(suggestion);
      return;
    }
    if (event.target.closest(".ai-point-reset")) {
      const suggestion = activePointSuggestion();
      if (!suggestion) return;
      const selection = pointSelectionFor(suggestion);
      state.aiDataset.pointSelections[suggestion.id] = normalizePointSelection(pointModelFor(suggestion), { ...selection, selectedValues: [] });
      refreshPointView(suggestion, { rebuildControls: true });
      return;
    }
    if (event.target.closest(".ai-series-reset")) {
      const dataset = state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      if (suggestion?.chartType !== "line") return;
      lineSelectionFor(dataset, suggestion).picked = [];
      activateAiChartSuggestion(suggestion);
      return;
    }
    const applyAliases = event.target.closest(".apply-geo-aliases");
    if (applyAliases) {
      const dataset = state.aiDataset; const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      if (!dataset || suggestion?.chartType !== "choropleth") return;
      dataset.geoAliases ||= {}; dataset.geoSelections ||= {};
      const changedAliases = new Set();
      for (const input of document.querySelectorAll(".geo-alias-input")) {
        const name = input.dataset.location; const value = input.value.trim();
        if (value !== (dataset.geoAliases[name] || "")) { delete dataset.geoSelections[name]; changedAliases.add(name); }
        if (value) dataset.geoAliases[name] = value;
        else delete dataset.geoAliases[name];
      }
      for (const choice of document.querySelectorAll(".geo-boundary-choice")) {
        const name = choice.dataset.location;
        if (changedAliases.has(name)) continue;
        const feature = dataset.geoMatch?.candidates?.[name]?.find(candidate => candidate.id === choice.value);
        if (feature) dataset.geoSelections[name] = feature;
        else delete dataset.geoSelections[name];
      }
      suggestion.available = true; suggestion.unavailableReason = "";
      activateAiChoropleth(suggestion).catch(error => { console.error(error); showToast(error.message); });
      return;
    }
    const toggle = event.target.closest(".ai-multiselect-toggle");
    if (!toggle) return;
    const menu = toggle.nextElementSibling;
    const open = menu.hidden;
    document.querySelectorAll(".ai-multiselect-menu").forEach(item => { item.hidden = true; });
    document.querySelectorAll(".ai-multiselect-toggle").forEach(item => item.setAttribute("aria-expanded", "false"));
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });
  $("ai-filter-controls").addEventListener("input", event => {
    if (!event.target.matches(".ai-series-search")) return;
    const query = event.target.value.trim().toLocaleLowerCase("vi");
    event.target.closest(".ai-series-picker").querySelectorAll(".ai-series-list label").forEach(row => {
      row.hidden = Boolean(query) && !row.textContent.toLocaleLowerCase("vi").includes(query);
    });
  });
  for (const id of ["show-map-lines"]) $(id).addEventListener("change", applyMapLayerVisibility);
  $("show-region-hex").addEventListener("change", async event => {
    closeMapPopup();
    regionHexBuildRevision += 1;
    state.regionHexEnabled = event.target.checked;
    cellPopup?.remove();
    $("region-hex-note").textContent = "";
    syncRegionHexControls();
    if (isRegionHexMode()) await rebuildRegionHexGrid();
    else { applyStyle(); setStatus("Đang hiển thị vùng hành chính.", true); }
  });
  $("region-hex-resolution").addEventListener("input", event => {
    $("region-hex-resolution-value").value = event.target.value;
  });
  $("region-hex-resolution").addEventListener("change", async event => {
    closeMapPopup();
    state.regionHexResolution = Number(event.target.value);
    await rebuildRegionHexGrid();
  });
  $("resolution").addEventListener("input", e => $("resolution-value").value = e.target.value); $("resolution").addEventListener("change", async e => { state.resolution = Number(e.target.value); await rebuildGrid(); });
  $("opacity").addEventListener("input", e => { $("opacity-value").value = `${Math.round(e.target.value * 100)}%`; applyStyle(); }); $("line-width").addEventListener("input", e => { $("line-width-value").value = `${e.target.value} px`; applyStyle(); });
  for (const id of ["fixed-color", "border-color"]) { $(id).addEventListener("input", e => {
    if (id === "fixed-color" && activePolygonLegendScale()) return;
    $(`${id}-value`).textContent = e.target.value.toUpperCase();
    if (id === "fixed-color" && (state.mapType === "polygon" || state.aiDataset)) { state.polygonPalette = null; syncPolygonPaletteControls(); }
    applyStyle();
  }); }
  $("polygon-color-ramp").addEventListener("click", event => {
    const button = event.target.closest(".palette");
    if (!button || button.disabled || activePolygonLegendScale()) return;
    state.polygonPalette = button.dataset.palette;
    syncPolygonPaletteControls();
    applyStyle();
  });
  $("show-border").addEventListener("change", applyStyle);
  document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab,.tab-panel").forEach(x => x.classList.remove("active")); tab.classList.add("active"); document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active"); }));
  $("map-type-grid").addEventListener("click", async event => {
    const button = event.target.closest(".map-type");
    if (!button) return;
    if (button.dataset.aiSuggestion) {
      try { await selectAiSuggestion(button.dataset.aiSuggestion); }
      catch (error) { if (error?.name !== "AbortError") { console.error(error); showToast(error.message || "Không thể dựng đề xuất này."); } }
      return;
    }
    if (selectChartOption(button.dataset.type)) return;
    document.querySelectorAll(".map-type").forEach(x => x.classList.remove("active"));
    button.classList.add("active");
    regionHexBuildRevision += 1;
    state.regionHexEnabled = false;
    $("region-hex-note").textContent = "";
    state.mapType = button.dataset.type;
    updateModelSections();
    if (state.mapType === "h3" && state.boundary) await rebuildGrid();
    else applyStyle();
    setStatus(`Đang hiển thị kiểu ${button.dataset.label}.`, true);
  });
  bindFileDropZone();
  $("apply-sheet").addEventListener("click", async () => {
    const pending = state.pendingSheet;
    if (!pending) return;
    tabularAbortController?.abort(); tabularAbortController = createAbortController(); const revision = ++tabularLoadRevision;
    try {
      setStatus(`Đang phân tích sheet ${$("sheet-selector").value}…`);
      const result = await readSpatialFile(pending.file, { sheetName: $("sheet-selector").value, signal: tabularAbortController.signal });
      if (revision !== tabularLoadRevision) return;
      state.pendingSheet = null; $("sheet-selector-field").hidden = true;
      await applyReadResult(result, pending.file);
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        const message = error.message || "Không thể đọc sheet.";
        setStatus(message, true);
      }
    }
  });
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
    map.getSource("vietnam-boundary")?.setData(state.boundary); setCurrentFileNote(names.length ? `Đang lọc: ${names.map(formatProvinceName).join(", ")}` : "Dữ liệu đã tải · đang sử dụng");
    map.getSource("polygon-data")?.setData(state.boundary);
    $("province-filter-menu").hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.disabled = true;
    try { await rebuildGrid({ fit: true }); refreshClippedUploadLayers(); } finally { toggle.disabled = false; }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest("[data-control-id=province-filter], #province-filter")) { $("province-filter-menu").hidden = true; $("province-filter-toggle").setAttribute("aria-expanded", "false"); }
    if (!event.target.closest(".ai-multiselect")) {
      document.querySelectorAll(".ai-multiselect-menu").forEach(menu => { menu.hidden = true; });
      document.querySelectorAll(".ai-multiselect-toggle").forEach(toggle => toggle.setAttribute("aria-expanded", "false"));
    }
  });
  $("apply-coordinates").addEventListener("click", async () => { try { const raw = $("coordinate-input").value.trim(); let data; if (raw.startsWith("{")) data = JSON.parse(raw); else { const ring = raw.split(/\n/).map(line => line.split(",").map(Number)); if (ring.length < 3 || ring.some(p => p.length < 2 || p.some(Number.isNaN))) throw new Error("Cần ít nhất 3 dòng lng,lat."); ring.push(ring[0]); data = { type: "Polygon", coordinates: [ring] }; } await replaceBoundary(data, "Tọa độ nhập trực tiếp"); } catch (error) { showToast(error.message); } });
  for (const [toggleId, controlsId] of [["feature-toggle", "feature-controls"], ["style-toggle", "style-controls"]]) {
    $(toggleId).addEventListener("click", () => { const open = $(toggleId).getAttribute("aria-expanded") === "true"; $(toggleId).setAttribute("aria-expanded", String(!open)); $(controlsId).style.display = open ? "none" : ""; });
  }
  $("show-map-layers").addEventListener("change", e => { options.onVisibility?.(e.target.checked); $("show-map-layers-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt"; applyMapLayerVisibility(); });
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
  if (!options.managedWorkspace) {
    $("zoom-in").addEventListener("click", () => map.zoomIn()); $("zoom-out").addEventListener("click", () => map.zoomOut()); $("fullscreen").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector(".map-panel").requestFullscreen());
  }
  $("export-data").addEventListener("click", exportCSV);
}

function exportCSV() {
  if (options.exportData?.(state)) return;
  const rows = [["H3 Index", "Latitude", "Longitude"], ...filteredFeatures().map(({ properties: p }) => [p.h3, p.center_lat, p.center_lng])];
  const blob = new Blob(["\ufeff" + rows.map(row => row.map(x => `"${String(x).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `h3-res-${state.resolution}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

function observeMapSize() {
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => {
    map?.resize();
    if (mapPopupView) sizeMapPopup(mapPopupView);
  });
  observer.observe($("map"));
}

async function init() {
  renderSupportedChartCatalog();
  bindUI(); syncMapStyleControls();
  map = new maplibregl.Map({ container: "map", style: MAP_STYLES[state.mapStyle], center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  observeMapSize();
  mapSearch = createMapSearch({ map, minFilteredObjects: CONFIG.DATA_SEARCH_MIN_FILTERED_OBJECTS });
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
      mapSearch?.refreshHighlight();
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
// Runtime public API. Every callback closes over this layer's state and DOM.
return {
  state, readSpatialFile, applyReadResult, processSpatialFiles, removeUploadedFile,
  closePopup() { closeMapPopup(); cellPopup?.remove(); pointPopup?.remove(); },
  openPopup(feature, center) {
    if (state.aiDataset) openMapPopup(feature, center, state.mapType === "point" ? "point-marker" : state.mapType === "line" ? "data-lines" : "polygon-fill");
    else showUploadedFeaturePopup(feature, { name: state.fileName || "Dữ liệu", role: state.mapType }, center);
  },
  searchData: currentDataSearch,
  setVisible(value) { $("show-map-layers").checked = value; $("show-map-layers-status").textContent = value ? "Đang bật" : "Đang tắt"; applyMapLayerVisibility(); },
  setSamples(value) { $("ai-include-samples").checked = value; },
  fit() { fitGeoJSON(state.boundary || state.sourceBoundary); },
  update() { updateModelSections(); applyStyle(); },
  async load(result, file) { state.fileName = file.name; await applyReadResult(result, file); renderTable(); },
  initialize() {
    map = options.map; mapReady = true;
    mapSearch = { setData() { options.onChange?.(); }, refreshHighlight() {} };
    renderSupportedChartCatalog(); bindUI(); addMapLayers(); updateDashboard();
  },
  dispose() {
    tabularAbortController?.abort(); cancelAiBoundaryLoad(); regionHexBuildRevision++;
    clearTimeout(toastTimer); clearTimeout(statusTimer); clearTimeout(layerOrderTimer);
    closeMapPopup(); cellPopup?.remove(); pointPopup?.remove(); clearChartCanvas();
    clearBarStylePanel($("bar-style-controls")); clearPieStylePanel($("bar-style-controls")); clearDataMappingPanel($("data-mapping-controls"));
  }
};
}

if (typeof document !== "undefined") startMapWorkspace(createMapLayerRuntime, { styles: MAP_STYLES, styleLabels: MAP_STYLE_LABELS, renderCatalog: renderSupportedMapCatalog });

import { polygonLegendLabels as default_polygonLegendLabels } from "../../shared/data/polygon-legend.js";
import { displayFilterValue as default_displayFilterValue } from "../../shared/import/ai-data-analysis.js";
import { applyPipelineFilters as default_applyPipelineFilters } from "../../shared/import/ai-chart-pipeline.js";
import { resolveAggregation as default_resolveAggregation } from "../../shared/import/ai-chart-pipeline.js";
import { aiRoadMapStyle as default_aiRoadMapStyle } from "./data.js";
import { joinRoadRecordsByArea as default_joinRoadRecordsByArea } from "./data.js";
import { ROAD_NETWORKS as default_ROAD_NETWORKS } from "./data.js";
import { roadNetworksFromRecords as default_roadNetworksFromRecords } from "./data.js";
import { buildCoordinateLines as default_buildCoordinateLines } from "./coordinates.js";
import { isCoordinateLine as default_isCoordinateLine } from "./coordinates.js";
import { EMPTY_FEATURE_COLLECTION } from '../../shared/configuration.js';

/** line operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const controlId = control => control.dataset?.controlId || control.id;

  const fetch = (...args) => (context.dependencies?.fetch || globalThis.fetch)(...args);

  const polygonLegendLabels = (...args) => (context.dependencies?.polygonLegendLabels ?? default_polygonLegendLabels)(...args);

  const displayFilterValue = (...args) => (context.dependencies?.displayFilterValue ?? default_displayFilterValue)(...args);

  const applyPipelineFilters = (...args) => (context.dependencies?.applyPipelineFilters ?? default_applyPipelineFilters)(...args);

  const resolveAggregation = (...args) => (context.dependencies?.resolveAggregation ?? default_resolveAggregation)(...args);

  const aiRoadMapStyle = (...args) => (context.dependencies?.aiRoadMapStyle ?? default_aiRoadMapStyle)(...args);

  const joinRoadRecordsByArea = (...args) => (context.dependencies?.joinRoadRecordsByArea ?? default_joinRoadRecordsByArea)(...args);

  const ROAD_NETWORKS = context.dependencies?.ROAD_NETWORKS ?? default_ROAD_NETWORKS;

  const roadNetworksFromRecords = (...args) => (context.dependencies?.roadNetworksFromRecords ?? default_roadNetworksFromRecords)(...args);

  const buildCoordinateLines = (...args) => (context.dependencies?.buildCoordinateLines ?? default_buildCoordinateLines)(...args);

  const isCoordinateLine = (...args) => (context.dependencies?.isCoordinateLine ?? default_isCoordinateLine)(...args);

  const roadNetworkUrl = id => context.assets.roadNetworkUrl(id);

  function aiLineStyle(data, suggestion) {
    return aiRoadMapStyle(data, state.aiDataset.analysis.columns, suggestion);
  }

  function roadLegendTitle(suggestion) {
    const dataset = state.aiDataset;
    const field = suggestion.bindings.value;
    const column = dataset.analysis.columns.find(column => column.name === field);
    const scale = dataset.roadStyle?.scale;
    const title = scale?.title || column?.labelVi || field || suggestion.title || dataset.analysis.datasetTitle || "Tuyến đường";
    const unit = scale ? scale.unit : column?.unit;
    return unit && !title.toLocaleLowerCase("vi").includes(unit.toLocaleLowerCase("vi")) ? `${title} (${unit})` : title;
  }

  function renderRoadStyleControls() {
    const suggestion = activeRoadSuggestion();
    $("road-line-width").value = state.roadDisplayStyle.width;
    $("road-line-width-value").value = `${state.roadDisplayStyle.width} px`;
    $("road-line-opacity").value = state.roadDisplayStyle.opacity;
    $("road-line-opacity-value").value = `${Math.round(state.roadDisplayStyle.opacity * 100)}%`;
    $("road-show-legend").checked = state.roadDisplayStyle.showLegend;
    $("road-color-field").hidden = !suggestion;
    if (!suggestion) return;
    const style = state.aiDataset.roadStyle;
    const scale = style?.scale;
    const title = roadLegendTitle(suggestion);
    $("road-color-metric").textContent = scale ? `Theo ${title}` : "";
    const summary = $("road-legend-summary");
    const status = !scale ? "Màu tuyến mặc định" : !scale.hasData ? "Không có dữ liệu"
      : scale.source === "ai" ? "Chú giải do AI đề xuất" : "Chú giải dự phòng";
    summary.textContent = scale ? `${title} · ${status}` : status;
    summary.style.setProperty("--legend-gradient", scale?.gradient || scale?.noDataColor || style?.color || "transparent");
    summary.title = scale?.reason || "";
  }

  function activeRoadSuggestion() {
    const dataset = state.aiDataset;
    const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
    return state.mapType === "line" && suggestion?.chartType === "map_line" ? suggestion : null;
  }

  function renderRoadLegend() {
    const legend = $("ai-line-legend");
    const suggestion = activeRoadSuggestion();
    legend.hidden = !suggestion || !state.roadDisplayStyle.showLegend || !state.lineData.features.length || !$("show-map-layers").checked;
    if (legend.hidden) return;
    const dataset = state.aiDataset;
    const heading = document.createElement("div"); heading.className = "point-legend-heading";
    const title = document.createElement("strong");
    title.textContent = roadLegendTitle(suggestion);
    heading.append(title);
    const rows = document.createElement("div"); rows.className = "point-legend-rows";
    const stops = dataset.roadStyle?.rows || [];
    const scale = dataset.roadStyle?.scale;
    if (scale && scale.type !== "categorical" && stops.length) {
      rows.className = "line-legend-continuous";
      const ramp = document.createElement("div"); ramp.className = "line-legend-ramp"; ramp.setAttribute("aria-hidden", "true");
      ramp.style.background = scale.gradient;
      const labels = document.createElement("div"); labels.className = "line-legend-labels";
      const ticks = polygonLegendLabels(scale);
      labels.style.height = `${Math.max(...ticks.map(tick => tick.row + 1)) * 14}px`;
      ticks.forEach(({ position, text, row, offset }) => {
        const tick = document.createElement("i"); tick.className = "line-legend-tick"; tick.style.left = `${position}%`;
        const label = document.createElement("span"); label.textContent = text; label.style.left = `${position}%`;
        label.style.top = `${row * 14}px`; label.style.marginLeft = `${offset || 0}px`;
        ramp.append(tick); labels.append(label);
      });
      rows.append(ramp, labels);
    } else {
      for (const item of stops) {
        const row = document.createElement("div"); row.className = "point-legend-row";
        const swatch = document.createElement("i"); swatch.style.background = item.color;
        const label = document.createElement("span"); label.textContent = item.label;
        row.append(swatch, label); rows.append(row);
      }
    }
    const note = document.createElement("small");
    const timeFilter = dataset.recommendation.filters.find(filter => ["date-select", "datetime-select"].includes(filter.control));
    const time = timeFilter ? displayFilterValue(dataset.filters[timeFilter.field], timeFilter.control) : "";
    note.textContent = `${time ? `${time} · ` : ""}${state.lineData.stats.matchedRows}/${state.lineData.stats.totalRows} bản ghi khớp · ${state.lineData.features.length.toLocaleString("vi-VN")} đoạn đường`;
    legend.replaceChildren(heading, rows, note);
  }

  function refreshAiRoadMap({ fit = false } = {}) {
    if (state.aiDataset?.nativeGeometry) return services.runtime.refreshNativeMap({ fit });
    const suggestion = activeRoadSuggestion(); const dataset = state.aiDataset;
    if (isCoordinateLine(suggestion)) return refreshAiCoordinateLine({ fit });
    if (!suggestion || !dataset.roadArea?.field || !dataset.roadArea.networkIds.every(id => dataset.roadGeometries?.[id])) return;
    dataset.filters = services.ui.selectedAiFilters();
    const records = applyPipelineFilters(dataset.records, dataset.filters);
    const data = joinRoadRecordsByArea(records, dataset.roadGeometries, {
      areaField: dataset.roadArea.field,
      roadField: suggestion.bindings.region, valueField: suggestion.bindings.value,
      columns: dataset.analysis.columns, aggregation: resolveAggregation(suggestion, dataset.analysis.columns)
    });
    state.lineData = data;
    dataset.roadStyle = aiLineStyle(data, suggestion);
    context.map.getSource("line-data")?.setData(data);
    services.ui.updateModelSections(); services.view.applyStyle();
    services.popup.refreshMapPopup();
    if (fit && data.features.length) services.view.fitGeoJSON(data);
    const stats = data.stats;
    const areaLabels = dataset.roadArea.networkIds.map(id => ROAD_NETWORKS.find(network => network.id === id)?.label || id);
    const skipped = dataset.roadArea.unknownAreas.length ? ` Bỏ qua khu vực chưa hỗ trợ: ${dataset.roadArea.unknownAreas.join(", ")}.` : "";
    services.uploads.setCurrentFileNote(`${stats.matchedRows}/${stats.totalRows} bản ghi khớp · ${stats.segmentCount.toLocaleString("vi-VN")} đoạn đường`);
    services.ui.setStatus(data.features.length ? `Đang hiển thị Bản đồ Line tại ${areaLabels.join(", ")}.${skipped}`
      : `Không có tuyến khớp. Hãy kiểm tra Khu vực, tên/mã đường hoặc bộ lọc đã chọn.${skipped}`, data.features.length > 0);
  }

  function refreshAiCoordinateLine({ fit = false } = {}) {
    const dataset = state.aiDataset; const suggestion = activeRoadSuggestion();
    if (!isCoordinateLine(suggestion)) return;
    dataset.filters = services.ui.selectedAiFilters();
    const data = buildCoordinateLines(applyPipelineFilters(dataset.records, dataset.filters), dataset.analysis.columns, suggestion.bindings);
    state.lineData = data;
    dataset.roadStyle = aiLineStyle(data, suggestion);
    context.map.getSource("line-data")?.setData(data);
    services.ui.updateModelSections(); services.view.applyStyle(); services.popup.refreshMapPopup();
    if (fit && data.features.length) services.view.fitGeoJSON(data);
    services.uploads.setCurrentFileNote(`${data.features.length} tuyến · ${Math.round(data.stats.coordinateRate * 100)}% tọa độ hợp lệ`);
    services.ui.setStatus(data.features.length ? "Đang hiển thị các chuỗi tọa độ trên Bản đồ Line."
      : "Chưa có chuỗi gồm ít nhất hai tọa độ khác nhau. Kiểm tra nhóm tuyến, cột thứ tự hoặc dữ liệu tọa độ.", data.features.length > 0);
  }

  async function loadAiRoadNetwork({ fit = false } = {}) {
    services.runtime.cancelAiBoundaryLoad();
    const dataset = state.aiDataset; const suggestion = activeRoadSuggestion();
    if (!dataset || !suggestion) return null;
    const area = roadNetworksFromRecords(dataset.records, dataset.analysis.columns);
    dataset.roadArea = area; dataset.roadGeometries ||= {};
    state.lineData = EMPTY_FEATURE_COLLECTION;
    context.map.getSource("line-data")?.setData(EMPTY_FEATURE_COLLECTION);
    services.popup.closeMapPopup();
    services.ui.updateModelSections(); services.view.applyStyle();
    if (!area.field) { services.ui.setStatus("Cần cột Khu vực để tự động xác định mạng đường thuộc tỉnh/thành phố nào."); return true; }
    if (!area.networkIds.length) {
      const values = area.unknownAreas.length ? `: ${area.unknownAreas.join(", ")}` : "";
      services.ui.setStatus(`Không nhận diện được mạng đường từ cột ${area.field}${values}.`);
      return true;
    }
    const missing = area.networkIds.filter(id => !dataset.roadGeometries[id]);
    if (!missing.length) { refreshAiRoadMap({ fit }); return true; }
    const controller = services.runtime.createAbortController(); context.tasks.aiBoundaryAbortController = controller;
    const revision = context.tasks.aiBoundaryRevision;
    const isCurrent = () => revision === context.tasks.aiBoundaryRevision && dataset === state.aiDataset && dataset.selectedSuggestionId === suggestion.id;
    services.ui.setStatus("Đang tải mạng đường để ghép dữ liệu tuyến…");
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
      services.ui.setStatus(`Không thể hiển thị tuyến: ${error.message}`);
      return true;
    } finally {
      if (context.tasks.aiBoundaryAbortController === controller) context.tasks.aiBoundaryAbortController = null;
    }
  }

  async function activateAiRoadMap(suggestion) {
    const dataset = state.aiDataset;
    dataset.recommendation = services.ui.recommendationForSuggestion(suggestion);
    services.ui.populateAiFilters(dataset);

    services.runtime.clearMapData();
    state.mapType = "line"; state.dataProfile = null;
    $("show-map-lines").checked = true;
    services.ui.renderAiSuggestionGrid();
    context.map.resize();
    if (isCoordinateLine(suggestion)) {
    services.runtime.cancelAiBoundaryLoad(); refreshAiCoordinateLine({ fit: true }); return true;
    }
    return loadAiRoadNetwork({ fit: true });
  }

  function bindControls() {
  context.listen($("road-style-controls"), "input", event => {
      const key = { "road-line-width": "width", "road-line-opacity": "opacity" }[controlId(event.target)];
      if (!key) return;
      state.roadDisplayStyle = { ...state.roadDisplayStyle, [key]: Number(event.target.value) };
      $(`${controlId(event.target)}-value`).value = key === "width" ? `${event.target.value} px` : `${Math.round(event.target.value * 100)}%`;
      services.view.applyStyle();
    });
  context.listen($("road-style-controls"), "change", event => {
      if (controlId(event.target) === "road-show-legend") {
        state.roadDisplayStyle = { ...state.roadDisplayStyle, showLegend: event.target.checked };
        renderRoadLegend();
      }
    });
  for (const id of ["show-map-lines"]) context.listen($(id), "change", services.view.applyMapLayerVisibility);
  }

  function handleChange(event) {

  return false;
  }

  function handleClick(event) {

  return false;
  }

  return { bindControls, handleChange, handleClick, aiLineStyle, roadLegendTitle, renderRoadStyleControls, activeRoadSuggestion, renderRoadLegend, refreshAiRoadMap, refreshAiCoordinateLine, loadAiRoadNetwork, activateAiRoadMap };
}

import { mapRegistry } from '../../maps/registry.js';
import { BarRenderer as default_BarRenderer } from "../../charts/bar-chart.js";
import { LineRenderer as default_LineRenderer } from "../../charts/line-chart.js";
import { humanizeField as default_humanizeField } from "../../charts/data-transformers.js";
import { renderChartIcon as default_renderChartIcon } from "../../charts/chart-icons.js";
import { comparableFilterValue as default_comparableFilterValue } from "../import/ai-data-analysis.js";
import { createAiPopupContent as default_createAiPopupContent } from "./ai-popup.js";
import { createInfoImagePopup as default_createInfoImagePopup } from "./info-image-popup.js";

import { barMetricOptions as default_barMetricOptions } from "../import/ai-chart-pipeline.js";
import { defaultBarMetrics as default_defaultBarMetrics } from "../import/ai-chart-pipeline.js";
import { compareTimeValues as default_compareTimeValues } from "../data/time-values.js";
import { formatTimeValue as default_formatTimeValue } from "../data/time-values.js";
import { uniqueTimeValues as default_uniqueTimeValues } from "../data/time-values.js";
import { buildPopupChart as default_buildPopupChart } from "./ai-popup-chart.js";
import { createPopupChartSelection as default_createPopupChartSelection } from "./ai-popup-chart.js";
import { popupChartColumns as default_popupChartColumns } from "./ai-popup-chart.js";
import { popupDisplayOptions as default_popupDisplayOptions } from "./ai-popup-chart.js";
import { popupFeaturesMatch as default_popupFeaturesMatch } from "./ai-popup-chart.js";
import { popupRegionRecords as default_popupRegionRecords } from "./ai-popup-chart.js";
import { popupTimeColumn as default_popupTimeColumn } from "./ai-popup-chart.js";
import { EMPTY_FEATURE_COLLECTION } from '../configuration.js';

/** popup operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const BarRenderer = context.dependencies?.BarRenderer ?? default_BarRenderer;

  const LineRenderer = context.dependencies?.LineRenderer ?? default_LineRenderer;

  const humanizeField = (...args) => (context.dependencies?.humanizeField ?? default_humanizeField)(...args);

  const renderChartIcon = (...args) => (context.dependencies?.renderChartIcon ?? default_renderChartIcon)(...args);

  const comparableFilterValue = (...args) => (context.dependencies?.comparableFilterValue ?? default_comparableFilterValue)(...args);

  const createAiPopupContent = (...args) => (context.dependencies?.createAiPopupContent ?? default_createAiPopupContent)(...args);

  const createInfoImagePopup = (...args) => (context.dependencies?.createInfoImagePopup ?? default_createInfoImagePopup)(...args);

  const barMetricOptions = (...args) => (context.dependencies?.barMetricOptions ?? default_barMetricOptions)(...args);

  const defaultBarMetrics = (...args) => (context.dependencies?.defaultBarMetrics ?? default_defaultBarMetrics)(...args);

  const compareTimeValues = (...args) => (context.dependencies?.compareTimeValues ?? default_compareTimeValues)(...args);

  const formatTimeValue = (...args) => (context.dependencies?.formatTimeValue ?? default_formatTimeValue)(...args);

  const uniqueTimeValues = (...args) => (context.dependencies?.uniqueTimeValues ?? default_uniqueTimeValues)(...args);

  const buildPopupChart = (...args) => (context.dependencies?.buildPopupChart ?? default_buildPopupChart)(...args);

  const createPopupChartSelection = (...args) => (context.dependencies?.createPopupChartSelection ?? default_createPopupChartSelection)(...args);

  const popupChartColumns = (...args) => (context.dependencies?.popupChartColumns ?? default_popupChartColumns)(...args);

  const popupDisplayOptions = (...args) => (context.dependencies?.popupDisplayOptions ?? default_popupDisplayOptions)(...args);

  const popupFeaturesMatch = (...args) => (context.dependencies?.popupFeaturesMatch ?? default_popupFeaturesMatch)(...args);

  const popupRegionRecords = (...args) => (context.dependencies?.popupRegionRecords ?? default_popupRegionRecords)(...args);

  const popupTimeColumn = (...args) => (context.dependencies?.popupTimeColumn ?? default_popupTimeColumn)(...args);


  function cellCenter(feature) {
    const p = feature.properties || {};
    if (Number.isFinite(p.center_lng) && Number.isFinite(p.center_lat)) return [p.center_lng, p.center_lat];
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const vertices = polygons.flatMap(polygon => polygon[0].slice(0, -1));
    return vertices.reduce((center, point) => [center[0] + point[0] / vertices.length, center[1] + point[1] / vertices.length], [0, 0]);
  }

  function showCellFocus(feature, layerId) {
    const data = { type: "FeatureCollection", features: [feature] };
    if (!context.map.getSource("selected-cell")) {
      context.map.addSource("selected-cell", { type: "geojson", data });
      context.map.addLayer({ id: "cell-focus-dim", type: "background", paint: { "background-color": "#000000", "background-opacity": .55 } });
      context.map.addLayer({ id: "cell-focus-fill", type: "fill", source: "selected-cell", paint: { "fill-color": "#168c50", "fill-opacity": 1 } });
      context.map.addLayer({ id: "cell-focus-border", type: "line", source: "selected-cell", paint: { "line-color": "#ffffff", "line-width": 3 } });
    } else context.map.getSource("selected-cell").setData(data);
    context.map.setPaintProperty("cell-focus-fill", "fill-color", context.map.getPaintProperty(layerId, "fill-color"));
    for (const id of ["cell-focus-dim", "cell-focus-fill", "cell-focus-border"]) {
      context.map.moveLayer(id);
      context.map.setLayoutProperty(id, "visibility", "visible");
    }
  }

  function openCellPopup(popup, feature, layerId) {
    context.popups.cellPopup?.remove();
    context.popups.cellPopup = popup;
    const container = context.map.getContainer();
    popup.on("close", () => {
      if (context.popups.cellPopup !== popup) return;
      context.popups.cellPopup = null;
      container.classList.remove("cell-popup-open");
      for (const id of ["cell-focus-dim", "cell-focus-fill", "cell-focus-border"]) {
        if (context.map.getLayer(id)) context.map.setLayoutProperty(id, "visibility", "none");
      }
      context.map.getSource("selected-cell")?.setData(EMPTY_FEATURE_COLLECTION);
    });
    showCellFocus(feature, layerId);
    popup.setLngLat(cellCenter(feature)).addTo(context.map);
    container.classList.add("cell-popup-open");
    return popup;
  }

  function chartRenderer(kind) {
    return kind === "line" ? LineRenderer : BarRenderer;
  }

  function aiWeatherPopupContent(feature) {
    const dataset=state.aiDataset; const recommendation=dataset.recommendation || {};
    const info=context.modules.active()?.getPopupContext(feature) || {};
    const scale=info.legendScale;
    const displayedColumns=(dataset.analysis.columns || []).filter(column=>!column.name.startsWith('__')).map(column=>{
      if(column.name===scale?.field)return {...column,unit:scale.unit,labelVi:scale.aggregation==='count'?'Số bản ghi':column.labelVi};
      return column.role==='time'&&recommendation.filters?.some(filter=>filter.field===column.name&&filter.control==='datetime-select')?{...column,granularity:'datetime'}:column;
    });
    return createAiPopupContent(document,feature,displayedColumns,dataset.nativeTitleField || info.search?.titleField || recommendation.geometry?.field,{
      records:info.infoRecords || [],datasetTitle:dataset.analysis?.datasetTitle?.trim() || String(dataset.fileName || state.fileName || '').replace(/\.[^/.]+$/,'')
    });
  }

  function showAiPolygonDetails(event) {
    const feature=event.features?.[0]; if(feature&&state.aiDataset)openMapPopup(feature,event.lngLat);
  }

  function activeMapPopupSuggestion() {
    const dataset = state.aiDataset;
    const suggestion = dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
    if (!mapRegistry[suggestion?.chartType]) return null;
    const metadata = options.popupMetadata?.() || {};
    return { ...suggestion, popupContent: dataset.analysis?.popupContent,
      hasJoinedImages: metadata.hasJoinedImages,
      popupSuggestions: [...(suggestion.popupSuggestions || []), ...(metadata.popupSuggestions || [])] };
  }

  function popupSelectionFor(suggestion = activeMapPopupSuggestion()) {
    suggestion = activeMapPopupSuggestion()?.id === suggestion?.id ? activeMapPopupSuggestion() : suggestion;
    const dataset = state.aiDataset;
    dataset.popupSelections ||= {};
    const available = popupDisplayOptions(suggestion, dataset.analysis.columns).filter(item => item.available);
    const selection = dataset.popupSelections[suggestion.id] ||= { mode: available[0].name, bar: null, line: null };
    if (!available.some(item => item.name === selection.mode)) selection.mode = available[0].name;
    if (["bar", "line"].includes(selection.mode) && !selection[selection.mode]) {
      const metric = context.modules.active()?.metricField();
      selection[selection.mode] = createPopupChartSelection(dataset.records, dataset.analysis.columns, metric, selection.mode, suggestion.bindings);
    }
    return selection;
  }

  function clearMapPopupChart(view) {
    if (view?.chartContainer) {
      if (view.templateChartCleanup) { view.templateChartCleanup(); view.templateChartCleanup = null; }
      else chartRenderer(view.chartKind).clear(view.chartContainer);
      view.chartContainer = null;
    }
  }

  function closeMapPopup() {
    const view = context.popups.mapPopupView;
    if (!view) return;
    context.popups.mapPopupView = null;
    clearMapPopupChart(view);
    view.popup.remove();
  }

  function renderMapPopup(view) {
    clearMapPopupChart(view);
    const dataset = state.aiDataset;
    const selection = popupSelectionFor();
    const chartMode = ["bar", "line"].includes(selection.mode);
    const joined = options.popupSources?.(view.feature) || [];
    let card;
    if (selection.mode === "info_image") {
      const content = dataset.analysis.popupContent || {};
      const titleField = content.titleField || dataset.nativeTitleField || context.modules.active()?.getPopupContext(view.feature).titleField || dataset.recommendation?.geometry?.field;
      const baseRecords = view.arcInfo?.records || popupRegionRecords(dataset.records, view.feature, dataset.recommendation?.geometry?.field,
        { chartType: activeMapPopupSuggestion().chartType, columns: dataset.analysis.columns, bindings: activeMapPopupSuggestion().bindings });
      card = createInfoImagePopup(document, { sources: [{ title: dataset.fileName || dataset.analysis.datasetTitle,
        columns: dataset.analysis.columns, popupContent: { ...content, titleField }, records: baseRecords.length ? baseRecords : [view.feature.properties || {}] }, ...joined],
        title: view.arcInfo?.title,
        coordinates: view.feature.geometry?.type === "Point" ? view.feature.geometry.coordinates : null,
        onLayout: () => { if (context.popups.mapPopupView === view) sizeMapPopup(view); } });
    } else card = chartMode ? document.createElement("div") : view.arcInfo ? view.arcInfo.createContent() : aiWeatherPopupContent(view.feature);
    if (selection.mode === "info" && joined.length) {
      const sources = document.createElement("div"); sources.className = "popup-source-records popup-joined-records";
      for (const source of joined) for (const record of source.records) sources.append(createAiPopupContent(document, { properties: record }, source.columns,
        source.popupContent.titleField, { datasetTitle: source.title }));
      card.append(sources);
    }
    let chart;
    if (chartMode) {
      card.className = "weather-popup ai-popup-chart-only";
      const dimensionFilters = Object.fromEntries(Object.entries(dataset.filters || {}).filter(([field]) =>
        dataset.analysis.columns.some(column => column.name === field && column.role !== "time")));
      const records = context.modules.active()?.getPopupContext(view.feature).chartRecords || dataset.records;
      chart = buildPopupChart({ records: view.arcInfo?.records || records,
        columns: view.arcInfo ? popupChartColumns(dataset.analysis.columns, activeMapPopupSuggestion().bindings) : dataset.analysis.columns,
        feature: view.arcInfo ? { properties: { __arcPopupTitle: view.arcInfo.title } } : view.feature,
        regionField: view.arcInfo ? "__arcPopupTitle" : dataset.recommendation.geometry.field,
        kind: selection.mode, selection: selection[selection.mode], chartType: view.arcInfo ? "choropleth" : activeMapPopupSuggestion().chartType,
        bindings: view.arcInfo ? {} : activeMapPopupSuggestion().bindings });
      const container = document.createElement("div");
      container.className = chart.config ? "ai-popup-chart" : "weather-popup-status";
      if (!chart.config) { container.textContent = chart.message; container.setAttribute("role", "status"); }
      else { view.chartContainer = container; view.chartKind = selection.mode; }
      card.append(container);
    }
    view.popup.setDOMContent(card);
    const popupElement = view.popup.getElement();
    popupElement.classList.toggle("has-popup-chart", chartMode);
    popupElement.classList.toggle("has-info-image", selection.mode === "info_image");
    sizeMapPopup(view);
    if (chart?.config) {
      const fallback = () => { view.templateChartCleanup = null; chartRenderer(selection.mode).render(view.chartContainer, chart.config); };
      view.templateChartCleanup = options.onPopupChart?.({ kind: selection.mode, container: view.chartContainer, chart: chart.config, fallback }) || null;
      if (!view.templateChartCleanup) fallback();
    }
  }

  function sizeMapPopup(view) {
    const popupElement = view.popup.getElement();
    const mapContainer = context.map.getContainer();
    popupElement.style.setProperty("--popup-map-width", `${Math.max(0, mapContainer.clientWidth - 32)}px`);
    popupElement.style.setProperty("--popup-map-height", `${Math.max(0, mapContainer.clientHeight - 32)}px`);
    // Keep the whole card inside the map, including after changing its type or
    // resizing the sidebar. The tip is hidden, so a centered card can be clamped.
    const point = context.map.project(view.lngLat);
    const halfWidth = popupElement.offsetWidth / 2;
    const halfHeight = popupElement.offsetHeight / 2;
    view.popup.setLngLat(context.map.unproject([
      Math.max(halfWidth + 16, Math.min(mapContainer.clientWidth - halfWidth - 16, point.x)),
      Math.max(halfHeight + 16, Math.min(mapContainer.clientHeight - halfHeight - 16, point.y))
    ]));
  }

  function openMapPopup(feature, lngLat, layerId = null, arcInfo = null) {
    closeMapPopup();
    context.popups.cellPopup?.remove();
    const popup = new maplibregl.Popup({ anchor: "center", maxWidth: "520px", className: "ai-weather-popup ai-map-popup", closeOnClick: !arcInfo })
      .setDOMContent(document.createElement("div"));
    const view = { popup, feature, lngLat, layerId, arcInfo, chartContainer: null, chartKind: null };
    context.popups.mapPopupView = view;
    popup.on("close", () => {
      clearMapPopupChart(view);
      if (context.popups.mapPopupView === view) context.popups.mapPopupView = null;
    });
    view.ownerId = options.id;
    if (layerId === "h3-fill") openCellPopup(popup, feature, layerId);
    else popup.setLngLat(lngLat).addTo(context.map);
    renderMapPopup(view);
  }

  function refreshMapPopup() {
    const view = context.popups.mapPopupView;
    if (!view) return;
    const suggestion = activeMapPopupSuggestion();
    if (!suggestion) { closeMapPopup(); return; }
    if (view.arcInfo) { renderMapPopup(view); return; }
    const field = suggestion.bindings.region;
    const features = context.modules.active()?.getPopupContext(view.feature).data?.features;
    const feature = (view.layerId === "point-marker" && view.feature.id != null ? features?.find(item => item.id === view.feature.id) : null) || features?.find(item => view.layerId === "h3-fill"
      ? item.properties.h3 === view.feature.properties.h3
      : popupFeaturesMatch(item, view.feature, field, { chartType: suggestion.chartType, columns: state.aiDataset.analysis.columns, bindings: suggestion.bindings }));
    if (!feature) { closeMapPopup(); return; }
    view.feature = feature;
    if (view.layerId === "h3-fill") showCellFocus(feature, view.layerId);
    renderMapPopup(view);
  }

  function buildMapPopupControls(dataset, suggestion) {
    suggestion = activeMapPopupSuggestion()?.id === suggestion.id ? activeMapPopupSuggestion() : suggestion;
    const columns = dataset.analysis.columns;
    const selection = popupSelectionFor(suggestion);
    const group = document.createElement("div");
    group.className = "ai-control-group";
    const caption = document.createElement("span"); caption.textContent = "Kiểu hiển thị popup";
    const types = document.createElement("div");
    types.className = "ai-popup-types";
    types.setAttribute("role", "group"); types.setAttribute("aria-label", "Kiểu hiển thị popup");
    const definition = mapRegistry[suggestion.chartType];
    const subject = definition.popupSubject;
    const labels = {
      info: ["Chỉ hiển thị thông tin", "Hiển thị các chỉ số dưới dạng thẻ thông tin", null],
      info_image: ["Thông tin kèm hình ảnh", "Xem hình ảnh và thông tin của đối tượng", "image"],
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
      title.textContent = option.fallback && !definition.namedPopupFallback ? "Hiển thị mặc định" : label;
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
    if (["bar", "line"].includes(selection.mode)) nodes.push(buildMapPopupSettings(dataset, selection));
    return nodes;
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
      settings.append(services.ui.aiField("Hình thức hiển thị", variants));
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
    } else settings.append(services.ui.aiField("Chỉ số biểu đồ", services.ui.aiSelect("ai-popup-metric", metrics.map(item => [item.key, item.label]),
      selection.mode === "bar" ? config.metrics[0] : config.measure)));
    if (selection.mode === "bar") {
      const aggregation = services.ui.aiSelect("ai-popup-aggregation", [["auto", "Theo dữ liệu"], ["sum", "Tổng (SUM)"],
        ["mean", "Trung bình (AVG)"], ["min", "Nhỏ nhất (MIN)"], ["max", "Lớn nhất (MAX)"]], config.aggregation);
      aggregation.disabled = config.metrics.every(metric => metric === "count");
      settings.append(services.ui.aiField("Cách tính giá trị", aggregation));
    }
    const time = popupTimeColumn(columns);
    const times = time ? uniqueTimeValues(dataset.records, time) : [];
    if (times.length) {
      const choices = times.map(value => [comparableFilterValue(value), formatTimeValue(value, time,
        value instanceof Date && Boolean(value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds()))]);
      const labels = mapRegistry[activeMapPopupSuggestion()?.chartType]?.popupTimeLabels || ['Biểu đồ từ ngày', 'Đến ngày'];
      for (const [edge, label] of [["from", labels[0]], ["to", labels[1]]]) {
        const control = services.ui.aiSelect("ai-popup-range", choices, config[edge]); control.dataset.edge = edge;
        settings.append(services.ui.aiField(label, control));
      }
    }
    return settings;
  }

  function refreshMapPopupControls() {
    context.modules.active()?.renderFilters?.();
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
      if (checked.length < 2) { control.checked = true; services.ui.showToast("Cột ghép cần ít nhất 2 chỉ số."); return; }
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

  return { cellCenter, showCellFocus, openCellPopup, chartRenderer, aiWeatherPopupContent, showAiPolygonDetails, activeMapPopupSuggestion, popupSelectionFor, clearMapPopupChart, closeMapPopup, renderMapPopup, sizeMapPopup, openMapPopup, refreshMapPopup, buildMapPopupControls, buildMapPopupSettings, refreshMapPopupControls, changeMapPopupControl };
}

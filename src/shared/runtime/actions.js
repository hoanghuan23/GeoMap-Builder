import { nativeMapView as default_nativeMapView } from "../data/native-map-data.js";

import { analyzeSpatialData as default_analyzeSpatialData } from "../data/data-capabilities.js";

import { prepareSuggestions as default_prepareSuggestions } from "../import/ai-chart-pipeline.js";
import { mapDisplaySuggestions as default_mapDisplaySuggestions } from "../popup/ai-popup-chart.js";

/** runtime operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const nativeMapView = (...args) => (context.dependencies?.nativeMapView ?? default_nativeMapView)(...args);

  const analyzeSpatialData = (...args) => (context.dependencies?.analyzeSpatialData ?? default_analyzeSpatialData)(...args);

  const prepareSuggestions = (...args) => (context.dependencies?.prepareSuggestions ?? default_prepareSuggestions)(...args);

  const mapDisplaySuggestions = (...args) => (context.dependencies?.mapDisplaySuggestions ?? default_mapDisplaySuggestions)(...args);


  function createAbortController() {
    return typeof AbortController === "function" ? new AbortController() : { signal: undefined, abort() {} };
  }

  function cancelAiBoundaryLoad() {
    context.tasks.aiBoundaryAbortController?.abort();
    context.tasks.aiBoundaryAbortController = null;
    context.tasks.aiBoundaryRevision += 1;
  }

  function clearUploadedData({ preserveUploads = false } = {}) {
    services.popup.closeMapPopup(); context.modules.clear();
    context.tasks.tabularAbortController?.abort(); context.tasks.tabularAbortController = null; context.tasks.tabularLoadRevision++;
    cancelAiBoundaryLoad(); if (!preserveUploads) services.uploads.clearUploadLayers();
    state.primaryUploadId = null; state.boundary = null; state.sourceBoundary = null;
    state.mapType = null; state.dataProfile = null; state.dataOrigin = null; state.aiDataset = null; state.pendingSheet = null;
    $('sheet-selector-field').hidden = true; $('sheet-selector').replaceChildren(); $('ai-data-filters').hidden = true;
    services.ui.updateModelSections(); $('map-type-grid').className = 'map-type-grid is-empty'; $('map-type-grid').textContent = 'Chưa có dữ liệu để đề xuất mô hình.';
    $('map-type-summary').textContent = ''; services.ui.showSupportedChartCatalog(true);
    $('selected-file').hidden = true; $('remove-current-file').hidden = true; $('spatial-file').value = ''; $('uploaded-layer-list')?.replaceChildren();
  }

  async function resetConfiguration() {
    await context.modules.active()?.reset();
    $('show-map-layers').checked = true; $('show-map-layers-status').textContent = 'Đang bật';
    services.view.applyStyle(); services.view.updateDashboard();
  }

  function deleteData() {
    clearUploadedData();
    $("coordinate-input").value = "";
    services.view.applyMapLayerVisibility();
    services.view.updateDashboard();
  }

  function clearAiMapState() {
    context.modules.clear();
    services.popup.closeMapPopup();
    cancelAiBoundaryLoad();
    state.aiDataset = null;
    services.ui.renderMapMetricControls();
    context.search?.setData();
    $("ai-data-filters").hidden = true;
    $("ai-filter-controls").replaceChildren();
  }

  async function selectAiSuggestion(id) {
    if(context.disposed)return null;
    const dataset=state.aiDataset;
    const suggestion = dataset?.suggestions.find(item => item.id === id);
    if (!suggestion) return false;
    if (state.aiDataset.selectedSuggestionId !== id) services.popup.closeMapPopup();
    if (!suggestion.available && suggestion.repairable) {
    cancelAiBoundaryLoad();
      state.aiDataset.selectedSuggestionId = id;
      state.aiDataset.recommendation = services.ui.recommendationForSuggestion(suggestion);
      services.ui.populateAiFilters(state.aiDataset);
      context.modules.get(suggestion.chartType)?.renderRepair?.(suggestion.geoUnmatched || []);
      services.ui.renderAiSuggestionGrid();
      services.ui.setStatus("Hãy nhập alias cho địa danh chưa khớp rồi chọn Thử ghép lại.", true);
      return true;
    }
    if (!suggestion.available) return false;
    state.aiDataset.selectedSuggestionId = id;
    const module = context.modules.get(suggestion.chartType);
    if (!module) return false;
    for (const instance of context.modules.instances.values()) if (instance !== module) instance.setVisible(false);
    cancelAiBoundaryLoad();
    state.mapType = module.definition.viewType;
    module.restore();
    const result = await module.activate(suggestion);
    if(result===null || context.disposed || dataset!==state.aiDataset || dataset.selectedSuggestionId!==id)return null;
    if (dataset.hiddenMetricFields?.includes(module.metricField())) {
      const replacement = module.metricColumns()[0];
      if (replacement) await module.changeMetric(replacement.name);
    }
    services.ui.updateModelSections(); services.view.applyMapLayerVisibility(); services.ui.renderAiSuggestionGrid(); services.view.updateDashboard();
    return result;
  }

  function clearMapData() {
    services.popup.closeMapPopup(); context.modules.clear(); state.boundary = null; state.sourceBoundary = null;
  }

  async function replaceAiPipelineData(pipeline, name) {
    clearAiMapState(); state.mapType = null; state.dataProfile = null;
    state.dataOrigin = "ai"; clearMapData();

    const suggestions = prepareSuggestions(pipeline.analysis, pipeline.records, pipeline.validRowRate);
    state.aiDataset = {
      ...pipeline,
      fileName: name,
      suggestions,
      selectedSuggestionId: null,
      geoAliases: {},
      geoSelections: {},
      popupSelections: {},
      ...(Array.isArray(pipeline.analysis.popupFields) ? { popupFields: [...pipeline.analysis.popupFields] } : {}),
      recommendation: null,
      boundaries: null
    };
    services.uploads.showCurrentFile(name, `${pipeline.records.length.toLocaleString("vi-VN")} bản ghi · ${pipeline.analysis.source === "ai" ? "AI đã phân tích" : "AI chưa phân tích được dữ liệu"}`);
    services.ui.renderAiSuggestionGrid();
    let selected = false;
    const visibleSuggestions = mapDisplaySuggestions(suggestions);
    const initialSuggestions = visibleSuggestions;
    for (const suggestion of initialSuggestions.filter(item => item.available)) {
      const result = await services.runtime.selectAiSuggestion(suggestion.id);
      if (result === null) return;
      if (result) { selected = true; break; }
    }
    if (!selected) {
      services.ui.updateModelSections();
      services.ui.setStatus(pipeline.fallbackReason || "AI chưa đề xuất được bản đồ khả dụng. Xem kết quả phân tích và lý do của từng đề xuất.");
    }
  }

  async function replaceBoundary(data, name, profile = null, { preserveType = null, preserveAi = false } = {}) {
    context.modules.clear(); if (!preserveAi) clearAiMapState();
    if (!data) throw new Error('Không tìm thấy dữ liệu.');
    state.dataOrigin = 'upload'; state.sourceBoundary = data; state.boundary = data;
    if (preserveType) state.mapType = preserveType;
    services.ui.renderCompatibleMapTypes(data, profile || analyzeSpatialData(data));
    const module = context.modules.active(); module?.restore(); module?.acceptData(data);
    services.uploads.showCurrentFile(name, 'Dữ liệu đã tải · đang sử dụng');
    services.ui.updateModelSections(); services.view.fitGeoJSON(data); services.uploads.refreshClippedUploadLayers(); services.view.applyStyle();
  }

  function activateNativeMap(suggestion) {
    const dataset = state.aiDataset;
    dataset.selectedSuggestionId = suggestion.id;
    dataset.recommendation = services.ui.recommendationForSuggestion(suggestion);
    dataset.recommendation.geometry.provider = "native";
    dataset.recommendation.filters = dataset.recommendation.filters.filter(filter => !filter.field.startsWith("__"));
    state.mapType = context.modules.get(suggestion.chartType).definition.viewType;
    services.ui.populateAiFilters(dataset); services.ui.renderAiSuggestionGrid(); refreshNativeMap();
  }

  function refreshNativeMap({ fit = false } = {}) {
    const dataset = state.aiDataset; dataset.filters = services.ui.selectedAiFilters();
    const data = nativeMapView(dataset, dataset.filters);
    context.modules.active()?.acceptData(data);
    state.sourceBoundary = { type: 'FeatureCollection', features: dataset.nativeGeometry.features };
    state.dataProfile = analyzeSpatialData(data, { numericFields: [dataset.recommendation.metricField, ...dataset.recommendation.numericFields]
      .filter((field,index,fields) => dataset.recommendation.numericFields.includes(field) && fields.indexOf(field) === index) });
    services.ui.updateModelSections(); services.view.applyStyle(); services.popup.refreshMapPopup();
    context.modules.active()?.refreshGeometry?.();
    if (fit) services.view.fitGeoJSON(data);
  }

  return { createAbortController, cancelAiBoundaryLoad, clearUploadedData, resetConfiguration, deleteData, clearAiMapState, selectAiSuggestion, clearMapData, replaceAiPipelineData, replaceBoundary, activateNativeMap, refreshNativeMap };
}

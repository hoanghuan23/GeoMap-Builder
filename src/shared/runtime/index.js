import { createContext } from './context.js';
import { createController as createActions } from './actions.js';
import { createController as createUI } from '../ui/controller.js';
import { createController as createView } from '../view/controller.js';
import { createController as createPopup } from '../popup/controller.js';
import { createController as createInput } from '../import/controller.js';
import { createController as createUploads } from '../import/layers.js';
import { createModuleRouter } from '../../maps/browser-registry.js';

/** One runtime per dataset. Workspace owns the canvas and resource namespace. */
export function createMapLayerRuntime(options) {
  const context = createContext(options);
  const { state, services, tasks, popups } = context;
  services.runtime = createActions(context);
  services.ui = createUI(context);
  services.view = createView(context);
  services.popup = createPopup(context);
  services.input = createInput(context);
  services.uploads = createUploads(context);
  context.modules = createModuleRouter(context, options.mapFactories);
  const api = {
    state,
    getView() { return context.modules.active()?.getView() || { data: state.boundary || state.sourceBoundary, tableRecords: state.aiDataset?.records || [], legendVisible: true }; },
    readSpatialFile: services.input.readSpatialFile, applyReadResult: services.input.applyReadResult,
    processSpatialFiles: services.input.processSpatialFiles, removeUploadedFile: services.uploads.removeUploadedFile,
    resizePopup() { if (popups.mapPopupView) services.popup.sizeMapPopup(popups.mapPopupView); },
    closePopup() { services.popup.closeMapPopup(); popups.cellPopup?.remove(); for(const module of context.modules.instances.values())module.closePopup?.(); },
    openPopup(feature, center) {
      const popup=context.modules.active()?.getPopupContext(feature);
      if(popup?.open)return popup.open();
      if (state.aiDataset) services.popup.openMapPopup(feature, center, popup?.popupLayerId);
      else services.uploads.showUploadedFeaturePopup(feature, { name: state.fileName || 'Dữ liệu', role: state.mapType }, center);
    },
    refreshPopupMetadata() { if (services.popup.activeMapPopupSuggestion()) services.popup.refreshMapPopupControls(); },
    searchData: services.view.currentDataSearch,
    setVisible(value) {
      const toggle = context.document.getElementById('show-map-layers'); toggle.checked = value;
      context.document.getElementById('show-map-layers-status').textContent = value ? 'Đang bật' : 'Đang tắt'; services.view.applyMapLayerVisibility();
    },
    setSamples(value) { context.document.getElementById('ai-include-samples').checked = value; },
    fit() { services.view.fitGeoJSON(state.boundary || state.sourceBoundary); },
    update() { services.ui.updateModelSections(); services.view.applyStyle(); },
    async load(result, file) { state.fileName = file.name; await services.input.applyReadResult(result, file); services.view.renderTable(); },
    initialize() { context.map = options.map; context.search = { setData() { options.onChange?.(); }, refreshHighlight() {} };
      for (const definition of Object.keys(context.modules.factories || {})) context.modules.get(definition);
      services.ui.renderSupportedChartCatalog(); services.ui.bindUI(); services.view.addMapLayers(); services.view.updateDashboard(); },
    dispose() {
      if(context.disposed)return;context.disposed=true;
      api.closePopup(); context.modules.dispose(); tasks.tabularLoadRevision++; tasks.tabularAbortController?.abort(); services.runtime.cancelAiBoundaryLoad(); tasks.regionHexBuildRevision++;
      clearTimeout(tasks.toastTimer); clearTimeout(tasks.statusTimer); clearTimeout(tasks.layerOrderTimer);
    }
  };
  return Object.assign(api, { controllers: services, context });
}

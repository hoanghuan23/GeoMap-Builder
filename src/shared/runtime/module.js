import { geometryExtent } from '../view/map-layer-data.js';
import { mapDisplayColumns } from '../data/display-fields.js';

/** A map owns its mutable model; only dataset metadata is shared within its runtime. */
export function moduleContext(context, defaults) {
  const model = context.dependencies?.createModuleState?.(defaults) || structuredClone(defaults);
  const state = new Proxy(context.state, {
    get(target, key) { return Object.hasOwn(model, key) ? model[key] : target[key]; },
    set(target, key, value) { if (Object.hasOwn(model, key)) model[key] = value; else target[key] = value; return true; }
  });
  const child = { ...context, state, model };
  const subscriptions=[];
  const controls=[];
  child.listen=(target,...args)=>{target.addEventListener(...args);controls.push([target,args]);};
  const map=new Proxy({}, {get(_target,key){const owner=context.map;if(!owner)return undefined;
    if(key==='on')return (...args)=>{owner.on(...args);subscriptions.push(args);return map;};
    const value=owner[key];return typeof value==='function'?value.bind(owner):value;
  }});
  child.releaseEvents=()=>{for(const args of subscriptions)context.map?.off?.(...args);subscriptions.length=0;
    for(const [target,args]of controls)target.removeEventListener?.(...args);controls.length=0;};
  Object.defineProperty(child, "map", { get: () => context.map ? map : undefined });
  Object.defineProperty(child, "search", { get: () => context.search });
  Object.defineProperty(child, "disposed", { get: () => context.disposed });
  return child;
}

export function viewSnapshot(context, definition, { data, sourceData = context.state.sourceBoundary || data,
  searchData = data, titleField, filtered = false, legendVisible = true, tableRecords, popupLayerId, camera = null, configuration = null } = {}) {
  const { state } = context; const dataset = state.aiDataset;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  if (!dataset && context.tasks.dataSearchProfile !== state.dataProfile) {
    context.tasks.dataSearchProfile=state.dataProfile;
    context.tasks.dataSearchColumns=(state.dataProfile?.textFields || []).filter(name=>!name.startsWith('__')).map(name=>({name,role:'text'}));
  }
  const columns=dataset?.analysis.columns || state.spatialAnalysis?.columns || context.tasks.dataSearchColumns;
  const search = { data: searchData, columns, titleField: dataset?.nativeTitleField || titleField || dataset?.recommendation?.geometry?.field,
    chartType: dataset?.nativeGeometry ? undefined : suggestion?.chartType,
    search_bar: dataset?.analysis.search_bar ?? state.spatialAnalysis?.search_bar,
    search_fields: dataset?.analysis.search_fields || state.spatialAnalysis?.search_fields,
    regionNavigation: dataset?.analysis.regionNavigation ?? state.spatialAnalysis?.regionNavigation,
    filtered: filtered || Object.values(dataset?.filters || {}).some(value => Array.isArray(value) ? value.length > 0 : value != null && value !== ''),
    sourceRecords: dataset?.records, locationKeys: dataset?.boundaries?.locationKeys };
  const extent = geometryExtent(data);
  // Most callers only need map/search metadata. Materialize rows on demand and
  // keep them within this snapshot so later data/property edits stay fresh.
  let records = tableRecords;
  return { data, sourceData, search, configuration, extent, legendVisible, popupLayerId, camera, definition,
    get tableRecords() {
      return records ||= dataset && (!state.mapType || !extent) ? dataset.records : (data?.features || []).map(feature => feature.properties || {});
    } };
}

/** Shared lifecycle only; drawing, controls and data transformations stay in each map. */
export function lifecycle(context, definition, controller, behavior) {
  let disposed = false; let eventsBound = false; let controlsBound = false;
  const ids = behavior.layerIds;
  const api = {
    definition, controller,
    activate(suggestion, dataset = context.state.aiDataset) {
      if (disposed) return null;
      context.state.aiDataset = dataset;
      context.state.mapType = definition.viewType;
      api.restore();
      if(dataset?.nativeGeometry && definition.nativeKind){context.services.runtime.activateNativeMap(suggestion);return true;}
      return behavior.activate(suggestion);
    },
    update(change = {}) { if (disposed) return; api.restore(); return behavior.update(change); },
    setVisible(value) {
      if (disposed) return;
      for (const id of ids) if (context.map?.getLayer(id)) context.map.setLayoutProperty(id, 'visibility', value ? 'visible' : 'none');
      behavior.visibility?.(value);
    },
    reset() { if (!disposed) return behavior.reset(); },
    clear() { behavior.clear?.(); for (const id of behavior.sourceIds || []) context.map?.getSource(id)?.setData({ type: 'FeatureCollection', features: [] }); },
    restore() {
      if (disposed || !context.map) return;
      behavior.restore();
      if (!eventsBound) { behavior.bindEvents?.(); eventsBound = true; }
    },
    acceptData: data => behavior.acceptData?.(data),
    refreshGeometry: () => behavior.refreshGeometry?.(),
    style: () => behavior.style?.(),
    renderControls: () => behavior.renderControls?.(),
    bindControls() { if(controlsBound)return;controlsBound=true;behavior.bindControls?.(); },
    handleChange: event => behavior.handleChange?.(event),
    handleClick: event => behavior.handleClick?.(event),
    allMetricColumns: () => behavior.metricColumns?.() || [],
    metricColumns: () => {
      const dataset = context.state.aiDataset;
      const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
      return mapDisplayColumns(dataset, suggestion, behavior.metricColumns?.() || []);
    },
    metricField: () => behavior.metricField?.(),
    changeMetric: field => api.metricColumns().some(column => column.name === field) ? behavior.changeMetric?.(field) : false,
    getView: () => behavior.getView(),
    getPopupContext: feature => ({ ...api.getView(), feature, ...(behavior.popupContext?.(feature) || {}) }),
    presentation: () => behavior.presentation(),
    dispose() { if (disposed) return; disposed = true; behavior.dispose?.(); context.releaseEvents(); api.clear();
      for(const id of [...ids].reverse())if(context.map?.getLayer(id))context.map.removeLayer?.(id);
      for(const id of behavior.sourceIds || [])if(context.map?.getSource(id))context.map.removeSource?.(id); }
  };
  return api;
}

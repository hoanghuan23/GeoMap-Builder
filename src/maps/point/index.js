import { controls } from "./controls.js";
import { definition } from './definition.js';
import { createController } from './controller.js';
import { moduleContext, lifecycle, viewSnapshot } from '../../shared/runtime/module.js';
import { PointRenderer } from './renderer.js';
import { DEFAULT_POINT_STYLE, mergePointStyle, pointPaint } from './style.js';
import { pointTitleField } from './identity.js';

export function create(parent) {
  for(const [slot,html] of Object.entries(controls))parent.document.mountHTML?.(slot,html);
  const context = moduleContext(parent, { pointData: { type: 'FeatureCollection', features: [] }, pointStyle: { ...DEFAULT_POINT_STYLE } });
  const { state, services, document } = context; const $ = id => document.getElementById(id);
  const controller = createController(context);
  const module=lifecycle(context, definition, controller, {
    bindControls: controller.bindControls, handleChange: controller.handleChange, handleClick: controller.handleClick,
    layerIds: ['point-marker'], sourceIds: ['point-data'],
    activate: controller.activateAiPoint,
    acceptData(data) { state.pointData=data;state.boundary=data;context.map.getSource("point-data")?.setData(data); },
    update(change) {
      if(change.style){state.pointStyle=mergePointStyle({...state.pointStyle,...change.style});controller.refreshPointStyle();controller.renderPointStyleControls();return;}
      if(change.metric)return module.changeMetric(change.metric);
      if(change.selection)Object.assign(controller.pointSelectionFor(controller.activePointSuggestion()),change.selection);
      return controller.refreshPointView(controller.activePointSuggestion(), change);
    },
    restore() { PointRenderer.render(context.map, state.pointData, { sourceId: 'point-data', layerId: 'point-marker',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 6, 16, 10] } }); },
    style() { for (const [key, value] of Object.entries(state.aiDataset?.activePointView?.paint || pointPaint(state.pointStyle)))
      if (context.map.getLayer('point-marker')) context.map.setPaintProperty('point-marker', key, value); controller.renderPointLegend(); },
    visibility(value) { controller.renderPointLegend(); if(!value)$('point-legend').hidden=true; },
    bindEvents() { context.map.on('click', 'point-marker', event => { const feature = event.features?.[0]; if (feature) services.popup.openMapPopup(feature, event.lngLat || feature.geometry.coordinates, 'point-marker'); });
      context.map.on('mouseenter', 'point-marker', () => { context.map.getCanvas().style.cursor = 'pointer'; });
      context.map.on('mouseleave', 'point-marker', () => { context.map.getCanvas().style.cursor = ''; }); },
    reset() { state.pointStyle = mergePointStyle(); if (state.aiDataset) state.aiDataset.pointColorOverrides = Object.create(null);
      controller.refreshPointStyle(); controller.renderPointStyleControls(); },
    clear() { state.pointData = { type: 'FeatureCollection', features: [] }; },
    renderControls() { controller.renderPointStyleControls(); },
    metricColumns: () => { const suggestion = controller.activePointSuggestion(); return suggestion ? controller.pointModelFor(suggestion).measures : []; },
    metricField: () => { const suggestion = controller.activePointSuggestion(); return suggestion && controller.pointSelectionFor(suggestion).metricField; },
    popupContext: () => ({ titleField: pointTitleField(state.aiDataset?.analysis.columns || []) || state.aiDataset?.analysis.search_fields?.[0] }),
    changeMetric(field) { const suggestion = controller.activePointSuggestion(); controller.pointSelectionFor(suggestion).metricField = field;
      for (const select of document.querySelectorAll('#ai-filter-controls .ai-point-metric')) select.value = field; controller.refreshPointView(suggestion); },
    getView() { const selection = state.aiDataset?.activePointView?.selection;
      return viewSnapshot(context, definition, { data: state.pointData, titleField: pointTitleField(state.aiDataset?.analysis.columns || []),
        filtered: Boolean(selection?.mode === 'pick' || selection?.time), legendVisible: state.pointStyle.showLegend, configuration:{style:{...state.pointStyle}}, popupLayerId: 'point-marker' }); },
    presentation: () => ({ stylePanel: 'point-style-controls', description: 'Kích thước, màu sắc, độ mờ, đường viền và chú giải', filterDescription: 'Chọn chỉ số, nhóm điểm và thời gian hiển thị' })
  });
  module.renderFilters=()=>controller.populatePointControls(controller.activePointSuggestion());
  return module;
}

import { controls } from "./controls.js";
import { definition } from './definition.js';
import { createController } from './controller.js';
import { moduleContext, lifecycle, viewSnapshot } from '../../shared/runtime/module.js';
import { EMPTY_FEATURE_COLLECTION } from '../../shared/configuration.js';
import { roadValueColumns } from './data.js';
import { isCoordinateLine } from './coordinates.js';
import { withSuggestionMetric } from '../../shared/import/ai-chart-pipeline.js';

export function create(parent) {
  for(const [slot,html] of Object.entries(controls))parent.document.mountHTML?.(slot,html);
  const context = moduleContext(parent, { lineData: EMPTY_FEATURE_COLLECTION, roadDisplayStyle: { ...definition.defaultStyle } });
  const { state, services, document } = context; const $ = id => document.getElementById(id);
  const controller = createController(context);
  const module=lifecycle(context, definition, controller, {
    bindControls: controller.bindControls, handleChange: controller.handleChange, handleClick: controller.handleClick,
    layerIds: ['data-lines'], sourceIds: ['line-data'], activate: controller.activateAiRoadMap,
    update(change) { if(change.style){state.roadDisplayStyle={...state.roadDisplayStyle,...change.style};module.style();controller.renderRoadStyleControls();return;}
      if(change.metric)return module.changeMetric(change.metric);
      return state.aiDataset?.nativeGeometry ? services.runtime.refreshNativeMap(change) : controller.refreshAiRoadMap(change);
    },
    acceptData(data) { state.lineData=data;state.boundary=data;if(state.aiDataset)state.aiDataset.roadStyle=controller.aiLineStyle(data,controller.activeRoadSuggestion());context.map.getSource("line-data")?.setData(data); },
    restore() { if (!context.map.getSource('line-data')) context.map.addSource('line-data', { type: 'geojson', data: state.lineData });
      if (!context.map.getLayer('data-lines')) context.map.addLayer({ id: 'data-lines', type: 'line', source: 'line-data', paint: { 'line-color': '#c52e64', 'line-width': 3 } }); },
    style() { if (context.map.getLayer('data-lines')) { context.map.setPaintProperty('data-lines', 'line-color', controller.activeRoadSuggestion() ? state.aiDataset?.roadStyle?.color || '#94a3b8' : '#c52e64');
      context.map.setPaintProperty('data-lines', 'line-width', state.roadDisplayStyle.width); context.map.setPaintProperty('data-lines', 'line-opacity', state.roadDisplayStyle.opacity); }
      controller.renderRoadLegend(); },
    visibility(value) { controller.renderRoadLegend(); if(!value)$('ai-line-legend').hidden=true; },
    bindEvents() { context.map.on('click', 'data-lines', event => { if (event.features?.[0]) services.popup.openMapPopup(event.features[0], event.lngLat, 'data-lines'); });
      context.map.on('mouseenter', 'data-lines', () => { context.map.getCanvas().style.cursor = 'pointer'; }); context.map.on('mouseleave', 'data-lines', () => { context.map.getCanvas().style.cursor = ''; }); },
    reset() { state.roadDisplayStyle = { ...definition.defaultStyle }; if(state.aiDataset)state.aiDataset.roadStyle = controller.aiLineStyle(state.lineData, controller.activeRoadSuggestion()); controller.renderRoadStyleControls(); },
    clear() { state.lineData = EMPTY_FEATURE_COLLECTION; },
    dispose() { if(state.mapType === definition.viewType)services.runtime.cancelAiBoundaryLoad(); },
    renderControls: controller.renderRoadStyleControls,
    metricColumns() { const dataset = state.aiDataset; const suggestion = controller.activeRoadSuggestion();
      if (!dataset || !suggestion) return []; const excluded = isCoordinateLine(suggestion) ? Object.values(suggestion.bindings).filter(value => [suggestion.bindings.lat, suggestion.bindings.lng, suggestion.bindings.x].includes(value)) : [];
      return roadValueColumns(dataset.analysis.columns.filter(column => !column.name.startsWith('__') && !['point_lat','point_lng','h3'].includes(column.geoLevel) && !excluded.includes(column.name)), dataset.records, suggestion.bindings.region); },
    metricField: () => state.aiDataset?.recommendation?.metricField,
    changeMetric(field) { const suggestion = controller.activeRoadSuggestion(); Object.assign(suggestion, withSuggestionMetric(suggestion, field, state.aiDataset.analysis.columns));
      state.aiDataset.recommendation = services.ui.recommendationForSuggestion(suggestion); return state.aiDataset?.nativeGeometry ? services.runtime.refreshNativeMap() : controller.refreshAiRoadMap(); },
    getView: () => viewSnapshot(context, definition, { data: state.lineData, legendVisible: state.roadDisplayStyle.showLegend, configuration:{style:{...state.roadDisplayStyle}}, popupLayerId: 'data-lines' }),
    presentation: () => ({ stylePanel: 'road-style-controls', lineToggleLabel:'Hiển thị tuyến đường', description: 'Chú giải màu, độ dày và độ mờ tuyến', filterDescription: 'Chọn cách hiển thị và chỉ số dữ liệu' })
  });
  module.renderFilters=()=>services.ui.populateAiFilters(state.aiDataset);
  return module;
}

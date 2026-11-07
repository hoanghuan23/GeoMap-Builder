import { controls } from "./controls.js";
import { definition } from './definition.js';
import { createController } from './controller.js';
import { moduleContext, lifecycle, viewSnapshot } from '../../shared/runtime/module.js';
import { EMPTY_FEATURE_COLLECTION } from '../../shared/configuration.js';
import { CONFIG } from '../../shared/config.js';
import { PolygonRenderer } from './renderer.js';
import { polygonFillExpression } from './style.js';
import { renderGeographicScopeMarkers } from './scope-renderer.js';
import { categoryColorProperties, featureCategoryValues } from '../../shared/data/categorical-color.js';
import { popupRegionRecords } from "../../shared/popup/ai-popup-chart.js";
import { applyPipelineFilters, withSuggestionMetric } from '../../shared/import/ai-chart-pipeline.js';

export function create(parent) {
  for(const [slot,html] of Object.entries(controls))parent.document.mountHTML?.(slot,html);
  const context = moduleContext(parent, { h3Data: EMPTY_FEATURE_COLLECTION, polygonPalette: null, regionHexEnabled: false, regionHexResolution: CONFIG.DEFAULT_RESOLUTION });
  const { state, document, services } = context; const $ = id => document.getElementById(id);
  const controller = createController(context);
  function style() {
    const map = context.map; const scale = controller.activePolygonLegendScale();
    if (scale) controller.syncPolygonPaletteControls(scale);
    else { $('fixed-color').disabled = false; $('polygon-legend-summary').hidden = true; }
    const color = controller.fillExpression(); const opacity = Number($('opacity').value);
    const borderColor = $('border-color').value; const borderWidth = Number($('line-width').value);
    const fill = data => controller.usesDefaultPolygonColor() ? color : polygonFillExpression(data, state.dataProfile, state.polygonPalette, color, scale);
    if (map.getLayer('h3-fill')) { map.setPaintProperty('h3-fill', 'fill-color', fill(controller.isRegionHexMode() ? state.boundary : state.h3Data)); map.setPaintProperty('h3-fill', 'fill-opacity', opacity);
      map.setPaintProperty('h3-border', 'line-color', borderColor); map.setPaintProperty('h3-border', 'line-width', borderWidth); }
    if (map.getLayer('polygon-fill')) { map.setPaintProperty('polygon-fill', 'fill-color', fill(state.boundary)); map.setPaintProperty('polygon-fill', 'fill-opacity', opacity);
      map.setPaintProperty('polygon-border', 'line-color', borderColor); map.setPaintProperty('polygon-border', 'line-width', borderWidth); }
  }
  const module = lifecycle(context, definition, controller, {
    bindControls: controller.bindControls, handleChange: controller.handleChange, handleClick: controller.handleClick,
    layerIds: ['polygon-fill','polygon-border','vietnam-border','h3-fill','h3-border','scope-marker'], sourceIds: ['polygon-data','vietnam-boundary','h3-grid','scope-marker-data'],
    activate: controller.activateAiChoropleth,
    acceptData(data) { if(controller.usesCategoricalPolygonColor())for(const feature of data.features)feature.properties={...feature.properties,
      ...categoryColorProperties(state.aiDataset.recommendation.metricField,featureCategoryValues(feature.properties,state.aiDataset.recommendation.metricField))};
      state.boundary=data;context.map.getSource('polygon-data')?.setData({...data,features:(data.features || []).filter(feature=>["Polygon","MultiPolygon"].includes(feature.geometry?.type))});context.map.getSource('vietnam-boundary')?.setData(data); },
    refreshGeometry() { if(controller.isRegionHexMode())return controller.rebuildRegionHexGrid(); },
    update(change) {if(change.hex){context.tasks.regionHexBuildRevision++;if(change.hex.enabled!==undefined)state.regionHexEnabled=change.hex.enabled;
        if(change.hex.resolution!==undefined)state.regionHexResolution=change.hex.resolution;
        controller.syncRegionHexControls();return controller.isRegionHexMode()?controller.rebuildRegionHexGrid():services.view.applyStyle();}
      if(change.style){for(const[key,id]of Object.entries({color:'fixed-color',opacity:'opacity',borderColor:'border-color',borderWidth:'line-width'}))if(change.style[key]!=null)$(id).value=change.style[key];
        if(change.style.showBorder!==undefined)$('show-border').checked=change.style.showBorder;
        $('fixed-color-value').textContent=$('fixed-color').value.toUpperCase();$('opacity-value').value=`${Math.round(Number($('opacity').value)*100)}%`;
        $('border-color-value').textContent=$('border-color').value.toUpperCase();$('line-width-value').value=`${$('line-width').value} px`;
        if(change.style.palette!==undefined)state.polygonPalette=change.style.palette;style();module.setVisible($('show-map-layers').checked);return;}
      if(change.metric)return module.changeMetric(change.metric);
      return state.aiDataset?.nativeGeometry ? services.runtime.refreshNativeMap(change) : controller.filteredAiBoundary(change);
    },
    restore() { const map = context.map;
      for (const [id,data] of [['h3-grid',state.h3Data],['vietnam-boundary',state.boundary || EMPTY_FEATURE_COLLECTION]]) if (!map.getSource(id)) map.addSource(id,{type:'geojson',data});
      for (const layer of [
        {id:'h3-fill',type:'fill',source:'h3-grid',paint:{'fill-color':controller.fillExpression(),'fill-opacity':.72}},
        {id:'h3-border',type:'line',source:'h3-grid',paint:{'line-color':'#ffffff','line-width':.5,'line-opacity':.75}},
        {id:'vietnam-border',type:'line',source:'vietnam-boundary',paint:{'line-color':'#00e65c','line-width':2}}
      ]) if(!map.getLayer(layer.id)) map.addLayer(layer);
      if (!map.getSource('polygon-data') || !map.getLayer('polygon-fill') || !map.getLayer('polygon-border')) {
        PolygonRenderer.render(map,state.boundary ? {...state.boundary,features:(state.boundary.features || []).filter(feature=>["Polygon","MultiPolygon"].includes(feature.geometry?.type))} : EMPTY_FEATURE_COLLECTION,{sourceId:'polygon-data',fillLayerId:'polygon-fill',borderLayerId:'polygon-border',updateData:false,
          fillPaint:{'fill-color':'#389e55','fill-opacity':.32},borderPaint:{'line-color':'#00e65c','line-width':2}});
      }
      map.moveLayer?.('vietnam-border'); renderGeographicScopeMarkers(map,state.boundary);
    },
    style,
    visibility(value) { const map=context.map,hex=controller.isRegionHexMode();
      for(const[id,visible]of [['h3-fill',hex],['h3-border',hex&&$('show-border').checked],['polygon-fill',!hex],['polygon-border',!hex&&$('show-border').checked],['vietnam-border',!hex]])
        if(map.getLayer(id))map.setLayoutProperty(id,'visibility',value&&visible?'visible':'none');
      if(!value)context.popups.cellPopup?.remove();
      controller.renderWeatherLegend(); controller.renderScopeLegend(); if(!value){$('weather-legend').hidden=true;$('scope-legend').hidden=true;} },
    bindEvents() { const map=context.map;
      for(const id of ['polygon-fill','h3-fill','scope-marker']) { map.on('click',id,event=>{const feature=event.features?.[0];if(feature)services.popup.openMapPopup(feature,event.lngLat,id);});
        map.on('mouseenter',id,()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave',id,()=>{map.getCanvas().style.cursor='';}); }
    },
    reset() { context.tasks.regionHexBuildRevision++;state.regionHexEnabled=false;state.regionHexResolution=CONFIG.DEFAULT_RESOLUTION;state.polygonPalette=state.aiDataset?'diverging':null;
      $('region-hex-note').textContent=''; controller.syncRegionHexControls();
      for(const[id,value]of [['fixed-color','#6c5ce7'],['opacity',.72],['border-color','#ffffff'],['line-width',.5]])$(id).value=value;
      $('fixed-color-value').textContent='#6C5CE7';$('opacity-value').value='72%';$('show-border').checked=true;$('border-color-value').textContent='#FFFFFF';$('line-width-value').value='0.5 px';
      controller.syncPolygonPaletteControls(); return controller.refreshBoundary(); },
    clear() { context.tasks.regionHexBuildRevision++;state.h3Data=EMPTY_FEATURE_COLLECTION;state.regionHexEnabled=false; },
    dispose() { if(state.mapType === definition.viewType)services.runtime.cancelAiBoundaryLoad(); },
    renderControls() { controller.syncRegionHexControls();controller.syncPolygonPaletteControls(); },
    metricColumns() { const dataset=state.aiDataset,suggestion=controller.activePolygonSuggestion();if(!dataset||!suggestion)return[];
      return dataset.analysis.columns.filter(column=>!column.name.startsWith('__')&&!['point_lat','point_lng','h3'].includes(column.geoLevel)&&
        (column.role==='measure'||column.role==='category'&&(column.legend?.type==='categorical'||column.name===suggestion.bindings.value))); },
    metricField:()=>state.aiDataset?.recommendation?.metricField,
    changeMetric(field) { const suggestion=controller.activePolygonSuggestion();Object.assign(suggestion,withSuggestionMetric(suggestion,field,state.aiDataset.analysis.columns));
      state.aiDataset.recommendation=services.ui.recommendationForSuggestion(suggestion);return controller.filteredAiBoundary(); },
    popupContext(feature) { const dataset=state.aiDataset;const suggestion=controller.activePolygonSuggestion();
      const dimensions=Object.fromEntries(Object.entries(dataset?.filters||{}).filter(([field])=>dataset.analysis.columns.some(column=>column.name===field&&column.role!=='time')));
      return {legendScale:controller.activePolygonLegendScale(),chartRecords:dataset?applyPipelineFilters(dataset.records,dimensions):[],
        infoRecords:dataset&&(!dataset.recommendation?.metricField||controller.usesCategoricalPolygonColor())&&feature.properties?.__source_locations
          ? popupRegionRecords(applyPipelineFilters(dataset.records,dataset.filters||{}),feature,dataset.recommendation.geometry.field,{chartType:definition.id,columns:dataset.analysis.columns,bindings:suggestion?.bindings}):[]};
    },
    getView:()=>viewSnapshot(context,definition,{data:controller.isRegionHexMode()?state.h3Data:state.boundary,searchData:state.aiDataset?.searchBoundary||state.boundary,
      filtered:controller.selectedProvinceNames().length>0,configuration:{style:{color:$('fixed-color').value,opacity:Number($('opacity').value),borderColor:$('border-color').value,borderWidth:Number($('line-width').value),showBorder:$('show-border').checked},palette:state.polygonPalette,regionHexEnabled:state.regionHexEnabled,regionHexResolution:state.regionHexResolution},popupLayerId:controller.isRegionHexMode()?'h3-fill':'polygon-fill'}),
    presentation:()=>({stylePanel:'map-style-controls',description:'Màu cố định, dải màu, độ mờ và đường viền',filterDescription:'Chọn cách hiển thị và chỉ số dữ liệu',regionHex:true})
  });
  module.populateFilters=()=>controller.populatePolygonFilters(state.aiDataset,state.aiDataset?.suggestions.find(item=>item.id===state.aiDataset.selectedSuggestionId));
  module.renderFilters=()=>{services.ui.populateAiFilters(state.aiDataset);controller.renderGeoRepair(state.aiDataset?.geoMatch?.unmatched||[]);};
  module.renderRepair=controller.renderGeoRepair;
  return module;
}

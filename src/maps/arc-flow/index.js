import { definition } from './definition.js';
import { createArcFlowController } from './controller.js';
import { moduleContext, viewSnapshot } from '../../shared/runtime/module.js';

export function create(parent) {
  const context=moduleContext(parent,{arcFlowView:null,arcFlowStyle:null});const {state,services}=context;
  const controller=createArcFlowController({state,document:context.document,getMap:()=>context.map,maplibregl:context.maplibregl,overlay:context.options.arcFlowOverlay,id:context.options.id,
    onChange:()=>context.options.onChange?.(),onStatus:message=>services.ui.setStatus(message),onInteract:context.options.onArcInteract,
    buildPopupControls:suggestion=>services.popup.buildMapPopupControls(state.aiDataset,suggestion),
    onPopup:info=>services.popup.openMapPopup(info.feature,info.position,'arc-flow',info),
    onClosePopup:()=>{if(context.popups.mapPopupView?.arcInfo)services.popup.closeMapPopup();}});
  return {definition,controller,
    activate(suggestion,dataset=state.aiDataset){state.aiDataset=dataset;return controller.activate(suggestion);},
    update:change=>controller.update(change),setVisible:value=>controller.setActive(value),reset:()=>controller.reset(),clear:()=>controller.clear(),restore:()=>controller.restore(),style(){},
    bindControls(){},renderFilters:()=>controller.refreshControls(),renderControls:()=>controller.refreshControls(),
    allMetricColumns:()=>controller.allMetricColumns(),metricColumns:()=>controller.metricColumns(),changeMetric:field=>controller.changeMetric(field),
    metricField:()=>state.aiDataset?.suggestions.find(item=>item.id===state.aiDataset.selectedSuggestionId)?.bindings.value,
    getView(){const search=controller.searchData();return {...viewSnapshot(context,definition,{data:state.arcFlowView?.data,tableRecords:state.arcFlowView?.tableRecords,
      legendVisible:state.arcFlowStyle?.showLegend,configuration:{style:{...state.arcFlowStyle}},popupLayerId:'arc-flow',camera:{pitch:55,bearing:0}}),search};},
    getPopupContext(feature){return {feature,open:()=>controller.openNode(feature)};},
    presentation:()=>({stylePanel:'arc-flow-style-controls',description:'Chiều cao cung, độ dày, chuyển động và chú giải',filterDescription:'Chọn cách hiển thị và chỉ số dữ liệu'}),
    closePopup:()=>controller.closePopup(),
    dispose(){controller.dispose();context.releaseEvents();for(const id of ['arc-labels','arc-nodes'])if(context.map?.getLayer(id))context.map.removeLayer?.(id);for(const id of ['arc-node-data'])if(context.map?.getSource(id))context.map.removeSource?.(id);}
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './fixtures/map-runtime-harness.js';
import { storeColumns, storeRecords, storeSuggestions } from './fixtures/store-points-fixture.js';
import { mapDefinitions } from '../src/maps/registry.js';
import { mapFactories } from '../src/maps/browser-registry.js';
import { nativeMapDataset } from '../src/shared/data/native-map-data.js';
import { analysis as arcAnalysis, row as arcRow, suggestion as arcSuggestion } from './fixtures/arc-flow-fixture.js';

function pointLayer() {
  const harness = createHarness();
  const runtime = harness.context.runtimeApi;
  const suggestion = structuredClone(storeSuggestions.find(item => item.chartType === 'point'));
  const dataset = { records: structuredClone(storeRecords), rawRecords: structuredClone(storeRecords),
    analysis: { source: 'ai', columns: structuredClone(storeColumns) }, suggestions: [suggestion], selectedSuggestionId: suggestion.id,
    popupSelections: {}, recommendation: null, fileName: 'stores.csv' };
  const module = runtime.context.modules.get('point');
  return { ...harness, runtime, module, suggestion, dataset };
}

test('every registered map implements the same lifecycle without creating inactive layers', () => {
  const { context, layers, sources } = createHarness();
  assert.deepEqual(Object.keys(mapFactories), mapDefinitions.map(definition => definition.id));
  for (const definition of mapDefinitions) {
    const module = context.runtimeApi.context.modules.get(definition.id);
    for (const method of ['activate', 'update', 'setVisible', 'reset', 'restore', 'getView', 'getPopupContext', 'dispose']) {
      assert.equal(typeof module[method], 'function', `${definition.id}.${method}`);
    }
  }
  assert.equal(layers.size, 0); assert.equal(sources.size, 0);
});

test('two point instances preserve independent configuration, data and snapshots', async () => {
  const first = pointLayer(), second = pointLayer();
  assert.equal(await first.module.activate(first.suggestion, first.dataset), true);
  assert.equal(await second.module.activate(second.suggestion, second.dataset), true);
  const original = second.module.getView();
  const firstData = first.module.getView().data;
  first.module.update({ style: { opacity: .3, size: 150, showLegend: false } });
  assert.equal(first.module.getView().configuration.style.opacity, .3);
  assert.equal(first.module.getView().legendVisible, false);
  assert.deepEqual(second.module.getView().configuration, original.configuration);
  assert.equal(first.module.getView().data, firstData, 'appearance changes must not regenerate point data');
  assert.equal(second.module.getView().data, original.data);
  assert.equal(Object.hasOwn(first.runtime.state, 'pointStyle'), false);
  assert.equal(Object.hasOwn(first.runtime.state, 'pointData'), false);
  first.module.reset();
  assert.equal(first.module.getView().configuration.style.opacity, .95);
  assert.equal(second.module.getView().configuration.style.opacity, .95);
  first.runtime.dispose(); second.runtime.dispose();
});

test('restoring a module is idempotent and disposal releases its events and owned map resources', async () => {
  const layer = pointLayer(); const events = [];
  layer.context.testMap.on = (...args) => events.push(args);
  layer.context.testMap.off = (...args) => { const index = events.findIndex(event => event.length === args.length && event.every((value, at) => value === args[at])); if (index >= 0) events.splice(index, 1); };
  await layer.module.activate(layer.suggestion, layer.dataset);
  const subscriptions = events.length;
  assert.equal(subscriptions, 3);
  layer.module.restore(); layer.module.restore();
  assert.equal(events.length, subscriptions);
  assert.deepEqual([...layer.layers.keys()], ['point-marker']);
  layer.module.dispose(); layer.module.dispose();
  assert.equal(events.length, 0);
  assert.equal(layer.layers.size, 0); assert.equal(layer.sources.size, 0);
});

test('point appearance and layer restoration keep source data until an explicit data update', async () => {
  const layer = pointLayer();
  await layer.module.activate(layer.suggestion, layer.dataset);
  const source = layer.sources.get('point-data');
  const setData = source.setData.bind(source);
  let writes = 0;
  source.setData = data => { writes++; setData(data); };
  const original = source.data;
  layer.module.restore();
  layer.module.update({ style: { opacity: .3, size: 150 } });
  layer.runtime.controllers.view.applyStyle();
  layer.layers.delete('point-marker');
  layer.module.restore();
  assert.equal(writes, 0, 'style and missing-layer restoration must not upload GeoJSON');
  assert.equal(source.data, original);
  assert.ok(layer.layers.has('point-marker'));

  const updated = { ...original, features: original.features.slice(0, 1) };
  layer.module.acceptData(updated);
  layer.runtime.controllers.view.applyStyle();
  assert.equal(writes, 1);
  assert.equal(source.data, updated);
  layer.layers.clear(); layer.sources.clear();
  layer.module.restore();
  assert.equal(layer.sources.get('point-data').data, updated, 'basemap restoration uses the latest data');
  layer.runtime.dispose();
});

test('disposing a module unbinds its controls and prevents later activation from recreating layers', async () => {
  const layer=pointLayer(); const control=layer.get('point-style-controls');
  control.removeEventListener=(type, callback)=>{if(control.events[type]===callback)delete control.events[type];};
  layer.module.bindControls(); layer.module.bindControls();
  assert.deepEqual(Object.keys(control.events), ['input','change']);
  layer.module.dispose();
  assert.deepEqual(Object.keys(control.events), []);
  assert.equal(layer.module.activate(layer.suggestion,layer.dataset),null);
  assert.equal(layer.layers.size,0);
});

for(const chartType of ['map_line','choropleth','arc_flow'])test(`two ${chartType} instances isolate style and restore their own geometry`,async()=>{
  const build=async()=>{
    const h=createHarness({arcFlowOverlay:{async updateLayer(){return true;},removeLayer(){}}});
    const runtime=h.context.runtimeApi;const module=runtime.context.modules.get(chartType);
    let dataset;
    if(chartType==='arc_flow'){
      const suggestion=structuredClone(arcSuggestion);
      dataset={records:[arcRow()],rawRecords:[arcRow()],analysis:structuredClone(arcAnalysis),suggestions:[suggestion],selectedSuggestionId:suggestion.id,popupSelections:{}};
    }else{
      const geometry=chartType==='map_line'?{type:'LineString',coordinates:[[105,21],[106,22]]}:{type:'Polygon',coordinates:[[[105,21],[106,21],[106,22],[105,21]]]};
      const data={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'A'},geometry}]};
      const suggestion={id:'native',chartType,title:'Native geometry',bindings:{region:'name',value:null},available:true,confidence:.9};
      const pipeline={records:[{name:'A'}],analysis:{source:'ai',columns:[{name:'name',role:'geo',geoLevel:'admin1'}],suggestions:[suggestion],search_fields:['name']}};
      dataset=nativeMapDataset(data,pipeline,'native.geojson');
    }
    const suggestion=dataset.suggestions[0];
    assert.equal(await module.activate(suggestion,dataset),true);
    return{...h,runtime,module};
  };
  const first=await build(),second=await build();
  const before=second.module.getView();
  let writes = 0;
  for (const source of first.sources.values()) {
    const setData = source.setData.bind(source);
    source.setData = data => { writes++; setData(data); };
  }
  first.module.update({style:{opacity:.3}});
  if (chartType === 'choropleth') {
    first.runtime.controllers.view.applyStyle();
    first.layers.delete('polygon-fill'); first.module.restore();
    assert.equal(writes, 0, 'polygon style and missing-layer restoration must not upload GeoJSON');
    const original = first.module.getView().data;
    const updated = { ...original, features: original.features.map(feature => ({ ...feature, geometry: {
      type: 'Polygon', coordinates: [[[107, 23], [108, 23], [108, 24], [107, 23]]]
    } })) };
    first.module.acceptData(updated); first.runtime.controllers.view.applyStyle();
    assert.equal(writes, 2, 'explicit updates publish the fill and boundary sources once each');
    assert.equal(first.sources.get('polygon-data').data.features[0].geometry, updated.features[0].geometry);
    assert.deepEqual(first.module.getView().extent, [107, 23, 108, 24]);
  }
  assert.equal(first.module.getView().configuration.style.opacity,.3);
  assert.deepEqual(second.module.getView().configuration,before.configuration);
  assert.notEqual(first.module.getView().data,before.data);
  first.layers.clear();first.sources.clear();first.module.restore();first.module.style();first.module.setVisible(true);
  if (chartType === 'choropleth') assert.deepEqual(first.sources.get('polygon-data').data.features, first.module.getView().data.features);
  assert.equal(first.module.getView().configuration.style.opacity,.3);
  assert.ok(first.layers.size>0);assert.ok(first.sources.size>0);
  first.runtime.dispose();second.runtime.dispose();
});

test('late selection completion cannot recreate modules after runtime disposal',async()=>{
  const layer=pointLayer();layer.runtime.state.aiDataset=layer.dataset;
  layer.suggestion.available=true;
  let finish;
  layer.module.activate=()=>new Promise(resolve=>{finish=resolve;});
  const selection=layer.runtime.controllers.runtime.selectAiSuggestion(layer.suggestion.id);
  layer.runtime.dispose();finish(true);
  assert.equal(await selection,null);
  assert.equal(layer.runtime.context.modules.instances.size,0);
  assert.equal(layer.layers.size,0);
});

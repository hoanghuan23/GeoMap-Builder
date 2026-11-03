import { createMapLayerRuntime } from '../../src/shared/runtime/index.js';
import { createLayerDocument } from '../../src/map-layer-document.js';
import { createMapLayerManager } from '../../src/map-layer-manager.js';
import { analysis as arcAnalysis, row as arcRow, suggestion as arcSuggestion } from './arc-flow-fixture.js';

// Exercise actual module controls and DOM namespaces without network AI or GPU dependencies.
const result = document.getElementById('module-result');
const stage = value => { result.dataset.stage=value; };
const assert = (value, message) => { if (!value) throw new Error(message); };
const webgl = new URLSearchParams(location.search).has('webgl');
class Bounds { extend() { return this; } }
class Popup {
  constructor() { this.element = document.createElement('div'); this.callbacks = []; }
  on(name, fn) { if (name === 'close') this.callbacks.push(fn); return this; }
  setLngLat() { return this; }
  setDOMContent(node) { this.element.replaceChildren(node); return this; }
  addTo() { document.querySelector('.map-panel').append(this.element); return this; }
  getElement() { return this.element; }
  remove() { this.element.remove(); this.callbacks.forEach(fn => fn()); }
}
class Canvas {
  sources = new Map(); layers = new Map(); listeners = [];
  getSource(id) { return this.sources.get(id); }
  addSource(id, spec) { assert(!this.sources.has(id), `duplicate source ${id}`); this.sources.set(id, { ...spec, setData(data) { this.data = data; } }); }
  removeSource(id) { this.sources.delete(id); }
  getLayer(id) { return this.layers.get(id); }
  addLayer(layer) { assert(!this.layers.has(layer.id), `duplicate layer ${layer.id}`); this.layers.set(layer.id, { ...layer, layout: { ...layer.layout }, paint: { ...layer.paint } }); }
  removeLayer(id) { this.layers.delete(id); }
  getStyle() { return { layers: [...this.layers.values()], sources: Object.fromEntries(this.sources) }; }
  on(...args) { this.listeners.push(args); }
  off(type, handler) { this.listeners = this.listeners.filter(args => args[0] !== type || args[1] !== handler); }
  setPaintProperty(id, key, value) { this.layers.get(id).paint[key] = value; }
  getPaintProperty(id, key) { return this.layers.get(id).paint[key]; }
  setLayoutProperty(id, key, value) { this.layers.get(id).layout[key] = value; }
  moveLayer() {}
  getContainer() { return document.querySelector('.map-panel'); }
  getCanvas() { return document.querySelector('#map'); }
  resize() {}
  fitBounds() {}
  flyTo() {}
  project() { return { x: 300, y: 200 }; }
  unproject(point) { return point; }
  queryRenderedFeatures() { return []; }
}

try {
  stage('markup');
  const markup = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
  markup.querySelectorAll('script').forEach(node => node.remove());
  document.body.append(...markup.body.children);
  document.querySelector('.map-panel').style.cssText = 'width:800px;height:600px;position:relative';
  const templates = [document.querySelector('.sidebar'), document.getElementById('map-metric-control'), document.querySelector('.map-legends'), document.getElementById('data-panel')];
  let canvas = new Canvas(), library = { Popup, LngLatBounds: Bounds }, overlay;
  const graphicsErrors = [];
  if (webgl) {
    stage('import-maplibre');
    const [{ default: maplibregl }, { createArcFlowOverlayManager }] = await Promise.all([
      import('maplibre-gl'), import('../../src/shared/view/arc-overlay.js')
    ]);
    library = maplibregl;
    stage('create-map');
    document.getElementById('map').style.cssText = 'width:800px;height:600px';
    canvas = new maplibregl.Map({ container: document.getElementById('map'), center: [106, 16], zoom: 4,
      style: { version: 8, glyphs: `${location.origin}/tests/glyphs/{fontstack}/{range}.pbf`, sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#14213b' } }] },
      attributionControl: false });
    canvas.on('error', event => graphicsErrors.push(event.error.message));
    stage('map-load');
    await new Promise((resolve,reject) => {
      if(canvas.loaded()){resolve();return;}
      const timer=setTimeout(()=>reject(new Error(`MapLibre load timeout: ${graphicsErrors.join('; ')}; loaded=${canvas.loaded()}; style=${canvas.isStyleLoaded()}`)),10000);
      canvas.once('load',()=>{clearTimeout(timer);resolve();});
    });
    assert(canvas.getCanvas().getContext('webgl2'), 'WebGL2 unavailable');
    overlay = createArcFlowOverlayManager(canvas, { onError: error => graphicsErrors.push(error.message) });
  }
  const published = new Map(); const entries = [];
  const build = id => {
    const dom = createLayerDocument(document, id, templates);
    dom.roots.forEach(node => document.body.append(node));
    const manager = createMapLayerManager(canvas, id); manager.attach(); manager.setInteractive(true);
    const api = createMapLayerRuntime({ id, document: dom.document, map: manager.map, maplibregl: manager.popupLibrary(library),
      arcFlowOverlay: { async updateLayer(key, payload) { published.set(key, payload); if(!overlay)return true;
        const ok=await overlay.updateLayer(key,payload);overlay.setLayerState(key,{attached:true,visible:true});return ok;
      }, removeLayer(key) { published.delete(key); overlay?.removeLayer(key); } },
      dependencies: { fetch() { throw new Error('Unexpected network request'); } }, renderTable: () => true,
      assets: { roadNetworkUrl: () => null } });
    api.initialize(); entries.push({ api, manager, dom }); return entries.at(-1);
  };
  const pipeline = (records, columns, suggestion) => ({ records, rawRecords: records,
    validRowRate: Object.fromEntries(columns.map(column => [column.name, 1])), analysis: { source: 'ai', datasetTitle: 'Browser fixture', columns,
      search_bar: true, search_fields: [suggestion.bindings.region || suggestion.bindings.source], suggestions: [{ ...suggestion, confidence: .9, popupSuggestions: [{ name: 'info', confidence: 1 }] }] } });
  const pointRows = [{ name: 'A', lat: 21, lng: 105, value: 10 }, { name: 'B', lat: 22, lng: 106, value: 20 }];
  const pointColumns = [{ name: 'name', role: 'category' }, { name: 'lat', role: 'geo', geoLevel: 'point_lat' }, { name: 'lng', role: 'geo', geoLevel: 'point_lng' }, { name: 'value', role: 'measure', aggDefault: 'sum' }];
  const pointSuggestion = { id: 'points', chartType: 'point', title: 'Points', bindings: { region: 'name', lat: 'lat', lng: 'lng' } };
  const first = build('point-one');
  stage('point');
  assert(Object.keys(canvas.getStyle().sources).length === 0, 'runtime created layers before choosing a map');
  await first.api.load({ kind: 'ai-pipeline', pipeline: pipeline(pointRows, pointColumns, pointSuggestion) }, { name: 'points.csv' });
  assert(first.api.getView().data.features.length === 2, 'point data missing');
  const opacity = first.dom.document.getElementById('point-opacity'); opacity.value = '.4'; opacity.dispatchEvent(new Event('input', { bubbles: true }));
  assert(canvas.getPaintProperty('point-one--point-marker', 'circle-opacity') === .4, 'point controls not bound');
  const second = build('point-two');
  await second.api.load({ kind: 'ai-pipeline', pipeline: pipeline(pointRows, pointColumns, pointSuggestion) }, { name: 'other.csv' });
  assert(second.api.getView().configuration.style.opacity === .95, 'point instances share style');
  assert(first.api.getView().configuration.style.opacity === .4, 'creating another point instance reset the first');
  const line = build('line-one');
  stage('line');
  const lineRows = [0, 1, 2].map(order => ({ route: 'Route', order, lat: 21 + order * .1, lng: 105 + order * .1 }));
  const lineColumns = [{ name: 'route', role: 'category' }, { name: 'order', role: 'id' }, ...pointColumns.filter(column => ['lat', 'lng'].includes(column.name))];
  await line.api.load({ kind: 'ai-pipeline', pipeline: pipeline(lineRows, lineColumns, { id: 'route', title: 'Route', chartType: 'map_line', bindings: { region: 'route', lat: 'lat', lng: 'lng', x: 'order' } }) }, { name: 'line.csv' });
  assert(line.api.getView().data.features.length === 1, 'coordinate line missing');
  const width = line.dom.document.getElementById('road-line-width'); width.value = '5'; width.dispatchEvent(new Event('input', { bubbles: true }));
  assert(canvas.getPaintProperty('line-one--data-lines', 'line-width') === 5, 'line controls not bound');
  const polygon = build('polygon-one');
  stage('polygon');
  const polygons = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Area' }, geometry: { type: 'Polygon', coordinates: [[[105, 21], [105.2, 21], [105.2, 21.2], [105, 21.2], [105, 21]]] } }] };
  const polyPipeline = pipeline([{ name: 'Area' }], [{ name: 'name', role: 'geo', geoLevel: 'admin1' }], { id: 'area', title: 'Area', chartType: 'choropleth', bindings: { region: 'name', value: null } });
  await polygon.api.load({ data: polygons, nativePipeline: polyPipeline }, { name: 'area.geojson' });
  assert(polygon.api.getView().data.features.length === 1, 'native polygon missing');
  const grid = polygon.dom.document.getElementById('show-region-hex'); grid.checked = true; grid.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(polygon.api.getView().data.features.some(feature => feature.properties.h3), 'polygon grid not generated');
  assert(!polygon.dom.document.getElementById('region-hex-resolution-control').hidden, 'polygon grid controls not mounted');
  const arc = build('arc-one');
  stage('arc-flow');
  const arcRows = [arcRow({ passengers: 10 }), arcRow({ destination: 'C', destination_lng: 107, passengers: 20 })];
  const arcPipeline = pipeline(arcRows, arcAnalysis.columns, arcSuggestion);
  await arc.api.load({ kind: 'ai-pipeline', pipeline: arcPipeline }, { name: 'od.csv' });
  assert(arc.api.getView().tableRecords.length === 2 && published.has('arc-one'), 'arc view or overlay missing');
  assert(arc.dom.document.getElementById('arc-flow-style-controls').querySelector('input'), 'arc controls not generated');
  assert(canvas.getLayer('point-one--point-marker') && canvas.getLayer('line-one--data-lines') && canvas.getLayer('polygon-one--polygon-fill'), 'mixed layers lost their resources');
  if (webgl) {
    stage('render-webgl');
    arc.api.context.modules.active().update({ style: { animated: false, showLabels: false } });
    canvas.jumpTo({ center: [106, 16], zoom: 4, pitch: 35 });
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert(canvas.getLayer('workspace-arc-flow-anchor'), 'deck.gl did not attach its render group');
    assert(canvas.queryRenderedFeatures({ layers: ['point-one--point-marker'] }).length > 0, 'real MapLibre did not render point features');
    assert(canvas.queryRenderedFeatures({ layers: ['line-one--data-lines'] }).length > 0, 'real MapLibre did not render line features');
    assert(canvas.queryRenderedFeatures({ layers: ['polygon-one--h3-fill'] }).length > 0, 'real MapLibre did not render polygon grid features');
    // Detach and reattach a dataset, then rebuild the native style just as the workspace does.
    first.manager.detach(); first.manager.attach();
    overlay.setStyleReady(false);
    stage('style-load');
    await new Promise(resolve => {
      canvas.once('style.load', resolve);
      canvas.setStyle({ version: 8, glyphs: `${location.origin}/tests/glyphs/{fontstack}/{range}.pbf`, sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#20304a' } }] },{diff:false});
    });
    for (const entry of entries) { entry.manager.attach(); entry.api.update(); }
    overlay.setStyleReady(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(canvas.getLayer('point-one--point-marker') && canvas.getLayer('arc-one--arc-nodes'), 'style reload lost module resources');
    assert(first.api.getView().configuration.style.opacity === .4, 'style reload reset module configuration');
    assert(graphicsErrors.length === 0, graphicsErrors.join('; '));
    if(new URLSearchParams(location.search).has('screenshots')){
      window.reviewMapModule=async id=>{
        for(const entry of entries){entry.manager.setVisible(entry.api.context.options.id===id);}
        overlay.setLayerState('arc-one',{attached:true,visible:id==='arc-one'});
        const cameras={
          'point-one':{center:[105.5,21.5],zoom:7,pitch:0},'line-one':{center:[105.1,21.1],zoom:9,pitch:0},
          'polygon-one':{center:[105.1,21.1],zoom:10,pitch:0},'arc-one':{center:[106.85,10.75],zoom:9,pitch:55}
        };
        canvas.jumpTo(cameras[id]);canvas.getContainer().scrollIntoView({block:'center'});
        await new Promise(resolve=>setTimeout(resolve,800));
      };
      stage('review-ready');await new Promise(resolve=>{window.finishMapReview=resolve;});
    }
  }
  const ids = Array.from(document.querySelectorAll('[id]'), element => element.id);
  stage('popup-and-dispose');
  assert(new Set(ids).size === ids.length, 'module controls have duplicate IDs');
  first.api.openPopup(first.api.getView().data.features[0], [105, 21]);
  assert(document.querySelector('.ai-map-popup, .popup-source-records, .weather-popup'), 'shared popup did not render');
  first.api.closePopup();
  for (const { api, manager, dom } of entries) { api.dispose(); manager.dispose(); dom.dispose(); }
  overlay?.dispose();
  assert(Object.keys(canvas.getStyle().sources).length === 0 && !canvas.getStyle().layers.some(layer => layer.metadata?.workspaceLayer) && (!canvas.listeners || canvas.listeners.length === 0) && published.size === 0, 'runtime disposal leaked resources');
  if(webgl)canvas.remove();
  result.textContent = JSON.stringify({ ok: true, modules: ['Point', 'Line', 'Polygon', 'Arc Flow'], instances: entries.length, controls: true, grid: true, popup: true, disposed: true, ...(webgl ? { webgl: true, basemapRestore: true } : {}) });
} catch (error) { result.textContent = JSON.stringify({ ok: false, error: error.message, stack: error.stack }); }

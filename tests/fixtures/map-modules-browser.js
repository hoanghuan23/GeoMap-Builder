import { createMapLayerRuntime } from '../../src/shared/runtime/index.js';
import { createLayerDocument } from '../../src/map-layer-document.js';
import { createMapLayerManager } from '../../src/map-layer-manager.js';
import { analysis as arcAnalysis, row as arcRow, suggestion as arcSuggestion } from './arc-flow-fixture.js';
import { createAiMapEditor } from '../../src/ai-map-editor.js';
import { initializeAiSupport } from '../../src/ai-support.js';
import { weatherEditColumns, weatherEditRows, weatherEditSuggestion } from './map-edit-weather.js';

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
  getLayoutProperty(id, key) { return this.layers.get(id).layout[key]; }
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
  const templates = [document.querySelector('.sidebar'), document.getElementById('map-metric-control'), document.querySelector('.map-legends')];
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
    const api = createMapLayerRuntime({ id, managedWorkspace: true, document: dom.document, map: manager.map, maplibregl: manager.popupLibrary(library),
      arcFlowOverlay: { async updateLayer(key, payload) { published.set(key, payload); if(!overlay)return true;
        const ok=await overlay.updateLayer(key,payload);overlay.setLayerState(key,{attached:true,visible:true});return ok;
      }, removeLayer(key) { published.delete(key); overlay?.removeLayer(key); } },
      dependencies: { fetch() { throw new Error('Unexpected network request'); } },
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
  stage('ai-map-edit');
  const workspace = { revision: 0, activeGroupId: 'chat-map', groupsById: { 'chat-map': { id: 'chat-map', title: 'Chat map', visible: true,
    layerIds: entries.map(entry => entry.api.context.options.id), activeLayerId: 'point-one' } },
    layersById: Object.fromEntries(entries.map(entry => [entry.api.context.options.id, { title: entry.api.context.options.id }])) };
  const runtimes = new Map(entries.map(entry => [entry.api.context.options.id, entry]));
  let aiOperations = []; const chatRequests = [];
  const editor = createAiMapEditor({ workspace, runtimes, isLoading: () => false, closePopups: () => entries.forEach(entry => entry.api.closePopup()),
    sync: () => { for (const [id, entry] of runtimes) entry.manager.setVisible(workspace.layersById[id].visible !== false); },
    fetchImpl: async (_url, init) => { chatRequests.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ message: 'Đã chỉnh theo yêu cầu.', operations: aiOperations }) }; } });
  const edit = (layerId, kind, value, key = '') => ({ layerId, kind, key, value: JSON.stringify(value) });
  aiOperations = [edit('polygon-one', 'style', '#ff5500', 'color'), edit('point-one', 'style', .6, 'opacity'), edit('point-one', 'popupFields', ['value']),
    edit('polygon-one', 'hexEnabled', false), edit('line-one', 'style', 7, 'width')];
  await editor.chat('Đổi màu, độ mờ và thuộc tính', []);
  assert(canvas.getPaintProperty('polygon-one--polygon-fill', 'fill-color') === '#ff5500', 'AI polygon color did not reach paint');
  assert(canvas.getPaintProperty('point-one--point-marker', 'circle-opacity') === .6, 'AI point opacity did not reach paint');
  assert(canvas.getPaintProperty('line-one--data-lines', 'line-width') === 7, 'AI line style did not reach paint');
  assert(!polygon.api.getView().configuration.regionHexEnabled, 'AI failed to disable hex grid');
  const content = first.api.controllers.popup.aiWeatherPopupContent(first.api.getView().data.features[0]);
  assert(content.querySelectorAll('dt').length === 1 && content.querySelector('dd').textContent === '10', 'AI popup fields were not applied');
  aiOperations = [edit('point-one', 'popupMode', 'bar'), edit('point-two', 'visible', false)];
  await editor.chat('Thêm biểu đồ cột, ẩn lớp thứ hai', []);
  assert(first.api.controllers.popup.popupSelectionFor().mode === 'bar', 'AI chart popup not selected');
  assert(canvas.getLayoutProperty('point-two--point-marker', 'visibility') === 'none', 'AI layer visibility not applied');
  const metricPolygons = { ...polygons, features: polygons.features.map(feature => ({ ...feature, properties: { ...feature.properties, value: 10 } })) };
  const metricPipeline = pipeline([{ name: 'Area', value: 10 }], [...polyPipeline.analysis.columns, { name: 'value', role: 'measure', aggDefault: 'mean' }],
    { id: 'area-metric', title: 'Area value', chartType: 'choropleth', bindings: { region: 'name', value: 'value' }, agg: 'mean' });
  await polygon.api.load({ data: metricPolygons, nativePipeline: metricPipeline }, { name: 'area-value.geojson' });
  aiOperations = [edit('polygon-one', 'legend', { aggregation: 'mean', type: 'continuous', mode: 'semantic', title: 'Giá trị mới', unit: null,
    domain: [0, 20], center: null, stops: [{ value: 0, color: '#ffff00' }, { value: 20, color: '#ff0000' }], reason: 'Theo yêu cầu.' })];
  await editor.chat('Đổi thang chú giải từ vàng sang đỏ', []);
  assert(JSON.stringify(canvas.getPaintProperty('polygon-one--polygon-fill', 'fill-color')).includes('#ff0000'), 'AI legend colors did not reach map paint');
  assert(polygon.dom.document.getElementById('weather-legend-title').textContent === 'Giá trị mới', 'AI legend title did not reach legend');
  // Removing a feature must remove its entry points, not just select another metric.
  const weatherGeometry = { ...polygons, features: weatherEditRows.map(row => ({ ...polygons.features[0], properties: { ...row } })) };
  await polygon.api.load({ data: weatherGeometry, nativePipeline: pipeline(weatherEditRows, weatherEditColumns, weatherEditSuggestion) }, { name: 'weather-pollution.geojson' });
  const metricList = polygon.dom.document.getElementById('map-metric-list');
  const metricSelect = () => polygon.dom.document.querySelector('.ai-metric-selector');
  assert(metricList.children.length === 7, 'Weather regression did not start with seven metrics');
  const sourceRecords = JSON.stringify(polygon.api.state.aiDataset.records);
  const sourceColumns = JSON.stringify(polygon.api.state.aiDataset.analysis.columns);
  const savedFilters = { ...polygon.api.state.aiDataset.filters };
  aiOperations = [edit('polygon-one', 'popupMode', 'bar')];
  await editor.chat('Xem các chỉ số trong biểu đồ popup', []);
  const popupSelection = polygon.api.controllers.popup.popupSelectionFor();
  popupSelection.bar.metrics = ['temperature', 'pollution']; popupSelection.bar.variant = 'grouped';
  popupSelection.line = { measure: 'temperature', from: null, to: null };
  aiOperations = [edit('polygon-one', 'metricFields', ['pollution'])];
  await editor.chat('Xóa chức năng thời tiết, giữ mức độ ô nhiễm và các tính năng khác', []);
  assert(metricList.children.length === 1 && metricList.firstElementChild.dataset.metricField === 'pollution', 'Removed weather buttons remain clickable');
  assert(!polygon.dom.document.getElementById('map-metric-control').hidden, 'Explicitly retained pollution button was hidden');
  assert(polygon.dom.document.getElementById('map-metric-count').textContent === '1', 'Metric count was not updated');
  assert([...metricSelect().options].map(option => option.value).join() === 'pollution', 'Removed weather metrics remain in the sidebar');
  assert(polygon.api.context.modules.active().metricField() === 'pollution', 'Removing the active metric did not select the retained metric');
  await polygon.api.controllers.ui.changeAiMapMetric('temperature');
  assert(polygon.api.context.modules.active().metricField() === 'pollution', 'Stale weather button can still change the map');
  assert(polygon.api.context.modules.active().changeMetric('weather') === false, 'Hidden categorical metric can still be selected');
  const retainedFilters = Object.fromEntries(Object.entries(savedFilters).filter(([field]) => !polygon.api.state.aiDataset.hiddenMetricFields.includes(field)));
  assert(JSON.stringify(polygon.api.state.aiDataset.filters) === JSON.stringify(retainedFilters), 'Removing weather changed date or geographic filters');
  const info = polygon.api.controllers.popup.aiWeatherPopupContent(polygon.api.getView().data.features[0]);
  assert(!/Nhiệt độ|Độ ẩm|Lượng mưa|Tình trạng thời tiết/.test(info.textContent) && info.textContent.includes('Mức độ ô nhiễm'), 'Removed weather information remains in popup');
  assert(popupSelection.bar.metrics.join() === 'pollution' && popupSelection.bar.variant === 'single' && popupSelection.line.measure === 'pollution', 'Popup chart still uses removed weather measures');
  const popupMetric = polygon.dom.document.querySelector('.ai-popup-metric');
  assert([...popupMetric.options].every(option => ['pollution', 'count'].includes(option.value)), 'Removed weather measures remain in chart settings');
  polygon.api.update(); polygon.api.controllers.popup.refreshMapPopupControls();
  assert(metricList.children.length === 1 && [...metricSelect().options].every(option => option.value === 'pollution'), 'Weather metrics returned after rerendering controls');
  const current = editor.getContext().layers.find(layer => layer.id === 'polygon-one');
  assert(current.metrics.join() === 'pollution' && current.availableMetrics.length === 7, 'AI cannot distinguish retained metrics from restorable source fields');
  assert(JSON.stringify(polygon.api.state.aiDataset.records) === sourceRecords && JSON.stringify(polygon.api.state.aiDataset.analysis.columns) === sourceColumns, 'Removing presentation fields mutated source data');
  aiOperations = [edit('polygon-one', 'metricFields', current.availableMetrics), edit('polygon-one', 'metric', 'temperature')];
  await editor.chat('Thêm lại các chỉ số thời tiết', []);
  assert(metricList.children.length === 7 && polygon.api.context.modules.active().metricField() === 'temperature', 'Removed metrics cannot be restored');
  const weatherModule = polygon.api.context.modules.active(); const updateWeather = weatherModule.update;
  weatherModule.update = change => {
    if (polygon.api.state.aiDataset.hiddenMetricFields.length) throw new Error('Simulated metric render failure');
    return updateWeather(change);
  };
  aiOperations = [edit('polygon-one', 'metricFields', ['pollution'])];
  let failed = false;
  try { await editor.chat('Bỏ chỉ số trong lượt render lỗi', []); } catch (error) { failed = error.message === 'Simulated metric render failure'; }
  finally { weatherModule.update = updateWeather; }
  assert(failed && metricList.children.length === 7 && weatherModule.metricField() === 'temperature', 'Failed removal did not restore metric buttons and active metric');
  await polygon.api.load({ data: polygons, nativePipeline: polyPipeline }, { name: 'area.geojson' });
  initializeAiSupport(document, { getEditor: async () => editor });
  document.getElementById('ai-support-nav').click();
  const input = document.getElementById('ai-support-input');
  input.value = 'Nhạt hơn nữa'; input.dispatchEvent(new Event('input'));
  aiOperations = [edit('point-one', 'style', .4, 'opacity')];
  document.getElementById('ai-support-form').requestSubmit();
  for (let count = 0; input.disabled && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 10));
  assert(!input.disabled && !input.value, 'chat composer did not finish');
  assert(document.querySelector('.ai-support-message-user').textContent === 'Nhạt hơn nữa', 'user message missing');
  assert(document.querySelector('.ai-support-message-assistant').textContent === 'Đã chỉnh theo yêu cầu.', 'AI result missing');
  assert(chatRequests.at(-1).context.layers.find(layer => layer.id === 'point-one').style.opacity === .6, 'follow-up used stale state');
  input.value = 'Giữ như vậy'; input.dispatchEvent(new Event('input')); aiOperations = [];
  document.getElementById('ai-support-form').requestSubmit();
  for (let count = 0; input.disabled && count < 100; count++) await new Promise(resolve => setTimeout(resolve, 10));
  assert(chatRequests.at(-1).history.length === 2, 'conversation history not sent');
  document.getElementById('map-builder-nav').click();
  aiOperations = [edit('polygon-one', 'hexEnabled', true), edit('point-two', 'visible', true), edit('point-one', 'popupMode', 'info')];
  await editor.chat('Khôi phục các lớp', []);
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
  result.textContent = JSON.stringify({ ok: true, modules: ['Point', 'Line', 'Polygon', 'Arc Flow'], instances: entries.length, controls: true, grid: true, popup: true, aiChat: true, disposed: true, ...(webgl ? { webgl: true, basemapRestore: true } : {}) });
} catch (error) { result.textContent = JSON.stringify({ ok: false, error: error.message, stack: error.stack }); }

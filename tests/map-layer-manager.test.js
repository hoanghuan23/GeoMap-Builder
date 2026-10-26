import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapLayerManager, orderWorkspaceMapLayers } from '../src/map-layer-manager.js';
import { filterCountryRegionData } from '../src/country-regions.js';

function fakeMap() {
  const sources = new Map(); const layers = new Map(); const listeners = new Map();
  return { sources, layers, listeners, top: [],
    addSource(id, spec) { sources.set(id, { ...spec, setData(data) { this.data = data; } }); }, getSource: id => sources.get(id), removeSource: id => sources.delete(id),
    addLayer(spec) { layers.set(spec.id, structuredClone(spec)); }, getLayer: id => layers.get(id), removeLayer: id => layers.delete(id),
    setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; }, setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
    getStyle: () => ({ layers: [...layers.values()] }), moveLayer(id) { const value = layers.get(id); layers.delete(id); layers.set(id, value); },
    queryRenderedFeatures() { return this.top; },
    on(type, callback) { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); },
    off(type, callback) { listeners.set(type, listeners.get(type).filter(item => item !== callback)); },
    fitBounds() {}, flyTo() {}
  };
}

test('same-type layers isolate source data, paint, visibility and lifecycle across group/basemap switches', () => {
  const native = fakeMap(); const a = createMapLayerManager(native, 'a'); const b = createMapLayerManager(native, 'b');
  for (const item of [a, b]) {
    item.map.addSource('point-data', { type: 'geojson', data: { value: item.id } });
    item.map.addLayer({ id: 'point-marker', source: 'point-data', type: 'circle', paint: { 'circle-color': '#ff0000' } });
    item.attach();
  }
  a.map.getSource('point-data').setData({ value: 'changed' });
  a.map.setPaintProperty('point-marker', 'circle-color', '#000000');
  assert.equal(native.sources.get('b--point-data').data.value, 'b');
  assert.equal(native.layers.get('b--point-marker').paint['circle-color'], '#ff0000');
  a.setVisible(false); assert.equal(native.layers.get('a--point-marker').layout.visibility, 'none');
  assert.equal(native.layers.get('b--point-marker').layout.visibility, 'visible');
  a.detach(); assert.equal(native.sources.has('a--point-data'), false);
  a.map.getSource('point-data').setData({ value: 'detached-update' });
  a.attach(); assert.equal(native.sources.get('a--point-data').data.value, 'detached-update');
  native.sources.clear(); native.layers.clear(); a.attach(); b.attach();
  assert.equal(native.layers.size, 2);
  a.dispose(); assert.equal(native.layers.size, 1); assert.equal(native.sources.size, 1);
});

test('country filtering survives source rebuilds, inactive groups and basemap changes, and world restores the latest data', () => {
  const native = fakeMap(); const manager = createMapLayerManager(native, 'countries');
  const config = { columns: [{name: 'country', role: 'geo', geoLevel: 'country'}] };
  const data = names => ({type:'FeatureCollection', features: names.map(country => ({type:'Feature', properties:{country}, geometry:{type:'Polygon',coordinates:[]}}))});
  const original = data(['Việt Nam', 'Germany', 'Japan', 'Lào']);
  manager.map.addSource('polygon-data', {type:'geojson', data:original});
  manager.map.addLayer({id:'polygon-fill',type:'fill',source:'polygon-data'});
  manager.setDataFilter(data => filterCountryRegionData(data, config, 'subregion:South-eastern Asia'));
  manager.attach();
  const rendered = () => native.sources.get('countries--polygon-data').data.features.map(feature => feature.properties.country);
  assert.deepEqual(rendered(), ['Việt Nam', 'Lào']);
  assert.equal(manager.sources.get('polygon-data').data, original);
  const updated = data(['Vietnam', 'Germany', 'Thailand']);
  manager.map.getSource('polygon-data').setData(updated);
  assert.deepEqual(rendered(), ['Vietnam', 'Thailand']);
  manager.detach(); manager.attach();
  assert.deepEqual(rendered(), ['Vietnam', 'Thailand']);
  native.sources.clear(); native.layers.clear(); manager.attach();
  assert.deepEqual(rendered(), ['Vietnam', 'Thailand']);
  manager.setDataFilter(null);
  assert.equal(native.sources.get('countries--polygon-data').data, updated);
  assert.deepEqual(rendered(), ['Vietnam', 'Germany', 'Thailand']);
});

test('overlapping features dispatch clicks only to the top owner; dispose removes handlers', () => {
  const native = fakeMap(); const a = createMapLayerManager(native, 'a'); const b = createMapLayerManager(native, 'b');
  let aClicks = 0; let bClicks = 0;
  for (const item of [a, b]) {
    item.map.addSource('data', { type: 'geojson', data: {} });
    item.map.addLayer({ id: 'marker', type: 'circle', source: 'data', paint: {} }); item.attach();
  }
  a.map.on('click', 'marker', () => { aClicks++; });
  b.map.on('click', 'marker', event => { bClicks++; assert.equal(event.features[0].layer.id, 'marker'); });
  native.top = [{ layer: native.layers.get('b--marker'), geometry: { type: 'Point', coordinates: [105, 21] } }, { layer: native.layers.get('a--marker') }];
  native.listeners.get('click').forEach(callback => callback({ point: [0, 0] }));
  assert.equal(aClicks, 0); assert.equal(bClicks, 1);
  a.dispose(); b.dispose(); assert.equal(native.listeners.get('click').length, 0);
});

test('shared geometry order places fill/outline below routes and points regardless of insertion', () => {
  const native = fakeMap(); const manager = createMapLayerManager(native, 'layer');
  manager.map.addSource('data', { type: 'geojson', data: {} });
  for (const [id, type] of [['marker', 'circle'], ['route', 'line'], ['fill', 'fill'], ['polygon-border', 'line']]) manager.map.addLayer({ id, type, source: 'data', paint: {} });
  manager.attach(); orderWorkspaceMapLayers(native);
  assert.deepEqual([...native.layers.keys()], ['layer--fill', 'layer--polygon-border', 'layer--route', 'layer--marker']);
});

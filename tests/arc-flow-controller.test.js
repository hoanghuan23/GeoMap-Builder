import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcFlowController } from '../src/arc-flow-controller.js';
import { tableRecords } from '../src/map-layer-data.js';
import { analysis, row, suggestion } from './fixtures/arc-flow-fixture.js';

function harness({ overlayAvailable = true, records = Array.from({ length: 120 }, (_, i) => row({ destination: `B${i}`, passengers: i })) } = {}) {
  const elements = new Map(); const sources = new Map(); const layers = new Map(); const published = []; const popups = []; const removed = [];
  const node = tag => ({ tag, children: [], events: {}, style: {}, value: '', checked: true, hidden: false, textContent: '',
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this[name] = value; }, addEventListener(name, callback) { this.events[name] = callback; } });
  const get = id => { if (!elements.has(id)) elements.set(id, node('div')); return elements.get(id); };
  const doc = { getElementById: get, createElement: node };
  const map = { getSource: id => sources.get(id), getLayer: id => layers.get(id), on() {},
    addSource(id, spec) { sources.set(id, { data: spec.data, setData(data) { this.data = data; } }); },
    addLayer(layer) { layers.set(layer.id, { ...layer, layout: { ...layer.layout } }); },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; } };
  const state = { aiDataset: { records, rawRecords: records, analysis, selectedSuggestionId: suggestion.id }, mapType: null };
  const controller = createArcFlowController({ state, document: doc, getMap: () => map,
    maplibregl: { Popup: class {
      constructor() { popups.push(this); }
      setLngLat(position) { this.position = position; return this; } setDOMContent(content) { this.content = content; return this; }
      addTo() { return this; } remove() { this.removed = true; }
    } }, overlay: { async updateLayer(_id, payload) { published.push(payload); return overlayAvailable; }, removeLayer(id) { removed.push(id); } },
    id: 'a' });
  const control = caption => get('ai-filter-controls').children.find(item => item.tag === 'label' && item.children[0]?.textContent === caption)?.children[1];
  return { controller, state, get, control, sources, layers, popups, published, removed };
}

test('layer controls, Top N, attribute filters and CSV/table state share the same view', async () => {
  const h = harness(); assert.equal(await h.controller.activate({ ...suggestion }), true);
  assert.equal(h.state.mapType, 'arc_flow'); assert.equal(h.state.arcFlowView.visibleFlows.length, 100);
  assert.equal(tableRecords(h.state).length, 120);
  const limit = h.control('Số cung hiển thị'); limit.value = 'all'; limit.events.change();
  assert.equal(h.state.arcFlowView.visibleFlows.length, 120);
  const target = h.control('Điểm đến'); target.value = h.state.arcFlowView.flows.find(flow => flow.target.name === 'B110').target.id; target.events.change();
  assert.equal(h.state.arcFlowView.flows.length, 1); assert.equal(tableRecords(h.state).length, 1);
  assert.equal(h.sources.get('arc-node-data').data.features.length, 2);
  assert.equal(h.controller.reset(), true); assert.equal(h.state.arcFlowView.flows.length, 120);
  assert.equal(h.state.arcFlowView.visibleFlows.length, 100); assert.equal(tableRecords(h.state).length, 120);
  h.controller.setActive(false); assert.equal(h.layers.get('arc-nodes').layout.visibility, 'none');
  h.controller.setActive(true); assert.equal(h.layers.get('arc-nodes').layout.visibility, 'visible');
});

test('one time selector filters exactly one of three dates and All restores every date', async () => {
  const dates = [15, 16, 17].map(day => new Date(`2026-09-${day}T00:00:00.000Z`));
  const firstDay = Array.from({ length: 66 }, (_, i) => {
    const source = Math.floor(i / 3); const target = (source + i % 3 + 1) % 22;
    return row({ origin: `P${source}`, destination: `P${target}`, origin_lng: 106 + source * .01,
      destination_lng: 106 + target * .01, destination_lat: 10.7, date: dates[0], passengers: 100 + i });
  });
  const records = [...firstDay,
    ...firstDay.filter((_, i) => i % 3 === 0).map(record => ({ ...record, date: dates[1], passengers: 10 })),
    ...firstDay.filter((_, i) => i % 6 === 0).map(record => ({ ...record, date: dates[2], passengers: 20 }))];
  const h = harness({ records });
  await h.controller.activate({ ...suggestion });
  const change = (caption, value) => { const control = h.control(caption); control.value = value; control.events.change(); };
  const allTotal = records.reduce((sum, record) => sum + record.passengers, 0);

  assert.equal(h.control('Từ thời điểm'), undefined);
  assert.equal(h.control('Đến thời điểm'), undefined);
  assert.equal(h.control('Thời điểm').value, '');
  assert.deepEqual(h.control('Thời điểm').children.map(option => option.textContent), ['Tất cả', '15/09/2026', '16/09/2026', '17/09/2026']);
  assert.equal(h.state.arcFlowView.flows.length, 66);
  assert.equal(h.state.arcFlowView.nodes.features.length, 22);
  assert.equal(h.state.arcFlowView.total, allTotal);

  for (const [index, count, total] of [[0, 66, 8745], [1, 22, 220], [2, 11, 220]]) {
    change('Thời điểm', dates[index].toISOString());
    assert.equal(h.state.arcFlowView.flows.length, count);
    assert.equal(h.state.arcFlowView.total, total);
    assert.equal(h.state.arcFlowView.filteredRows, count);
    assert.equal(tableRecords(h.state).length, count);
    assert.equal(h.published.at(-1).view, h.state.arcFlowView);
    h.published.at(-1).onClick(h.state.arcFlowView.flows[0]);
    assert.ok(h.popups.at(-1).content.children.some(node => node.children?.[0]?.textContent === 'Bộ lọc'
      && node.children[1].textContent.includes(`${15 + index}/09/2026`)));
  }
  await h.controller.activate({ ...suggestion });
  assert.equal(h.control('Thời điểm').value, dates[2].toISOString());
  change('Thời điểm', '');
  assert.equal(h.state.arcFlowView.flows.length, 66);
  assert.equal(h.state.arcFlowView.total, allTotal);
  assert.equal(h.state.arcFlowView.filteredRows, 99);

  change('Số cung hiển thị', '50');
  assert.equal(h.state.arcFlowView.visibleFlows.length, 50);
  assert.equal(tableRecords(h.state).length, 66);
  await h.controller.activate({ ...suggestion });
  assert.equal(h.state.arcFlowView.total, allTotal);
  assert.equal(h.control('Số cung hiển thị').value, '50');
  h.controller.reset();
  assert.equal(h.control('Thời điểm').value, '');
  assert.equal(h.state.arcFlowView.total, allTotal);
});

test('flow and endpoint popups use current OD totals and plain text; filters close stale popups', async () => {
  const h = harness(); await h.controller.activate({ ...suggestion });
  const payload = h.published.at(-1); payload.onClick(h.state.arcFlowView.flows[0]);
  assert.match(h.popups[0].content.children[0].textContent, /A → B119/);
  h.controller.openNode(h.state.arcFlowView.nodes.features[0]);
  assert.equal(h.popups[0].removed, true);
  assert.ok(h.popups[1].content.children.some(child => child.children?.[0]?.textContent === 'Tổng ra'));
  const target = h.control('Điểm đến'); target.value = h.state.arcFlowView.flows[0].target.id; target.events.change();
  assert.equal(h.popups[1].removed, true);
  const search = h.controller.searchData(); assert.equal(search.chartType, 'point'); assert.deepEqual(search.search_fields, ['origin', 'destination']);
  assert.ok(search.data.features.every(feature => feature.properties.origin === feature.properties.destination));
});

test('unavailable graphics do not activate an empty Arc map, and reduced motion disables animation initially', async () => {
  const unsupported = harness({ overlayAvailable: false }); const item = { ...suggestion };
  assert.equal(await unsupported.controller.activate(item), false);
  assert.equal(unsupported.state.mapType, null); assert.equal(item.available, false);
  assert.match(item.unavailableReason, /WebGL2/);
  const previous = globalThis.matchMedia;
  try {
    globalThis.matchMedia = () => ({ matches: true });
    const h = harness(); await h.controller.activate({ ...suggestion });
    assert.equal(h.state.arcFlowStyle.animated, false);
    h.controller.dispose(); assert.equal(h.removed.at(-1), 'a');
  } finally { if (previous) globalThis.matchMedia = previous; else delete globalThis.matchMedia; }
});

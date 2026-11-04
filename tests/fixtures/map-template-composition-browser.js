import { createMapTemplateRenderer } from '../../src/map-template-renderer.js';
import { mountTemplateChartFrame } from '../../src/map-template-component-frame.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const slots = ['map', 'search', 'metrics', 'legend', 'controls', 'attribution', 'status'];
const html = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 8l-9 5-9-5 9-5Z"></path></svg>`
  + slots.map(slot => `<div class="slot-${slot}" data-template-slot="${slot}"></div>`).join('');
const component = { kind: 'line', origin: 'generated', html: '<div></div>', css: 'body{color:#123456}',
  js: 'window.renderTemplateComponent=({root,chart})=>{root.textContent=chart.title;document.body.style.height="310px";};' };
const source = { template: 'mau_01', html: '<main id="map"></main>', css: '#map{}', js: 'throw Error("never execute raw template")' };
const editorialSource = { ...source, template: 'mau_02' };
const editorialHtml = `<div class="editorial-layout"><aside class="editorial-sidebar"><h1>Khám phá <em>không gian.</em></h1>
  <div data-template-slot="search"></div><div data-template-slot="metrics"></div></aside>
  <main class="editorial-map"><div data-template-slot="map"></div><div data-template-slot="legend"></div>
  <div data-template-slot="controls"></div><div data-template-slot="attribution"></div><div data-template-slot="status"></div></main></div>`;
const editorialCss = `.editorial-layout{display:grid;grid-template-columns:340px minmax(0,1fr);height:100%;background:#f7f5ef}
  .editorial-sidebar{position:relative;min-width:0;padding:24px;background:#f7f5ef;font-family:Georgia,serif}
  .editorial-sidebar h1{font-size:36px;color:#243a37}.editorial-sidebar em{color:#1c7b73}
  .editorial-map{position:relative;min-width:0}.editorial-map [data-template-slot="map"]{position:absolute;inset:0}
  .editorial-sidebar .workspace-metrics{position:static;max-width:none;max-height:50%;overflow:auto}
  @media(max-width:760px){.editorial-layout{grid-template-columns:1fr;grid-template-rows:120px minmax(0,1fr)}
  .editorial-sidebar{padding:12px}.editorial-sidebar h1{font-size:18px;margin:0}}`;

async function run() {
  const useWebgl = new URLSearchParams(location.search).has('webgl');
  let realMap = null;
  if (useWebgl) {
    const maplibregl = await import('maplibre-gl');
    realMap = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [] },
      center: [106, 16], zoom: 4, attributionControl: false });
    await new Promise(resolve => realMap.once('load', resolve));
    realMap.addSource('test-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106, 16] } }
    ] } });
    realMap.addLayer({ id: 'test-point', type: 'circle', source: 'test-point' });
  }
  const list = document.querySelector('.map-metric-list');
  for (let index = 0; index < 7; index++) {
    const button = document.createElement('button'); button.textContent = `Chỉ số ${index + 1}`; list.append(button);
  }
  let selected = 0; list.firstElementChild.addEventListener('click', () => selected++);
  let resizeCount = 0; let calls = 0; let invalid = false;
  const picker = { ready: Promise.resolve(), getSelectedSource: () => source };
  const renderer = createMapTemplateRenderer({ document, map: { resize() { resizeCount++; realMap?.resize(); } }, picker, fetchImpl: async (_url, options) => {
    calls++;
    const templateId = JSON.parse(options.body).templateId;
    return { ok: true, json: async () => ({ templateId, sourceHash: templateId === 'mau_02' ? 'editorial' : 'abc',
      composition: { html: templateId === 'mau_02' ? editorialHtml : invalid ? '<div data-template-slot="map"></div>' : html,
        css: templateId === 'mau_02' ? editorialCss : '.slot-search{position:absolute;top:10px}', components: [component] } }) };
  } });
  renderer.update({ hasData: false, capabilities: { mapTypes: [], popupTypes: [] } });
  assert(!renderer.getShell(), 'Static template appeared without data');
  const allMaps = ['choropleth', 'point', 'map_line', 'arc_flow'];
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  const shell = renderer.getShell();
  assert(shell, 'AI composition did not mount');
  assert(shell.getBoundingClientRect().width <= innerWidth + 1, 'Template overflows the viewport');
  assert(shell.querySelector('[data-template-slot="map"] #map'), 'Existing MapLibre container was not moved');
  if (realMap) assert(realMap.getCanvas().isConnected && realMap.getLayer('test-point'), 'MapLibre layer was lost when moving the map');
  assert(shell.querySelector('[data-template-slot="search"] #search-input'), 'Existing search was not moved');
  assert(shell.querySelectorAll('.map-metric-list button').length === 7, 'AI metric buttons were cut to four');
  shell.querySelector('.map-metric-list button').click();
  assert(selected === 1, 'Existing metric event handler was lost');
  assert(calls === 1 && resizeCount > 0, 'Composition fetched repeatedly or map not resized');
  const container = document.createElement('div'); shell.append(container);
  const chartMessages = [];
  const captureChartMessage = event => { if (event.data?.type) chartMessages.push(event.data.type + (event.data.height || '')); };
  window.addEventListener('message', captureChartMessage);
  const cleanup = mountTemplateChartFrame({ document, container, component, chart: { title: 'Biểu đồ đường', data: [], series: [] } });
  for (let i = 0; i < 100 && !chartMessages.some(message => message.startsWith('height')); i++) await wait(50);
  assert(chartMessages.some(message => message.startsWith('height')),
    `Generated chart did not run in the sandbox: ${chartMessages.join(',')}`);
  window.removeEventListener('message', captureChartMessage);
  cleanup();
  let usedFallback = false;
  mountTemplateChartFrame({ document, container, component: { ...component, js: 'window.renderTemplateComponent=()=>{throw Error("bad")}' },
    chart: { title: 'Fallback', data: [], series: [] }, fallback: () => { usedFallback = true; } });
  for (let i = 0; i < 40 && !usedFallback; i++) await wait(50);
  assert(usedFallback, 'Failed generated chart did not use the existing chart renderer');
  renderer.update({ hasData: false, capabilities: { mapTypes: [], popupTypes: [] } });
  assert(!renderer.getShell() && document.querySelector('.map-panel > #map'), 'Original map was not restored');
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: editorialSource } }));
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  const editorialShell = renderer.getShell();
  assert(editorialShell?.querySelector('.editorial-sidebar h1 em'), 'mau_02 editorial layout was not mounted');
  const sidebar = editorialShell.querySelector('.editorial-sidebar').getBoundingClientRect();
  const mapArea = editorialShell.querySelector('.editorial-map').getBoundingClientRect();
  if (innerWidth <= 760) assert(mapArea.top >= sidebar.bottom - 1, 'mau_02 mobile sidebar did not stack above the map');
  else assert(mapArea.left >= sidebar.right - 1 && sidebar.width > 300, 'mau_02 map did not sit beside its sidebar');
  assert(editorialShell.querySelector('[data-template-slot="map"] #map') && realMap?.getCanvas().isConnected !== false,
    'MapLibre was lost in the mau_02 layout');
  invalid = true;
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...source } } }));
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  for (let i = 0; i < 40 && !document.getElementById('map-template-status').textContent.includes('Không ghép'); i++) await wait(50);
  assert(!renderer.getShell() && document.querySelector('.map-panel > #map'), 'Invalid composition replaced the valid map');
  assert(!document.getElementById('map-template-retry').hidden, 'Failed composition cannot be retried');
  assert(document.querySelector('.map-template-fallback-notice')?.textContent.includes('Đang hiển thị bản đồ gốc'),
    'Fallback state is not visible on the map');
  realMap?.remove();
  return { ok: true, checks: ['no static preview', 'seven AI buttons', 'preserved controls', 'sandbox chart', 'chart fallback', 'restore', 'mau_02 split layout', 'invalid AI fallback'] };
}

run().then(result => { document.getElementById('module-result').textContent = JSON.stringify(result); })
  .catch(error => { document.getElementById('module-result').textContent = JSON.stringify({ ok: false, error: error.message, stack: error.stack }); });

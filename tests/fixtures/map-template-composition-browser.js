import { createMapTemplateRenderer } from '../../src/map-template-renderer.js';
import { BarRenderer } from '../../src/charts/bar-chart.js';
import { LineRenderer } from '../../src/charts/line-chart.js';
import { createMapLayerManager } from '../../src/map-layer-manager.js';
import { createMapProcessingStatus } from '../../src/shared/ui/map-processing-status.js';
import { createAiPopupContent } from '../../src/shared/popup/ai-popup.js';
import { polygonLegendLabels } from '../../src/shared/data/polygon-legend.js';
import '../../src/map-template-renderer.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const slots = ['map', 'search', 'metrics', 'legend', 'controls', 'attribution', 'status'];
const html = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3 21 8l-9 5-9-5 9-5Z"></path></svg>`
  + slots.map(slot => slot === 'attribution'
    ? '<aside class="attribution-frame"><div class="attribution-inner"><div class="slot-attribution" data-template-slot="attribution"></div></div></aside>'
    : `<div class="slot-${slot}" data-template-slot="${slot}"></div>`).join('');
const attributionCss = '.attribution-frame{position:absolute;bottom:12px;left:12px;padding:8px 12px;background:#35312d;display:block!important}.attribution-inner{padding:2px;background:#35312d}';
const component = { kind: 'line', origin: 'generated', html: '<div></div>', css: 'body{color:#123456}',
  js: 'window.renderTemplateComponent=({root,chart})=>{root.textContent=chart.title;document.body.style.height="310px";};' };
const source = { template: 'mau_01', html: '<main id="map"></main>', css: '#map{}', js: 'throw Error("never execute raw template")' };
const editorialSource = { ...source, template: 'mau_02' };
const floatingSource = { ...source, template: 'floating_chips' };
// Like the source template, the strip has a maximum width, not a fixed width.
// Percentage widths inherited by its children must not stretch three chips across the map.
const floatingCss = `.map-template-shell{color:#263d39;font:13px Arial,sans-serif}
  .map-search-submit{width:34px;height:38px;padding:16px}
  .map-search-submit svg{width:2px;height:2px;max-width:2px}
  .map-search-form input{border-left:2px solid #b88b44;border-right:2px solid #b88b44;box-shadow:inset 2px 0 #b88b44}
  .map-search-location{border-right:2px solid #b88b44}
  .map-search-submit{border-left:2px solid #b88b44}
  .map-search-location::after,.map-search-submit::before{content:'';width:2px;height:100%;background:#b88b44}
  .slot-search{position:absolute;top:20px;left:24px;width:min(430px,calc(100% - 100px))}
  .slot-metrics{position:absolute;top:100px;left:24px;display:flex;max-width:calc(100% - 48px);gap:8px}
  .map-metric-list{flex-direction:row;flex-wrap:wrap;gap:8px}
  .map-metric-toggle{background:#fff;border:1px solid #d5ddd5;color:#187d73}
  .map-metric-button{background:#fff;border:1px solid #d5ddd5;padding:8px 12px;color:#263d39}
  .map-metric-button.active{background:#dcece7;border-color:#187d73}
  .maplibregl-popup-content{background:#fff;color:#263d39;padding:20px}
  .popup-info-caption{color:#187d73}
  .numeric-label-regression{display:flex}
  .numeric-label-regression>span{white-space:normal;overflow-wrap:anywhere;transform:none}
  .slot-legend{position:absolute;right:22px;bottom:28px;width:286px;padding:16px;background:#fff}
  .slot-controls{position:absolute;top:20px;right:20px}
  .slot-attribution{position:absolute;bottom:8px;left:12px}
  @media(max-width:760px){.slot-legend{width:230px}.slot-metrics{top:75px}}`;
const editorialHtml = `<div class="editorial-layout"><aside class="editorial-sidebar"><h1>Khám phá <em>không gian.</em></h1>
  <div data-template-slot="search"></div><div data-template-slot="metrics"></div></aside>
  <main class="editorial-map"><div data-template-slot="map"></div><div data-template-slot="legend"></div>
  <div data-template-slot="controls"></div><div data-template-slot="attribution"></div><div data-template-slot="status"></div></main></div>`;
const editorialCss = `.map-template-shell{--editorial-ink:#243a37;color:var(--editorial-ink)}
  .editorial-layout{display:grid;grid-template-columns:340px minmax(0,1fr);height:100%;background:#f7f5ef}
  .editorial-sidebar{position:relative;min-width:0;padding:24px;background:#f7f5ef;font-family:Georgia,serif}
  .editorial-sidebar h1{font-size:36px;color:#243a37}.editorial-sidebar em{color:#1c7b73}
  .editorial-map{position:relative;min-width:0}.editorial-map [data-template-slot="map"]{position:absolute;inset:0}
  .editorial-sidebar .workspace-metrics{position:static;max-width:none;max-height:50%;overflow:auto}
  [data-template-slot="legend"]{position:absolute;bottom:24px;right:16px;width:230px;padding:16px;background:#fff;color:#243a37}
  .map-search-form{background:#fff;border-radius:6px}.map-search-form input::placeholder{color:#52635f}
  @media(max-width:760px){.editorial-layout{grid-template-columns:1fr;grid-template-rows:220px minmax(0,1fr)}
  .editorial-sidebar{padding:12px}.editorial-sidebar h1{font-size:18px;margin:0}}`;

async function run() {
  const useWebgl = new URLSearchParams(location.search).has('webgl');
  let realMap = null;
  let layerManager = null;
  if (useWebgl) {
    const maplibregl = await import('maplibre-gl');
    realMap = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [
      { id: 'basemap', type: 'background', paint: { 'background-color': '#e8f0e3' } }
    ] },
      center: [106, 16], zoom: 4, attributionControl: false });
    await new Promise(resolve => realMap.once('load', resolve));
    layerManager = createMapLayerManager(realMap, 'dataset');
    layerManager.map.addSource('test-point', { type: 'geojson', data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106, 16] } }
    ] } });
    layerManager.map.addLayer({ id: 'test-point', type: 'circle', source: 'test-point' });
    layerManager.map.addLayer({ id: 'disabled-point', type: 'circle', source: 'test-point', layout: { visibility: 'none' } });
    layerManager.attach();
  }
  const list = document.querySelector('.map-metric-list');
  for (let index = 0; index < 7; index++) {
    const button = document.createElement('button'); button.className = 'map-metric-button';
    const label = document.createElement('span'); label.className = 'map-metric-label'; label.textContent = `Chỉ số ${index + 1}`;
    const preview = document.createElement('span'); preview.className = 'map-metric-preview'; preview.textContent = '●'; preview.style.setProperty('--metric-color', '#e040a0');
    button.append(label, preview); list.append(button);
  }
  let selected = 0; list.firstElementChild.addEventListener('click', () => selected++);
  let autoRepair = false; const repairRequests = []; let repairGate = null;
  let resizeCount = 0; let calls = 0; let invalid = false; let extraCss = ''; let responseGate = null; let refreshRequested = false;
  const panelNode = () => document.querySelector('.map-panel');
  const picker = { ready: Promise.resolve(), getSelectedSource: () => source };
  const loadingStates = [];
  const processingStatus = createMapProcessingStatus(document.getElementById('status'));
  const renderer = createMapTemplateRenderer({ document, map: { resize() { resizeCount++; realMap?.resize(); }, getCanvas: () => realMap?.getCanvas() }, picker, processingStatus,
    onLoadingChange(loading) { loadingStates.push(loading); layerManager?.setVisible(!loading); }, fetchImpl: async (_url, options) => {
    calls++;
    const { templateId, refresh, layoutContext, repair } = JSON.parse(options.body);
    assert(layoutContext.viewport.width === panelNode().clientWidth && layoutContext.viewport.height === panelNode().clientHeight,
      'AI did not receive the actual map viewport');
    if (repair) {
      repairRequests.push(repair);
      assert(refresh && repair.layout.html && repair.feedback.slots.length === 7, 'Repair lost prior layout or measured slots');
      assert(panelNode().hasAttribute('data-template-loading'), 'Automatic repair ended the loading lifecycle early');
      if (repairGate) await repairGate;
    }
    refreshRequested = refresh;
    if (responseGate) await responseGate;
    return { ok: true, json: async () => ({ templateId, sourceHash: templateId === 'mau_02' ? 'editorial' : 'abc',
      composition: { html: templateId === 'mau_02' ? editorialHtml : invalid ? '<div data-template-slot="map"></div>' : html,
        css: (templateId === 'mau_02' ? editorialCss : templateId === 'floating_chips' ? floatingCss : attributionCss + '.slot-search{position:absolute;top:10px}') + (repair && autoRepair ? '' : extraCss), components: [component] } }) };
  } });
  renderer.update({ hasData: false, capabilities: { mapTypes: [], popupTypes: [] } });
  assert(!renderer.getShell(), 'Static template appeared without data');
  const allMaps = ['choropleth', 'point', 'map_line', 'arc_flow'];
  await picker.ready;
  const finishAnalysis = processingStatus.begin();
  processingStatus.set('Đang phân tích...');
  assert(document.getElementById('status').textContent === 'Đang phân tích và áp dụng template',
    'Analysis did not immediately show the combined waiting message');
  let releaseResponse;
  responseGate = new Promise(resolve => { releaseResponse = resolve; });
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  await wait(50);
  const panel = document.querySelector('.map-panel');
  const notice = document.getElementById('status');
  assert(!panel.querySelector('.map-template-fallback-notice'), 'Template created a second map notice');
  assert(panel.getAttribute('aria-busy') === 'true' && !renderer.getShell(), 'Composition did not enter loading state');
  assert(getComputedStyle(document.getElementById('map')).opacity === '1', 'Original map is hidden while composing');
  assert(!notice.hidden && notice.textContent === 'Đang phân tích và áp dụng template', 'Composition has the wrong waiting message');
  assert(document.getElementById('map-template-status').textContent === notice.textContent, 'Sidebar and map have different waiting messages');
  assert(notice.getBoundingClientRect().height < panel.getBoundingClientRect().height / 2,
    'Waiting notice covers the map');
  assert(getComputedStyle(notice).pointerEvents === 'none', 'Waiting notice blocks map interaction');
  for (const selector of ['.map-query-panel', '.workspace-metrics', '.map-legends']) {
    assert(getComputedStyle(panel.querySelector(selector)).display === 'none', `${selector} leaked the default UI while composing`);
  }
  for (const selector of ['.map-controls']) {
    assert(getComputedStyle(panel.querySelector(selector)).display !== 'none', `${selector} disappeared from the waiting basemap`);
  }
  assert(getComputedStyle(notice).display !== 'none', 'Combined waiting notice is hidden during template application');
  processingStatus.set('Đã phân tích dữ liệu.');
  finishAnalysis();
  assert(notice.textContent === 'Đang phân tích và áp dụng template' && !notice.hidden,
    'Waiting notice ended before the template response arrived');
  if (realMap) {
    assert(realMap.getLayer('basemap') && realMap.getLayoutProperty('basemap', 'visibility') !== 'none', 'Waiting state hid the basemap');
    assert(realMap.getLayoutProperty('dataset--test-point', 'visibility') === 'none', 'Data layer is visible while composing');
    layerManager.map.addLayer({ id: 'late-point', type: 'circle', source: 'test-point' });
    assert(realMap.getLayoutProperty('dataset--late-point', 'visibility') === 'none', 'New data layer bypassed the waiting state');
  }
  releaseResponse(); responseGate = null;
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  const shell = renderer.getShell();
  assert(shell, 'AI composition did not mount');
  assert(getComputedStyle(shell.querySelector('.attribution-frame')).display === 'none', 'Hidden attribution left a background wrapper visible');
  assert(shell.querySelector('.attribution-frame').getBoundingClientRect().width === 0, 'Attribution frame left an empty corner block');
  assert(getComputedStyle(shell.querySelector('[data-template-slot="controls"]')).display !== 'none', 'Hiding attribution removed other controls');
  assert(!panel.hasAttribute('data-template-loading') && notice.textContent === 'Đã phân tích dữ liệu.', 'Combined waiting notice did not finish after mounting');
  processingStatus.set('');
  assert(shell.getBoundingClientRect().width <= innerWidth + 1, 'Template overflows the viewport');
  assert(shell.querySelector('[data-template-slot="map"] #map'), 'Existing MapLibre container was not moved');
  if (realMap) {
    assert(realMap.getCanvas().isConnected && realMap.getLayer('dataset--test-point'), 'MapLibre layer was lost when moving the map');
    for (const id of ['test-point', 'late-point']) assert(realMap.getLayoutProperty(`dataset--${id}`, 'visibility') === 'visible', 'Data layer did not return after composition');
    assert(realMap.getLayoutProperty('dataset--disabled-point', 'visibility') === 'none', 'Composition enabled a deliberately hidden layer');
  }
  assert(loadingStates.join(',') === 'true,false', 'Loading lifecycle did not release data visibility');
  assert(getComputedStyle(shell.querySelector('.map-query-panel')).display !== 'none', 'Search remained hidden after composition');
  assert(getComputedStyle(shell.querySelector('.map-legends')).display !== 'none', 'Legend remained hidden after composition');
  assert(shell.querySelector('[data-template-slot="search"] #search-input'), 'Existing search was not moved');
  assert(shell.querySelectorAll('.map-metric-list button').length === 7, 'AI metric buttons were cut to four');
  shell.querySelector('.map-metric-list button').click();
  assert(selected === 1, 'Existing metric event handler was lost');
  assert(calls === 1 && resizeCount > 0, 'Composition fetched repeatedly or map not resized');
  renderer.update({ hasData: false, capabilities: { mapTypes: [], popupTypes: [] } });
  assert(!renderer.getShell() && document.querySelector('.map-panel > #map'), 'Original map was not restored');
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: editorialSource } }));
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  const editorialShell = renderer.getShell();
  assert(editorialShell?.querySelector('.editorial-sidebar h1 em'), 'mau_02 editorial layout was not mounted');
  const sidebar = editorialShell.querySelector('.editorial-sidebar').getBoundingClientRect();
  const mapArea = editorialShell.querySelector('.editorial-map').getBoundingClientRect();
  const mapBounds = document.getElementById('map').getBoundingClientRect();
  assert(mapBounds.width > 0 && mapBounds.height > 0, 'mau_02 mounted an empty map region');
  if (innerWidth <= 760) assert(mapArea.top >= sidebar.bottom - 1, 'mau_02 mobile sidebar did not stack above the map');
  else assert(mapArea.left >= sidebar.right - 1 && sidebar.width > 300, 'mau_02 map did not sit beside its sidebar');
  assert(editorialShell.querySelector('[data-template-slot="map"] #map') && realMap?.getCanvas().isConnected !== false,
    'MapLibre was lost in the mau_02 layout');
  const searchSlot = editorialShell.querySelector('[data-template-slot="search"]').getBoundingClientRect();
  const queryBounds = editorialShell.querySelector('.map-query-panel').getBoundingClientRect();
  const inputBounds = document.getElementById('search-input').getBoundingClientRect();
  assert(Math.abs(queryBounds.left - searchSlot.left) < 1 && queryBounds.right <= searchSlot.right + 1,
    'Native search offsets escaped the template slot');
  assert(inputBounds.left >= sidebar.left && inputBounds.right <= sidebar.right,
    'Search input is clipped outside the sidebar');
  const legends = editorialShell.querySelector('.map-legends');
  const legendSlot = legends.parentElement.getBoundingClientRect();
  const legendBounds = legends.getBoundingClientRect();
  assert(Math.abs(legendBounds.left - legendSlot.left - 16) < 1 && legendBounds.right <= legendSlot.right,
    'Native legend offsets escaped the template card');
  assert(getComputedStyle(legends.querySelector('.weather-legend-labels')).color === 'rgb(36, 58, 55)',
    'Legend labels retained unreadable native dark-theme colors');
  assert(getComputedStyle(legends.querySelector('.weather-legend')).backgroundColor === 'rgba(0, 0, 0, 0)',
    'Legend retained a second native card');
  assert(getComputedStyle(editorialShell.querySelector('.map-search-form')).backgroundColor === 'rgb(255, 255, 255)',
    'Composed search style lost to native CSS');
  assert(getComputedStyle(document.getElementById('search-input'), '::placeholder').color === 'rgb(82, 99, 95)',
    'Template pseudo-element style was lost');
  assert(getComputedStyle(legends.querySelector('.point-legend')).display === 'none', 'Hidden legend became visible');
  assert(legends.querySelector('.weather-legend-scale').style.background.includes('gradient'), 'Data palette was overwritten');
  extraCss = '.editorial-map{display:none}';
  responseGate = new Promise(resolve => { releaseResponse = resolve; });
  renderer.update({ hasData: true, capabilities: { mapTypes: ['point'], popupTypes: ['line'] } });
  await wait(50);
  assert(!renderer.getShell() && document.querySelector('.map-panel > #map'), `Old template remained visible during recomposition: ${document.getElementById('map-template-status').textContent}; calls=${calls}`);
  if (realMap) assert(realMap.getLayoutProperty('dataset--test-point', 'visibility') === 'none', 'Recomposition leaked the data layer');
  releaseResponse(); responseGate = null;
  for (let i = 0; i < 40 && !document.getElementById('map-template-status').textContent.includes('Không ghép'); i++) await wait(50);
  assert(renderer.getComposition()?.css === editorialCss && renderer.getShell()?.querySelector('.editorial-sidebar'),
    'Failed recomposition did not restore the previous template');
  assert(!panel.hasAttribute('data-template-loading'), 'Failed recomposition left the map waiting');
  if (realMap) assert(realMap.getLayoutProperty('dataset--test-point', 'visibility') === 'visible', 'Failed recomposition did not restore data visibility');
  extraCss = '';
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  // AI styles may address the map id; core geometry must keep the live map filling its slot.
  extraCss = '#map{position:relative;width:0;height:0}';
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...editorialSource } } }));
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  assert(renderer.getShell() && document.getElementById('map').clientHeight > 0, 'AI CSS collapsed the live map');
  // Give AI the collapsed wrapper measurements and accept its corrected layout
  // in the same loading lifecycle, without a user clicking retry.
  autoRepair = true;
  extraCss = '.editorial-map{height:0;overflow:hidden}';
  const callsBeforeRepair = calls;
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...editorialSource } } }));
  for (let i = 0; i < 80 && !renderer.getShell(); i++) await wait(50);
  assert(renderer.getShell() && renderer.getComposition().css === editorialCss, 'AI did not automatically fix a collapsed map');
  assert(calls === callsBeforeRepair + 2, 'Layout correction did not use one measured feedback request');
  assert(repairRequests.at(-1).feedback.issue === 'map-size' && repairRequests.at(-1).feedback.ancestors.some(item => item.height === 0),
    'AI did not receive the collapsed ancestor dimensions');
  assert(document.getElementById('map-template-retry').hidden && !panel.hasAttribute('data-template-loading'), 'Automatic repair requires manual retry');
  autoRepair = false;
  // A persistently broken AI must stop after two corrections and preserve the live map.
  extraCss = '.editorial-map{height:0;overflow:hidden}';
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...editorialSource } } }));
  for (let i = 0; i < 40 && !document.getElementById('map-template-status').textContent.includes('Không ghép'); i++) await wait(50);
  assert(!renderer.getShell() && document.querySelector('.map-panel > #map'), 'Collapsed composition left a blank map mounted');
  assert(!panel.hasAttribute('data-template-loading') && !document.getElementById('map-template-retry').hidden,
    'Layout failure did not clear loading or allow retry');
  extraCss = '';
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...editorialSource } } }));
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  assert(refreshRequested && renderer.getShell(), 'Retry reused a composition rejected by layout validation');
  invalid = true;
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...source } } }));
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  for (let i = 0; i < 40 && !document.getElementById('map-template-status').textContent.includes('Không ghép'); i++) await wait(50);
  assert(!renderer.getShell() && document.querySelector('.map-panel > #map'), 'Invalid composition replaced the valid map');
  assert(!document.getElementById('map-template-retry').hidden, 'Failed composition cannot be retried');
  assert(notice.hidden && !notice.textContent, 'Template error is displayed over the map');
  assert(document.getElementById('map-template-status').textContent.includes('Không ghép được'), 'Template error is missing from the sidebar');
  invalid = false;
  responseGate = new Promise(resolve => { releaseResponse = resolve; });
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...source } } }));
  assert(panel.hasAttribute('data-template-loading'), 'Delayed request did not start loading');
  renderer.update({ hasData: false, capabilities: { mapTypes: [], popupTypes: [] } });
  releaseResponse(); responseGate = null;
  await wait(50);
  assert(!renderer.getShell() && !panel.hasAttribute('data-template-loading'), 'Stale response mounted a template after removing data');
  const metricButtons = [...list.children];
  list.replaceChildren(...metricButtons.slice(0, 3));
  list.children[0].querySelector('.map-metric-label').textContent = 'Ô nhiễm';
  list.children[1].querySelector('.map-metric-label').textContent = 'Lượng mưa';
  list.children[2].querySelector('.map-metric-label').textContent = 'Nhiệt độ';
  const toggle = panel.querySelector('.map-metric-toggle');
  toggle.querySelector('.map-metric-count').textContent = '3';
  toggle.addEventListener('click', () => { list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); });
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: floatingSource } }));
  for (let i = 0; i < 40 && !renderer.getShell(); i++) await wait(50);
  const floatingShell = renderer.getShell();
  assert(floatingShell, 'Floating chip template did not mount');
  // At the right edge the last tick must remain "29", not "2" above "9".
  for (const className of ['weather-legend-labels positioned', 'line-legend-labels']) {
    const labels = document.createElement('div'); labels.className = `${className} numeric-label-regression`;
    labels.style.height = '14px';
    floatingShell.querySelector('[data-template-slot="legend"]').append(labels);
    const ticks = polygonLegendLabels({ hasData: true, min: 14, max: 29, stops: [[14, '#fff'], [21.5, '#fa0'], [29, '#a00']] }, labels.clientWidth);
    for (const tick of ticks) {
      const label = document.createElement('span'); label.textContent = tick.text;
      label.style.left = `calc(${tick.position}% + ${tick.offset || 0}px)`;
      label.style.top = `${tick.row * 14}px`; labels.append(label);
    }
    const bounds = labels.getBoundingClientRect();
    for (const label of labels.children) {
      const range = document.createRange(); range.selectNodeContents(label);
      assert(range.getClientRects().length === 1, 'A numeric legend tick wraps its digits');
      const tickBounds = label.getBoundingClientRect();
      assert(tickBounds.left >= bounds.left - 1 && tickBounds.right <= bounds.right + 1, 'A numeric legend tick escapes the scale');
    }
    assert(labels.lastElementChild.textContent === '29', 'Legend changed the maximum value');
    assert(labels.scrollWidth <= labels.clientWidth + 1, 'Numeric legend requires horizontal scrolling');
    labels.remove();
  }
  // Reproduce a vertically stacked search: a pixel flex-basis must not turn
  // the search box into a 180px tall blank card.
  const controls = floatingShell.querySelector('.map-search-controls');
  const searchButton = controls.querySelector('.map-search-submit');
  const searchGlyph = searchButton.querySelector('svg').getBoundingClientRect();
  assert(searchGlyph.width === 22 && searchGlyph.height === 22, 'Template shrank the search icon');
  assert(searchButton.getBoundingClientRect().width >= 36 && getComputedStyle(searchButton).paddingLeft === '0px', 'Search button padding squeezes the icon');
  for (const node of controls.querySelectorAll('.map-search-form > input, .map-search-location, .map-search-submit')) {
    const style = getComputedStyle(node);
    assert(style.borderLeftWidth === '0px' && style.borderRightWidth === '0px' && style.boxShadow === 'none', 'Search retains internal divider lines');
  }
  assert(getComputedStyle(controls.querySelector('.map-search-location'), '::after').content === 'none'
    && getComputedStyle(searchButton, '::before').content === 'none', 'Search retains pseudo-element dividers');
  controls.style.flexDirection = 'column';
  const searchBox = controls.querySelector('.map-search-box');
  assert(searchBox.getBoundingClientRect().height < 60, 'Stacked search has an oversized blank area');
  assert(searchBox.getBoundingClientRect().width >= controls.clientWidth - 1, 'Stacked search does not fill its available width');
  controls.style.flexDirection = '';
  const activeChip = list.firstElementChild;
  activeChip.classList.add('active');
  await wait(200); // Native buttons animate background changes.
  assert(getComputedStyle(activeChip).backgroundColor === 'rgb(220, 236, 231)', 'Active metric button kept the native theme');
  assert(getComputedStyle(activeChip).color === 'rgb(38, 61, 57)', 'Metric button text does not match the template');
  activeChip.classList.remove('active');
  // Real popup content includes nested labels/values with native dark colors.
  const popup = document.createElement('div'); popup.className = 'maplibregl-popup ai-weather-popup ai-map-popup';
  const popupContent = document.createElement('div'); popupContent.className = 'maplibregl-popup-content';
  const close = document.createElement('button'); close.className = 'maplibregl-popup-close-button'; close.textContent = '×';
  popupContent.append(close, createAiPopupContent(document, { properties: { region: 'Long Biên', pollution: 22, note: 'Ghi chú dữ liệu' } },
    [{ name: 'region', role: 'geo' }, { name: 'pollution', role: 'measure', labelVi: 'Mức độ ô nhiễm' },
      { name: 'note', role: 'text', labelVi: 'Ghi chú' }], 'region', { datasetTitle: 'Chất lượng môi trường' }));
  popup.append(popupContent); document.getElementById('map').append(popup);
  for (const node of popup.querySelectorAll('.popup-info-heading > strong, dt, dd, .maplibregl-popup-close-button')) {
    assert(getComputedStyle(node).color === 'rgb(38, 61, 57)', 'Popup retains unreadable native text colors');
  }
  assert(getComputedStyle(popup.querySelector('.popup-info-caption')).color === 'rgb(24, 125, 115)', 'Template popup caption override was lost');
  assert(getComputedStyle(popup.querySelector('.weather-popup')).paddingTop === '0px', 'Popup has doubled frame padding');
  assert(getComputedStyle(close).backgroundColor === 'rgba(0, 0, 0, 0)', 'Popup close button retained its native dark circle');
  assert(getComputedStyle(popup.querySelector('.popup-info-note')).backgroundColor === 'rgba(0, 0, 0, 0)', 'Popup note retained a black native card');
  popupContent.style.color = '#f1f5f9'; popupContent.style.background = '#18212c';
  assert(getComputedStyle(popup.querySelector('dd')).color === 'rgb(241, 245, 249)', 'Popup text cannot follow a dark template');
  // Charts share the original renderers, with only presentation tokens changing.
  // The response deliberately includes an old generated component; it must stay inert.
  const data = Array.from({ length: 30 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    temperature: index === 14 ? null : index === 2 ? 0 : 27 + Math.sin(index),
    minimum: 24 + Math.sin(index)
  }));
  const originalData = JSON.stringify(data);
  const chartCard = document.createElement('div'); chartCard.className = 'weather-popup ai-popup-chart-only';
  const chartHost = document.createElement('div'); chartHost.className = 'ai-popup-chart';
  chartCard.append(chartHost);
  popup.classList.add('has-popup-chart');
  popup.style.cssText = 'position:relative;transform:none;display:block;max-width:100%;';
  popup.style.setProperty('--popup-map-width', `${panel.clientWidth - 32}px`);
  popupContent.replaceChildren(close, chartCard);
  const themes = [
    { surface: '#e4f0fb', text: '#243a37', secondary: '#52635f', border: '#bacfdc', rgb: 'rgb(228, 240, 251)' },
    { surface: '#222c3c', text: '#f1f5f9', secondary: '#b5c2d4', border: '#455469', rgb: 'rgb(34, 44, 60)' }
  ];
  for (const [kind, chartRenderer] of [['line', LineRenderer], ['bar', BarRenderer]]) {
    const config = {
      chartKind: kind, title: `${kind === 'line' ? 'Biểu đồ đường' : 'Biểu đồ cột'} · Phú Thọ`, unit: '°C',
      xField: 'date', series: [{ key: 'temperature', label: 'Nhiệt độ trung bình', color: '#ff8354' },
        ...(kind === 'bar' ? [{ key: 'minimum', label: 'Nhiệt độ thấp nhất', color: '#57c785' }] : [])],
      data, timeColumn: { name: 'date', role: 'time', granularity: 'day' },
      showLegend: true, showTooltip: true, showDataLabels: false,
      preserveMissingValues: true, animate: false, sort: 'none', limit: 'all'
    };
    const normalized = chartRenderer.render(chartHost, config);
    assert(normalized.data[2].temperature === 0 && normalized.data[14].temperature === null, `${kind} changed zero or missing values`);
    for (let i = 0; i < 100 && !chartHost.querySelector('.recharts-cartesian-axis-tick-value'); i++) await wait(30);
    assert(chartHost.querySelector('.recharts-cartesian-axis-tick-value'), `${kind} native chart did not render`);
    const nativeCard = chartHost.firstElementChild;
    for (const theme of themes) {
      for (const key of ['surface', 'text', 'secondary', 'border']) floatingShell.style.setProperty(`--template-${key}`, theme[key]);
      popupContent.style.background = theme.surface; popupContent.style.color = theme.text;
      floatingShell.style.setProperty('--template-font', 'Arial, sans-serif');
      floatingShell.style.setProperty('--template-label-size', '11px');
      await wait(80);
      assert(chartHost.firstElementChild === nativeCard, 'Changing theme remounted the chart');
      assert(!popup.querySelector('iframe'), 'Chart created a nested iframe');
      assert(getComputedStyle(nativeCard).backgroundColor === theme.rgb, `${kind} chart did not follow template surface`);
      assert(getComputedStyle(chartHost.querySelector('h2')).color === getComputedStyle(popupContent).color, `${kind} title lost contrast`);
      const plot = chartHost.querySelector('.bar-chart-plot');
      assert(plot.clientWidth > 180 && plot.clientHeight > 140, `${kind} plot collapsed`);
      assert(chartHost.scrollWidth <= chartHost.clientWidth + 1, `${kind} chart needs horizontal scrolling`);
      const xTicks = [...chartHost.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')];
      assert(xTicks.length >= 2 && xTicks.every(tick => !tick.textContent.includes('2026-')), `${kind} date ticks are not compact: ${xTicks.map(tick => tick.textContent).join(",")}`);
      const path = chartHost.querySelector(kind === 'line' ? '.recharts-line-curve' : '.recharts-bar-rectangle path');
      assert(path?.getAttribute(kind === 'line' ? 'stroke' : 'fill') === '#ff8354', `${kind} data color changed`);
      const surface = chartHost.querySelector('.recharts-wrapper > svg');
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      for (let i = 0; i < 40 && !chartHost.querySelector('.recharts-tooltip-wrapper > div')?.textContent.includes('°C'); i++) await wait(30);
      const tooltip = chartHost.querySelector('.recharts-tooltip-wrapper > div');
      assert(tooltip && tooltip.textContent.includes('°C'), `${kind} tooltip lost the unit`);
      assert(getComputedStyle(tooltip).backgroundColor === theme.rgb, `${kind} tooltip did not follow the template`);
    }
    if (kind === 'bar') {
      const zoomButtons = chartHost.querySelectorAll('.chart-zoom-controls button');
      assert(zoomButtons.length === 3 && chartHost.querySelector('.recharts-brush'), 'Bar chart lost zoom or brush');
      zoomButtons[2].click(); await wait(100);
      const visibleBars = () => chartHost.querySelectorAll('.recharts-bar-rectangle').length;
      const expectedBars = config.series.reduce((total, series) => total + data.filter(row => Number.isFinite(row[series.key]) && row[series.key] !== 0).length, 0);
      assert(visibleBars() >= expectedBars, `Show all hid valid bars: ${visibleBars()}/${expectedBars}`);
      const allBars = visibleBars();
      zoomButtons[0].click(); await wait(100);
      assert(visibleBars() < allBars, 'Bar zoom did not change the visible range');
    } else {
      assert((chartHost.querySelector('.recharts-line-curve').getAttribute('d').match(/M/g) || []).length === 2, 'Line connected across missing observations');
    }
    chartRenderer.clear(chartHost);
    assert(!chartHost.childElementCount, 'Native chart did not unmount cleanly');
  }
  assert(JSON.stringify(data) === originalData, 'Template changed chart data');
  for (const key of ['surface', 'text', 'secondary', 'border', 'font', 'label-size']) floatingShell.style.removeProperty(`--template-${key}`);
  popup.remove();
  const metricBounds = floatingShell.querySelector('[data-template-slot="metrics"]').getBoundingClientRect();
  assert(metricBounds.width < Math.min(500, panel.clientWidth - 24), 'Three metric chips stretch into an oversized panel');
  const floatingSearch = floatingShell.querySelector('[data-template-slot="search"]');
  assert(metricBounds.top >= floatingSearch.getBoundingClientRect().bottom, 'Floating metrics overlap the search controls');
  const navigation = floatingSearch.querySelector('.map-region-navigation');
  navigation.style.height = '110px';
  await wait(100);
  assert(floatingShell.querySelector('[data-template-slot="metrics"]').getBoundingClientRect().top >= floatingSearch.getBoundingClientRect().bottom,
    'Floating metrics did not follow changing search height');
  navigation.style.height = '';
  await wait(100);
  const toggleBounds = toggle.getBoundingClientRect();
  for (const child of toggle.children) {
    const bounds = child.getBoundingClientRect();
    assert(Math.abs((bounds.top + bounds.height / 2) - (toggleBounds.top + toggleBounds.height / 2)) < 2,
      'Metric caption, count and chevron are not on one row');
  }
  list.firstElementChild.click(); assert(selected === 2, 'Chip event handlers were lost');
  toggle.click(); assert(getComputedStyle(list).display === 'none', 'Collapsed metric chips are still visible');
  toggle.click(); assert(getComputedStyle(list).display !== 'none', 'Metric chips did not expand');
  for (const button of metricButtons) button.querySelector('.map-metric-label').textContent = 'Chỉ số với nhãn tiếng Việt dài cần xuống dòng để đọc đầy đủ';
  list.replaceChildren(...metricButtons);
  toggle.querySelector('.map-metric-count').textContent = String(metricButtons.length);
  await wait(50);
  const longBounds = floatingShell.querySelector('[data-template-slot="metrics"]').getBoundingClientRect();
  assert(longBounds.right <= panel.getBoundingClientRect().right + 1, 'Long metric labels overflow the map');
  assert(list.scrollWidth <= list.clientWidth + 1, 'Long metric labels require horizontal scrolling');
  assert(getComputedStyle(list.firstElementChild.querySelector('.map-metric-preview')).backgroundColor === 'rgb(224, 64, 160)', 'Chip data colors changed');
  list.replaceChildren(...metricButtons.slice(0, 3));
  for (const [index, label] of ['Ô nhiễm', 'Lượng mưa', 'Nhiệt độ'].entries()) list.children[index].querySelector('.map-metric-label').textContent = label;
  toggle.querySelector('.map-metric-count').textContent = '3';
  // Valid CSS can still create the oversized translucent panel from the reported screenshot.
  extraCss = '.slot-metrics{width:90%;max-width:none;background:#f9f8f3ee}.map-metric-list{padding-top:140px}';
  renderer.update({ hasData: true, capabilities: { mapTypes: ['point'], popupTypes: ['line'] } });
  for (let i = 0; i < 40 && !document.getElementById('map-template-status').textContent.includes('Không ghép'); i++) await wait(50);
  assert(document.getElementById('map-template-status').textContent.includes('sau khi tự điều chỉnh'), 'Persistent layout errors did not finish automatic correction');
  assert(repairRequests.at(-1).feedback.issue === 'metrics-coverage', 'AI did not receive oversized panel feedback');
  assert(notice.hidden && !notice.textContent, 'Layout error is displayed over the map');
  assert(renderer.getComposition()?.css === floatingCss, 'Rejected floating panel did not restore the previous template');
  assert(!document.getElementById('map-template-retry').hidden, 'Oversized floating panel cannot be retried');
  extraCss = '';
  renderer.update({ hasData: true, capabilities: { mapTypes: allMaps, popupTypes: ['line'] } });
  assert(renderer.getShell() && notice.hidden, 'Valid cached chip layout did not recover after rejecting an oversized panel');
  // A hidden panel should defer AI work until there is a real viewport.
  const originalWidth = panel.style.width;
  const beforeHidden = calls;
  panel.style.width = '0px';
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...floatingSource } } }));
  await wait(100);
  assert(calls === beforeHidden && !renderer.getShell(), 'Hidden panel requested a layout for a zero-sized viewport');
  panel.style.width = originalWidth;
  for (let i = 0; i < 80 && !renderer.getShell(); i++) await wait(50);
  assert(renderer.getShell() && document.getElementById('map-template-retry').hidden, 'Visible panel did not start deferred composition');
  // A responsive design may collapse only after the viewport changes.
  autoRepair = true;
  extraCss = '@container (max-width:320px){.slot-map{height:0}}';
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...floatingSource } } }));
  for (let i = 0; i < 80 && !renderer.getShell(); i++) await wait(50);
  const beforeResize = calls;
  panel.style.width = '300px';
  for (let i = 0; i < 80 && calls === beforeResize; i++) await wait(50);
  for (let i = 0; i < 80 && panel.hasAttribute('data-template-loading'); i++) await wait(50);
  assert(calls === beforeResize + 1 && renderer.getComposition()?.css === floatingCss,
    'Viewport change did not automatically repair the existing design');
  panel.style.width = originalWidth;
  await wait(100);
  // Resizing while the first AI request is pending must update the feedback
  // viewport as well, rather than asking AI to fix a mobile layout for desktop.
  responseGate = new Promise(resolve => { releaseResponse = resolve; });
  const beforePendingResize = calls;
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...floatingSource } } }));
  await wait(50);
  panel.style.width = '300px';
  releaseResponse(); responseGate = null;
  for (let i = 0; i < 80 && panel.hasAttribute('data-template-loading'); i++) await wait(50);
  assert(calls === beforePendingResize + 2 && renderer.getComposition()?.css === floatingCss,
    'Repair did not use the new viewport after resizing during AI generation');
  panel.style.width = originalWidth;
  await wait(100);
  // Ignore a repair reply if the dataset was removed while AI was correcting it.
  extraCss = '.slot-map{height:0}';
  let releaseRepair;
  repairGate = new Promise(resolve => { releaseRepair = resolve; });
  const beforeStaleRepair = repairRequests.length;
  document.getElementById('map-template-select').dispatchEvent(new CustomEvent('map-template-change', { detail: { source: { ...floatingSource } } }));
  for (let i = 0; i < 80 && repairRequests.length === beforeStaleRepair; i++) await wait(50);
  assert(repairRequests.length > beforeStaleRepair, 'Collapsed layout did not start repair before cancellation');
  renderer.update({ hasData: false, capabilities: { mapTypes: [], popupTypes: [] } });
  releaseRepair(); repairGate = null;
  await wait(100);
  assert(!renderer.getShell() && !panel.hasAttribute('data-template-loading'), 'Stale repair mounted a removed dataset');
  layerManager?.dispose(); realMap?.remove();
  return { ok: true, checks: ['hidden attribution wrappers', 'no static preview', 'basemap only with waiting notice', 'hidden default UI and thematic layers', 'preserved basemap navigation', 'restored data and controls after composition', 'seven AI buttons', 'preserved controls', 'native line and grouped bar charts', 'light and dark chart themes', 'compact date ticks and tooltip units', 'bar zoom and brush', 'missing observations and zero values', 'restore', 'mau_02 split layout', 'native CSS slot containment', 'readable legend colors', 'single legend frame', 'template cascade and pseudo-elements', 'hidden controls and data palette', 'basemap during recomposition', 'restore previous template', 'protected map geometry', 'measured automatic layout repair', 'bounded layout repair and rollback', 'invalid AI fallback', 'ignore stale response', 'compact floating metric chips', 'single-row metric heading', 'metric collapse and expand', 'long metric labels', 'responsive search and metric spacing', 'oversized floating panel rollback'] };
}

run().then(result => { document.getElementById('module-result').textContent = JSON.stringify(result); })
  .catch(error => { document.getElementById('module-result').textContent = JSON.stringify({ ok: false, error: error.message, stack: error.stack }); });

import 'maplibre-gl/dist/maplibre-gl.css';
import { initializeMapTemplatePicker } from '../../src/map-template-picker.js';
import { createAiPopupContent } from '../../src/shared/popup/ai-popup.js';
import { createInfoImagePopup } from '../../src/shared/popup/info-image-popup.js';
import { BarRenderer } from '../../src/charts/bar-chart.js';
import { LineRenderer } from '../../src/charts/line-chart.js';
import { mapTemplates } from './map-templates.js';

const result = document.getElementById('module-result');
const assert = (value, message) => { if (!value) throw new Error(message); };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const waitFor = async (test, message) => {
  const until = performance.now() + 10000;
  while (!test() && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 30));
  assert(test(), message);
};
const node = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text ? { textContent: text } : {}) });
const computed = (element, property) => getComputedStyle(element)[property];

try {
  const markup = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
  markup.querySelectorAll('script').forEach(element => element.remove());
  document.body.append(...markup.body.children);
  const content = document.querySelector('.content-area');
  const panel = document.querySelector('.map-panel');
  const select = document.getElementById('map-template-select');
  let templateCalls = 0; let fail = false;
  const picker = initializeMapTemplatePicker(document, async () => {
    templateCalls++;
    if (fail) throw new Error('Server không khả dụng');
    return { ok: true, json: async () => ({ templates: mapTemplates }) };
  });
  // Any accidentally introduced AI call fails this browser test.
  const originalFetch = window.fetch;
  let aiCalls = 0;
  window.fetch = (...args) => {
    if (String(args[0]).includes('/api/ai/')) { aiCalls++; throw new Error('Unexpected AI call'); }
    return originalFetch(...args);
  };
  await picker.ready;
  assert(select.value === '__auto__', 'AI mode was not the initial selection');
  select.value = '0'; select.dispatchEvent(new Event('change', { bubbles: true })); await frame();
  const analysis = { legend: [{ value: 0, color: '#0066ff' }, { value: 10, color: '#ff5500' }], popupSuggestions: ['info', 'info_image', 'bar', 'line'],
    search_bar: true, search_fields: ['name'], metricButtons: [{ field: 'value', label: 'Số liệu', icon: '✈', color: '#26aa66' }] };
  const before = JSON.stringify(analysis);
  const columns = [{ name: 'name', role: 'geo' }, { name: 'value', role: 'measure', unit: 'mm' }, { name: 'description', role: 'text' }];
  const feature = { properties: { name: 'Hà Nội', value: 150, description: 'Thông tin dữ liệu mẫu', __scope_reason: 'Ghi chú khu vực' } };
  const popups = [];
  function popup(child, extra = '') {
    const outer = node('div', `maplibregl-popup ai-weather-popup ai-map-popup ${extra}`);
    outer.style.cssText = 'position:relative;transform:none;display:block;margin:8px;';
    const container = node('div', 'maplibregl-popup-content');
    const close = node('button', 'maplibregl-popup-close-button', '×');
    container.append(child, close); outer.append(container); panel.append(outer); popups.push(outer);
    return outer;
  }
  const info = createAiPopupContent(document, feature, columns, 'name');
  popup(info);
  const image = createInfoImagePopup(document, { sources: [{ records: [feature.properties], columns,
    popupContent: { titleField: 'name', imageFields: [], descriptionFields: ['description'], addressFields: [], linkFields: [] } }], title: 'Hà Nội', coordinates: [105, 21] });
  popup(image, 'has-info-image');
  const charts = [];
  for (const renderer of [BarRenderer, LineRenderer]) {
    const card = node('div', 'weather-popup ai-popup-chart-only');
    const host = node('div', 'ai-popup-chart'); card.append(host); popup(card);
    const config = { xField: 'day', title: 'Dữ liệu theo ngày', unit: 'mm', series: [{ key: 'value', label: 'Lượng mưa', color: '#cc3366' }],
      data: [{ day: '2026-01-01', value: 10 }, { day: '2026-01-02', value: 20 }], showDataLabels: true, animate: false };
    renderer.render(host, config); charts.push(host);
  }
  await waitFor(() => charts.every(host => host.querySelector('.recharts-cartesian-axis-tick-value')), 'Charts did not render');
  const lineSurface = charts[1].querySelector('.recharts-wrapper > svg');
  lineSurface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await waitFor(() => charts[1].querySelector('.recharts-tooltip-wrapper > div'), 'Line tooltip did not open');
  const chartNodes = charts.map(host => host.firstElementChild);
  const swatch = node('i', ''); swatch.style.background = analysis.legend[0].color;
  const legend = document.querySelector('.weather-legend'); legend.hidden = false;
  const row = node('div', 'categorical-legend-row'); row.append(swatch, node('span', '', 'Mức thấp')); legend.append(row);
  const legendScale = legend.querySelector('.weather-legend-scale');
  legendScale.style.background = 'linear-gradient(90deg, #0066ff, #ff5500)';
  const metricControl = document.getElementById('map-metric-control'); metricControl.hidden = false;
  const metric = node('button', 'map-metric-button active');
  const label = node('span', 'map-metric-label', 'Số liệu');
  const icon = node('span', 'map-metric-preview', analysis.metricButtons[0].icon);
  icon.style.setProperty('--metric-color', analysis.metricButtons[0].color); metric.append(label, icon); metricControl.append(metric);
  const input = document.getElementById('map-search-input'); input.disabled = false; input.value = 'Hà Nội';
  document.getElementById('map-search').hidden = false;
  const searchResults = document.getElementById('map-search-results'); searchResults.hidden = false;
  const searchResult = node('button', 'map-search-result'); searchResult.append(node('b', '', 'Hà Nội'), node('small', '', 'Việt Nam')); searchResults.append(searchResult);
  const originalGradient = legendScale.style.background;
  const originalIcon = icon.style.cssText;
  const originalSwatch = swatch.style.background;
  const seriesColor = () => charts.map(host => [...host.querySelectorAll('.recharts-bar-rectangle path, .recharts-line-curve')].map(path => [path.getAttribute('fill'), path.getAttribute('stroke')]));
  const originalSeries = JSON.stringify(seriesColor());
  const checks = [];
  function checkTheme(theme) {
    const dark = theme === 'dark';
    const background = dark ? 'rgb(28, 28, 38)' : 'rgb(255, 255, 255)';
    const text = dark ? 'rgb(229, 231, 235)' : 'rgb(34, 34, 34)';
    const muted = dark ? 'rgb(135, 144, 163)' : 'rgb(102, 102, 102)';
    for (const element of [...popups.map(p => p.firstElementChild), legend, searchResults]) {
      assert(computed(element, 'backgroundColor') === background, `${theme} surface: ${element.className}: ${computed(element, 'backgroundColor')}`);
      assert(computed(element, 'color') === text, `${theme} text: ${element.className}`);
      assert(computed(element, 'borderRadius') === (dark ? '14px' : '10px'), `${theme} radius: ${element.className}`);
    }
    assert(computed(info, 'fontSize') === (dark ? '15px' : '14px'), 'Popup size not from server');
    assert(computed(info, 'fontFamily').includes(dark ? 'Georgia' : 'Arial'), 'Popup font not from server');
    const bodyFont = dark ? 'Georgia' : 'Arial';
    const headingFont = dark ? 'Verdana' : 'Merriweather';
    for (const element of [info.querySelector('.popup-info-heading > strong'), image.querySelector('h2'), legend.querySelector('strong'), ...charts.map(host => host.querySelector('h2'))]) {
      assert(computed(element, 'fontFamily').includes(headingFont), `Heading font not from server: ${element.className || element.tagName}`);
    }
    for (const element of [info.querySelector('dd'), info.querySelector('.popup-scope-note'), image.querySelector('p'), input, metric, searchResult, ...popups.map(outer => outer.querySelector('button')), ...charts.map(host => host.querySelector('.bar-chart-heading p'))]) {
      assert(computed(element, 'fontFamily').includes(bodyFont), `Body/control font not from server: ${element.className || element.tagName}`);
    }
    assert(computed(info.querySelector('dd'), 'color') === text, 'Popup field kept hardcoded color');
    assert(computed(image.querySelector('h2'), 'color') === text, 'Image heading kept hardcoded color');
    assert(computed(searchResult.querySelector('b'), 'color') === text, 'Search result text kept hardcoded color');
    for (const host of charts) {
      assert(computed(host.querySelector('.bar-chart-card'), 'backgroundColor') === background, 'Chart card kept hardcoded surface');
      const tick = host.querySelector('.recharts-cartesian-axis-tick-value');
      assert(computed(tick, 'fill') === muted, `Chart axis color: ${computed(tick, 'fill')}`);
      assert(computed(tick, 'fontSize') === '12px', 'Chart axis size not from server');
      const tooltip = host.querySelector('.recharts-tooltip-wrapper > div');
      assert(tooltip && computed(tooltip, 'backgroundColor') === background, 'Chart tooltip kept hardcoded surface');
      assert(computed(tooltip, 'color') === text && computed(tooltip, 'fontSize') === '12px', 'Chart tooltip ignored template typography');
    }
    checks.push(theme);
  }
  checkTheme('light');
  select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); await frame();
  checkTheme('dark');
  assert(charts.every((host, index) => host.firstElementChild === chartNodes[index]), 'Theme switch remounted charts');
  assert(JSON.stringify(seriesColor()) === originalSeries, 'Theme changed chart data colors');
  assert(legendScale.style.background === originalGradient && swatch.style.background === originalSwatch, 'Theme changed legend colors');
  assert(icon.style.cssText === originalIcon && icon.textContent === '✈', 'Theme changed AI icon/color');
  assert(input.value === 'Hà Nội' && metric.classList.contains('active'), 'Theme reset user selection');
  assert(JSON.stringify(analysis) === before && templateCalls === 1 && aiCalls === 0, 'Theme changed AI decisions or made a request');
  // Simulate newly attached group/layer overlays and a basemap canvas replacement.
  const newLayer = node('div', 'layer-legends'); const newLegend = legend.cloneNode(true); newLayer.append(newLegend); document.querySelector('.map-legends').append(newLayer);
  document.getElementById('map').replaceChildren(node('canvas', 'maplibregl-canvas'));
  assert(computed(newLegend, 'backgroundColor') === 'rgb(28, 28, 38)', 'New layer lost the active template');
  assert(computed(newLegend.querySelector('strong'), 'fontFamily').includes('Verdana'), 'New legend lost the active heading font');
  fail = true; await picker.load();
  assert(content.dataset.templateTheme === 'dark' && !document.getElementById('map-template-retry').hidden, 'Failed refresh discarded active theme');
  // Narrow viewport/container: popup width remains bounded and text stays readable.
  content.style.width = '360px'; panel.style.width = '360px';
  panel.style.setProperty('--popup-map-width', '328px');
  await frame();
  for (const outer of popups) assert(outer.getBoundingClientRect().width <= 360, 'Popup overflow at small size');
  select.value = '0'; select.dispatchEvent(new Event('change', { bubbles: true })); await frame(); checkTheme('light');
  result.textContent = JSON.stringify({ ok: true, checks, popupTypes: ['info', 'info_image', 'bar', 'line'], templateCalls, aiCalls, preservedDataColors: true, dynamicLayers: true, smallContainer: true });
} catch (error) {
  result.textContent = JSON.stringify({ ok: false, error: error.message, stack: error.stack });
}

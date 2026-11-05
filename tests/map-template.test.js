import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapTemplate, mapTemplateVariables } from '../src/shared/ui/map-template-config.js';
import { initializeMapTemplatePicker } from '../src/map-template-picker.js';
import { mapTemplates } from './fixtures/map-templates.js';

function pickerDocument() {
  class Element extends EventTarget {
    constructor() { super(); this.value = ''; this.dataset = {}; this.children = []; this.style = { setProperty: (key, value) => { this.styles[key] = value; } }; this.styles = {}; }
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const elements = Object.fromEntries(['map-template-select', 'map-template-status', 'map-template-retry'].map(id => [id, new Element()]));
  const content = new Element();
  return { elements, content, createElement: () => new Element(), querySelector: () => content, getElementById: id => elements[id] };
}

test('complete authored values are retained; data colors and arbitrary properties are excluded', () => {
  const template = normalizeMapTemplate({ ...mapTemplates[1], legend: { color: '#000000' }, css: 'untrusted CSS' });
  assert.deepEqual(template, mapTemplates[1]);
  const variables = mapTemplateVariables(template);
  assert.equal(variables['--template-background'], '#1C1C26');
  assert.equal(variables['--template-font'], 'Georgia, serif');
  assert.equal(variables['--template-heading-font'], 'Verdana, sans-serif');
  assert.equal(variables['--template-popup-size'], '15px');
  assert.ok(Object.keys(variables).every(key => key.startsWith('--template-')));
  assert.ok(!Object.keys(variables).some(key => /metric-color|legend-gradient/.test(key)));
});

test('older templates without a heading font inherit the body font', () => {
  const legacy = structuredClone(mapTemplates[0]);
  delete legacy.typography.headingFontFamily;
  const template = normalizeMapTemplate(legacy);
  assert.equal(template.typography.headingFontFamily, legacy.typography.fontFamily);
  assert.equal(mapTemplateVariables(template)['--template-heading-font'], legacy.typography.fontFamily);
});

test('metadata-only, incomplete and unsafe templates are rejected before application', () => {
  const metadata = { id: 'vnexpress', theme: 'light', name: 'Light', description: 'Metadata only' };
  assert.throws(() => normalizeMapTemplate(metadata), /thiếu cấu hình/);
  for (const mutate of [
    x => { delete x.typography.sizes.popup; },
    x => { x.styles.colors.text = 'url(https://example.com)'; },
    x => { x.typography.fontFamily = 'Arial; color: red'; },
    x => { x.typography.headingFontFamily = 'Georgia; color: red'; },
    x => { x.typography.headingFontFamily = ''; },
    x => { x.typography.headingFontFamily = null; },
    x => { x.typography.headingFontFamily = 'A'.repeat(241); },
    x => { x.typography.sizes.label = '-12px'; },
    x => { x.typography.weights.bold = 42; },
    x => { x.typography.lineHeight = NaN; },
    x => { x.styles.layout.borderRadius = 'var(--bad)'; },
    x => { x.styles.layout.shadow = 'url(https://example.com)'; }
  ]) {
    const candidate = structuredClone(mapTemplates[0]); mutate(candidate);
    assert.throws(() => normalizeMapTemplate(candidate));
  }
});

test('picker defaults to AI, allows manual themes and preserves last valid state on retry failure', async () => {
  const document = pickerDocument();
  const { elements, content } = document;
  let calls = 0; let payload = { templates: mapTemplates };
  const picker = initializeMapTemplatePicker(document, async () => { calls++; return { ok: true, json: async () => payload }; });
  await picker.ready;
  assert.equal(elements['map-template-select'].value, '__auto__');
  assert.equal(elements['map-template-select'].children[0].textContent, 'AI đề xuất theo kiểu bản đồ');
  elements['map-template-select'].value = '0';
  elements['map-template-select'].dispatchEvent(new Event('change'));
  assert.equal(content.dataset.templateTheme, 'light');
  assert.equal(content.dataset.templateReady, 'true');
  assert.equal(elements['map-template-select'].children[1].textContent, mapTemplates[0].name);
  content.style.setProperty('--metric-color', '#123456');
  elements['map-template-select'].value = '1';
  elements['map-template-select'].dispatchEvent(new Event('change'));
  assert.equal(calls, 1);
  assert.equal(content.dataset.templateTheme, 'dark');
  assert.equal(content.styles['--template-popup-size'], '15px');
  assert.equal(content.styles['--template-heading-font'], 'Verdana, sans-serif');
  assert.equal(content.styles['--metric-color'], '#123456');
  const previous = structuredClone(content.styles);
  payload = { templates: [{ id: '../invalid', name: 'Invalid' }] };
  await picker.load();
  assert.deepEqual(content.styles, previous);
  assert.equal(content.dataset.templateTheme, 'dark');
  assert.equal(elements['map-template-retry'].hidden, false);
  assert.equal(elements['map-template-select'].disabled, false);
  assert.match(elements['map-template-status'].textContent, /không hợp lệ/);
  payload = { templates: mapTemplates.toReversed() };
  await picker.load();
  assert.equal(elements['map-template-select'].value, '0');
  assert.equal(content.dataset.templateTheme, 'dark');
  assert.equal(elements['map-template-retry'].hidden, true);
});

test('initial network failure never marks a template applied and allows retry', async () => {
  const document = pickerDocument(); let fail = true;
  const picker = initializeMapTemplatePicker(document, async () => {
    if (fail) throw new Error('Mất kết nối');
    return { ok: true, json: async () => ({ templates: mapTemplates }) };
  });
  await picker.ready;
  assert.equal(document.content.dataset.templateReady, undefined);
  assert.equal(document.elements['map-template-select'].disabled, true);
  assert.equal(document.elements['map-template-retry'].hidden, false);
  fail = false;
  await picker.load();
  assert.equal(document.elements['map-template-select'].value, '__auto__');
  document.elements['map-template-select'].value = '0';
  document.elements['map-template-select'].dispatchEvent(new Event('change'));
  assert.equal(document.content.dataset.templateReady, 'true');
  assert.equal(document.elements['map-template-select'].disabled, false);
});

test('picker loads mau_01 source from the detail endpoint without applying or executing it', async () => {
  const document = pickerDocument();
  const source = { template: 'mau_01', html: '<main id="map"></main>', css: '#map {}', js: 'throw new Error("must not execute")' };
  const calls = [];
  const picker = initializeMapTemplatePicker(document, async url => {
    calls.push(url);
    return { ok: true, json: async () => url === '/api/map-templates'
      ? { templates: [{ id: 'mau_01', name: 'Bản đồ mẫu 01' }] } : source };
  });
  await picker.ready;
  assert.deepEqual(calls, ['/api/map-templates']);
  document.elements['map-template-select'].value = '0';
  document.elements['map-template-select'].dispatchEvent(new Event('change'));
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['/api/map-templates', '/api/map-templates/mau_01']);
  assert.deepEqual(picker.getSelectedSource(), source);
  assert.equal(document.content.dataset.templateReady, undefined);
  assert.match(document.elements['map-template-status'].textContent, /chưa áp dụng/);
});

test('AI mode selects by map type, preserves manual choice, and reselects when restored', async () => {
  const document = pickerDocument();
  const catalog = [
    { id: 'mau_01', name: 'Mẫu 01', navigation: 'pan_zoom', description: 'Bản đồ 2D' },
    { id: 'mau_02', name: 'Mẫu 02', navigation: 'rotate_3d', description: 'Arc Flow sáng' },
    { id: 'mau_03', name: 'Mẫu 03', navigation: 'rotate_3d', description: 'Arc Flow tối' }
  ];
  const recommendations = [];
  const sources = [];
  const picker = initializeMapTemplatePicker(document, async (url, options) => {
    if (url === '/api/map-templates') return { ok: true, json: async () => ({ templates: catalog }) };
    if (url === '/api/ai/recommend-map-template') {
      const body = JSON.parse(options.body);
      recommendations.push(body);
      return { ok: true, json: async () => ({ templateId: body.mapTypes.includes('arc_flow') ? 'mau_03' : 'mau_01' }) };
    }
    sources.push(url);
    const id = url.split('/').at(-1);
    return { ok: true, json: async () => ({ template: id, html: '<main></main>', css: 'main{}', js: 'void 0' }) };
  });
  await picker.ready;
  assert.equal(document.elements['map-template-select'].value, '__auto__');
  assert.deepEqual(recommendations, []);
  picker.updateContext({ hasData: true, groupId: 'a', mapTypes: ['point'], popupTypes: [], layerCount: 1 });
  await new Promise(setImmediate);
  assert.equal(picker.getSelectedSource().template, 'mau_01');
  assert.deepEqual(recommendations[0].mapTypes, ['point']);
  picker.updateContext({ hasData: true, groupId: 'a', mapTypes: ['point', 'arc_flow'], popupTypes: ['info'], layerCount: 2 });
  await new Promise(setImmediate);
  assert.equal(picker.getSelectedSource().template, 'mau_03');
  assert.deepEqual(recommendations[1].mapTypes, ['point', 'arc_flow']);
  document.elements['map-template-select'].value = '1';
  document.elements['map-template-select'].dispatchEvent(new Event('change'));
  await new Promise(setImmediate);
  picker.updateContext({ hasData: true, groupId: 'b', mapTypes: ['choropleth'], popupTypes: [], layerCount: 1 });
  await new Promise(setImmediate);
  assert.equal(picker.getSelectedSource().template, 'mau_02');
  assert.equal(recommendations.length, 2);
  document.elements['map-template-select'].value = '__auto__';
  document.elements['map-template-select'].dispatchEvent(new Event('change'));
  await new Promise(setImmediate);
  assert.equal(picker.getSelectedSource().template, 'mau_01');
  assert.equal(document.elements['map-template-select'].value, '__auto__');
  assert.equal(sources.filter(item => item.endsWith('/mau_01')).length, 1);
});

test('stale AI result cannot override manual selection; missing group keeps the native map', async () => {
  const document = pickerDocument();
  let release;
  const picker = initializeMapTemplatePicker(document, async url => {
    if (url === '/api/map-templates') return { ok: true, json: async () => ({ templates: [
      { id: 'mau_01', name: '2D', navigation: 'pan_zoom' },
      { id: 'mau_02', name: 'Mẫu khác', navigation: 'pan_zoom' }
    ] }) };
    if (url === '/api/ai/recommend-map-template') return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ templateId: 'mau_01' }) }); });
    const id = url.split('/').at(-1);
    return { ok: true, json: async () => ({ template: id, html: '<main></main>', css: 'main{}', js: 'void 0' }) };
  });
  await picker.ready;
  picker.updateContext({ hasData: true, groupId: 'a', mapTypes: ['point'], popupTypes: [], layerCount: 1 });
  document.elements['map-template-select'].value = '1';
  document.elements['map-template-select'].dispatchEvent(new Event('change'));
  release();
  await new Promise(setImmediate);
  assert.equal(picker.getSelectedSource().template, 'mau_02');
  document.elements['map-template-select'].value = '__auto__';
  document.elements['map-template-select'].dispatchEvent(new Event('change'));
  picker.updateContext({ hasData: true, groupId: 'a', mapTypes: ['arc_flow'], popupTypes: [], layerCount: 1 });
  await new Promise(setImmediate);
  assert.equal(picker.getSelectedSource(), null);
  assert.match(document.elements['map-template-status'].textContent, /Chưa có template phù hợp/);
});

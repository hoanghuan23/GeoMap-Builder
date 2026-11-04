import { normalizeTemplateCapabilities, normalizeTemplateComposition, TEMPLATE_SLOTS } from './map-template-composition-contract.js';
import { mountTemplateChartFrame } from './map-template-component-frame.js';

const SLOT_NODES = {
  map: '#map', search: '.map-query-panel', metrics: '.workspace-metrics', legend: '.map-legends',
  controls: '.map-controls', attribution: '.map-attribution', status: '#status'
};
const ALLOWED_TAGS = new Set(['DIV', 'SECTION', 'MAIN', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'H1', 'H2', 'H3', 'EM', 'I', 'BR', 'SPAN', 'STRONG', 'SMALL', 'P', 'UL', 'LI',
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g']);
const ALLOWED_ATTRIBUTES = new Set(['class', 'data-template-slot', 'role', 'aria-label', 'aria-hidden', 'title',
  'viewBox', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'width', 'height',
  'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2']);

function safeLayout(document, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const node of [...template.content.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(node.tagName)) throw new Error(`Template chứa phần tử không được hỗ trợ: ${node.tagName}.`);
    for (const attribute of [...node.attributes]) {
      const safeColor = !['fill', 'stroke'].includes(attribute.name)
        || /^(?:none|currentColor|transparent|inherit|#[\da-f]{3,8})$/i.test(attribute.value);
      if (!ALLOWED_ATTRIBUTES.has(attribute.name) || !safeColor) node.removeAttribute(attribute.name);
    }
  }
  for (const slot of TEMPLATE_SLOTS) {
    if (template.content.querySelectorAll(`[data-template-slot="${slot}"]`).length !== 1)
      throw new Error(`Template thiếu vị trí ${slot}.`);
  }
  return template.content;
}

function validateCss(document, css) {
  if (document.defaultView?.CSSStyleSheet) {
    const sheet = new document.defaultView.CSSStyleSheet();
    sheet.replaceSync(`@scope (.map-template-shell) { ${css} }`);
    if (sheet.cssRules.length !== 1 || sheet.cssRules[0].constructor.name !== 'CSSScopeRule')
      throw new Error('CSS template vượt ra ngoài vùng bản đồ.');
  }
}

export function createMapTemplateRenderer({ document, map, picker, fetchImpl = globalThis.fetch }) {
  const panel = document.querySelector('.map-panel');
  const content = document.querySelector('.content-area');
  const status = document.getElementById('map-template-status');
  const retryButton = document.getElementById('map-template-retry');
  const notice = document.createElement('div');
  notice.className = 'map-template-fallback-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.hidden = true;
  panel.append(notice);
  const cache = new WeakMap();
  const anchors = new Map();
  let source = null;
  let shell = null;
  let current = null;
  let capabilities = { mapTypes: [], popupTypes: [] };
  let hasData = false;
  let revision = 0;
  let pending = '';
  let failedKey = '';

  function showFallback(message = '') {
    notice.hidden = !message;
    notice.textContent = message;
  }

  function failedMessage(error) {
    return `Mẫu ${source.template} chưa áp dụng. ${shell ? 'Đang giữ giao diện đã áp dụng trước đó.' : 'Đang hiển thị bản đồ gốc.'} ${error.message}`;
  }

  function unmount() {
    if (!shell) return;
    for (const [node, anchor] of anchors) anchor.replaceWith(node);
    anchors.clear();
    shell.remove(); shell = null; current = null;
    delete content.dataset.templateRendered;
    map.resize();
  }

  function mount(composition) {
    const layout = safeLayout(document, composition.html);
    validateCss(document, composition.css);
    const next = document.createElement('div');
    next.className = 'map-template-shell';
    const style = document.createElement('style');
    style.textContent = `@scope (.map-template-shell) { ${composition.css} }`;
    next.append(style, layout);
    const nodes = Object.fromEntries(Object.entries(SLOT_NODES).map(([name, selector]) => [name, panel.querySelector(selector)]));
    if (Object.values(nodes).some(node => !node)) throw new Error('Không tìm thấy thành phần bản đồ để ghép mẫu.');
    unmount();
    panel.append(next);
    for (const [name, node] of Object.entries(nodes)) {
      const anchor = document.createComment(`template:${name}`);
      node.before(anchor); anchors.set(node, anchor);
      next.querySelector(`[data-template-slot="${name}"]`).append(node);
    }
    shell = next; current = composition;
    content.dataset.templateRendered = 'true';
    map.resize();
  }

  async function compose() {
    if (!source || !hasData || !capabilities.mapTypes.length) return;
    const cap = normalizeTemplateCapabilities(capabilities);
    const key = JSON.stringify(cap);
    if (pending === key || failedKey === key) return;
    const cached = cache.get(source)?.get(key);
    if (cached) {
      try {
        if (current !== cached) mount(cached);
        status.textContent = `Đã áp dụng mẫu ${source.template}.`;
        showFallback();
        if (retryButton) retryButton.hidden = true;
      } catch (error) {
        failedKey = key;
        status.textContent = `Không ghép được mẫu ${source.template}: ${error.message}`;
        showFallback(failedMessage(error));
        if (retryButton) retryButton.hidden = false;
      }
      return;
    }
    const requestRevision = ++revision;
    pending = key;
    status.textContent = `AI đang ghép mẫu ${source.template} với bản đồ…`;
    showFallback(shell ? '' : `Đang ghép mẫu ${source.template}. Tạm hiển thị bản đồ gốc.`);
    if (retryButton) retryButton.hidden = true;
    try {
      const response = await fetchImpl('/api/ai/compose-map-template', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: source.template, capabilities: cap }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || `AI HTTP ${response.status}`);
      if (result?.templateId !== source.template) throw new Error('AI trả về sai mẫu giao diện.');
      const composition = normalizeTemplateComposition(result.composition, cap);
      const layout = safeLayout(document, composition.html);
      if (!layout || !result.sourceHash) throw new Error('AI trả về mẫu không hợp lệ.');
      validateCss(document, composition.css);
      if (requestRevision !== revision || !hasData) return;
      failedKey = '';
      let variants = cache.get(source);
      if (!variants) { variants = new Map(); cache.set(source, variants); }
      variants.set(key, composition);
      mount(composition);
      status.textContent = `Đã áp dụng mẫu ${source.template}.`;
      showFallback();
    } catch (error) {
      if (requestRevision === revision) {
        failedKey = key;
        status.textContent = `Không ghép được mẫu ${source.template}: ${error.message}`;
        showFallback(failedMessage(error));
        if (retryButton) retryButton.hidden = false;
      }
    } finally { if (requestRevision === revision) pending = ''; }
  }

  function select(next) {
    ++revision; pending = ''; failedKey = '';
    source = next?.source || null;
    unmount();
    showFallback();
    if (!source) return;
    if (retryButton) retryButton.hidden = true;
    if (!hasData) status.textContent = `Đã tải mẫu ${source.template}; chờ dữ liệu để render.`;
    else void compose();
  }

  function update(next) {
    const previous = JSON.stringify(capabilities);
    hasData = Boolean(next?.hasData);
    capabilities = normalizeTemplateCapabilities(next?.capabilities);
    if (previous !== JSON.stringify(capabilities)) failedKey = '';
    if (!hasData) {
      ++revision; pending = ''; unmount();
      showFallback();
      if (source) status.textContent = `Đã tải mẫu ${source.template}; chờ dữ liệu để render.`;
      return;
    }
    if (source && (!shell || previous !== JSON.stringify(capabilities))) void compose();
  }

  const selectElement = document.getElementById('map-template-select');
  selectElement.addEventListener('map-template-change', event => select(event.detail));
  picker?.ready?.then(() => { if (!source) select({ source: picker.getSelectedSource() }); });
  function renderChart({ kind, container, chart, fallback }) {
    if (!shell || !current) return null;
    const component = current.components.find(item => item.kind === kind);
    return component ? mountTemplateChartFrame({ document, container, component, chart, fallback }) : null;
  }

  return { update, unmount, renderChart, getComposition: () => current, getShell: () => shell };
}

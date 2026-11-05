import { normalizeTemplateCapabilities, normalizeTemplateComposition, normalizeTemplateLayoutContext, TEMPLATE_SLOTS } from './map-template-composition-contract.js';
import { createMapProcessingStatus, MAP_PROCESSING_MESSAGE } from './shared/ui/map-processing-status.js';

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

function compositionStyles(document, css) {
  validateCss(document, css);
  const sheet = new document.defaultView.CSSStyleSheet();
  sheet.replaceSync(`@scope (.map-template-shell) { ${css} }`);
  const scope = sheet.cssRules[0];
  function adapt(rules) {
    for (const rule of rules) {
      // Nest selectors at the shell so template rules outrank legacy control CSS.
      // Keep root variables and pseudo-elements working inside the nested rule.
      if (rule.selectorText) rule.selectorText = rule.selectorText
        .replace(/\.map-template-shell\b|:scope\b/g, '&');
      if (rule.cssRules && rule.constructor.name !== 'CSSKeyframesRule') adapt(rule.cssRules);
    }
  }
  adapt(scope.cssRules);
  return `@scope (.map-template-shell) { :scope:not(#map-template-native-styles) {
    ${[...scope.cssRules].map(rule => rule.cssText).join('\n')}
  } }`;
}

export function createMapTemplateRenderer({ document, map, picker, fetchImpl = globalThis.fetch, onLoadingChange = () => {},
  processingStatus = createMapProcessingStatus(document.getElementById('status')) }) {
  const panel = document.querySelector('.map-panel');
  const content = document.querySelector('.content-area');
  const status = document.getElementById('map-template-status');
  const retryButton = document.getElementById('map-template-retry');
  const cache = new WeakMap();
  const failedCompositions = new Set();
  const anchors = new Map();
  let source = null;
  let shell = null;
  let current = null;
  let capabilities = { mapTypes: [], popupTypes: [] };
  let hasData = false;
  let revision = 0;
  let pending = '';
  let failedKey = '';
  let finishLoading;
  let appliedViewport = '';
  const layoutObserver = document.defaultView?.ResizeObserver ? new document.defaultView.ResizeObserver(() => {
    if (panel.hasAttribute('data-template-loading')) return;
    if (!shell) { if (source && hasData) void compose(); return; }
    fitFloatingMetrics(shell);
    const viewport = JSON.stringify(layoutContext().viewport);
    if (viewport !== appliedViewport && panel.clientWidth > 0 && panel.clientHeight > 0) {
      map.resize();
      try { validateMapLayout(shell); appliedViewport = viewport; }
      catch (error) {
        if (error.layoutFeedback) void compose({ repair: { layout: current, feedback: error.layoutFeedback } });
      }
    }
  }) : null;

  function layoutContext() {
    const visible = node => node && !node.closest('[hidden]');
    const buttons = [...panel.querySelectorAll('.map-metric-button')].filter(node => visible(node.closest('.map-metric-control')));
    const legends = [...panel.querySelectorAll('.layer-legends > *')].filter(visible);
    const input = panel.querySelector('.map-search-form input');
    return normalizeTemplateLayoutContext({
      viewport: { width: panel.clientWidth, height: panel.clientHeight },
      metrics: { count: buttons.length, labels: buttons.map(node => node.querySelector('.map-metric-label')?.textContent.trim()) },
      legends: { count: legends.length, titles: legends.map(node => node.querySelector('strong')?.textContent.trim()) },
      search: { enabled: Boolean(visible(input)), placeholder: input?.placeholder,
        hasRegionNavigation: Boolean(visible(panel.querySelector('.map-region-navigation'))) }
    });
  }

  function fitFloatingMetrics(next) {
    const metrics = next.querySelector('[data-template-slot="metrics"]');
    const search = next.querySelector('[data-template-slot="search"]');
    if (metrics.hasAttribute('data-template-adjusted-top')) {
      metrics.style.removeProperty('top');
      metrics.removeAttribute('data-template-adjusted-top');
    }
    const style = document.defaultView.getComputedStyle(metrics);
    const top = parseFloat(style.top);
    // getComputedStyle resolves an auto bottom to pixels for absolute boxes;
    // Typed OM retains the authored anchoring needed here.
    const bottom = metrics.computedStyleMap?.().get('bottom')?.toString() ?? style.bottom;
    // Only move top-anchored floating controls. Grid/sidebar layout and
    // controls anchored to the bottom keep the template's own placement.
    if (style.position !== 'absolute' || bottom !== 'auto' || !Number.isFinite(top)) return;
    const bounds = metrics.getBoundingClientRect();
    const query = search.getBoundingClientRect();
    const mapBounds = next.querySelector('[data-template-slot="map"]').getBoundingClientRect();
    const insideMap = bounds.right > mapBounds.left && bounds.left < mapBounds.right
      && bounds.bottom > mapBounds.top && bounds.top < mapBounds.bottom;
    const overlapsSearch = query.width > 0 && query.height > 0 && bounds.right > query.left
      && bounds.left < query.right && bounds.top < query.bottom && bounds.bottom > query.top;
    if (insideMap && overlapsSearch) {
      metrics.style.setProperty('top', `${top + query.bottom - bounds.top + 8}px`, 'important');
      metrics.setAttribute('data-template-adjusted-top', '');
    }
  }

  function setLoading(loading) {
    if (panel.hasAttribute('data-template-loading') === loading) return;
    panel.toggleAttribute('data-template-loading', loading);
    panel.setAttribute('aria-busy', String(loading));
    if (loading) finishLoading = processingStatus.begin();
    else { finishLoading?.(); finishLoading = null; }
    onLoadingChange(loading);
  }

  function unmount() {
    layoutObserver?.disconnect();
    layoutObserver?.observe(panel);
    if (!shell) return;
    for (const [node, anchor] of anchors) anchor.replaceWith(node);
    anchors.clear();
    shell.remove(); shell = null; current = null;
    delete content.dataset.templateRendered;
    map.resize();
  }

  function validateMapLayout(next) {
    const mapNode = next.querySelector('[data-template-slot="map"] > #map');
    const bounds = mapNode.getBoundingClientRect();
    const fail = (issue, message) => {
      const measure = (node, name) => {
        const rect = node.getBoundingClientRect();
        const style = document.defaultView.getComputedStyle(node);
        return { name, width: rect.width, height: rect.height, display: style.display, position: style.position };
      };
      const ancestors = [];
      for (let node = mapNode.parentElement; node && node !== panel && ancestors.length < 12; node = node.parentElement)
        ancestors.push(measure(node, node.className || node.tagName));
      const error = new Error(message);
      error.layoutFeedback = { issue, slots: TEMPLATE_SLOTS.map(slot => measure(next.querySelector(`[data-template-slot="${slot}"]`), slot)), ancestors };
      throw error;
    };
    if (bounds.width < 1 || bounds.height < 1)
      fail('map-size', 'Vùng bản đồ trong bố cục AI đang có kích thước bằng 0.');
    for (let node = mapNode; node && node !== panel; node = node.parentElement) {
      const style = document.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
        fail('map-hidden', 'CSS của bố cục AI đang ẩn vùng bản đồ.');
    }
    const canvas = map.getCanvas?.();
    if (canvas && (!canvas.isConnected || canvas.clientWidth < 1 || canvas.clientHeight < 1))
      fail('canvas-size', 'Canvas bản đồ chưa hiển thị đúng trong bố cục AI.');
    const metrics = next.querySelector('[data-template-slot="metrics"]').getBoundingClientRect();
    const overlapWidth = Math.max(0, Math.min(bounds.right, metrics.right) - Math.max(bounds.left, metrics.left));
    const overlapHeight = Math.max(0, Math.min(bounds.bottom, metrics.bottom) - Math.max(bounds.top, metrics.top));
    // A sidebar outside the map is unrestricted. A wide floating strip must
    // leave the map readable; mobile chips need more room to wrap.
    const maxCoverage = bounds.width <= 600 ? 0.3 : 0.15;
    if (overlapWidth > bounds.width * 0.6 && overlapWidth * overlapHeight > bounds.width * bounds.height * maxCoverage)
      fail('metrics-coverage', 'Khối chỉ số nổi đang che quá nhiều vùng bản đồ; cần thu gọn hoặc chuyển sang vùng riêng.');
  }

  function mount(composition) {
    const layout = safeLayout(document, composition.html);
    const next = document.createElement('div');
    next.className = 'map-template-shell';
    const style = document.createElement('style');
    style.textContent = compositionStyles(document, composition.css);
    next.append(style, layout);
    const nodes = Object.fromEntries(Object.entries(SLOT_NODES).map(([name, selector]) => [name, panel.querySelector(selector)]));
    if (Object.values(nodes).some(node => !node)) throw new Error('Không tìm thấy thành phần bản đồ để ghép mẫu.');
    const previous = current;
    unmount();
    panel.append(next);
    for (const [name, node] of Object.entries(nodes)) {
      const anchor = document.createComment(`template:${name}`);
      node.before(anchor); anchors.set(node, anchor);
      next.querySelector(`[data-template-slot="${name}"]`).append(node);
    }
    if (nodes.attribution.hidden) {
      // A template can frame the slot with several padded/background wrappers.
      // Hide the entire dedicated frame, stopping at any shared control layout.
      let frame = next.querySelector('[data-template-slot="attribution"]');
      while (frame.parentElement !== next && frame.parentElement.querySelectorAll('[data-template-slot]').length === 1)
        frame = frame.parentElement;
      frame.hidden = true;
      frame.style.setProperty('display', 'none', 'important');
    }
    shell = next; current = composition;
    content.dataset.templateRendered = 'true';
    try {
      // A positioned slot keeps the existing absolute MapLibre container inside its map region.
      const mapSlot = next.querySelector('[data-template-slot="map"]');
      if (document.defaultView.getComputedStyle(mapSlot).position === 'static') mapSlot.style.position = 'relative';
      map.resize();
      // Measure the controls at their visible size. They stay hidden by the
      // loading rule otherwise, which can make a huge floating card look empty.
      const loading = panel.hasAttribute('data-template-loading');
      if (loading) panel.removeAttribute('data-template-loading');
      try { fitFloatingMetrics(next); validateMapLayout(next); }
      finally { if (loading) panel.setAttribute('data-template-loading', ''); }
      for (const target of [panel, next.querySelector('[data-template-slot="search"]'), next.querySelector('[data-template-slot="metrics"]')])
        layoutObserver?.observe(target);
      appliedViewport = JSON.stringify(layoutContext().viewport);
    } catch (error) {
      unmount();
      if (previous) mount(previous);
      throw error;
    }
  }

  async function compose({ repair = null } = {}) {
    if (!source || !hasData || !capabilities.mapTypes.length) return;
    const context = layoutContext();
    // A hidden panel has no usable viewport yet. Its observer starts composition
    // when it becomes visible instead of asking AI to design for a zero-sized map.
    if (!context.viewport.width || !context.viewport.height) return;
    const cap = normalizeTemplateCapabilities(capabilities);
    const selectedSource = source;
    let key = JSON.stringify([cap, context.viewport]);
    let requestKey = JSON.stringify([selectedSource.template, cap, context.viewport]);
    if (pending === key || failedKey === key) return;
    const requestRevision = ++revision;
    const previous = current;
    let variants = cache.get(selectedSource);
    let candidate = repair ? null : variants?.get(key);
    pending = key;
    status.textContent = MAP_PROCESSING_MESSAGE;
    setLoading(true);
    unmount();
    if (retryButton) retryButton.hidden = true;
    const refreshViewport = () => {
      context.viewport = layoutContext().viewport;
      if (!context.viewport.width || !context.viewport.height) return false;
      key = JSON.stringify([cap, context.viewport]);
      requestKey = JSON.stringify([selectedSource.template, cap, context.viewport]);
      pending = key;
      return true;
    };
    try {
      // Validate real browser layout and give AI two chances to correct it with
      // measured feedback. Keep the same loading lifecycle throughout repairs.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!refreshViewport()) return;
        if (!candidate) {
          const response = await fetchImpl('/api/ai/compose-map-template', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId: selectedSource.template, capabilities: cap, layoutContext: context,
              refresh: Boolean(repair) || failedCompositions.has(requestKey),
              repair: repair ? { layout: { html: repair.layout.html, css: repair.layout.css }, feedback: repair.feedback } : null }) });
          const result = await response.json();
          if (requestRevision !== revision || !hasData) return;
          if (!response.ok) throw new Error(result?.error || `AI HTTP ${response.status}`);
          if (result?.templateId !== selectedSource.template) throw new Error('AI trả về sai mẫu giao diện.');
          candidate = normalizeTemplateComposition(result.composition, cap);
          if (!result.sourceHash) throw new Error('AI trả về mẫu không hợp lệ.');
        }
        if (requestRevision !== revision || !hasData) return;
        if (!refreshViewport()) return;
        try { mount(candidate); }
        catch (error) {
          if (!error.layoutFeedback) throw error;
          failedCompositions.add(requestKey);
          variants?.delete(key);
          if (attempt === 2) throw error;
          repair = { layout: candidate, feedback: error.layoutFeedback };
          candidate = null;
          continue;
        }
        if (!variants) { variants = new Map(); cache.set(selectedSource, variants); }
        variants.set(key, candidate);
        failedKey = '';
        failedCompositions.delete(requestKey);
        status.textContent = `Đã áp dụng mẫu ${selectedSource.template}.`;
        return;
      }
    } catch (error) {
      if (requestRevision === revision) {
        if (previous && !shell) {
          try { mount(previous); } catch { /* Keep the original live map if restoration also fails. */ }
        }
        failedKey = key;
        failedCompositions.add(requestKey);
        const detail = error.layoutFeedback
          ? 'AI chưa hoàn tất bố cục phù hợp sau khi tự điều chỉnh. Bản đồ trước đó vẫn được giữ.'
          : error.message;
        status.textContent = `Không ghép được mẫu ${selectedSource.template}: ${detail}`;
        if (retryButton) retryButton.hidden = false;
      }
    } finally { if (requestRevision === revision) { pending = ''; setLoading(false); } }
  }

  function select(next) {
    ++revision; pending = ''; failedKey = '';
    setLoading(false);
    source = next?.source || null;
    // Keep the host viewport stable while AI is working and controls are moved.
    // Otherwise removing the shell restores native margins/borders mid-request.
    if (source) content.dataset.templateActive = 'true';
    else delete content.dataset.templateActive;
    unmount();
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
      ++revision; pending = ''; setLoading(false); unmount();
      if (source) status.textContent = `Đã tải mẫu ${source.template}; chờ dữ liệu để render.`;
      return;
    }
    if (source && (!shell || previous !== JSON.stringify(capabilities))) void compose();
  }

  layoutObserver?.observe(panel);
  const selectElement = document.getElementById('map-template-select');
  selectElement.addEventListener('map-template-change', event => select(event.detail));
  picker?.ready?.then(() => { if (!source) select({ source: picker.getSelectedSource() }); });
  return { update, unmount, getComposition: () => current, getShell: () => shell };
}

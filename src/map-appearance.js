import { APPEARANCE_TARGETS, normalizeMapAppearance, normalizeAppearancePatch, contrastingText, appearanceBorder } from './map-appearance-contract.js';
import { createMapControlLayout } from './map-control-layout.js';

const TARGETS = {
  search: { frames: '.map-query-panel, .map-search, .map-search-controls, .map-search-box, .map-search-form, .map-region-navigation, .map-search-results, .map-search-selection, .map-search-clear, .map-search-submit', text: 'input, button, select, option, b, strong, small, .map-search-location, .map-search-result-icon' },
  legend: { frames: '.map-legends, .layer-legends, .weather-legend, .point-legend', text: 'strong, small, b, span, dt, dd' },
  metrics: { frames: '.map-metric-toggle, .map-metric-button', text: '.map-metric-label, .map-metric-label span, .map-metric-label small, .map-metric-count, .map-metric-chevron' },
  controls: { frames: '.map-controls, .map-controls > button', text: 'button' },
  popup: { frames: '.maplibregl-popup-content, .weather-popup, .info-image-body, .bar-chart-card, .chart-zoom-controls, .chart-zoom-controls button, .maplibregl-popup-close-button, .popup-info-chip dd, .popup-info-note, .info-image-navigation button',
    borders: '.popup-info-heading, .popup-info-details > div, .popup-source-record, .popup-joined-records, .info-image-details > div',
    text: '.popup-info-heading strong, .popup-info-caption, dt, dd, h2, p, small, .maplibregl-popup-close-button, .chart-zoom-controls button, .info-image-navigation button' }
};

// Apply validated properties to live controls, including controls moved/rebuilt by templates.
// Inline important overrides also beat generated scoped styles with important declarations.
export function createMapAppearance({ panel, workspace }) {
  const originals = new Map();
  const computed = element => panel.ownerDocument.defaultView.getComputedStyle(element);
  const group = () => workspace.groupsById[workspace.activeGroupId];
  const layout = createMapControlLayout({ panel, set });
  const observed = new Set();

  function templateFramesFor(target) {
    const nodes = [];
    const slot = panel.querySelector(`[data-template-slot="${target}"]`);
    if (slot) {
      nodes.push(slot);
      let frame = slot;
      while (frame.parentElement && !frame.parentElement.matches('.map-template-shell, .map-panel, [data-template-slot="map"]')
        && frame.parentElement.querySelectorAll('[data-template-slot]').length === 1) {
        frame = frame.parentElement; nodes.push(frame);
      }
    }
    return nodes;
  }

  function framesFor(target) {
    return [...new Set([...panel.querySelectorAll(TARGETS[target].frames),
      ...(target === 'metrics' ? [] : templateFramesFor(target))])];
  }

  function set(element, key, value) {
    if (!originals.has(element)) originals.set(element, new Map());
    const properties = originals.get(element);
    if (!properties.has(key)) properties.set(key, [element.style.getPropertyValue(key), element.style.getPropertyPriority(key)]);
    element.style.setProperty(key, value, 'important');
  }

  function restore() {
    layout.restore();
    for (const [element, properties] of originals) for (const [key, [value, priority]] of properties) {
      if (value) element.style.setProperty(key, value, priority);
      else element.style.removeProperty(key);
    }
    originals.clear();
  }

  function sizeMetricButtons(patch) {
    if (!patch || (!patch.uniformSize && patch.buttonWidth === undefined && patch.buttonHeight === undefined)) return;
    // Measure each list separately; the toggle is a separate control. Read after
    // restoring template styles so repeated applies never grow the buttons.
    for (const list of panel.querySelectorAll('.map-metric-list')) {
      const buttons = [...list.querySelectorAll('.map-metric-button')];
      const sizeAxis = (axis, requested) => {
        if (requested === undefined) return;
        for (const button of buttons) {
          set(button, 'box-sizing', 'border-box');
          set(button, 'flex', '0 0 auto');
          for (const key of [axis, `min-${axis}`, `max-${axis}`]) set(button, key, `${requested}px`);
        }
      };
      // Width can change wrapping, so measure heights only after widths apply.
      const maxSize = axis => Math.ceil(Math.max(0, ...buttons.map(button => button.getBoundingClientRect()[axis])));
      sizeAxis('width', patch.buttonWidth ?? (patch.uniformSize ? maxSize('width') || undefined : undefined));
      sizeAxis('height', patch.buttonHeight ?? (patch.uniformSize ? maxSize('height') || undefined : undefined));
    }
  }

  function apply() {
    observer.disconnect();
    try { applyCurrent(); }
    finally { observer.observe(panel, { childList: true, subtree: true }); }
  }

  function applyCurrent() {
    restore();
    // Metric containers only arrange the floating buttons. Painting these
    // containers creates a solid rectangle behind the entire list.
    for (const frame of [...panel.querySelectorAll('.workspace-metrics, .map-metric-control, .map-metric-list'), ...templateFramesFor('metrics')]) {
      set(frame, 'background', 'transparent');
      set(frame, 'border-color', 'transparent');
      set(frame, 'box-shadow', 'none');
      set(frame, 'backdrop-filter', 'none');
    }
    const appearance = normalizeMapAppearance(group()?.appearance);
    panel.toggleAttribute('data-ai-appearance-search', Boolean(appearance.search?.color));
    for (const [target, patch] of Object.entries(appearance)) {
      const frames = framesFor(target);
      const text = new Set(frames.flatMap(frame => [...frame.querySelectorAll(TARGETS[target].text)]));
      const borderColor = patch.borderColor || (patch.background && appearanceBorder(patch.background, patch.color));
      for (const frame of frames) {
        if (patch.background) {
          // Old template borders/inset shadows can otherwise look like dark
          // backplates around a newly light surface. Preserve dimensions.
          if (patch.shadow === undefined && computed(frame).boxShadow !== 'none') set(frame, 'box-shadow', '0 4px 16px #00000024');
          set(frame, 'background', patch.background);
          set(frame, 'color-scheme', contrastingText(patch.background) === '#ffffff' ? 'dark' : 'light');
        }
        if (patch.color) set(frame, 'color', patch.color);
        if (borderColor) set(frame, 'border-color', borderColor);
        if (patch.borderRadius !== undefined) set(frame, 'border-radius', `${patch.borderRadius}px`);
        if (patch.fontSize !== undefined) set(frame, 'font-size', `${patch.fontSize}px`);
        if (patch.shadow !== undefined) set(frame, 'box-shadow', patch.shadow ? '0 4px 16px #00000024' : 'none');
        if (target === 'search' && patch.color) set(frame, '--ai-search-text', patch.color);
        if (target === 'popup') for (const [key, value] of Object.entries({ '--template-surface': patch.background, '--template-text': patch.color,
          '--template-secondary': patch.color, '--template-border': borderColor })) if (value) set(frame, key, value);
      }
      if (borderColor && TARGETS[target].borders) for (const element of panel.querySelectorAll(TARGETS[target].borders)) set(element, 'border-color', borderColor);
      for (const element of text) {
        if (patch.color) set(element, 'color', patch.color);
        if (patch.fontSize !== undefined) set(element, 'font-size', `${patch.fontSize}px`);
      }
    }
    sizeMetricButtons(appearance.metrics);
    for (const [target, patch] of Object.entries(appearance)) layout.apply(target, patch);
    const targets = new Set([panel, panel.querySelector('#map'), ...layout.elements()].filter(Boolean));
    for (const element of observed) if (!targets.has(element)) { resizeObserver?.unobserve(element); observed.delete(element); }
    for (const element of targets) if (!observed.has(element)) { resizeObserver?.observe(element); observed.add(element); }
  }

  function read() {
    const appearance = normalizeMapAppearance(group()?.appearance);
    for (const target of APPEARANCE_TARGETS) {
      const frames = framesFor(target);
      const frame = frames.find(element => {
        const background = computed(element).backgroundColor;
        return background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)';
      });
      if (!frame) continue;
      const color = value => {
        const match = /^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/.exec(value);
        return match ? `#${match.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}` : null;
      };
      const current = { ...Object.fromEntries([['background', color(computed(frame).backgroundColor)], ['color', color(computed(frame).color)]].filter(([, value]) => value)), ...appearance[target] };
      if (Object.keys(current).length) appearance[target] = current;
    }
    return appearance;
  }

  function update(target, raw, groupId) {
    if (!APPEARANCE_TARGETS.includes(target)) throw new Error('Thành phần giao diện không hợp lệ.');
    const owner = workspace.groupsById[groupId];
    if (!owner) throw new Error('Bản đồ không còn tồn tại.');
    const patch = normalizeAppearancePatch(raw, target);
    // Resetting an axis also resets its previous explicit edge spacing.
    const previous = { ...owner.appearance?.[target] };
    if (patch.horizontal === 'default' && patch.offsetX === undefined) delete previous.offsetX;
    if (patch.vertical === 'default' && patch.offsetY === undefined) delete previous.offsetY;
    if (patch.background && !patch.color) patch.color = contrastingText(patch.background);
    owner.appearance = { ...owner.appearance, [target]: { ...previous, ...patch } };
    apply();
  }

  const Observer = panel.ownerDocument.defaultView.MutationObserver;
  const observer = new Observer(() => apply());
  const resizeObserver = panel.ownerDocument.defaultView.ResizeObserver ? new panel.ownerDocument.defaultView.ResizeObserver(() => apply()) : null;
  observer.observe(panel, { childList: true, subtree: true });
  return { apply, read, update, dispose() { observer.disconnect(); resizeObserver?.disconnect(); restore(); panel.removeAttribute('data-ai-appearance-search'); } };
}

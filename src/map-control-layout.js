import { LAYOUT_KEYS } from './map-appearance-contract.js';

const NATIVE = { search: '.map-query-panel', legend: '.map-legends', metrics: '.workspace-metrics', controls: '.map-controls' };

// Move a whole control frame into the map region. A measured placeholder keeps
// sidebar/grid templates from changing the map geometry when a control leaves.
export function createMapControlLayout({ panel, set }) {
  const moved = [];
  const view = panel.ownerDocument.defaultView;

  function frameFor(target) {
    let frame = panel.querySelector(`[data-template-slot="${target}"]`);
    if (!frame) return panel.querySelector(NATIVE[target]);
    while (frame.parentElement && !frame.parentElement.matches('.map-template-shell, .map-panel, [data-template-slot="map"]')
      && frame.parentElement.querySelectorAll('[data-template-slot]').length === 1) frame = frame.parentElement;
    return frame;
  }

  function restore() {
    for (const { frame, placeholder } of moved) {
      // Disconnected placeholders belong to an old, unmounted template.
      if (placeholder.isConnected && frame.isConnected) placeholder.replaceWith(frame);
      else placeholder.remove();
      frame.removeAttribute('data-ai-positioned');
    }
    moved.length = 0;
  }

  function apply(target, patch) {
    if (!NATIVE[target] || !LAYOUT_KEYS.some(key => patch[key] !== undefined)) return;
    const horizontal = patch.horizontal === 'default' ? undefined : patch.horizontal;
    const vertical = patch.vertical === 'default' ? undefined : patch.vertical;
    if (!horizontal && !vertical && patch.offsetX === undefined && patch.offsetY === undefined) return;
    const frame = frameFor(target);
    const map = panel.querySelector('#map');
    if (!frame || !map || frame.contains(map)) return;
    const region = panel.querySelector('[data-template-slot="map"]') || panel;
    const bounds = frame.getBoundingClientRect();
    const viewport = map.getBoundingClientRect();
    if (!viewport.width || !viewport.height) return;
    const style = view.getComputedStyle(frame);
    const x = horizontal || (bounds.left + bounds.width / 2 <= viewport.left + viewport.width / 2 ? 'left' : 'right');
    const y = vertical || (bounds.top + bounds.height / 2 <= viewport.top + viewport.height / 2 ? 'top' : 'bottom');
    const gapX = patch.offsetX ?? (horizontal ? 16 : Math.max(0, x === 'left' ? bounds.left - viewport.left : viewport.right - bounds.right));
    const gapY = patch.offsetY ?? (vertical ? 16 : Math.max(0, y === 'top' ? bounds.top - viewport.top : viewport.bottom - bounds.bottom));
    const insetX = Math.min(gapX, Math.max(0, viewport.width - Math.min(bounds.width, viewport.width)));
    const insetY = Math.min(gapY, Math.max(0, viewport.height - Math.min(bounds.height, viewport.height)));
    const placeholder = panel.ownerDocument.createElement('div');
    placeholder.setAttribute('aria-hidden', 'true');
    for (const key of ['display', 'position', 'grid-area', 'order', 'flex', 'align-self', 'justify-self', 'margin']) {
      placeholder.style.setProperty(key, style.getPropertyValue(key));
    }
    Object.assign(placeholder.style, { width: `${bounds.width}px`, height: `${bounds.height}px`, boxSizing: 'border-box',
      visibility: 'hidden', pointerEvents: 'none', minWidth: '0', minHeight: '0' });
    frame.before(placeholder);
    moved.push({ frame, placeholder });
    region.append(frame);
    frame.setAttribute('data-ai-positioned', '');
    const regionBounds = region.getBoundingClientRect();
    const left = viewport.left - regionBounds.left - region.clientLeft;
    const top = viewport.top - regionBounds.top - region.clientTop;
    const width = Math.min(bounds.width || 280, Math.max(0, viewport.width - insetX));
    // Use longhands so restoring overrides preserves inline offsets/margins
    // even when the template authored only some sides of a shorthand.
    const properties = { position: 'absolute', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', transform: 'none',
      'margin-top': '0', 'margin-right': '0', 'margin-bottom': '0', 'margin-left': '0',
      'box-sizing': 'border-box', width: `${width}px`, 'min-width': '0', 'max-width': `${viewport.width}px`,
      height: 'auto', 'min-height': '0', 'max-height': `${Math.max(0, viewport.height - insetY)}px`,
      'overflow-y': 'auto', 'z-index': '5', 'pointer-events': 'auto' };
    properties.left = `${left + (x === 'left' ? insetX : x === 'center' ? (viewport.width - width) / 2 : viewport.width - width - insetX)}px`;
    if (y === 'bottom') properties.bottom = `${region.clientHeight - top - viewport.height + insetY}px`;
    else if (y === 'center') { properties.top = `${top + viewport.height / 2}px`; properties.transform = 'translateY(-50%)'; }
    else properties.top = `${top + insetY}px`;
    if (target === 'metrics') properties['align-items'] = x === 'left' ? 'flex-start' : x === 'right' ? 'flex-end' : 'center';
    for (const [key, value] of Object.entries(properties)) set(frame, key, value);
  }

  return { apply, restore, elements: () => moved.map(item => item.frame) };
}

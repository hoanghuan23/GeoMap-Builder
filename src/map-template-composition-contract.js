export const TEMPLATE_SLOTS = ['map', 'search', 'metrics', 'legend', 'controls', 'attribution', 'status'];
export const TEMPLATE_POPUP_KINDS = ['info', 'info_image', 'bar', 'line', 'pie'];

const validCss = value => typeof value === 'string' && value.length <= 100_000
  && !/@import\b|@font-face\b|url\s*\(|expression\s*\(|-moz-binding\b/i.test(value);
const validHtml = value => typeof value === 'string' && value.length <= 100_000
  && !/<\s*(?:script|iframe|object|embed|link|meta|base|form)\b|\bon\w+\s*=|javascript\s*:/i.test(value);
const validLayoutHtml = value => validHtml(value) && !/<\s*(?:button|input|label)\b/i.test(value);

/** Internal AI output. Front-end template authors do not write this contract. */
export function normalizeTemplateComposition(raw, capabilities = {}) {
  if (!raw || !validLayoutHtml(raw.html) || !validCss(raw.css)) throw new Error('AI trả về bố cục template không hợp lệ.');
  for (const slot of TEMPLATE_SLOTS) {
    const matches = raw.html.match(new RegExp(`data-template-slot\\s*=\\s*["']${slot}["']`, 'g')) || [];
    if (matches.length !== 1) throw new Error(`Bố cục template thiếu hoặc lặp vị trí ${slot}.`);
  }
  const components = Array.isArray(raw.components) ? raw.components : [];
  if (components.length > TEMPLATE_POPUP_KINDS.length) throw new Error('AI trả về quá nhiều thành phần popup.');
  const allowed = new Set(capabilities.popupTypes || TEMPLATE_POPUP_KINDS);
  const seen = new Set();
  const normalized = components.map(item => {
    if (!TEMPLATE_POPUP_KINDS.includes(item?.kind) || !allowed.has(item.kind) || seen.has(item.kind)
      || !['template', 'generated'].includes(item.origin) || !validHtml(item.html) || !validCss(item.css)
      || typeof item.js !== 'string' || item.js.length > 60_000) throw new Error('Thành phần popup do AI tạo không hợp lệ.');
    seen.add(item.kind);
    return { kind: item.kind, origin: item.origin, html: item.html, css: item.css, js: item.js };
  });
  // Older compositions may still contain chart components. Accept that metadata
  // for compatibility; popup charts always use the application's native renderer.
  return { html: raw.html, css: raw.css, components: normalized };
}

export function normalizeTemplateCapabilities(raw) {
  const mapTypes = [...new Set(Array.isArray(raw?.mapTypes) ? raw.mapTypes : [])];
  const popupTypes = [...new Set(Array.isArray(raw?.popupTypes) ? raw.popupTypes : [])];
  if (mapTypes.some(type => !['choropleth', 'point', 'map_line', 'arc_flow'].includes(type))
    || popupTypes.some(type => !TEMPLATE_POPUP_KINDS.includes(type))) throw new Error('Khả năng template không hợp lệ.');
  return { mapTypes: mapTypes.sort(), popupTypes: popupTypes.sort() };
}

const layoutText = value => typeof value === 'string' ? value.slice(0, 240) : '';
const dimension = value => Number.isFinite(value) ? Math.max(0, Math.min(30_000, Math.round(value))) : 0;
const texts = value => Array.isArray(value) ? value.slice(0, 60).map(layoutText) : [];

/** UI metadata only; no source records or popup values are sent for layout. */
export function normalizeTemplateLayoutContext(raw) {
  if (!raw) return null;
  return {
    viewport: { width: dimension(raw.viewport?.width), height: dimension(raw.viewport?.height) },
    metrics: { count: dimension(raw.metrics?.count), labels: texts(raw.metrics?.labels) },
    legends: { count: dimension(raw.legends?.count), titles: texts(raw.legends?.titles) },
    search: { enabled: raw.search?.enabled === true, placeholder: layoutText(raw.search?.placeholder),
      hasRegionNavigation: raw.search?.hasRegionNavigation === true }
  };
}

export function normalizeTemplateLayoutRepair(raw) {
  if (!raw) return null;
  if (!validLayoutHtml(raw.layout?.html) || !validCss(raw.layout?.css)
    || !['map-size', 'map-hidden', 'canvas-size', 'metrics-coverage'].includes(raw.feedback?.issue))
    throw new Error('Phản hồi bố cục template không hợp lệ.');
  const measure = item => ({ name: layoutText(item?.name), width: dimension(item?.width), height: dimension(item?.height),
    display: layoutText(item?.display), position: layoutText(item?.position) });
  return {
    layout: { html: raw.layout.html, css: raw.layout.css },
    feedback: { issue: raw.feedback.issue,
      slots: Array.isArray(raw.feedback.slots) ? raw.feedback.slots.slice(0, TEMPLATE_SLOTS.length).map(measure) : [],
      ancestors: Array.isArray(raw.feedback.ancestors) ? raw.feedback.ancestors.slice(0, 12).map(measure) : [] }
  };
}

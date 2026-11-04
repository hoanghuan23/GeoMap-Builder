export const TEMPLATE_SLOTS = ['map', 'search', 'metrics', 'legend', 'controls', 'attribution', 'status'];
export const TEMPLATE_POPUP_KINDS = ['info', 'info_image', 'bar', 'line'];

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
  for (const kind of ['bar', 'line']) {
    if (allowed.has(kind) && (!seen.has(kind) || !normalized.find(item => item.kind === kind)?.js.trim()))
      throw new Error(`Template thiếu thành phần biểu đồ ${kind}.`);
  }
  return { html: raw.html, css: raw.css, components: normalized };
}

export function normalizeTemplateCapabilities(raw) {
  const mapTypes = [...new Set(Array.isArray(raw?.mapTypes) ? raw.mapTypes : [])];
  const popupTypes = [...new Set(Array.isArray(raw?.popupTypes) ? raw.popupTypes : [])];
  if (mapTypes.some(type => !['choropleth', 'point', 'map_line', 'arc_flow'].includes(type))
    || popupTypes.some(type => !TEMPLATE_POPUP_KINDS.includes(type))) throw new Error('Khả năng template không hợp lệ.');
  return { mapTypes: mapTypes.sort(), popupTypes: popupTypes.sort() };
}

const field = { anyOf: [{ type: 'string', maxLength: 160 }, { type: 'null' }] };
const fields = { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 160 } };

export const POPUP_CONTENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['titleField', 'imageFields', 'descriptionFields', 'addressFields', 'linkFields'],
  properties: { titleField: field, imageFields: fields, descriptionFields: fields, addressFields: fields, linkFields: fields }
};

/** Keep exact column names, including whitespace. Never interpret model output as a URL. */
export function normalizePopupContent(raw, columns = []) {
  const names = new Set(columns.map(column => typeof column === 'string' ? column : column.name));
  const valid = name => typeof name === 'string' && !name.startsWith('__') && names.has(name);
  const selected = key => [...new Set((Array.isArray(raw?.[key]) ? raw[key] : []).filter(valid))].slice(0, 30);
  return { titleField: valid(raw?.titleField) ? raw.titleField : null, imageFields: selected('imageFields'),
    descriptionFields: selected('descriptionFields'), addressFields: selected('addressFields'), linkFields: selected('linkFields') };
}

export function httpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function popupUrls(value) {
  // MapLibre serializes array-valued properties in rendered feature events.
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return popupUrls(parsed); } catch { /* Plain text. */ }
  }
  return [...new Set((Array.isArray(value) ? value.flatMap(popupUrls)
    : typeof value === 'string' ? value.split(/[\r\n;]+/).map(httpUrl).filter(Boolean) : []))];
}

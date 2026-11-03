const COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const LENGTH = /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)$/;

function invalid() {
  throw new Error('Mẫu giao diện thiếu cấu hình hoặc có cấu hình không hợp lệ.');
}

function length(value, allowZero = false) {
  if (typeof value !== 'string' || !LENGTH.test(value) || value.length > 16
    || (!allowZero && parseFloat(value) <= 0)) invalid();
  return value;
}

/** Only presentation tokens cross this boundary; data colors and AI decisions never do. */
export function normalizeMapTemplate(raw) {
  const template = {};
  for (const key of ['id', 'theme', 'name', 'description']) {
    if (typeof raw?.[key] !== 'string' || !raw[key].trim()) invalid();
    template[key] = raw[key];
  }
  if (!['light', 'dark'].includes(template.theme)) invalid();
  const colors = {};
  for (const key of ['background', 'surface', 'text', 'textSecondary', 'border', 'accent']) {
    if (!COLOR.test(raw.styles?.colors?.[key] || '')) invalid();
    colors[key] = raw.styles.colors[key];
  }
  const source = raw.typography;
  if (typeof source?.fontFamily !== 'string' || source.fontFamily.length > 240
    || !/^[\p{L}\p{N}\s,'"-]+$/u.test(source.fontFamily) || !source.fontFamily.trim()) invalid();
  const sizes = {};
  for (const key of ['body', 'popup', 'legend', 'label', 'heading', 'title']) sizes[key] = length(source.sizes?.[key]);
  const weights = {};
  for (const key of ['normal', 'semibold', 'bold']) {
    const weight = source.weights?.[key];
    if (!Number.isInteger(weight) || weight < 100 || weight > 900) invalid();
    weights[key] = weight;
  }
  if (!Number.isFinite(source.lineHeight) || source.lineHeight < 1 || source.lineHeight > 3) invalid();
  const layout = { borderRadius: length(raw.styles?.layout?.borderRadius, true), spacing: length(raw.styles?.layout?.spacing, true) };
  // Optional authored shadow. Restrict it to lengths plus a hex color (or none), never URLs/code.
  if (raw.styles.layout.shadow != null) {
    const shadow = raw.styles.layout.shadow;
    if (typeof shadow !== 'string' || shadow.length > 120
      || !/^(?:none|(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)?\s+){2,4}#[\da-f]{3,8})$/i.test(shadow)) invalid();
    layout.shadow = shadow;
  }
  return { ...template, styles: { colors, layout }, typography: { fontFamily: source.fontFamily, sizes, weights, lineHeight: source.lineHeight } };
}

export function mapTemplateVariables(template) {
  const { colors, layout } = template.styles;
  const { fontFamily, sizes, weights, lineHeight } = template.typography;
  return {
    '--template-background': colors.background,
    '--template-surface': colors.surface,
    '--template-text': colors.text,
    '--template-secondary': colors.textSecondary,
    '--template-border': colors.border,
    '--template-accent': colors.accent,
    '--template-font': fontFamily,
    ...Object.fromEntries(Object.entries(sizes).map(([key, value]) => [`--template-${key}-size`, value])),
    ...Object.fromEntries(Object.entries(weights).map(([key, value]) => [`--template-${key}-weight`, String(value)])),
    '--template-line-height': String(lineHeight),
    '--template-radius': layout.borderRadius,
    '--template-spacing': layout.spacing,
    '--template-shadow': layout.shadow || '0 4px 18px color-mix(in srgb, var(--template-text) 18%, transparent)'
  };
}

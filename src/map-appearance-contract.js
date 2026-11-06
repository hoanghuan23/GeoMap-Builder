export const APPEARANCE_TARGETS = ['search', 'legend', 'metrics', 'controls', 'popup'];
export const APPEARANCE_RULES = { background: 'color', color: 'color', borderColor: 'color', borderRadius: [0, 40], fontSize: [10, 24], shadow: 'boolean',
  horizontal: ['default', 'left', 'center', 'right'], vertical: ['default', 'top', 'center', 'bottom'], offsetX: [0, 200], offsetY: [0, 200] };
export const LAYOUT_KEYS = ['horizontal', 'vertical', 'offsetX', 'offsetY'];
export const METRIC_SIZE_RULES = { uniformSize: 'boolean', buttonWidth: [64, 400], buttonHeight: [32, 160] };

export function normalizeAppearancePatch(raw, target) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) throw new Error('Cấu hình giao diện không hợp lệ.');
  const patch = {};
  const rules = target === 'metrics' ? { ...APPEARANCE_RULES, ...METRIC_SIZE_RULES } : APPEARANCE_RULES;
  for (const [key, value] of Object.entries(raw)) {
    const rule = Object.hasOwn(rules, key) && rules[key];
    const valid = rule === 'color' ? typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
      : rule === 'boolean' ? typeof value === 'boolean'
        : Array.isArray(rule) && (typeof rule[0] === 'string' ? rule.includes(value) : Number.isFinite(value) && value >= rule[0] && value <= rule[1]);
    if (!valid) {
      const expected = rule === 'color' ? 'màu HEX 6 ký tự, ví dụ #ffffff'
        : rule === 'boolean' ? 'true hoặc false'
          : Array.isArray(rule) ? typeof rule[0] === 'string' ? rule.join(', ') : `số từ ${rule[0]} đến ${rule[1]}`
            : `chỉ dùng ${Object.keys(rules).join(', ')}`;
      throw new Error(`Thuộc tính giao diện không hợp lệ: ${key}. Giá trị yêu cầu: ${expected}.`);
    }
    if (target === 'popup' && LAYOUT_KEYS.includes(key)) throw new Error('Popup giữ vị trí theo đối tượng trên bản đồ.');
    patch[key] = typeof value === 'string' ? value.toLowerCase() : value;
  }
  return patch;
}

export function normalizeMapAppearance(raw) {
  return Object.fromEntries(APPEARANCE_TARGETS.flatMap(target => raw?.[target] ? [[target, normalizeAppearancePatch(raw[target], target)]] : []));
}

export function contrastingText(background) {
  const channels = background.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return luminance > .179 ? '#172033' : '#ffffff';
}

export function appearanceBorder(background, foreground = contrastingText(background)) {
  const channels = value => value.slice(1).match(/../g).map(hex => parseInt(hex, 16));
  const base = channels(background); const text = channels(foreground);
  return `#${base.map((value, index) => Math.round(value * .82 + text[index] * .18).toString(16).padStart(2, '0')).join('')}`;
}

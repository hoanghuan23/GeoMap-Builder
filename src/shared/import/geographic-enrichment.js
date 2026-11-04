const LEVELS = ['country', 'admin1', 'admin2', 'point_lat', 'point_lng'];
const empty = value => value == null || value === '';

export const GEOGRAPHIC_ENRICHMENT_SCHEMA = {
  type: 'array', description: 'Thông tin địa lý còn thiếu đã tra cứu trên mạng, kèm khóa ghép và URL nguồn. [] khi không cần hoặc chưa xác minh được.',
  items: {
    type: 'object', additionalProperties: false,
    required: ['field', 'geoLevel', 'matches', 'value', 'sourceUrl'],
    properties: {
      field: { type: 'string', description: 'Tên cột địa lý cần bổ sung; khai báo cùng tên trong columns với role geo.' },
      geoLevel: { type: 'string', enum: LEVELS },
      matches: { type: 'array', minItems: 1, items: {
        type: 'object', additionalProperties: false, required: ['field', 'value'],
        properties: { field: { type: 'string' }, value: { type: 'string' } }
      } },
      value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      sourceUrl: { type: 'string', description: 'URL HTTP(S) của trang nguồn đã kiểm tra, không phải URL tự tạo.' }
    }
  }
};

// Match only values actually shared in the input profile. Never interpret a
// missing samples option as permission to send records or invent identities.
export function normalizeGeographicEnrichment(raw, profile) {
  if (profile?.samplesIncluded !== true) return [];
  const fields = new Map((profile.columns || []).map(column => [column.name, column]));
  const metadata = new Map((Array.isArray(raw?.columns) ? raw.columns : []).filter(column => column && typeof column === 'object').map(column => [column.name, column]));
  const entries = [];
  for (const item of Array.isArray(raw?.geographicEnrichment) ? raw.geographicEnrichment : []) {
    const column = metadata.get(item?.field);
    if (!column || typeof item.field !== 'string' || column.role !== 'geo' || column.geoLevel !== item.geoLevel || !LEVELS.includes(item.geoLevel)
      || !item.field.trim() || item.field.startsWith('__') || ['__proto__', 'constructor', 'prototype'].includes(item.field)) continue;
    try { if (!['http:', 'https:'].includes(new URL(item.sourceUrl).protocol)) continue; }
    catch { continue; }
    if (!Array.isArray(item.matches) || !item.matches.length) continue;
    const seen = new Set();
    const valid = item.matches.every(match => {
      const source = fields.get(match?.field);
      if (!source || source.inferredType !== 'text' || typeof match.value !== 'string' || !match.value.trim() || seen.has(match.field)) return false;
      seen.add(match.field);
      const values = [...(source.distinctValues || []), ...(source.categoryValues || []), ...(source.samples || []),
        ...(profile.head || []).map(row => row[match.field]), ...(profile.scopeRows || []).map(row => row[match.field])];
      return values.some(value => !empty(value) && String(value).trim() === match.value.trim());
    });
    if (!valid) continue;
    const coordinate = item.geoLevel === 'point_lat' || item.geoLevel === 'point_lng';
    if (coordinate ? typeof item.value !== 'number' || !Number.isFinite(item.value)
      || Math.abs(item.value) > (item.geoLevel === 'point_lat' ? 90 : 180)
      : typeof item.value !== 'string' || !item.value.trim()) continue;
    entries.push({ field: item.field, geoLevel: item.geoLevel,
      matches: item.matches.map(match => ({ field: match.field, value: match.value.trim() })),
      value: coordinate ? item.value : item.value.trim(), sourceUrl: item.sourceUrl });
  }
  // Conflicting lookups for the same key stay unresolved, regardless of order.
  const groups = new Map();
  for (const item of entries) {
    const key = JSON.stringify([item.field, item.matches.map(match => [match.field, match.value]).sort()]);
    const group = groups.get(key) || [];
    group.push(item); groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.every(item => item.value === group[0].value)).map(group => group[0]);
}

export function profileWithGeographicEnrichment(profile, entries) {
  const columns = new Map((profile?.columns || []).map(column => [column.name, column]));
  for (const item of entries) {
    if (!columns.has(item.field)) columns.set(item.field, {
      name: item.field, inferredType: item.geoLevel.startsWith('point_') ? 'number' : 'text',
      uniqueCount: 0, nullPct: 100, min: null, max: null
    });
  }
  return { ...profile, columns: [...columns.values()] };
}

export function applyGeographicEnrichment(records, entries) {
  return records.map(record => {
    const additions = new Map();
    for (const item of entries) {
      if (!empty(record[item.field]) || !item.matches.every(match => !empty(record[match.field])
        && String(record[match.field]).trim() === match.value)) continue;
      const values = additions.get(item.field) || new Set();
      values.add(item.value); additions.set(item.field, values);
    }
    const result = { ...record };
    for (const [field, values] of additions) if (values.size === 1) result[field] = [...values][0];
    return result;
  });
}

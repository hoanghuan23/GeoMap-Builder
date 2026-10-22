const nullableString = { anyOf: [{ type: 'string', maxLength: 160 }, { type: 'null' }] };
export const MAP_COMPOSITION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['schemaVersion', 'decisions', 'searchLayerIds'],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    decisions: { type: 'array', maxItems: 50, items: {
      type: 'object', additionalProperties: false,
      required: ['layerId', 'action', 'targetGroupId', 'newGroupKey', 'groupTitle', 'confidence', 'reason'],
      properties: {
        layerId: { type: 'string', maxLength: 160 },
        action: { type: 'string', enum: ['append_to_group', 'create_group', 'undetermined'] },
        targetGroupId: nullableString, newGroupKey: nullableString,
        groupTitle: { type: 'string', minLength: 1, maxLength: 160 },
        confidence: { type: 'number', minimum: 0, maximum: 1 }, reason: { type: 'string', maxLength: 800 }
      }
    } },
    searchLayerIds: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 160 } }
  }
};

const clean = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, limit) : '';

/** Explicit allowlist also strips raw records, geometry, samples and arbitrary instructions. */
export function normalizeCompositionInput(raw) {
  if (!Array.isArray(raw?.layers) || !Array.isArray(raw?.groups) || !Array.isArray(raw?.newLayerIds)
    || raw.layers.length > 50 || raw.layers.length < 1) throw new Error('Hồ sơ tổ hợp bản đồ không hợp lệ.');
  const ids = new Set();
  const layers = raw.layers.map(layer => {
    const id = clean(layer?.id, 160);
    if (!id || ids.has(id)) throw new Error('ID lớp bị thiếu hoặc trùng.');
    ids.add(id);
    const columns = (Array.isArray(layer.columns) ? layer.columns : []).filter(column => column && clean(column.name, 160)).slice(0, 200).map(column => ({
      name: clean(column.name, 160), role: clean(column.role, 40), geoLevel: clean(column.geoLevel, 40), country: clean(column.country, 10),
      unit: clean(column.unit, 40), semanticType: clean(column.semanticType, 80) }));
    const searchable = new Set(columns.filter(column => ['geo', 'category', 'text', 'id'].includes(column.role)
      && !['point_lat', 'point_lng', 'h3'].includes(column.geoLevel) && !column.name.startsWith('__')).map(column => column.name));
    return { id, title: clean(layer.title, 160), grain: clean(layer.grain, 400),
      chartType: ['point', 'choropleth', 'map_line', 'polygon', 'line', 'h3', 'mixed'].includes(layer.chartType) ? layer.chartType : null,
      available: layer.available === true,
      geometryKinds: Array.isArray(layer.geometryKinds) ? [...new Set(layer.geometryKinds.filter(kind => ['area', 'line', 'point'].includes(kind)))] : [],
      extent: Array.isArray(layer.extent) && layer.extent.length === 4 && layer.extent.every(Number.isFinite)
        && layer.extent[0] >= -180 && layer.extent[2] <= 180 && layer.extent[1] >= -90 && layer.extent[3] <= 90
        && layer.extent[0] <= layer.extent[2] && layer.extent[1] <= layer.extent[3] ? layer.extent : null,
      columns,
      time: layer.time ? { field: clean(layer.time.field, 160), granularity: clean(layer.time.granularity, 40), count: Math.max(0, Number(layer.time.count) || 0) } : null,
      search_bar: layer.search_bar !== false, search_fields: [...new Set((Array.isArray(layer.search_fields) ? layer.search_fields : []).map(field => clean(field, 160)).filter(field => searchable.has(field)))].slice(0, 20)
    };
  });
  const groupIds = new Set(); const assigned = new Set();
  const groups = raw.groups.map(group => {
    const id = clean(group?.id, 160);
    if (!id || groupIds.has(id) || !Array.isArray(group.layerIds) || !group.layerIds.length) throw new Error('Nhóm bản đồ không hợp lệ.');
    groupIds.add(id);
    for (const key of group.layerIds) {
      if (!ids.has(key) || assigned.has(key)) throw new Error('Thành viên nhóm không hợp lệ.');
      assigned.add(key);
    }
    return { id, title: clean(group.title, 160), layerIds: [...group.layerIds] };
  });
  const newLayerIds = [...new Set(raw.newLayerIds)];
  if (!newLayerIds.length || newLayerIds.length !== raw.newLayerIds.length || newLayerIds.some(id => !ids.has(id) || assigned.has(id))) throw new Error('Danh sách lớp mới không hợp lệ.');
  if (layers.some(layer => !assigned.has(layer.id) && !newLayerIds.includes(layer.id))) throw new Error('Hồ sơ có lớp không thuộc phạm vi đánh giá.');
  return { workspaceRevision: Number.isSafeInteger(raw.workspaceRevision) ? raw.workspaceRevision : 0, layers, groups, newLayerIds,
    activeGroupId: groupIds.has(raw.activeGroupId) ? raw.activeGroupId : null };
}

export function fallbackComposition(input, reason = 'Chưa xác định khả năng kết hợp; dữ liệu được giữ thành bản đồ riêng.') {
  return { schemaVersion: 1, source: 'rule', decisions: input.newLayerIds.map(layerId => ({ layerId, action: 'undetermined', targetGroupId: null,
    newGroupKey: null, groupTitle: input.layers.find(layer => layer.id === layerId)?.title || 'Dữ liệu tải lên', confidence: 0, reason })),
    searchLayerIds: input.layers.filter(layer => layer.search_bar !== false && layer.search_fields?.length).map(layer => layer.id) };
}

export function normalizeCompositionResult(raw, input) {
  const fallback = fallbackComposition(input);
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.decisions)) return fallback;
  const layers = new Map(input.layers.map(layer => [layer.id, layer]));
  const groups = new Map(input.groups.map(group => [group.id, group]));
  const decisions = input.newLayerIds.map((id, index) => {
    const matches = raw.decisions.filter(item => item?.layerId === id);
    const item = matches[0];
    if (matches.length !== 1 || !['append_to_group', 'create_group', 'undetermined'].includes(item?.action)
      || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
      || !clean(item.groupTitle, 160) || typeof item.reason !== 'string') return fallback.decisions[index];
    if (item.action === 'append_to_group') {
      const group = groups.get(item.targetGroupId);
      if (!group || item.newGroupKey != null || !layers.get(id).available || group.layerIds.some(key => !layers.get(key)?.available)) return fallback.decisions[index];
    } else if (item.targetGroupId != null || item.action === 'undetermined' && item.newGroupKey != null
      || item.action === 'create_group' && !layers.get(id).available) return fallback.decisions[index];
    return { layerId: id, action: item.action, targetGroupId: item.action === 'append_to_group' ? item.targetGroupId : null,
      newGroupKey: item.action === 'create_group' ? clean(item.newGroupKey, 160) || null : null,
      groupTitle: clean(item.groupTitle, 160), confidence: item.confidence, reason: clean(item.reason, 800) };
  });
  const searchable = new Set(fallback.searchLayerIds);
  // Composition can recommend search layers, but omission must not disable
  // the valid search configuration already produced for an individual file.
  const recommended = Array.isArray(raw.searchLayerIds) ? raw.searchLayerIds.filter(id => searchable.has(id)) : [];
  return { schemaVersion: 1, source: raw.source === 'rule' ? 'rule' : 'ai', decisions,
    searchLayerIds: [...new Set([...recommended, ...searchable])] };
}

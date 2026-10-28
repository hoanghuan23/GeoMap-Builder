import { POPUP_CONTENT_SCHEMA, normalizePopupContent } from "./popup-content-contract.js";
import { normalizePopupSuggestions } from "./ai-chart-contract.js";

const nullableString = { anyOf: [{ type: 'string', maxLength: 160 }, { type: 'null' }] };
export const MAP_COMPOSITION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['decisions', 'searchLayerIds', 'attributeJoins'],
  properties: {
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
    attributeJoins: { type: 'array', maxItems: 100, items: {
      type: 'object', additionalProperties: false,
      required: ['sourceId', 'targetLayerId', 'keyPairs', 'popupSuggestions', 'popupContent', 'confidence', 'reason'],
      properties: {
        sourceId: { type: 'string', maxLength: 160 }, targetLayerId: { type: 'string', maxLength: 160 },
        keyPairs: { type: 'array', minItems: 1, maxItems: 8, items: {
          type: 'object', additionalProperties: false, required: ['sourceField', 'targetField'],
          properties: { sourceField: { type: 'string', maxLength: 160 }, targetField: { type: 'string', maxLength: 160 } }
        } },
        popupSuggestions: { type: 'array', maxItems: 4, items: {
          type: 'object', additionalProperties: false, required: ['name', 'confidence'],
          properties: { name: { type: 'string', enum: ['info', 'info_image', 'bar', 'line'] }, confidence: { type: 'number', minimum: 0, maximum: 1 } }
        } },
        popupContent: POPUP_CONTENT_SCHEMA,
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
      name: column.name.slice(0, 160), labelVi: clean(column.labelVi, 160), role: clean(column.role, 40), geoLevel: clean(column.geoLevel, 40), country: clean(column.country, 10),
      unit: clean(column.unit, 40), semanticType: clean(column.semanticType, 80) }));
    const searchable = new Set(columns.filter(column => ['geo', 'category', 'text', 'id'].includes(column.role)
      && !['point_lat', 'point_lng', 'h3'].includes(column.geoLevel) && !column.name.startsWith('__')).map(column => column.name));
    return { id, sourceKind: layer.sourceKind === 'attribute' ? 'attribute' : 'spatial',
      popupContent: normalizePopupContent(layer.popupContent, columns), popupSuggestions: normalizePopupSuggestions(layer.popupSuggestions),
      title: clean(layer.title, 160), grain: clean(layer.grain, 400),
      chartType: ['point', 'choropleth', 'map_line', 'arc_flow', 'polygon', 'line', 'h3', 'mixed'].includes(layer.chartType) ? layer.chartType : null,
      available: layer.available === true,
      geometryKinds: Array.isArray(layer.geometryKinds) ? [...new Set(layer.geometryKinds.filter(kind => ['area', 'line', 'point'].includes(kind)))] : [],
      extent: Array.isArray(layer.extent) && layer.extent.length === 4 && layer.extent.every(Number.isFinite)
        && layer.extent[0] >= -180 && layer.extent[2] <= 180 && layer.extent[1] >= -90 && layer.extent[3] <= 90
        && layer.extent[0] <= layer.extent[2] && layer.extent[1] <= layer.extent[3] ? layer.extent : null,
      columns,
      time: layer.time ? { field: columns.some(column => column.name === layer.time.field) ? layer.time.field : '', granularity: clean(layer.time.granularity, 40), count: Math.max(0, Number(layer.time.count) || 0) } : null,
      search_bar: layer.search_bar !== false, search_fields: [...new Set((Array.isArray(layer.search_fields) ? layer.search_fields : []).filter(field => typeof field === 'string' && searchable.has(field)))].slice(0, 20)
    };
  });
  const groupIds = new Set(); const assigned = new Set();
  const groups = raw.groups.map(group => {
    const id = clean(group?.id, 160);
    if (!id || groupIds.has(id) || !Array.isArray(group.layerIds) || !group.layerIds.length) throw new Error('Nhóm bản đồ không hợp lệ.');
    groupIds.add(id);
    for (const key of group.layerIds) {
      if (!ids.has(key) || assigned.has(key) || layers.find(layer => layer.id === key).sourceKind === 'attribute') throw new Error('Thành viên nhóm không hợp lệ.');
      assigned.add(key);
    }
    return { id, title: clean(group.title, 160), layerIds: [...group.layerIds] };
  });
  const newLayerIds = [...new Set(raw.newLayerIds)];
  if (!newLayerIds.length || newLayerIds.length !== raw.newLayerIds.length || newLayerIds.some(id => !ids.has(id) || assigned.has(id))) throw new Error('Danh sách lớp mới không hợp lệ.');
  if (layers.some(layer => layer.sourceKind !== 'attribute' && !assigned.has(layer.id) && !newLayerIds.includes(layer.id))) throw new Error('Hồ sơ có lớp không thuộc phạm vi đánh giá.');
  return { workspaceRevision: Number.isSafeInteger(raw.workspaceRevision) ? raw.workspaceRevision : 0, layers, groups, newLayerIds,
    activeGroupId: groupIds.has(raw.activeGroupId) ? raw.activeGroupId : null };
}

export function fallbackComposition(input, reason = 'Chưa xác định khả năng kết hợp; dữ liệu được giữ thành bản đồ riêng.') {
  return { source: 'rule', decisions: input.newLayerIds.map(layerId => ({ layerId, action: 'undetermined', targetGroupId: null,
    newGroupKey: null, groupTitle: input.layers.find(layer => layer.id === layerId)?.title || 'Dữ liệu tải lên', confidence: 0, reason })),
    attributeJoins: [], attributeJoinIssues: [],
    searchLayerIds: input.layers.filter(layer => layer.sourceKind !== 'attribute' && layer.search_bar !== false && layer.search_fields?.length).map(layer => layer.id) };
}

export function normalizeCompositionResult(raw, input) {
  const fallback = fallbackComposition(input);
  if (!raw || typeof raw !== 'object') return fallback;
  const layers = new Map(input.layers.map(layer => [layer.id, layer]));
  const groups = new Map(input.groups.map(group => [group.id, group]));
  const decisions = input.newLayerIds.map((id, index) => {
    const matches = (Array.isArray(raw.decisions) ? raw.decisions : []).filter(item => item?.layerId === id);
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
  return { source: raw.source === 'rule' ? 'rule' : 'ai', decisions, ...normalizeAttributeJoins(raw, input),
    searchLayerIds: [...new Set([...recommended, ...searchable])] };
}


export function normalizeAttributeJoins(raw, input) {
  const layers = new Map(input.layers.map(layer => [layer.id, layer]));
  const attributeJoins = []; const seen = new Set();
  const attributeJoinIssues = (Array.isArray(raw.attributeJoinIssues) ? raw.attributeJoinIssues : [])
    .filter(issue => layers.has(issue?.sourceId) && typeof issue.reason === 'string')
    .map(issue => ({ sourceId: issue.sourceId, reason: clean(issue.reason, 800) }));
  for (const item of (Array.isArray(raw.attributeJoins) ? raw.attributeJoins : []).slice(0, 100)) {
    const source = layers.get(item?.sourceId); const target = layers.get(item?.targetLayerId);
    const pairId = JSON.stringify([item?.sourceId, item?.targetLayerId]);
    const sourceFields = new Set(source?.columns?.map(column => column.name));
    const targetFields = new Set(target?.columns?.map(column => column.name));
    let reason = '';
    if (source?.sourceKind !== 'attribute' || target?.sourceKind === 'attribute' || !target?.available) reason = 'Nguồn thuộc tính hoặc lớp không gian đích không hợp lệ.';
    else if (!Array.isArray(item.keyPairs) || !item.keyPairs.length || item.keyPairs.length > 8
      || item.keyPairs.some(pair => !sourceFields.has(pair?.sourceField) || !targetFields.has(pair?.targetField)
        || pair.sourceField.startsWith('__') || pair.targetField.startsWith('__'))
      || new Set(item.keyPairs.map(pair => pair.sourceField)).size !== item.keyPairs.length
      || new Set(item.keyPairs.map(pair => pair.targetField)).size !== item.keyPairs.length) reason = 'Khóa liên kết thiếu, trùng hoặc không có trong dữ liệu.';
    else if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) reason = 'Độ tin cậy liên kết không hợp lệ.';
    else if (seen.has(pairId)) reason = 'Có nhiều đề xuất cho cùng nguồn và lớp đích; đã bỏ qua liên kết mơ hồ.';
    if (reason) {
      if (source) attributeJoinIssues.push({ sourceId: source.id, reason });
      if (seen.has(pairId)) {
        const index = attributeJoins.findIndex(join => join.sourceId === source?.id && join.targetLayerId === target?.id);
        if (index >= 0) attributeJoins.splice(index, 1);
      }
      continue;
    }
    seen.add(pairId);
    attributeJoins.push({ sourceId: source.id, targetLayerId: target.id,
      keyPairs: item.keyPairs.map(pair => ({ sourceField: pair.sourceField, targetField: pair.targetField })),
      popupContent: normalizePopupContent(item.popupContent || source.popupContent, source.columns),
      popupSuggestions: normalizePopupSuggestions(item.popupSuggestions), confidence: item.confidence, reason: clean(item.reason, 800) });
  }
  return { attributeJoins, attributeJoinIssues };
}

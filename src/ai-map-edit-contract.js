import { normalizePolygonLegendRecommendation } from './shared/data/polygon-legend-contract.js';
import { APPEARANCE_TARGETS, normalizeAppearancePatch, normalizeMapAppearance } from './map-appearance-contract.js';

export const EDIT_KINDS = ['appearance', 'style', 'metric', 'metricFields', 'visible', 'legendVisible', 'legend', 'popupMode', 'popupFields', 'hexEnabled', 'hexResolution'];
export const MAP_EDIT_SCHEMA = { type: 'object', additionalProperties: false, required: ['message', 'operations'], properties: {
  message: { type: 'string' }, operations: { type: 'array', maxItems: 24, items: {
    type: 'object', additionalProperties: false, required: ['layerId', 'kind', 'key', 'value'], properties: {
      layerId: { type: 'string' }, kind: { type: 'string', enum: EDIT_KINDS }, key: { type: 'string' }, value: { type: 'string' }
    }
  } }
} };

export const STYLE_RULES = {
  polygon: { color: 'color', opacity: [0, 1], borderColor: 'color', borderWidth: [.1, 4], showBorder: 'boolean' },
  point: { color: 'color', opacity: [0, 1], size: [50, 200], borderColor: 'color', borderWidth: [0, 4], showBorder: 'boolean' },
  line: { opacity: [0, 1], width: [1, 10] }
};

const fail = message => { throw new Error(message); };
const shortText = (value, max) => typeof value === 'string' && value.length <= max;

// Explicitly copy only metadata/configuration. No source rows, coordinates or credentials.
export function normalizeEditContext(raw) {
  if (!raw || !shortText(raw.groupId, 100) || !Array.isArray(raw.layers) || !raw.layers.length || raw.layers.length > 30) fail('Chưa có bản đồ để chỉnh sửa.');
  const layers = raw.layers.map(layer => {
    if (!shortText(layer.id, 100) || !layer.id || !['polygon', 'point', 'line', 'arc'].includes(layer.mapType)
      || !Array.isArray(layer.columns) || layer.columns.length > 500) fail('Ngữ cảnh lớp bản đồ không hợp lệ.');
    const columns = layer.columns.map(column => {
      if (!shortText(column.name, 500) || !column.name) fail('Tên thuộc tính không hợp lệ.');
      return { name: column.name, label: String(column.label || column.name).slice(0, 500), role: String(column.role || '').slice(0, 30) };
    });
    const names = new Set(columns.map(column => column.name));
    const style = Object.fromEntries(Object.entries(STYLE_RULES[layer.mapType] || {}).flatMap(([key, rule]) => {
      const value = layer.style?.[key];
      return validStyle(value, rule) ? [[key, value]] : [];
    }));
    const legendTarget = layer.legendTarget;
    const target = legendTarget && names.has(legendTarget.field) ? {
      field: legendTarget.field, role: columns.find(column => column.name === legendTarget.field).role,
      aggregation: legendTarget.aggregation ?? null, unit: legendTarget.unit ?? null
    } : null;
    const legend = target ? normalizePolygonLegendRecommendation(layer.legend, target) : null;
    return { id: layer.id, title: String(layer.title || layer.id).slice(0, 500), mapType: layer.mapType,
      visible: layer.visible !== false, legendVisible: layer.legendVisible !== false, columns, style,
      metric: names.has(layer.metric) ? layer.metric : null,
      metrics: (Array.isArray(layer.metrics) ? layer.metrics : []).filter(name => names.has(name)),
      availableMetrics: (Array.isArray(layer.availableMetrics) ? layer.availableMetrics : layer.metrics || []).filter(name => names.has(name)),
      popupModes: (Array.isArray(layer.popupModes) ? layer.popupModes : []).filter(mode => ['info', 'info_image', 'bar', 'line'].includes(mode)),
      popupMode: ['info', 'info_image', 'bar', 'line'].includes(layer.popupMode) ? layer.popupMode : null,
      popupFields: Array.isArray(layer.popupFields) ? layer.popupFields.filter(name => names.has(name)) : columns.map(column => column.name),
      legendTarget: target, legend, hexEnabled: layer.hexEnabled === true,
      hexResolution: Number.isInteger(layer.hexResolution) && layer.hexResolution >= 0 && layer.hexResolution <= 15 ? layer.hexResolution : 6
    };
  });
  if (new Set(layers.map(layer => layer.id)).size !== layers.length) fail('Mã lớp bản đồ bị trùng.');
  return { groupId: raw.groupId, title: String(raw.title || '').slice(0, 500), activeLayerId: raw.activeLayerId,
    templateId: String(raw.templateId || '').slice(0, 100), appearance: normalizeMapAppearance(raw.appearance), layers };
}

function validStyle(value, rule) {
  return rule === 'color' ? typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    : rule === 'boolean' ? typeof value === 'boolean'
      : Array.isArray(rule) && Number.isFinite(value) && value >= rule[0] && value <= rule[1];
}

export function normalizeEditResult(raw, context) {
  if (!raw || !shortText(raw.message, 4000) || !raw.message.trim() || !Array.isArray(raw.operations) || raw.operations.length > 24) fail('AI trả về yêu cầu chỉnh sửa không hợp lệ.');
  const operations = raw.operations.map(operation => {
    if (operation?.kind === 'appearance') {
      if (operation.layerId !== '' || !APPEARANCE_TARGETS.includes(operation.key) || !shortText(operation.value, 3000)) fail('Thao tác chỉnh giao diện không hợp lệ.');
      let value;
      try { value = JSON.parse(operation.value); } catch { fail(`Giá trị chỉnh giao diện không hợp lệ (${operation.key}): value phải là chuỗi chứa JSON hợp lệ.`); }
      try { value = normalizeAppearancePatch(value, operation.key); }
      catch (error) { fail(`Giá trị chỉnh giao diện không hợp lệ (${operation.key}): ${error.message}`); }
      return { layerId: '', kind: 'appearance', key: operation.key, value: JSON.stringify(value) };
    }
    const layer = context.layers.find(layer => layer.id === operation?.layerId);
    if (!layer || !EDIT_KINDS.includes(operation.kind) || !shortText(operation.value, 30000) || !shortText(operation.key, 100)) fail('AI chọn lớp hoặc thao tác không hợp lệ.');
    let value;
    try { value = JSON.parse(operation.value); } catch { fail('Giá trị chỉnh sửa không hợp lệ.'); }
    let valid = false;
    switch (operation.kind) {
      case 'style': valid = validStyle(value, STYLE_RULES[layer.mapType]?.[operation.key]) && !(operation.key === 'color' && layer.legendTarget); break;
      case 'metric': valid = layer.availableMetrics.includes(value); break;
      case 'metricFields': valid = Array.isArray(value) && value.length > 0 && value.length <= layer.availableMetrics.length
        && value.every(name => layer.availableMetrics.includes(name)) && new Set(value).size === value.length; break;
      case 'visible': case 'legendVisible': valid = typeof value === 'boolean'; break;
      case 'popupMode': valid = layer.popupModes.includes(value); break;
      case 'popupFields': valid = layer.popupModes.includes('info') && Array.isArray(value) && value.length <= layer.columns.length
        && value.every(name => layer.columns.some(column => column.name === name)) && new Set(value).size === value.length; break;
      case 'hexEnabled': valid = layer.mapType === 'polygon' && typeof value === 'boolean'; break;
      case 'hexResolution': valid = layer.mapType === 'polygon' && Number.isInteger(value) && value >= 0 && value <= 15; break;
      case 'legend': {
        const legend = layer.legendTarget && normalizePolygonLegendRecommendation(value, layer.legendTarget);
        if (legend) { value = legend; valid = true; }
        break;
      }
    }
    if (!valid) fail(`AI đề xuất thay đổi không được hỗ trợ cho lớp ${layer.title}.`);
    return { layerId: layer.id, kind: operation.kind, key: operation.kind === 'style' ? operation.key : '', value: JSON.stringify(value) };
  });
  // A legend must target the metric in the snapshot; change metric in a separate turn.
  if (operations.some(op => op.kind === 'metric' && operations.some(other => other.layerId === op.layerId && other.kind === 'legend'))) fail('Hãy đổi chỉ số trước khi chỉnh chú giải của chỉ số mới.');
  for (const layer of context.layers) {
    const edits = operations.filter(operation => operation.layerId === layer.id);
    const lists = edits.filter(operation => operation.kind === 'metricFields');
    const selections = edits.filter(operation => operation.kind === 'metric');
    if (lists.length > 1 || selections.length > 1) fail('Mỗi lớp chỉ nhận một danh sách chỉ số và một lựa chọn chỉ số trong mỗi lượt.');
    const metrics = lists.length ? JSON.parse(lists[0].value) : layer.metrics;
    if (selections.length && !metrics.includes(JSON.parse(selections[0].value))) fail('Không thể chọn chỉ số đã bị loại khỏi giao diện.');
    if (lists.length && layer.metric && !metrics.includes(layer.metric) && !selections.length && metrics.length !== 1) fail('Hãy chọn chỉ số thay thế trong danh sách còn lại.');
    if (lists.length && edits.some(operation => operation.kind === 'legend') && !metrics.includes(layer.metric)) fail('Hãy đổi chỉ số trước khi chỉnh chú giải của chỉ số mới.');
    const hidden = layer.availableMetrics.filter(field => !metrics.includes(field));
    if (edits.some(operation => operation.kind === 'popupFields' && JSON.parse(operation.value).some(field => hidden.includes(field)))) fail('Không thể đưa chỉ số đã loại vào popup.');
  }
  return { message: raw.message.trim(), operations };
}

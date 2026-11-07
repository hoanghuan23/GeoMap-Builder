import { numericMapValue } from '../data/map-value.js';
import { measureUnit } from '../data/measure-semantics.js';

const nullableField = { anyOf: [{ type: 'string' }, { type: 'null' }] };
export const PIE_BINDING_SCHEMA = {
  anyOf: [{ type: 'null' }, {
    type: 'object', additionalProperties: false,
    required: ['groupField', 'valueField', 'measureFields', 'excludedValues', 'title'],
    properties: {
      groupField: { ...nullableField, description: 'Cột nhóm thành phần trong cùng một đối tượng bản đồ; null khi mỗi cột đo là một thành phần.' },
      valueField: { ...nullableField, description: 'Cột giá trị/tỷ lệ của nhóm; null để đếm bản ghi khi groupField có giá trị.' },
      measureFields: { type: 'array', items: { type: 'string' }, description: 'Các cột thành phần cùng đơn vị khi groupField null; không gồm cột tổng, tọa độ hoặc các chỉ số không tạo thành một tổng thể.' },
      excludedValues: { type: 'array', items: { type: 'string' }, description: 'Giá trị nhóm thực tế cần loại vì là dòng tổng/phụ tổng; [] khi không có. Không bịa tên.' },
      title: { ...nullableField, description: 'Tiêu đề tiếng Việt ngắn theo nội dung cơ cấu, không chứa dữ liệu minh họa.' }
    }
  }]
};

export function normalizePieBinding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const field = value => typeof value === 'string' && value.trim() ? value : null;
  return { groupField: field(raw.groupField), valueField: field(raw.valueField),
    measureFields: [...new Set((Array.isArray(raw.measureFields) ? raw.measureFields : []).filter(value => field(value)))],
    excludedValues: [...new Set((Array.isArray(raw.excludedValues) ? raw.excludedValues : []).filter(value => typeof value === 'string'))],
    title: field(raw.title) };
}

export function pieChartFields(columns, bindings = {}) {
  const dimensions = new Set([bindings.region, bindings.lat, bindings.lng, bindings.x,
    bindings.source, bindings.target, bindings.sourceLat, bindings.sourceLng, bindings.targetLat, bindings.targetLng]);
  const visible = columns.filter(column => !column.name.startsWith('__') && !dimensions.has(column.name));
  return {
    groups: visible.filter(column => ['category', 'text'].includes(column.role)),
    measures: visible.filter(column => column.role === 'measure')
  };
}

export function createPieSelection(columns, metricField, bindings = {}, rawBinding = null) {
  const fields = pieChartFields(columns, bindings);
  const pie = normalizePieBinding(rawBinding);
  const group = pie ? fields.groups.find(column => column.name === pie.groupField) : fields.groups[0];
  const metric = fields.measures.find(column => column.name === metricField) || fields.measures[0];
  const measures = pie ? pie.measureFields
    : fields.measures.filter(column => measureUnit(column) === measureUnit(metric)).map(column => column.name);
  return { groupField: pie?.groupField || group?.name || '', measure: pie ? pie.valueField || 'count' : metric?.name || 'count',
    metrics: measures, aggregation: 'auto', excludedValues: pie?.excludedValues || [], title: pie?.title || '' };
}

function aggregate(values, aggregation) {
  if (!values.length) return null;
  if (values.some(value => value == null)) throw new Error('Có nhóm thiếu số liệu. Bổ sung dữ liệu trước khi tính tỷ trọng.');
  if (values.some(value => value < 0)) throw new Error('Biểu đồ tròn chỉ dùng giá trị không âm.');
  if (values.length === 1) return values[0];
  if (aggregation === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === 'min') return values.reduce((min, value) => Math.min(min, value), Infinity);
  if (aggregation === 'max') return values.reduce((max, value) => Math.max(max, value), -Infinity);
  throw new Error('Chưa xác định phép gộp cho các quan sát lặp lại trong cùng nhóm.');
}

/** Use only declared columns and AI exclusions; never infer group/total names from labels. */
export function buildPieChartData(records, columns, selection, region, bindings = {}) {
  const { groups, measures } = pieChartFields(columns, bindings);
  const group = groups.find(column => column.name === selection.groupField);
  const label = column => column.labelVi || column.name;
  const aggregation = column => selection.aggregation === 'auto' ? column.aggDefault : selection.aggregation;
  let data, unit = '', valueLabel = 'Số bản ghi';
  if (selection.groupField) {
    if (!group) throw new Error('Chọn cột phân nhóm hợp lệ cho biểu đồ tròn.');
    const metric = measures.find(column => column.name === selection.measure);
    if (!metric && selection.measure !== 'count') throw new Error('Chưa có chỉ số hợp lệ để tính tỷ trọng.');
    const excluded = new Set(selection.excludedValues || []);
    const buckets = new Map();
    for (const record of records) {
      const name = record[group.name];
      if (excluded.has(String(name))) continue;
      if (name == null || String(name).trim() === '') throw new Error('Có bản ghi chưa có nhóm thành phần.');
      const key = String(name);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(metric ? numericMapValue(record[metric.name]) : 1);
    }
    data = [...buckets].map(([name, values]) => ({ name, value: metric ? aggregate(values, aggregation(metric)) : values.length }));
    unit = metric?.unit || '';
    valueLabel = metric ? label(metric) : valueLabel;
  } else {
    const selected = (selection.metrics || []).map(name => measures.find(column => column.name === name));
    if (selected.length < 2 || selected.some(column => !column)) throw new Error('Chọn ít nhất hai chỉ số thành phần cùng đơn vị.');
    if (new Set(selected.map(measureUnit)).size !== 1) throw new Error('Các thành phần của biểu đồ tròn phải cùng đơn vị.');
    unit = selected[0].unit || '';
    valueLabel = 'Giá trị';
    data = selected.map(column => ({ name: selected.filter(item => label(item) === label(column)).length > 1 ? `${label(column)} (${column.name})` : label(column),
      value: aggregate(records.map(record => numericMapValue(record[column.name])), aggregation(column)) }));
  }
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Tổng giá trị phải lớn hơn 0 để tính tỷ trọng.');
  if (data.filter(item => item.value > 0).length < 2) throw new Error('Biểu đồ tròn cần ít nhất hai nhóm có giá trị lớn hơn 0.');
  if (unit.trim() === '%' && Math.abs(total - 100) > .5) throw new Error('Các tỷ lệ phần trăm phải tạo thành tổng 100%. Kiểm tra nhóm, dòng tổng và khoảng thời gian.');
  return { chartKind: 'pie', title: `${selection.title || 'Cơ cấu tỷ trọng'} · ${region}`,
    groupLabel: group ? label(group) : 'Thành phần', valueLabel, unit, data,
    showLegend: true, showTooltip: true, showTable: true, animate: false };
}

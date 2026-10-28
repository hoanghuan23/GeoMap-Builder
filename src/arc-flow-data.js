import { numericMapValue } from './map-value.js';
import { AGGREGATION_VALUES, measureAggregation } from './measure-semantics.js';
import { timeValueInfo } from './time-values.js';
import { serializeTabularValue } from './tabular-data.js';

export const ARC_FLOW_REQUIRED_BINDINGS = Object.freeze(['source', 'target', 'sourceLat', 'sourceLng', 'targetLat', 'targetLng', 'value']);
export const ARC_FLOW_COLORS = Object.freeze({ low: '#ef4444', medium: '#facc15', high: '#22c55e' });
export const DEFAULT_ARC_FLOW_STYLE = Object.freeze({ height: 1, width: 1, opacity: .75, speed: 1, animated: true, showLabels: true, showLegend: true });
const fc = features => ({ type: 'FeatureCollection', features });
const label = value => value == null || typeof value === 'object' ? '' : String(value).normalize('NFC').trim();
const valueKey = value => String(serializeTabularValue(value) ?? '');

export function mergeArcFlowStyle(raw = {}) {
  const bounded = (key, min, max) => Math.min(max, Math.max(min, numericMapValue(raw[key]) ?? DEFAULT_ARC_FLOW_STYLE[key]));
  return { height: bounded('height', .25, 2), width: bounded('width', .25, 3), opacity: bounded('opacity', 0, 1), speed: bounded('speed', .25, 3),
    ...Object.fromEntries(['animated', 'showLabels', 'showLegend'].map(key => [key, typeof raw[key] === 'boolean' ? raw[key] : DEFAULT_ARC_FLOW_STYLE[key]])) };
}

/** Validation is independent of AI confidence and preserves source row references. */
export function createArcFlowModel(records, columns, suggestion) {
  const bindings = suggestion.bindings;
  const metric = columns.find(column => column.name === bindings.value);
  const aggregation = AGGREGATION_VALUES.includes(suggestion.agg) ? suggestion.agg : measureAggregation(metric);
  const reasons = { missingEndpoint: 0, missingCoordinates: 0, invalidCoordinates: 0, missingValue: 0, negativeValue: 0, samePosition: 0 };
  const rows = [];
  records.forEach((record, index) => {
    const sourceName = label(record[bindings.source]); const targetName = label(record[bindings.target]);
    if (!sourceName || !targetName) { reasons.missingEndpoint++; return; }
    const coordinates = ['sourceLng', 'sourceLat', 'targetLng', 'targetLat'].map(key => numericMapValue(record[bindings[key]]));
    if (coordinates.some(value => value == null)) { reasons.missingCoordinates++; return; }
    const [sx, sy, tx, ty] = coordinates;
    if (Math.abs(sx) > 180 || Math.abs(tx) > 180 || Math.abs(sy) > 90 || Math.abs(ty) > 90) { reasons.invalidCoordinates++; return; }
    const value = numericMapValue(record[bindings.value]);
    if (value == null) { reasons.missingValue++; return; }
    if (value < 0) { reasons.negativeValue++; return; }
    if (sx === tx && sy === ty) { reasons.samePosition++; return; }
    const source = { id: JSON.stringify([sourceName, sx, sy]), name: sourceName, position: [sx, sy] };
    const target = { id: JSON.stringify([targetName, tx, ty]), name: targetName, position: [tx, ty] };
    rows.push({ record, index, source, target, value, id: JSON.stringify([source.id, target.id]) });
  });
  const validRate = records.length ? rows.length / records.length : 0;
  const duplicateOD = new Set(rows.map(row => row.id)).size < rows.length;
  const unavailableReason = validRate < .7 ? 'Ít hơn 70% dòng có đủ hai đầu, tọa độ và lưu lượng hợp lệ.'
    : !rows.length ? 'Không có luồng hợp lệ để hiển thị.'
      : duplicateOD && !aggregation ? 'Có nhiều bản ghi cùng cặp đi–đến nhưng chưa xác định phép tổng hợp cho chỉ số.' : '';
  return { bindings, columns, rows, aggregation, unit: aggregation === 'count' ? 'bản ghi' : metric?.unit || '', metricLabel: metric?.labelVi || bindings.value,
    stats: { totalRows: records.length, validRows: rows.length, invalidRows: records.length - rows.length, validRate, reasons },
    available: !unavailableReason, unavailableReason };
}

function quantile(sorted, p) {
  const at = (sorted.length - 1) * p; const low = Math.floor(at); const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/** Actual occupied classes only; repeated thresholds never produce empty legend bands. */
export function classifyArcFlows(flows) {
  const sorted = flows.map(flow => flow.value).sort((a, b) => a - b);
  const distinct = [...new Set(sorted)];
  if (!sorted.length) return { flows: [], legend: [], thresholds: [] };
  const thresholds = distinct.length === 1 ? [] : distinct.length === 2 ? [distinct[0]] : [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
  const classified = flows.map(flow => {
    const level = distinct.length === 1 ? 'medium' : flow.value <= thresholds[0] ? 'low' : thresholds.length === 1 || flow.value > thresholds[1] ? 'high' : 'medium';
    return { ...flow, level, color: ARC_FLOW_COLORS[level] };
  });
  const legend = ['low', 'medium', 'high'].flatMap(level => {
    const values = classified.filter(flow => flow.level === level).map(flow => flow.value);
    if (!values.length) return [];
    return [{ id: level, label: distinct.length === 1 ? 'Lưu lượng' : { low: 'Thấp', medium: 'Trung bình', high: 'Cao' }[level],
      color: ARC_FLOW_COLORS[level], min: values.reduce((min, value) => Math.min(min, value), Infinity),
      max: values.reduce((max, value) => Math.max(max, value), -Infinity), count: values.length }];
  });
  return { flows: classified, legend, thresholds };
}

function aggregateRows(rows, aggregation) {
  const values = rows.map(row => row.value);
  if (aggregation === 'count') return rows.length;
  if (aggregation === 'sum') return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === 'min') return values.reduce((min, value) => Math.min(min, value), Infinity);
  if (aggregation === 'max') return values.reduce((max, value) => Math.max(max, value), -Infinity);
  return rows.length === 1 ? values[0] : null;
}

export function buildArcFlowView(model, selection = {}) {
  const b = model.bindings;
  let rows = model.rows.filter(row => (!selection.sourceId || row.source.id === selection.sourceId) && (!selection.targetId || row.target.id === selection.targetId)
    && Object.entries(selection.filters || {}).every(([field, value]) =>
    value == null || value === '' || (Array.isArray(value) ? !value.length || value.includes(valueKey(row.record[field])) : valueKey(row.record[field]) === String(value))));
  const time = model.columns.find(column => column.name === b.time);
  if (time && selection.time != null && selection.time !== '') {
    const selected = timeValueInfo(selection.time, time);
    rows = rows.filter(row => selected && timeValueInfo(row.record[time.name], time)?.key === selected.key);
  }
  const groups = new Map();
  for (const row of rows) { if (!groups.has(row.id)) groups.set(row.id, []); groups.get(row.id).push(row); }
  let aggregationIssues = 0;
  const aggregated = [...groups.values()].flatMap(group => {
    const value = aggregateRows(group, model.aggregation);
    if (value == null || !Number.isFinite(value)) { aggregationIssues++; return []; }
    const properties = Object.create(null);
    for (const column of model.columns) {
      const values = [...new Map(group.map(row => [valueKey(row.record[column.name]), serializeTabularValue(row.record[column.name])])).values()];
      properties[column.name] = column.name === b.value ? value : values.length === 1 ? values[0] : values;
    }
    return [{ id: group[0].id, source: group[0].source, target: group[0].target, value, properties, rowIndices: group.map(row => row.index) }];
  });
  const classified = classifyArcFlows(aggregated);
  const flows = classified.flows.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const limit = [50, 100, 250].includes(Number(selection.topN)) ? Number(selection.topN) : selection.topN === 'all' ? flows.length : 100;
  const visibleFlows = flows.slice(0, limit);
  const nodes = new Map();
  for (const flow of flows) {
    for (const [point, direction] of [[flow.source, 'outbound'], [flow.target, 'inbound']]) {
      if (!nodes.has(point.id)) nodes.set(point.id, { ...point, inbound: 0, outbound: 0 });
      nodes.get(point.id)[direction] += flow.value;
    }
  }
  const features = flows.map(flow => ({ type: 'Feature', id: flow.id, properties: { ...flow.properties, __arcId: flow.id, __level: flow.level },
    geometry: { type: 'LineString', coordinates: [flow.source.position, flow.target.position] } }));
  const points = fc([...nodes.values()].map(point => ({ type: 'Feature', properties: { __arcNodeId: point.id, __arcName: point.name,
    __inbound: point.inbound, __outbound: point.outbound }, geometry: { type: 'Point', coordinates: point.position } })));
  return { flows, visibleFlows, nodes: points, data: fc(features), tableRecords: flows.map(flow => flow.properties), legend: classified.legend,
    thresholds: classified.thresholds, total: flows.reduce((sum, flow) => sum + flow.value, 0), aggregationIssues,
    filteredRows: rows.length, selection, model };
}

/** One shared sampled path is used by the base stroke and moving trails. */
export function arcFlowPath(flow, heightScale = 1, segments = 64) {
  const radians = Math.PI / 180;
  const [sx, sy] = flow.source.position; const [tx, ty] = flow.target.position;
  const dx = ((tx - sx + 540) % 360) - 180; const dy = ty - sy;
  const meanLat = (sy + ty) * .5 * radians;
  const x = dx * Math.cos(meanLat); const distance = Math.hypot(x, dy) * 111_195;
  // Keep elevation proportional to the route at every map scale. A fixed metre
  // ceiling makes intercity routes look flat even with a pitched camera.
  const height = Math.max(30, distance * .3) * heightScale;
  const length = Math.hypot(x, dy) || 1;
  // Reversing the OD reverses its lateral normal, separating reciprocal flows.
  const offset = length * .025;
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments; const bend = 4 * t * (1 - t);
    return [sx + dx * t - dy / length * offset * bend / Math.max(.01, Math.cos(meanLat)), sy + dy * t + x / length * offset * bend, height * bend];
  });
}

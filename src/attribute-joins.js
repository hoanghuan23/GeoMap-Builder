import { normalizePopupContent } from './popup-content-contract.js';

export function normalizeJoinValue(value) {
  if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) return '';
  return String(value).normalize('NFC').trim().toLocaleLowerCase('vi-VN').replace(/\s+/gu, ' ');
}

export function attributeKey(record, fields) {
  const values = fields.map(field => normalizeJoinValue(record?.[field]));
  return values.every(Boolean) ? JSON.stringify(values) : null;
}

export function workspaceLayerRecords(layer, dataset) {
  const data = layer?.runtime?.state?.aiDataset || dataset;
  if (data?.nativeGeometry) return data.records;
  if (Array.isArray(data?.rawRecords)) return data.rawRecords;
  if (Array.isArray(data?.records)) return data.records;
  const spatial = layer?.runtime?.state?.sourceBoundary || data?.data || data?.spatialData;
  return spatial?.features?.map(feature => feature.properties || {}) || [];
}

function entityIdentity(record, layer, index) {
  const dataset = layer.runtime?.state?.aiDataset;
  const identityField = dataset?.nativeGeometry?.identityField;
  if (identityField) return String(record[identityField]);
  const columns = layer.descriptor?.columns || [];
  const suggestion = dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
  const bindings = suggestion?.bindings || {};
  const lat = bindings.lat || columns.find(column => column.geoLevel === 'point_lat')?.name;
  const lng = bindings.lng || columns.find(column => column.geoLevel === 'point_lng')?.name;
  const id = columns.find(column => column.role === 'id' && !column.name.startsWith('__'))?.name;
  // Coordinates distinguish separate objects with identical names. Repeated observations
  // at the same object remain one target, rather than becoming an ambiguous join.
  if (lat && lng) return JSON.stringify([record[lat], record[lng], id ? record[id] : null]);
  if (id && normalizeJoinValue(record[id])) return JSON.stringify([id, normalizeJoinValue(record[id])]);
  if (bindings.region) return JSON.stringify([record[bindings.region], ...columns.filter(column => column.role === 'geo').map(column => record[column.name])]);
  return String(index);
}

/** Local exact matching. Data stays in its original dataset; only row references are retained. */
export function buildAttributeJoin(proposal, source, target, sourceRecords, targetRecords) {
  const sourceFields = proposal.keyPairs.map(pair => pair.sourceField);
  const targetFields = proposal.keyPairs.map(pair => pair.targetField);
  const targets = new Map(); const entities = new Set();
  targetRecords.forEach((record, index) => {
    const entity = entityIdentity(record, target, index); entities.add(entity);
    const key = attributeKey(record, targetFields);
    if (!key) return;
    if (!targets.has(key)) targets.set(key, new Set());
    targets.get(key).add(entity);
  });
  const recordsByKey = new Map(); const matched = new Set();
  const stats = { matchedObjects: 0, unmatchedObjects: 0, matchedRows: 0, unmatchedRows: 0, missingKeyRows: 0, ambiguousRows: 0 };
  for (const record of sourceRecords) {
    const key = attributeKey(record, sourceFields);
    const candidates = key && targets.get(key);
    if (!key) stats.missingKeyRows++;
    if (candidates?.size > 1) stats.ambiguousRows++;
    if (!candidates || candidates.size !== 1) { stats.unmatchedRows++; continue; }
    stats.matchedRows++;
    matched.add([...candidates][0]);
    if (!recordsByKey.has(key)) recordsByKey.set(key, []);
    recordsByKey.get(key).push(record);
  }
  stats.matchedObjects = matched.size; stats.unmatchedObjects = entities.size - matched.size;
  return { ...proposal, popupContent: normalizePopupContent(proposal.popupContent, source.descriptor.columns), recordsByKey, stats };
}

export function joinedPopupSources(workspace, targetLayerId, feature) {
  return (workspace.attributeJoins || []).filter(join => join.targetLayerId === targetLayerId).flatMap(join => {
    const source = workspace.layersById[join.sourceId];
    const key = attributeKey(feature?.properties, join.keyPairs.map(pair => pair.targetField));
    const records = key && join.recordsByKey.get(key);
    return source && records?.length ? [{ sourceId: source.id, title: source.runtime?.state?.fileName || source.title, columns: source.descriptor.columns,
      records, popupContent: join.popupContent }] : [];
  });
}

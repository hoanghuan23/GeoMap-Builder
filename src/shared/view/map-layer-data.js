import { normalizePopupContent } from '../popup/popup-content-contract.js';
import { geometryKinds } from '../geography/geojson-layers.js';

const extentCache = new WeakMap();

export function asFeatureCollection(data) {
  if (!data) return { type: 'FeatureCollection', features: [] };
  if (data.type === 'FeatureCollection') return data;
  return { type: 'FeatureCollection', features: [data.type === 'Feature' ? data : { type: 'Feature', properties: {}, geometry: data }] };
}

export function geometryExtent(data) {
  if (!data || typeof data !== 'object') return null;
  // Geometry updates create a new GeoJSON object; style/property edits reuse it.
  // Weak keys let discarded datasets leave the cache with no explicit cleanup.
  if (extentCache.has(data)) return extentCache.get(data)?.slice() || null;
  const extent = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = coordinates => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === 'number') {
      const [x, y] = coordinates;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) return;
      extent[0] = Math.min(extent[0], x); extent[1] = Math.min(extent[1], y);
      extent[2] = Math.max(extent[2], x); extent[3] = Math.max(extent[3], y);
    } else coordinates.forEach(visit);
  };
  const geometry = value => { if (value?.type === 'GeometryCollection') value.geometries.forEach(geometry); else visit(value?.coordinates); };
  asFeatureCollection(data).features.forEach(feature => geometry(feature.geometry));
  const result = extent.every(Number.isFinite) ? extent : null;
  extentCache.set(data, result);
  return result?.slice() || null;
}

export function layerData(subject) {
  if (subject?.getView) return subject.getView().data;
  return subject?.data || subject?.boundary || subject?.sourceBoundary || (subject?.uploadLayers?.length ? { type: 'FeatureCollection',
    features: subject.uploadLayers.flatMap(layer => asFeatureCollection(layer.data).features) } : null);
}

export function describeWorkspaceLayer(id, runtime, title) {
  const state = runtime.state || runtime;
  const dataset = state.aiDataset;
  const analysis = dataset?.analysis || state.spatialAnalysis;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  const view = runtime.getView?.();
  const data = view ? view.sourceData || view.data : dataset?.nativeGeometry ? { type: 'FeatureCollection', features: dataset.nativeGeometry.features }
    : dataset?.boundaries?.features?.length ? dataset.boundaries : dataset?.spatialData || state.sourceBoundary || layerData(state);
  const columns = analysis?.columns || [
    ...(state.dataProfile?.textFields || []).map(name => ({ name, role: 'text' })),
    ...(state.dataProfile?.numericFields || []).map(name => ({ name, role: 'measure' }))
  ];
  const time = columns.find(column => column.role === 'time');
  const extent = geometryExtent(data);
  const sourceKind = !extent && dataset && !dataset.suggestions?.length ? 'attribute' : 'spatial';
  return { id, title, sourceKind, popupContent: normalizePopupContent(analysis?.popupContent, columns), popupSuggestions: suggestion?.popupSuggestions || [], grain: analysis?.grain || 'Đối tượng không gian từ geometry có sẵn', chartType: suggestion?.chartType || state.mapType,
    available: Boolean(extent) && (!dataset || suggestion?.available === true) && Boolean(state.mapType || state.uploadLayers?.length),
    geometryKinds: geometryKinds(data), extent, columns,
    time: time ? { field: time.name, granularity: time.granularity || '', count: dataset?.profile?.columns?.find(column => column.name === time.name)?.uniqueCount || 0 } : null,
    search_bar: analysis?.search_bar !== false, search_fields: analysis?.search_fields || columns.filter(column => ['text', 'geo', 'id', 'category'].includes(column.role)).slice(0, 3).map(column => column.name) };
}

export function tableRecords(subject) {
  if (subject?.getView) return subject.getView().tableRecords || [];
  if (subject?.tableRecords) return subject.tableRecords;
  if (subject?.aiDataset && (!subject.mapType || !geometryExtent(layerData(subject)))) return subject.aiDataset.records;
  return asFeatureCollection(layerData(subject)).features.map(feature => feature.properties || {});
}

export function csvForRecords(records) {
  const columns = [...new Set(records.flatMap(record => Object.keys(record).filter(key => !key.startsWith('__'))))];
  const cell = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+@\t\r]/.test(text) || /^-[^\d.]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\ufeff' + [columns, ...records.map(record => columns.map(column => record[column]))].map(row => row.map(cell).join(',')).join('\n');
}

import { geometryKinds } from './geojson-layers.js';

export function asFeatureCollection(data) {
  if (!data) return { type: 'FeatureCollection', features: [] };
  if (data.type === 'FeatureCollection') return data;
  return { type: 'FeatureCollection', features: [data.type === 'Feature' ? data : { type: 'Feature', properties: {}, geometry: data }] };
}

export function geometryExtent(data) {
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
  return extent.every(Number.isFinite) ? extent : null;
}

export function layerData(state) {
  if (state.mapType === 'point' || state.mapType === 'heatmap') return state.pointData;
  if (state.mapType === 'line') return state.lineData;
  if (state.mapType === 'h3' || state.regionHexEnabled) return state.h3Data;
  return state.boundary || state.sourceBoundary || (state.uploadLayers?.length ? { type: 'FeatureCollection',
    features: state.uploadLayers.flatMap(layer => asFeatureCollection(layer.data).features) } : null);
}

export function describeWorkspaceLayer(id, state, title) {
  const dataset = state.aiDataset;
  const analysis = dataset?.analysis || state.spatialAnalysis;
  const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
  const data = dataset?.nativeGeometry ? { type: 'FeatureCollection', features: dataset.nativeGeometry.features }
    : dataset?.boundaries?.features?.length ? dataset.boundaries : state.sourceBoundary || layerData(state);
  const columns = analysis?.columns || [
    ...(state.dataProfile?.textFields || []).map(name => ({ name, role: 'text' })),
    ...(state.dataProfile?.numericFields || []).map(name => ({ name, role: 'measure' }))
  ];
  const time = columns.find(column => column.role === 'time');
  return { id, title, grain: analysis?.grain || 'Đối tượng không gian từ geometry có sẵn', chartType: suggestion?.chartType || state.mapType,
    available: Boolean(geometryExtent(data)) && (!dataset || suggestion?.available === true) && Boolean(state.mapType || state.uploadLayers?.length),
    geometryKinds: geometryKinds(data), extent: geometryExtent(data), columns,
    time: time ? { field: time.name, granularity: time.granularity || '', count: dataset?.profile?.columns?.find(column => column.name === time.name)?.uniqueCount || 0 } : null,
    search_bar: analysis?.search_bar !== false, search_fields: analysis?.search_fields || columns.filter(column => ['text', 'geo', 'id', 'category'].includes(column.role)).slice(0, 3).map(column => column.name) };
}

export function tableRecords(state) {
  if (!layerData(state) && state.aiDataset) return state.aiDataset.records;
  return asFeatureCollection(layerData(state)).features.map(feature => feature.properties || {});
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

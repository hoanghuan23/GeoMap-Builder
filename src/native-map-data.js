import { asFeatureCollection } from './map-layer-data.js';
import { geometryKinds } from './geojson-layers.js';
import { applyPipelineFilters, prepareSuggestions } from './ai-chart-pipeline.js';

/** Supplied geometry is authoritative. Internal identities are added only after AI analysis. */
export function nativeMapDataset(data, pipeline, fileName) {
  const kinds = geometryKinds(data);
  if (kinds.length !== 1 || !['area', 'line'].includes(kinds[0])) return null;
  const features = asFeatureCollection(data).features;
  const fields = new Set(pipeline.analysis.columns.map(column => column.name));
  let identityField = '__native_feature_key'; while (fields.has(identityField)) identityField += '_';
  const titleField = pipeline.analysis.search_fields?.[0] || pipeline.analysis.columns.find(column => ['geo', 'text', 'category'].includes(column.role))?.name;
  const columns = [...pipeline.analysis.columns, { name: identityField, role: 'id', source: 'rule' }];
  const identities = new Map();
  const records = pipeline.records.map((record, index) => {
    const feature = features[index];
    const key = feature.id != null ? `id:${feature.id}` : JSON.stringify([feature.geometry, titleField ? record[titleField] : null]);
    if (!identities.has(key)) identities.set(key, String(identities.size + 1));
    return { ...record, [identityField]: identities.get(key) };
  });
  const chartType = kinds[0] === 'area' ? 'choropleth' : 'map_line';
  const supplied = pipeline.analysis.suggestions.find(suggestion => suggestion.chartType === chartType);
  const suggestion = supplied ? { ...supplied,
    bindings: { ...supplied.bindings, lat: null, lng: null, region: identityField, nativeIdentity: identityField, value: supplied.bindings.value || null },
    available: true, feasibilityScore: 1, effectiveConfidence: supplied.confidence, nativeGeometry: true } : null;
  const arcs = prepareSuggestions({ ...pipeline.analysis, columns, suggestions: pipeline.analysis.suggestions.filter(item => item.chartType === 'arc_flow') },
    records, pipeline.validRowRate, { mapOnly: true });
  const suggestions = [...(suggestion ? [suggestion] : []), ...arcs].sort((a, b) => b.confidence - a.confidence);
  return { ...pipeline, records, rawRecords: pipeline.rawRecords || features.map(feature => feature.properties || {}), analysis: { ...pipeline.analysis, columns }, fileName,
    suggestions, selectedSuggestionId: suggestions.find(item => item.available)?.id || null,
    nativeGeometry: { features, records, identityField, titleField }, nativeTitleField: titleField,
    popupSelections: {}, filters: {}, geoAliases: {}, geoSelections: {}, roadColorOverrides: {}, recommendation: null };
}

export function nativeMapView(dataset, filters) {
  const { features, records, titleField, identityField } = dataset.nativeGeometry;
  const selected = new Set(applyPipelineFilters(records, filters));
  return { type: 'FeatureCollection', features: features.flatMap((feature, index) => selected.has(records[index]) ? [{ ...feature,
    id: records[index][identityField], properties: { ...records[index], __data_location: records[index][identityField],
      __location: String(records[index][titleField] || feature.id || index + 1) } }] : []),
    stats: { totalRows: records.length, matchedRows: selected.size } };
}

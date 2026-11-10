// Session presentation settings never remove columns or records from the source.
export function visibleDatasetColumns(dataset, columns = dataset?.analysis?.columns || []) {
  const hidden = new Set(dataset?.hiddenMetricFields || []);
  return hidden.size ? columns.filter(column => !hidden.has(column.name)) : columns;
}

/** Keep AI priority; an explicit [] means there are no useful display choices. */
export function mapDisplayColumns(dataset, suggestion, columns, { includeHidden = false } = {}) {
  const fields = dataset?.metricFieldsConfigured ? null : suggestion?.mapDisplayFields
    ?? (suggestion?.chartType === 'point' ? suggestion.pointGroupFields : null);
  const byName = new Map(columns.map(column => [column.name, column]));
  const proposed = Array.isArray(fields) ? [...new Set(fields)].map(name => byName.get(name)).filter(Boolean) : columns;
  return includeHidden ? proposed : visibleDatasetColumns(dataset, proposed);
}

export function popupDisplayColumns(dataset, columns = dataset?.analysis?.columns || []) {
  const available = visibleDatasetColumns(dataset, columns);
  const fields = dataset?.popupFields ?? dataset?.analysis?.popupFields;
  const byName = new Map(available.map(column => [column.name, column]));
  return Array.isArray(fields) ? fields.map(name => byName.get(name)).filter(Boolean) : available;
}

/** Validate choices by map semantics without making suitability decisions for AI. */
export function normalizeMapDisplayFields(fields, suggestion, columns) {
  const b = suggestion.bindings;
  const excluded = new Set(Object.entries(b).filter(([slot]) => !['value', 'group'].includes(slot)).map(([, name]) => name));
  const byName = new Map(columns.map(column => [column.name, column]));
  return [...new Set(fields)].filter(name => {
    const column = byName.get(name);
    if (!column || name.startsWith('__') || ['point_lat', 'point_lng', 'h3'].includes(column.geoLevel)) return false;
    if (suggestion.chartType === 'point') return ![b.lat, b.lng].includes(name) && ['category', 'text', 'geo'].includes(column.role);
    if (excluded.has(name)) return false;
    return column.role === 'measure' || suggestion.chartType !== 'arc_flow' && column.role === 'category';
  });
}

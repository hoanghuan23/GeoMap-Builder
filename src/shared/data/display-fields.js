// Session presentation settings never remove columns or records from the source.
export function visibleDatasetColumns(dataset, columns = dataset?.analysis?.columns || []) {
  const hidden = new Set(dataset?.hiddenMetricFields || []);
  return hidden.size ? columns.filter(column => !hidden.has(column.name)) : columns;
}

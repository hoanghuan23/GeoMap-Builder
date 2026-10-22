import { geometryExtent } from './map-layer-data.js';

const cellIds = data => new Set((Array.isArray(data) ? data : data?.features || []).map(item => String(item.cell_id ?? item.properties?.cell_id ?? item.properties?.h3 ?? '')).filter(Boolean));

/** Structural Metro parts need matching cell IDs; optional geometry needs one unambiguous bundle. */
export function matchingMetroBundle(items, result) {
  const role = result.metroRole;
  const measured = (result.pipeline || result.nativePipeline)?.analysis.columns.some(column => column.role === 'measure');
  if (!['hexagons', 'travel_times'].includes(role) && measured) return null;
  const candidates = items.filter(item => {
    if (!item.metroBundle || item.api.state.metroParts[role]) return false;
    const parts = item.api.state.metroParts;
    if (role === 'hexagons' || role === 'travel_times') {
      const counterpart = parts[role === 'hexagons' ? 'travel_times' : 'hexagons'];
      if (!counterpart) return false;
      const incoming = cellIds(result.data); const existing = cellIds(counterpart.data);
      return incoming.size > 0 && [...incoming].some(id => existing.has(id));
    }
    const a = geometryExtent(result.data); const b = geometryExtent(parts.hexagons?.data);
    return a && b && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  });
  return candidates.length === 1 ? candidates[0] : null;
}

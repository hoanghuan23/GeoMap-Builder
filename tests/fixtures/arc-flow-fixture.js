export const bindings = { source: 'origin', target: 'destination', sourceLat: 'origin_lat', sourceLng: 'origin_lng', targetLat: 'destination_lat', targetLng: 'destination_lng', value: 'passengers', time: 'date', group: 'period' };
export const columns = Object.entries(bindings).map(([slot, name]) => ({ name,
  role: slot === 'value' ? 'measure' : slot === 'time' ? 'time' : slot.endsWith('Lat') || slot.endsWith('Lng') ? 'geo' : 'category',
  geoLevel: slot.endsWith('Lat') ? 'point_lat' : slot.endsWith('Lng') ? 'point_lng' : null,
  unit: slot === 'value' ? 'lượt' : null, aggDefault: slot === 'value' ? 'sum' : null,
  ...(slot === 'time' ? { timeParse: 'iso', granularity: 'day' } : {}) }));
export const suggestion = { id: 'flows', chartType: 'arc_flow', title: 'Luồng hành khách', bindings, agg: 'sum', confidence: .94,
  reason: 'Mỗi dòng là một quan hệ có hướng.', popupSuggestions: [{ name: 'info', confidence: .95 }] };
export function row(overrides = {}) {
  return { origin: 'A', destination: 'B', origin_lat: 10.7, origin_lng: 106.7, destination_lat: 10.8, destination_lng: 106.8,
    passengers: 10, date: '2026-09-15', period: 'Sáng', ...overrides };
}
export const analysis = { datasetTitle: 'Luồng hành khách', grain: 'Một dòng cho mỗi OD theo ngày/khung giờ',
  columns, suggestions: [suggestion], search_bar: true, search_fields: ['origin', 'destination'], popupContent: null };

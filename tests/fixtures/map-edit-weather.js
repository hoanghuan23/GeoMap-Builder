const weatherLegend = { aggregation: null, type: 'categorical', mode: 'semantic', title: 'Thời tiết', unit: null, domain: null, center: null,
  stops: [{ value: 'Nắng', color: '#ffb020' }, { value: 'Mưa', color: '#2688cc' }], combinations: [], reason: 'Dữ liệu kiểm thử phân loại.' };
const fields = [
  ['temperature', 'Nhiệt độ trung bình', '°C', '🌡'], ['minimum', 'Nhiệt độ thấp nhất', '°C', '❄'],
  ['maximum', 'Nhiệt độ cao nhất', '°C', '☀'], ['humidity', 'Độ ẩm', '%', '💧'],
  ['rain', 'Lượng mưa', 'mm', '🌧'], ['pollution', 'Mức độ ô nhiễm', null, '🏭']
];
export const weatherEditColumns = [
  { name: 'name', labelVi: 'Tỉnh/thành phố', role: 'geo', geoLevel: 'admin1' }, { name: 'day', labelVi: 'Ngày', role: 'time' },
  ...fields.map(([name, labelVi, unit]) => ({ name, labelVi, unit, role: 'measure', aggDefault: 'mean' })),
  { name: 'weather', labelVi: 'Tình trạng thời tiết', role: 'category', legend: weatherLegend }
];
export const weatherEditRows = [1, 2].map(day => ({ name: 'Area', day: `2026-09-0${day}`, temperature: 27 + day,
  minimum: 20, maximum: 32, humidity: 70, rain: day, pollution: 20 + day, weather: day === 1 ? 'Nắng' : 'Mưa' }));
export const weatherEditSuggestion = { id: 'weather-and-pollution', chartType: 'choropleth', title: 'Thời tiết và ô nhiễm',
  bindings: { region: 'name', value: 'temperature' }, agg: 'mean', metricButtons: [
    ...fields.map(([field, label, , icon]) => ({ field, label, icon, color: '#2688cc' })),
    { field: 'weather', label: 'Thời tiết', icon: '🌤', color: '#ffb020' }
  ] };

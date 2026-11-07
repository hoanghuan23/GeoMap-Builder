// Reference data only. The application never imports these categories or values.
export const pieColumns = [
  { name: 'region', labelVi: 'Khu vực', role: 'geo', geoLevel: 'admin1' },
  { name: 'vehicle', labelVi: 'Phương tiện', role: 'category' },
  { name: 'trips', labelVi: 'Số lượt di chuyển', role: 'measure', unit: 'lượt', aggDefault: 'sum' }
];
export const pieRows = [['Xe máy', 5000], ['Ô tô', 2500], ['Xe buýt', 1500], ['Xe đạp', 700], ['Khác', 300], ['Tổng', 10000]]
  .map(([vehicle, trips]) => ({ region: 'A', vehicle, trips }));
export const pieBinding = { groupField: 'vehicle', valueField: 'trips', measureFields: [], excludedValues: ['Tổng'], title: 'Cơ cấu phương tiện giao thông' };
export const pieSuggestion = { id: 'composition', chartType: 'choropleth', title: 'Cơ cấu', bindings: { region: 'region', value: 'trips' },
  popupSuggestions: [{ name: 'pie', confidence: .99, pie: pieBinding }, { name: 'info', confidence: .8 }] };

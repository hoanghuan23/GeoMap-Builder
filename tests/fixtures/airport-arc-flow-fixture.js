// The 20 directed airport routes in the reported spreadsheet, including decimal commas.
export function airportArcFlowFixture() {
  const airports = [
    ['Nội Bài, Việt Nam', 'Việt Nam', '21,2212', '105,8072'],
    ['Suvarnabhumi, Thái Lan', 'Thái Lan', '13,69', '100,7501'],
    ['Changi, Singapore', 'Singapore', '1,3644', '103,9915'],
    ['Incheon, Hàn Quốc', 'Hàn Quốc', '37,4602', '126,4407'],
    ['Dubai, UAE', 'UAE', '25,2532', '55,3657'],
    ['Soekarno-Hatta, Indonesia', 'Indonesia', '-6,1256', '106,6559'],
    ['Kuala Lumpur, Malaysia', 'Malaysia', '2,7456', '101,7072'],
    ['Narita, Nhật Bản', 'Nhật Bản', '35,772', '140,3929'],
    ['Sydney, Úc', 'Úc', '-33,9399', '151,1753'],
    ['Los Angeles, Mỹ', 'Mỹ', '33,9416', '-118,4085'],
    ['Heathrow, Anh', 'Anh', '51,47', '-0,4543'],
    ['Charles de Gaulle, Pháp', 'Pháp', '49,0097', '2,5479']
  ];
  const routes = [
    [0, 1, 7200], [0, 2, 15400], [0, 3, 18200], [0, 4, 10900],
    [1, 2, 8400], [1, 5, 3500], [2, 6, 2350], [2, 7, 19900],
    [6, 5, 6300], [6, 4, 12800], [5, 8, 9200], [3, 7, 21100],
    [3, 9, 12500], [7, 9, 27800], [4, 10, 16400], [4, 11, 11500],
    [10, 9, 20400], [10, 11, 14600], [9, 8, 17600], [11, 0, 6800]
  ];
  const records = routes.map(([source, target, passengers], i) => ({
    'Ngày': `2026-09-${15 + i % 4}`,
    'Sân bay đi': airports[source][0], 'Quốc gia đi': airports[source][1],
    'Sân bay đến': airports[target][0], 'Quốc gia đến': airports[target][1],
    'Vĩ độ đi': airports[source][2], 'Kinh độ đi': airports[source][3],
    'Vĩ độ đến': airports[target][2], 'Kinh độ đến': airports[target][3],
    'Số lượng hành khách': passengers
  }));
  const bindings = { source: 'Sân bay đi', target: 'Sân bay đến', sourceLat: 'Vĩ độ đi', sourceLng: 'Kinh độ đi',
    targetLat: 'Vĩ độ đến', targetLng: 'Kinh độ đến', value: 'Số lượng hành khách', time: 'Ngày', group: null };
  const columns = Object.keys(records[0]).map(name => ({ name,
    role: name === bindings.value ? 'measure' : name === bindings.time ? 'time'
      : name.startsWith('Sân bay') ? 'category' : 'geo',
    geoLevel: name.startsWith('Vĩ độ') ? 'point_lat' : name.startsWith('Kinh độ') ? 'point_lng'
      : name.startsWith('Quốc gia') ? 'country' : null,
    unit: name === bindings.value ? 'lượt hành khách' : null,
    aggDefault: name === bindings.value ? 'sum' : null,
    ...(name === bindings.time ? { timeParse: 'iso', granularity: 'day' } : {})
  }));
  const suggestion = { id: 'arc-flow-passengers', chartType: 'arc_flow', title: 'Bản đồ Arc Flow 3D',
    bindings, agg: 'sum', confidence: .96, reason: 'Mỗi dòng đo lưu lượng có hướng giữa hai sân bay theo ngày.',
    popupSuggestions: [{ name: 'info', confidence: .95 }], metricButtons: [], legend: null, geographicScopes: [] };
  return { records, bindings, columns, suggestion, analysis: {
    datasetTitle: 'Luồng hành khách hàng không', grain: 'Một cặp sân bay đi–đến theo ngày',
    columns, suggestions: [suggestion], search_bar: true, search_fields: [bindings.source, bindings.target]
  } };
}

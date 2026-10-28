import * as XLSX from 'xlsx';

export const imagePopupContent = {
  titleField: 'ten_chua',
  imageFields: ['hinh_anh'],
  descriptionFields: ['mo_ta'],
  addressFields: ['dia_chi'],
  linkFields: ['google_maps_url']
};

const record = (ten_chua, values = {}) => ({
  ten_chua, dia_chi: '', mo_ta: '', hinh_anh: '', google_maps_url: '', ghi_chu: '', ...values
});

// Synthetic points and URLs keep popup/join tests independent of local sample files.
export const popupPointGeoJSON = {
  type: 'FeatureCollection',
  features: ['Chùa Một Cột', 'Chùa Trấn Quốc', 'Chùa A', 'Chùa B', 'Chùa C'].map((name, index) => ({
    type: 'Feature',
    properties: record(name, {
      dia_chi: index === 0 ? 'Ba Đình, Hà Nội' : `Địa chỉ mẫu ${index + 1}`,
      mo_ta: `Mô tả gốc ${index + 1}`,
      hinh_anh: `https://example.org/points/${index + 1}?utm_source=fixture&utm_campaign=popup`,
      google_maps_url: `https://www.google.com/maps/search/?api=1&query=point-${index + 1}`
    }),
    geometry: { type: 'Point', coordinates: index === 1 ? [105.837, 21.0479] : [105.8 + index / 100, 21 + index / 100] }
  }))
};

export const popupAttributeRecords = [
  record('Chùa Trấn Quốc', {
    mo_ta: '<img src=x onerror=alert(1)>',
    hinh_anh: 'https://example.org/photos/a;https://example.org/photos/b'
  }),
  record('Chùa Trấn Quốc', {
    mo_ta: '<img src=x onerror=alert(1)>',
    hinh_anh: 'https://example.org/photos/b\nhttps://example.org/photos/c'
  }),
  record('Chùa Một Cột', { mo_ta: 'Thông tin của điểm thứ hai được ghép.' }),
  record('Điểm không khớp', { mo_ta: 'Giữ nguyên dòng chưa khớp.' }),
  record('', { mo_ta: 'Thiếu khóa ghép.' })
];

export function createPopupAttributesWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(popupAttributeRecords), 'Thuộc tính');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

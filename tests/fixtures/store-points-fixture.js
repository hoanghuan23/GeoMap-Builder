export const storeColumns = [
  { name: "thang", role: "time", granularity: "month" },
  { name: "ma_cua_hang", role: "id" }, { name: "ten_cua_hang", role: "category" },
  { name: "thanh_pho", role: "geo", geoLevel: "admin1" },
  { name: "vi_do", role: "geo", geoLevel: "point_lat" }, { name: "kinh_do", role: "geo", geoLevel: "point_lng" },
  { name: "doanh_thu_vnd", role: "measure", aggDefault: "sum", unit: "VND" },
  { name: "chi_phi_vnd", role: "measure", aggDefault: "sum", unit: "VND" }
];
export const storeRecords = ["CH01", "CH02"].flatMap((id, index) => [1, 2, 3].map(month => ({
  thang: new Date(`2026-0${month}-01T00:00:00Z`), ma_cua_hang: id, ten_cua_hang: `Cửa hàng ${id}`, thanh_pho: "Hà Nội",
  vi_do: 21.02 + index * .02, kinh_do: 105.85 - index * .02,
  doanh_thu_vnd: month === 2 ? null : index * 1000 + (month - 1) * 100, chi_phi_vnd: month * 10
})));
export const storeBindings = { lat: "vi_do", lng: "kinh_do", region: "ma_cua_hang" };
export const storeSuggestions = [
  { id: "stores", chartType: "point", title: "Vị trí cửa hàng", confidence: .97, bindings: storeBindings },
  { id: "cities", chartType: "choropleth", title: "Theo thành phố", confidence: .99, bindings: { region: "thanh_pho", value: "doanh_thu_vnd" } }
];

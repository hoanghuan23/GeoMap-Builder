import { DEFAULT_POINT_STYLE } from "./style.js";
import { coordinatePair } from "../../shared/data/coordinates.js";
import { popup } from './popup.js';

export const definition = Object.freeze({
  popup,
  defaultStyle: DEFAULT_POINT_STYLE,
  nativeOrder: 0,
  profileKey: "hasPoints",
  supportsMetrics: true,
  categoryMetrics: false,
  popupSubject: 'điểm',
  tabIcon: '●',
  searchColumns: (fields,title) => title && (fields[0].role==='geo'||fields[0].role==='id'&&title.role!=='id')
    ? [title,...fields.filter(column=>column.name!==title.name)] : fields,
  geometryProvider: "coordinates",
  timeFilter: false,
  stylePanel: "point-style-controls",

  id: "point", viewType: "point",
  label: "Bản đồ Point",
    slots: Object.freeze({ lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), region: Object.freeze(["id", "category", "text", "geo"]) }),
    icon: "point",
    renderer: "MapLibre",
  instructions: [
  {
    "order": 23,
    "text": "Point dùng tọa độ cho các đối tượng riêng như cửa hàng, trường học, trạm. bindings.lat và lng là hai cột tọa độ có sẵn hoặc đã bổ sung bằng tra cứu xác minh qua geographicEnrichment; nếu có mã đối tượng ổn định (ví dụ ma_cua_hang), gán role id và dùng bindings.region để xác định đúng đối tượng qua nhiều tháng. Tên cửa hàng là category hoặc text; thành phố là geo. Các cửa hàng cố định có nhiều quan sát theo tháng vẫn là Point, không nối chúng thành tuyến theo tháng."
  }
],
  bindingPlan() { return { required: ['lat', 'lng'], optional: ['region'] }; },
  evaluate(suggestion, records) {
    const rows = records.filter(record => coordinatePair(record, suggestion.bindings));
    const rate = records.length ? rows.length / records.length : 0;
    return { coverage: rate, reason: rate < .7 ? 'Ít hơn 70% dòng có tọa độ hợp lệ.' : !rows.length ? 'Không có tọa độ hợp lệ để hiển thị.' : '' };
  }
});

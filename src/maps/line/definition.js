import { buildCoordinateLines, isCoordinateLine } from "./coordinates.js";
import { roadAreaField } from './data.js';
import { popup } from './popup.js';
import { groupLineSearchEntries } from './search.js';
import { isDataSearchColumn } from '../../shared/search/columns.js';

export const definition = Object.freeze({
  popup,
  defaultStyle: Object.freeze({width:3,opacity:1,showLegend:true}),
  nativeOrder: 1,
  profileKey: "hasLines",
  supportsMetrics: true,
  categoryMetrics: true,
  colorLegend: true,
  nullableValue: true,
  nonMeasureAggregation: false,
  metricCaption: 'Chỉ số tô màu bản đồ',
  singleMetricSelector: true,
  popupSubject: 'tuyến',
  tabIcon: '╱',
  searchColumns: (fields,title) => title ? [title,...fields.filter(column=>column.name!==title.name)] : fields,
  searchContext: (columns,primary) => columns.filter(column=>column.name!==primary.name&&isDataSearchColumn(column)&&['geo','id'].includes(column.role)),
  searchEntries: groupLineSearchEntries,
  popupTimeLabels: ['Biểu đồ từ thời điểm', 'Đến thời điểm'],
  areaField: roadAreaField,
  geometryProvider: "local-roads",
  timeFilter: true,
  stylePanel: "road-style-controls",

  nativeKind: "line",
  id: "map_line", viewType: "line",
  label: "Bản đồ Line",
    slots: Object.freeze({ region: Object.freeze(["category", "geo", "id", "text"]), value: Object.freeze(["measure", "category"]),
      lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), x: Object.freeze(["time", "id", "measure", "category"]) }),
    icon: "line",
    renderer: "MapLibre",
  instructions: [
  {
    "order": 24,
    "text": "Bản đồ Line/map_line khác biểu đồ đường trong popup. Có HAI cách dựng Line: (1) bảng tên/mã đường: bindings.region là tên/mã tuyến category/geo/text/id, bindings.value là chỉ số hoặc trạng thái tô màu tùy chọn, các binding tọa độ và x là null; ứng dụng ghép mạng đường Việt Nam theo Khu vực, tên và mã đường. (2) chuỗi tọa độ có thứ tự/di chuyển/hành trình: bindings.lat và lng là cột tọa độ; bindings.region là mã nhóm tuyến/hành trình/đối tượng di chuyển nếu có; bindings.x là thứ tự hoặc thời gian nếu có; bindings.value là chỉ số/trạng thái tùy chọn. Nếu không có x, dùng thứ tự dòng trong file. Không nối các nhóm tuyến khác nhau. Không dùng đường nối tọa độ để giả lập mạng đường thực tế."
  }
],
  bindingPlan(bindings, profile) {
    const native = profile?.spatial?.nativeGeometry === true && profile.spatial.geometryKinds?.includes('line');
    const coordinates = bindings.lat && bindings.lng;
    return { native, required: native ? [] : coordinates ? ['lat', 'lng'] : ['region'],
      optional: native ? ['region', 'value'] : coordinates ? ['region', 'x', 'value'] : ['value'] };
  },
  evaluate(suggestion, records, columns) {
    if (isCoordinateLine(suggestion)) {
      const data = buildCoordinateLines(records, columns, suggestion.bindings);
      return { coverage: data.stats.coordinateRate, reason: data.stats.coordinateRate < .7 || !data.features.length
        ? 'Cần ít nhất hai tọa độ khác nhau trong cùng chuỗi, với ít nhất 70% tọa độ hợp lệ.' : '' };
    }
    return { reason: records.some(record => record[suggestion.bindings.region] != null && record[suggestion.bindings.region] !== '')
      ? '' : 'Không có tên tuyến hợp lệ để ghép với mạng đường.' };
  }
});

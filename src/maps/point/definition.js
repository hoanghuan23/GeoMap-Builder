import { DEFAULT_POINT_STYLE } from "./style.js";
import { coordinatePair } from "../../shared/data/coordinates.js";
import { popup } from './popup.js';

export const definition = Object.freeze({
  popup,
  defaultStyle: DEFAULT_POINT_STYLE,
  nativeOrder: 0,
  profileKey: "hasPoints",
  supportsMetrics: false,
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
    slots: Object.freeze({ lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), region: Object.freeze(["id", "category", "text", "geo"]), group: Object.freeze(["category", "text"]) }),
    icon: "point",
    renderer: "MapLibre",
  bindingPlan() { return { required: ['lat', 'lng'], optional: ['region', 'group'] }; },
  evaluate(suggestion, records, columns, analysis = {}) {
    const rows = records.filter(record => coordinatePair(record, suggestion.bindings));
    const rate = records.length ? rows.length / records.length : 0;
    const partial = ['Codex', 'OpenAI', 'MapTiler', 'MapTiler + Google Maps'].includes(analysis.pointGeocoding?.provider) && analysis.pointGeocoding.matched > 0;
    return { coverage: rate, reason: !rows.length ? 'Không có tọa độ hợp lệ để hiển thị.'
      : rate < .7 && !partial ? `Chỉ ${rows.length}/${records.length} dòng có tọa độ hợp lệ (cần ít nhất 70%).` : '' };
  }
});

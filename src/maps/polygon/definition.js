import { administrativeContextFields, geographicLocationName } from "../../shared/geography/geographic-grain.js";
import { normalizeGeographicScopes } from './scopes.js';
import { popup } from './popup.js';

export const definition = Object.freeze({
  popup,
  defaultStyle: Object.freeze({color:"#6c5ce7",opacity:.72,borderColor:"#ffffff",borderWidth:.5}),
  nativeOrder: 2,
  profileKey: "hasArea",
  supportsMetrics: true,
  categoryMetrics: true,
  colorLegend: true,
  nullableValue: true,
  popupSubject: 'vùng',
  tabIcon: '▧',
  searchColumns(fields,title) {
    if(title)fields=[title,...fields.filter(column=>column.name!==title.name)];
    const levels=['country','admin1','admin2'],level=levels.indexOf(fields[0].geoLevel);
    return level<0?[]:fields.filter(column=>!levels.includes(column.geoLevel)||levels.indexOf(column.geoLevel)<=level);
  },
  normalizeScopes(raw, profile, suggestion, onError) {
    return normalizeGeographicScopes(raw, profile, suggestion.bindings.region, onError);
  },
  geometryProvider: "maptiler",
  timeFilter: true,
  stylePanel: "map-style-controls",

  nativeKind: "area",
  id: "choropleth", viewType: "polygon",
  label: "Bản đồ Polygon",
    slots: Object.freeze({ region: Object.freeze(["geo"]), value: Object.freeze(["measure", "category"]) }),
    icon: "polygon",
    renderer: "MapLibre",
  bindingPlan(bindings, profile) {
    const native = profile?.spatial?.nativeGeometry === true && profile.spatial.geometryKinds?.includes('area');
    return { native, required: native ? [] : ['region'], optional: native ? ['region', 'value'] : ['value'] };
  },
  evaluate(suggestion, records, columns) {
    const geometry = { field: suggestion.bindings.region, contextFields: administrativeContextFields(columns, suggestion.bindings.region) };
    return { reason: records.some(record => geographicLocationName(record, geometry)) ? '' : 'Cần ít nhất một địa danh hợp lệ.' };
  }
});

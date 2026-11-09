import { createArcFlowModel, DEFAULT_ARC_FLOW_STYLE } from "./data.js";

export const definition = Object.freeze({
  defaultStyle: DEFAULT_ARC_FLOW_STYLE,
  independentCoverage: true,
  profileKey: null,
  supportsMetrics: false,
  categoryMetrics: false,
  popupSubject: 'luồng',
  tabIcon: '⌒',
  namedPopupFallback: true,
  geometryProvider: "coordinates",
  timeFilter: false,
  stylePanel: "arc-flow-style-controls",
  acceptsNativeProperties: true,

  id: "arc_flow", viewType: "arc_flow",
  label: "Bản đồ Arc Flow 3D", icon: "arc_flow", renderer: "deck.gl",
    slots: Object.freeze({
      source: Object.freeze(["id", "category", "text", "geo"]), target: Object.freeze(["id", "category", "text", "geo"]),
      sourceLat: Object.freeze(["geo", "measure"]), sourceLng: Object.freeze(["geo", "measure"]),
      targetLat: Object.freeze(["geo", "measure"]), targetLng: Object.freeze(["geo", "measure"]),
      value: Object.freeze(["measure"]), time: Object.freeze(["time"]), group: Object.freeze(["category", "id", "text", "time"])
    }),
  bindingPlan() { return { required: ['source', 'target', 'sourceLat', 'sourceLng', 'targetLat', 'targetLng', 'value'], optional: ['time', 'group'], distinct: true, scalar: true }; },
  evaluate(suggestion, records, columns) {
    const model = createArcFlowModel(records, columns, suggestion);
    return { coverage: model.stats.validRate, reason: model.unavailableReason };
  }
});

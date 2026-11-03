import { installRuntime } from "./runtime-driver.js";
import { readFileSync } from "node:fs";
import { createArcFlowController } from '../../src/maps/arc-flow/controller.js';
import vm from "node:vm";
import * as capabilities from "../../src/shared/data/data-capabilities.js";
import * as polygonStyle from "../../src/maps/polygon/style.js";
import * as pointStyle from "../../src/maps/point/style.js";
import * as geojsonLayers from "../../src/shared/geography/geojson-layers.js";
import { PointRenderer } from "../../src/maps/point/renderer.js";
import { PolygonRenderer } from "../../src/maps/polygon/renderer.js";
import { renderGeographicScopeMarkers } from "../../src/maps/polygon/scope-renderer.js";
import * as layerOrder from "../../src/layer-order.js";
import { nativeMapDataset, nativeMapView } from "../../src/shared/data/native-map-data.js";
import * as pipeline from "../../src/shared/import/ai-chart-pipeline.js";
import * as popupChart from "../../src/shared/popup/ai-popup-chart.js";
import * as coordinates from "../../src/maps/line/coordinates.js";
import * as roadMap from "../../src/maps/line/data.js";
import * as timeValues from "../../src/shared/data/time-values.js";
import { AI_CHART_REGISTRY } from "../../src/shared/import/ai-chart-contract.js";
import { displayFilterValue, comparableFilterValue, requestAiTextAnalysis } from "../../src/shared/import/ai-data-analysis.js";
import { parseTextDocumentFile } from "../../src/shared/import/text-document-worker-client.js";
import { parseSpreadsheetFile, profileRecordsInWorker } from "../../src/shared/import/tabular-worker-client.js";
import { trafficAiAnalysis } from "./road-traffic-fixture.js";
import { jsonDatasets } from "../../src/shared/import/json-datasets.js";
import * as polygonLegend from "../../src/shared/data/polygon-legend.js";
import * as legendContract from "../../src/shared/data/polygon-legend-contract.js";
import * as boundaryData from "../../src/shared/geography/vietnam-admin-data.js";
import * as categoricalColor from "../../src/shared/data/categorical-color.js";

// Exercise the actual upload and UI handlers with a MapLibre/DOM adapter.
export function createHarness(runtimeOptions = {}) {
  const elements = new Map();
  const element = () => ({
    checked: true, hidden: false, value: "", textContent: "", style: { setProperty() {} }, dataset: {}, children: [], events: {},
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {}, addEventListener(type, callback) { this.events[type] = callback; }, querySelector() { return null; }
  });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  get("fixed-color").value = "#6c5ce7"; get("opacity").value = ".72";
  get("border-color").value = "#ffffff"; get("line-width").value = ".5";
  const sources = new Map(); const layers = new Map();
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.get(id),
    addSource(id, config) { sources.set(id, { data: config.data, setData(data) { this.data = data; } }); },
    addLayer(layer) { layers.set(layer.id, { ...layer, layout: { ...layer.layout }, paint: { ...layer.paint } }); },
    removeSource(id) { sources.delete(id); }, removeLayer(id) { layers.delete(id); },
    setPaintProperty(id, key, value) { layers.get(id).paint[key] = value; },
    getPaintProperty(id, key) { return layers.get(id).paint[key]; },
    getContainer() { return get("map"); },
    project(coordinates) { return { x: coordinates[0] * 10, y: coordinates[1] * 10 }; },
    setLayoutProperty(id, key, value) { layers.get(id).layout[key] = value; },
    moveLayer() {}, on() {}, resize() {}, fitBounds() {}
  };
  const context = vm.createContext({
    testRuntimeOptions: runtimeOptions,
    createArcFlowController,
    ...capabilities, ...polygonStyle, ...pointStyle, ...geojsonLayers, ...layerOrder, PointRenderer, PolygonRenderer, renderGeographicScopeMarkers,
    ...pipeline, ...popupChart, ...coordinates, ...roadMap, ...timeValues, ...polygonLegend, ...legendContract, ...boundaryData, ...categoricalColor,
    jsonDatasets, nativeMapDataset, nativeMapView, AI_CHART_REGISTRY, displayFilterValue, comparableFilterValue, profileRecordsInWorker, parseSpreadsheetFile,
    requestAiTextAnalysis, parseTextDocumentFile,
    requestAiDataAnalysis: async records => ({ analysis: { ...trafficAiAnalysis, source: "ai" }, records, validRowRate: 1 }),
    roadNetworkUrl: () => "/roads/hanoi_roads.json",
    fetch: async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [{
      type: "Feature", properties: { name: "Đường Lĩnh Nam" },
      geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] }
    }] }) }),
    CONFIG: { DEFAULT_RESOLUTION: 5, MAX_RENDER_CELLS: 120000 },
    renderMapIcon() {}, renderChartIcon() {},
    humanizeField: field => field, keepSelectOpenAfterMouseClick: control => control,
    document: { getElementById: get, createElement: element, querySelector: () => element(),
      querySelectorAll: selector => selector === "#ai-filter-controls .ai-generated-filter"
        ? descendants(get("ai-filter-controls")).filter(node => node.className === "ai-generated-filter") : [] },
    maplibregl: {
      LngLatBounds: class { extend() { return this; } },
      Popup: class {
        constructor(options) { this.options = options; }
        on(name, callback) { this[name] = callback; return this; }
        setLngLat(coordinates) { this.coordinates = coordinates; return this; }
        setDOMContent(card) { this.card = card; return this; }
        addTo() { return this; }
        remove() { this.close?.(); }
      }
    },
    console, setTimeout: callback => { callback(); return 0; }, clearTimeout() {}
  });
  installRuntime(context);
  context.testMap = map;
  vm.runInContext("map = testMap; addMapLayers();", context);
  return { context, get, sources, layers };
}


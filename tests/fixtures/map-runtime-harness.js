import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as capabilities from "../../src/data-capabilities.js";
import * as polygonStyle from "../../src/renderers/polygon-style.js";
import * as pointStyle from "../../src/renderers/point-style.js";
import * as geojsonLayers from "../../src/geojson-layers.js";
import { PointRenderer } from "../../src/renderers/point-renderer.js";
import { PolygonRenderer } from "../../src/renderers/polygon-renderer.js";
import * as layerOrder from "../../src/layer-order.js";
import { nativeMapDataset, nativeMapView } from "../../src/native-map-data.js";
import * as pipeline from "../../src/ai-chart-pipeline.js";
import * as popupChart from "../../src/ai-popup-chart.js";
import * as coordinates from "../../src/coordinate-data.js";
import * as roadMap from "../../src/road-map-data.js";
import * as timeValues from "../../src/time-values.js";
import { AI_CHART_REGISTRY } from "../../src/ai-chart-contract.js";
import { displayFilterValue, comparableFilterValue, requestAiTextAnalysis } from "../../src/ai-data-analysis.js";
import { parseTextDocumentFile } from "../../src/text-document-worker-client.js";
import { parseSpreadsheetFile, profileRecordsInWorker } from "../../src/tabular-worker-client.js";
import { trafficAiAnalysis } from "./road-traffic-fixture.js";
import { jsonDatasets } from "../../src/json-datasets.js";
import * as polygonLegend from "../../src/polygon-legend.js";
import * as legendContract from "../../src/polygon-legend-contract.js";

// Exercise the actual upload and UI handlers with a MapLibre/DOM adapter.
export function createHarness() {
  const elements = new Map();
  const element = () => ({
    checked: true, hidden: false, value: "", textContent: "", style: { setProperty() {} }, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; }
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
    ...capabilities, ...polygonStyle, ...pointStyle, ...geojsonLayers, ...layerOrder, PointRenderer, PolygonRenderer,
    ...pipeline, ...popupChart, ...coordinates, ...roadMap, ...timeValues, ...polygonLegend, ...legendContract,
    jsonDatasets, nativeMapDataset, nativeMapView, AI_CHART_REGISTRY, displayFilterValue, comparableFilterValue, profileRecordsInWorker, parseSpreadsheetFile,
    requestAiTextAnalysis, parseTextDocumentFile,
    requestAiDataAnalysis: async records => ({ analysis: { ...trafficAiAnalysis, source: "ai" }, records, validRowRate: 1 }),
    roadNetworkUrl: () => "/roads/hanoi_roads.json",
    fetch: async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [{
      type: "Feature", properties: { name: "Đường Lĩnh Nam" },
      geometry: { type: "LineString", coordinates: [[105.8, 21], [105.81, 21.01]] }
    }] }) }),
    CONFIG: { DEFAULT_RESOLUTION: 5, MAX_RENDER_CELLS: 120000 },
    DEFAULT_BAR_CONFIG: {}, DEFAULT_PIE_CONFIG: {},
    mergeBarConfig: () => ({}), mergePieConfig: () => ({}),
    clearDataMappingPanel() {}, clearBarStylePanel() {}, clearPieStylePanel() {}, renderMapIcon() {}, renderChartIcon() {},
    humanizeField: field => field, keepSelectOpenAfterMouseClick: control => control,
    geoJSONToCells() { throw new Error("Metro polygons must not be regenerated as H3"); },
    geoJSONToH3FeatureCollection: () => ({ type: "FeatureCollection", features: [] }),
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
  const source = readFileSync(new URL("../../src/app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"\n]+";\r?\n/gm, "")
    .replace(/export function createMapLayerRuntime\(options\) \{\nconst document = options.document;\nconst maplibregl = options.maplibregl \|\| globalThis.maplibregl;\n/, "const options = {};\n")
    .replace(/\/\/ Runtime public API[\s\S]*$/, "");
  vm.runInContext(source, context);
  context.testMap = map;
  vm.runInContext("map = testMap; addMapLayers();", context);
  return { context, get, sources, layers };
}


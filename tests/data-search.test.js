import assert from "node:assert/strict";
import test from "node:test";
import { buildDataSearchIndex, createMapSearch, searchDataIndex } from "../src/map-search.js";
import { fallbackAnalysis } from "../src/ai-chart-contract.js";
import { fallbackMapRecommendation } from "../src/ai-data-analysis.js";
import { parseSpreadsheetBuffer } from "../src/tabular-parser.js";
import { normalizeTabularRecords } from "../src/tabular-data.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { countryFeature, createCountryWeatherWorkbook, WEATHER_COUNTRIES } from "./fixtures/country-weather-fixture.js";

function countryData() {
  const names = ["Việt Nam", "Nga", "Hoa Kỳ", "Úc", "Áo", "Lào", "Nhật Bản", "Hàn Quốc"];
  const parsed = parseSpreadsheetBuffer(createCountryWeatherWorkbook(names.map((name, index) => ({
    "Tên quốc gia": name, "Ngày": "01/09/2026", "Nhiệt độ trung bình": 20 + index
  }))));
  const analysis = fallbackAnalysis(parsed.profile);
  const recommendation = fallbackMapRecommendation(parsed.records);
  const { records } = normalizeTabularRecords(parsed.records, analysis.columns);
  const boundaries = { type: "FeatureCollection", features: names.map(name => ({
    ...countryFeature(WEATHER_COUNTRIES[0]),
    // Synthetic geometries deliberately have no MapTiler center or bbox.
    bbox: undefined, center: undefined, properties: { __data_location: name }
  })) };
  const data = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { columns: analysis.columns });
  return { data, columns: analysis.columns, titleField: recommendation.geometry.field };
}

function harness(t) {
  const element = () => ({
    value: "", hidden: false, disabled: false, children: [], handlers: {}, attributes: {},
    classList: { toggle() {} }, scrollIntoView() {}, focus() {}, blur() {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    removeEventListener(name) { delete this.handlers[name]; },
    querySelectorAll() { return this.children.filter(child => child.className === "map-search-result"); },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  });
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const previous = globalThis.document;
  globalThis.document = { ...element(), getElementById: get, createElement: element };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  t.mock.method(globalThis, "fetch", () => assert.fail("data search must never request geocoding or weather"));
  const camera = [];
  const selected = [];
  const controller = createMapSearch({
    map: { fitBounds: (...args) => camera.push(args), flyTo: (...args) => camera.push(args) },
    onSelect: (...args) => selected.push(args)
  });
  t.after(() => controller.destroy());
  const search = query => {
    get("map-search-input").value = query;
    get("map-search-input").handlers.input();
    return get("map-search-results").children;
  };
  return { controller, get, search, camera, selected };
}

test("country spreadsheet searches only uploaded countries, including accents, aliases and codes", () => {
  const index = buildDataSearchIndex(countryData());
  assert.equal(index.entries.length, 8);
  assert.match(index.placeholder, /quốc gia/);
  for (const [query, expected] of [["viet nam", "Việt Nam"], ["Vietnam", "Việt Nam"], ["VNM", "Việt Nam"],
    ["Nga", "Nga"], ["RUS", "Nga"], ["Mỹ", "Hoa Kỳ"], ["USA", "Hoa Kỳ"], ["Australia", "Úc"],
    ["ao", "Áo"], ["Lào", "Lào"], ["Japan", "Nhật Bản"], ["han quoc", "Hàn Quốc"]]) {
    assert.equal(searchDataIndex(index, query)[0]?.label, expected, query);
  }
  assert.deepEqual(searchDataIndex(index, "Thái Lan"), [], "a known country outside the upload is never suggested");
  assert.deepEqual(searchDataIndex(index, "01/09/2026"), [], "dates are not place names");
});

test("search stays hidden until searchable analyzed data exists and opens the uploaded feature", t => {
  const { controller, get, search, camera, selected } = harness(t);
  assert.equal(get("map-search").hidden, true);
  assert.equal(get("map-search-input").disabled, true);
  search("Việt Nam");
  assert.equal(get("map-search-results").hidden, true);
  controller.setData({ data: countryData().data, columns: [{ name: "Nhiệt độ trung bình", role: "measure" }] });
  assert.equal(get("map-search").hidden, true, "measure-only data cannot enable search");
  const snapshot = countryData();
  controller.setData(snapshot);
  assert.equal(get("map-search").hidden, false);
  assert.equal(get("map-search-input").disabled, false);
  search("Vietnam")[0].handlers.click();
  assert.equal(camera.length, 1, "polygon geometry can focus without a provider bbox");
  assert.equal(selected[0][0], snapshot.data.features[0]);
  assert.deepEqual(selected[0][1], [105.5, 15.5]);
  assert.equal(selected[0][0].properties["Nhiệt độ trung bình"], 20);
  assert.equal(get("map-search-results").hidden, true);
  search("Thái Lan");
  assert.match(get("map-search-results").children[0].textContent, /Không tìm thấy dữ liệu/);
});

test("filtering, replacing and clearing data cannot reuse stale search results", t => {
  const { controller, get, search, selected } = harness(t);
  const snapshot = countryData();
  controller.setData(snapshot);
  const staleOption = search("Vietnam")[0];
  controller.setData({ ...snapshot, data: { type: "FeatureCollection", features: snapshot.data.features.slice(1) } });
  assert.equal(get("map-search-input").value, "");
  staleOption.handlers.click();
  assert.equal(selected.length, 0);
  search("Vietnam");
  assert.match(get("map-search-results").children[0].textContent, /Không tìm thấy/);
  controller.setData({ ...snapshot, data: { type: "FeatureCollection", features: [] } });
  assert.equal(get("map-search").hidden, true);
  controller.setData(snapshot);
  search("Nga");
  controller.setData(snapshot);
  assert.equal(get("map-search-input").value, "Nga", "style changes preserve the current query");
  controller.setData();
  assert.equal(get("map-search").hidden, true);
  assert.equal(get("map-search-input").disabled, true);
  assert.equal(get("map-search-results").hidden, true);
  assert.equal(get("map-search-input").value, "");
});

test("keyboard selection, submit, Escape and clear operate on local suggestions", t => {
  const { controller, get, search, selected } = harness(t);
  controller.setData(countryData());
  search("Nga");
  const key = key => get("map-search-input").handlers.keydown({ key, preventDefault() {} });
  key("ArrowDown");
  assert.equal(get("map-search-input").attributes["aria-activedescendant"], "map-search-result-0");
  key("Enter");
  assert.equal(selected[0][0].properties["Tên quốc gia"], "Nga");
  search("Japan");
  get("map-search-form").handlers.submit({ preventDefault() {} });
  assert.equal(selected[1][0].properties["Tên quốc gia"], "Nhật Bản");
  search("Lào");
  key("Escape");
  assert.equal(get("map-search-input").attributes["aria-expanded"], "false");
  get("map-search-clear").handlers.click();
  assert.equal(get("map-search-input").value, "");
  assert.equal(get("map-search-clear").hidden, true);
});

test("analyzed point names and IDs are searchable without indexing coordinates or internal metadata", () => {
  const data = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [106, 21] },
    properties: { name: "Cửa hàng A", code: "SHOP-01", lat: 21, __source: "hidden-provider" } }] };
  const index = buildDataSearchIndex({ data, titleField: "name", columns: [
    { name: "name", role: "text" }, { name: "code", role: "id" },
    { name: "lat", role: "geo", geoLevel: "point_lat" }, { name: "__source", role: "text" }
  ] });
  assert.equal(searchDataIndex(index, "cua hang")[0].label, "Cửa hàng A");
  assert.equal(searchDataIndex(index, "SHOP-01")[0].feature, data.features[0]);
  assert.deepEqual(searchDataIndex(index, "21"), []);
  assert.deepEqual(searchDataIndex(index, "hidden-provider"), []);
});

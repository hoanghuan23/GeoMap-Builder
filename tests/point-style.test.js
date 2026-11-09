import test from "node:test";
import assert from "node:assert/strict";
import { buildPointView, createPointModel, DEFAULT_POINT_STYLE, mergePointStyle, normalizePointSelection, pointPaint, POINT_COLOR, POINT_COLORS } from "../src/maps/point/style.js";
import { storeColumns, storeRecords, storeBindings } from "./fixtures/store-points-fixture.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/shared/search/map-search.js";
import { MAP_NO_DATA_COLOR } from "../src/shared/data/map-value.js";

const columns = [
  { name: "code", role: "id" },
  { name: "name", role: "text" },
  { name: "lat", role: "geo", geoLevel: "point_lat" },
  { name: "lng", role: "geo", geoLevel: "point_lng" },
  { name: "type", role: "category", labelVi: "Loại cửa hàng" },
  { name: "revenue", role: "measure", labelVi: "Doanh thu", unit: "triệu đồng" },
  { name: "rating", role: "measure", labelVi: "Điểm đánh giá" }
];
const bindings = { lat: "lat", lng: "lng" };
const record = (type, revenue, extra = {}) => ({ code: "001", name: "Cửa hàng <A>", lat: 21.02, lng: 105.83, type, revenue, rating: 4, ...extra });

// Evaluate the expressions we produce against representative properties and zooms.
function evaluate(expression, properties, zoom = 10) {
  if (!Array.isArray(expression)) return expression;
  const [operator, ...args] = expression;
  const run = value => evaluate(value, properties, zoom);
  if (operator === "zoom") return zoom;
  if (operator === "get") return properties[args[0]] ?? null;
  if (operator === "typeof") return typeof run(args[0]);
  if (operator === "to-string") return String(run(args[0]));
  if (operator === "==") return run(args[0]) === run(args[1]);
  if (operator === "case") return run(args[0]) ? run(args[1]) : run(args[2]);
  if (operator === "match") {
    const value = run(args[0]);
    for (let index = 1; index < args.length - 1; index += 2) if (value === args[index]) return run(args[index + 1]);
    return run(args.at(-1));
  }
  if (operator === "interpolate") {
    const value = run(args[1]);
    const stops = args.slice(2);
    if (value <= stops[0]) return run(stops[1]);
    for (let index = 2; index < stops.length; index += 2) {
      if (value > stops[index]) continue;
      const fraction = (value - stops[index - 2]) / (stops[index] - stops[index - 2]);
      return run(stops[index - 1]) + fraction * (run(stops[index + 1]) - run(stops[index - 1]));
    }
    return run(stops.at(-1));
  }
  throw new Error(`Unexpected expression: ${operator}`);
}

test("Point defaults ignore measures and show every category when it fits the palette", () => {
  const records = ["F", "E", "D", "C", "B", "A"].map(type => record(type, 10));
  records.push(record("F", 20), record("F", 40), record("A", 10, { lat: 999 }));
  const model = createPointModel(records, [{ name: "empty", role: "measure" }, ...columns], bindings);
  const view = buildPointView(model);
  assert.equal(view.selection.metricField, null);
  assert.equal(view.selection.groupField, "type");
  assert.deepEqual(view.selection.selectedValues, ["F", "A", "B", "C", "D", "E"]);
  assert.equal(view.stats.visibleCount, 8);
  assert.equal(view.stats.totalCount, 8);
  assert.equal(view.stats.coordinateRate, 8 / 9);
  assert.deepEqual(model.measures.map(column => column.name), ["empty", "revenue", "rating"]);
  assert.equal(buildPointView(model, { metricField: "empty" }).selection.metricField, null);
  assert.equal(model.timeColumn, null);
});

test("Point filtering preserves popup properties, string IDs, source records and all-mode counts", () => {
  const records = [record("A", 0, { enabled: false }), record("B", 100), record(null, 50), record("A", 10, { lng: "" })];
  const original = structuredClone(records);
  const model = createPointModel(records, columns, bindings);
  const selected = buildPointView(model, { selectedValues: ["A"] });
  assert.equal(selected.data.features.length, 1);
  assert.equal(selected.data.features[0].properties.code, "001");
  assert.equal(selected.data.features[0].properties.enabled, false);
  assert.equal(selected.data.features[0].properties.name, "Cửa hàng <A>");
  assert.equal(selected.metric, null);
  assert.equal(selected.data.features[0].properties.revenue, 0);
  const all = buildPointView(model, { ...selected.selection, mode: "all" }, selected.colors);
  assert.equal(all.data.features.length, 3);
  assert.equal(evaluate(all.paint["circle-color"], { revenue: 0 }), POINT_COLOR);
  assert.deepEqual(all.legendRows.map(({ label, count }) => ({ label, count })), [
    { label: "A", count: 1 }, { label: "B", count: 1 }, { label: "Chưa có thông tin", count: 1 }
  ]);
  assert.equal(all.colors.A, selected.colors.A);
  for (const feature of all.data.features) {
    const row = all.legendRows.find(row => row.key === feature.properties.type);
    assert.equal(evaluate(all.paint["circle-color"], feature.properties), row.color);
  }
  assert.deepEqual(records, original);
});

test("Point defaults to all dates, preserves a selected time and allows an empty result", () => {
  const records = [
    record("A", 10, { day: new Date("2026-07-01") }),
    record("B", 20, { day: new Date("2026-07-02") }),
    record("A", 30, { day: new Date("2026-07-03") }),
    record("A", 40, { day: null })
  ];
  const model = createPointModel(records, [...columns, { name: "day", role: "time" }], bindings);
  const initial = buildPointView(model);
  assert.equal(initial.selection.time, "");
  assert.deepEqual(initial.data.features.map(feature => feature.properties.revenue), [10, 20, 30, 40]);
  const latest = buildPointView(model, { time: model.times[2] });
  assert.equal(latest.selection.time, model.times[2]);
  assert.deepEqual(latest.data.features.map(feature => feature.properties.revenue), [30]);
  assert.equal(normalizePointSelection(model, { time: "stale" }).time, "");
  const all = buildPointView(model, { ...latest.selection, time: "" });
  assert.equal(all.selection.time, "");
  assert.deepEqual(all.data.features.map(feature => feature.properties.revenue), [10, 20, 30, 40]);
  assert.equal(buildPointView(model, all.selection).stats.visibleCount, 4);
  const groupOnly = buildPointView(model, { ...all.selection, selectedValues: ["A"] });
  assert.deepEqual(groupOnly.data.features.map(feature => feature.properties.revenue), [10, 30, 40]);
  const view = buildPointView(model, { ...all.selection, time: model.times[0] });
  assert.equal(view.stats.visibleCount, 1);
  assert.equal(view.selection.time, model.times[0]);
  assert.equal(view.data.features[0].properties.day, "2026-07-01T00:00:00.000Z");
  const empty = buildPointView(model, { selectedValues: ["B"], time: model.times[0] }, view.colors);
  assert.equal(empty.stats.visibleCount, 0);
  assert.equal(empty.metric, null);
  assert.equal(empty.legendRows[0].count, 0);
  assert.doesNotThrow(() => JSON.stringify(empty.paint));
});

test("Point chọn một kỳ không có năm và đối chiếu các nhãn thời gian tương đương", () => {
  const records = [record("A", 10, { period: "T10" }), record("A", 20, { period: "T2" }), record("A", 30, { period: "T1" })];
  const model = createPointModel(records, [...columns, { name: "period", role: "time", granularity: "month" }], bindings);
  assert.deepEqual(model.times, ["T1", "T2", "T10"]);
  const view = buildPointView(model, { time: "T2" });
  assert.equal(view.selection.time, "T2");
  assert.deepEqual(view.data.features.map(feature => feature.properties.revenue), [20]);
  const equivalent = createPointModel([...records, record("A", 40, { period: "Tháng 2" })],
    [...columns, { name: "period", role: "time", granularity: "month" }], bindings);
  assert.equal(buildPointView(equivalent, { time: "Tháng 2" }).stats.visibleCount, 2);
});

test("Point offers store names and administrative cities regardless of category/text role", () => {
  for (const role of ["category", "text"]) {
    const model = createPointModel(storeRecords, storeColumns.map(column => column.name === "ten_cua_hang" ? { ...column, role } : column), storeBindings);
    assert.deepEqual(model.groups.map(column => column.name), ["ten_cua_hang", "thanh_pho"]);
    assert.deepEqual(model.groups[1].values.map(value => value.key), ["Hà Nội"]);
    const byName = buildPointView(model, { groupField: "ten_cua_hang", selectedValues: ["Cửa hàng CH01"], time: model.times[0] });
    assert.equal(byName.stats.visibleCount, 1);
    assert.equal(byName.metric, null);
    assert.equal(byName.data.features[0].properties.doanh_thu_vnd, 0);
    const byCity = buildPointView(model, { groupField: "thanh_pho" });
    assert.equal(byCity.stats.visibleCount, storeRecords.length);
    assert.deepEqual(new Set(byCity.data.features.map(feature => feature.properties.ma_cua_hang)), new Set(["CH01", "CH02"]));
    assert.equal(byCity.legendRows[0].count, storeRecords.length);
  }
});

test("Eight selected groups have distinct matching map/legend colors, stable across time changes and stale metrics", () => {
  const records = Array.from({ length: 10 }, (_, index) => record(`G${index}`, index, { day: new Date(`2026-07-0${index % 2 + 1}`) }));
  const model = createPointModel(records, [...columns, { name: "day", role: "time" }], bindings);
  const initial = buildPointView(model, { selectedValues: records.slice(0, 8).map(row => row.type) });
  assert.equal(new Set(Object.values(initial.colors)).size, 8);
  assert.ok(initial.legendRows.every(row => POINT_COLORS.includes(row.color)));
  for (const row of initial.legendRows) assert.equal(evaluate(initial.paint["circle-color"], { type: row.key, revenue: 0 }), row.color);
  const changed = buildPointView(model, { ...initial.selection, metricField: "rating", time: model.times[0] }, initial.colors);
  assert.deepEqual(changed.colors, initial.colors);
  const replaced = buildPointView(model, { ...initial.selection, selectedValues: [...initial.selection.selectedValues.slice(1), "G8"] }, initial.colors);
  assert.equal(new Set(Object.values(replaced.colors)).size, 8);
  for (const key of initial.selection.selectedValues.slice(1)) assert.equal(replaced.colors[key], initial.colors[key]);
});

test("Point radius is uniform for zero, negative, missing and constant measures at each zoom", () => {
  const model = createPointModel([record("A", -10), record("A", 0), record("B", 10), record("B", null), record("B", "bad")], columns, bindings);
  const view = buildPointView(model);
  const radius = view.paint["circle-radius"];
  for (const revenue of [-10, 0, 10, null]) assert.equal(evaluate(radius, { revenue }), 6);
  assert.equal(view.metric, null);
  assert.equal(evaluate(view.paint["circle-color"], { type: "A", revenue: 0 }), view.colors.A);
  assert.equal(evaluate(view.paint["circle-color"], { type: "B", revenue: null }), view.colors.B);
  assert.ok(evaluate(radius, { revenue: 10 }, 16) > evaluate(radius, { revenue: 10 }, 4));
  const constant = buildPointView(model, { metricField: "rating" });
  assert.equal(evaluate(constant.paint["circle-radius"], { rating: 4 }), 6);
  assert.equal(evaluate(constant.paint["circle-radius"], { rating: null }), 6);
  assert.deepEqual(constant.paint, view.paint);
});

test("Point without a measure uses group colors and default radius while group filters still work", () => {
  const model = createPointModel([record("A", 0), record("B", 100)], columns.filter(column => column.role !== "measure"), bindings);
  const view = buildPointView(model, { selectedValues: ["A"] }, {}, { color: "#123456" });
  assert.equal(view.metric, null);
  assert.equal(view.selection.metricField, null);
  assert.equal(evaluate(view.paint["circle-color"], { type: "A" }), view.colors.A);
  assert.equal(evaluate(view.paint["circle-radius"], {}, 10), 6);
  assert.equal(view.data.features.length, 1);
  assert.equal(view.data.features[0].properties.type, "A");
});

test("Point missing measures remain visible and searchable in every group mode and ignore stale metrics", () => {
  const records = [0, null, undefined, "", " ", false, NaN, Infinity].map((value, index) =>
    record("A", value, { code: String(index), name: `Điểm ${index}` }));
  const model = createPointModel(records, [{ name: "empty", role: "measure" }, ...columns], bindings);
  for (const mode of ["all", "pick"]) {
    const view = buildPointView(model, { metricField: "revenue", groupField: "type", mode });
    assert.equal(view.data.features.length, records.length);
    assert.equal(view.metric, null);
    const index = buildDataSearchIndex({ data: view.data, columns, chartType: "point", search_fields: ["name"], search_bar: true });
    assert.equal(index.enabled, true);
    assert.equal(index.uniqueCount, records.length);
    for (const feature of view.data.features) {
      const color = evaluate(view.paint["circle-color"], feature.properties);
      assert.equal(color, view.colors.A);
      assert.equal(searchDataIndex(index, feature.properties.name)[0].feature, feature);
    }
    const changed = buildPointView(model, { ...view.selection, metricField: "rating" });
    assert.ok(changed.data.features.every(feature => evaluate(changed.paint["circle-color"], feature.properties) !== MAP_NO_DATA_COLOR));
    const empty = buildPointView(model, { ...view.selection, metricField: "empty" });
    assert.equal(empty.selection.metricField, null);
    assert.deepEqual(empty.paint, view.paint);
    assert.deepEqual(empty.data, view.data);
  }
});

test("One date remains selectable with empty measures while high-cardinality groups are omitted", () => {
  const records = Array.from({ length: 81 }, (_, index) => record(`G${index}`, null, { day: "2026-07-01" }));
  const model = createPointModel(records, columns.filter(column => !["rating", "name"].includes(column.name)).concat({ name: "day", role: "time" }), bindings);
  assert.equal(model.groups.length, 0);
  assert.equal(model.measures.length, 1);
  assert.equal(model.timeColumn.name, "day");
  const view = buildPointView(model);
  assert.equal(view.selection.mode, "all");
  assert.equal(view.selection.metricField, null);
  assert.equal(view.selection.time, "");
  assert.equal(buildPointView(model, { time: "2026-07-01" }).data.features.length, 81);
  assert.equal(view.data.features.length, 81);
  assert.equal(evaluate(view.paint["circle-color"], {}), POINT_COLOR);
  assert.equal(evaluate(view.paint["circle-radius"], {}, 10), 6);
});

test("Selection keeps more than eight groups with valid matching colors and ordinary category keys", () => {
  const records = ["__proto__", "constructor", "0", ...Array.from({ length: 8 }, (_, index) => `G${index}`)].map(type => record(type, 1));
  const model = createPointModel(records, columns, bindings);
  const selection = normalizePointSelection(model, { metricField: "missing", selectedValues: records.map(row => row.type) });
  assert.equal(selection.selectedValues.length, records.length);
  const view = buildPointView(model, selection);
  assert.equal(view.data.features.length, records.length);
  assert.equal(new Set(Object.values(view.colors)).size, records.length);
  assert.ok(Object.values(view.colors).every(color => /^#[0-9a-f]{6}$/i.test(color)));
  for (const row of view.legendRows) assert.equal(evaluate(view.paint["circle-color"], { type: row.key }), row.color);
  assert.deepEqual(buildPointView(model, view.selection, view.paletteColors).colors, view.colors);
  assert.equal(view.legendRows.find(row => row.key === "__proto__").color, view.colors.__proto__);
  assert.equal(evaluate(view.paint["circle-color"], { type: "__proto__", revenue: 1 }), view.colors.__proto__);
  assert.equal(normalizePointSelection(model, { selectedValues: ["missing"] }).selectedValues.length, records.length);
});

test("Point groups 47 facilities by ownership instead of their individual names, with matching colors and counts", () => {
  const records = Array.from({ length: 47 }, (_, index) => ({
    code: `HN-BT-${index}`, name: `Cơ sở ${index}`, organization: `Hệ thống ${index % 12}`,
    sector: index < 38 ? "Tư nhân" : "Công lập", status: index < 29 ? "A" : "B",
    lat: 21 + index / 1000, lng: 105.8
  }));
  for (const role of ["category", "text"]) {
    const fields = [columns[0], { name: "name", role }, { name: "organization", role },
      { name: "sector", role, labelVi: "Khối" }, { name: "status", role }, columns[2], columns[3]];
    const model = createPointModel(records, fields, bindings);
    const view = buildPointView(model);
    assert.equal(view.selection.groupField, "sector");
    assert.equal(view.legendTitle, "Khối");
    assert.equal(view.data.features.length, 47);
    assert.deepEqual(view.legendRows.map(({ label, count }) => ({ label, count })), [
      { label: "Tư nhân", count: 38 }, { label: "Công lập", count: 9 }
    ]);
    assert.equal(new Set(view.legendRows.map(row => row.color)).size, 2);
    for (const feature of view.data.features) {
      const row = view.legendRows.find(row => row.key === feature.properties.sector);
      assert.equal(evaluate(view.paint["circle-color"], feature.properties), row.color);
    }
    const publicOnly = buildPointView(model, { ...view.selection, selectedValues: ["Công lập"] }, view.paletteColors);
    assert.equal(publicOnly.data.features.length, 9);
    assert.equal(publicOnly.colors["Công lập"], view.colors["Công lập"]);
    const all = buildPointView(model, { ...publicOnly.selection, mode: "all" }, publicOnly.paletteColors);
    assert.equal(all.data.features.length, 47);
    assert.deepEqual(all.legendRows, view.legendRows);
    assert.deepEqual(all.colors, view.colors);
    const pickedAgain = buildPointView(model, { ...all.selection, mode: "pick" }, all.paletteColors);
    assert.equal(pickedAgain.data.features.length, 9);
    assert.equal(pickedAgain.colors["Công lập"], view.colors["Công lập"]);
  }
});

test("Point honors the AI group binding and saved user choice independently of object identity", () => {
  const records = [record("A", 1, { sector: "Tư nhân" }), record("B", 2, { sector: "Công lập" })];
  const model = createPointModel(records, [...columns, { name: "sector", role: "category" }],
    { ...bindings, region: "code", group: "sector" });
  assert.equal(buildPointView(model).selection.groupField, "sector");
  assert.equal(buildPointView(model, { groupField: "type" }).selection.groupField, "type");
  const all = buildPointView(model, { mode: "all" });
  assert.equal(all.data.features.length, 2);
  assert.deepEqual(all.legendRows.map(row => row.label), ["Công lập", "Tư nhân"]);
  for (const feature of all.data.features) assert.equal(evaluate(all.paint["circle-color"], feature.properties), all.colors[feature.properties.sector]);
});

test("Point preserves all locations when only individual names are available and allows a top-five filter", () => {
  const records = Array.from({ length: 47 }, (_, index) => record(`G${index}`, null, { name: `Cơ sở ${index}` }));
  const model = createPointModel(records, columns, bindings);
  const view = buildPointView(model);
  assert.equal(view.selection.mode, "all");
  assert.equal(view.data.features.length, 47);
  const picked = buildPointView(model, { ...view.selection, mode: "pick", selectedValues: [] });
  assert.equal(picked.selection.selectedValues.length, 5);
  assert.equal(picked.data.features.length, 5);
});

test("Point style scales radius, opacity and borders without changing selected records", () => {
  const model = createPointModel([record("A", 0), record("B", 100)], columns, bindings);
  const initial = buildPointView(model);
  const styled = buildPointView(model, initial.selection, initial.paletteColors, { size: 150, opacity: .4, borderColor: "#123456", borderWidth: 2 });
  assert.deepEqual(styled.data, initial.data);
  assert.deepEqual(styled.colors, initial.colors);
  for (const zoom of [4, 10, 16]) {
    for (const revenue of [0, 50, 100, null]) {
      assert.equal(evaluate(styled.paint["circle-radius"], { revenue }, zoom), evaluate(initial.paint["circle-radius"], { revenue }, zoom) * 1.5);
    }
  }
  assert.equal(styled.paint["circle-opacity"], .4);
  assert.equal(styled.paint["circle-stroke-opacity"], .4);
  assert.equal(styled.paint["circle-stroke-color"], "#123456");
  assert.equal(styled.paint["circle-stroke-width"], 2);
  assert.equal(pointPaint({ showBorder: false, borderWidth: 3 })["circle-stroke-width"], 0);
});

test("Custom group colors match the legend, persist on metric changes and restore the default palette", () => {
  const model = createPointModel([record("A", 0), record("B", 100)], columns, bindings);
  const initial = buildPointView(model);
  const styled = buildPointView(model, initial.selection, initial.paletteColors, { groupColors: { A: "#ff0000" } });
  assert.equal(styled.colors.A, "#ff0000");
  assert.equal(styled.legendRows.find(row => row.key === "A").color, "#ff0000");
  assert.equal(evaluate(styled.paint["circle-color"], { type: "A", revenue: 0 }), "#ff0000");
  const changed = buildPointView(model, { ...styled.selection, metricField: "rating" }, styled.paletteColors, { groupColors: { A: "#ff0000" } });
  assert.deepEqual(changed.colors, styled.colors);
  const reset = buildPointView(model, styled.selection, styled.paletteColors);
  assert.deepEqual(reset.colors, initial.colors);
  const all = buildPointView(model, { ...initial.selection, mode: "all" }, initial.paletteColors, { color: "#112233" });
  assert.equal(evaluate(all.paint["circle-color"], { type: "A", revenue: 0 }), initial.colors.A);
  assert.deepEqual(all.colors, initial.colors);
  assert.equal(all.legendRows[0].color, initial.colors.A);
  const ungrouped = createPointModel([record("A", 0)], columns.filter(column => !["category", "text"].includes(column.role)), bindings);
  const fixed = buildPointView(ungrouped, {}, {}, { color: "#112233" });
  assert.equal(fixed.paint["circle-color"], "#112233");
  assert.equal(fixed.legendRows[0].color, "#112233");
});

test("Point style keeps zero opacity and width, clamps limits and restores invalid colors", () => {
  assert.deepEqual(mergePointStyle(), DEFAULT_POINT_STYLE);
  const style = mergePointStyle({ color: "invalid", size: 500, opacity: 0, borderWidth: 0, borderColor: "#nothex", showLegend: false });
  assert.equal(style.size, 200);
  assert.equal(style.opacity, 0);
  assert.equal(style.borderWidth, 0);
  assert.equal(style.color, POINT_COLOR);
  assert.equal(style.borderColor, "#ffffff");
  assert.equal(style.showLegend, false);
});

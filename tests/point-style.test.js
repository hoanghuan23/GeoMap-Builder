import test from "node:test";
import assert from "node:assert/strict";
import { buildPointView, createPointModel, DEFAULT_POINT_STYLE, mergePointStyle, normalizePointSelection, pointPaint, POINT_COLOR, POINT_COLORS } from "../src/renderers/point-style.js";
import { storeColumns, storeRecords, storeBindings } from "./fixtures/store-points-fixture.js";

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

test("Point defaults use valid measures and top five categories without including coordinates or IDs", () => {
  const records = ["F", "E", "D", "C", "B", "A"].map(type => record(type, 10));
  records.push(record("F", 20), record("F", 40), record("A", 10, { lat: 999 }));
  const model = createPointModel(records, [{ name: "empty", role: "measure" }, ...columns], bindings);
  const view = buildPointView(model);
  assert.equal(view.selection.metricField, "revenue");
  assert.equal(view.selection.groupField, "type");
  assert.deepEqual(view.selection.selectedValues, ["F", "A", "B", "C", "D"]);
  assert.equal(view.stats.visibleCount, 7);
  assert.equal(view.stats.totalCount, 8);
  assert.equal(view.stats.coordinateRate, 8 / 9);
  assert.deepEqual(model.measures.map(column => column.name), ["empty", "revenue", "rating"]);
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
  assert.equal(selected.metric.min, 0);
  const all = buildPointView(model, { ...selected.selection, mode: "all" }, selected.colors);
  assert.equal(all.data.features.length, 3);
  assert.equal(evaluate(all.paint["circle-color"], { revenue: 0 }), POINT_COLOR);
  assert.equal(all.legendRows[0].count, 3);
  assert.deepEqual(records, original);
});

test("Point selects one time, defaults to the latest and allows an empty result", () => {
  const records = [
    record("A", 10, { day: new Date("2026-07-01") }),
    record("B", 20, { day: new Date("2026-07-02") }),
    record("A", 30, { day: new Date("2026-07-03") }),
    record("A", 40, { day: null })
  ];
  const model = createPointModel(records, [...columns, { name: "day", role: "time" }], bindings);
  const latest = buildPointView(model);
  assert.equal(latest.selection.time, model.times[2]);
  assert.deepEqual(latest.data.features.map(feature => feature.properties.revenue), [30]);
  assert.equal(normalizePointSelection(model, { time: "stale" }).time, model.times[2]);
  const view = buildPointView(model, { time: model.times[0] });
  assert.equal(view.stats.visibleCount, 1);
  assert.equal(view.selection.time, model.times[0]);
  assert.equal(view.data.features[0].properties.day, "2026-07-01T00:00:00.000Z");
  const empty = buildPointView(model, { selectedValues: ["B"], time: model.times[0] }, view.colors);
  assert.equal(empty.stats.visibleCount, 0);
  assert.equal(empty.metric.min, null);
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
    assert.equal(byName.metric.min, 0);
    const byCity = buildPointView(model, { groupField: "thanh_pho" });
    assert.equal(byCity.stats.visibleCount, 2);
    assert.deepEqual(byCity.data.features.map(feature => feature.properties.ma_cua_hang), ["CH01", "CH02"]);
    assert.equal(byCity.legendRows[0].count, 2);
  }
});

test("Eight selected groups have distinct matching map/legend colors, stable across metric/time changes", () => {
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

test("Point radius handles zero, negative, missing, constant values and zoom", () => {
  const model = createPointModel([record("A", -10), record("A", 0), record("B", 10), record("B", null), record("B", "bad")], columns, bindings);
  const view = buildPointView(model);
  const radius = view.paint["circle-radius"];
  assert.equal(evaluate(radius, { revenue: -10 }), 4);
  assert.equal(evaluate(radius, { revenue: 0 }), 8);
  assert.equal(evaluate(radius, { revenue: 10 }), 12);
  assert.equal(evaluate(radius, { revenue: null }), 4);
  assert.equal(view.metric.missingCount, 2);
  assert.notEqual(evaluate(view.paint["circle-color"], { type: "A", revenue: 0 }), "rgba(0, 0, 0, 0)");
  assert.equal(evaluate(view.paint["circle-color"], { type: "B", revenue: null }), "rgba(0, 0, 0, 0)");
  assert.ok(evaluate(radius, { revenue: 10 }, 16) > evaluate(radius, { revenue: 10 }, 4));
  const constant = buildPointView(model, { metricField: "rating" });
  assert.equal(evaluate(constant.paint["circle-radius"], { rating: 4 }), 8);
  assert.equal(evaluate(constant.paint["circle-radius"], { rating: null }), 4);
});

test("Point without a measure uses a fixed color and default radius while group filters still work", () => {
  const model = createPointModel([record("A", 0), record("B", 100)], columns.filter(column => column.role !== "measure"), bindings);
  const view = buildPointView(model, { selectedValues: ["A"] }, {}, { color: "#123456" });
  assert.equal(view.metric, null);
  assert.equal(view.selection.metricField, null);
  assert.equal(view.paint["circle-color"], "#123456");
  assert.equal(evaluate(view.paint["circle-radius"], {}, 10), 6);
  assert.equal(view.data.features.length, 1);
  assert.equal(view.data.features[0].properties.type, "A");
});

test("One date remains selectable; an all-null measure remains selected without fixed-color fallback", () => {
  const records = Array.from({ length: 81 }, (_, index) => record(`G${index}`, null, { day: "2026-07-01" }));
  const model = createPointModel(records, columns.filter(column => !["rating", "name"].includes(column.name)).concat({ name: "day", role: "time" }), bindings);
  assert.equal(model.groups.length, 0);
  assert.equal(model.measures.length, 1);
  assert.equal(model.timeColumn.name, "day");
  const view = buildPointView(model);
  assert.equal(view.selection.mode, "all");
  assert.equal(view.selection.metricField, "revenue");
  assert.equal(view.selection.time, "2026-07-01");
  assert.equal(view.data.features.length, 81);
  assert.equal(evaluate(view.paint["circle-color"], { revenue: null }), "rgba(0, 0, 0, 0)");
});

test("Selection normalizes stale groups and caps to eight; category values remain ordinary data", () => {
  const records = ["__proto__", "constructor", "0", ...Array.from({ length: 8 }, (_, index) => `G${index}`)].map(type => record(type, 1));
  const model = createPointModel(records, columns, bindings);
  const selection = normalizePointSelection(model, { metricField: "missing", selectedValues: records.map(row => row.type) });
  assert.equal(selection.selectedValues.length, 8);
  const view = buildPointView(model, selection);
  assert.equal(new Set(Object.values(view.colors)).size, 8);
  assert.equal(view.legendRows.find(row => row.key === "__proto__").color, view.colors.__proto__);
  assert.equal(evaluate(view.paint["circle-color"], { type: "__proto__", revenue: 1 }), view.colors.__proto__);
  assert.equal(normalizePointSelection(model, { selectedValues: ["missing"] }).selectedValues.length, 5);
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
  assert.equal(evaluate(all.paint["circle-color"], { revenue: 0 }), "#112233");
  assert.equal(all.legendRows[0].color, "#112233");
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

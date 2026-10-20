import test from "node:test";
import assert from "node:assert/strict";
import { buildPopupChart, createPopupChartSelection, mapDisplaySuggestions } from "../src/ai-popup-chart.js";
import { normalizeBarChartConfig } from "../src/charts/bar-chart.js";
import { normalizeLineChartConfig } from "../src/charts/line-chart.js";
import { buildRegionHexGrid } from "../src/region-hex-grid.js";
import { storeColumns, storeRecords, storeBindings } from "./fixtures/store-points-fixture.js";

const columns = [
  { name: "region", role: "geo" }, { name: "date", role: "time" },
  { name: "temperature", role: "measure", aggDefault: "mean", unit: "°C" },
  { name: "rain", role: "measure", aggDefault: "sum", unit: "mm" }
];
const records = [
  { region: "A", date: new Date("2026-09-01"), temperature: 0, rain: 2 },
  { region: "A", date: new Date("2026-09-02"), temperature: null, rain: 3 },
  { region: "A", date: new Date("2026-09-03"), temperature: 30, rain: 4 },
  { region: "B", date: new Date("2026-09-01"), temperature: 90, rain: 90 },
  { region: "B", date: new Date("2026-09-03"), temperature: 90, rain: 90 }
];
const feature = { type: "Feature", properties: { region: "A", __location: "A", date: "2026-09-03", temperature: 30 },
  geometry: { type: "Polygon", coordinates: [[[105.7, 20.9], [105.9, 20.9], [105.9, 21.1], [105.7, 21.1], [105.7, 20.9]]] } };
const chart = (kind, overrides = {}) => buildPopupChart({ records, columns, feature, regionField: "region", kind,
  selection: createPopupChartSelection(records, columns, "temperature", kind), ...overrides });

test("input suggestions contain only Polygon, Line and Point, including unavailable maps", () => {
  const suggestions = ["line", "choropleth", "bar", "point", "hex_h3", "map_line"].map(chartType => ({ id: chartType, chartType, available: chartType !== "choropleth" }));
  for (const selected of [null, "point", "line", "choropleth"]) {
    assert.deepEqual(mapDisplaySuggestions(suggestions, selected).map(item => item.chartType), ["choropleth", "point", "map_line"]);
  }
  assert.deepEqual(mapDisplaySuggestions(suggestions.slice(0, 1)), [], "standalone charts never replace an unavailable map");
});

test("popup uses only clicked region, full independent date range, zero and missing points", () => {
  const before = JSON.stringify(records);
  const result = chart("line");
  assert.equal(result.message, "");
  assert.deepEqual(result.config.data.map(row => row.temperature), [0, null, 30]);
  assert.equal(result.config.data.length, 3, "the feature's displayed date must not filter the chart");
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(normalizeBarChartConfig(chart("bar").config).data.map(row => row.temperature), [0, null, 30]);
  const selection = createPopupChartSelection(records, columns, "temperature", "line");
  assert.equal(selection.from, "2026-09-01T00:00:00.000Z");
  selection.from = "2026-09-03";
  assert.match(chart("line", { selection }).message, /hai mốc/);
  assert.deepEqual(chart("bar", { selection: { ...selection, metrics: ["temperature"], variant: "single", aggregation: "auto" } }).config.data,
    [{ date: "2026-09-03", temperature: 30 }]);
});

test("popup bar and line group repeated observations using the selected measure's aggregation", () => {
  const duplicated = [...records, { region: "A", date: new Date("2026-09-03"), temperature: 20, rain: 6 }];
  assert.equal(chart("line", { records: duplicated }).config.data.at(-1).temperature, 25);
  const selection = { ...createPopupChartSelection(records, columns, "rain", "bar"), variant: "grouped", metrics: ["temperature", "rain"] };
  const result = chart("bar", { records: duplicated, selection });
  assert.deepEqual(result.config.data.at(-1), { date: "2026-09-03", temperature: 25, rain: 10 });
  const normalized = normalizeBarChartConfig(result.config);
  assert.equal(normalized.data[1].temperature, null, "missing values are not converted into zero");
  const summed = chart("bar", { records: duplicated, selection: { ...selection, aggregation: "sum" } }).config;
  assert.deepEqual(summed.data, [{ [summed.xField]: "A", temperature: 50, rain: 15 }]);
  const averaged = chart("bar", { records: duplicated, selection: { ...selection, aggregation: "mean" } }).config;
  assert.equal(averaged.data[0].temperature, 50 / 3, "average the original observations, excluding missing values and retaining zero");
  assert.equal(averaged.data[0].rain, 15 / 4);
});

for (const [aggregation, fullMonth, partialMonth] of [
  ["sum", 465, 165], ["mean", 15.5, 15], ["min", 1, 10], ["max", 30, 20]
]) {
  test(`popup bar ${aggregation} summarizes the clicked region over the entire inclusive date range`, () => {
    const month = ["A", "B"].flatMap(region => Array.from({ length: 32 }, (_, day) => ({
      region, date: new Date(Date.UTC(2026, 8, day)),
      temperature: region === "A" && day >= 1 && day <= 30 ? day : 1000
    })));
    const before = JSON.stringify(month);
    for (const [from, to, expected] of [
      ["2026-09-01", "2026-09-30", fullMonth],
      ["2026-09-10", "2026-09-20", partialMonth],
      ["2026-09-15", "2026-09-15", 15]
    ]) {
      const selection = { ...createPopupChartSelection(month, columns, "temperature", "bar"), aggregation, from, to };
      const result = chart("bar", { records: month, selection });
      assert.equal(result.message, "");
      assert.deepEqual(result.config.data, [{ [result.config.xField]: "A", temperature: expected }]);
      assert.equal(result.config.timeColumn, null, "the summarized region is not a time axis");
      assert.equal(normalizeBarChartConfig(result.config).data[0].temperature, expected);
    }
    assert.equal(JSON.stringify(month), before);
  });
}

test("popup bar range summaries retain missing measures and count only the selected observations", () => {
  const selection = { ...createPopupChartSelection(records, columns, "temperature", "bar"),
    variant: "grouped", metrics: ["temperature", "rain", "count"], aggregation: "sum", from: "2026-09-01", to: "2026-09-02" };
  const result = chart("bar", { selection }).config;
  assert.deepEqual(result.data, [{ [result.xField]: "A", temperature: 0, rain: 5, __count: 2 }]);
  selection.from = "2026-09-02";
  const missing = chart("bar", { selection }).config;
  assert.deepEqual(normalizeBarChartConfig(missing).data,
    [{ [missing.xField]: "A", temperature: null, rain: 3, __count: 1 }]);
  assert.match(chart("bar", { selection: { ...selection, variant: "single", metrics: ["temperature"] } }).message, /Không có số liệu/);
});

test("popup rendering preserves spreadsheet field keys with surrounding whitespace when switching metrics", () => {
  const average = "Nhiệt độ trung bình\u00a0";
  const minimum = "Nhiệt độ thấp nhất";
  const weatherColumns = [columns[0], columns[1],
    { name: average, labelVi: "Nhiệt độ trung bình", role: "measure", aggDefault: "mean", unit: "°C" },
    { name: minimum, role: "measure", aggDefault: "min", unit: "°C" }];
  const weatherRecords = [24.4, 23.7, 24.7, 23.2, 24.3, 23, 24.9].map((value, index) => ({
    region: "Lào Cai", date: new Date(Date.UTC(2026, 8, index + 1)), [average]: value, [minimum]: value - 3
  }));
  for (const kind of ["bar", "line"]) {
    for (const metric of [average, minimum, average]) {
      const chart = buildPopupChart({ records: weatherRecords, columns: weatherColumns, feature: { properties: { region: "Lào Cai" } },
        regionField: "region", kind, selection: createPopupChartSelection(weatherRecords, weatherColumns, metric, kind) });
      assert.equal(chart.message, "");
      const rendered = kind === "bar" ? normalizeBarChartConfig(chart.config) : normalizeLineChartConfig(chart.config);
      assert.equal(rendered.series[0].key, metric);
      assert.deepEqual(rendered.data.map(row => row[rendered.series[0].key]), weatherRecords.map(row => row[metric]));
    }
  }
});

test("chart normalization preserves exact category keys and distinguishes metrics that differ by whitespace", () => {
  const config = { xField: " Ngày ", preserveMissingValues: true,
    series: [{ key: "value", label: "Chỉ số A" }, { key: " value ", label: "Chỉ số B" }],
    data: [{ " Ngày ": "01/09/2026", value: 0, " value ": 24.4 }, { " Ngày ": "02/09/2026", value: null, " value ": 23.7 }] };
  for (const normalize of [normalizeBarChartConfig, normalizeLineChartConfig]) {
    const normalized = normalize(config);
    assert.equal(normalized.xField, config.xField);
    assert.deepEqual(normalized.series.map(item => item.key), ["value", " value "]);
    assert.deepEqual(normalized.data, config.data);
    assert.throws(() => normalize({ ...config, xField: " \t " }), /chuỗi không rỗng/);
    assert.throws(() => normalize({ ...config, series: [{ key: " \t " }] }), /chuỗi không rỗng/);
  }
});

test("polygon and inherited hex cells produce the same regional chart", () => {
  const cells = buildRegionHexGrid({ type: "FeatureCollection", features: [feature] }, 7).data;
  assert.ok(cells.features.length);
  assert.deepEqual(chart("line", { feature: cells.features[0] }).config, chart("line").config);
});

test("missing region, empty range and invalid measures return informative empty states", () => {
  assert.match(chart("bar", { feature: { properties: { region: "unknown" } } }).message, /Không có dữ liệu/);
  assert.match(chart("bar", { records: [] }).message, /Không có dữ liệu/);
  assert.match(chart("line", { selection: { measure: "absent" } }).message, /Chưa có chỉ số/);
  assert.match(chart("bar", { selection: { metrics: ["temperature"], from: "2027-01-01", to: "2027-01-02" } }).message, /khoảng thời gian/);
  assert.match(chart("line", { records: records.map(row => ({ ...row, temperature: null })) }).message, /Không có số liệu/);
  const unknown = columns.map(column => column.name === "temperature" ? { name: "value", role: "measure" } : column);
  assert.match(chart("line", { columns: unknown, records: [...records, records[0]].map(row => ({ ...row, value: row.temperature })),
    selection: { measure: "value" } }).message, /chưa xác định phép gộp/);
});

test("bar without time aggregates the region and line explains the missing time field", () => {
  const noTime = columns.filter(column => column.role !== "time");
  const result = chart("bar", { columns: noTime });
  assert.deepEqual(result.config.data, [{ region: "A", temperature: 15 }]);
  assert.match(chart("line", { columns: noTime }).message, /cột thời gian/);
});

test("bar popup retains distinct timestamps and formats hours and minutes", () => {
  const result = chart("bar", { records: [
    { region: "A", date: new Date("2026-09-01T01:00:00Z"), temperature: 20 },
    { region: "A", date: new Date("2026-09-01T08:30:00Z"), temperature: 30 }
  ] });
  assert.equal(result.config.data.length, 2);
  assert.notEqual(result.config.data[0].date, result.config.data[1].date);
  assert.equal(result.config.timeColumn.granularity, "datetime");
});

test("road popup isolates the clicked area's name and code across all observation times", () => {
  const columns = [{ name: "Khu vực", role: "geo", geoLevel: "admin1" }, { name: "Tên đường", role: "category" },
    { name: "Mã đường", role: "id" }, { name: "Thời điểm", role: "time" },
    { name: "Tốc độ", role: "measure", aggDefault: "mean", unit: "km/h" }, { name: "Mức độ ùn tắc", role: "category" }];
  const records = ["Hà Nội", "An Giang"].flatMap((area, i) => ["QL.1", "CT.01", ""].flatMap((ref, j) => ["08:00", "17:30", "22:00"].map((time, k) => ({
    "Khu vực": area, "Tên đường": "Đường A", "Mã đường": ref, "Thời điểm": new Date(`2026-10-13T${time}:00Z`),
    "Tốc độ": [24, 20, 38][k] + i * 100 + j * 10, "Mức độ ùn tắc": "Đông"
  }))));
  const feature = { properties: { "Khu vực": "HN", "Tên đường": "Đường A", "Mã đường": "QL1" } };
  const selection = createPopupChartSelection(records, columns, "Mức độ ùn tắc", "line");
  assert.equal(selection.measure, "Tốc độ", "categorical map coloring defaults the chart to a numeric measure");
  for (const kind of ["line", "bar"]) {
    const result = buildPopupChart({ records, columns, feature, regionField: "Tên đường", kind, chartType: "map_line",
      selection: createPopupChartSelection(records, columns, "Mức độ ùn tắc", kind) });
    assert.equal(result.message, "");
    assert.deepEqual(result.config.data.map(row => row["Tốc độ"]), [24, 20, 38]);
    assert.equal(result.config.timeColumn.granularity, "datetime");
  }
});

test("Point popup isolates the clicked store by ID, even when stores share a city and coordinates", () => {
  const records = storeRecords.map(record => ({ ...record, vi_do: 21, kinh_do: 105 }));
  const feature = { properties: { ...records[0], thang: "2026-03-01" } };
  for (const kind of ["bar", "line"]) {
    const selection = createPopupChartSelection(records, storeColumns, "doanh_thu_vnd", kind);
    const result = buildPopupChart({ records, columns: storeColumns, feature, kind, chartType: "point", bindings: storeBindings, selection });
    assert.equal(result.message, "");
    assert.deepEqual(result.config.data.map(row => row.doanh_thu_vnd), [0, null, 200]);
    assert.match(result.config.title, /Cửa hàng CH01/);
  }
});

test("Point popup falls back to coordinates when there is no object ID and aggregates without time", () => {
  const columns = storeColumns.filter(column => !["id", "time"].includes(column.role));
  const result = buildPopupChart({ records: storeRecords, columns, feature: { properties: storeRecords[0] },
    kind: "bar", chartType: "point", bindings: { lat: "vi_do", lng: "kinh_do" },
    selection: createPopupChartSelection(storeRecords, columns, "doanh_thu_vnd", "bar") });
  assert.equal(result.config.data.length, 1);
  assert.equal(result.config.data[0].doanh_thu_vnd, 200);
});

test("coordinate Line popup selects only the clicked route's original time observations", () => {
  const columns = [{ name: "route", role: "id" }, { name: "date", role: "time" }, { name: "speed", role: "measure", aggDefault: "mean" }];
  const records = ["A", "B"].flatMap((route, i) => [1, 2].map(day => ({ route, date: new Date(`2026-01-0${day}`), speed: i * 100 + day })));
  const result = buildPopupChart({ records, columns, feature: { properties: { route: "A" } }, regionField: "route",
    chartType: "map_line", bindings: { lat: "lat", lng: "lng", region: "route", x: "date" }, kind: "line",
    selection: createPopupChartSelection(records, columns, "speed", "line") });
  assert.deepEqual(result.config.data.map(row => row.speed), [1, 2]);
});

test("coordinate and sequence dimensions cannot become popup measures", () => {
  const columns = [{ name: "lat", role: "measure" }, { name: "lng", role: "measure" }, { name: "stt", role: "measure" }];
  const bindings = { lat: "lat", lng: "lng", x: "stt" };
  const records = [{ lat: 21, lng: 105, stt: 1 }, { lat: 22, lng: 106, stt: 2 }];
  const selection = createPopupChartSelection(records, columns, "lat", "bar", bindings);
  assert.deepEqual(selection.metrics, ["count"]);
  const result = buildPopupChart({ records, columns, bindings, feature: { properties: records[0] }, chartType: "map_line", kind: "bar", selection });
  assert.equal(result.config.data[0].__count, 2);
});

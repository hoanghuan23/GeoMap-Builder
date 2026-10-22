import test from "node:test";
import assert from "node:assert/strict";
import { buildBarChartOption, buildLineChartOption, defaultBarMetrics, defaultTimeFilter, evaluateSuggestion, prepareSuggestions, withSuggestionMetric } from "../src/ai-chart-pipeline.js";
import { validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { normalizeTabularRecords } from "../src/tabular-data.js";
import { parseSpreadsheetBuffer } from "../src/tabular-parser.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { createWeather34Workbook, WEATHER_PROVINCES } from "./fixtures/weather-34-fixture.js";

const columns = [
  { name: "date", role: "time" },
  { name: "province", role: "geo" },
  { name: "rain", role: "measure", aggDefault: "sum", unit: "mm" }
];

test("map feasibility preserves its own popup recommendations through preparation", () => {
  const popupSuggestions = [{ name: "line", confidence: .96 }, { name: "info", confidence: .91 }];
  const records = ["A", "B"].map(province => ({ province, date: new Date("2026-09-01"), rain: 10 }));
  const analysis = { columns, suggestions: [{ id: "map", chartType: "choropleth", confidence: .9,
    bindings: { region: "province", value: "rain" }, popupSuggestions }] };
  const result = prepareSuggestions(analysis, records, { province: 1, date: 1, rain: 1 }, { mapOnly: true });
  assert.deepEqual(result[0].popupSuggestions, popupSuggestions);
  assert.equal(result[0].available, true);
  const rule = prepareSuggestions({ columns: columns.map(column => column.role === "geo" ? { ...column, geoLevel: "admin1" } : column),
    suggestions: [] }, records, { province: 1, date: 1, rain: 1 }, { mapOnly: true });
  assert.deepEqual(rule, [], "an empty AI decision stays empty");
});

test("bar aggregate theo nhóm và gộp phần dư thành Khác", () => {
  const records = Array.from({ length: 15 }, (_, index) => ({ province: `P${index}`, rain: index + 1 }));
  const option = buildBarChartOption({ id: "bar", title: "Mưa", reason: "", bindings: { x: "province", y: "rain" }, agg: "sum" }, records, columns, { top: 3 });
  assert.equal(option.config.data.length, 4);
  assert.equal(option.config.data.at(-1).province, "Khác");
  assert.equal(option.config.data.at(-1).rain, 78);
});

test("bar ghép mặc định hai chỉ số và gộp từng chỉ số đúng phép tính", () => {
  const metricColumns = [
    ...columns,
    { name: "temperature", role: "measure", aggDefault: "mean", labelVi: "Nhiệt độ", unit: "°C" },
    { name: "humidity", role: "measure", aggDefault: "mean", labelVi: "Độ ẩm", unit: "%" }
  ];
  const suggestion = { id: "bar", title: "Thời tiết", reason: "", bindings: { x: "province", y: "rain" }, agg: "sum" };
  assert.deepEqual(defaultBarMetrics(suggestion, metricColumns, "grouped"), ["rain"]);
  const option = buildBarChartOption(suggestion, [
    { province: "A", rain: 2, temperature: 20, humidity: 70 },
    { province: "A", rain: 3, temperature: 30, humidity: 80 },
    { province: "B", rain: 4, temperature: 25, humidity: 75 }
  ], metricColumns, { variant: "grouped", metrics: ["rain", "temperature"] });
  assert.equal(option.config.variant, "grouped");
  assert.equal(option.icon, "groupedBar");
  assert.equal(option.config.showLegend, true);
  assert.deepEqual(option.config.series.map(item => item.key), ["rain", "temperature"]);
  assert.deepEqual(option.config.data.find(row => row.province === "A"), { province: "A", rain: 5, temperature: 25 });
});

test("bar cột đơn ưu tiên SUM hoặc AVG người dùng chọn so với cấu hình AI và chỉ số", () => {
  const metricColumns = [...columns, { name: "temperature", role: "measure", aggDefault: "mean" }];
  const suggestion = { id: "bar", title: "Nhiệt độ", bindings: { x: "province", y: "temperature" }, agg: "mean" };
  const records = [{ province: "A", temperature: 20 }, { province: "A", temperature: 30 }];
  for (const [aggregation, expected] of [["sum", 50], ["mean", 25]]) {
    const option = buildBarChartOption(suggestion, records, metricColumns, { aggregation });
    assert.equal(option.config.aggregation, aggregation);
    assert.equal(option.config.data[0].temperature, expected);
  }
  const sumSuggestion = { ...suggestion, agg: "sum" };
  assert.equal(buildBarChartOption(sumSuggestion, records, metricColumns, { aggregation: "mean" }).config.data[0].temperature, 25);
  assert.equal(suggestion.agg, "mean");
});

test("bar ghép áp dụng phép tính đã chọn cho mọi chỉ số, tính Khác từ dữ liệu gốc và giữ phép đếm", () => {
  const metricColumns = [...columns, { name: "temperature", role: "measure", aggDefault: "mean" }];
  const suggestion = { id: "bar", title: "Thời tiết", bindings: { x: "province", y: "rain" }, agg: "sum" };
  const records = [
    { province: "A", rain: 100, temperature: 10 },
    { province: "A", rain: 200, temperature: 30 },
    { province: "B", rain: 20, temperature: 50 },
    { province: "C", rain: 10, temperature: 70 },
    { province: "C", rain: 20, temperature: null }
  ];
  const options = { variant: "grouped", metrics: ["rain", "temperature", "count"], top: 1 };
  const summed = buildBarChartOption(suggestion, records, metricColumns, { ...options, aggregation: "sum" });
  assert.deepEqual(summed.config.data, [
    { province: "A", rain: 300, temperature: 40, __count: 2 },
    { province: "Khác", rain: 50, temperature: 120, __count: 3 }
  ]);
  const averaged = buildBarChartOption(suggestion, records, metricColumns, { ...options, aggregation: "mean" });
  assert.deepEqual(averaged.config.data, [
    { province: "A", rain: 150, temperature: 20, __count: 2 },
    { province: "Khác", rain: 50 / 3, temperature: 60, __count: 3 }
  ]);
});

test("bảng doanh thu giữ đúng đề xuất Line của AI và không tự bổ sung Bar", () => {
  const records = Array.from({ length: 12 }, (_, index) => ({
    "Tháng": `T${String(index + 1).padStart(2, "0")}`,
    "Miền Bắc": 100 + index,
    "Miền Trung": 80 + index,
    "Miền Nam": 70 + index,
    "Tổng doanh thu": 250 + index * 3
  }));
  const profile = {
    rowCount: records.length,
    columns: [
      { name: "Tháng", inferredType: "text", uniqueCount: 12 },
      { name: "Miền Bắc", inferredType: "number", uniqueCount: 12 },
      { name: "Miền Trung", inferredType: "number", uniqueCount: 12 },
      { name: "Miền Nam", inferredType: "number", uniqueCount: 12 },
      { name: "Tổng doanh thu", inferredType: "number", uniqueCount: 12 }
    ]
  };
  const analysis = validateAndNormalizeAnalysis({
    datasetTitle: "Doanh thu theo tháng và miền",
    grain: "một tháng",
    columns: [
      { name: "Tháng", role: "time", timeParse: "text", granularity: "month", labelVi: "Tháng" },
      { name: "Miền Bắc", role: "measure", aggDefault: "sum", unit: "VND" },
      { name: "Miền Trung", role: "measure", aggDefault: "sum", unit: "VND" },
      { name: "Miền Nam", role: "measure", aggDefault: "sum", unit: "VND" },
      { name: "Tổng doanh thu", role: "measure", aggDefault: "sum", unit: "VND" }
    ],
    suggestions: [{
      id: "revenue-line",
      chartType: "line",
      title: "Biểu đồ đường theo tháng",
      bindings: { x: "Tháng", y: ["Miền Bắc", "Miền Trung", "Miền Nam"] },
      confidence: .98
    }]
  }, profile);
  const normalized = normalizeTabularRecords(records, analysis.columns);
  const suggestions = prepareSuggestions(analysis, normalized.records, normalized.validRowRate);
  const line = suggestions.find(item => item.chartType === "line");
  const bar = suggestions.find(item => item.chartType === "bar");

  assert.equal(line.available, true);
  assert.equal(bar, undefined);
  const option = buildLineChartOption(line, normalized.records, analysis.columns);
  assert.deepEqual(option.config.data.map(row => row["Tháng"]), records.map(record => record["Tháng"]));
});

test("line long format chỉ chọn năm series có nhiều điểm nhất và pivot đúng", () => {
  const records = [];
  for (let province = 0; province < 7; province++) {
    for (let day = 1; day <= 3; day++) records.push({ date: new Date(`2026-09-0${day}T00:00:00Z`), province: `P${province}`, rain: province + day });
  }
  const option = buildLineChartOption({ id: "line", title: "Mưa", reason: "", bindings: { x: "date", y: ["rain"], series: "province" }, agg: "sum" }, records, columns);
  assert.equal(option.config.series.length, 5);
  assert.equal(option.availableSeries.length, 7);
  assert.equal(option.config.data.length, 3);
  assert.equal(option.config.data[0].date, "2026-09-01");
});

test("line long format nhiều measure chỉ dựng chuỗi theo measure đang chọn", () => {
  const metricColumns = [
    { name: "date", role: "time", labelVi: "Ngày" },
    { name: "province", role: "geo", labelVi: "Tỉnh" },
    { name: "rain", role: "measure", labelVi: "Lượng mưa", aggDefault: "sum", unit: "mm" },
    { name: "temperature", role: "measure", labelVi: "Nhiệt độ trung bình", aggDefault: "mean", unit: "°C" }
  ];
  const records = [];
  for (let province = 0; province < 3; province++) {
    for (let day = 1; day <= 2; day++) records.push({
      date: new Date(`2026-09-0${day}T00:00:00Z`),
      province: `P${province}`,
      rain: province + day,
      temperature: 20 + province + day
    });
  }
  const suggestion = { id: "line", title: "Thời tiết", reason: "Lý do dài", bindings: { x: "date", y: ["rain", "temperature"], series: "province" }, agg: null };
  const initial = buildLineChartOption(suggestion, records, metricColumns);
  assert.equal(initial.availableSeries.length, 3);
  assert.deepEqual(initial.availableMeasures.map(item => item.key), ["rain", "temperature"]);
  assert.equal(initial.activeMeasure, "rain");
  assert.equal(initial.config.aggregation, "sum");

  const changed = buildLineChartOption(suggestion, records, metricColumns, { selectedSeries: ["P1", "P2"], measure: "temperature" });
  assert.deepEqual(changed.selectedSeries, ["P1", "P2"]);
  assert.equal(changed.activeMeasure, "temperature");
  assert.equal(changed.config.aggregation, "mean");
  assert.equal(changed.config.title, "Nhiệt độ trung bình theo ngày");
  assert.equal(changed.config.subtitle, "2/3 chuỗi · 2026-09-01 – 2026-09-02");
  assert.equal(changed.config.unit, "°C");
  assert.equal(changed.config.data[0].P1, 22);
});

test("line gộp tất cả theo aggDefault của chỉ số người dùng chọn", () => {
  const metricColumns = [
    { name: "month", role: "time", labelVi: "Tháng" },
    { name: "province", role: "geo", labelVi: "Tỉnh/thành phố" },
    { name: "revenue", role: "measure", labelVi: "Doanh thu", aggDefault: "sum" },
    { name: "return_rate", role: "measure", labelVi: "Tỷ lệ hoàn đơn (%)", aggDefault: "mean", unit: "%" }
  ];
  const records = [
    { month: new Date("2026-01-01T00:00:00Z"), province: "A", revenue: 10, return_rate: 2 },
    { month: new Date("2026-01-01T00:00:00Z"), province: "B", revenue: 20, return_rate: 4 },
    { month: new Date("2026-02-01T00:00:00Z"), province: "A", revenue: 30, return_rate: 3 },
    { month: new Date("2026-02-01T00:00:00Z"), province: "B", revenue: 40, return_rate: 5 }
  ];
  const suggestion = {
    id: "sales-line",
    title: "Doanh thu theo tháng",
    bindings: { x: "month", y: ["revenue"], series: "province" },
    agg: "sum"
  };
  const option = buildLineChartOption(suggestion, records, metricColumns, {
    seriesField: null,
    measure: "return_rate",
    scopeLabel: "2 tỉnh/thành phố"
  });

  assert.equal(option.config.aggregation, "mean");
  assert.equal(option.config.data[0].return_rate, 3);
  assert.equal(option.config.series.length, 1);
  assert.equal(option.config.subtitle, "Trung bình 2 tỉnh/thành phố · 2026-01-01 – 2026-02-01");
});

test("line cho phép chọn measure nằm ngoài bindings.y", () => {
  const metricColumns = [
    ...columns,
    { name: "temperature", role: "measure", labelVi: "Nhiệt độ", aggDefault: "mean", unit: "°C" }
  ];
  const suggestion = { id: "line", title: "Mưa", bindings: { x: "date", y: ["rain"], series: "province" }, agg: "sum" };
  const records = [
    { date: new Date("2026-09-01T00:00:00Z"), province: "A", rain: 1, temperature: 29 },
    { date: new Date("2026-09-02T00:00:00Z"), province: "A", rain: 2, temperature: 30 }
  ];
  const option = buildLineChartOption(suggestion, records, metricColumns, { measure: "temperature" });

  assert.deepEqual(option.availableMeasures.map(item => item.key), ["rain", "temperature"]);
  assert.equal(option.activeMeasure, "temperature");
  assert.equal(option.config.series[0].key, "A");
  assert.equal(option.config.data[0].A, 29);
  assert.equal(option.config.aggregation, "mean");
});

test("line giới hạn selectedSeries theo maxSeries", () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    date: new Date("2026-09-01T00:00:00Z"),
    province: `P${index}`,
    rain: index + 1
  }));
  const selectedSeries = records.map(record => record.province);
  const option = buildLineChartOption(
    { id: "line", title: "Mưa", bindings: { x: "date", y: ["rain"], series: "province" }, agg: "sum" },
    records,
    columns,
    { selectedSeries, maxSeries: 3 }
  );

  assert.equal(option.maxSeries, 3);
  assert.deepEqual(option.selectedSeries, ["P0", "P1", "P2"]);
  assert.equal(option.config.series.length, 3);
});

test("feasibility khóa line chỉ có một mốc và giữ nguyên confidence AI", () => {
  const result = evaluateSuggestion(
    { id: "line", chartType: "line", title: "L", bindings: { x: "date", y: ["rain"] }, confidence: .9 },
    [{ date: new Date(), rain: 1 }], columns, { date: 1, rain: 1 }
  );
  assert.equal(result.available, false);
  assert.equal(result.effectiveConfidence, .9);
});

test("H3 bị khóa nếu các điểm hợp lệ chỉ tạo thành một cell", () => {
  const result = evaluateSuggestion(
    { id: "h3", chartType: "hex_h3", title: "H3", bindings: { lat: "lat", lng: "lng", value: "rain" }, confidence: .9 },
    [{ lat: 21.0285, lng: 105.8542, rain: 1 }, { lat: 21.02851, lng: 105.85421, rain: 2 }],
    [{ name: "lat", role: "geo" }, { name: "lng", role: "geo" }, { name: "rain", role: "measure" }],
    { lat: 1, lng: 1, rain: 1 }
  );
  assert.equal(result.available, false);
  assert.match(result.unavailableReason, /hai ô H3/);
});

test("AI suggestions remain empty across weather, traffic and coordinate datasets", () => {
  for (const [columns, records] of [
    [[{ name: "province", role: "geo", geoLevel: "admin1" }, { name: "temperature", role: "measure", aggDefault: "mean" }], [{ province: "A", temperature: 20 }, { province: "B", temperature: 30 }]],
    [[{ name: "Khu vực", role: "geo", geoLevel: "admin1" }, { name: "Tên đường", role: "category" }, { name: "speed", role: "measure" }], [{ "Khu vực": "Hà Nội", "Tên đường": "A", speed: 20 }]],
    [[{ name: "lat", role: "geo", geoLevel: "point_lat" }, { name: "lng", role: "geo", geoLevel: "point_lng" }], [{ lat: 21, lng: 105 }, { lat: 22, lng: 106 }]]
  ]) assert.deepEqual(prepareSuggestions({ columns, suggestions: [] }, records, {}, { mapOnly: true }), []);
});

test("AI priority is preserved across renderable map types", () => {
  const columns = [{ name: "lat", role: "geo", geoLevel: "point_lat" }, { name: "lng", role: "geo", geoLevel: "point_lng" }];
  const suggestions = [
    { id: "point", chartType: "point", confidence: .99, bindings: { lat: "lat", lng: "lng" } },
    { id: "line", chartType: "map_line", confidence: .8, bindings: { lat: "lat", lng: "lng" } }
  ];
  const result = prepareSuggestions({ columns, suggestions }, [{ lat: 21, lng: 105 }, { lat: 22, lng: 106 }], {}, { mapOnly: true });
  assert.deepEqual(result.map(item => item.id), ["point", "line"]);
  assert.ok(result.every(item => item.available));
});

test("đổi chỉ số cập nhật phép gộp và tiêu đề cho bar, polygon và H3", () => {
  const metricColumns = [
    ...columns,
    { name: "temperature", role: "measure", aggDefault: "mean", labelVi: "Nhiệt độ trung bình", unit: "°C" }
  ];
  for (const chartType of ["bar", "choropleth", "hex_h3"]) {
    const original = { id: chartType, chartType, title: "Lượng mưa", agg: "sum", bindings: chartType === "bar"
      ? { x: "province", y: "rain" }
      : chartType === "choropleth" ? { region: "province", value: "rain" } : { lat: "lat", lng: "lng", value: "rain" } };
    const changed = withSuggestionMetric(original, "temperature", metricColumns);
    assert.equal(changed.agg, "mean");
    assert.match(changed.title, /^Nhiệt độ trung bình theo /);
    assert.equal(original.agg, "sum");
    assert.equal(original.bindings[chartType === "bar" ? "y" : "value"], "rain");
    if (chartType === "bar") {
      const option = buildBarChartOption(changed, [
        { province: "A", temperature: 20 }, { province: "A", temperature: 30 }
      ], metricColumns);
      assert.equal(option.config.data[0].temperature, 25);
      assert.equal(option.config.title, changed.title);
      assert.equal(option.config.unit, "°C");
    }
    assert.equal(withSuggestionMetric(changed, "rain", metricColumns).agg, "sum");
  }
});

test("đổi từ đếm sang chỉ số dùng lại phép gộp của cột mới", () => {
  const original = { chartType: "bar", bindings: { x: "province", y: "rain" }, agg: "sum" };
  const counted = withSuggestionMetric(original, "count", columns);
  assert.equal(counted.agg, "count");
  assert.match(counted.title, /^Số bản ghi theo /);
  assert.equal(withSuggestionMetric(counted, "rain", columns).agg, "sum");
});

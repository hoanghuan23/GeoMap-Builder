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
  assert.deepEqual(defaultBarMetrics(suggestion, metricColumns, "grouped"), ["rain", "temperature"]);
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

test("feasibility kết hợp coverage với confidence và khóa line chỉ có một mốc", () => {
  const result = evaluateSuggestion(
    { id: "line", chartType: "line", title: "L", bindings: { x: "date", y: ["rain"] }, confidence: .9 },
    [{ date: new Date(), rain: 1 }], columns, { date: 1, rain: 1 }
  );
  assert.equal(result.available, false);
  assert.equal(result.effectiveConfidence, .74);
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

test("bảng thời tiết 34 tỉnh vẫn có biểu đồ vùng khi AI bỏ sót, lọc ngày rồi ghép đúng vùng", () => {
  const parsed = parseSpreadsheetBuffer(createWeather34Workbook(), { sheetName: "Thoi_tiet_thang_9" });
  const line = {
    id: "weather-line", chartType: "line", title: "Xu hướng nhiệt độ", confidence: .95,
    bindings: { x: "Ngày", y: ["Nhiệt độ trung bình"], series: "Tỉnh/thành phố" }
  };
  const analysis = validateAndNormalizeAnalysis({
    datasetTitle: "Thời tiết", grain: "một tỉnh một ngày",
    columns: [{ name: "Tỉnh/thành phố", role: "category" }],
    suggestions: [line]
  }, parsed.profile);
  const normalized = normalizeTabularRecords(parsed.records, analysis.columns);
  const suggestions = prepareSuggestions(analysis, normalized.records, normalized.validRowRate, { mapTilerAvailable: true });
  const choropleth = suggestions.find(item => item.chartType === "choropleth");
  assert.equal(choropleth.available, true);
  assert.deepEqual(choropleth.bindings, { region: "Tỉnh/thành phố", value: "Nhiệt độ trung bình" });
  assert.equal(choropleth.agg, "mean");
  assert.equal(choropleth.source, "rule");
  assert.equal(suggestions.find(item => item.chartType === "line").id, line.id);
  assert.equal(suggestions.some(item => ["point", "hex_h3"].includes(item.chartType)), false);

  const time = defaultTimeFilter(normalized.records, analysis.columns, choropleth.chartType);
  assert.equal(time.default, "2026-09-30T00:00:00.000Z");
  const boundaries = { type: "FeatureCollection", features: WEATHER_PROVINCES.map((name, index) => ({
    type: "Feature", properties: { __data_location: name },
    geometry: { type: "Polygon", coordinates: [[[index, 0], [index + 1, 0], [index + 1, 1], [index, 0]]] }
  })) };
  const data = joinRecordsToMapTilerBoundaries(normalized.records, boundaries, {
    geometry: { field: choropleth.bindings.region },
    metricField: choropleth.bindings.value,
    aggregation: choropleth.agg
  }, { filters: { [time.column]: time.default }, columns: analysis.columns });
  assert.equal(data.features.length, 34);
  for (const feature of data.features) {
    const record = normalized.records.find(record => record["Tỉnh/thành phố"] === feature.properties.__location
      && record["Ngày"].toISOString() === time.default);
    assert.equal(feature.properties["Nhiệt độ trung bình"], record["Nhiệt độ trung bình"]);
    assert.equal(feature.properties.__record_count, 1);
  }
});

test("chỉ bổ sung biểu đồ vùng khi có số liệu hợp lệ ở ít nhất hai địa phương", () => {
  const regionColumns = [
    { name: "province", role: "geo", geoLevel: "admin1" },
    { name: "temperature", role: "measure", aggDefault: "mean" }
  ];
  const analysis = { columns: regionColumns, suggestions: [] };
  const coverage = { province: 1, temperature: 1 };
  for (const records of [
    [{ province: "Hà Nội", temperature: 29 }, { province: "Hà Nội", temperature: 30 }],
    [{ province: "Hà Nội", temperature: 29 }, { province: "Huế", temperature: null }]
  ]) {
    assert.deepEqual(prepareSuggestions(analysis, records, coverage), []);
  }
  const records = [{ province: "Hà Nội", temperature: 29 }, { province: "Huế", temperature: 30 }];
  const [unavailable] = prepareSuggestions(analysis, records, coverage, { mapTilerAvailable: false });
  assert.equal(unavailable.chartType, "choropleth");
  assert.equal(unavailable.available, false);
  assert.match(unavailable.unavailableReason, /MAPTILER_API_KEY/);
  const [available] = prepareSuggestions(analysis, records, coverage);
  const preserved = prepareSuggestions({ ...analysis, suggestions: [available] }, records, coverage);
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].id, available.id);
  assert.deepEqual(analysis.suggestions, []);
});

test("cặp tọa độ luôn tạo đề xuất Point và loại đề xuất H3", () => {
  const analysis = {
    columns: [
      { name: "Vĩ độ", role: "geo", geoLevel: "point_lat" },
      { name: "Kinh độ", role: "geo", geoLevel: "point_lng" },
      { name: "Doanh thu", role: "measure", aggDefault: "sum" }
    ],
    suggestions: [
      {
        id: "h3",
        chartType: "hex_h3",
        title: "Doanh thu theo ô H3",
        bindings: { lat: "Vĩ độ", lng: "Kinh độ", value: "Doanh thu" },
        confidence: .99
      },
      {
        id: "bar",
        chartType: "bar",
        title: "Doanh thu",
        bindings: { x: "Doanh thu", y: "Doanh thu" },
        confidence: 1
      }
    ]
  };
  const suggestions = prepareSuggestions(analysis, [
    { "Vĩ độ": 21.02, "Kinh độ": 105.83, "Doanh thu": 10 },
    { "Vĩ độ": 21.05, "Kinh độ": 105.79, "Doanh thu": 20 }
  ], { "Vĩ độ": 1, "Kinh độ": 1, "Doanh thu": 1 });

  assert.deepEqual(suggestions.map(item => item.chartType), ["point", "bar"]);
  assert.equal(suggestions[0].available, true);
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

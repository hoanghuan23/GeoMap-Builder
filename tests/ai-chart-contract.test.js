import test from "node:test";
import assert from "node:assert/strict";
import { ANALYSIS_RESPONSE_SCHEMA, fallbackAnalysis, validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";

const profile = {
  rowCount: 2,
  columns: [
    { name: "province", inferredType: "text", uniqueCount: 2 },
    { name: "date", inferredType: "date", dateHint: "iso", uniqueCount: 2 },
    { name: "temperature", inferredType: "number", uniqueCount: 2 },
    { name: "note", inferredType: "text", uniqueCount: 2 }
  ]
};

test("AI search defaults survive server/client normalization and reject invalid fields", () => {
  assert.ok(ANALYSIS_RESPONSE_SCHEMA.required.includes("search_bar"));
  assert.ok(ANALYSIS_RESPONSE_SCHEMA.required.includes("search_fields"));
  const raw = { columns: [{ name: "note", role: "text" }], suggestions: [], search_bar: true,
    search_fields: ["note", "province", "note", "temperature", "date", "missing", null] };
  const normalized = validateAndNormalizeAnalysis(raw, profile);
  assert.equal(normalized.search_bar, true);
  assert.deepEqual(normalized.search_fields, ["note", "province"]);
  assert.deepEqual(validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(normalized)), profile), normalized);
  const disabled = validateAndNormalizeAnalysis({ ...raw, search_bar: false }, profile);
  assert.equal(disabled.search_bar, false);
  assert.deepEqual(disabled.search_fields, ["note", "province"]);
  for (const search_fields of [null, {}, "province", [], ["missing", "temperature", "date"]]) {
    const result = validateAndNormalizeAnalysis({ ...raw, search_fields }, profile);
    assert.equal(result.search_bar, false);
    assert.deepEqual(result.search_fields, []);
  }
  const legacy = validateAndNormalizeAnalysis({ columns: [], suggestions: [] }, profile);
  assert.equal(Object.hasOwn(legacy, "search_bar"), false);
  assert.equal(Object.hasOwn(legacy, "search_fields"), false);
});

test("strict schema requires nullable semantic and legend fields on every AI column/suggestion", () => {
  const columns = ANALYSIS_RESPONSE_SCHEMA.properties.columns.items;
  const suggestions = ANALYSIS_RESPONSE_SCHEMA.properties.suggestions.items;
  for (const [schema, keys] of [[columns, ["semanticType", "legend"]], [suggestions, ["legend"]]]) {
    for (const key of keys) {
      assert.ok(schema.required.includes(key));
      assert.ok(schema.properties[key].anyOf.some(option => option.type === "null"));
    }
  }
});

test("popup recommendations have a compact per-map schema and survive server/client normalization", () => {
  const suggestionSchema = ANALYSIS_RESPONSE_SCHEMA.properties.suggestions.items;
  assert.ok(suggestionSchema.required.includes("popupSuggestions"));
  const schema = suggestionSchema.properties.popupSuggestions;
  assert.equal(schema.minItems, 1); assert.equal(schema.maxItems, 3);
  assert.deepEqual(schema.items.required, ["name", "confidence"]);
  assert.equal(schema.items.additionalProperties, false);
  assert.deepEqual(schema.items.properties.name.enum, ["info", "bar", "line"]);
  assert.equal(schema.items.properties.confidence.minimum, 0);
  assert.equal(schema.items.properties.confidence.maximum, 1);
  const dataProfile = { ...profile, columns: [...profile.columns,
    { name: "lat", inferredType: "number" }, { name: "lng", inferredType: "number" }] };
  const specs = [
    { id: "areas", chartType: "choropleth", bindings: { region: "province", value: "temperature" },
      popupSuggestions: [{ name: "line", confidence: .96 }, { name: "info", confidence: .91 }] },
    { id: "roads", chartType: "map_line", bindings: { region: "province", value: "temperature" },
      popupSuggestions: [{ name: "bar", confidence: .78 }] },
    { id: "points", chartType: "point", bindings: { lat: "lat", lng: "lng" },
      popupSuggestions: [{ name: "info", confidence: .9 }] }
  ];
  const server = validateAndNormalizeAnalysis({ columns: [], suggestions: specs }, dataProfile);
  assert.equal(server.source, "ai");
  assert.deepEqual(server.suggestions.map(item => item.popupSuggestions), specs.map(item => item.popupSuggestions));
  assert.deepEqual(validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(server)), dataProfile), server);
});

test("popup normalization drops invalid entries, keeps the best duplicate and preserves tie order", () => {
  const raw = { columns: [], suggestions: [{ id: "map", chartType: "choropleth",
    bindings: { region: "province", value: "temperature" }, popupSuggestions: [
      { name: "line", confidence: .4 }, { name: "info", confidence: .8, reason: "discard extra keys" },
      { name: "bar", confidence: .8 }, { name: "line", confidence: .8 }, { name: "bar", confidence: .6 },
      { name: "pie", confidence: 1 }, { name: "info", confidence: "1" }, { name: "bar", confidence: -1 },
      { name: "line", confidence: 1.1 }, { name: "info", confidence: NaN }, { name: "bar", confidence: Infinity },
      { name: "line", confidence: true }, null, "info", {}
    ] }] };
  const result = validateAndNormalizeAnalysis(raw, profile);
  assert.deepEqual(result.suggestions[0].popupSuggestions, [
    { name: "line", confidence: .8 }, { name: "info", confidence: .8 }, { name: "bar", confidence: .8 }
  ]);
  raw.suggestions[0].popupSuggestions = [{ name: "bar", confidence: 0 }, { name: "info", confidence: 1 }];
  assert.deepEqual(validateAndNormalizeAnalysis(raw, profile).suggestions[0].popupSuggestions,
    [{ name: "info", confidence: 1 }, { name: "bar", confidence: 0 }]);
});

test("missing or invalid popup output keeps valid maps and normalizes to an empty fallback list", () => {
  for (const popupSuggestions of [undefined, null, [], {}, "line", [{ name: "pie", confidence: .9 }]]) {
    const result = validateAndNormalizeAnalysis({ columns: [], suggestions: [{ id: "map", chartType: "choropleth",
      bindings: { region: "province", value: "temperature" }, popupSuggestions }] }, profile);
    assert.equal(result.source, "ai"); assert.equal(result.suggestions[0].id, "map");
    assert.deepEqual(result.suggestions[0].popupSuggestions, []);
    assert.deepEqual(validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(result)), profile), result);
  }
  assert.ok(fallbackAnalysis(profile).suggestions.every(item => item.popupSuggestions.length === 0));
});

test("data units and provenance survive legacy legend fallback through server/client normalization", () => {
  const specs = [
    { name: "Nhiệt độ", unit: "°C", unitSource: "inferred" },
    { name: "Độ ẩm", unit: "%", unitSource: "explicit" },
    { name: "Lượng mưa", unit: "mm", unitSource: "explicit" },
    { name: "Unknown", unit: null, unitSource: "unknown" }
  ];
  const dataProfile = { rowCount: 2, columns: specs.map(({ name }) => ({ name, inferredType: "number" })) };
  const server = validateAndNormalizeAnalysis({ columns: specs.map(spec => ({ ...spec, role: "measure", legend: { mode: "reference", referenceId: "old" } })), suggestions: [] }, dataProfile);
  const client = validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(server)), dataProfile);
  assert.deepEqual(client, server);
  assert.deepEqual(client.columns.map(column => column.unit), specs.map(spec => spec.unit));
  assert.deepEqual(client.columns.map(column => column.unitSource), specs.map(spec => spec.unitSource));
  assert.ok(client.columns.every(column => column.legend === null));
});

test("compact suggestion legends seed only their own matching column default and survive two normalizations", () => {
  const legend = legendFixture({ unit: "Celsius" });
  const raw = {
    columns: [{ name: "temperature", role: "measure", semanticType: "custom_measure", unit: "℃", aggDefault: "mean" },
      { name: "note", role: "category", semanticType: "air_temperature", legend }],
    suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend }]
  };
  const server = validateAndNormalizeAnalysis(raw, profile);
  assert.deepEqual(validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(server)), profile), server);
  assert.equal(server.columns[2].semanticType, "custom_measure");
  assert.equal(Object.hasOwn(server.columns[2].legend, "legendSchemaVersion"), false);
  assert.equal(Object.hasOwn(server.columns[2].legend, "field"), false);
  assert.equal(server.columns[2].unit, "°C");
  assert.deepEqual(server.suggestions[0].legend, server.columns[2].legend);
  assert.equal(server.columns[3].legend, null); assert.equal(server.columns[3].semanticType, null);
});

test("invalid legend falls back independently without removing a valid choropleth", () => {
  for (const patch of [{ unit: null }, { legend: legendFixture({ field: "other" }) }, { legend: legendFixture({ stops: [] }) }]) {
    const column = { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean", legend: legendFixture(), ...patch };
    const result = validateAndNormalizeAnalysis({ columns: [column],
      suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend: column.legend }]
    }, profile);
    assert.equal(result.source, "ai"); assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0].legend, null); assert.ok(result.validationErrors.length);
    assert.deepEqual(validateAndNormalizeAnalysis(result, profile), result);
  }
});

test("aggregation changes cannot reuse a semantic legend for a different aggregation", () => {
  for (const agg of ["sum", "count"]) {
    const result = validateAndNormalizeAnalysis({
      columns: [{ name: "temperature", role: "measure", unit: "°C", aggDefault: "mean", legend: legendFixture() }],
      suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg, legend: legendFixture() }]
    }, profile);
    assert.equal(result.columns[2].legend.mode, "semantic");
    assert.equal(result.suggestions[0].legend, null);
    assert.deepEqual(validateAndNormalizeAnalysis(result, profile), result);
  }
});

test("validator loại cột lạ/trùng, bù cột thiếu và chỉ loại suggestion lỗi", () => {
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Thời tiết",
    grain: "một tỉnh một ngày",
    columns: [
      { name: "province", role: "unknown" },
      { name: "province", role: "geo", geoLevel: "admin1", country: "VN" },
      { name: "province", role: "text" },
      { name: "date", role: "time", timeParse: "iso", granularity: "day" },
      { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean" },
      { name: "hallucinated", role: "measure" }
    ],
    suggestions: [
      { id: "map", chartType: "choropleth", title: "Nhiệt độ", bindings: { region: "province", value: "temperature" }, confidence: .9, reason: "phù hợp" },
      { id: "bad", chartType: "line", title: "Sai", bindings: { x: "missing", y: ["temperature"] }, confidence: .9, reason: "sai cột" }
    ]
  }, profile);
  assert.deepEqual(result.columns.map(column => column.name), profile.columns.map(column => column.name));
  assert.equal(result.columns.find(column => column.name === "province").role, "geo");
  assert.equal(result.columns.find(column => column.name === "note").source, "rule");
  assert.deepEqual(result.suggestions.map(item => item.id), ["map"]);
  assert.ok(result.validationErrors.length >= 3);
});

test("giữ nhận diện tỉnh/thành phố khi AI gán category hoặc thiếu geoLevel", () => {
  const regionProfile = { rowCount: 2, columns: [
    { name: "Tỉnh/thành phố", inferredType: "text", uniqueCount: 2 },
    { name: "Nhiệt độ trung bình", inferredType: "number", uniqueCount: 2 }
  ] };
  for (const role of ["category", "text", "geo"]) {
    const result = validateAndNormalizeAnalysis({
      columns: [
        { name: "Tỉnh/thành phố", role, geoLevel: null, labelVi: "Tỉnh/thành phố" },
        { name: "Nhiệt độ trung bình", role: "measure", aggDefault: "mean", unit: "°C" }
      ],
      suggestions: [{
        id: "weather-map", chartType: "choropleth", confidence: .9,
        bindings: { region: "Tỉnh/thành phố", value: "Nhiệt độ trung bình" }
      }]
    }, regionProfile);
    assert.equal(result.columns[0].role, "geo");
    assert.equal(result.columns[0].geoLevel, "admin1");
    assert.equal(result.suggestions[0].id, "weather-map");
    assert.equal(result.source, "ai");
    assert.deepEqual(result.validationErrors, []);
  }
});

test("giữ Khu vực là cột địa phương để tự chọn mạng đường", () => {
  const areaProfile = { rowCount: 2, columns: [
    { name: "Khu vực", inferredType: "text", uniqueCount: 1 },
    { name: "Tên đường", inferredType: "text", uniqueCount: 2 },
    { name: "Tốc độ", inferredType: "number", uniqueCount: 2 }
  ] };
  const result = validateAndNormalizeAnalysis({
    columns: [
      { name: "Khu vực", role: "category", geoLevel: null },
      { name: "Tên đường", role: "category", geoLevel: null },
      { name: "Tốc độ", role: "measure", aggDefault: "mean" }
    ],
    suggestions: [{
      id: "road-map", chartType: "map_line", confidence: .9,
      bindings: { region: "Tên đường", value: "Tốc độ" }
    }]
  }, areaProfile);
  assert.equal(result.columns.find(column => column.name === "Khu vực").role, "geo");
  assert.equal(result.columns.find(column => column.name === "Khu vực").geoLevel, "admin1");
  assert.equal(result.suggestions[0].chartType, "map_line");
});

test("fallback dùng cùng AnalysisResult và không biến id thành measure", () => {
  const result = fallbackAnalysis({
    rowCount: 2,
    columns: [
      { name: "region", inferredType: "text", uniqueCount: 2 },
      { name: "station_id", inferredType: "number", uniqueCount: 2 },
      { name: "total", inferredType: "number", uniqueCount: 2 }
    ]
  });
  assert.equal(result.columns.find(column => column.name === "station_id").role, "id");
  assert.equal(result.columns.find(column => column.name === "total").aggDefault, "sum");
  assert.ok(result.suggestions.some(item => item.chartType === "choropleth"));
  assert.equal(validateAndNormalizeAnalysis(result, {
    rowCount: 2,
    columns: [
      { name: "region", inferredType: "text", uniqueCount: 2 },
      { name: "station_id", inferredType: "number", uniqueCount: 2 },
      { name: "total", inferredType: "number", uniqueCount: 2 }
    ]
  }).source, "rule");
});

test("mỗi kiểu chỉ giữ cấu hình hợp lệ có confidence cao nhất", () => {
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Thời tiết",
    grain: "một tỉnh một ngày",
    columns: [],
    suggestions: [
      { id: "bad-map", chartType: "choropleth", bindings: { region: "missing", value: "temperature" }, confidence: 1 },
      { id: "map-low", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, confidence: .7 },
      { id: "map-high", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, confidence: .95 },
      { id: "bar-note", chartType: "bar", bindings: { x: "note", y: "temperature" }, confidence: .6 },
      { id: "bar-province", chartType: "bar", bindings: { x: "province", y: "temperature" }, confidence: .8 },
      { id: "line", chartType: "line", bindings: { x: "date", y: ["temperature"] }, confidence: .9 }
    ]
  }, profile);
  assert.equal(result.source, "ai");
  assert.deepEqual(result.suggestions.map(item => item.id), ["map-high", "line", "bar-province"]);
  assert.equal(new Set(result.suggestions.map(item => item.chartType)).size, result.suggestions.length);
});

test("bar chấp nhận cột thời gian làm trục x", () => {
  const result = validateAndNormalizeAnalysis({
    columns: [
      { name: "date", role: "time", timeParse: "iso", granularity: "day" },
      { name: "temperature", role: "measure", aggDefault: "mean" }
    ],
    suggestions: [{
      id: "time-bar",
      chartType: "bar",
      title: "Nhiệt độ theo ngày",
      bindings: { x: "date", y: "temperature" },
      confidence: .9
    }]
  }, profile);

  assert.equal(result.suggestions[0].chartType, "bar");
  assert.deepEqual(result.suggestions[0].bindings, { x: "date", y: "temperature" });
  assert.deepEqual(result.validationErrors, []);
});

test("AI có thể không đề xuất kiểu nào và quyết định vẫn giữ nguyên khi normalize lần nữa", () => {
  const raw = {
    datasetTitle: "Không có kiểu phù hợp",
    grain: "một tỉnh một ngày",
    columns: [{ name: "temperature", role: "measure", labelVi: "Nhiệt độ", unit: "°C", aggDefault: "mean" }],
    suggestions: []
  };
  const result = validateAndNormalizeAnalysis(raw, profile);
  assert.equal(result.source, "ai");
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.validationErrors, []);
  assert.equal(result.columns.find(column => column.name === "temperature").unit, "°C");
  const normalizedAgain = validateAndNormalizeAnalysis(result, profile);
  assert.equal(normalizedAgain.source, "ai");
  assert.deepEqual(normalizedAgain.suggestions, []);
  assert.deepEqual(normalizedAgain.validationErrors, []);
});

test("suggestions sai contract vẫn fallback thay vì coi là quyết định không đề xuất", () => {
  for (const suggestions of [null, {}, [{ id: "invalid", chartType: "unsupported" }]]) {
    const result = validateAndNormalizeAnalysis({ columns: [], suggestions }, profile);
    assert.equal(result.source, "rule");
    assert.ok(result.suggestions.length);
    assert.ok(result.validationErrors.length);
  }
});

test("fallback ưu tiên chiều địa phương thay vì thuộc tính mô tả khi chọn bar", () => {
  const result = fallbackAnalysis({ rowCount: 2, columns: [
    { name: "weather_status", inferredType: "text", uniqueCount: 2 },
    ...profile.columns
  ] });
  assert.equal(result.suggestions.find(item => item.chartType === "bar").bindings.x, "province");
});

test("fallback dùng Point và không đề xuất H3 cho bảng có kinh độ, vĩ độ", () => {
  const coordinateProfile = {
    rowCount: 2,
    columns: [
      { name: "Mã cửa hàng", inferredType: "text", uniqueCount: 2 },
      { name: "Tên cửa hàng", inferredType: "text", uniqueCount: 2 },
      { name: "Vĩ độ", inferredType: "number", uniqueCount: 2 },
      { name: "Kinh độ", inferredType: "number", uniqueCount: 2 },
      { name: "Doanh thu", inferredType: "number", uniqueCount: 2 }
    ]
  };
  const result = fallbackAnalysis(coordinateProfile);
  const point = result.suggestions.find(item => item.chartType === "point");

  assert.deepEqual(point.bindings, { lat: "Vĩ độ", lng: "Kinh độ" });
  assert.equal(result.suggestions.some(item => item.chartType === "hex_h3"), false);
});

test("validator chấp nhận đề xuất Point với binding kinh độ, vĩ độ", () => {
  const coordinateProfile = {
    rowCount: 2,
    columns: [
      { name: "lat", inferredType: "number", uniqueCount: 2 },
      { name: "lng", inferredType: "number", uniqueCount: 2 },
      { name: "name", inferredType: "text", uniqueCount: 2 }
    ]
  };
  const result = validateAndNormalizeAnalysis({
    datasetTitle: "Cửa hàng",
    grain: "một cửa hàng",
    columns: [
      { name: "lat", role: "geo", geoLevel: "point_lat" },
      { name: "lng", role: "geo", geoLevel: "point_lng" },
      { name: "name", role: "text" }
    ],
    suggestions: [{
      id: "stores-point",
      chartType: "point",
      title: "Vị trí cửa hàng",
      bindings: { lat: "lat", lng: "lng" },
      confidence: .98,
      reason: "Mỗi dòng là một cửa hàng có tọa độ."
    }]
  }, coordinateProfile);

  assert.equal(result.source, "ai");
  assert.equal(result.suggestions[0].chartType, "point");
  assert.deepEqual(result.suggestions[0].bindings, { lat: "lat", lng: "lng" });
});

test("column defaults resolve duplicate legend output while distinct suggestion aggregations stay independent", () => {
  const columnLegend = legendFixture({ title: "Mặc định cột" });
  for (const agg of ["mean", "sum"]) {
    const suggestionLegend = legendFixture({ title: "Riêng suggestion", aggregation: agg });
    const raw = {
      columns: [{ name: "temperature", role: "measure", aggDefault: "mean", unit: "°C", legend: columnLegend }],
      suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg, legend: suggestionLegend }]
    };
    const normalized = validateAndNormalizeAnalysis(raw, profile);
    assert.deepEqual(normalized.columns[2].legend, columnLegend);
    assert.deepEqual(normalized.suggestions[0].legend, agg === "mean" ? columnLegend : suggestionLegend);
    assert.deepEqual(validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(normalized)), profile), normalized);
    assert.equal(normalized.columns[2].aggDefault, "mean");
  }
});

test("relative auto stops and units survive server/client normalization for every measure", () => {
  const columns = ["temperature", "revenue"].map((name, index) => ({ name, role: "measure",
    aggDefault: index ? "sum" : "mean", unit: index ? "đồng" : "°C" }));
  const dataProfile = { rowCount: 2, columns: [{ name: "province", inferredType: "text" },
    ...columns.map(({ name }) => ({ name, inferredType: "number" }))] };
  const raw = { columns: columns.map(column => ({ ...column,
    legend: legendFixture({ aggregation: column.aggDefault, unit: column.unit, mode: "auto",
      domain: [0, 1], stops: [{ value: 0, color: "#000000" }, { value: .2, color: "#808080" }, { value: 1, color: "#ffffff" }] }) })),
    suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend: null }] };
  const server = validateAndNormalizeAnalysis(raw, dataProfile);
  const client = validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(server)), dataProfile);
  assert.deepEqual(client, server);
  assert.deepEqual(client.columns.slice(1).map(column => column.legend), raw.columns.map(column => column.legend));
  assert.deepEqual(client.suggestions[0].legend, client.columns[1].legend);
});

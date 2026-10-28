import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { aiMapRecommendationPlugin } from "../server/ai-map-recommendation.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";
import { profileTabularData } from "../src/tabular-data.js";
import { accessField, accessLegend, categoricalCountryFixture } from "./fixtures/categorical-countries-fixture.js";
import { analysis as arcAnalysis, bindings as arcBindings, row as arcRow } from './fixtures/arc-flow-fixture.js';

test('the existing analysis endpoint returns Arc Flow from one metadata-only AI request', async () => {
  const profile = profileTabularData([arcRow()], { includeSamples: false });
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body); const input = JSON.parse(payload.input);
    assert.ok(input.supportedCharts.arc_flow.slots.targetLat.includes('geo'));
    assert.match(payload.instructions, /CÓ HƯỚNG/);
    assert.ok(payload.text.format.schema.properties.suggestions.items.properties.bindings.required.includes('sourceLng'));
    assert.equal(input.profile.head, undefined); assert.equal(input.profile.columns[0].samples, undefined);
    return { ok: true, json: async () => ({ output_text: JSON.stringify(arcAnalysis) }) };
  };
  try {
    const result = await call(middlewareFor({ OPENAI_API_KEY: 'test' }), { profile });
    assert.equal(result.status, 200); assert.equal(calls, 1);
    assert.equal(result.body.source, 'ai'); assert.equal(result.body.suggestions[0].chartType, 'arc_flow');
    assert.deepEqual(result.body.suggestions[0].bindings, arcBindings);
  } finally { globalThis.fetch = previous; }
});

function middlewareFor(env) {
  let middleware;
  aiMapRecommendationPlugin(env).configureServer({ middlewares: { use(value) { middleware = value; } } });
  return middleware;
}

test("one analysis request carries all category values and observed combinations, and returns AI colors unchanged", async () => {
  const fixture = categoricalCountryFixture();
  const profile = profileTabularData(fixture.records);
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body); const input = JSON.parse(payload.input);
    assert.match(payload.instructions, /Cấp độ tiếp cận/);
    assert.match(payload.instructions, /role category/);
    assert.match(payload.instructions, /không phải measure/);
    assert.match(payload.instructions, /combinations/);
    assert.match(payload.instructions, /màu HEX riêng do AI đề xuất/);
    assert.match(payload.instructions, /Bao gồm … và …/);
    assert.match(payload.instructions, /Không dùng sọc/);
    assert.ok(input.profile.categoryGroups.some(group => group.entityField === "Điểm đến" && group.categoryField === accessField));
    assert.equal(payload.text.format.schema.properties.columns.items.properties.legend.anyOf.filter(schema => schema.type === "object").length, 3);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ columns: fixture.columns, suggestions: [fixture.suggestion], search_bar: true, search_fields: ["Điểm đến"] }) }) };
  };
  try {
    const result = await call(middlewareFor({ OPENAI_API_KEY: "test" }), { profile });
    assert.equal(result.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(result.body.validationErrors, []);
    assert.equal(result.body.suggestions[0].bindings.value, accessField);
    assert.deepEqual(result.body.columns.find(column => column.name === accessField).legend, accessLegend);
  } finally { globalThis.fetch = originalFetch; }
});

async function call(middleware, body, path = "/api/ai/analyze-map-data") {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.url = path; request.method = "POST";
  let text = "";
  const response = { statusCode: 0, setHeader() {}, end(value) { text = value; } };
  await middleware(request, response, () => {});
  return { status: response.statusCode, body: JSON.parse(text) };
}

test("the existing analysis request supplies country region coverage and returns AI navigation choices", async t => {
  const profile = profileTabularData([{ country: "Việt Nam" }, { country: "Laos" }, { country: "JPN" }]);
  const regionNavigation = { countryField: "country", regions: ["subregion:South-eastern Asia", "region:Asia"] };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    const input = JSON.parse(payload.input);
    assert.equal(input.profile.columns[0].countryRegions.countryCount, 3);
    assert.match(payload.instructions, /country_regions.json/);
    assert.match(payload.instructions, /Đề xuất này độc lập với search_bar/);
    assert.ok(payload.text.format.schema.required.includes("regionNavigation"));
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      columns: [{ name: "country", role: "geo", geoLevel: "country" }],
      suggestions: [{ id: "countries", chartType: "choropleth", bindings: { region: "country", value: null } }],
      regionNavigation, search_bar: false, search_fields: []
    }) }) };
  });
  const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), { profile });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(response.body.regionNavigation, regionNavigation);
  assert.equal(response.body.search_bar, false);
});

test("middleware forwards per-column temperature semantics and legends without changing the input contract", async () => {
  const originalFetch = globalThis.fetch;
  const legend = legendFixture();
  const popupSuggestions = [{ name: "line", confidence: .96 }, { name: "info", confidence: .91 }];
  const metricButtons = [{ field: "temperature", label: "Nhiệt độ", icon: "🌡️", color: "#f97316" }];
  let calls = 0;
  const profile = { rowCount: 2, columns: [
    { name: "province", inferredType: "text", uniqueCount: 2 },
    { name: "temperature", inferredType: "number", uniqueCount: 2 }
  ] };
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const payload = JSON.parse(options.body);
    assert.deepEqual(Object.keys(JSON.parse(payload.input)), ["profile", "supportedCharts"]);
    assert.match(payload.instructions, /Nhiệt độ cơ thể\/máy móc/);
    assert.match(payload.instructions, /TỪNG cột measure/);
    assert.match(payload.instructions, /domain \[0, 1\]/);
    assert.match(payload.instructions, /Không coi max mẫu/);
    assert.doesNotMatch(payload.instructions, /request riêng|trả columns\[\]\.legend và suggestions\[\]\.legend null/);
    assert.match(payload.instructions, /Không suy đoán đơn vị từ khoảng giá trị/);
    const columnSchema = payload.text.format.schema.properties.columns.items;
    assert.ok(columnSchema.required.includes("semanticType"));
    assert.ok(columnSchema.required.includes("legend"));
    for (const parent of [columnSchema, payload.text.format.schema.properties.suggestions.items]) {
      for (const legendSchema of parent.properties.legend.anyOf.filter(schema => schema.type === "object")) {
        for (const key of ["legendSchemaVersion", "field"]) {
          assert.equal(Object.hasOwn(legendSchema.properties, key), false);
          assert.equal(legendSchema.required.includes(key), false);
        }
      }
    }
    assert.ok(payload.text.format.schema.required.includes("search_bar"));
    assert.ok(payload.text.format.schema.required.includes("search_fields"));
    assert.match(payload.instructions, /không áp ngưỡng 30 cứng/);
    assert.match(payload.instructions, /Đặt tên định danh chính ở đầu/);
    const suggestionSchema = payload.text.format.schema.properties.suggestions.items;
    assert.ok(suggestionSchema.required.includes("popupSuggestions"));
    assert.deepEqual(suggestionSchema.properties.popupSuggestions.items.required, ["name", "confidence"]);
    assert.ok(suggestionSchema.required.includes("metricButtons"));
    assert.deepEqual(suggestionSchema.properties.metricButtons.items.required, ["field", "label", "icon", "color"]);
    assert.match(payload.instructions, /AI quyết định các chỉ số cần nút chọn nhanh/);
    assert.match(payload.instructions, /Trả metricButtons trong cùng request phân tích/);
    assert.match(payload.instructions, /bar\/line được phép trong popupSuggestions/);
    assert.match(payload.instructions, /MỘT đối tượng được bấm/);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      search_bar: true, search_fields: ["province", "temperature", "not_in_input", "province"],
      columns: [{ name: "province", role: "geo", geoLevel: "admin1" }, { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean", semanticType: "air_temperature", legend }],
      suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend, popupSuggestions, metricButtons }]
    }) }) };
  };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), { profile });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal(response.body.search_bar, true);
    assert.deepEqual(response.body.search_fields, ["province"]);
    assert.deepEqual(response.body.columns[1].legend, legend);
    assert.deepEqual(response.body.suggestions[0].legend, legend);
    assert.deepEqual(response.body.suggestions[0].popupSuggestions, popupSuggestions);
    assert.deepEqual(response.body.suggestions[0].metricButtons, metricButtons);
    assert.equal(response.body.columns[1].semanticType, "air_temperature");
  } finally { globalThis.fetch = originalFetch; }
});

test("metadata keeps generic data units and supplies auto legends in the analysis response", async () => {
  const originalFetch = globalThis.fetch;
  const expected = [
    ["Nhiệt độ trung bình", "°C"], ["Nhiệt độ thấp nhất", "°C"], ["Nhiệt độ cao nhất", "°C"],
    ["Độ ẩm", "%"], ["Lượng mưa", "mm"]
  ];
  const profile = { rowCount: 2, samplesIncluded: false, columns: expected.map(([name]) => ({ name, inferredType: "number" })) };
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.match(payload.instructions, /columns\[\]\.unit là đơn vị đo của dữ liệu, độc lập với lựa chọn legend/);
    assert.match(payload.instructions, /Được suy luận đơn vị từ tên cột và ngữ cảnh của toàn bộ bảng/);
    assert.match(payload.instructions, /Giữ nguyên columns\[\]\.unit đã xác định/);
    const schema = payload.text.format.schema.properties;
    const dataUnitSchema = schema.columns.items.properties.unit;
    const legendUnitSchema = schema.columns.items.properties.legend.anyOf[0].properties.unit;
    assert.equal(dataUnitSchema.anyOf[0].enum, undefined, "data units are not restricted to temperature presets");
    assert.equal(legendUnitSchema.anyOf[0].enum, undefined, "legend units support all measures");
    assert.ok(schema.columns.items.required.includes("unitSource"));
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      columns: expected.map(([name, unit]) => ({ name, role: "measure", unit,
        aggDefault: "mean", legend: legendFixture({ unit, mode: "auto", domain: [0, 1],
          stops: [{ value: 0, color: "#000000" }, { value: 1, color: "#ffffff" }] }) })), suggestions: []
    }) }) };
  };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), { profile });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.columns.map(column => [column.name, column.unit]), expected);
    assert.ok(response.body.columns.every(column => column.legend?.mode === "auto"));
  } finally { globalThis.fetch = originalFetch; }
});

test("middleware chỉ gọi OpenAI một lần và fallback ngay khi output không dùng được", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0; let upstreamBody; let upstreamUrl;
  globalThis.fetch = async (url, options) => {
    upstreamUrl = url;
    calls += 1; upstreamBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ datasetTitle: "bad", grain: "bad", columns: [], suggestions: [{ id: "bad", chartType: "unsupported" }] }) }) };
  };
  try {
    const profile = {
      rowCount: 2,
      samplesIncluded: false,
      columns: [
        { name: "province", inferredType: "text", uniqueCount: 2 },
        { name: "value", inferredType: "number", uniqueCount: 2 }
      ]
    };
    const response = await call(middlewareFor({
      OPENAI_API_KEY: "test",
      OPENAI_MODEL: "test-model",
      OPENAI_BASE_URL: "https://api.vilao.ai/v1/"
    }), { profile });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.equal(upstreamUrl, "https://api.vilao.ai/v1/responses");
    assert.equal(response.body.source, "rule");
    assert.deepEqual(response.body.suggestions, []);
    const sent = JSON.parse(upstreamBody.input);
    assert.equal(sent.profile.rowCount, 2);
    assert.deepEqual(Object.keys(sent.supportedCharts), ["choropleth", "map_line", "point", "arc_flow"]);
    assert.ok(sent.supportedCharts.map_line.slots.x.includes("time"));
    assert.ok(sent.supportedCharts.map_line.slots.lat.includes("geo"));
    assert.ok(sent.supportedCharts.point.slots.region.includes("id"));
    assert.deepEqual(upstreamBody.text.format.schema.properties.suggestions.items.properties.chartType.enum, ["choropleth", "map_line", "point", "arc_flow"]);
    assert.ok(response.body.suggestions.every(item => ["choropleth", "map_line", "point", "arc_flow"].includes(item.chartType)));
    assert.match(upstreamBody.instructions, /Gán role, đơn vị, phép gộp và grain/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("middleware giữ quyết định không đề xuất và vẫn gửi schema trong prompt lẫn text.format", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const payload = JSON.parse(options.body);
    assert.ok(payload.instructions.includes(JSON.stringify(payload.text.format.schema)));
    assert.equal(payload.text.format.strict, true);
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      datasetTitle: "Không có kiểu phù hợp", grain: "một bản ghi", columns: [], suggestions: []
    }) }) };
  };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), {
      profile: { rowCount: 2, columns: [
        { name: "province", inferredType: "text", uniqueCount: 2 },
        { name: "value", inferredType: "number", uniqueCount: 2 }
      ] }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.source, "ai");
    assert.deepEqual(response.body.suggestions, []);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removed legend endpoint passes through without calling upstream", async () => {
  const middleware = middlewareFor({ OPENAI_API_KEY: "test" });
  let nextCalls = 0;
  await middleware({ url: "/api/ai/recommend-polygon-legends", method: "POST" }, {}, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
});

test("malformed analysis JSON returns an error after one upstream request", async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => ({ output_text: "invalid JSON" }) }; };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), {
      profile: { rowCount: 2, columns: [{ name: "temperature", inferredType: "number" }] }
    });
    assert.equal(response.status, 502); assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("debug output preserves valid raw and normalized legends from the same analysis", async () => {
  const originalFetch = globalThis.fetch; const originalDebug = console.debug; let debug;
  const legend = legendFixture();
  const raw = { columns: [{ name: "province", role: "geo", geoLevel: "admin1" }, { name: "temperature", role: "measure", unit: "°C", aggDefault: "mean", legend }],
    suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend: null }] };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(raw) }) });
  console.debug = (_label, value) => { debug = JSON.parse(value); };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test", AI_DEBUG: "true" }), {
      profile: { rowCount: 2, columns: [{ name: "province", inferredType: "text" }, { name: "temperature", inferredType: "number" }] }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(debug.rawOutput.columns[1].legend, legend);
    assert.deepEqual(debug.normalizedOutput.columns[1].legend, legend);
    assert.deepEqual(debug.normalizedOutput.suggestions[0].legend, legend);
  } finally { globalThis.fetch = originalFetch; console.debug = originalDebug; }
});

test("native geometry without attribute columns still receives an AI decision", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [kind, chartType] of [["area", "choropleth"], ["line", "map_line"]]) {
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++;
        const payload = JSON.parse(options.body);
        const input = JSON.parse(payload.input);
        assert.equal(input.profile.spatial.nativeGeometry, true);
        assert.match(input.spatialContext, /Nếu suggestions rỗng thì ứng dụng không tự tạo bản đồ/);
        assert.doesNotMatch(payload.instructions, /domain \[-20, 40\]/);
        return { ok: true, json: async () => ({ output_text: JSON.stringify({
          datasetTitle: "Geometry", grain: "Một đối tượng", columns: [], search_bar: false, search_fields: [],
          suggestions: [{ id: "native", chartType, confidence: .82, bindings: { region: null, value: null }, reason: "Có geometry phù hợp" }]
        }) }) };
      };
      const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), {
        profile: { rowCount: 1, columns: [], spatial: { geometryKinds: [kind], nativeGeometry: true } }
      });
      assert.equal(response.status, 200);
      assert.equal(calls, 1);
      assert.equal(response.body.source, "ai");
      assert.equal(response.body.suggestions[0].chartType, chartType);
      assert.deepEqual(response.body.suggestions[0].bindings, { value: null });
    }
  } finally { globalThis.fetch = originalFetch; }
});

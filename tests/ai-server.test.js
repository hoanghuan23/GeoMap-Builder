import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { aiMapRecommendationPlugin } from "../server/ai-map-recommendation.js";
import { legendFixture } from "./fixtures/polygon-legend-fixture.js";

function middlewareFor(env) {
  let middleware;
  aiMapRecommendationPlugin(env).configureServer({ middlewares: { use(value) { middleware = value; } } });
  return middleware;
}

async function call(middleware, body, path = "/api/ai/analyze-map-data") {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.url = path; request.method = "POST";
  let text = "";
  const response = { statusCode: 0, setHeader() {}, end(value) { text = value; } };
  await middleware(request, response, () => {});
  return { status: response.statusCode, body: JSON.parse(text) };
}

test("middleware forwards per-column temperature semantics and legends without changing the input contract", async () => {
  const originalFetch = globalThis.fetch;
  const legend = legendFixture();
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
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      columns: [{ name: "temperature", role: "measure", unit: "°C", aggDefault: "mean", semanticType: "air_temperature", legend }],
      suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend }]
    }) }) };
  };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test" }), { profile });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(response.body.columns[1].legend, legend);
    assert.deepEqual(response.body.suggestions[0].legend, legend);
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
        aggDefault: "mean", legend: legendFixture({ field: name, unit, mode: "auto", domain: [0, 1],
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
    assert.ok(response.body.suggestions.some(item => item.chartType === "choropleth"));
    const sent = JSON.parse(upstreamBody.input);
    assert.equal(sent.profile.rowCount, 2);
    assert.deepEqual(Object.keys(sent.supportedCharts), ["choropleth", "map_line", "point"]);
    assert.ok(sent.supportedCharts.map_line.slots.x.includes("time"));
    assert.ok(sent.supportedCharts.map_line.slots.lat.includes("geo"));
    assert.ok(sent.supportedCharts.point.slots.region.includes("id"));
    assert.deepEqual(upstreamBody.text.format.schema.properties.suggestions.items.properties.chartType.enum, ["choropleth", "map_line", "point"]);
    assert.ok(response.body.suggestions.every(item => ["choropleth", "map_line", "point"].includes(item.chartType)));
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
  const raw = { columns: [{ name: "temperature", role: "measure", unit: "°C", aggDefault: "mean", legend }],
    suggestions: [{ id: "map", chartType: "choropleth", bindings: { region: "province", value: "temperature" }, agg: "mean", legend: null }] };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(raw) }) });
  console.debug = (_label, value) => { debug = JSON.parse(value); };
  try {
    const response = await call(middlewareFor({ OPENAI_API_KEY: "test", AI_DEBUG: "true" }), {
      profile: { rowCount: 2, columns: [{ name: "province", inferredType: "text" }, { name: "temperature", inferredType: "number" }] }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(debug.rawOutput.columns[0].legend, legend);
    assert.deepEqual(debug.normalizedOutput.columns[1].legend, legend);
    assert.deepEqual(debug.normalizedOutput.suggestions[0].legend, legend);
  } finally { globalThis.fetch = originalFetch; console.debug = originalDebug; }
});

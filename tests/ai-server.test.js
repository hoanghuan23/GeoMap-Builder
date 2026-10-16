import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { aiMapRecommendationPlugin } from "../server/ai-map-recommendation.js";

function middlewareFor(env) {
  let middleware;
  aiMapRecommendationPlugin(env).configureServer({ middlewares: { use(value) { middleware = value; } } });
  return middleware;
}

async function call(middleware, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.url = "/api/ai/analyze-map-data"; request.method = "POST";
  let text = "";
  const response = { statusCode: 0, setHeader() {}, end(value) { text = value; } };
  await middleware(request, response, () => {});
  return { status: response.statusCode, body: JSON.parse(text) };
}

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
    assert.deepEqual(Object.keys(sent.supportedCharts), ["choropleth", "point", "hex_h3", "map_line", "line", "bar"]);
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

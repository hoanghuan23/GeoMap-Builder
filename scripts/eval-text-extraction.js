import { Readable } from "node:stream";
import { loadEnv } from "vite";
import { aiMapRecommendationPlugin } from "../server/ai-map-recommendation.js";
import { metricExtractionCases } from "../tests/fixtures/text-metric-fixture.js";

// Opt-in live checks use the same model, prompt, schema and endpoint as the app.
const env = loadEnv("development", process.cwd(), "");
if (!env.OPENAI_API_KEY) throw new Error("Cần cấu hình OPENAI_API_KEY để kiểm thử AI thực tế.");
env.AI_DEBUG = "false";
const selected = process.argv.slice(2);
const cases = selected.length ? metricExtractionCases.filter(item => selected.includes(item.id)) : metricExtractionCases;
if (!cases.length || selected.some(id => !cases.some(item => item.id === id))) throw new Error("Tên ca kiểm thử không hợp lệ.");
const upstreamFetch = globalThis.fetch;
globalThis.fetch = (url, init) => upstreamFetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
let middleware;
aiMapRecommendationPlugin(env).configureServer({ middlewares: { use(value) { middleware = value; } } });
let failures = 0;
for (const item of cases) {
  console.log(`RUN ${item.id}`);
  const request = Readable.from([Buffer.from(JSON.stringify({ text: item.text }))]);
  request.url = "/api/ai/analyze-map-text"; request.method = "POST";
  const response = { statusCode: 0, setHeader() {}, end(value) { this.body = JSON.parse(value); } };
  try {
    await middleware(request, response, () => { throw new Error("Endpoint không được xử lý."); });
    if (response.statusCode !== 200) throw new Error(response.body?.error || `HTTP ${response.statusCode}`);
    item.check(response.body);
    console.log(`PASS ${item.id}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${item.id}: ${error.message}`);
  }
  if (response.body?.analysis) console.log(JSON.stringify({
    measures: response.body.analysis.columns.filter(column => column.role === "measure").map(column => column.name),
    records: response.body.records
  }, null, 2));
}
console.log(`${cases.length - failures}/${cases.length} live extraction checks passed.`);
process.exitCode = failures ? 1 : 0;

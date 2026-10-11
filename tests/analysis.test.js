import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { profileInput } from "../src/analysis/data-profile.js";
import { localPlan, compilePlan, validatePlan, transformRows, colorForValue } from "../src/analysis/plan-engine.js";
import { analyzeSpatialData } from "../src/data-capabilities.js";
import { requestAnalysis } from "../src/analysis/ai-client.js";
import { analyzeWithAI } from "../server/analyze.js";
import { createServer } from "../server/index.js";

const demo = JSON.parse(readFileSync(new URL("../geomap_demo_rainfall_theo_thoi_gian.json", import.meta.url), "utf8"));
const polygon = id => ({ type: "Feature", properties: { id }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } });
const fixture = () => ({ metadata: { unit: "mm / 2 giờ", metric: "amount" }, nested: { cells: { type: "FeatureCollection", features: [polygon("a"), polygon("b")] } }, readings: [
  { key: "a", stamp: "00:00", amount: 0 }, { key: "b", stamp: "00:00", amount: 2 }, { key: "a", stamp: "02:00", amount: 35 }
], style_rules: { metric: "amount", stops: [{ max: 2, color: "#b6e1ff" }, { max: 10, color: "#46a9ef" }, { max: 20, color: "#2770bb" }, { max: 35, color: "#714bc2" }, { min: 35, color: "#d33d82" }] } });

test("rainfall full profile, temporal join and unchanged geometry", () => {
  const profile = profileInput(demo); const plan = localPlan(profile); const compiled = compilePlan(plan, profile);
  assert.equal(plan.renderer, "polygon"); assert.equal(plan.source, "hexagons"); assert.equal(plan.join.source, "measurements");
  assert.equal(compiled.times.length, 12); assert.equal(compiled.times[0], "00:00");
  assert.equal(compiled.atTime().features.length, 3980); assert.equal(profile.payload.datasets.find(d => d.path === "measurements").rowCount, 47760);
  assert.ok(profile.payload.datasets.every(d => d.samples.length <= 20 && !d.records && !d.features));
  const row = demo.measurements.find(r => r.cell_id === "hex_0001" && r.time === "22:00");
  assert.equal(compiled.atTime("22:00").features[0].properties.__value, row.rainfall_mm);
  assert.strictEqual(compiled.atTime().features[0].geometry, demo.hexagons.features[0].geometry);
  assert.equal(plan.unit, "mm / 2 giờ");
});

test("renamed nested sources and keys, zero/missing and upper-inclusive color boundaries", () => {
  const profile = profileInput(fixture()); const plan = localPlan(profile); const compiled = compilePlan(plan, profile);
  assert.equal(plan.source, "nested.cells"); assert.equal(plan.join.sourceKey, "properties.id"); assert.equal(plan.join.targetKey, "key");
  assert.equal(compiled.atTime("00:00").features[0].properties.__value, 0);
  assert.equal(compiled.atTime("02:00").features[1].properties.__value, null);
  assert.equal(analyzeSpatialData(fixture()).hasArea, true);
  for (const [value, color] of [[0, "#b6e1ff"], [2, "#b6e1ff"], [10, "#46a9ef"], [20, "#2770bb"], [35, "#714bc2"], [35.1, "#d33d82"], [null, "#64748b"]]) assert.equal(colorForValue(value, compiled.colors), color);
});

test("reject unknown sources, incompatible renderers, missing fields and duplicate join keys", () => {
  const data = fixture(); const profile = profileInput(data); const plan = localPlan(profile);
  assert.throws(() => validatePlan({ ...plan, source: "absent" }, profile), /Nguồn/);
  assert.throws(() => validatePlan({ ...plan, metric: "absent" }, profile), /Trường/);
  assert.throws(() => validatePlan({ ...plan, renderer: "line" }, profile), /geometry/);
  assert.throws(() => validatePlan({ ...plan, renderer: "eval" }, profile), /không được hỗ trợ/);
  data.readings.push({ ...data.readings[0] });
  const duplicate = profileInput(data);
  assert.throws(() => compilePlan(plan, duplicate), /trùng/);
  plan.operations = [{ op: "aggregate", field: "amount", fields: ["key", "stamp"], value: null, method: "mean" }];
  assert.equal(compilePlan(plan, duplicate).atTime().features[0].properties.__value, 0);
});

test("ambiguous geometry sources require mapping", () => {
  const d = fixture(); d.other = d.nested.cells;
  // Independent layers, not the same object reference.
  d.other = structuredClone(d.other);
  assert.throws(() => localPlan(profileInput(d)), /nhiều lớp/);
});

test("discover GeoJSON under wrapper arrays", () => {
  const profile = profileInput({ bundles: [{ layer: fixture().nested.cells }] });
  assert.equal(localPlan(profile).source, "bundles[0].layer");
});

test("table/coordinate profiles cover normalized CSV and Excel sheet records", () => {
  const profile = profileInput({ Sheet1: [{ city: "A", lat: "10", lon: "106", amount: "3" }, { city: "B", lat: "11", lon: "107", amount: "5" }] });
  const plan = localPlan(profile); assert.equal(plan.renderer, "circle");
  assert.deepEqual(compilePlan(plan, profile).atTime().features[0].geometry.coordinates, [106, 10]);
  const table = profileInput([{ city: "A", amount: 3 }, { city: "B", amount: 5 }]);
  assert.equal(localPlan(table).renderer, "bar"); assert.equal(compilePlan(localPlan(table), table).atTime().length, 2);
});

test("allowed transformations select/cast/filter/aggregate/sort", () => {
  const op = (op, field, method, fields = [], value = null) => ({ op, field, method, fields, value });
  const rows = transformRows([{ city: "A", amount: "2" }, { city: "A", amount: "4" }, { city: "B", amount: "0" }], [
    op("select", null, "number", ["city", "amount"]), op("cast", "amount", "number"), op("filter", "amount", "gt", [], 0),
    op("aggregate", "amount", "mean", ["city"]), op("sort", "amount", "desc")
  ]);
  assert.deepEqual(rows, [{ city: "A", amount: 3 }]);
});

test("AI request schema, malformed output and missing key", async () => {
  const profile = profileInput(fixture()); const plan = localPlan(profile); let request;
  const result = await analyzeWithAI(profile.payload, { client: { responses: { create: async body => { request = body; return { status: "completed", output_text: JSON.stringify(plan) }; } } } });
  assert.equal(result.model, "gpt-6-luna"); assert.equal(request.text.format.strict, true); assert.equal(request.store, false);
  await assert.rejects(analyzeWithAI(profile.payload), /OPENAI_API_KEY/);
  await assert.rejects(analyzeWithAI(profile.payload, { client: { responses: { create: async () => ({ output_text: "{}" }) } } }), /kiểu dữ liệu/);
});

test("client timeout, upstream error and cancellation", async () => {
  const pending = (_, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  await assert.rejects(requestAnalysis({}, { fetchImpl: pending, timeoutMs: 5 }), /30 giây/);
  await assert.rejects(requestAnalysis({}, { fetchImpl: async () => ({ ok: false, json: async () => ({ error: "API key bị từ chối" }) }) }), /API key/);
  const controller = new AbortController(); const promise = requestAnalysis({}, { signal: controller.signal, fetchImpl: pending }); controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
});

test("HTTP API keeps upstream auth details private and serves only dist", async t => {
  const server = createServer({ client: { responses: { create: async () => { const error = new Error("secret-upstream-details"); error.status = 401; throw error; } } } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/analyze-data`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profileInput(fixture()).payload) });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes("secret-upstream-details"));
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});

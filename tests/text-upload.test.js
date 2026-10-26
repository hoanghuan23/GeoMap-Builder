import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHarness } from "./fixtures/map-runtime-harness.js";
import { weatherDocumentFile, weatherRecords, textWeatherAnalysis } from "./fixtures/text-weather-fixture.js";
import { joinRecordsToMapTilerBoundaries } from "../src/vietnam-admin-data.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { aiPopupRows } from "../src/ai-popup.js";
import { csvForRecords } from "../src/map-layer-data.js";

test("TXT and DOCX use the existing Polygon, legend, metrics, search, popup, and CSV flows", async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  for (const extension of ["txt", "docx"]) {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "/api/ai/analyze-map-text");
      assert.equal(JSON.parse(options.body).source.extension, extension);
      return { ok: true, json: async () => ({ records: weatherRecords, analysis: textWeatherAnalysis() }) };
    };
    const { context, get, sources } = createHarness();
    get("ai-include-samples").checked = false;
    context.requestAiDataAnalysis = () => assert.fail("text must not run the table prompt");
    context.weatherFile = weatherDocumentFile(extension);
    context.joinRecordsToMapTilerBoundaries = joinRecordsToMapTilerBoundaries;
    context.loadAdministrativeBoundaries = async names => ({
      type: "FeatureCollection", matched: names, unmatched: [], matchRate: 1,
      features: names.map((name, i) => ({ type: "Feature", properties: { __data_location: name },
        geometry: { type: "Polygon", coordinates: [[[105 + i, 20], [106 + i, 20], [106 + i, 21], [105 + i, 21], [105 + i, 20]]] } }))
    });
    context.landOnlyBoundary = async feature => feature;
    const indexes = [];
    context.searchController = { setData(snapshot) { indexes.push(buildDataSearchIndex(snapshot)); } };
    vm.runInContext("mapSearch = searchController", context);
    await vm.runInContext("processSpatialFile(weatherFile)", context);
    assert.equal(vm.runInContext("state.mapType", context), "polygon");
    assert.equal(calls, 1, "samples toggle does not block text analysis");
    assert.equal(sources.get("polygon-data").data.features.length, 3);
    assert.equal(get("map-metric-control").hidden, false);
    assert.equal(get("map-metric-list").children.length, 2);
    const dataset = vm.runInContext("state.aiDataset", context);
    assert.deepEqual(dataset.rawRecords, weatherRecords);
    assert.equal(dataset.analysis.columns.find(column => column.name === "Lượng mưa (mm)").legend.unit, "mm");
    assert.equal(indexes.at(-1).enabled, true);
    const found = searchDataIndex(indexes.at(-1), "ha noi")[0];
    assert.equal(found.label, "Hà Nội");
    const popup = aiPopupRows(found.feature.properties, dataset.analysis.columns);
    assert.equal(popup.find(row => row.field === "Tháng").value, "09/2026");
    assert.equal(popup.find(row => row.field === "Nhiệt độ (°C)").value, "29");
    assert.equal(popup.find(row => row.field === "Lượng mưa (mm)").value, "120");
    assert.match(popup.find(row => row.field === "Nhiệt độ (°C)").label, /°C/);
    assert.match(popup.find(row => row.field === "Lượng mưa (mm)").label, /mm/);

    await vm.runInContext('changeAiMapMetric("Lượng mưa (mm)")', context);
    vm.runInContext("syncDataSearch(); filteredAiBoundary()", context);
    assert.equal(vm.runInContext("state.aiDataset.recommendation.metricField", context), "Lượng mưa (mm)");
    assert.equal(calls, 1, "metric, filter, search, and popup need no more AI calls");
    assert.equal(searchDataIndex(indexes.at(-1), "Đà Nẵng")[0].feature.properties["Lượng mưa (mm)"], 85);
    const csv = csvForRecords(dataset.rawRecords);
    assert.match(csv, /2026-09/);
    assert.match(csv, /TP.HCM/);
    assert.match(csv, /150/);
    await vm.runInContext("removeUploadedFile(state.primaryUploadId)", context);
    assert.equal(vm.runInContext("state.aiDataset", context), null);
    assert.equal(sources.get("polygon-data").data.features.length, 0);
  }
});

test("upload rejects old Word and unsupported files before JSON parsing or AI", async () => {
  const { context } = createHarness();
  context.unsupported = { name: "old.doc", text: () => assert.fail("must not read binary as JSON") };
  await assert.rejects(vm.runInContext("readSpatialFile(unsupported)", context), /lưu lại thành .docx/);
  context.unsupported.name = "scan.pdf";
  await assert.rejects(vm.runInContext("readSpatialFile(unsupported)", context), /Định dạng chưa hỗ trợ/);
});

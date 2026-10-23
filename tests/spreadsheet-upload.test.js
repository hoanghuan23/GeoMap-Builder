import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import * as XLSX from "xlsx";
import { createHarness } from "./fixtures/map-runtime-harness.js";

function spreadsheet(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, records] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), name);
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return { name: "test.xlsx", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

test("multi-sheet Excel waits for a choice and analyzes only the chosen sheet", async () => {
  const { context } = createHarness();
  context.workbookFile = spreadsheet({
    "Tổng quan": [{ name: "Không phân tích", value: 999 }],
    "Bảng A": [{ name: "A", value: 10 }],
    "Bảng B": [{ name: "B", value: 20 }]
  });
  const calls = [];
  context.requestAiDataAnalysis = async (records, options) => {
    calls.push({ records, source: options.source });
    return { records, analysis: { columns: [], suggestions: [], source: "ai" }, validRowRate: {} };
  };
  const pending = await vm.runInContext("readSpatialFile(workbookFile)", context);
  assert.equal(pending.kind, "sheet-selection");
  assert.deepEqual(Array.from(pending.sheetNames), ["Tổng quan", "Bảng A", "Bảng B"]);
  assert.equal(calls.length, 0, "inspecting the workbook does not call AI");
  const selected = await vm.runInContext('readSpatialFile(workbookFile, { sheetName: "Bảng B" })', context);
  assert.equal(selected.kind, "ai-pipeline");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].records, [{ name: "B", value: 20 }]);
  assert.equal(calls[0].source.sheetName, "Bảng B");
  await assert.rejects(vm.runInContext('readSpatialFile(workbookFile, { sheetName: "Không tồn tại" })', context), /Không tìm thấy bảng/);
  assert.equal(calls.length, 1, "a stale choice never silently analyzes the first sheet");
});

test("single-sheet Excel continues directly to analysis", async () => {
  const { context } = createHarness();
  context.workbookFile = spreadsheet({ "Bảng dữ liệu": [{ name: "A", value: 10 }] });
  let calls = 0;
  context.requestAiDataAnalysis = async (records, options) => {
    calls++;
    assert.equal(options.source.sheetName, "Bảng dữ liệu");
    return { records, analysis: { columns: [], suggestions: [], source: "ai" }, validRowRate: {} };
  };
  assert.equal((await vm.runInContext("readSpatialFile(workbookFile)", context)).kind, "ai-pipeline");
  assert.equal(calls, 1);
});

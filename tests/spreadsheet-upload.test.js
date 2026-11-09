import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import * as XLSX from "xlsx";
import { createHarness } from "./fixtures/map-runtime-harness.js";

function spreadsheet(sheets, extension) {
  const workbook = XLSX.utils.book_new();
  for (const [name, records] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), name);
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: extension.toLowerCase() });
  return { name: `test.${extension}`, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

for (const extension of ["xlsx", "xlsm", "XLSM"]) {
  test(`multi-sheet ${extension} waits for a choice and analyzes only the chosen sheet`, async () => {
    const { context } = createHarness();
    context.workbookFile = spreadsheet({
      "Tổng quan": [{ name: "Không phân tích", value: 999 }],
      "Bảng A": [{ name: "A", value: 10 }],
      "Bảng B": [{ name: "B", value: 20 }]
    }, extension);
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
    assert.equal(calls[0].source.fileName, `test.${extension}`);
    assert.equal(calls[0].source.extension, extension.toLowerCase());
    await assert.rejects(vm.runInContext('readSpatialFile(workbookFile, { sheetName: "Không tồn tại" })', context), /Không tìm thấy bảng/);
    assert.equal(calls.length, 1, "a stale choice never silently analyzes the first sheet");
  });

  test(`single-sheet ${extension} continues directly to analysis`, async () => {
    const { context } = createHarness();
    const rows = [{ name: "Hà Nội", value: 0 }, { name: "Đà Nẵng", value: 10 }];
    context.workbookFile = spreadsheet({ "Bảng dữ liệu": rows }, extension);
    let calls = 0;
    context.requestAiDataAnalysis = async (records, options) => {
      calls++;
      assert.deepEqual(records, rows);
      assert.equal(options.source.sheetName, "Bảng dữ liệu");
      assert.equal(options.source.fileName, `test.${extension}`);
      assert.equal(options.source.extension, extension.toLowerCase());
      return { records, analysis: { columns: [], suggestions: [], source: "ai" }, validRowRate: {} };
    };
    assert.equal((await vm.runInContext("readSpatialFile(workbookFile)", context)).kind, "ai-pipeline");
    assert.equal(calls, 1);
  });
}

test("report preamble is excluded from the records and profile sent for analysis", async () => {
  const { context } = createHarness();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["BÁO CÁO"],
    ["TỔNG", 2],
    [],
    ["Tên", "Tỉnh", "Giá", "Ghi chú"],
    ["Điểm A", "Hà Nội", 0, ""],
    ["Điểm B", "Đà Nẵng", 10, "Có thông tin"]
  ]);
  sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Bảng dữ liệu");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsm" });
  context.workbookFile = { name: "report.xlsm", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  let calls = 0;
  context.requestAiDataAnalysis = async (records, { profile, source }) => {
    calls++;
    assert.deepEqual(records, [
      { "Tên": "Điểm A", "Tỉnh": "Hà Nội", "Giá": 0, "Ghi chú": "" },
      { "Tên": "Điểm B", "Tỉnh": "Đà Nẵng", "Giá": 10, "Ghi chú": "Có thông tin" }
    ]);
    assert.equal(profile.rowCount, 2);
    assert.deepEqual(profile.columns.map(column => column.name), ["Tên", "Tỉnh", "Giá", "Ghi chú"]);
    assert.equal(source.sheetName, "Bảng dữ liệu");
    return { records, analysis: { columns: [], suggestions: [], source: "ai" }, validRowRate: {} };
  };
  assert.equal((await vm.runInContext("readSpatialFile(workbookFile)", context)).kind, "ai-pipeline");
  assert.equal(calls, 1);
});

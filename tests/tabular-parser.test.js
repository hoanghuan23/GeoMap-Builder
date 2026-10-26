import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { parseSpreadsheetBuffer } from "../src/tabular-parser.js";
import { createWeather34Workbook, WEATHER_PROVINCES } from "./fixtures/weather-34-fixture.js";

test("CSV UTF-8 không BOM giữ đúng header và tên địa danh tiếng Việt", () => {
  const buffer = new TextEncoder().encode('Tỉnh/thành phố,Nhiệt độ\nHà Nội,25\nBắc Ninh,26').buffer;
  const parsed = parseSpreadsheetBuffer(buffer, { extension: 'csv', includeSamples: false });
  assert.deepEqual(parsed.records, [{ 'Tỉnh/thành phố': 'Hà Nội', 'Nhiệt độ': '25' }, { 'Tỉnh/thành phố': 'Bắc Ninh', 'Nhiệt độ': '26' }]);
});

test("CSV có BOM UTF-16 tiếp tục được đọc từ byte gốc", () => {
  const buffer = Buffer.from('\ufeffTỉnh,Nhiệt độ\r\nHà Nội,25', 'utf16le');
  const parsed = parseSpreadsheetBuffer(buffer, { extension: 'csv', includeSamples: false });
  assert.deepEqual(parsed.records, [{ 'Tỉnh': 'Hà Nội', 'Nhiệt độ': '25' }]);
});

test("workbook nhiều sheet yêu cầu chọn trước khi trả records", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ region: "A", value: 1 }]), "Data");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ note: "help" }]), "Guide");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const inspected = parseSpreadsheetBuffer(buffer, { includeSamples: false });
  assert.equal(inspected.needsSheet, true);
  assert.deepEqual(inspected.sheetNames, ["Data", "Guide"]);
  const parsed = parseSpreadsheetBuffer(buffer, { sheetName: "Data", includeSamples: false });
  assert.deepEqual(parsed.records, [{ region: "A", value: 1 }]);
  assert.throws(() => parseSpreadsheetBuffer(buffer, { sheetName: "Missing" }), /Không tìm thấy bảng.*Missing/);
});

test("bảng có header nhiều dòng được từ chối với hướng dẫn chuẩn hóa", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Báo cáo thời tiết"],
    ["Tỉnh", "Nhiệt độ"],
    ["Hà Nội", 30]
  ]), "Data");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  assert.throws(() => parseSpreadsheetBuffer(buffer), /một hàng header duy nhất/);
});

test("fixture XLSX ẩn danh giữ đúng header, kiểu ô và 34 tên tỉnh/thành", () => {
  const parsed = parseSpreadsheetBuffer(createWeather34Workbook(), { sheetName: "Thoi_tiet_thang_9" });
  assert.equal(parsed.records.length, 1_020);
  assert.deepEqual([...new Set(parsed.records.map(row => row["Tỉnh/thành phố"]))], WEATHER_PROVINCES);
  assert.deepEqual(Object.keys(parsed.records[0]), [
    "Tỉnh/thành phố", "Ngày", "Nhiệt độ trung bình", "Nhiệt độ thấp nhất",
    "Nhiệt độ cao nhất", "Độ ẩm", "Lượng mưa", "Tình trạng thời tiết"
  ]);
  assert.equal(typeof parsed.records[0]["Ngày"], "number");
  assert.equal(typeof parsed.records[0]["Nhiệt độ trung bình"], "number");
  assert.equal(typeof parsed.records[0]["Tình trạng thời tiết"], "string");
  assert.equal(parsed.profile.columns.find(column => column.name === "Ngày").dateHint, "excel_serial");
});

const weatherPath = new URL("../geomap_test_samples/thoi_tiet_34_tinh_thanh_thang_09_2026.xlsx", import.meta.url);
test("fixture thời tiết thật giữ 34 địa danh và Excel serial để normalize", { skip: !existsSync(weatherPath) }, () => {
  const parsed = parseSpreadsheetBuffer(readFileSync(weatherPath), { sheetName: "Thoi_tiet_thang_9", includeSamples: false });
  assert.equal(parsed.records.length, 1020);
  assert.equal(new Set(parsed.records.map(row => row["Tỉnh/thành phố"])).size, 34);
  assert.equal(parsed.records[0]["Ngày"], 46266);
  assert.equal(parsed.profile.columns.find(column => column.name === "Ngày").dateHint, "excel_serial");
});

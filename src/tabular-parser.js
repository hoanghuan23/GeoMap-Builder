import * as XLSX from "xlsx";
import { profileTabularData } from "./tabular-data.js";

function assertStandardHeaders(records) {
  const fields = [...new Set(records.flatMap(record => Object.keys(record || {})))];
  if (fields.some(field => /^__EMPTY(?:_\d+)?$/.test(field)) || fields.every(field => !String(field).trim())) {
    throw new Error("Bảng có header trống, nhiều dòng hoặc dạng ma trận. Hãy chuẩn hóa thành một hàng header duy nhất trước khi upload.");
  }
}

export function parseSpreadsheetBuffer(buffer, { extension = "xlsx", sheetName = null, includeSamples = true } = {}) {
  // Keep spreadsheet dates as serials so normalization uses the documented
  // 1899-12-30 epoch consistently across browser time zones.
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false, raw: true });
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) throw new Error("Workbook không có sheet dữ liệu.");
  if (!sheetName && sheetNames.length > 1) return { needsSheet: true, sheetNames };
  const selectedSheet = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
  const records = XLSX.utils.sheet_to_json(workbook.Sheets[selectedSheet], { defval: "", raw: true });
  if (!records.length) throw new Error(`Sheet "${selectedSheet}" không có bản ghi dữ liệu.`);
  assertStandardHeaders(records);
  return { records, profile: profileTabularData(records, { includeSamples }), sheetNames, sheetName: selectedSheet, extension };
}

export function profileRecords(records, options = {}) {
  return { records, profile: profileTabularData(records, options) };
}

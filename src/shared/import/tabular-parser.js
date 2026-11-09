import * as XLSX from "xlsx";
import { profileTabularData } from "./tabular-data.js";

function hasStandardHeaders(records) {
  const fields = [...new Set(records.flatMap(record => Object.keys(record || {})))];
  return fields.length > 0 && fields.every(field => String(field).trim() && !/^__EMPTY(?:_\d+)?$/.test(field));
}

function findHeaderRange(sheet) {
  if (!sheet["!ref"]) return null;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  // Inspect only the opening rows; raw cell values, including dates and zero,
  // are still read by sheet_to_json after selecting the table's header.
  const scanRange = { s: range.s, e: { c: range.e.c, r: Math.min(range.e.r, range.s.r + 99) } };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: scanRange, defval: "", raw: true, blankrows: true });
  const width = range.e.c - range.s.c + 1;
  const merges = sheet["!merges"] || [];
  for (let index = 0; index < rows.length; index++) {
    const values = rows[index];
    const populated = values.filter(value => String(value).trim());
    const row = range.s.r + index;
    const mergedHeader = merges.some(merge => merge.s.r <= row && merge.e.r >= row);
    if (values.length === width && values.every(value => typeof value === "string" && value.trim()) && !mergedHeader) {
      return { s: { r: row, c: range.s.c }, e: range.e };
    }
    // Preambles may contain titles, notes, blank rows and sparse label/number
    // summaries. Do not skip a partial text header or a full-width data row.
    const partialMerge = merges.some(merge => merge.s.r <= row && merge.e.r >= row &&
      (merge.s.c !== range.s.c || merge.e.c !== range.e.c));
    const isNumber = value => typeof value === "number" || typeof value === "string" && /^[-+]?\d+(?:[.,]\d+)?$/.test(value.trim());
    const summary = populated.length % 2 === 0 && populated.every((value, index) => index % 2 === 0
      ? typeof value === "string" && !isNumber(value) : isNumber(value));
    if (partialMerge || populated.length > 1 && (populated.length === width || !summary)) return null;
  }
  return null;
}

export function parseSpreadsheetBuffer(buffer, { extension = "xlsx", sheetName = null, includeSamples = true } = {}) {
  // Keep spreadsheet dates as serials so normalization uses the documented
  // 1899-12-30 epoch consistently across browser time zones.
  let input = buffer; let inputType = "array";
  if (extension.toLowerCase() === "csv") {
    // UTF-8 CSVs without a BOM otherwise fall back to a single-byte encoding.
    // Keep SheetJS's BOM/legacy handling for byte sequences that are not UTF-8.
    try { input = new TextDecoder("utf-8", { fatal: true }).decode(buffer); inputType = "string"; }
    catch { /* Use the original bytes, including UTF-16 BOMs. */ }
  }
  const workbook = XLSX.read(input, { type: inputType, cellDates: false, raw: true });
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) throw new Error("Workbook không có sheet dữ liệu.");
  if (!sheetName && sheetNames.length > 1) return { needsSheet: true, sheetNames };
  if (sheetName && !sheetNames.includes(sheetName)) throw new Error(`Không tìm thấy bảng (sheet) "${sheetName}" trong file Excel. Hãy chọn lại bảng cần phân tích.`);
  const selectedSheet = sheetName || sheetNames[0];
  const sheet = workbook.Sheets[selectedSheet];
  let records = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  if (!records.length) throw new Error(`Sheet "${selectedSheet}" không có bản ghi dữ liệu.`);
  if (!hasStandardHeaders(records)) {
    const range = findHeaderRange(sheet);
    if (range) records = XLSX.utils.sheet_to_json(sheet, { range, defval: "", raw: true });
    if (!hasStandardHeaders(records)) {
      throw new Error("Bảng có header trống, nhiều dòng hoặc dạng ma trận. Hãy chuẩn hóa thành một hàng header duy nhất trước khi upload.");
    }
  }
  return { records, profile: profileTabularData(records, { includeSamples }), sheetNames, sheetName: selectedSheet, extension };
}

export function profileRecords(records, options = {}) {
  return { records, profile: profileTabularData(records, options) };
}

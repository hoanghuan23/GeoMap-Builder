import { parseSpreadsheetBuffer, profileRecords } from "./tabular-parser.js";

self.onmessage = event => {
  const { id, action, payload } = event.data || {};
  try {
    const result = action === "spreadsheet"
      ? parseSpreadsheetBuffer(payload.buffer, payload.options)
      : profileRecords(payload.records, payload.options);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || "Không thể phân tích bảng dữ liệu." });
  }
};

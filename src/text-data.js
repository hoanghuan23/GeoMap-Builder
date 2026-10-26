export const MAX_DOCUMENT_TEXT_LENGTH = 50_000;

export function validateDocumentText(value) {
  if (typeof value !== "string") throw new Error("Nội dung văn bản không hợp lệ.");
  if (value.length > MAX_DOCUMENT_TEXT_LENGTH) {
    throw new Error("Văn bản vượt giới hạn 50.000 ký tự. Hãy chia tài liệu thành các file nhỏ hơn.");
  }
  const text = value.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("File không có nội dung văn bản để phân tích.");
  return text;
}

/** Validate the positional table before constructing records with dynamic field names. */
export function recordsFromTextTable(value) {
  const fields = value?.fields;
  const rows = value?.rows;
  if (!Array.isArray(fields) || !Array.isArray(rows)
    || fields.some(field => typeof field !== "string" || !field.trim() || field !== field.trim()
      || /[\u0000-\u001f\u007f]/.test(field) || ["__proto__", "constructor", "prototype"].includes(field))
    || new Set(fields).size !== fields.length || !fields.length && rows.length) {
    throw new Error("AI trả về danh sách cột văn bản không hợp lệ.");
  }
  if (rows.some(row => !Array.isArray(row) || row.length !== fields.length || row.some(cell =>
    cell !== null && typeof cell !== "string" && typeof cell !== "boolean" && !(typeof cell === "number" && Number.isFinite(cell))))) {
    throw new Error("AI trả về bảng văn bản sai cấu trúc hoặc giá trị ô không hợp lệ.");
  }
  return rows.map(row => Object.fromEntries(fields.map((field, index) => [field, row[index]])));
}

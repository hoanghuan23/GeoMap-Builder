import { validateDocumentText } from "./text-data.js";

export async function parseTextDocumentBuffer(buffer, { extension = "txt" } = {}) {
  let text;
  if (extension.toLowerCase() === "txt") {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch { throw new Error("Không đọc được TXT. Hãy lưu file bằng mã hóa UTF-8."); }
  } else if (extension.toLowerCase() === "docx") {
    try {
      const module = await import("mammoth/mammoth.browser.js");
      const mammoth = module.default || module;
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      text = result.value;
    } catch {
      throw new Error("Không thể đọc file DOCX. File có thể bị hỏng hoặc được bảo vệ.");
    }
  } else if (extension.toLowerCase() === "doc") {
    throw new Error("Chưa hỗ trợ file .doc. Hãy mở bằng Word và lưu lại thành .docx.");
  } else {
    throw new Error("Chỉ hỗ trợ tài liệu TXT và DOCX.");
  }
  return { text: validateDocumentText(text) };
}

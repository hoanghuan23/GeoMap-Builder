import { parseTextDocumentBuffer } from "./text-document-parser.js";

self.onmessage = async event => {
  const { buffer, extension } = event.data;
  try {
    self.postMessage({ result: await parseTextDocumentBuffer(buffer, { extension }) });
  } catch (error) {
    self.postMessage({ error: error?.message || "Không thể đọc tài liệu văn bản." });
  }
};

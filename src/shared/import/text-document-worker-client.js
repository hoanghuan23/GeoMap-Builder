import { parseTextDocumentBuffer } from "./text-document-parser.js";

const abortError = () => new DOMException("Aborted", "AbortError");

export async function parseTextDocumentFile(file, { signal } = {}) {
  if (signal?.aborted) throw abortError();
  const extension = file.name.toLowerCase().split(".").pop();
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw abortError();
  // Node tests and browsers without Worker support use the same parser.
  if (typeof Worker === "undefined") {
    const result = await parseTextDocumentBuffer(buffer, { extension });
    if (signal?.aborted) throw abortError();
    return result;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./text-document-parser.worker.js", import.meta.url), { type: "module" });
    const cleanup = () => { signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || "Không thể đọc tài liệu văn bản.")); };
    try { worker.postMessage({ buffer, extension }, [buffer]); }
    catch (error) { cleanup(); reject(error); }
  });
}

import { parseSpreadsheetBuffer, profileRecords } from "./tabular-parser.js";

let requestSequence = 0;

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function runWorker(action, payload, { signal, transfer = [] } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined") {
    return Promise.resolve(action === "spreadsheet" ? parseSpreadsheetBuffer(payload.buffer, payload.options) : profileRecords(payload.records, payload.options));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./tabular-parser.worker.js", import.meta.url), { type: "module" });
    const id = ++requestSequence;
    const cleanup = () => { signal?.removeEventListener("abort", abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(abortError()); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = event => {
      if (event.data?.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result);
    };
    worker.onerror = event => { cleanup(); reject(new Error(event.message || "Web Worker không thể phân tích dữ liệu.")); };
    try {
      worker.postMessage({ id, action, payload }, transfer);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function parseSpreadsheetFile(file, options = {}) {
  const { signal, ...workerOptions } = options;
  if (signal?.aborted) throw abortError();
  const buffer = await file.arrayBuffer();
  if (signal?.aborted) throw abortError();
  return runWorker("spreadsheet", { buffer, options: workerOptions }, { signal, transfer: [buffer] });
}

export function profileRecordsInWorker(records, options = {}) {
  const { signal, ...workerOptions } = options;
  return runWorker("profile", { records, options: workerOptions }, { signal });
}

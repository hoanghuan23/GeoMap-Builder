let requestSequence = 0;

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

async function runWorker(action, payload, { signal, transfer = [] } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined") {
    if (action === "profile") {
      const { profileTabularData } = await import("./tabular-data.js");
      if (signal?.aborted) throw abortError();
      return { records: payload.records, profile: profileTabularData(payload.records, payload.options) };
    }
    // Keep SheetJS out of the startup bundle, including the no-Worker fallback.
    const { parseSpreadsheetBuffer } = await import("./tabular-parser.js");
    if (signal?.aborted) throw abortError();
    return parseSpreadsheetBuffer(payload.buffer, payload.options);
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

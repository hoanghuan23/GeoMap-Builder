import test from "node:test";
import assert from "node:assert/strict";
import { parseSpreadsheetFile, profileRecordsInWorker } from "../src/tabular-worker-client.js";

test("AbortSignal chỉ ở main thread và không bị structured-clone sang Worker", async t => {
  const originalWorker = globalThis.Worker;
  const messages = [];
  class CloneCheckingWorker {
    postMessage(message) {
      const cloned = structuredClone(message);
      messages.push(cloned);
      queueMicrotask(() => this.onmessage({ data: { id: message.id, result: { ok: true } } }));
    }
    terminate() {}
  }
  globalThis.Worker = CloneCheckingWorker;
  t.after(() => {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  });

  const spreadsheetController = new AbortController();
  await parseSpreadsheetFile({ arrayBuffer: async () => new ArrayBuffer(8) }, {
    signal: spreadsheetController.signal,
    includeSamples: false
  });
  const profileController = new AbortController();
  await profileRecordsInWorker([{ value: 1 }], {
    signal: profileController.signal,
    includeSamples: false
  });

  assert.equal(messages.length, 2);
  assert.equal("signal" in messages[0].payload.options, false);
  assert.equal("signal" in messages[1].payload.options, false);
  assert.equal(messages[0].payload.options.includeSamples, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseTextDocumentBuffer } from "../src/text-document-parser.js";
import { parseTextDocumentFile } from "../src/text-document-worker-client.js";
import { MAX_DOCUMENT_TEXT_LENGTH, recordsFromTextTable, validateDocumentText } from "../src/text-data.js";
import { weatherDocumentFile, weatherRecords, weatherText, textWeatherOutput } from "./fixtures/text-weather-fixture.js";

test("TXT UTF-8 with or without BOM and actual DOCX preserve Vietnamese text", async () => {
  for (const content of [weatherText, `\uFEFF${weatherText}\r\n`]) {
    assert.equal((await parseTextDocumentBuffer(new TextEncoder().encode(content).buffer)).text, weatherText);
  }
  for (const extension of ["txt", "docx"]) {
    assert.equal((await parseTextDocumentFile(weatherDocumentFile(extension))).text, weatherText);
  }
});

test("empty, invalid UTF-8, corrupt DOCX, old DOC, and unsupported documents have clear errors", async () => {
  await assert.rejects(parseTextDocumentBuffer(new TextEncoder().encode(" \n\uFEFF ").buffer), /không có nội dung/);
  await assert.rejects(parseTextDocumentBuffer(new Uint8Array([0xff, 0xfe]).buffer), /UTF-8/);
  await assert.rejects(parseTextDocumentBuffer(new Uint8Array([1, 2, 3]).buffer, { extension: "docx" }), /DOCX.*hỏng/);
  const empty = await weatherDocumentFile("docx", "").arrayBuffer();
  await assert.rejects(parseTextDocumentBuffer(empty, { extension: "docx" }), /không có nội dung/);
  await assert.rejects(parseTextDocumentBuffer(new ArrayBuffer(0), { extension: "doc" }), /lưu lại thành .docx/);
  await assert.rejects(parseTextDocumentBuffer(new ArrayBuffer(0), { extension: "pdf" }), /TXT và DOCX/);
});

test("50,000 character limit rejects documents without truncating", async () => {
  assert.equal(validateDocumentText("a".repeat(MAX_DOCUMENT_TEXT_LENGTH)).length, MAX_DOCUMENT_TEXT_LENGTH);
  assert.throws(() => validateDocumentText("a".repeat(MAX_DOCUMENT_TEXT_LENGTH + 1)), /50.000/);
  assert.throws(() => validateDocumentText(null), /không hợp lệ/);
  await assert.rejects(parseTextDocumentBuffer(new TextEncoder().encode("á".repeat(MAX_DOCUMENT_TEXT_LENGTH + 1)).buffer), /50.000/);
});

test("table validator keeps exact numbers and nulls, and rejects misaligned or unsafe data", () => {
  assert.deepEqual(recordsFromTextTable(textWeatherOutput()), weatherRecords);
  assert.deepEqual(recordsFromTextTable({ fields: ["A", "B"], rows: [[null, true]] }), [{ A: null, B: true }]);
  assert.deepEqual(recordsFromTextTable({ fields: [], rows: [] }), []);
  for (const value of [null, {}, { fields: ["A", "A"], rows: [] }, { fields: [" A"], rows: [] },
    { fields: ["__proto__"], rows: [[1]] }, { fields: [], rows: [[]] }, { fields: ["A"], rows: [[1, 2]] },
    { fields: ["A"], rows: [[{}]] }, { fields: ["A"], rows: [[NaN]] }]) {
    assert.throws(() => recordsFromTextTable(value), /AI trả về/);
  }
});

test("abort before or during file reading prevents parsing", async () => {
  const controller = new AbortController(); controller.abort();
  let reads = 0;
  await assert.rejects(parseTextDocumentFile({ name: "file.txt", arrayBuffer: async () => { reads++; } }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(reads, 0);
  const reading = new AbortController();
  await assert.rejects(parseTextDocumentFile({ name: "file.docx", arrayBuffer: async () => { reading.abort(); return new ArrayBuffer(0); } }, { signal: reading.signal }), { name: "AbortError" });
});

test("document Worker transfers bytes without a signal and terminates on success, error, and abort", async t => {
  const originalWorker = globalThis.Worker;
  const workers = [];
  class MockWorker {
    constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
    postMessage(message, transfer) { this.message = structuredClone(message); this.transfer = transfer; }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = MockWorker;
  t.after(() => { if (originalWorker === undefined) delete globalThis.Worker; else globalThis.Worker = originalWorker; });
  const file = weatherDocumentFile("docx");
  const successful = parseTextDocumentFile(file);
  await new Promise(resolve => setImmediate(resolve));
  const first = workers.at(-1);
  assert.equal(first.options.type, "module");
  assert.equal(first.message.extension, "docx");
  assert.equal("signal" in first.message, false);
  assert.equal(first.transfer.length, 1);
  first.onmessage({ data: { result: { text: weatherText } } });
  assert.deepEqual(await successful, { text: weatherText });
  assert.equal(first.terminated, true);

  const failure = parseTextDocumentFile(file);
  const rejected = assert.rejects(failure, /hỏng/);
  await new Promise(resolve => setImmediate(resolve));
  const second = workers.at(-1);
  second.onmessage({ data: { error: "DOCX hỏng" } });
  await rejected;
  assert.equal(second.terminated, true);

  const controller = new AbortController();
  const cancelled = assert.rejects(parseTextDocumentFile(file, { signal: controller.signal }), { name: "AbortError" });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await cancelled;
  assert.equal(workers.at(-1).terminated, true);
});

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { aiMapEditPlugin } from '../server/ai-map-edit.js';

// Opt-in diagnostic tool. Request content comes entirely from a file or stdin.
const [source, ...extra] = process.argv.slice(2);
const usage = 'Cách dùng: node scripts/check-ai-map-edit-live.js <request.json|->\nJSON đầu vào gồm message, history và context. Dùng - để đọc từ stdin.';
if (source === '--help') { console.log(usage); process.exit(0); }
if (!source || extra.length) { console.error(usage); process.exit(1); }
const input = source === '-' ? await (async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
})() : await readFile(source, 'utf8');
JSON.parse(input); // Reject malformed JSON before loading or contacting the AI service.
const env = loadEnv('development', process.cwd(), '');
let middleware;
aiMapEditPlugin(env).configureServer({ middlewares: { use(fn) { middleware = fn; } } });
const request = Readable.from([Buffer.from(input)]);
request.url = '/api/ai/edit-map'; request.method = 'POST';
const response = await new Promise(resolve => middleware(request, { setHeader() {}, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); } }, () => assert.fail('Missing edit route')));
assert.equal(response.status, 200, response.body.error);
console.log(JSON.stringify({ ok: true, message: response.body.message, operations: response.body.operations }, null, 2));

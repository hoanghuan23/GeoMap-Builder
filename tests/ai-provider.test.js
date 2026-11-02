import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAiJson } from '../server/ai-provider.js';

const env = { OPENAI_API_KEY: 'local-test-key', OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze/' };
const request = { instructions: 'Return JSON according to the schema.', input: { text: 'Untrusted document' },
  schema: { type: 'object' }, name: 'test', mode: 'text_analysis' };

test('Codex uses its exact endpoint, header, prompt-only request and wrapped result', async () => {
  const controller = new AbortController();
  const output = await requestAiJson(env, { ...request, signal: controller.signal }, async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:8000/analyze');
    assert.equal(init.headers['x-api-key'], env.OPENAI_API_KEY);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.signal, controller.signal);
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body), ['prompt', 'mode', 'output_format']);
    assert.equal(body.mode, 'text_analysis');
    assert.equal(body.output_format, 'web');
    assert.ok(body.prompt.startsWith(request.instructions));
    assert.ok(body.prompt.endsWith(JSON.stringify(request.input)));
    return { ok: true, json: async () => ({ success: true, result: '{"fields":["A"],"rows":[[1]]}' }) };
  });
  assert.deepEqual(output, { fields: ['A'], rows: [[1]] });
});

test('Codex errors and malformed output fail without treating them as analysis', async () => {
  for (const [status, result, error] of [
    [401, { detail: 'Invalid API key' }, /Invalid API key/],
    [422, { detail: [{ msg: 'Choose prompt or skill + input', input: 'private' }] }, /Choose prompt or skill \+ input/],
    [200, { success: false, error: 'Codex failed' }, /Codex failed/],
    [200, { success: true }, /result hợp lệ/],
    [200, { success: true, result: 'invalid JSON' }, /JSON/]
  ]) {
    await assert.rejects(requestAiJson(env, request, async () => ({ status, ok: status === 200, json: async () => result })), error);
  }
});

test('non-JSON HTTP failures identify the endpoint and status', async () => {
  await assert.rejects(requestAiJson(env, request, async () => ({ ok: false, status: 404,
    json: async () => { throw new SyntaxError('HTML'); } })), /AI HTTP 404.*127\.0\.0\.1:8000\/analyze/);
});

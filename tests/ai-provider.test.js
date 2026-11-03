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

test('both transports accept a single JSON code fence and preserve string contents', async () => {
  const expected = { reason: 'Giữ dấu phẩy, dấu ngoặc } và ``` trong nội dung.', columns: [] };
  for (const isCodex of [true, false]) {
    for (const language of ['json', '']) {
      const value = ` \n\`\`\`${language}\n${JSON.stringify(expected)}\n\`\`\`\n `;
      const output = await requestAiJson(isCodex ? env : { OPENAI_API_KEY: 'test' }, request,
        async () => ({ ok: true, json: async () => isCodex ? { success: true, result: value } : { output_text: value } }));
      assert.deepEqual(output, expected);
    }
  }
});

test('malformed JSON reports the provider and position without exposing output or retrying', async t => {
  const debug = t.mock.method(console, 'debug', () => {});
  const invalid = '{"reason":"private document"\n"columns":[]}';
  for (const isCodex of [true, false]) {
    let calls = 0;
    await assert.rejects(requestAiJson(isCodex ? env : { OPENAI_API_KEY: 'test' }, request, async () => {
      calls++;
      return { ok: true, json: async () => isCodex ? { success: true, result: invalid } : { output_text: invalid } };
    }), error => {
      assert.match(error.message, isCodex ? /Server Codex/ : /Server AI/);
      assert.match(error.message, /JSON không hợp lệ tại vị trí \d+/);
      assert.doesNotMatch(error.message, /private document/);
      return true;
    });
    assert.equal(calls, 1);
  }
  assert.equal(debug.mock.callCount(), 0);
});

test('invalid JSON is available for diagnosis only when debug is enabled', async t => {
  const debug = t.mock.method(console, 'debug', () => {});
  const invalid = '{"reason":"private document"\n"columns":[]}';
  await assert.rejects(requestAiJson({ ...env, AI_DEBUG: 'true' }, request,
    async () => ({ ok: true, json: async () => ({ success: true, result: invalid }) })), /JSON không hợp lệ/);
  assert.equal(debug.mock.callCount(), 1);
  const logged = JSON.parse(debug.mock.calls[0].arguments[1]);
  assert.equal(logged.rawOutput, invalid);
  assert.equal(logged.provider, 'Server Codex');
  assert.equal(logged.name, request.name);
});

test('JSON with surrounding prose or missing delimiters is rejected without guessing a repair', async () => {
  for (const value of ['Here is the result: {"columns":[]}', '{"columns":[],}', '{"columns":[]', '{"a":1}\n{"b":2}']) {
    await assert.rejects(requestAiJson(env, request,
      async () => ({ ok: true, json: async () => ({ success: true, result: value }) })), /JSON không hợp lệ/);
  }
});

test('both transports reject arrays and primitives as analysis results', async () => {
  for (const value of [null, [], true, 42, 'text']) {
    for (const isCodex of [true, false]) {
      await assert.rejects(requestAiJson(isCodex ? env : { OPENAI_API_KEY: 'test' }, request,
        async () => ({ ok: true, json: async () => isCodex ? { success: true, result: JSON.stringify(value) }
          : { output_text: JSON.stringify(value) } })), /JSON object/);
    }
  }
});

test('Responses content fragments are joined before parsing JSON', async () => {
  const output = await requestAiJson({ OPENAI_API_KEY: 'test' }, request, async () => ({ ok: true,
    json: async () => ({ output: [{ content: [
      { type: 'output_text', text: '{"columns":' }, { type: 'output_text', text: '[]}' }
    ] }] }) }));
  assert.deepEqual(output, { columns: [] });
});

test('incomplete Responses output is rejected even if its JSON looks complete', async () => {
  await assert.rejects(requestAiJson({ OPENAI_API_KEY: 'test' }, request, async () => ({ ok: true,
    json: async () => ({ status: 'incomplete', output_text: '{"columns":[]}' }) })), /chưa hoàn tất/);
});

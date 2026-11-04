import test from 'node:test';
import assert from 'node:assert/strict';
import { mapTemplatesPlugin } from '../server/map-templates.js';
import { mapTemplates } from './fixtures/map-templates.js';

const env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'http://127.0.0.1:8000/analyze/' };
function middleware(config, fetchImpl) {
  let handler;
  mapTemplatesPlugin(config, fetchImpl).configureServer({ middlewares: { use(fn) { handler = fn; } } });
  return async (url = '/api/map-templates', method = 'GET') => {
    const headers = {}; let body;
    const response = { setHeader: (key, value) => { headers[key] = value; }, end: text => { body = JSON.parse(text); } };
    let next = false;
    await handler({ url, method }, response, () => { next = true; });
    return { status: response.statusCode, headers, body, next };
  };
}

test('proxy returns authored presentation config and keeps credentials/raw CSS on server', async () => {
  const call = middleware(env, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/templates');
    assert.equal(options.headers['X-API-Key'], 'test-key');
    return { ok: true, json: async () => ({ templates: mapTemplates.map(template => ({ ...template, css: 'not forwarded', secret: 'not forwarded' })) }) };
  });
  const response = await call();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { templates: mapTemplates });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(response), /test-key|not forwarded/);
});

test('metadata-only catalog supports source templates, while malformed and unavailable upstream fail', async () => {
  const sourceCatalog = { templates: [{ id: 'mau_01', name: 'Bản đồ mẫu 01' }] };
  assert.deepEqual((await middleware(env, async () => ({ ok: true, json: async () => sourceCatalog }))()).body, sourceCatalog);
  for (const body of [{ templates: [{ id: '../unsafe', name: 'Unsafe' }] }, { templates: null }]) {
    assert.equal((await middleware(env, async () => ({ ok: true, json: async () => body }))()).status, 502);
  }
  assert.equal((await middleware(env, async () => ({ ok: false }))()).status, 502);
  assert.equal((await middleware(env, async () => { throw new Error('private diagnostic'); })()).status, 502);
});

test('detail endpoint retrieves mau_01 source without executing or rewriting it', async () => {
  const source = { template: 'mau_01', html: '<main id="map"></main>', css: '#map { height: 100%; }', js: 'window.templateReady = true;' };
  const call = middleware(env, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8000/templates/mau_01');
    assert.equal(options.headers['X-API-Key'], 'test-key');
    return { ok: true, json: async () => source };
  });
  assert.deepEqual((await call('/api/map-templates/mau_01')).body, source);
  assert.equal((await call('/api/map-templates/mau_01', 'POST')).status, 405);
  assert.equal((await call('/api/map-templates/../secret')).next, true);
  assert.equal((await middleware(env, async () => ({ ok: true, json: async () => ({ ...source, template: 'other' }) }))('/api/map-templates/mau_01')).status, 502);
});

test('unconfigured server and unsupported methods fail locally; unrelated routes pass through', async () => {
  const unexpected = () => { throw new Error('Unexpected network call'); };
  assert.equal((await middleware({}, unexpected)()).status, 503);
  assert.equal((await middleware(env, unexpected)('/api/map-templates', 'POST')).status, 405);
  assert.equal((await middleware(env, unexpected)('/other')).next, true);
});

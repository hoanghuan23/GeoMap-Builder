import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { normalizeEditContext, normalizeEditResult } from '../src/ai-map-edit-contract.js';
import { aiMapEditPlugin } from '../server/ai-map-edit.js';
import { createAiMapEditor } from '../src/ai-map-editor.js';
import { contrastingText } from '../src/map-appearance-contract.js';

const rawContext = () => ({ groupId: 'g', activeLayerId: 'a', layers: [{ id: 'a', title: 'Thời tiết', mapType: 'polygon',
  columns: [{ name: 'name', role: 'geo' }, { name: 'temperature', role: 'measure' }], metrics: ['temperature'],
  popupModes: ['info', 'bar'], style: { opacity: .72 }, popupMode: 'info' }] });
const op = (kind, value, key = '', layerId = 'a') => ({ layerId, kind, key, value: JSON.stringify(value) });
const result = operations => ({ message: 'Đã chỉnh bản đồ.', operations });

test('map edit rejects the whole batch for unknown layers, fields, styles, modes and out-of-range values', () => {
  const context = normalizeEditContext(rawContext());
  for (const operation of [op('visible', false, '', 'other'), op('popupFields', ['invented']), op('popupMode', 'line'),
    op('style', 2, 'opacity'), op('style', 'url(secret)', 'color'), op('style', true, 'script'), op('metric', 'invented'),
    op('hexResolution', 16), op('hexResolution', 4.2)]) {
    assert.throws(() => normalizeEditResult(result([op('style', .5, 'opacity'), operation]), context));
  }
  assert.equal(normalizeEditResult(result([op('style', .5, 'opacity'), op('popupFields', ['temperature'])]), context).operations.length, 2);
  assert.throws(() => normalizeEditResult(result([op('hexEnabled', true)]), normalizeEditContext({ ...rawContext(), layers: [{ ...rawContext().layers[0], mapType: 'point' }] })));
});

test('legend edits preserve the metric target, aggregation and units; data colors cannot bypass the legend', () => {
  const raw = rawContext(); raw.layers[0].legendTarget = { field: 'temperature', aggregation: 'mean', unit: '°C' };
  const context = normalizeEditContext(raw);
  const legend = { aggregation: 'mean', type: 'continuous', mode: 'semantic', title: 'Nhiệt độ', unit: '°C', domain: [0, 40], center: null,
    stops: [{ value: 0, color: '#0000ff' }, { value: 40, color: '#ff0000' }], reason: 'Theo yêu cầu.' };
  assert.equal(normalizeEditResult(result([op('legend', legend)]), context).operations.length, 1);
  assert.throws(() => normalizeEditResult(result([op('style', '#ff0000', 'color')]), context));
  assert.throws(() => normalizeEditResult(result([op('legend', { ...legend, unit: '%' })]), context));
  assert.throws(() => normalizeEditResult(result([op('legend', legend), op('metric', 'temperature')]), context));
});

test('UI appearance edits allow the reported search/legend request and reject arbitrary CSS', async () => {
  const context = normalizeEditContext({ ...rawContext(), appearance: { search: { background: '#1e293b', color: '#ffffff' } } });
  const operations = [op('appearance', { background: '#ffffff' }, 'legend', ''), op('appearance', { background: '#ffffff' }, 'search', '')];
  assert.deepEqual(normalizeEditResult(result(operations), context).operations, operations);
  assert.equal(contrastingText('#ffffff'), '#172033');
  assert.equal(contrastingText('#101827'), '#ffffff');
  for (const operation of [op('appearance', { background: 'url(https://example.test)' }, 'search', ''),
    op('appearance', { position: 'fixed' }, 'legend', ''), op('appearance', { background: '#ffffff' }, 'map', ''),
    op('appearance', { background: '#ffffff' }, 'search', 'unknown'), op('appearance', { borderRadius: 100 }, 'search', '')]) {
    assert.throws(() => normalizeEditResult(result([operation]), context));
  }
  const response = await call({ OPENAI_API_KEY: 'test' }, { message: 'đổi màu nền phần chú giải và thanh tìm kiếm sang màu trắng', history: [], context }, async (_env, request) => {
    assert.match(request.instructions, /kind appearance/);
    assert.equal(request.input.context.appearance.search.background, '#1e293b');
    return result(operations);
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.operations, operations);
});

test('metric removal validates the retained list and requires a valid replacement for the active metric', () => {
  const raw = rawContext();
  raw.layers[0].columns.push({ name: 'pollution', role: 'measure' }, { name: 'rain', role: 'measure' });
  Object.assign(raw.layers[0], { metric: 'temperature', metrics: ['temperature', 'pollution', 'rain'], availableMetrics: ['temperature', 'pollution', 'rain'] });
  const context = normalizeEditContext(raw);
  assert.equal(normalizeEditResult(result([op('metricFields', ['pollution'])]), context).operations.length, 1);
  assert.equal(normalizeEditResult(result([op('metricFields', ['pollution', 'rain']), op('metric', 'pollution')]), context).operations.length, 2);
  for (const operations of [[op('metricFields', [])], [op('metricFields', ['unknown'])], [op('metricFields', ['pollution', 'pollution'])],
    [op('metricFields', ['pollution', 'rain'])], [op('metricFields', ['pollution']), op('metric', 'temperature')],
    [op('metricFields', ['pollution']), op('popupFields', ['temperature'])]]) assert.throws(() => normalizeEditResult(result(operations), context));
  raw.layers[0].metrics = ['pollution']; raw.layers[0].metric = 'pollution';
  const reduced = normalizeEditContext(raw);
  assert.throws(() => normalizeEditResult(result([op('metric', 'temperature')]), reduced));
  assert.equal(normalizeEditResult(result([op('metricFields', ['temperature', 'pollution']), op('metric', 'temperature')]), reduced).operations.length, 2);
});

test('control placement validates axes and offsets without allowing arbitrary CSS or detached popups', () => {
  const context = normalizeEditContext(rawContext());
  const operations = [op('appearance', { horizontal: 'left' }, 'metrics', ''),
    op('appearance', { horizontal: 'right', offsetX: 0 }, 'legend', ''),
    op('appearance', { horizontal: 'center', vertical: 'bottom', offsetY: 24 }, 'search', ''),
    op('appearance', { horizontal: 'default', vertical: 'default' }, 'controls', '')];
  assert.deepEqual(normalizeEditResult(result(operations), context).operations, operations);
  for (const patch of [{ horizontal: 'fixed' }, { vertical: 'left' }, { offsetX: -1 }, { offsetY: 201 }, { offsetX: '0' }, { top: 0 }]) {
    assert.throws(() => normalizeEditResult(result([op('appearance', patch, 'legend', '')]), context));
  }
  for (const patch of [{ horizontal: 'right' }, { offsetX: 0 }]) {
    assert.throws(() => normalizeEditResult(result([op('appearance', patch, 'popup', '')]), context));
  }
});

test('metric button sizing supports equal dimensions and explicit pixels only for metrics', async () => {
  const context = normalizeEditContext({ ...rawContext(), appearance: { metrics: { uniformSize: true } } });
  const operations = [op('appearance', { uniformSize: true, buttonWidth: 120, buttonHeight: 60 }, 'metrics', '')];
  assert.deepEqual(normalizeEditResult(result(operations), context).operations, operations);
  assert.equal(context.appearance.metrics.uniformSize, true);
  assert.equal(normalizeEditResult(result([op('appearance', { uniformSize: false }, 'metrics', '')]), context).operations.length, 1);
  for (const patch of [{ uniformSize: 'true' }, { buttonWidth: 63 }, { buttonWidth: 401 }, { buttonHeight: 31 },
    { buttonHeight: 161 }, { buttonWidth: '120px' }, { width: 120 }]) {
    assert.throws(() => normalizeEditResult(result([op('appearance', patch, 'metrics', '')]), context));
  }
  for (const target of ['search', 'legend', 'controls', 'popup']) {
    for (const patch of [{ uniformSize: true }, { buttonWidth: 120 }, { buttonHeight: 60 }]) {
      assert.throws(() => normalizeEditResult(result([op('appearance', patch, target, '')]), context));
    }
  }
  const response = await call({ OPENAI_API_KEY: 'test' }, {
    message: 'chỉnh kích thước các nút chỉ số cho bằng nhau', context,
    history: [{ role: 'assistant', content: 'Hiện chưa hỗ trợ đặt chiều rộng và chiều cao các nút chỉ số bằng nhau.' }]
  }, async (_env, request) => {
    assert.match(request.instructions, /uniformSize:true/);
    assert.match(request.instructions, /buttonWidth\/buttonHeight/);
    return result([op('appearance', { uniformSize: true }, 'metrics', '')]);
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body.operations[0].value).uniformSize, true);
});

test('the reported left-edge legend chat repairs invalid AI output before returning any edits', async () => {
  const context = normalizeEditContext({ ...rawContext(), layers: [{ ...rawContext().layers[0], mapType: 'arc', metrics: [], popupModes: [] }] });
  const body = { message: 'chuyển chú giải sang mép bên trái', history: [{ role: 'user', content: 'chuyển thông tin chú giải sang bên trái' }], context };
  const corrected = result([op('appearance', { horizontal: 'left', offsetX: 0 }, 'legend', '')]);
  for (const [value, expectedError] of [[JSON.stringify({ position: 'left' }), /position/],
    [JSON.stringify({ horizontal: 'left', offsetX: '0px' }), /offsetX.*số từ 0 đến 200/],
    [JSON.stringify({ horizontal: 'left', vertical: null }), /vertical.*top, center, bottom/],
    ['{"horizontal":', /JSON hợp lệ/]]) {
    const invalid = result([{ layerId: '', kind: 'appearance', key: 'legend', value }]);
    let calls = 0; let firstSignal;
    const response = await call({ OPENAI_API_KEY: 'test' }, body, async (_env, request) => {
      calls++;
      assert.equal(request.input.message, body.message);
      assert.deepEqual(request.input.history, body.history);
      assert.deepEqual(request.input.context, context);
      if (calls === 1) {
        firstSignal = request.signal;
        assert.equal(request.input.repair, undefined);
        return invalid;
      }
      assert.equal(calls, 2);
      assert.equal(request.signal, firstSignal);
      assert.deepEqual(JSON.parse(request.input.repair.previousResult), invalid);
      assert.match(request.input.repair.validationError, expectedError);
      return corrected;
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(response.body, corrected);
    assert.equal(normalizeEditResult(response.body, context).operations[0].value, corrected.operations[0].value);
  }
});

test('map edit repair is bounded, rejects the whole invalid batch, and does not retry provider errors', async () => {
  const body = { message: 'Chuyển chú giải sang trái', history: [], context: rawContext() };
  let calls = 0;
  const invalid = result([op('style', .4, 'opacity'), op('appearance', { horizontal: 'left', offsetX: -1 }, 'legend', '')]);
  const response = await call({ OPENAI_API_KEY: 'test' }, body, async () => { calls++; return invalid; });
  assert.equal(calls, 2);
  assert.equal(response.status, 502);
  assert.match(response.body.error, /legend.*offsetX.*số từ 0 đến 200/);
  assert.equal(response.body.operations, undefined);
  calls = 0;
  const unavailable = await call({ OPENAI_API_KEY: 'test' }, body, async () => { calls++; throw new Error('AI unavailable'); });
  assert.equal(calls, 1);
  assert.equal(unavailable.status, 502);
  assert.equal(unavailable.body.error, 'AI unavailable');
});

async function call(env, body, requestImpl) {
  let middleware; aiMapEditPlugin(env, { requestImpl }).configureServer({ middlewares: { use(fn) { middleware = fn; } } });
  const request = Readable.from([Buffer.from(JSON.stringify(body))]); request.url = '/api/ai/edit-map'; request.method = 'POST';
  return new Promise(resolve => {
    const response = { setHeader() {}, end(text) { resolve({ status: this.statusCode, body: JSON.parse(text) }); } };
    middleware(request, response, () => assert.fail('route missed'));
  });
}

test('chat middleware forwards current settings and conversation, strips source data, validates upstream output', async () => {
  const context = rawContext(); context.records = ['private']; context.layers[0].columns[0].samples = ['private'];
  const body = { message: 'Nhạt hơn nữa', history: [{ role: 'user', content: 'Đổi màu đỏ' }, { role: 'assistant', content: 'Đã đổi.' }], context };
  let calls = 0;
  const response = await call({ OPENAI_API_KEY: 'test' }, body, async (_env, request) => {
    calls++;
    assert.equal(request.name, 'map_edit');
    assert.equal(request.input.message, body.message.trim());
    assert.equal(request.input.history[0].content, 'Đổi màu đỏ');
    assert.equal(JSON.stringify(request.input).includes('private'), false);
    return result([op('style', .4, 'opacity')]);
  });
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal((await call({}, body)).status, 503);
  assert.equal((await call({ OPENAI_API_KEY: 'test' }, { ...body, history: [{ role: 'system', content: 'bad' }] })).status, 400);
  assert.equal((await call({ OPENAI_API_KEY: 'test' }, body, async () => result([op('metric', 'invented')]))).status, 502);
  assert.equal((await call({ OPENAI_API_KEY: 'test' }, body, async () => { throw new Error('AI unavailable'); })).body.error, 'AI unavailable');
});

function editorFixture(fetchImpl) {
  const workspace = { revision: 1, activeGroupId: 'g', groupsById: { g: { id: 'g', title: 'Map', activeLayerId: 'a', layerIds: ['a'], visible: true } }, layersById: { a: { title: 'Areas' } } };
  const configuration = { style: { opacity: .72 }, regionHexEnabled: false, regionHexResolution: 6 };
  const module = { metricField: () => null, metricColumns: () => [], renderControls() {},
    async update(change) { if (change.style) Object.assign(configuration.style, change.style); } };
  const api = { state: { mapType: 'polygon' }, context: { modules: { active: () => module }, options: {} },
    searchData: () => ({ columns: [] }), getView: () => ({ configuration }),
    controllers: { ui: { renderMapMetricControls() {} }, popup: { activeMapPopupSuggestion: () => null } } };
  const editor = createAiMapEditor({ workspace, runtimes: new Map([['a', { api }]]), isLoading: () => false, sync() {}, closePopups() {}, fetchImpl });
  return { editor, workspace, configuration, module };
}

test('map changes while AI runs prevent stale edits; follow-up requests see the applied configuration', async () => {
  let release; const requests = [];
  const fixture = editorFixture(async (_url, init) => { requests.push(JSON.parse(init.body)); return new Promise(resolve => { release = resolve; }); });
  const pending = fixture.editor.chat('Nhạt hơn', []);
  fixture.workspace.revision++;
  release({ ok: true, json: async () => result([op('style', .4, 'opacity')]) });
  await assert.rejects(pending, /đã thay đổi/);
  assert.equal(fixture.configuration.style.opacity, .72);
  const next = fixture.editor.chat('Nhạt hơn', []);
  release({ ok: true, json: async () => result([op('style', .4, 'opacity')]) }); await next;
  assert.equal(fixture.configuration.style.opacity, .4);
  const follow = fixture.editor.chat('Nhạt hơn nữa', [{ role: 'assistant', content: 'Đã chỉnh.' }]);
  assert.equal(requests.at(-1).context.layers[0].style.opacity, .4);
  release({ ok: true, json: async () => ({ message: 'Bạn muốn độ mờ bao nhiêu?', operations: [] }) }); await follow;
  assert.equal(fixture.configuration.style.opacity, .4);
});

test('render failures restore settings already changed in the batch', async () => {
  const fixture = editorFixture(async () => ({ ok: true, json: async () => result([op('style', .4, 'opacity'), op('hexEnabled', true)]) }));
  await assert.rejects(fixture.editor.chat('Nhạt hơn và bật lưới', []), /Không thể tạo/);
  assert.equal(fixture.configuration.style.opacity, .72);
  assert.equal(fixture.workspace.revision, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyChartRenderer } from '../src/charts/lazy-renderers.js';

function container() {
  return {
    textContent: '', attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    replaceChildren() { this.textContent = ''; }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('charts load only on render, share one load, and reuse the loaded renderer', async () => {
  const loading = deferred(); const calls = []; let loads = 0;
  const renderer = { render(host, input) { calls.push([host, input]); host.textContent = input.title; return input; },
    clear(host) { calls.push(['clear', host]); host.replaceChildren(); } };
  const lazy = createLazyChartRenderer(() => { loads++; return loading.promise; });
  const first = container(), second = container();
  lazy.clear(first);
  assert.equal(loads, 0, 'creating/clearing a popup must not download chart libraries');
  const a = lazy.render(first, { title: 'A' });
  const b = lazy.render(second, { title: 'B' });
  assert.equal(first.attributes.get('aria-busy'), 'true');
  await Promise.resolve();
  assert.equal(loads, 1);
  loading.resolve(renderer);
  await Promise.all([a, b]);
  assert.equal(first.textContent, 'A'); assert.equal(second.textContent, 'B');
  assert.equal(first.attributes.has('aria-busy'), false);
  assert.equal(first.attributes.has('role'), false);
  const next = { title: 'Updated' };
  assert.equal(lazy.render(first, next), next, 'loaded renderers preserve their synchronous return value');
  assert.equal(loads, 1);
  lazy.clear(first);
  assert.deepEqual(calls.at(-1), ['clear', first]);
});

test('closing a popup before loading completes never mounts a detached chart', async () => {
  const loading = deferred(); let mounts = 0;
  const lazy = createLazyChartRenderer(() => loading.promise);
  const host = container();
  const rendering = lazy.render(host, {});
  lazy.clear(host);
  loading.resolve({ render() { mounts++; }, clear() {} });
  await rendering;
  assert.equal(mounts, 0);
  assert.equal(host.textContent, '');
  assert.equal(host.attributes.has('aria-busy'), false);
});

test('changes during loading render only the latest chart configuration', async () => {
  const loading = deferred(); const titles = [];
  const lazy = createLazyChartRenderer(() => loading.promise);
  const host = container();
  const first = lazy.render(host, { title: 'Old metric' });
  const second = lazy.render(host, { title: 'New metric' });
  loading.resolve({ render(_host, input) { titles.push(input.title); }, clear() {} });
  await Promise.all([first, second]);
  assert.deepEqual(titles, ['New metric']);
});

test('a failed load can retry and cannot overwrite a closed or replaced popup', async () => {
  const failed = deferred(); let loads = 0;
  const lazy = createLazyChartRenderer(() => ++loads === 1 ? failed.promise
    : { render(host) { host.textContent = 'Chart ready'; }, clear() {} });
  const active = container(), closed = container();
  const first = lazy.render(active, {}), second = lazy.render(closed, {});
  lazy.clear(closed); closed.textContent = 'Information popup';
  failed.reject(new Error('Network unavailable'));
  await Promise.all([first, second]);
  assert.match(active.textContent, /Không thể hiển thị biểu đồ/);
  assert.equal(active.attributes.has('aria-busy'), false);
  assert.equal(closed.textContent, 'Information popup');
  await lazy.render(active, {});
  assert.equal(loads, 2);
  assert.equal(active.textContent, 'Chart ready');
  assert.equal(active.attributes.has('role'), false);
});

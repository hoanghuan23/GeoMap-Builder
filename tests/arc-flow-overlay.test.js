import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcFlowOverlayManager } from '../src/arc-flow-overlay.js';

function harness(options = {}) {
  let loads = 0; let created = 0; let disposed = 0; let sequence = 0;
  const frames = new Map(); const draws = []; const events = new Map(); const errors = [];
  const doc = { hidden: false, addEventListener(type, callback) { events.set(type, callback); }, removeEventListener(type) { events.delete(type); } };
  const manager = createArcFlowOverlayManager({}, { document: doc, supportsWebGL2: () => true,
    loadRenderer: async () => { loads++; return { createArcFlowRenderer() { created++; return {
      draw(entries, time) { draws.push({ ids: entries.map(entry => entry.id), time }); }, removeLayer() {}, dispose() { disposed++; }
    }; } }; },
    requestFrame(callback) { frames.set(++sequence, callback); return sequence; }, cancelFrame(id) { frames.delete(id); }, onError: error => errors.push(error), ...options });
  const tick = time => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(time); };
  const payload = { style: { animated: true, opacity: .75 }, view: { visibleFlows: [{ value: 10 }] } };
  return { manager, frames, draws, doc, events, errors, tick, payload, stats: () => ({ loads, created, disposed }) };
}

test('multiple owners share one lazy overlay and a single animation loop; detached/hidden groups stop it', async () => {
  const h = harness(); assert.equal(h.stats().loads, 0);
  await Promise.all([h.manager.updateLayer('a', h.payload), h.manager.updateLayer('b', h.payload)]);
  assert.deepEqual(h.stats(), { loads: 1, created: 1, disposed: 0 }); assert.equal(h.frames.size, 0);
  for (const id of ['a', 'b']) h.manager.setLayerState(id, { attached: true, visible: true });
  assert.equal(h.frames.size, 1); h.tick(100); h.tick(116);
  assert.equal(h.frames.size, 1); assert.deepEqual(h.draws.at(-1).ids, ['a', 'b']); assert.ok(h.draws.at(-1).time > 0);
  h.manager.setLayerState('a', { attached: false, visible: false });
  assert.deepEqual(h.draws.at(-1).ids, ['b']);
  h.manager.setLayerState('b', { attached: true, visible: false }); assert.equal(h.frames.size, 0);
  h.manager.removeLayer('a'); assert.equal(h.manager.ownerCount, 1);
  h.manager.dispose(); assert.equal(h.stats().disposed, 1); assert.equal(h.events.size, 0);
});

test('style reloads, page visibility and pause restore data without accumulating clocks or overlays', async () => {
  const h = harness(); await h.manager.updateLayer('a', h.payload); h.manager.setLayerState('a', { attached: true, visible: true });
  h.manager.setStyleReady(false); assert.equal(h.frames.size, 0); assert.deepEqual(h.draws.at(-1).ids, []);
  h.manager.setStyleReady(true); assert.equal(h.frames.size, 1);
  h.doc.hidden = true; h.events.get('visibilitychange')(); assert.equal(h.frames.size, 0);
  h.doc.hidden = false; h.events.get('visibilitychange')(); assert.equal(h.frames.size, 1);
  await h.manager.updateLayer('a', { ...h.payload, style: { ...h.payload.style, animated: false } }); assert.equal(h.frames.size, 0);
  await h.manager.updateLayer('a', h.payload); assert.equal(h.frames.size, 1);
  h.manager.removeLayer('a'); assert.equal(h.frames.size, 0); assert.equal(h.stats().created, 1);
});

test('unsupported WebGL2 and late loading after deletion/disposal release ownership safely', async () => {
  const unsupported = harness({ supportsWebGL2: () => false });
  assert.equal(await unsupported.manager.updateLayer('a', unsupported.payload), false);
  assert.equal(unsupported.manager.ownerCount, 0); assert.equal(unsupported.stats().loads, 0); assert.match(unsupported.errors[0].message, /WebGL2/);
  let finish; let creations = 0;
  const h = harness({ loadRenderer: () => new Promise(resolve => { finish = () => resolve({ createArcFlowRenderer() { creations++; } }); }) });
  const pending = h.manager.updateLayer('a', h.payload); h.manager.dispose(); finish();
  assert.equal(await pending, false); assert.equal(creations, 0); assert.equal(h.frames.size, 0);
});

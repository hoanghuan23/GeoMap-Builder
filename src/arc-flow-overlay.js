/** Owns a single lazy GPU overlay and one animation clock for the whole workspace. */
export function createArcFlowOverlayManager(map, {
  loadRenderer = () => import('./renderers/arc-flow-renderer.js'),
  requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id),
  document: doc = globalThis.document, supportsWebGL2 = () => Boolean(map.getCanvas().getContext('webgl2')),
  onError = () => {}
} = {}) {
  const owners = new Map();
  let renderer; let loading; let frame = null; let disposed = false; let styleReady = true;
  let elapsed = 0; let previous = null;
  const entries = () => [...owners].filter(([, owner]) => owner.attached && owner.visible && owner.payload?.view).map(([id, owner]) => ({ id, ...owner.payload }));
  const moving = active => active.some(entry => entry.style.animated && entry.style.opacity > 0 && entry.view.visibleFlows.some(flow => flow.value > 0));
  const stop = () => { if (frame != null) cancelFrame(frame); frame = null; previous = null; };
  const tick = now => {
    frame = null;
    if (disposed || !styleReady || doc?.hidden) { previous = null; return; }
    const active = entries();
    if (!moving(active)) { previous = null; return; }
    if (previous != null) elapsed += Math.min(100, Math.max(0, now - previous)) / 1000;
    previous = now;
    renderer?.draw(active, elapsed);
    frame = requestFrame(tick);
  };
  function refresh() {
    if (disposed) return;
    const active = styleReady ? entries() : [];
    renderer?.draw(active, elapsed);
    if (styleReady && !doc?.hidden && renderer && moving(active)) { if (frame == null) frame = requestFrame(tick); }
    else stop();
  }
  const visibility = () => { previous = null; refresh(); };
  doc?.addEventListener('visibilitychange', visibility);
  return {
    async updateLayer(id, payload) {
      if (disposed) return false;
      if (!payload) { this.removeLayer(id); return true; }
      const owner = owners.get(id) || { attached: false, visible: false };
      owner.payload = payload; owners.set(id, owner);
      try {
        if (!supportsWebGL2()) throw new Error('Arc Flow 3D cần WebGL2 trên trình duyệt và thiết bị này.');
        if (!loading) loading = loadRenderer().then(module => {
          if (!disposed) renderer = module.createArcFlowRenderer(map, { onError });
        }).catch(error => { loading = null; throw error; });
        await loading;
        if (disposed || !owners.has(id)) return false;
        refresh(); return true;
      } catch (error) { owners.delete(id); refresh(); onError(error); return false; }
    },
    setLayerState(id, { attached, visible }) {
      const owner = owners.get(id); if (!owner || owner.attached === attached && owner.visible === visible) return;
      Object.assign(owner, { attached, visible }); refresh();
    },
    setStyleReady(value) { styleReady = value; refresh(); },
    refresh,
    removeLayer(id) { owners.delete(id); renderer?.removeLayer(id); refresh(); },
    dispose() { disposed = true; stop(); doc?.removeEventListener('visibilitychange', visibility); owners.clear(); renderer?.dispose(); },
    get ownerCount() { return owners.size; }
  };
}

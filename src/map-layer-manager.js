/** A map namespace per dataset, including detached source/layer caches for inactive groups. */
export function createMapLayerManager(nativeMap, id, { onChange = () => {}, onInteract = () => {}, onPopup = () => {} } = {}) {
  const prefix = `${id}--`;
  const sources = new Map(); const layers = new Map(); const listeners = []; const popups = new Set();
  let attached = false; let interactive = false; let disposed = false; let visible = true;
  const key = name => `${prefix}${name}`;
  const local = feature => ({ ...feature, layer: feature.layer ? { ...feature.layer, id: feature.layer.id.replace(prefix, '') } : undefined });
  const actualLayout = spec => ({ ...spec.layout, visibility: visible ? spec.layout?.visibility || 'visible' : 'none' });
  const notify = () => { if (!disposed) onChange(); };
  const topFeature = event => {
    const ids = nativeMap.getStyle()?.layers?.filter(layer => layer.metadata?.workspaceLayer
      && !/--selected-cell|(?:-|--)border$|(?:-|--)labels$/.test(layer.id) && layer.type !== 'heatmap').map(layer => layer.id) || [];
    return ids.length ? nativeMap.queryRenderedFeatures(event.point, { layers: ids })[0] : null;
  };
  const handlers = {
    addSource(name, spec) {
      sources.set(name, { ...spec });
      if (attached && !nativeMap.getSource(key(name))) nativeMap.addSource(key(name), spec);
      notify(); return proxy;
    },
    getSource(name) {
      const spec = sources.get(name);
      if (!spec) return undefined;
      return { ...spec, setData(data) { spec.data = data; if (attached) nativeMap.getSource(key(name))?.setData(data); notify(); } };
    },
    removeSource(name) {
      if (attached && nativeMap.getSource(key(name))) nativeMap.removeSource(key(name));
      sources.delete(name); notify(); return proxy;
    },
    addLayer(spec, beforeId) {
      const copy = { ...spec, paint: { ...spec.paint }, layout: { ...spec.layout } };
      layers.set(spec.id, copy);
      if (attached && !nativeMap.getLayer(key(spec.id))) nativeMap.addLayer({ ...copy, id: key(copy.id), source: key(copy.source),
        layout: actualLayout(copy), metadata: { ...copy.metadata, workspaceLayer: id } }, beforeId && nativeMap.getLayer(key(beforeId)) ? key(beforeId) : undefined);
      notify(); return proxy;
    },
    getLayer(name) { return layers.get(name); },
    removeLayer(name) {
      if (attached && nativeMap.getLayer(key(name))) nativeMap.removeLayer(key(name));
      layers.delete(name); notify(); return proxy;
    },
    setPaintProperty(name, property, value) {
      const spec = layers.get(name); if (!spec) return proxy;
      spec.paint[property] = value;
      if (attached && nativeMap.getLayer(key(name))) nativeMap.setPaintProperty(key(name), property, value);
      notify(); return proxy;
    },
    setLayoutProperty(name, property, value) {
      const spec = layers.get(name); if (!spec) return proxy;
      spec.layout[property] = value;
      if (attached && nativeMap.getLayer(key(name))) nativeMap.setLayoutProperty(key(name), property, property === 'visibility' && !visible ? 'none' : value);
      notify(); return proxy;
    },
    moveLayer(name, beforeId) {
      if (attached && nativeMap.getLayer(key(name))) nativeMap.moveLayer(key(name), beforeId ? key(beforeId) : undefined);
      return proxy;
    },
    queryRenderedFeatures(point, options = {}) {
      if (!attached || !visible) return [];
      return nativeMap.queryRenderedFeatures(point, { ...options, layers: (options.layers || [...layers.keys()]).map(key).filter(name => nativeMap.getLayer(name)) }).map(local);
    },
    on(type, target, handler) {
      const callback = typeof target === 'function' ? target : handler;
      const layerName = typeof target === 'string' ? target : null;
      // Use one native listener form. Delegated events would query removed layers after group switches.
      let hovering = false;
      const wrapped = event => {
        if (disposed) return;
        if (['click', 'mouseenter', 'mouseleave'].includes(type)) {
          if (!attached || !visible) return;
          const top = topFeature(event);
          if (type === 'mouseenter' || type === 'mouseleave') {
            const over = top?.layer?.metadata?.workspaceLayer === id && (!layerName || top.layer.id === key(layerName));
            const changed = hovering !== over; hovering = over;
            if (!changed || type === 'mouseenter' && !over || type === 'mouseleave' && over) return;
            callback({ ...event, features: top ? [local(top)] : [] }); return;
          }
          if (type !== 'mouseleave' && (!top || top.layer?.metadata?.workspaceLayer !== id)) return;
          if (layerName && top?.layer?.id !== key(layerName)) return;
          if (type === 'click') onInteract(id);
          callback({ ...event, features: top ? [local(top)] : [] });
        } else callback(event);
      };
      // MapLibre's delegated enter/leave need a layer. Mousemove is safe when detached.
      const eventType = type === 'mouseenter' || type === 'mouseleave' ? 'mousemove' : type;
      nativeMap.on(eventType, wrapped); listeners.push([eventType, wrapped]); return proxy;
    },
    off(type, handler) {
      nativeMap.off(type, handler); return proxy;
    },
    fitBounds(...args) { if (interactive && attached) nativeMap.fitBounds(...args); return proxy; },
    flyTo(...args) { if (interactive && attached) nativeMap.flyTo(...args); return proxy; },
    setStyle() { throw new Error('Nền bản đồ được quản lý ở cấp workspace.'); }
  };
  const proxy = new Proxy(nativeMap, { get(target, property) {
    if (property in handlers) return handlers[property];
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return {
    id, map: proxy, sources, layers,
    setInteractive(value) { interactive = value; },
    setVisible(value) {
      visible = value;
      if (attached) for (const [name, spec] of layers) if (nativeMap.getLayer(key(name))) nativeMap.setLayoutProperty(key(name), 'visibility', actualLayout(spec).visibility);
    },
    attach() {
      if (disposed) return;
      attached = true;
      for (const [name, spec] of sources) if (!nativeMap.getSource(key(name))) nativeMap.addSource(key(name), spec);
      for (const [name, spec] of layers) if (!nativeMap.getLayer(key(name))) nativeMap.addLayer({ ...spec, id: key(name), source: key(spec.source),
        layout: actualLayout(spec), metadata: { ...spec.metadata, workspaceLayer: id } });
    },
    detach() {
      for (const popup of [...popups]) popup.remove();
      for (const name of [...layers.keys()].reverse()) if (nativeMap.getLayer(key(name))) nativeMap.removeLayer(key(name));
      for (const name of sources.keys()) if (nativeMap.getSource(key(name))) nativeMap.removeSource(key(name));
      attached = false; interactive = false;
    },
    popupLibrary(library) {
      return { ...library, Popup: class extends library.Popup {
        addTo() { onPopup(id); popups.add(this); this.on('close', () => popups.delete(this)); return super.addTo(nativeMap); }
      } };
    },
    closePopups() { for (const popup of [...popups]) popup.remove(); },
    dispose() {
      this.detach(); disposed = true;
      for (const [type, callback] of listeners) nativeMap.off(type, callback);
      listeners.length = 0; sources.clear(); layers.clear();
    }
  };
}

export function orderWorkspaceMapLayers(map) {
  const rank = layer => layer.id.endsWith('--selected-cell-border') || layer.id.endsWith('--selected-cell-fill') ? 50
    : layer.type === 'circle' || layer.type === 'symbol' ? 30
    : layer.type === 'line' ? /border$/.test(layer.id) ? 11 : 20 : 10;
  const layers = (map.getStyle()?.layers || []).filter(layer => layer.metadata?.workspaceLayer);
  layers.sort((a, b) => rank(a) - rank(b)).forEach(layer => map.moveLayer(layer.id));
}

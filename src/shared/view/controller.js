import { EMPTY_FEATURE_COLLECTION, MAP_STYLES, MAP_STYLE_LABELS } from '../configuration.js';

/** view operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  function applyStyle() {
    syncDataSearch(); if (!context.map) return;
    const module = context.modules.active(); module?.restore(); module?.style();
    applyMapLayerVisibility(); options.onChange?.();
  }

  function applyMapLayerVisibility() {
    if (!context.map) return;
    const visible = $('show-map-layers')?.checked ?? false;
    const active = context.modules.active();
    for (const module of context.modules.instances.values()) module.setVisible(module === active && visible);
    for (const layer of state.uploadLayers) for (const id of layer.layerIds || []) {
      if (context.map.getLayer(id)) context.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
    if (!visible) services.popup.closeMapPopup(); options.onChange?.();
  }

  function addMapLayers() {
    context.modules.active()?.restore();
    applyMapLayerVisibility();
  }

  function syncMapStyleControls(loading = false) {
    const selectedStyle = context.tasks.pendingMapStyle || state.mapStyle;
    document.querySelectorAll(".basemap-option").forEach(button => {
      const active = button.dataset.mapStyle === selectedStyle;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = loading;
    });
    $("basemap-selection").replaceChildren(
      loading ? "Đang chuyển nền: " : "Nền đang dùng: ",
      Object.assign(document.createElement("b"), { textContent: MAP_STYLE_LABELS[selectedStyle] })
    );
    // Keep attribution tied to the loaded style while another style is loading.
    $("satellite-attribution").hidden = state.mapStyle !== "satellite";
    $("map4d-attribution").hidden = state.mapStyle !== "map4d";
    $("vector-attribution").hidden = !["liberty", "bright", "dark"].includes(state.mapStyle);
  }

  function selectMapStyle(styleKey) {
    if (!MAP_STYLES[styleKey] || styleKey === state.mapStyle || context.tasks.pendingMapStyle || !context.map) return;
    context.tasks.pendingMapStyle = styleKey;
    context.popups.cellPopup?.remove();
    syncMapStyleControls(true);
    services.ui.setStatus(`Đang chuyển sang nền ${MAP_STYLE_LABELS[styleKey]}…`);
    clearTimeout(context.tasks.mapStyleLoadTimer);
    context.tasks.mapStyleLoadTimer = setTimeout(() => {
      if (context.tasks.pendingMapStyle !== styleKey) return;
      context.tasks.pendingMapStyle = null;
      syncMapStyleControls(false);
      services.ui.setStatus(`Không thể tải nền ${MAP_STYLE_LABELS[styleKey]}. Vui lòng thử lại.`, true);
    }, 15000);
    try {
      context.map.setStyle(MAP_STYLES[styleKey], { diff: false });
    } catch (error) {
      clearTimeout(context.tasks.mapStyleLoadTimer);
      context.tasks.pendingMapStyle = null;
      syncMapStyleControls(false);
      console.error("Không thể đổi nền bản đồ:", error);
      services.ui.setStatus(`Không thể tải nền ${MAP_STYLE_LABELS[styleKey]}.`, true);
    }
  }

  function fitGeoJSON(data) {
    const coords = [];
    const walk = (x) => {
      if (!Array.isArray(x)) return;

      if (x.length >= 2 && typeof x[0] === "number" && typeof x[1] === "number") {
        coords.push(x);
        return x;
      }
      x.forEach(walk);
    };

    const collectGeometry = geometry => {
      if (!geometry) return;
      if (geometry.type === "GeometryCollection") geometry.geometries?.forEach(collectGeometry);
      else walk(geometry.coordinates);
    };
    if (data?.type === "FeatureCollection") data.features?.forEach(feature => collectGeometry(feature.geometry));
    else if (data?.type === "Feature") collectGeometry(data.geometry);
    else collectGeometry(data);

    if (!coords.length) return;

    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0])
    );

    context.map.fitBounds(bounds, { 
      padding: {
        top: 55,
        bottom: 33,
        left: 40,
        right: 250
      },
      duration: 700
    });
  }

  function fitBoundary() { fitGeoJSON(state.boundary); }

  function currentDataSearch() {
    if (!state.mapType || !state.aiDataset && !state.dataProfile) return {};
    return context.modules.active()?.getView().search || {};
  }

  function syncDataSearch() {
    const data = currentDataSearch();
    context.search?.setData(data.data ? data : undefined);
  }

  function renderTable() {
    options.renderTable?.(state);
  }

  function updateDashboard() { renderTable(); }

  function exportCSV() {
    options.exportData?.(state);
  }

  return { applyStyle, applyMapLayerVisibility, addMapLayers, syncMapStyleControls, selectMapStyle, fitGeoJSON, fitBoundary, currentDataSearch, syncDataSearch, renderTable, updateDashboard, exportCSV };
}

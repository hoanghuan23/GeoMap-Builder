import { clipGeoJSONToPolygon as default_clipGeoJSONToPolygon } from "../geography/geojson-layers.js";
import { featureCount as default_featureCount } from "../geography/geojson-layers.js";
import { geometryKinds as default_geometryKinds } from "../geography/geojson-layers.js";
import { deterministicLayerOrder as default_deterministicLayerOrder } from "../../layer-order.js";
import { mapLayerIdsInOrder as default_mapLayerIdsInOrder } from "../../layer-order.js";
import { requestAiLayerOrder as default_requestAiLayerOrder } from "../../layer-order.js";

/** uploads operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const clipGeoJSONToPolygon = (...args) => (context.dependencies?.clipGeoJSONToPolygon ?? default_clipGeoJSONToPolygon)(...args);

  const featureCount = (...args) => (context.dependencies?.featureCount ?? default_featureCount)(...args);

  const geometryKinds = (...args) => (context.dependencies?.geometryKinds ?? default_geometryKinds)(...args);

  const deterministicLayerOrder = (...args) => (context.dependencies?.deterministicLayerOrder ?? default_deterministicLayerOrder)(...args);

  const mapLayerIdsInOrder = (...args) => (context.dependencies?.mapLayerIdsInOrder ?? default_mapLayerIdsInOrder)(...args);

  const requestAiLayerOrder = (...args) => (context.dependencies?.requestAiLayerOrder ?? default_requestAiLayerOrder)(...args);

  function bindUploadedLayerPointer(layerId) {
    if (context.tasks.uploadedPointerLayerIds.has(layerId)) return;
    context.tasks.uploadedPointerLayerIds.add(layerId);
    context.map.on("mouseenter", layerId, () => { context.map.getCanvas().style.cursor = "pointer"; });
    context.map.on("mouseleave", layerId, () => { context.map.getCanvas().style.cursor = ""; });
  }

  function showUploadedFeaturePopup(feature, uploadLayer, lngLat) {
    const properties = feature.properties || {};
    const card = document.createElement("div");
    card.className = "data-feature-popup";
    const title = document.createElement("strong");
    title.textContent = uploadLayer?.name || "Đối tượng dữ liệu";
    card.append(title);
    const details = Object.entries(properties).filter(([name, value]) => !name.startsWith("__") && value != null);
    if (details.length) {
      const list = document.createElement("dl");
      for (const [label, value] of details) {
        const row = document.createElement("div");
        const term = document.createElement("dt"); term.textContent = label;
        const description = document.createElement("dd"); description.textContent = String(value);
        row.append(term, description); list.append(row);
      }
      card.append(list);
    }
    new maplibregl.Popup({ offset: 9, maxWidth: "330px" }).setLngLat(lngLat).setDOMContent(card).addTo(context.map);
  }

  function addUploadedLayerToMap(layer) {
    const kinds = geometryKinds(layer.data);
    context.map.addSource(layer.sourceId, { type: "geojson", data: layer.data });
    layer.layerIds = [];
    if (kinds.includes("area")) {
      const fillId = `${layer.id}-fill`; const borderId = `${layer.id}-border`;
      context.map.addLayer({ id: fillId, type: "fill", source: layer.sourceId, paint: { "fill-color": "#8b5cf6", "fill-opacity": .3 } });
      context.map.addLayer({ id: borderId, type: "line", source: layer.sourceId, paint: { "line-color": "#c4b5fd", "line-width": 1.5 } });
      layer.layerIds.push(fillId, borderId);
    }
    if (kinds.includes("line")) {
      const lineId = `${layer.id}-line`;
      context.map.addLayer({ id: lineId, type: "line", source: layer.sourceId, paint: { "line-color": "#f43f5e", "line-width": 3 } });
      layer.layerIds.push(lineId);
    }
    if (kinds.includes("point")) {
      const pointId = `${layer.id}-point`;
      context.map.addLayer({ id: pointId, type: "circle", source: layer.sourceId, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 10, 5.5, 15, 8], "circle-color": "#f43f5e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.25, "circle-opacity": .9 } });
      layer.layerIds.push(pointId);
    }
    layer.layerIds.forEach(bindUploadedLayerPointer);
  }

  function restoreUploadedLayers() {
    for (const layer of state.uploadLayers) addUploadedLayerToMap(layer);
    services.view.applyMapLayerVisibility();
    scheduleUploadLayerOrder();
  }

  function pointFeatureCollection(data) {
    const features = [];
    const collect = feature => {
      const geometry = feature?.geometry;
      if (geometry?.type === "Point") features.push(feature);
      else if (geometry?.type === "MultiPoint") geometry.coordinates?.forEach(coordinates => features.push({ type: "Feature", properties: { ...(feature.properties || {}) }, geometry: { type: "Point", coordinates } }));
    };
    if (data?.type === "FeatureCollection") data.features?.forEach(collect);
    else if (data?.type === "Feature") collect(data);
    return { type: "FeatureCollection", features };
  }

  function registerPrimaryUpload(file, { role = "primary", data = null, detail = "" } = {}) {
    const previous = state.uploadedFiles.find(item => item.id === state.primaryUploadId);
    if (previous?.fileKey) state.uploadedFileKeys.delete(previous.fileKey);
    state.uploadedFiles = state.uploadedFiles.filter(item => item.id !== state.primaryUploadId);
    const id = `primary-${++state.uploadLayerSequence}`;
    const fileKey = services.input.uploadFileKey(file);
    state.primaryUploadId = id;
    state.uploadedFileKeys.add(fileKey);
    state.uploadedFiles.unshift({ id, name: file.name, fileKey, role, data, detail });
  }

  function setCurrentFileNote(note) {
    const file = state.uploadedFiles.find(item => item.id === state.primaryUploadId);
    if (file) {
      file.detail = note;
      renderUploadedFiles();
    } else $("file-note").textContent = note;
  }

  function showCurrentFile(name, note) {
    $("file-name").textContent = name;
    $("remove-current-file").hidden = state.uploadedFiles.length > 0;
    $("selected-file").hidden = false;
    setCurrentFileNote(note);
  }

  function renderUploadedFiles() {
    const list = $("uploaded-layer-list");
    if (!list) return;
    list.replaceChildren(...state.uploadedFiles.map(file => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const detail = document.createElement("em");
      const remove = document.createElement("button");
      name.textContent = file.name;
      name.title = file.name;
      detail.textContent = file.detail;
      remove.type = "button";
      remove.className = "remove-uploaded-layer";
      remove.dataset.uploadId = file.id;
      remove.setAttribute("aria-label", `Xóa ${file.name}`);
      remove.title = `Xóa ${file.name}`;
      remove.textContent = "×";
      item.append(name, detail, remove);
      return item;
    }));
    if (!state.uploadedFiles.length) return;
    $("remove-current-file").hidden = true;
    $("file-name").textContent = `${state.uploadedFiles.length} tệp dữ liệu`;
    $("file-note").textContent = "Các file được xếp chồng theo từng lớp";
    $("selected-file").hidden = false;
  }

  function uploadLayerOrderInput() {
    return state.uploadLayers.map(layer => ({
      id: layer.id,
      name: layer.name,
      role: layer.role,
      geometryKinds: geometryKinds(layer.originalData),
      featureCount: layer.featureCount,
      layerIds: layer.layerIds
    }));
  }

  function applyUploadLayerOrder(orderedLayerIds) {
    const layers = uploadLayerOrderInput();
    for (const mapLayerId of mapLayerIdsInOrder(layers, orderedLayerIds)) {
      if (context.map?.getLayer(mapLayerId)) context.map.moveLayer(mapLayerId);
    }
    context.search?.refreshHighlight();
  }

  function scheduleUploadLayerOrder() {
    const layers = uploadLayerOrderInput();
    applyUploadLayerOrder(deterministicLayerOrder(layers));
    clearTimeout(context.tasks.layerOrderTimer);
    const revision = ++context.tasks.layerOrderRevision;
    if (layers.length < 2) return;
    context.tasks.layerOrderTimer = setTimeout(async () => {
      const recommendation = await requestAiLayerOrder(layers);
      if (revision !== context.tasks.layerOrderRevision) return;
      applyUploadLayerOrder(recommendation.order);
    }, 350);
  }

  function clearUploadLayers() {
    clearTimeout(context.tasks.layerOrderTimer);
    context.tasks.layerOrderRevision++;
    for (const layer of state.uploadLayers) {
      for (const layerId of [...(layer.layerIds || [])].reverse()) {
        if (context.map?.getLayer(layerId)) context.map.removeLayer?.(layerId);
      }
      if (layer.sourceId && context.map?.getSource(layer.sourceId)) context.map.removeSource?.(layer.sourceId);
    }
    state.uploadLayers = [];
    state.uploadedFiles = [];
    state.primaryUploadId = null;
    state.uploadedFileKeys.clear();
    state.uploadLayerSequence = 0;
  }

  function hasPolygonMask() {
    return geometryKinds(state.boundary || state.sourceBoundary).includes("area");
  }

  function uploadLayerData(layer) {
    if (layer.role !== "hexagon") return layer.originalData;
    if (!hasPolygonMask()) return layer.originalData;
    return clipGeoJSONToPolygon(layer.originalData, state.boundary || state.sourceBoundary);
  }

  function refreshClippedUploadLayers() {
    for (const layer of state.uploadLayers.filter(item => item.role === "hexagon")) {
      layer.data = uploadLayerData(layer);
      layer.featureCount = featureCount(layer.data);
      context.map?.getSource(layer.sourceId)?.setData(layer.data);
      const summary = state.uploadedFiles.find(file => file.id === layer.id);
      if (summary) summary.detail = hasPolygonMask()
        ? `${layer.featureCount.toLocaleString("vi-VN")} ô trong vùng`
        : `${layer.featureCount.toLocaleString("vi-VN")} ô`;
    }
    renderUploadedFiles();
  }

  function addUploadedGeoJSONLayer(data, name, { forceRole = null, id: requestedId = null, register = true, fileKey = null } = {}) {
    const kinds = geometryKinds(data);
    const role = forceRole || (kinds.length === 1 ? kinds[0] : "mixed");
    const sequence = ++state.uploadLayerSequence;
    const id = requestedId || `uploaded-${sequence}`;
    const sourceId = `${id}-source`;
    const layer = {
      id, name, role, sourceId, layerIds: [], originalData: data, data,
      featureCount: featureCount(data)
    };
    layer.data = uploadLayerData(layer);
    layer.featureCount = featureCount(layer.data);
    addUploadedLayerToMap(layer);
    state.uploadLayers.push(layer);
    if (register) {
      state.uploadedFiles.push({
        id,
        name,
        fileKey,
        data,
        role,
        detail: role === "hexagon"
          ? hasPolygonMask() ? `${layer.featureCount.toLocaleString("vi-VN")} ô trong vùng` : `${layer.featureCount.toLocaleString("vi-VN")} ô`
          : `${featureCount(data).toLocaleString("vi-VN")} đối tượng`
      });
    }
    renderUploadedFiles();
    services.view.applyMapLayerVisibility();
    scheduleUploadLayerOrder();
    if (!hasPolygonMask()) services.view.fitGeoJSON(layer.data);
    return layer;
  }

  function removeDynamicUploadLayer(id) {
    const layer = state.uploadLayers.find(item => item.id === id);
    if (!layer) return;
    for (const layerId of [...layer.layerIds].reverse()) {
      if (context.map?.getLayer(layerId)) context.map.removeLayer?.(layerId);
    }
    if (context.map?.getSource(layer.sourceId)) context.map.removeSource?.(layer.sourceId);
    state.uploadLayers = state.uploadLayers.filter(item => item.id !== id);
    scheduleUploadLayerOrder();
  }

  async function removeUploadedFile(id) {
    const file = state.uploadedFiles.find(item => item.id === id);
    if (!file) return;
    removeDynamicUploadLayer(id);
    state.uploadedFiles = state.uploadedFiles.filter(item => item.id !== id);
    if (file.fileKey) state.uploadedFileKeys.delete(file.fileKey);
    if (id === state.primaryUploadId || file.role === "base") {
      services.runtime.clearUploadedData({ preserveUploads: true });
      refreshClippedUploadLayers();
      services.view.applyMapLayerVisibility();
      services.view.updateDashboard();
    }
    renderUploadedFiles();
    if (!state.uploadedFiles.length) $("selected-file").hidden = true;
    services.ui.setStatus(`Đã xóa lớp ${file.name}.`, true);
  }

  return { bindUploadedLayerPointer, showUploadedFeaturePopup, addUploadedLayerToMap, restoreUploadedLayers, pointFeatureCollection, registerPrimaryUpload, setCurrentFileNote, showCurrentFile, renderUploadedFiles, uploadLayerOrderInput, applyUploadLayerOrder, scheduleUploadLayerOrder, clearUploadLayers, hasPolygonMask, uploadLayerData, refreshClippedUploadLayers, addUploadedGeoJSONLayer, removeDynamicUploadLayer, removeUploadedFile };
}

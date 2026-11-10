import { createMapWorkspace, activeMapGroup, addWorkspaceLayer, createWorkspaceGroup, applyWorkspaceComposition, removeWorkspaceLayer } from './map-workspace.js';
import { createCompositionClient } from './map-composition.js';
import { fallbackComposition } from './map-composition-contract.js';
import { createMapLayerManager, orderWorkspaceMapLayers } from './map-layer-manager.js';
import { createLayerDocument } from './map-layer-document.js';
import { describeWorkspaceLayer, geometryExtent, layerData } from './shared/view/map-layer-data.js';
import { joinedPopupSources } from './attribute-joins.js';
import { createMapSearch } from './shared/search/map-search.js';
import { filterCountryRegionData } from './shared/geography/country-regions.js';
import { CONFIG } from './shared/config.js';
import { expandJsonUpload } from './shared/import/json-datasets.js';
import { keepSelectOpenAfterMouseClick } from './shared/ui/select-control.js';
import { createArcFlowOverlayManager } from './shared/view/arc-overlay.js';
import { createMapTemplateRenderer } from './map-template-renderer.js';
import { createMapProcessingStatus } from './shared/ui/map-processing-status.js';
import { createAiMapEditor } from './ai-map-editor.js';
import { createMapAppearance } from './map-appearance.js';
import { createMapFailureDialog } from './shared/ui/map-failure-dialog.js';

const fileKey = file => file.datasetKey || `${file.name}:${file.size}:${file.lastModified}`;
const textNode = (tag, text, className) => Object.assign(document.createElement(tag), { textContent: text, ...(className ? { className } : {}) });
const pendingLocationStatus = layer => layer.runtime.state.aiDataset?.analysis?.pointGeocoding?.matched === 0
  ? layer.runtime.state.aiDataset.analysis.pointGeocoding.reason ? 'Tra tọa độ gặp lỗi' : 'Chưa định vị được địa chỉ'
  : 'Chưa có vị trí trên bản đồ';
const pendingLocationReason = layer => layer.runtime.state.aiDataset?.analysis?.pointGeocoding?.matched === 0
  ? layer.runtime.state.aiDataset.analysis.pointGeocoding.reason ? 'Chưa nhận được kết quả tra tọa độ. Hãy thử phân tích lại.'
    : 'Chưa tìm được tọa độ từ các địa chỉ trong tệp để hiển thị điểm trên bản đồ.'
  : layer.attributeReason || layer.runtime.state.aiDataset?.fallbackReason || 'Cần tọa độ hoặc ghép dữ liệu với một lớp bản đồ có đối tượng tương ứng.';

export async function startMapWorkspace(createRuntime, { styles, styleLabels, renderCatalog, templatePicker }) {
  const workspace = createMapWorkspace();
  const failureDialog = createMapFailureDialog(document);
  const appearance = createMapAppearance({ panel: document.querySelector('.map-panel'), workspace });
  const uploads = new Map(); const keys = new Set(); const runtimes = new Map();
  const requestComposition = createCompositionClient();
  const $ = id => document.getElementById(id);
  const sidebar = document.querySelector('.sidebar');
  const metricOriginal = $('map-metric-control');
  const legendOriginal = document.querySelector('.map-legends');
  const sidebarTemplate = sidebar.cloneNode(true);
  sidebarTemplate.querySelector('#map-template-section')?.remove();
  const templates = [sidebarTemplate, metricOriginal.cloneNode(true), legendOriginal.cloneNode(true)];
  const empty = $('map-type-grid').closest('.panel-section');
  const sidebars = textNode('div', '', 'layer-sidebars');
  const actions = sidebar.querySelector('.builder-actions');
  actions.hidden = true; sidebar.append(actions);
  const configSections = [...sidebar.children].slice(2).filter(element => !element.classList.contains('builder-actions') && element.id !== 'map-template-section');
  configSections.forEach(element => element.remove());
  sidebar.insertBefore(sidebars, actions);
  sidebars.append(empty); renderCatalog(document);
  const metrics = textNode('div', '', 'workspace-metrics'); metricOriginal.replaceWith(metrics);
  legendOriginal.replaceChildren();
  const selector = document.createElement('select'); selector.id = 'displayed-map'; selector.disabled = true;
  selector.setAttribute('aria-label', 'Bản đồ đang hiển thị');
  const groupField = textNode('label', '', 'field map-group-field');
  groupField.hidden = true;
  groupField.append(textNode('span', 'Bản đồ đang hiển thị'), selector);
  const compositionNote = textNode('p', '', 'composition-note'); compositionNote.setAttribute('role', 'status');
  compositionNote.hidden = true;
  const retry = textNode('button', 'Thử đánh giá kết hợp lại', 'secondary-button'); retry.type = 'button'; retry.hidden = true;
  sidebar.children[1].append(groupField, compositionNote, retry);
  $('sheet-selector-field').hidden = true;
  document.querySelector('.drop-zone small').textContent = 'CSV, Excel, JSON, GeoJSON, TXT, DOCX · AI đánh giá hiển thị nhiều lớp';
  const map = new globalThis.maplibregl.Map({ container: 'map', style: styles.liberty, center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  const processingStatus = createMapProcessingStatus($('status'));
  const status = (message, hide = false) => processingStatus.set(message, hide);
  let templateLoading = false;
  const templateRenderer = createMapTemplateRenderer({ document, map, picker: templatePicker, processingStatus,
    onLoadingChange(loading) {
      templateLoading = loading;
      closePopups();
      schedule();
    }
  });
  let readyResolve; const ready = new Promise(resolve => { readyResolve = resolve; });
  let uploadSequence = 0; let scheduled = false; let queue = Promise.resolve();
  let selectedSignature = ''; let compositionController; let currentStyle = 'liberty'; let styleReady = false;
  let basemapFailureShown = false;
  const mounted = new Set();
  const search = createMapSearch({ map, minFilteredObjects: CONFIG.DATA_SEARCH_MIN_FILTERED_OBJECTS,
    onRegionChange(regionId) {
      const group = activeMapGroup(workspace); if (!group) return;
      group.regionId = regionId;
      closePopups(); sync();
    },
    onSelect(_feature, _center, entry) {
      if (!runtimes.has(entry?.layerId)) return;
      closePopups();
      selectLayer(entry.layerId);
    }
  });
  const enqueue = task => {
    const next = queue.then(task);
    queue = next.catch(error => {
      if (error?.name === 'AbortError') return;
      console.error(error); status(error.message); failureDialog.show([{ error }]);
    });
    return next;
  };
  const enqueueAnalysis = task => {
    const finish = processingStatus.begin();
    return enqueue(async () => { try { return await task(); } finally { finish(); } });
  };
  const arcFlowOverlay = createArcFlowOverlayManager(map, { onError: error => status(error.message || 'Không thể dựng Arc Flow 3D.') });
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; sync(); });
  };
  const closePopups = except => { for (const [id, item] of runtimes) if (id !== except) { item.api.closePopup(); item.manager.closePopups(); } };

  function makeRuntime(id, preparsedResults = new Map()) {
    const dom = createLayerDocument(document, id, templates);
    const [panel, metric, legends] = dom.roots;
    panel.className = 'layer-sidebar'; panel.dataset.layerId = id;
    [...panel.children].slice(0, 2).forEach(element => { element.hidden = true; });
    const actions = panel.querySelector('.builder-actions'); if (actions) actions.hidden = true;
    const province = dom.elements.get('province-filter-field'); if (province) panel.insertBefore(province, panel.children[2]);
    const heading = textNode('div', '', 'layer-tabs-heading');
    const layerCount = textNode('span', '', 'map-layer-count');
    const tabs = textNode('div', '', 'map-layer-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Lớp dữ liệu');
    const hint = textNode('p', 'Các lớp cùng hiển thị trên bản đồ; chọn tab để chỉnh cấu hình từng lớp.', 'map-layer-hint');
    const section = dom.elements.get('ai-data-filters'); section.insertBefore(heading, dom.elements.get('ai-filter-controls'));
    heading.append(layerCount, tabs, hint); heading.hidden = true;
    legends.className = 'layer-legends';
    const genericLegend = textNode('div', '', 'point-legend'); genericLegend.hidden = true; legends.append(genericLegend);
    const manager = createMapLayerManager(map, id, { onChange: schedule, onInteract: selectLayer, onPopup: owner => closePopups(owner) });
    metric.dataset.layerId = id;
    const api = createRuntime({ id, document: dom.document, map: manager.map, nativeMap: map, maplibregl: manager.popupLibrary(globalThis.maplibregl), preparsedResults,
      managedWorkspace: true, onStatus: status,
      onMapFailure(error, suggestion) {
        if (runtimes.has(id)) failureDialog.show([{ fileName: api.state.fileName, dataset: api.state.aiDataset, error, suggestion }]);
      },
      arcFlowOverlay, onArcInteract: () => selectLayer(id),
      popupSources: feature => joinedPopupSources(workspace, id, feature),
      popupMetadata() {
        const joins = workspace.attributeJoins.filter(join => join.targetLayerId === id && join.popupContent.imageFields.length);
        return { hasJoinedImages: joins.length > 0, popupSuggestions: joins.flatMap(join => join.popupSuggestions) };
      },
      onChange: schedule, onVisibility(value) {
        const group = activeMapGroup(workspace); if (!group) return;
        group.visible = value;
        for (const key of group.layerIds) {
          runtimes.get(key)?.api.setVisible(value);
          runtimes.get(key)?.manager.setVisible(value);
        }
        if (!value) closePopups();
        schedule();
      }
    });
    api.initialize();
    const item = { id, api, manager, dom, panel, metric, legends, heading, tabs, layerCount, genericLegend, preparsedResults };
    for (const node of [panel, metric, legends]) node.hidden = true;
    return item;
  }

  function selectLayer(id) {
    const group = activeMapGroup(workspace);
    if (!group?.layerIds.includes(id) || group.activeLayerId === id) return;
    group.activeLayerId = id; schedule();
  }

  function saveViewport(group) {
    if (group) {
      group.viewport = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
      group.searchState = { ...search.getState(), regionId: group.regionId || '' };
    }
  }

  function selectGroup(id) {
    const previous = activeMapGroup(workspace);
    if (!workspace.groupsById[id] || workspace.activeGroupId === id) return;
    saveViewport(previous); closePopups();
    workspace.activeGroupId = id;
    sync();
    const group = activeMapGroup(workspace);
    if (group.viewport) map.jumpTo(group.viewport);
    else fitGroup(group);
    templateRenderer.enforceNavigation();
    search.restoreState(group.searchState);
  }

  function fitGroup(group) {
    const extents = group.layerIds.map(id => {
      const item = runtimes.get(id);
      return geometryExtent(filterCountryRegionData(layerData(item.api), item.api.searchData(), group.regionId));
    }).filter(Boolean);
    if (!extents.length) return;
    const bbox = [Math.min(...extents.map(box => box[0])), Math.min(...extents.map(box => box[1])), Math.max(...extents.map(box => box[2])), Math.max(...extents.map(box => box[3]))];
    const camera = group.layerIds.map(id => runtimes.get(id)?.api.getView().camera).find(Boolean);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 75, maxZoom: 12, duration: 0,
      pitch: camera?.pitch || 0, bearing: camera?.bearing || 0 });
  }

  function sync() {
    const group = activeMapGroup(workspace);
    const hasSelection = Boolean(group);
    const searches = (group?.visible ? group.layerIds.filter(id => workspace.layersById[id].visible !== false) : []).map(id => {
      const layer = workspace.layersById[id];
      return { ...runtimes.get(id).api.searchData(), ...(!layer.searchEnabled ? { search_bar: false } : {}),
        layerId: id, groupId: group.id, layerTitle: layer.title };
    });
    search.setData({ layers: searches, groupId: group?.id, regionId: group?.regionId || '' });
    search.setVisible(!templateLoading);
    if (group?.visible) group.regionId = search.getState().regionId;
    empty.hidden = hasSelection;
    groupField.hidden = !group; compositionNote.hidden = !group; actions.hidden = !hasSelection;
    const signature = JSON.stringify(workspace.groupOrder.map(id => [id, workspace.groupsById[id].title, workspace.groupsById[id].layerIds.length]));
    if (signature !== selectedSignature) {
      selector.replaceChildren(...workspace.groupOrder.map(id => {
        const value = workspace.groupsById[id];
        const duplicate = workspace.groupOrder.some(key => key !== id && workspace.groupsById[key].title === value.title);
        const suffix = duplicate ? ` (${runtimes.get(value.layerIds[0]).api.state.fileName || workspace.groupOrder.indexOf(id) + 1})` : '';
        return Object.assign(document.createElement('option'), { value: id, textContent: `${value.title}${suffix}${value.layerIds.length > 1 ? ` · ${value.layerIds.length} lớp` : ''}` });
      }));
      if (!workspace.groupOrder.length) selector.append(Object.assign(document.createElement('option'), { textContent: 'Chưa có bản đồ', value: '' }));
      selectedSignature = signature;
    }
    selector.disabled = !group; selector.value = group?.id || '';
    const visibleIds = new Set(group?.layerIds || []);
    for (const [id, item] of runtimes) {
      const active = group?.activeLayerId === id;
      const isVisible = visibleIds.has(id);
      const config = item.api.searchData();
      const regionId = isVisible ? group.regionId || '' : '';
      const filterKey = JSON.stringify([regionId, config.regionNavigation?.countryField,
        config.columns?.filter(column => column.role === 'geo' && column.geoLevel === 'country').map(column => column.name)]);
      if (item.regionFilterKey !== filterKey) {
        item.regionFilterKey = filterKey;
        item.manager.setDataFilter(regionId ? data => filterCountryRegionData(data, config, regionId) : null);
      }
      item.manager.setInteractive(active && !templateLoading);
      if (isVisible && styleReady && !mounted.has(id)) { item.manager.attach(); mounted.add(id); }
      if (!isVisible && mounted.has(id)) { item.manager.detach(); mounted.delete(id); item.api.closePopup(); }
      item.panel.hidden = !active;
      const groupShown = isVisible && group.visible && workspace.layersById[id].visible !== false;
      const groupVisible = groupShown && !templateLoading;
      item.manager.setVisible(Boolean(groupVisible));
      arcFlowOverlay.setLayerState(id, { attached: isVisible && styleReady, visible: Boolean(groupVisible) });
      // Loading CSS hides controls temporarily. Keep their dataset visibility
      // intact so the renderer can measure the real layout before committing it.
      item.metric.hidden = !groupShown || !item.api.state.aiDataset || !item.dom.elements.get('map-metric-list').children.length;
      // The runtime may hide its metric control when fewer than two AI buttons exist.
      if (item.api.state.aiDataset) {
        const dataset = item.api.state.aiDataset;
        const suggestion = dataset.suggestions.find(option => option.id === dataset.selectedSuggestionId);
        if (item.api.controllers.ui.mapMetricButtons(dataset, suggestion).length < (dataset.metricFieldsConfigured ? 1 : 2)) item.metric.hidden = true;
      }
      item.legends.hidden = !groupShown || workspace.layersById[id].legendVisible === false;
      const otherLegend = [...item.legends.children].some(node => node !== item.genericLegend && node.tagName === 'DIV' && !node.hidden);
      const count = filterCountryRegionData(layerData(item.api), config, regionId)?.features?.length || 0;
      const legendEnabled = item.api.getView().legendVisible;
      item.genericLegend.hidden = !legendEnabled || otherLegend || !count;
      if (!item.genericLegend.hidden) item.genericLegend.textContent = `${workspace.layersById[id]?.title} · ${count.toLocaleString('vi-VN')} đối tượng`;
      const toggle = item.dom.elements.get('show-map-layers'); toggle.checked = group?.visible ?? true;
      item.dom.elements.get('show-map-layers-status').textContent = toggle.checked ? 'Đang bật' : 'Đang tắt';
      if (active) {
        item.heading.hidden = !group || group.layerIds.length < 2;
        // Native geometry layers still need a place for the group tabs.
        if (group) {
          if (group.layerIds.length > 1) item.dom.elements.get('ai-data-filters').hidden = false;
          renderLayerTabs(item, group);
        }
      }
    }
    orderWorkspaceMapLayers(map);
    arcFlowOverlay.refresh();
    const unknown = Object.values(workspace.groupsById).some(value => value.composition?.action === 'undetermined');
    const waiting = Object.values(workspace.layersById).some(layer => layer.sourceKind === 'attribute' && !workspace.attributeJoins.some(join => join.sourceId === layer.id));
    retry.hidden = !(unknown || waiting) || Object.keys(workspace.layersById).length < 2;
    compositionNote.textContent = group?.composition?.reason || (group ? `${group.layerIds.length} lớp dữ liệu trong bản đồ đang hiển thị.` : '');
    const templateLayers = (group?.layerIds || []).map(id => {
      const api = runtimes.get(id)?.api;
      const dataset = api?.state.aiDataset;
      const suggestion = dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
      return suggestion && api.getView().data?.features?.length ? suggestion : null;
    }).filter(Boolean);
    templateRenderer.update({ hasData: templateLayers.length > 0, selectionContext: {
      groupId: group?.id || null, layerCount: templateLayers.length
    }, capabilities: {
      mapTypes: templateLayers.map(item => item.chartType),
      popupTypes: templateLayers.flatMap(item => item.popupSuggestions?.map(popup => popup.name) || [])
    } });
    appearance.apply();
    document.dispatchEvent(new CustomEvent('map-workspace-change', { detail: { groupId: group?.id || null } }));
  }

  function renderLayerTabs(item, group) {
    const key = JSON.stringify([group.id, group.layerIds, group.activeLayerId, group.layerIds.map(id => runtimes.get(id).api.state.mapType)]);
    if (item.tabs.dataset.signature === key) return;
    item.tabs.dataset.signature = key;
    item.layerCount.textContent = `${group.layerIds.length} lớp`;
    item.tabs.replaceChildren(...group.layerIds.map(id => {
      const member = workspace.layersById[id]; const definition = runtimes.get(id).api.getView().definition;
      const duplicateTitle = group.layerIds.some(key => key !== id && workspace.layersById[key].title === member.title);
      const label = `${member.title}${duplicateTitle ? ` · ${runtimes.get(id).api.state.fileName || id}` : ''}`;
      const button = textNode('button', `${definition?.tabIcon || '▧'} ${label}`, 'map-layer-tab');
      button.title = label;
      button.type = 'button'; button.id = `${item.id}-tab-${id}`; button.dataset.layerId = id;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(group.activeLayerId === id));
      button.setAttribute('aria-controls', `${id}--ai-filter-controls`); button.tabIndex = group.activeLayerId === id ? 0 : -1;
      button.addEventListener('click', () => selectLayer(id));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = group.layerIds.indexOf(group.activeLayerId);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? group.layerIds.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + group.layerIds.length) % group.layerIds.length;
        selectLayer(group.layerIds[next]); sync();
        runtimes.get(group.activeLayerId).tabs.querySelector('[aria-selected=true]')?.focus();
      });
      return button;
    }));
    const controls = item.dom.elements.get('ai-filter-controls'); controls.setAttribute('role', 'tabpanel'); controls.setAttribute('aria-label', workspace.layersById[item.id].title);
  }

  function refreshAttributePopups() {
    for (const upload of uploads.values()) {
      const layer = workspace.layersById[upload.layerId];
      if (layer?.sourceKind !== 'attribute') continue;
      const reports = workspace.attributeJoinReports.filter(report => report.sourceId === layer.id);
      const joins = workspace.attributeJoins.filter(join => join.sourceId === layer.id);
      upload.status = joins.length ? 'Đã ghép dữ liệu với bản đồ' : pendingLocationStatus(layer);
      upload.message = `${upload.status} · ` + (reports.length ? reports.map(report => report.stats
        ? `${workspace.layersById[report.targetLayerId]?.title}: ${report.stats.matchedObjects} đối tượng khớp, ${report.stats.unmatchedObjects} chưa khớp; ${report.stats.matchedRows} dòng khớp, ${report.stats.unmatchedRows} chưa khớp${report.stats.ambiguousRows ? ` (${report.stats.ambiguousRows} khóa mơ hồ)` : ''}. ${report.reason}`
        : report.reason).join(' · ') : pendingLocationReason(layer));
    }
    for (const item of runtimes.values()) item.api.refreshPopupMetadata();
    renderUploads();
  }

  function renderUploads() {
    const list = $('uploaded-layer-list'); list.replaceChildren();
    for (const [id, upload] of uploads) {
      const row = document.createElement('li'); const name = textNode('span', upload.file.name); name.title = upload.file.name;
      const report = workspace.layersById[upload.layerId]?.runtime?.state?.aiDataset?.analysis?.pointGeocoding;
      const lookup = report ? `${report.reason && !report.matched ? `Tra tọa độ chưa hoàn tất (${report.total} địa chỉ)`
        : `Định vị được ${report.matched}/${report.total} địa chỉ${report.unmatched ? `; ${report.unmatched} chưa khớp` : ''}`}${report.googleMapsMatched ? `; Google Maps bổ sung ${report.googleMapsMatched}` : ''}${report.approximate ? `; ${report.approximate} vị trí ước tính` : ''}${report.truncated ? ' (mẫu có giới hạn)' : ''}${report.reason ? ` · ${report.reason}` : ''}` : '';
      const detail = textNode('em', [upload.message || upload.status, lookup].filter(Boolean).join(' · '));
      detail.title = detail.textContent;
      const remove = textNode('button', '×', 'remove-uploaded-layer'); remove.type = 'button'; remove.setAttribute('aria-label', `Xóa ${upload.file.name}`);
      remove.addEventListener('click', () => removeUpload(id)); row.append(name, detail, remove);
      if (upload.sheets) {
        const label = textNode('label', 'Chọn bảng (sheet) để phân tích'); label.className = 'upload-sheet-label'; label.htmlFor = `upload-sheet-${id}`;
        const select = keepSelectOpenAfterMouseClick(document.createElement('select')); select.id = label.htmlFor;
        select.setAttribute('aria-label', `Chọn bảng (sheet) cho ${upload.file.name}`);
        select.append(Object.assign(document.createElement('option'), { textContent: 'Chọn bảng dữ liệu…', value: '' }));
        select.append(...upload.sheets.map(sheet => Object.assign(document.createElement('option'), { textContent: sheet, value: sheet, title: sheet })));
        select.value = upload.selectedSheet || ''; select.title = select.value; select.disabled = upload.processing === true;
        const apply = textNode('button', upload.processing ? 'Đang phân tích...' : 'Phân tích bảng đã chọn', 'secondary-button'); apply.type = 'button';
        apply.disabled = upload.processing === true || !select.value;
        select.addEventListener('change', () => { upload.selectedSheet = select.value; select.title = select.value; apply.disabled = !select.value; });
        apply.addEventListener('click', () => {
          const sheetName = upload.selectedSheet;
          if (upload.processing || !upload.sheets.includes(sheetName)) return;
          upload.processing = true;
          upload.status = `Đang phân tích bảng ${sheetName}`; upload.message = '';
          renderUploads();
          enqueueAnalysis(() => processUploads([{ id, upload, sheetName }]));
        });
        const field = textNode('div', '', 'upload-sheet-choice'); field.append(label, select, apply); row.append(field);
      }
      list.append(row);
    }
    $('selected-file').hidden = !uploads.size; $('remove-current-file').hidden = true;
    $('file-name').textContent = `${uploads.size} tệp dữ liệu`; $('file-note').textContent = 'Mỗi dữ liệu giữ cấu hình độc lập';
  }

  async function readUpload(upload, sheetName) {
    const dom = createLayerDocument(document, `parser-${upload.id}`, templates);
    const parser = createRuntime({ document: dom.document, onStatus: status });
    parser.setSamples($('ai-include-samples').checked);
    try {
      const result = await parser.readSpatialFile(upload.file, { sheetName, signal: upload.controller.signal });
      return result;
    }
    finally { parser.dispose(); dom.dispose(); }
  }

  async function processUploads(entries) {
    // A bounded worker pool avoids opening every workbook and AI request at once.
    const results = new Array(entries.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
      while (next < entries.length) {
        const index = next++; const entry = entries[index];
        if (!uploads.has(entry.id)) continue;
        entry.upload.processing = true;
        entry.upload.status = entry.sheetName ? `Đang phân tích bảng ${entry.sheetName}` : 'Đang đọc dữ liệu';
        entry.upload.message = ''; renderUploads();
        try { results[index] = { ...entry, result: await readUpload(entry.upload, entry.sheetName) }; }
        catch (error) { results[index] = { ...entry, error }; }
      }
    }));
    const readyEntries = [];
    const failures = [];
    for (const entry of results.filter(Boolean)) {
      const { id, upload, result, error } = entry;
      if (!uploads.has(id)) continue;
      if (error) {
        upload.processing = false;
        upload.status = 'Lỗi'; upload.message = error.message || 'Không thể đọc file'; keys.delete(upload.key);
        if (error.name !== 'AbortError') failures.push({ fileName: upload.file.name, error, stage: 'read' });
        renderUploads(); continue;
      }
      if (result.kind === 'sheet-selection') {
        upload.processing = false;
        upload.status = `${result.sheetNames.length} bảng · Chờ chọn bảng cần phân tích`;
        upload.sheets = result.sheetNames;
        if (!upload.sheets.includes(upload.selectedSheet)) upload.selectedSheet = '';
        renderUploads(); continue;
      }
      readyEntries.push(entry);
    }
    // Choosing a workbook sheet does not depend on the basemap being available.
    if (readyEntries.length) await ready;
    const newIds = [];
    for (const { id, upload, result } of readyEntries) {
      if (!uploads.has(id)) continue;
      let item;
      try {
        const runtimeId = `layer-${workspace.sequence + 1}`;
        item = makeRuntime(runtimeId, new Map([[upload.file, result]]));
        item.api.state.fileName = upload.file.name;
        await item.api.load(result, upload.file);
        if (!uploads.has(id)) { item.api.dispose(); item.manager.dispose(); item.dom.dispose(); continue; }
        const state = item.api.state;
        state.spatialAnalysis = result.spatialAnalysis || null;
        const analysis = state.aiDataset?.analysis || result.spatialAnalysis;
        const title = analysis?.source === 'ai' && analysis.datasetTitle ? analysis.datasetTitle : upload.file.name.replace(/\.[^.]+$/, '');
        const layer = addWorkspaceLayer(workspace, { dataset: state.aiDataset || result, runtime: item.api, title, fileKey: upload.key,
          descriptor: describeWorkspaceLayer(runtimeId, item.api, title) });
        runtimes.set(layer.id, item);
        sidebars.append(item.panel); metrics.append(item.metric); legendOriginal.append(item.legends);
        upload.processing = false; upload.sheets = null;
        upload.layerId = layer.id; upload.status = layer.sourceKind === 'attribute' ? pendingLocationStatus(layer) : state.mapType ? 'Sẵn sàng' : 'Chưa có bản đồ';
        upload.message = layer.sourceKind === 'attribute' ? `${upload.status} · ${pendingLocationReason(layer)}`
          : state.aiDataset?.fallbackReason || (state.mapType ? title : 'AI chưa đề xuất được bản đồ khả dụng.');
        newIds.push(layer.id);
      } catch (error) {
        upload.processing = false;
        item?.api.dispose(); item?.manager.dispose(); item?.dom.dispose();
        keys.delete(upload.key);
        upload.status = 'Lỗi'; upload.message = error.message || 'Không thể dựng bản đồ';
        if (uploads.has(id) && error.name !== 'AbortError') failures.push({ fileName: upload.file.name, error,
          dataset: item?.api.state.aiDataset });
      }
      renderUploads();
    }
    const pendingIds = newIds.filter(id => workspace.layersById[id]);
    for (const id of pendingIds) {
      const layer = workspace.layersById[id]; layer.descriptor = describeWorkspaceLayer(id, runtimes.get(id).api, layer.title);
    }
    if (pendingIds.length) await compose(pendingIds);
    // Attribute-only files may become usable after joining an existing map.
    // Report once per completed import, never from the recurring UI sync.
    for (const id of pendingIds) {
      const layer = workspace.layersById[id];
      if (!layer || workspace.attributeJoins.some(join => join.sourceId === id)) continue;
      if (describeWorkspaceLayer(id, layer.runtime, layer.title).available) continue;
      const upload = [...uploads.values()].find(upload => upload.layerId === id);
      if (upload) failures.push({ fileName: upload.file.name, dataset: layer.runtime.state.aiDataset });
    }
    failureDialog.show(failures);
    sync();
    const waitingForSheet = [...uploads.values()].some(upload => upload.sheets && !upload.processing);
    status(waitingForSheet ? 'Hãy chọn bảng (sheet) cần phân tích trong từng file Excel rồi bấm Phân tích bảng đã chọn.'
      : uploads.size ? '' : 'Đã xóa dữ liệu.');
  }

  async function compose(newIds) {
    newIds = newIds.filter(id => workspace.layersById[id]);
    if (!newIds.length) return;
    const previous = workspace.activeGroupId;
    if (Object.keys(workspace.layersById).length === 1 || Object.values(workspace.layersById).every(layer => layer.sourceKind === 'attribute')) {
      for (const id of newIds) if (workspace.layersById[id].sourceKind !== 'attribute') createWorkspaceGroup(workspace, [id], workspace.layersById[id].title);
    } else {
      status('AI đang đánh giá hiển thị chung và liên kết thuộc tính...');
      const revision = workspace.revision;
      const input = { workspaceRevision: revision, activeGroupId: workspace.activeGroupId, newLayerIds: newIds,
        layers: Object.values(workspace.layersById).map(layer => {
          layer.descriptor = describeWorkspaceLayer(layer.id, runtimes.get(layer.id).api, layer.title);
          return layer.descriptor;
        }),
        groups: workspace.groupOrder.map(id => ({ id, title: workspace.groupsById[id].title, layerIds: workspace.groupsById[id].layerIds })) };
      compositionController?.abort(); compositionController = new AbortController();
      let result;
      try { result = await requestComposition(input, { signal: compositionController.signal }); }
      catch (error) {
        if (error.name !== 'AbortError') result = fallbackComposition(input, `Chưa xác định khả năng kết hợp: ${error.message}. Dữ liệu được giữ thành bản đồ riêng.`);
      }
      for (const decision of result?.decisions || []) {
        if (workspace.layersById[decision.layerId]?.sourceKind === 'attribute' && workspace.revision === revision) workspace.layersById[decision.layerId].attributeReason = decision.reason;
      }
      if (!result || !applyWorkspaceComposition(workspace, result, newIds, revision)) {
        const remaining = newIds.filter(id => workspace.layersById[id] && !Object.values(workspace.groupsById).some(group => group.layerIds.includes(id)));
        if (remaining.length) return compose(remaining);
      }
    }
    refreshAttributePopups(); sync();
    if (!previous && activeMapGroup(workspace)) fitGroup(activeMapGroup(workspace));
  }

  async function importFiles(files) {
    const entries = [];
    for (const original of files) {
      let datasets;
      try { datasets = await expandJsonUpload(original); }
      catch { datasets = [original]; } // The normal reader reports malformed input per upload.
      for (const file of datasets) {
        const key = fileKey(file);
        if (keys.has(key)) { status(`Đã bỏ qua file trùng: ${file.name}`); continue; }
        keys.add(key);
        const id = `import-${++uploadSequence}`;
        const upload = { id, file, key, controller: new AbortController(), status: 'Đang chờ' };
        uploads.set(id, upload); workspace.importsById[id] = upload; entries.push({ id, upload });
      }
    }
    renderUploads(); if (entries.length) enqueueAnalysis(() => processUploads(entries));
  }

  async function removeUpload(id) {
    const upload = uploads.get(id); if (!upload) return;
    const previousGroup = workspace.activeGroupId;
    upload.controller.abort(); uploads.delete(id); delete workspace.importsById[id]; keys.delete(upload.key);
    if (upload.layerId) {
      const item = runtimes.get(upload.layerId);
      item.api.dispose(); item.manager.dispose(); item.dom.dispose();
      runtimes.delete(upload.layerId); mounted.delete(upload.layerId); removeWorkspaceLayer(workspace, upload.layerId);
    }
    refreshAttributePopups(); renderUploads(); sync();
    if (!Object.keys(workspace.layersById).length) compositionController?.abort();
    if (workspace.activeGroupId !== previousGroup && activeMapGroup(workspace)) {
      const group = activeMapGroup(workspace);
      if (group.viewport) map.jumpTo(group.viewport); else fitGroup(group);
      search.restoreState(group.searchState);
    }
  }

  selector.addEventListener('change', () => selectGroup(selector.value));
  metrics.addEventListener('click', event => {
    if (event.target.closest('.map-metric-button')) selectLayer(event.target.closest('[data-layer-id]').dataset.layerId);
  });
  retry.addEventListener('click', () => enqueue(async () => {
    const ids = workspace.groupOrder.flatMap(id => {
      const group = workspace.groupsById[id];
      if (group.composition?.action !== 'undetermined') return [];
      delete workspace.groupsById[id]; return group.layerIds;
    });
    workspace.groupOrder = workspace.groupOrder.filter(id => workspace.groupsById[id]);
    if (!workspace.groupsById[workspace.activeGroupId]) workspace.activeGroupId = workspace.groupOrder[0] || null;
    ids.push(...Object.values(workspace.layersById).filter(layer => layer.sourceKind === 'attribute').map(layer => layer.id));
    workspace.revision++; await compose([...new Set(ids)]); sync();
  }));
  $('spatial-file').addEventListener('change', event => { importFiles([...event.target.files]); event.target.value = ''; });
  const dropZone = document.querySelector('.drop-zone');
  for (const type of ['dragover', 'dragenter']) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('drag-over'); importFiles([...event.dataTransfer.files]); });
  document.querySelectorAll('.tabs .tab').forEach(tab => tab.addEventListener('click', () => {
    sidebar.querySelectorAll(':scope > section > .tabs .tab, :scope > section > .tab-panel').forEach(node => node.classList.remove('active'));
    tab.classList.add('active'); sidebar.querySelector(`:scope > section > [data-panel="${tab.dataset.tab}"]`)?.classList.add('active');
  }));
  $('apply-coordinates').addEventListener('click', () => {
    try {
      const value = $('coordinate-input').value.trim(); let data;
      if (value.startsWith('{')) data = JSON.parse(value);
      else {
        const coordinates = value.split(/\n/).map(line => line.split(',').map(Number));
        if (coordinates.length < 3 || coordinates.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) throw new Error('Cần ít nhất ba dòng lng,lat hợp lệ.');
        coordinates.push(coordinates[0]); data = { type: 'Polygon', coordinates: [coordinates] };
      }
      importFiles([new File([JSON.stringify(data)], `Tọa độ nhập ${++uploadSequence}.geojson`, { type: 'application/geo+json' })]);
    } catch (error) { status(error.message); }
  });
  $('clear-data').addEventListener('click', async () => { for (const id of [...uploads.keys()]) await removeUpload(id); status('Đã xóa dữ liệu.'); });
  $('reset-config').addEventListener('click', () => {
    const item = runtimes.get(activeMapGroup(workspace)?.activeLayerId);
    item?.dom.elements.get('reset-config').click();
  });
  $('basemap-options').addEventListener('click', event => {
    const option = event.target.closest('.basemap-option'); if (!option || !styles[option.dataset.mapStyle]) return;
    if (styleReady && currentStyle === option.dataset.mapStyle) return;
    currentStyle = option.dataset.mapStyle; styleReady = false; basemapFailureShown = false;
    arcFlowOverlay.setStyleReady(false); map.setStyle(styles[currentStyle], { diff: false });
    document.querySelectorAll('.basemap-option').forEach(button => { button.classList.toggle('active', button.dataset.mapStyle === currentStyle); button.setAttribute('aria-pressed', String(button.dataset.mapStyle === currentStyle)); });
    $('basemap-selection').replaceChildren(document.createTextNode('Nền đang dùng: '), textNode('b', styleLabels[currentStyle]));
    $('map4d-attribution').hidden = currentStyle !== 'map4d'; $('satellite-attribution').hidden = currentStyle !== 'satellite'; $('vector-attribution').hidden = ['map4d', 'satellite'].includes(currentStyle);
  });
  $('zoom-in').addEventListener('click', () => map.zoomIn()); $('zoom-out').addEventListener('click', () => map.zoomOut());
  $('fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector('.map-panel').requestFullscreen());
  const compass = $('map-compass');
  const updateCompass = () => { compass.querySelector('.compass-icon').style.transform = `rotate(${-map.getBearing()}deg)`; };
  compass.addEventListener('click', () => map.easeTo({ bearing: 0, duration: 300 }));
  map.on('rotate', updateCompass);
  updateCompass();
  map.on('style.load', () => { styleReady = true; mounted.clear(); readyResolve(); sync(); arcFlowOverlay.setStyleReady(true); search.refreshHighlight(); });
  map.on('remove', () => { arcFlowOverlay.dispose(); appearance.dispose(); failureDialog.dispose(); });
  map.on('error', event => {
    console.warn('MapLibre:', event.error?.message);
    if (!styleReady) {
      status('Chưa tải được nền bản đồ. Bạn có thể chọn nền khác để thử lại.');
      if (!basemapFailureShown) {
        basemapFailureShown = true;
        failureDialog.show([{ stage: 'basemap' }]);
      }
    }
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { map.resize(); for (const item of runtimes.values()) item.api.resizePopup(); }).observe($('map'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) map.resize(); });
  sync();
  const aiEditor = createAiMapEditor({ workspace, runtimes, templatePicker, appearance, isLoading: () => templateLoading || !styleReady || [...uploads.values()].some(upload => upload.processing),
    sync, closePopups });
  return { workspace, map, importFiles, selectGroup, selectLayer, removeUpload, aiEditor };
}

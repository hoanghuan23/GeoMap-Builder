import { createMapWorkspace, activeMapGroup, addWorkspaceLayer, createWorkspaceGroup, applyWorkspaceComposition, removeWorkspaceLayer } from './map-workspace.js';
import { createCompositionClient } from './map-composition.js';
import { fallbackComposition } from './map-composition-contract.js';
import { createMapLayerManager, orderWorkspaceMapLayers } from './map-layer-manager.js';
import { createLayerDocument } from './map-layer-document.js';
import { describeWorkspaceLayer, geometryExtent, layerData, tableRecords, csvForRecords } from './map-layer-data.js';
import { createMapSearch } from './map-search.js';
import { CONFIG } from './config.js';
import { expandJsonUpload } from './json-datasets.js';

const fileKey = file => file.datasetKey || `${file.name}:${file.size}:${file.lastModified}`;
const textNode = (tag, text, className) => Object.assign(document.createElement(tag), { textContent: text, ...(className ? { className } : {}) });

export async function startMapWorkspace(createRuntime, { styles, styleLabels, renderCatalog }) {
  const workspace = createMapWorkspace();
  const uploads = new Map(); const keys = new Set(); const runtimes = new Map();
  const requestComposition = createCompositionClient();
  const $ = id => document.getElementById(id);
  const sidebar = document.querySelector('.sidebar');
  const metricOriginal = $('map-metric-control');
  const legendOriginal = document.querySelector('.map-legends');
  const tableOriginal = $('data-panel');
  const templates = [sidebar.cloneNode(true), metricOriginal.cloneNode(true), legendOriginal.cloneNode(true), tableOriginal.cloneNode(true), $('chart-canvas').cloneNode(true)];
  const empty = $('map-type-grid').closest('.panel-section');
  const sidebars = textNode('div', '', 'layer-sidebars');
  const actions = sidebar.querySelector('.builder-actions');
  actions.hidden = true; sidebar.append(actions);
  const configSections = [...sidebar.children].slice(2).filter(element => !element.classList.contains('builder-actions'));
  configSections.forEach(element => element.remove());
  sidebar.insertBefore(sidebars, actions);
  sidebars.append(empty); renderCatalog(document);
  const metrics = textNode('div', '', 'workspace-metrics'); metricOriginal.replaceWith(metrics);
  legendOriginal.replaceChildren();
  const tables = textNode('div', '', 'workspace-tables'); tableOriginal.replaceWith(tables);
  const selector = document.createElement('select'); selector.id = 'displayed-map'; selector.disabled = true;
  selector.setAttribute('aria-label', 'Bản đồ đang hiển thị');
  const groupField = textNode('label', '', 'field map-group-field');
  groupField.hidden = true;
  groupField.append(textNode('span', 'Bản đồ đang hiển thị'), selector);
  const compositionNote = textNode('p', '', 'composition-note'); compositionNote.setAttribute('role', 'status');
  compositionNote.hidden = true;
  const retry = textNode('button', 'Thử đánh giá kết hợp lại', 'secondary-button'); retry.type = 'button'; retry.hidden = true;
  const showTable = textNode('button', 'Xem dữ liệu lớp đang chọn', 'secondary-button'); showTable.type = 'button'; showTable.disabled = true; showTable.hidden = true;
  sidebar.children[1].append(groupField, compositionNote, retry, showTable);
  $('sheet-selector-field').hidden = true;
  document.querySelector('.drop-zone small').textContent = 'CSV, Excel, JSON, GeoJSON · AI đánh giá hiển thị nhiều lớp';
  const map = new globalThis.maplibregl.Map({ container: 'map', style: styles.map4d, center: [108.2, 16.2], zoom: 4.7, attributionControl: false });
  let readyResolve; const ready = new Promise(resolve => { readyResolve = resolve; });
  let uploadSequence = 0; let scheduled = false; let tableShown = false; let queue = Promise.resolve();
  let selectedSignature = ''; let compositionController; let currentStyle = 'map4d'; let statusTimer; let styleReady = false;
  const mounted = new Set();
  const search = createMapSearch({ map, minFilteredObjects: CONFIG.DATA_SEARCH_MIN_FILTERED_OBJECTS,
    onSelect(_feature, _center, entry) {
      if (!runtimes.has(entry?.layerId)) return;
      closePopups();
      selectLayer(entry.layerId);
    }
  });
  const status = (message, hide = false) => {
    clearTimeout(statusTimer); $('status').textContent = message; $('status').hidden = !message;
    if (hide) statusTimer = setTimeout(() => { $('status').hidden = true; }, 3500);
  };
  const enqueue = task => { const next = queue.then(task); queue = next.catch(error => { console.error(error); status(error.message); }); return next; };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; sync(); });
  };
  const closePopups = except => { for (const [id, item] of runtimes) if (id !== except) { item.api.closePopup(); item.manager.closePopups(); } };

  function makeRuntime(id, preparsedResults = new Map()) {
    const dom = createLayerDocument(document, id, templates);
    const [panel, metric, legends, table, chart] = dom.roots;
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
    const metricHeading = textNode('b', '', 'layer-overlay-title'); metric.prepend(metricHeading);
    const legendHeading = textNode('b', '', 'layer-overlay-title'); legends.prepend(legendHeading); legends.className = 'layer-legends';
    const genericLegend = textNode('div', '', 'point-legend'); genericLegend.hidden = true; legends.append(genericLegend);
    const manager = createMapLayerManager(map, id, { onChange: schedule, onInteract: selectLayer, onPopup: owner => closePopups(owner) });
    metric.dataset.layerId = id;
    const api = createRuntime({ id, document: dom.document, map: manager.map, nativeMap: map, maplibregl: manager.popupLibrary(globalThis.maplibregl), preparsedResults,
      managedWorkspace: true, onStatus: status,
      onChange: schedule, onVisibility(value) {
        const group = activeMapGroup(workspace); if (!group) return;
        group.visible = value;
        for (const key of group.layerIds) {
          runtimes.get(key)?.api.setVisible(value);
          runtimes.get(key)?.manager.setVisible(value);
        }
        if (!value) closePopups();
        schedule();
      },
      renderTable() { schedule(); return true; },
      exportData(state) { downloadRecords(state, workspace.layersById[id]?.title || 'Dữ liệu'); return true; }
    });
    api.initialize();
    const item = { id, api, manager, dom, panel, metric, legends, table, chart, heading, tabs, layerCount, metricHeading, legendHeading, genericLegend, tableSnapshot: null, preparsedResults };
    for (const node of [panel, metric, legends, table, chart]) node.hidden = true;
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
      group.searchState = search.getState();
    }
  }

  function selectGroup(id) {
    const previous = activeMapGroup(workspace);
    if (!workspace.groupsById[id] || workspace.activeGroupId === id) return;
    saveViewport(previous); closePopups();
    workspace.activeGroupId = id; tableShown = false;
    sync();
    const group = activeMapGroup(workspace);
    if (group.viewport) map.jumpTo(group.viewport);
    else fitGroup(group);
    search.restoreState(group.searchState);
  }

  function fitGroup(group) {
    const extents = group.layerIds.map(id => geometryExtent(layerData(runtimes.get(id).api.state))).filter(Boolean);
    if (!extents.length) return;
    const bbox = [Math.min(...extents.map(box => box[0])), Math.min(...extents.map(box => box[1])), Math.max(...extents.map(box => box[2])), Math.max(...extents.map(box => box[3]))];
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 55, maxZoom: 12, duration: 0 });
  }

  function sync() {
    const group = activeMapGroup(workspace);
    empty.hidden = Boolean(group);
    groupField.hidden = !group; compositionNote.hidden = !group; actions.hidden = !group;
    showTable.hidden = !group; showTable.disabled = !group;
    if (!group) { tableShown = false; showTable.textContent = 'Xem dữ liệu lớp đang chọn'; }
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
      item.manager.setInteractive(active);
      if (isVisible && styleReady && !mounted.has(id)) { item.manager.attach(); mounted.add(id); }
      if (!isVisible && mounted.has(id)) { item.manager.detach(); mounted.delete(id); item.api.closePopup(); }
      item.panel.hidden = !active;
      const groupVisible = isVisible && group.visible;
      item.manager.setVisible(Boolean(groupVisible));
      item.metric.hidden = !groupVisible || !item.api.state.aiDataset || !item.dom.elements.get('map-metric-list').children.length;
      // The runtime may hide its metric control when fewer than two AI buttons exist.
      if (item.api.state.aiDataset) {
        const dataset = item.api.state.aiDataset;
        const suggestion = dataset.suggestions.find(option => option.id === dataset.selectedSuggestionId);
        if ((suggestion?.metricButtons?.length || 0) < 2) item.metric.hidden = true;
      }
      item.legends.hidden = !groupVisible;
      item.metricHeading.hidden = (group?.layerIds.length || 0) < 2;
      item.legendHeading.hidden = (group?.layerIds.length || 0) < 2;
      item.metricHeading.textContent = workspace.layersById[id]?.title || '';
      item.legendHeading.textContent = workspace.layersById[id]?.title || '';
      const otherLegend = [...item.legends.children].some(node => node !== item.genericLegend && node.tagName === 'DIV' && !node.hidden);
      const count = layerData(item.api.state)?.features?.length || 0;
      item.genericLegend.hidden = otherLegend || !count;
      if (!item.genericLegend.hidden) item.genericLegend.textContent = `${workspace.layersById[id]?.title} · ${count.toLocaleString('vi-VN')} đối tượng`;
      item.chart.hidden = true;
      item.table.hidden = !active || !tableShown;
      const toggle = item.dom.elements.get('show-map-layers'); toggle.checked = group?.visible ?? true;
      item.dom.elements.get('show-map-layers-status').textContent = toggle.checked ? 'Đang bật' : 'Đang tắt';
      if (active) {
        item.heading.hidden = group.layerIds.length < 2;
        // Native geometry layers still need a place for the group tabs.
        if (group.layerIds.length > 1) item.dom.elements.get('ai-data-filters').hidden = false;
        renderLayerTabs(item, group);
        if (tableShown) renderTable(item, workspace.layersById[id].title);
      }
    }
    document.querySelector('.content-area').classList.toggle('table-hidden', !tableShown || !group);
    orderWorkspaceMapLayers(map);
    const searches = (group?.visible ? group.layerIds : []).flatMap(id => {
      const layer = workspace.layersById[id]; if (!layer.searchEnabled) return [];
      return [{ ...runtimes.get(id).api.searchData(), layerId: id, groupId: group.id, layerTitle: layer.title }];
    });
    search.setData({ layers: searches, groupId: group?.id });
    const unknown = Object.values(workspace.groupsById).some(value => value.composition?.action === 'undetermined');
    retry.hidden = !unknown || Object.keys(workspace.layersById).length < 2;
    compositionNote.textContent = group?.composition?.reason || (group ? `${group.layerIds.length} lớp dữ liệu trong bản đồ đang hiển thị.` : '');
  }

  function renderLayerTabs(item, group) {
    const key = JSON.stringify([group.id, group.layerIds, group.activeLayerId, group.layerIds.map(id => runtimes.get(id).api.state.mapType)]);
    if (item.tabs.dataset.signature === key) return;
    item.tabs.dataset.signature = key;
    item.layerCount.textContent = `${group.layerIds.length} lớp`;
    item.tabs.replaceChildren(...group.layerIds.map(id => {
      const member = workspace.layersById[id]; const type = runtimes.get(id).api.state.mapType;
      const duplicateTitle = group.layerIds.some(key => key !== id && workspace.layersById[key].title === member.title);
      const label = `${member.title}${duplicateTitle ? ` · ${runtimes.get(id).api.state.fileName || id}` : ''}`;
      const button = textNode('button', `${type === 'point' ? '●' : type === 'line' ? '╱' : '▧'} ${label}`, 'map-layer-tab');
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

  function renderTable(item, title) {
    const state = item.api.state; const data = layerData(state);
    const signature = [data, state.page, state.pageSize, state.query];
    if (item.tableSnapshot && item.tableSnapshot.every((value, index) => signature[index] === value)) return;
    const all = tableRecords(state); const query = state.query.trim().toLocaleLowerCase('vi');
    const filtered = query ? all.filter(record => Object.values(record).some(value => String(value ?? '').toLocaleLowerCase('vi').includes(query))) : all;
    const columns = [...new Set(all.flatMap(record => Object.keys(record).filter(key => !key.startsWith('__'))))];
    const el = name => item.dom.elements.get(name);
    state.page = Math.max(1, Math.min(state.page, Math.ceil(filtered.length / state.pageSize) || 1));
    const start = (state.page - 1) * state.pageSize;
    el('table-title').textContent = title; el('table-search').placeholder = 'Tìm trong dữ liệu lớp...';
    const head = document.createElement('tr'); head.append(textNode('th', '#'), ...columns.map(column => textNode('th', column)));
    el('data-head').replaceChildren(head);
    el('data-body').replaceChildren(...filtered.slice(start, start + state.pageSize).map((record, index) => {
      const row = document.createElement('tr'); row.append(textNode('td', String(start + index + 1)), ...columns.map(column => textNode('td', record[column] == null ? '' : typeof record[column] === 'object' ? JSON.stringify(record[column]) : String(record[column])))); return row;
    }));
    el('table-summary').textContent = `${filtered.length.toLocaleString('vi-VN')} / ${all.length.toLocaleString('vi-VN')} bản ghi`;
    el('pagination-info').textContent = `${filtered.length ? start + 1 : 0}–${Math.min(start + state.pageSize, filtered.length)} của ${filtered.length}`;
    el('prev-page').disabled = state.page <= 1; el('next-page').disabled = start + state.pageSize >= filtered.length;
    el('page-buttons').replaceChildren(textNode('span', String(state.page)));
    item.tableSnapshot = [data, state.page, state.pageSize, state.query];
  }

  function downloadRecords(state, title) {
    const records = tableRecords(state); const query = state.query.trim().toLocaleLowerCase('vi');
    const filtered = query ? records.filter(record => Object.values(record).some(value => String(value ?? '').toLocaleLowerCase('vi').includes(query))) : records;
    const url = URL.createObjectURL(new Blob([csvForRecords(filtered)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${title.replace(/[<>:"/\\|?*]/g, '_')}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderUploads() {
    const list = $('uploaded-layer-list'); list.replaceChildren();
    for (const [id, upload] of uploads) {
      const row = document.createElement('li'); const name = textNode('span', upload.file.name); name.title = upload.file.name;
      const detail = textNode('em', upload.message || upload.status);
      const remove = textNode('button', '×', 'remove-uploaded-layer'); remove.type = 'button'; remove.setAttribute('aria-label', `Xóa ${upload.file.name}`);
      remove.addEventListener('click', () => removeUpload(id)); row.append(name, detail, remove);
      if (upload.sheets) {
        const select = document.createElement('select'); select.setAttribute('aria-label', `Chọn sheet cho ${upload.file.name}`);
        select.append(...upload.sheets.map(sheet => Object.assign(document.createElement('option'), { textContent: sheet, value: sheet })));
        const apply = textNode('button', 'Phân tích sheet', 'secondary-button'); apply.type = 'button';
        apply.addEventListener('click', () => { apply.disabled = true; enqueue(() => processUploads([{ id, upload, sheetName: select.value }])); });
        const field = textNode('div', '', 'upload-sheet-choice'); field.append(select, apply); row.append(field);
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
    await ready;
    // A bounded worker pool avoids opening every workbook and AI request at once.
    const results = new Array(entries.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, entries.length) }, async () => {
      while (next < entries.length) {
        const index = next++; const entry = entries[index];
        if (!uploads.has(entry.id)) continue;
        entry.upload.status = 'Đang phân tích'; entry.upload.message = ''; entry.upload.sheets = null; renderUploads();
        try { results[index] = { ...entry, result: await readUpload(entry.upload, entry.sheetName) }; }
        catch (error) { results[index] = { ...entry, error }; }
      }
    }));
    const newIds = [];
    for (const entry of results.filter(Boolean)) {
      const { id, upload, result, error } = entry;
      if (!uploads.has(id)) continue;
      if (error) {
        upload.status = 'Lỗi'; upload.message = error.message || 'Không thể đọc file'; keys.delete(upload.key); renderUploads(); continue;
      }
      if (result.kind === 'sheet-selection') { upload.status = 'Chờ chọn sheet'; upload.sheets = result.sheetNames; renderUploads(); continue; }
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
          descriptor: describeWorkspaceLayer(runtimeId, state, title) });
        runtimes.set(layer.id, item);
        sidebars.append(item.panel); metrics.append(item.metric); legendOriginal.append(item.legends); tables.append(item.table);
        document.querySelector('.map-panel').append(item.chart);
        upload.layerId = layer.id; upload.status = state.mapType ? 'Sẵn sàng' : 'Chưa có bản đồ';
        upload.message = state.aiDataset?.fallbackReason || (state.mapType ? title : 'AI chưa đề xuất được bản đồ khả dụng.');
        newIds.push(layer.id);
      } catch (error) {
        item?.api.dispose(); item?.manager.dispose(); item?.dom.dispose();
        keys.delete(upload.key);
        upload.status = 'Lỗi'; upload.message = error.message || 'Không thể dựng bản đồ';
      }
      renderUploads();
    }
    const pendingIds = newIds.filter(id => workspace.layersById[id]);
    for (const id of pendingIds) {
      const layer = workspace.layersById[id]; layer.descriptor = describeWorkspaceLayer(id, runtimes.get(id).api.state, layer.title);
    }
    if (pendingIds.length) await compose(pendingIds);
    sync();
    const addedCount = pendingIds.filter(id => workspace.layersById[id]).length;
    status(addedCount ? `Đã thêm ${addedCount} lớp dữ liệu. Chọn bản đồ hoặc tab để chỉnh cấu hình.` : uploads.size ? 'Đã xử lý các file. Kiểm tra trạng thái từng file trong danh sách.' : 'Đã xóa dữ liệu.');
  }

  async function compose(newIds) {
    newIds = newIds.filter(id => workspace.layersById[id]);
    if (!newIds.length) return;
    const previous = workspace.activeGroupId;
    if (Object.keys(workspace.layersById).length === 1) {
      createWorkspaceGroup(workspace, newIds, workspace.layersById[newIds[0]].title);
    } else {
      status('AI đang đánh giá khả năng hiển thị các lớp cùng nhau...');
      const revision = workspace.revision;
      const input = { workspaceRevision: revision, activeGroupId: workspace.activeGroupId, newLayerIds: newIds,
        layers: Object.values(workspace.layersById).map(layer => describeWorkspaceLayer(layer.id, runtimes.get(layer.id).api.state, layer.title)),
        groups: workspace.groupOrder.map(id => ({ id, title: workspace.groupsById[id].title, layerIds: workspace.groupsById[id].layerIds })) };
      compositionController?.abort(); compositionController = new AbortController();
      let result;
      try { result = await requestComposition(input, { signal: compositionController.signal }); }
      catch (error) {
        if (error.name !== 'AbortError') result = fallbackComposition(input, `Chưa xác định khả năng kết hợp: ${error.message}. Dữ liệu được giữ thành bản đồ riêng.`);
      }
      if (!result || !applyWorkspaceComposition(workspace, result, newIds, revision)) {
        const remaining = newIds.filter(id => workspace.layersById[id] && !Object.values(workspace.groupsById).some(group => group.layerIds.includes(id)));
        if (remaining.length) return compose(remaining);
      }
    }
    sync();
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
    renderUploads(); if (entries.length) enqueue(() => processUploads(entries));
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
    renderUploads(); sync();
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
  showTable.addEventListener('click', () => { tableShown = !tableShown; showTable.textContent = tableShown ? 'Ẩn bảng dữ liệu' : 'Xem dữ liệu lớp đang chọn'; sync(); map.resize(); });
  tables.addEventListener('click', event => { if (event.target.closest('[data-control-id="close-data-panel"]')) { tableShown = false; sync(); } });
  tables.addEventListener('input', schedule); tables.addEventListener('change', schedule); tables.addEventListener('click', schedule);
  retry.addEventListener('click', () => enqueue(async () => {
    const ids = workspace.groupOrder.flatMap(id => {
      const group = workspace.groupsById[id];
      if (group.composition?.action !== 'undetermined') return [];
      delete workspace.groupsById[id]; return group.layerIds;
    });
    workspace.groupOrder = workspace.groupOrder.filter(id => workspace.groupsById[id]);
    if (!workspace.groupsById[workspace.activeGroupId]) workspace.activeGroupId = workspace.groupOrder[0] || null;
    workspace.revision++; await compose(ids); sync();
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
    currentStyle = option.dataset.mapStyle; styleReady = false; map.setStyle(styles[currentStyle], { diff: false });
    document.querySelectorAll('.basemap-option').forEach(button => { button.classList.toggle('active', button.dataset.mapStyle === currentStyle); button.setAttribute('aria-pressed', String(button.dataset.mapStyle === currentStyle)); });
    $('basemap-selection').replaceChildren(document.createTextNode('Nền đang dùng: '), textNode('b', styleLabels[currentStyle]));
    $('map4d-attribution').hidden = currentStyle !== 'map4d'; $('satellite-attribution').hidden = currentStyle !== 'satellite'; $('vector-attribution').hidden = ['map4d', 'satellite'].includes(currentStyle);
  });
  $('zoom-in').addEventListener('click', () => map.zoomIn()); $('zoom-out').addEventListener('click', () => map.zoomOut());
  $('fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector('.map-panel').requestFullscreen());
  map.on('style.load', () => { styleReady = true; mounted.clear(); readyResolve(); sync(); search.refreshHighlight(); });
  map.on('error', event => {
    console.warn('MapLibre:', event.error?.message);
    if (!styleReady) status('Chưa tải được nền bản đồ. Bạn có thể chọn nền khác để thử lại.');
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => map.resize()).observe($('map'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) map.resize(); });
  sync();
  return { workspace, map, importFiles, selectGroup, selectLayer, removeUpload };
}

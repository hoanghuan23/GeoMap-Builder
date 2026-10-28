import { buildArcFlowView, createArcFlowModel, mergeArcFlowStyle } from './arc-flow-data.js';
import { formatTimeValue, uniqueTimeValues } from './time-values.js';
import { serializeTabularValue } from './tabular-data.js';

const empty = { type: 'FeatureCollection', features: [] };
const reasonLabels = { missingEndpoint: 'thiếu điểm đi/đến', missingCoordinates: 'thiếu tọa độ', invalidCoordinates: 'tọa độ ngoài phạm vi',
  missingValue: 'thiếu lưu lượng', negativeValue: 'lưu lượng âm', samePosition: 'hai đầu trùng vị trí' };
const fmt = value => value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

/** Layer-local controls, native endpoint layers and information popups. GPU ownership stays in the workspace. */
export function createArcFlowController({ state, document: doc, getMap, maplibregl, overlay, id, onChange, onStatus, onInteract }) {
  const $ = name => doc.getElementById(name);
  let popup; let nodesReady = false; let eventsReady = false; let active = false; let currentSuggestion;
  let payload; let disposed = false;
  const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  state.arcFlowStyle = mergeArcFlowStyle({ animated: !reducedMotion() });
  const element = (tag, text, className) => Object.assign(doc.createElement(tag), { ...(text == null ? {} : { textContent: text }), ...(className ? { className } : {}) });
  const field = (caption, control) => { const node = element('label', null, 'field'); node.append(element('span', caption), control); return node; };
  const modelFor = suggestion => {
    const dataset = state.aiDataset; dataset.arcFlowModels ||= Object.create(null);
    return dataset.arcFlowModels[suggestion.id] ||= createArcFlowModel(dataset.records, dataset.analysis.columns, suggestion);
  };
  const selectionFor = suggestion => {
    const dataset = state.aiDataset; dataset.arcFlowSelections ||= Object.create(null);
    dataset.arcFlowSelections[suggestion.id] ||= { filters: {}, topN: 100, time: '' };
    return dataset.arcFlowSelections[suggestion.id];
  };
  function closePopup() { popup?.remove(); popup = null; }
  function openInfo(title, rows, position) {
    if (!active) return;
    closePopup(); onInteract?.();
    const content = element('div', null, 'arc-flow-popup'); content.append(element('strong', title));
    for (const [name, value] of rows) {
      const row = element('div', null, 'arc-flow-popup-row'); row.append(element('span', name), element('b', value)); content.append(row);
    }
    // deck handles the pointer before MapLibre emits its click; closing on that
    // same native click would immediately dismiss the popup just opened here.
    popup = new maplibregl.Popup({ maxWidth: '360px', closeOnClick: false }).setLngLat(position).setDOMContent(content).addTo(getMap());
  }
  function openNode(feature) {
    const p = feature.properties; const unit = state.arcFlowView?.model.unit || '';
    openInfo(p.__arcName, [['Tổng vào', `${fmt(Number(p.__inbound))} ${unit}`], ['Tổng ra', `${fmt(Number(p.__outbound))} ${unit}`],
      ['Phạm vi', 'Dữ liệu đang lọc, trước Top N']], feature.geometry.coordinates);
  }
  function flowClick(flow, position) {
    const view = state.arcFlowView; if (!view) return;
    const b = currentSuggestion.bindings;
    const rows = [[view.model.metricLabel, `${fmt(flow.value)} ${view.model.unit}`], ['Bản ghi tổng hợp', String(flow.rowIndices.length)]];
    for (const column of view.model.columns) if (![b.source, b.target, b.sourceLat, b.sourceLng, b.targetLat, b.targetLng, b.value].includes(column.name)) {
      const value = flow.properties[column.name];
      if (value != null && value !== '') rows.push([column.labelVi || column.name, Array.isArray(value) ? value.join(', ') : String(value)]);
    }
    rows.push(['Bộ lọc', filterDescription()]);
    openInfo(`${flow.source.name} → ${flow.target.name}`, rows, position?.slice(0, 2) || flow.source.position);
  }
  function ensureNodes() {
    const map = getMap();
    if (!map.getSource('arc-node-data')) map.addSource('arc-node-data', { type: 'geojson', data: empty });
    if (!map.getLayer('arc-nodes')) map.addLayer({ id: 'arc-nodes', type: 'circle', source: 'arc-node-data', paint: {
      'circle-radius': 5, 'circle-color': '#e2e8f0', 'circle-stroke-color': '#17212f', 'circle-stroke-width': 2
    } });
    if (!map.getLayer('arc-labels')) map.addLayer({ id: 'arc-labels', type: 'symbol', source: 'arc-node-data', layout: {
      'text-field': ['get', '__arcName'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, -1.3], 'text-anchor': 'bottom'
    }, paint: { 'text-color': '#f8fafc', 'text-halo-color': '#17212f', 'text-halo-width': 2 } });
    nodesReady = true;
    if (!eventsReady) {
      map.on('click', 'arc-nodes', event => { if (active && event.features?.[0]) openNode(event.features[0]); });
      eventsReady = true;
    }
  }
  function filterDescription() {
    const selection = selectionFor(currentSuggestion);
    const view = state.arcFlowView;
    const source = view.model.rows.find(row => row.source.id === selection.sourceId)?.source.name;
    const target = view.model.rows.find(row => row.target.id === selection.targetId)?.target.name;
    const time = view.model.columns.find(column => column.name === view.model.bindings.time);
    return [source && `Đi: ${source}`, target && `Đến: ${target}`, selection.time && `Thời điểm: ${formatTimeValue(selection.time, time)}`,
      ...Object.entries(selection.filters).filter(([, value]) => value !== '').map(([fieldName, value]) => `${fieldName}: ${value}`)].filter(Boolean).join(' · ') || 'Tất cả';
  }
  function select(choices, value, callback, ariaLabel) {
    const control = element('select'); control.setAttribute('aria-label', ariaLabel);
    control.append(...choices.map(([key, text]) => Object.assign(element('option', text), { value: String(key) })));
    control.value = String(value ?? ''); control.addEventListener('change', () => callback(control.value)); return control;
  }
  function renderFilters() {
    const root = $('ai-filter-controls'); const model = modelFor(currentSuggestion); const view = state.arcFlowView; const selection = selectionFor(currentSuggestion);
    const controls = [];
    const update = changes => { Object.assign(selection, changes); refresh(); };
    for (const [side, caption] of [['source', 'Điểm đi'], ['target', 'Điểm đến']]) {
      const points = [...new Map(model.rows.map(row => [row[side].id, row[side]])).values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      const counts = new Map(); points.forEach(point => counts.set(point.name, (counts.get(point.name) || 0) + 1));
      controls.push(field(caption, select([['', 'Tất cả'], ...points.map(point => [point.id, point.name + (counts.get(point.name) > 1 ? ` (${point.position.join(', ')})` : '')])],
        selection[`${side}Id`], value => update({ [`${side}Id`]: value }), caption)));
    }
    const time = model.columns.find(column => column.name === model.bindings.time);
    if (time) {
      const values = uniqueTimeValues(model.rows.map(row => row.record), time);
      controls.push(field('Thời điểm', select([['', 'Tất cả'], ...values.map(value => [String(serializeTabularValue(value)), formatTimeValue(value, time)])],
        selection.time, value => update({ time: value }), 'Thời điểm')));
    }
    const excluded = new Set(Object.entries(model.bindings).filter(([key]) => key !== 'group').map(([, value]) => value));
    for (const column of model.columns.filter(column => !excluded.has(column.name) && (['category', 'id', 'text'].includes(column.role) || column.name === model.bindings.group))) {
      const values = [...new Set(model.rows.map(row => String(serializeTabularValue(row.record[column.name]) ?? '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
      if (!values.length || values.length > 300) continue;
      const caption = column.labelVi || column.name;
      controls.push(field(caption, select([['', 'Tất cả'], ...values.map(value => [value, value])], selection.filters[column.name], value => {
        selection.filters[column.name] = value; refresh();
      }, caption)));
    }
    controls.push(field('Số cung hiển thị', select([[50, 'Top 50'], [100, 'Top 100'], [250, 'Top 250'], ['all', 'Tất cả']], selection.topN,
      value => update({ topN: value === 'all' ? value : Number(value) }), 'Số cung hiển thị')));
    const summary = element('p', `${view.visibleFlows.length}/${view.flows.length} luồng · ${view.nodes.features.length} điểm · Tổng ${fmt(view.total)} ${model.unit}`, 'arc-flow-summary');
    summary.setAttribute('role', 'status'); controls.push(summary);
    if (model.stats.invalidRows) controls.push(element('p', `Bỏ ${model.stats.invalidRows}/${model.stats.totalRows} dòng khỏi bản đồ: `
      + Object.entries(model.stats.reasons).filter(([, count]) => count).map(([key, count]) => `${count} ${reasonLabels[key]}`).join('; '), 'arc-flow-warning'));
    if (view.aggregationIssues) controls.push(element('p', `${view.aggregationIssues} OD chưa có phép tổng hợp hợp lệ.`, 'arc-flow-warning'));
    root.replaceChildren(...controls); $('ai-data-filters').hidden = false;
  }
  function renderStyle() {
    const root = $('arc-flow-style-controls'); const style = state.arcFlowStyle; const controls = [];
    for (const [key, caption, min, max, step] of [['height', 'Chiều cao cung', .25, 2, .05], ['width', 'Độ dày cung', .25, 3, .05],
      ['opacity', 'Độ mờ', 0, 1, .05], ['speed', 'Tốc độ chuyển động', .25, 3, .05]]) {
      const control = Object.assign(element('input'), { type: 'range', min, max, step, value: style[key] });
      const output = element('output', `${Math.round(style[key] * 100)}%`);
      const wrapper = field(caption, control); wrapper.append(output);
      control.addEventListener('input', () => {
        state.arcFlowStyle = mergeArcFlowStyle({ ...state.arcFlowStyle, [key]: Number(control.value) });
        output.value = `${Math.round(Number(control.value) * 100)}%`;
        publish(); renderLegend();
      }); controls.push(wrapper);
    }
    for (const [key, caption] of [['animated', 'Chuyển động'], ['showLabels', 'Tên điểm'], ['showLegend', 'Chú giải']]) {
      const wrapper = element('label', null, 'toggle-row'); const control = Object.assign(element('input'), { type: 'checkbox', checked: style[key] });
      wrapper.append(element('span', caption), control, element('i'));
      control.addEventListener('change', () => { state.arcFlowStyle = mergeArcFlowStyle({ ...state.arcFlowStyle, [key]: control.checked }); publish(); renderLegend(); }); controls.push(wrapper);
    }
    root.replaceChildren(...controls);
  }
  function renderLegend() {
    const root = $('arc-flow-legend'); const view = state.arcFlowView;
    root.hidden = !active || !view || !state.arcFlowStyle.showLegend;
    if (root.hidden) return;
    const children = [element('strong', `${view.model.metricLabel}${view.model.unit ? ` (${view.model.unit})` : ''}`)];
    for (const item of view.legend) {
      const row = element('div', null, 'arc-flow-legend-row'); const swatch = element('i'); swatch.style.backgroundColor = item.color;
      row.append(swatch, element('span', `${item.label}: ${fmt(item.min)}${item.min === item.max ? '' : ` – ${fmt(item.max)}`}`)); children.push(row);
    }
    if (!view.flows.length) children.push(element('span', 'Không có luồng phù hợp bộ lọc.'));
    children.push(element('small', `Phân vị 1/3 và 2/3 · ${view.legend.length} mức thực tế · trước Top N`));
    if (view.thresholds.length) children.push(element('small', `Ngưỡng: ${view.thresholds.map(fmt).join(' / ')} ${view.model.unit}`));
    children.push(element('small', `${view.visibleFlows.length}/${view.flows.length} luồng · ${fmt(view.total)} ${view.model.unit}`));
    root.replaceChildren(...children);
  }
  function publish() {
    if (disposed || !currentSuggestion || state.mapType !== 'arc_flow') return;
    ensureNodes();
    getMap().getSource('arc-node-data')?.setData(state.arcFlowView?.nodes || empty);
    getMap().setLayoutProperty('arc-nodes', 'visibility', active ? 'visible' : 'none');
    getMap().setLayoutProperty('arc-labels', 'visibility', active && state.arcFlowStyle.showLabels ? 'visible' : 'none');
    payload = { view: state.arcFlowView, style: state.arcFlowStyle, onClick: flowClick };
    overlay?.updateLayer(id, payload); onChange?.();
  }
  function refresh() {
    if (!currentSuggestion || disposed) return;
    closePopup();
    state.arcFlowView = buildArcFlowView(modelFor(currentSuggestion), selectionFor(currentSuggestion));
    state.boundary = state.arcFlowView.data; state.sourceBoundary = state.arcFlowView.data;
    state.page = 1; renderFilters(); renderLegend(); publish();
  }
  return {
    async activate(suggestion) {
      const model = modelFor(suggestion); if (!model.available) return false;
      currentSuggestion = suggestion; state.mapType = 'arc_flow'; state.chartConfig = null; state.chartMapping = null;
      active = $('show-map-layers').checked;
      refresh(); renderStyle();
      const ok = overlay ? await overlay.updateLayer(id, payload) : false;
      if (!ok || disposed || state.aiDataset?.selectedSuggestionId !== suggestion.id) {
        if (!disposed && state.aiDataset?.selectedSuggestionId === suggestion.id) {
          suggestion.available = false; suggestion.unavailableReason = 'Arc Flow 3D chưa khả dụng: cần WebGL2 và tải được bộ dựng 3D.';
          state.mapType = null; this.setActive(false); onStatus?.(suggestion.unavailableReason);
        }
        return false;
      }
      return true;
    },
    setActive(value) {
      const wasActive = active;
      active = value;
      if (nodesReady) {
        getMap().setLayoutProperty('arc-nodes', 'visibility', value ? 'visible' : 'none');
        getMap().setLayoutProperty('arc-labels', 'visibility', value && state.arcFlowStyle.showLabels ? 'visible' : 'none');
      }
      if (!value) { closePopup(); overlay?.removeLayer(id); }
      else if (!wasActive && payload) overlay?.updateLayer(id, payload);
      renderLegend();
    },
    clear() { this.setActive(false); currentSuggestion = null; state.arcFlowView = null; },
    reset() {
      if (state.mapType !== 'arc_flow') return false;
      delete state.aiDataset.arcFlowSelections[currentSuggestion.id]; state.arcFlowStyle = mergeArcFlowStyle({ animated: !reducedMotion() });
      refresh(); renderStyle(); return true;
    },
    openNode, closePopup,
    dispose() { disposed = true; closePopup(); overlay?.removeLayer(id); },
    searchData() {
      const view = state.arcFlowView; if (!view) return {};
      const b = view.model.bindings;
      return { data: { ...view.nodes, features: view.nodes.features.map(feature => ({ ...feature,
        properties: { ...feature.properties, [b.source]: feature.properties.__arcName, [b.target]: feature.properties.__arcName } })) },
      columns: view.model.columns, titleField: b.source, chartType: 'point', search_bar: state.aiDataset.analysis.search_bar,
      search_fields: (state.aiDataset.analysis.search_fields || []).filter(fieldName => [b.source, b.target].includes(fieldName)) };
    }
  };
}

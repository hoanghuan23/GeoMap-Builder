import { normalizeEditContext, normalizeEditResult } from './ai-map-edit-contract.js';
import { popupDisplayOptions } from './shared/popup/ai-popup-chart.js';
import { resolveAggregation } from './shared/import/ai-chart-pipeline.js';
import { normalizePolygonLegendRecommendation, polygonLegendTarget } from './shared/data/polygon-legend-contract.js';
import { visibleDatasetColumns, popupDisplayColumns } from './shared/data/display-fields.js';
import { POPUP_TYPES } from './shared/import/ai-chart-contract.js';

const selected = api => api.state.aiDataset?.suggestions.find(item => item.id === api.state.aiDataset.selectedSuggestionId);

export function createAiMapEditor({ workspace, runtimes, templatePicker, appearance, isLoading, sync, closePopups, fetchImpl = globalThis.fetch }) {
  function getContext() {
    const group = workspace.groupsById[workspace.activeGroupId];
    if (!group) throw new Error('Hãy tải dữ liệu và render bản đồ trước khi chat chỉnh sửa.');
    if (isLoading()) throw new Error('Bản đồ đang được xử lý. Hãy đợi render hoàn tất rồi gửi yêu cầu.');
    return normalizeEditContext({ groupId: group.id, title: group.title, activeLayerId: group.activeLayerId,
      templateId: templatePicker?.getSelectedSource()?.template, appearance: appearance?.read() || group.appearance,
      layers: group.layerIds.map(id => {
        const item = runtimes.get(id); const api = item.api; const view = api.getView();
        const dataset = api.state.aiDataset; const suggestion = selected(api); const module = api.context.modules.active();
        const columns = dataset?.analysis.columns || api.searchData().columns || [];
        const field = suggestion?.bindings.value; const column = columns.find(column => column.name === field);
        const legendTarget = ['polygon', 'line'].includes(api.state.mapType) && column ? polygonLegendTarget(column, resolveAggregation(suggestion, columns)) : null;
        const legend = legendTarget && (normalizePolygonLegendRecommendation(suggestion.legend, { ...legendTarget, role: column.role })
          || normalizePolygonLegendRecommendation(column.legend, { ...legendTarget, role: column.role }));
        const popup = api.controllers.popup.activeMapPopupSuggestion();
        const popupModes = popup && api.state.mapType !== 'arc_flow' ? popupDisplayOptions({ ...popup,
          popupSuggestions: POPUP_TYPES.map(name => ({ name, confidence: 1 })) }, visibleDatasetColumns(dataset, columns)).filter(option => option.available).map(option => option.name) : [];
        return { id, title: workspace.layersById[id].title, mapType: api.state.mapType === 'arc_flow' ? 'arc' : api.state.mapType,
          columns: columns.filter(column => !column.name.startsWith('__') && column.role !== 'ignore').map(column => ({ name: column.name, label: column.labelVi, role: column.role })),
          visible: group.visible && workspace.layersById[id].visible !== false,
          legendVisible: workspace.layersById[id].legendVisible !== false && view.legendVisible !== false,
          style: view.configuration?.style || {}, metric: module?.metricField(), metrics: module?.metricColumns().map(column => column.name) || [],
          availableMetrics: (module?.allMetricColumns?.() || module?.metricColumns() || []).map(column => column.name),
          popupModes, popupMode: dataset?.popupSelections?.[suggestion?.id]?.mode || popupDisplayOptions(popup, visibleDatasetColumns(dataset, columns))[0]?.name,
          popupFields: popupDisplayColumns(dataset, columns).map(column => column.name), legendTarget, legend,
          hexEnabled: view.configuration?.regionHexEnabled, hexResolution: view.configuration?.regionHexResolution };
      }) });
  }

  const fingerprint = () => {
    const context = getContext();
    // Computed colors can animate on hover/focus while AI is working. Only user
    // appearance settings determine whether the requested map has changed.
    context.appearance = workspace.groupsById[workspace.activeGroupId].appearance || {};
    return JSON.stringify([workspace.revision, context,
      workspace.groupsById[workspace.activeGroupId].layerIds.map(id => {
      const api = runtimes.get(id).api;
      return [api.state.aiDataset?.selectedSuggestionId, api.state.aiDataset?.filters, api.state.aiDataset?.popupSelections, api.getView().configuration];
      })]);
  };

  async function applyOperation(operation, groupId, plannedMetric) {
    if (operation.kind === 'appearance') {
      if (!appearance) throw new Error('Chưa kết nối điều chỉnh giao diện bản đồ.');
      appearance.update(operation.key, JSON.parse(operation.value), groupId);
      return;
    }
    const api = runtimes.get(operation.layerId).api;
    const layer = workspace.layersById[operation.layerId];
    const dataset = api.state.aiDataset; const suggestion = selected(api); const module = api.context.modules.active();
    const value = JSON.parse(operation.value);
    switch (operation.kind) {
      case 'style': await module.update({ style: { [operation.key]: value } }); break;
      case 'metric': await api.controllers.ui.changeAiMapMetric(value); break;
      case 'metricFields': {
        const catalog = module.allMetricColumns(); const names = new Set(catalog.map(column => column.name));
        dataset.hiddenMetricFields = [...new Set([...(dataset.hiddenMetricFields || []).filter(field => !names.has(field)),
          ...catalog.filter(column => !value.includes(column.name)).map(column => column.name)])];
        dataset.metricFieldsConfigured = true;
        dataset.filters = Object.fromEntries(Object.entries(dataset.filters || {}).filter(([field]) => !dataset.hiddenMetricFields.includes(field)));
        for (const selection of Object.values(dataset.pointSelections || {})) if (dataset.hiddenMetricFields.includes(selection.groupField)) {
          selection.groupField = null; selection.mode = 'all'; selection.selectedValues = [];
        }
        const target = plannedMetric || (value.includes(module.metricField()) ? module.metricField() : value[0]);
        if (target !== module.metricField()) await api.controllers.ui.changeAiMapMetric(target);
        api.controllers.popup.refreshMapPopupControls();
        await module.update({});
        break;
      }
      case 'visible': {
        const group = workspace.groupsById[groupId];
        if (value && !group.visible) for (const id of group.layerIds) workspace.layersById[id].visible = false;
        layer.visible = value;
        if (value) group.visible = true;
        break;
      }
      case 'legendVisible':
        if (api.state.mapType === 'polygon') layer.legendVisible = value;
        await module.update({ style: { showLegend: value } }); break;
      case 'legend': suggestion.legend = value; await module.update({}); break;
      case 'popupFields': dataset.popupFields = value; break;
      case 'popupMode': {
        suggestion.popupSuggestions ||= [];
        if (!suggestion.popupSuggestions.some(option => option.name === value)) suggestion.popupSuggestions.push({ name: value, confidence: 1 });
        const selection = api.controllers.popup.popupSelectionFor();
        selection.mode = value;
        api.controllers.popup.popupSelectionFor();
        break;
      }
      case 'hexEnabled': {
        await module.update({ hex: { enabled: value } });
        if (value && !api.getView().configuration?.regionHexEnabled) throw new Error('Không thể tạo lưới lục giác cho dữ liệu hiện tại.');
        break;
      }
      case 'hexResolution': await module.update({ hex: { resolution: value } }); break;
    }
    module.renderControls?.();
    api.controllers.ui.renderMapMetricControls();
    if (dataset) api.controllers.popup.refreshMapPopupControls();
    api.context.options.onChange?.();
  }

  async function chat(message, history, { signal } = {}) {
    const context = getContext(); const before = fingerprint();
    const response = await fetchImpl('/api/ai/edit-map', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(-20), context }), signal });
    const raw = await response.json();
    if (!response.ok) throw new Error(raw.error || 'Không thể gửi yêu cầu chỉnh sửa.');
    if (signal?.aborted) throw new Error('Yêu cầu đã hủy.');
    if (before !== fingerprint()) throw new Error('Bản đồ đã thay đổi trong lúc AI xử lý. Hãy gửi lại để chỉnh đúng trạng thái mới.');
    const result = normalizeEditResult(raw, context);
    // Validate the whole response before touching a runtime, then restore settings if rendering fails.
    if (result.operations.length) {
      const group = workspace.groupsById[context.groupId]; const groupVisible = group.visible;
      const previousAppearance = structuredClone(group.appearance);
      const visibility = group.layerIds.map(id => [id, workspace.layersById[id].visible]);
      const backups = [...new Set(result.operations.filter(operation => operation.kind !== 'appearance').map(operation => operation.layerId))].map(id => {
        const api = runtimes.get(id).api; const dataset = api.state.aiDataset;
        return { id, api, configuration: structuredClone(api.getView().configuration), metric: api.context.modules.active()?.metricField(),
          visible: workspace.layersById[id].visible, legendVisible: workspace.layersById[id].legendVisible,
          legend: structuredClone(selected(api)?.legend), popupSuggestions: structuredClone(selected(api)?.popupSuggestions),
          popupSelections: structuredClone(dataset?.popupSelections), popupFields: structuredClone(dataset?.popupFields),
          hiddenMetricFields: structuredClone(dataset?.hiddenMetricFields), metricFieldsConfigured: dataset?.metricFieldsConfigured,
          filters: structuredClone(dataset?.filters), pointSelections: structuredClone(dataset?.pointSelections) };
      });
      closePopups();
      try {
        const ordered = [...result.operations.filter(operation => operation.kind === 'metricFields'), ...result.operations.filter(operation => operation.kind !== 'metricFields')];
        for (const operation of ordered) {
          const selection = result.operations.find(item => item.layerId === operation.layerId && item.kind === 'metric');
          await applyOperation(operation, context.groupId, selection && JSON.parse(selection.value));
        }
      } catch (error) {
        group.visible = groupVisible;
        group.appearance = previousAppearance;
        appearance?.apply();
        for (const [id, visible] of visibility) if (workspace.layersById[id]) workspace.layersById[id].visible = visible;
        for (const backup of backups) {
          if (runtimes.get(backup.id)?.api !== backup.api) continue;
          const { api } = backup; const dataset = api.state.aiDataset; const module = api.context.modules.active();
          Object.assign(workspace.layersById[backup.id], { visible: backup.visible, legendVisible: backup.legendVisible });
          if (selected(api)) Object.assign(selected(api), { legend: backup.legend, popupSuggestions: backup.popupSuggestions });
          if (dataset) Object.assign(dataset, { popupSelections: backup.popupSelections, popupFields: backup.popupFields,
            hiddenMetricFields: backup.hiddenMetricFields, metricFieldsConfigured: backup.metricFieldsConfigured,
            filters: backup.filters, pointSelections: backup.pointSelections });
          if (backup.metric && backup.metric !== module.metricField()) await api.controllers.ui.changeAiMapMetric(backup.metric);
          if (backup.configuration?.style) await module.update({ style: backup.configuration.style });
          if (backup.configuration?.regionHexEnabled !== undefined) await module.update({ hex: { enabled: backup.configuration.regionHexEnabled, resolution: backup.configuration.regionHexResolution } });
          if (result.operations.some(operation => operation.layerId === backup.id && operation.kind === 'legend')) await module.update({});
          if (result.operations.some(operation => operation.layerId === backup.id && operation.kind === 'metricFields')) {
            dataset.filters = structuredClone(backup.filters);
            api.controllers.popup.refreshMapPopupControls(); await module.update({});
          }
          module.renderControls?.();
        }
        sync(); throw error;
      }
      workspace.revision++;
      sync();
      for (const operation of result.operations.filter(operation => operation.kind === 'hexResolution')) {
        const actual = runtimes.get(operation.layerId).api.getView().configuration.regionHexResolution;
        if (actual !== JSON.parse(operation.value)) result.message = `${result.message.slice(0, 3800)}\nLưới được điều chỉnh về độ phân giải ${actual} để giữ số ô trong giới hạn hiển thị.`;
      }
    }
    return { ...result, groupId: context.groupId };
  }
  return { getContext, chat };
}

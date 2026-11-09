import { analyzeSpatialData as default_analyzeSpatialData } from "../../shared/data/data-capabilities.js";
import { humanizeField as default_humanizeField } from "../../charts/data-transformers.js";
import { buildPointView as default_buildPointView } from "./style.js";
import { createPointModel as default_createPointModel } from "./style.js";
import { mergePointStyle as default_mergePointStyle } from "./style.js";
import { normalizePointSelection as default_normalizePointSelection } from "./style.js";
import { POINT_DEFAULT_GROUPS as default_POINT_DEFAULT_GROUPS } from "./style.js";
import { formatTimeValue as default_formatTimeValue } from "../../shared/data/time-values.js";
import { timeValueInfo as default_timeValueInfo } from "../../shared/data/time-values.js";
import { popupTimeColumn as default_popupTimeColumn } from "../../shared/popup/ai-popup-chart.js";
import { EMPTY_FEATURE_COLLECTION } from '../../shared/configuration.js';
import { visibleDatasetColumns } from '../../shared/data/display-fields.js';

/** point operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const controlId = control => control.dataset?.controlId || control.id;

  const analyzeSpatialData = (...args) => (context.dependencies?.analyzeSpatialData ?? default_analyzeSpatialData)(...args);

  const humanizeField = (...args) => (context.dependencies?.humanizeField ?? default_humanizeField)(...args);

  const buildPointView = (...args) => (context.dependencies?.buildPointView ?? default_buildPointView)(...args);

  const createPointModel = (...args) => (context.dependencies?.createPointModel ?? default_createPointModel)(...args);

  const mergePointStyle = (...args) => (context.dependencies?.mergePointStyle ?? default_mergePointStyle)(...args);

  const normalizePointSelection = (...args) => (context.dependencies?.normalizePointSelection ?? default_normalizePointSelection)(...args);

  const POINT_DEFAULT_GROUPS = context.dependencies?.POINT_DEFAULT_GROUPS ?? default_POINT_DEFAULT_GROUPS;

  const formatTimeValue = (...args) => (context.dependencies?.formatTimeValue ?? default_formatTimeValue)(...args);

  const timeValueInfo = (...args) => (context.dependencies?.timeValueInfo ?? default_timeValueInfo)(...args);

  const popupTimeColumn = (...args) => (context.dependencies?.popupTimeColumn ?? default_popupTimeColumn)(...args);

  function activePointSuggestion() {
    if (state.mapType !== "point") return null;
    const dataset = state.aiDataset;
    const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
    return suggestion?.chartType === "point" ? suggestion : null;
  }

  function pointModelFor(suggestion, includeHidden = false) {
    const dataset = state.aiDataset;
    dataset.pointModels ||= Object.create(null);
    const model = dataset.pointModels[suggestion.id] ||= createPointModel(dataset.records, dataset.analysis.columns, suggestion.bindings);
    const proposed = Array.isArray(suggestion.pointGroupFields)
      ? suggestion.pointGroupFields.map(name => model.groups.find(column => column.name === name)).filter(Boolean)
      : model.groups;
    const groups = includeHidden ? proposed : visibleDatasetColumns(dataset, proposed);
    return { ...model, groups, measures: includeHidden ? model.measures : visibleDatasetColumns(dataset, model.measures),
      defaultGroupField: Array.isArray(suggestion.pointGroupFields) ? groups[0]?.name || null : model.defaultGroupField };
  }

  function pointSelectionFor(suggestion) {
    const dataset = state.aiDataset;
    dataset.pointSelections ||= Object.create(null);
    return dataset.pointSelections[suggestion.id] ||= normalizePointSelection(pointModelFor(suggestion), {
      ...dataset.pointSelectionDefaults
    });
  }

  function populatePointControls(suggestion) {
    const model = pointModelFor(suggestion);
    const selection = pointSelectionFor(suggestion);
    const group = model.groups.find(column => column.name === selection.groupField);
    const nodes = [];
    if (model.groups.length) {
      nodes.push(services.ui.aiField("Hiển thị theo", services.ui.aiSelect("ai-point-group", model.groups.map(column => [column.name, column.label]), selection.groupField)));
    }
    if (group) {
      const label = group.label.toLocaleLowerCase("vi");
      nodes.push(services.ui.aiField(group.label, services.ui.aiSelect("ai-point-mode", [["all", `Tất cả ${label}`], ["pick", `Chọn từng ${label}`]], selection.mode)));
      if (selection.mode === "pick") {
        const box = document.createElement("div"); box.className = "ai-series-picker ai-point-picker";
        const search = Object.assign(document.createElement("input"), { type: "search", className: "ai-series-search", placeholder: "Tìm…" });
        search.setAttribute("aria-label", `Tìm ${label}`);
        const counter = document.createElement("span"); counter.dataset.role = "point-group-count";
        counter.textContent = `${selection.selectedValues.length}/${group.values.length}`;
        const reset = Object.assign(document.createElement("button"), { type: "button", className: "ai-point-reset secondary-button", textContent: `Đặt lại (top ${POINT_DEFAULT_GROUPS})` });
        const head = document.createElement("div"); head.className = "ai-series-head"; head.append(counter, reset);
        const list = document.createElement("div"); list.className = "ai-series-list";
        list.replaceChildren(...group.values.map(item => {
          const row = document.createElement("label");
          const input = Object.assign(document.createElement("input"), { type: "checkbox", className: "ai-point-value", value: item.key, checked: selection.selectedValues.includes(item.key) });
          const swatch = document.createElement("i"); swatch.className = "point-group-swatch"; swatch.setAttribute("aria-hidden", "true");
          const text = document.createElement("span"); text.textContent = item.label;
          const count = document.createElement("small"); count.textContent = item.count.toLocaleString("vi-VN");
          row.append(input, swatch, text, count);
          return row;
        }));
        box.append(search, head, list); nodes.push(box);
      }
    }
    if (model.timeColumn) {
      const choices = model.times.map(value => {
        const date = timeValueInfo(value, model.timeColumn)?.value;
        const hasTime = date instanceof Date && !date.toISOString().endsWith("T00:00:00.000Z");
        return [value, formatTimeValue(value, model.timeColumn, hasTime)];
      });
      const time = services.ui.aiSelect("ai-point-time", [["", "Tất cả"], ...choices], selection.time);
      const label = model.timeColumn.labelVi || humanizeField(model.timeColumn.name);
      time.setAttribute("aria-label", `${label} hiển thị bản đồ`);
      nodes.push(services.ui.aiField(label, time));
    }
    const mapControls = document.createElement("div"); mapControls.className = "ai-popup-map-controls";
    mapControls.append(...nodes);
    $("ai-filter-controls").replaceChildren(...services.popup.buildMapPopupControls(state.aiDataset, suggestion), mapControls);
    $("ai-data-filters").hidden = false;
    syncPointControls();
  }

  function syncPointControls() {
    const view = state.aiDataset?.activePointView;
    if (!view) return;
    const selected = new Set(view.selection.selectedValues);
    document.querySelectorAll("#ai-filter-controls .ai-point-value").forEach(input => {
      input.checked = selected.has(input.value);
      const swatch = input.parentElement.querySelector(".point-group-swatch");
      swatch.style.background = input.checked ? view.colors[input.value] : "#dce3ed";
    });
    const counter = document.querySelector("#ai-filter-controls [data-role='point-group-count']");
    if (counter && view.selection.groupField) {
      const group = pointModelFor(activePointSuggestion()).groups.find(column => column.name === view.selection.groupField);
      if (group) counter.textContent = `${selected.size}/${group.values.length}`;
    }
    document.querySelectorAll("#ai-filter-controls .ai-point-time").forEach(select => { select.value = view.selection.time; });
  }

  function pointColorOverridesFor(suggestion) {
    const dataset = state.aiDataset;
    dataset.pointColorOverrides ||= Object.create(null);
    const byField = dataset.pointColorOverrides[suggestion.id] ||= Object.create(null);
    return byField[pointSelectionFor(suggestion).groupField] ||= Object.create(null);
  }

  function renderPointStyleControls() {
    const style = mergePointStyle(state.pointStyle);
    for (const [id, key] of [["point-size", "size"], ["point-opacity", "opacity"], ["point-border-width", "borderWidth"], ["point-color", "color"], ["point-border-color", "borderColor"]]) $(id).value = style[key];
    $("point-size-value").value = `${style.size}%`;
    $("point-opacity-value").value = `${Math.round(style.opacity * 100)}%`;
    $("point-border-width-value").value = `${style.borderWidth} px`;
    $("point-color-value").textContent = style.color.toUpperCase();
    $("point-border-color-value").textContent = style.borderColor.toUpperCase();
    $("point-show-border").checked = style.showBorder;
    $("point-show-legend").checked = style.showLegend;
    const view = activePointSuggestion() ? state.aiDataset.activePointView : null;
    const grouped = Boolean(view?.selection.groupField);
    $("point-fixed-color-field").hidden = grouped;
    $("point-group-color-field").hidden = !grouped;
    $("point-show-legend-field").hidden = !view;
    $("point-group-colors").replaceChildren(...(grouped ? view.legendRows.map(item => {
      const row = document.createElement("label"); row.className = "bar-color-row";
      const label = document.createElement("span"); label.textContent = item.label; label.title = item.label;
      const control = document.createElement("span"); control.className = "color-control";
      const input = Object.assign(document.createElement("input"), { type: "color", value: item.color, className: "point-group-color" });
      input.dataset.value = item.key; input.setAttribute("aria-label", `Màu ${item.label}`);
      const code = document.createElement("code"); code.textContent = item.color.toUpperCase();
      control.append(input, code); row.append(label, control);
      return row;
    }) : []));
  }

  function buildActivePointView(suggestion) {
    const dataset = state.aiDataset;
    const model = pointModelFor(suggestion);
    const selection = pointSelectionFor(suggestion);
    dataset.pointColors ||= Object.create(null);
    const byField = dataset.pointColors[suggestion.id] ||= Object.create(null);
    const view = buildPointView(model, selection, byField[selection.groupField], { ...state.pointStyle, groupColors: pointColorOverridesFor(suggestion) });
    byField[view.selection.groupField] = view.paletteColors;
    dataset.pointSelections[suggestion.id] = view.selection;
    dataset.activePointView = view;
    return view;
  }

  function refreshPointStyle() {
    const suggestion = activePointSuggestion();
    if (suggestion) { buildActivePointView(suggestion); syncPointControls(); }
    services.view.applyStyle();
  }

  function renderPointLegend() {
    const legend = $("point-legend");
    const view = state.aiDataset?.activePointView;
    legend.hidden = !activePointSuggestion() || !view || !state.pointStyle.showLegend || !$("show-map-layers").checked || !view.stats.visibleCount;
    if (legend.hidden) return;
    const heading = document.createElement("div"); heading.className = "point-legend-heading";
    const title = document.createElement("strong"); title.textContent = view.legendTitle;
    const count = document.createElement("span"); count.textContent = `${view.stats.visibleCount.toLocaleString("vi-VN")} điểm`;
    heading.append(title, count);
    const list = document.createElement("div"); list.className = "point-legend-rows";
    for (const item of view.legendRows) {
      const row = document.createElement("div"); row.className = "point-legend-row";
      const swatch = document.createElement("i"); swatch.style.background = item.color; swatch.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.textContent = item.label;
      const amount = document.createElement("b"); amount.textContent = item.count.toLocaleString("vi-VN");
      row.append(swatch, label, amount); list.append(row);
    }
    const note = document.createElement("small");
    note.textContent = view.selection.time ? formatTimeValue(view.selection.time, popupTimeColumn(state.aiDataset.analysis.columns))
      : view.selection.time === "" ? "Tất cả thời gian" : "";
    note.hidden = !note.textContent;
    legend.replaceChildren(heading, list, note);
  }

  function refreshPointView(suggestion, { rebuildControls = false } = {}) {
    const dataset = state.aiDataset;
    const model = pointModelFor(suggestion);
    const view = buildActivePointView(suggestion);
    dataset.spatialData = model.data;
    state.pointData = view.data;
    state.boundary = view.data; state.sourceBoundary = model.data; state.mapType = "point";
    state.dataProfile = analyzeSpatialData(view.data, { numericFields: model.measures.map(column => column.name) });
    context.map.getSource("h3-grid")?.setData(EMPTY_FEATURE_COLLECTION);
    context.map.getSource("point-data")?.setData(view.data);
    context.map.getSource("polygon-data")?.setData(EMPTY_FEATURE_COLLECTION);
    context.map.getSource("vietnam-boundary")?.setData(EMPTY_FEATURE_COLLECTION);
    if (rebuildControls) populatePointControls(suggestion);
    else syncPointControls();
    services.ui.updateModelSections(); services.view.applyStyle();
    services.uploads.setCurrentFileNote(`${view.stats.visibleCount.toLocaleString("vi-VN")}/${view.stats.totalCount.toLocaleString("vi-VN")} điểm · ${Math.round(view.stats.coordinateRate * 100)}% tọa độ hợp lệ`);
    services.popup.refreshMapPopup();
    services.ui.setStatus(view.stats.visibleCount ? `Đang hiển thị ${view.stats.visibleCount.toLocaleString("vi-VN")} điểm dữ liệu.` : "Không có điểm phù hợp với bộ lọc. Hãy chọn nhóm hoặc thời gian khác.", view.stats.visibleCount > 0);
  }

  function activateAiPoint(suggestion) {
    services.runtime.cancelAiBoundaryLoad();
    const dataset = state.aiDataset;
    const firstActivation = !dataset.pointSelections?.[suggestion.id];
    dataset.recommendation = services.ui.recommendationForSuggestion(suggestion);

    refreshPointView(suggestion, { rebuildControls: true });
    services.ui.renderAiSuggestionGrid();
    if (firstActivation) services.view.fitGeoJSON(pointModelFor(suggestion).data);
    return true;
  }

  function bindControls() {
  context.listen($("point-style-controls"), "input", event => {
      const control = event.target;
      if (control.matches(".point-group-color")) {
        const suggestion = activePointSuggestion();
        if (!suggestion) return;
        pointColorOverridesFor(suggestion)[control.dataset.value] = control.value;
        control.nextElementSibling.textContent = control.value.toUpperCase();
      } else {
        const key = { "point-size": "size", "point-opacity": "opacity", "point-border-width": "borderWidth", "point-color": "color", "point-border-color": "borderColor" }[controlId(control)];
        if (!key) return;
        state.pointStyle = mergePointStyle({ ...state.pointStyle, [key]: control.type === "color" ? control.value : Number(control.value) });
        if (control.type === "color") $(`${controlId(control)}-value`).textContent = control.value.toUpperCase();
        else $(`${controlId(control)}-value`).value = key === "size" ? `${state.pointStyle.size}%` : key === "opacity" ? `${Math.round(state.pointStyle.opacity * 100)}%` : `${state.pointStyle.borderWidth} px`;
      }
      refreshPointStyle();
    });
  context.listen($("point-style-controls"), "change", event => {
      const key = { "point-show-border": "showBorder", "point-show-legend": "showLegend" }[controlId(event.target)];
      if (!key) return;
      state.pointStyle = mergePointStyle({ ...state.pointStyle, [key]: event.target.checked });
      refreshPointStyle();
    });
  }

  async function handleChange(event) {
  if (event.target.matches(".ai-point-group, .ai-point-mode, .ai-point-value, .ai-point-time")) {
        const suggestion = activePointSuggestion();
        if (!suggestion) return true;
        const selection = pointSelectionFor(suggestion);
        const control = event.target;
        let rebuildControls = false;
        if (control.matches(".ai-point-group")) {
          selection.groupField = control.value;
          selection.selectedValues = [];
          delete selection.mode;
          state.aiDataset.pointSelections[suggestion.id] = normalizePointSelection(pointModelFor(suggestion), selection);
          rebuildControls = true;
        } else if (control.matches(".ai-point-mode")) { selection.mode = control.value; rebuildControls = true; }
        else if (control.matches(".ai-point-value")) {
          const values = control.checked ? [...selection.selectedValues, control.value] : selection.selectedValues.filter(value => value !== control.value);
          if (!values.length) {
            control.checked = !control.checked;
            services.ui.showToast("Cần chọn ít nhất một nhóm.");
            return true;
          }
          selection.selectedValues = values;
        } else if (control.matches(".ai-point-time")) selection.time = control.value;
        refreshPointView(suggestion, { rebuildControls });
        return true;
      }
  return false;
  }

  function handleClick(event) {
  if (event.target.closest(".ai-point-reset")) {
        const suggestion = activePointSuggestion();
        if (!suggestion) return true;
        const selection = pointSelectionFor(suggestion);
        state.aiDataset.pointSelections[suggestion.id] = normalizePointSelection(pointModelFor(suggestion), { ...selection, mode: "pick", selectedValues: [] });
        refreshPointView(suggestion, { rebuildControls: true });
        return true;
      }
  return false;
  }

  return { bindControls, handleChange, handleClick, activePointSuggestion, pointModelFor, pointSelectionFor, populatePointControls, syncPointControls, pointColorOverridesFor, renderPointStyleControls, buildActivePointView, refreshPointStyle, renderPointLegend, refreshPointView, activateAiPoint };
}

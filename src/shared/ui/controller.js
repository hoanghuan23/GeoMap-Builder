import { mapRegistry, mapDefinitions } from '../../maps/registry.js';
import { visibleDatasetColumns } from '../data/display-fields.js';
import { analyzeSpatialData as default_analyzeSpatialData } from "../data/data-capabilities.js";
import { compatibleMapTypes as default_compatibleMapTypes } from "../data/data-capabilities.js";
import { describeDataProfile as default_describeDataProfile } from "../data/data-capabilities.js";
import { humanizeField as default_humanizeField } from "../../charts/data-transformers.js";
import { renderMapIcon as default_renderMapIcon } from "./map-icons.js";

import { comparableFilterValue as default_comparableFilterValue } from "../import/ai-data-analysis.js";
import { displayFilterValue as default_displayFilterValue } from "../import/ai-data-analysis.js";
import { keepSelectOpenAfterMouseClick as default_keepSelectOpenAfterMouseClick } from "./select-control.js";
import { administrativeContextFields as default_administrativeContextFields } from "../import/ai-chart-pipeline.js";
import { defaultBarMetrics as default_defaultBarMetrics } from "../import/ai-chart-pipeline.js";
import { defaultTimeFilter as default_defaultTimeFilter } from "../import/ai-chart-pipeline.js";
import { resolveAggregation as default_resolveAggregation } from "../import/ai-chart-pipeline.js";

import { compareTimeValues as default_compareTimeValues } from "../data/time-values.js";
import { AI_CHART_REGISTRY as default_AI_CHART_REGISTRY } from "../import/ai-chart-contract.js";
import { mapDisplaySuggestions as default_mapDisplaySuggestions } from "../popup/ai-popup-chart.js";
import { popupChartColumns as default_popupChartColumns } from "../popup/ai-popup-chart.js";

import { renderSupportedMapCatalog } from './catalog.js';

/** ui operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const analyzeSpatialData = (...args) => (context.dependencies?.analyzeSpatialData ?? default_analyzeSpatialData)(...args);

  const compatibleMapTypes = (...args) => (context.dependencies?.compatibleMapTypes ?? default_compatibleMapTypes)(...args);

  const describeDataProfile = (...args) => (context.dependencies?.describeDataProfile ?? default_describeDataProfile)(...args);

  const humanizeField = (...args) => (context.dependencies?.humanizeField ?? default_humanizeField)(...args);

  const renderMapIcon = (...args) => (context.dependencies?.renderMapIcon ?? default_renderMapIcon)(...args);

  const comparableFilterValue = (...args) => (context.dependencies?.comparableFilterValue ?? default_comparableFilterValue)(...args);

  const displayFilterValue = (...args) => (context.dependencies?.displayFilterValue ?? default_displayFilterValue)(...args);

  const keepSelectOpenAfterMouseClick = (...args) => (context.dependencies?.keepSelectOpenAfterMouseClick ?? default_keepSelectOpenAfterMouseClick)(...args);

  const administrativeContextFields = (...args) => (context.dependencies?.administrativeContextFields ?? default_administrativeContextFields)(...args);

  const defaultBarMetrics = (...args) => (context.dependencies?.defaultBarMetrics ?? default_defaultBarMetrics)(...args);

  const defaultTimeFilter = (...args) => (context.dependencies?.defaultTimeFilter ?? default_defaultTimeFilter)(...args);

  const resolveAggregation = (...args) => (context.dependencies?.resolveAggregation ?? default_resolveAggregation)(...args);

  const compareTimeValues = (...args) => (context.dependencies?.compareTimeValues ?? default_compareTimeValues)(...args);

  const AI_CHART_REGISTRY = context.dependencies?.AI_CHART_REGISTRY ?? default_AI_CHART_REGISTRY;

  const mapDisplaySuggestions = (...args) => (context.dependencies?.mapDisplaySuggestions ?? default_mapDisplaySuggestions)(...args);

  const popupChartColumns = (...args) => (context.dependencies?.popupChartColumns ?? default_popupChartColumns)(...args);


  function showToast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(context.tasks.toastTimer); context.tasks.toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }

  function setStatus(message, hide = false) {
    if (options.onStatus) { options.onStatus(message, hide); return; }
    const el = $("status");
    clearTimeout(context.tasks.statusTimer);
    el.textContent = message;
    el.hidden = false;
    if (hide) context.tasks.statusTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }


  function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "--"; }

  function renderSupportedChartCatalog() {
    renderSupportedMapCatalog(document);
  }

  function showSupportedChartCatalog(visible) {
    $("supported-chart-catalog").hidden = !visible;
  }

  function updateModelSections() {
    const module = context.modules.active(); const presentation = module?.presentation();
    $('feature-section').hidden = !module;
    $('style-section').hidden = !module;
    for (const id of mapDefinitions.map(definition=>definition.stylePanel)) $(id).hidden = presentation?.stylePanel !== id;
    $('region-hex-controls').hidden = !presentation?.regionHex;
    $('line-toggle-field').hidden = true;
    $('line-toggle-label').textContent=presentation?.lineToggleLabel || 'Hiển thị đường nối giữa các điểm';
    $('ai-filter-description').textContent = presentation?.filterDescription || 'Chọn chỉ số, nhóm dữ liệu và khoảng thời gian';
    $('style-description').textContent = presentation?.description || '';
    module?.renderControls();
    if (!services.popup.activeMapPopupSuggestion()) services.popup.closeMapPopup();
    services.view.syncDataSearch(); renderMapMetricControls();
  }

  function renderCompatibleMapTypes(data, profile = analyzeSpatialData(data)) {
    const types = compatibleMapTypes(profile); const grid = $("map-type-grid"); state.dataProfile = profile;
    showSupportedChartCatalog(false);
    if (!types.some(type => type.id === state.mapType)) state.mapType = types[0]?.id || null;
    grid.replaceChildren(...types.map(type => {
      const button = document.createElement("button"); const icon = document.createElement("span");
      button.type = "button"; button.className = `map-type${type.id === state.mapType ? " active" : ""}`; button.dataset.type = type.id; button.dataset.label = type.label;
      button.title = `${type.label} · ${type.renderer}`; renderMapIcon(icon, type.icon); button.append(icon, type.label); return button;
    }));
    grid.classList.toggle("is-empty", types.length === 0);
    if (!types.length) grid.textContent = "Dữ liệu này chưa phù hợp với renderer hiện có.";
    $("map-type-summary").textContent = types.length
      ? `Phát hiện ${describeDataProfile(profile)} · ${types.length} kiểu bản đồ phù hợp`
      : `Phát hiện ${describeDataProfile(profile)} · chưa có kiểu bản đồ phù hợp`;
    updateModelSections();
  }

  function uniqueRecordValues(records, field) {
    if (!field) return [];
    const values = new Map();
    for (const record of records) {
      const value = record?.[field];
      if (value == null || value === "") continue;
      values.set(comparableFilterValue(value), value);
    }
    return [...values.entries()];
  }

  function mapMetricColumns(dataset, suggestion) {
    return suggestion ? context.modules.get(suggestion.chartType)?.metricColumns() || [] : [];
  }

  function mapMetricButtons(dataset, suggestion) {
    const columns = new Map(mapMetricColumns(dataset, suggestion).map(column => [column.name, column]));
    return (Array.isArray(suggestion?.metricButtons) ? suggestion.metricButtons : []).flatMap(button => {
      const column = columns.get(button?.field);
      if (!column || typeof button.label !== "string" || !button.label.trim() || typeof button.icon !== "string"
        || !button.icon.trim() || !/^#[0-9a-f]{6}$/i.test(button.color || "")) return [];
      return [{ ...button, unit: column.unit }];
    });
  }

  function renderMapMetricControls() {
    const control = $("map-metric-control");
    if (!control) return;
    const dataset = state.aiDataset;
    const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
    const buttons = context.modules.active()?.definition.id === suggestion?.chartType ? mapMetricButtons(dataset, suggestion) : [];
    control.hidden = buttons.length < (dataset?.metricFieldsConfigured ? 1 : 2);
    if (control.hidden) {
      $("map-metric-list").replaceChildren();
      context.tasks.mapMetricControlView = null;
      return;
    }
    const field = context.modules.active()?.metricField();
    const key = JSON.stringify(buttons);
    if (context.tasks.mapMetricControlView?.dataset !== dataset || context.tasks.mapMetricControlView.suggestionId !== suggestion.id || context.tasks.mapMetricControlView.key !== key) {
      const elements = buttons.map(item => {
        const { field, label, unit, icon, color } = item;
        const button = document.createElement("button"); button.type = "button"; button.className = "map-metric-button";
        button.dataset.metricField = field; button.title = unit ? `${label} (${unit})` : label;
        const copy = document.createElement("span"); copy.className = "map-metric-label";
        const title = document.createElement("span"); title.textContent = label; copy.append(title);
        if (unit) {
          const unitText = document.createElement("small"); unitText.textContent = unit; copy.append(unitText);
        }
        const preview = document.createElement("span"); preview.className = "map-metric-preview"; preview.setAttribute("aria-hidden", "true");
        preview.textContent = icon; preview.style.setProperty("--metric-color", color);
        button.append(copy, preview);
        return button;
      });
      $("map-metric-list").replaceChildren(...elements);
      context.tasks.mapMetricControlView = { dataset, suggestionId: suggestion.id, key, buttons: elements };
    }
    for (const button of context.tasks.mapMetricControlView.buttons) {
      const selected = button.dataset.metricField === field;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const collapsed = dataset.metricControlCollapsed === true;
    $("map-metric-list").hidden = collapsed;
    $("map-metric-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("map-metric-toggle").title = collapsed ? "Mở danh sách chỉ số" : "Thu gọn danh sách chỉ số";
    const selected = buttons.find(button => button.field === field);
    const column = dataset.analysis.columns.find(column => column.name === field);
    $("map-metric-caption").textContent = collapsed ? selected?.label || column?.labelVi || column?.name || "Chỉ số bản đồ" : "Chỉ số bản đồ";
    $("map-metric-count").textContent = String(buttons.length);
  }

  async function changeAiMapMetric(field) {
    const module = context.modules.active();
    if (!module?.metricColumns().some(column => column.name === field)) return;
    await module.changeMetric(field);
    for (const select of document.querySelectorAll('#ai-filter-controls .ai-metric-selector')) select.value = field;
    renderMapMetricControls();
  }

  function populateAiFilters(dataset) {
    const selected = dataset.suggestions.find(item => item.id === dataset.selectedSuggestionId);
    const filterModule=context.modules.get(selected?.chartType);
    if (filterModule?.populateFilters) return filterModule.populateFilters();
    const { records, recommendation } = dataset;
    const controls = $("ai-filter-controls");
    const initialFilters = {};
    const savedFilters = dataset.filters || {};
    const metricControls = [];
    const suggestion = dataset.suggestions.find(item => item.id === dataset.selectedSuggestionId);
    const measureColumns = mapMetricColumns(dataset, suggestion);
    if (recommendation.metricField && (measureColumns.length > 1 || filterModule?.definition.singleMetricSelector && measureColumns.length)) {
      const label = document.createElement("label"); const caption = document.createElement("span"); const select = keepSelectOpenAfterMouseClick(document.createElement("select"));
      caption.textContent = filterModule?.definition.metricCaption || "Chỉ số";
      select.className = "ai-metric-selector"; select.setAttribute("aria-label", "Chọn chỉ số hiển thị");
      select.replaceChildren(...measureColumns.map(column => Object.assign(document.createElement("option"), {
        value: column.name,
        textContent: column.labelVi || humanizeField(column.name)
      })));
      select.value = recommendation.metricField; label.append(caption, select); metricControls.push(label);
    }
    const filterControls = recommendation.filters.filter(filter => visibleDatasetColumns(dataset).some(column => column.name === filter.field)).flatMap(filter => {
      const column = dataset.analysis.columns.find(item => item.name === filter.field);
      const values = uniqueRecordValues(records, filter.field).sort((a, b) =>
        column?.role === "time" ? compareTimeValues(a[1], b[1], column) : String(a[1]).localeCompare(String(b[1]), "vi")
      );
      if (!values.length || values.length < 2 && !filter.showSingle) return [];
      const label = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = filter.label || filter.field;
      if (filter.toggle || filter.field === recommendation.geometry.field) {
        const multiselect = document.createElement("div");
        const toggle = document.createElement("button");
        const menu = document.createElement("div");
        const toggleText = document.createElement("span");
        const chevron = document.createElement("span");
        const selectedValues = values.filter(([value]) => Array.isArray(savedFilters[filter.field]) && savedFilters[filter.field].includes(value));
        multiselect.className = "ai-multiselect";
        toggle.type = "button";
        toggle.className = "ai-multiselect-toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggleText.textContent = selectedValues.length === 1 ? displayFilterValue(selectedValues[0][1], filter.control)
          : selectedValues.length > 1 ? `${selectedValues.length} giá trị đã chọn`
            : filter.emptyLabel || `Chọn ${caption.textContent.toLocaleLowerCase("vi")}`;
        chevron.textContent = "⌄";
        chevron.setAttribute("aria-hidden", "true");
        toggle.append(toggleText, chevron);
        menu.className = "ai-multiselect-menu";
        menu.hidden = true;
        menu.replaceChildren(...values.map(([value, raw]) => {
          const option = document.createElement("label");
          const input = document.createElement("input");
          const text = document.createElement("span");
          input.type = "checkbox";
          input.className = "ai-generated-filter";
          input.dataset.field = filter.field;
          if (filter.singleToggle) input.dataset.singleToggle = "true";
          input.value = value;
          input.checked = Array.isArray(savedFilters[filter.field]) && savedFilters[filter.field].includes(value);
          text.textContent = displayFilterValue(raw, filter.control);
          option.append(input, text);
          return option;
        }));
        multiselect.append(toggle, menu);
        initialFilters[filter.field] = selectedValues.map(([value]) => value);
        label.append(caption, multiselect);
        return [label];
      }
      const select = keepSelectOpenAfterMouseClick(document.createElement("select"));
      select.className = "ai-generated-filter";
      select.dataset.field = filter.field;
      select.setAttribute("aria-label", `Lọc theo ${caption.textContent}`);
      const options = filter.allowAll ? [["", `Tất cả ${caption.textContent.toLocaleLowerCase("vi")}`], ...values] : values;
      select.replaceChildren(...options.map(([value, raw]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value === "" ? raw : displayFilterValue(raw, filter.control);
        return option;
      }));
      if (savedFilters[filter.field] != null && options.some(([value]) => value === String(savedFilters[filter.field]))) {
        select.value = String(savedFilters[filter.field]);
      } else if (filter.default != null && options.some(([value]) => value === comparableFilterValue(filter.default))) {
        select.value = comparableFilterValue(filter.default);
      }
      initialFilters[filter.field] = select.value;
      label.append(caption, select);
      return [label];
    });
    if (mapRegistry[suggestion?.chartType]?.geometryProvider === "local-roads") {
      const mapControls = document.createElement("div"); mapControls.className = "ai-popup-map-controls";
      mapControls.append(...metricControls, ...filterControls);
      controls.replaceChildren(...services.popup.buildMapPopupControls(dataset, suggestion), mapControls);
    } else controls.replaceChildren(...metricControls, ...filterControls);
    dataset.filters = initialFilters;
    $("ai-data-filters").hidden = controls.children.length === 0;
    return initialFilters;
  }

  function selectedAiFilters() {
    const filters = {};
    for (const control of document.querySelectorAll("#ai-filter-controls .ai-generated-filter")) {
      if (control.type === "checkbox") {
        if (!filters[control.dataset.field]) filters[control.dataset.field] = [];
        if (control.checked) filters[control.dataset.field].push(control.value);
      } else filters[control.dataset.field] = control.value;
    }
    return filters;
  }

  function recommendationForSuggestion(suggestion) {
    const dataset = state.aiDataset;
    const columns = new Map(dataset.analysis.columns.map(column => [column.name, column]));
    const definition = mapRegistry[suggestion.chartType];
    const coordinateMap = Boolean(suggestion.bindings.lat && suggestion.bindings.lng);
    const coordinateLine = coordinateMap && definition.nativeKind === "line";
    const valueField = suggestion.bindings.value
      || (coordinateMap ? dataset.analysis.columns.find(column => column.role === "measure" && ![suggestion.bindings.lat, suggestion.bindings.lng, suggestion.bindings.x].includes(column.name))?.name : null) || null;
    const regionField = suggestion.bindings.region;
    const region = columns.get(regionField);
    const contextFields = definition.nativeKind === "area" ? administrativeContextFields(dataset.analysis.columns, regionField) : [];
    const areaField = !coordinateLine ? definition.areaField?.(dataset.analysis.columns) : null;
    const area = columns.get(areaField);
    const timeFilter = coordinateLine || !definition.timeFilter ? null : defaultTimeFilter(dataset.records, dataset.analysis.columns, suggestion.chartType);
    return {
      canRenderMap: true,
      visualization: definition.viewType,
      geometry: coordinateMap ? { field: regionField || null, latField: suggestion.bindings.lat, lngField: suggestion.bindings.lng, provider: "coordinates", placeType: coordinateLine ? "line" : "point" } : regionField
        ? { field: regionField, provider: definition.geometryProvider,
          placeType: region?.geoLevel === "country" ? "country" : region?.geoLevel === "admin2" ? "county" : "region",
          country: region?.geoLevel === "country" || contextFields.some(field => columns.get(field)?.geoLevel === "country") ? null : region?.country || null,
          ...(contextFields.length ? { contextFields } : {}) }
        : { field: null, latField: suggestion.bindings.lat, lngField: suggestion.bindings.lng, provider: "coordinates", placeType: "point" },
      metricField: valueField,
      geographicScopes: suggestion.geographicScopes || [],
      numericFields: dataset.analysis.columns.filter(column => column.role === "measure").map(column => column.name),
      filters: [
        ...(areaField && areaField !== regionField ? [{
          field: areaField, label: area?.labelVi || areaField, control: "select",
          toggle: true, singleToggle: true, showSingle: true, emptyLabel: "Chọn khu vực", fit: true
        }] : []),
        ...(regionField ? [{ field: regionField, label: region?.labelVi || regionField, control: "select", allowAll: true }] : []),
        ...(timeFilter ? [{ field: timeFilter.column, label: columns.get(timeFilter.column)?.labelVi || timeFilter.column, control: timeFilter.control, allowAll: false, default: timeFilter.default }] : [])
      ],
      title: suggestion.title,
      explanation: suggestion.reason,
      confidence: suggestion.effectiveConfidence,
      source: dataset.analysis.source,
      aggregation: valueField ? resolveAggregation(suggestion, dataset.analysis.columns) : null
    };
  }

  function createAiSuggestionButton(suggestion) {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const title = document.createElement("span");
    const reason = document.createElement("span");
    const score = document.createElement("span");
    button.type = "button";
    button.className = `map-type ai-suggestion${suggestion.id === state.aiDataset?.selectedSuggestionId ? " active" : ""}`;
    button.dataset.aiSuggestion = suggestion.id;
    button.dataset.type = suggestion.id;
    button.disabled = !suggestion.available && !suggestion.repairable;
    button.title = suggestion.available ? suggestion.reason : suggestion.repairable ? `${suggestion.unavailableReason} Bấm để sửa alias.` : suggestion.unavailableReason;
    renderMapIcon(icon, AI_CHART_REGISTRY[suggestion.chartType].icon);
    title.className = "ai-suggestion-title"; title.textContent = AI_CHART_REGISTRY[suggestion.chartType].label;
    reason.className = "ai-suggestion-reason"; reason.textContent = suggestion.available ? suggestion.reason : suggestion.unavailableReason;
    score.className = "ai-suggestion-score"; score.textContent = `${Math.round(suggestion.effectiveConfidence * 100)}%${suggestion.effectiveConfidence < .6 ? " ⚠" : ""}`;
    button.append(icon, title, reason, score);
    return button;
  }

  function renderAiSuggestionGrid() {
    if (!state.aiDataset) return;
    const grid = $("map-type-grid");
    const suggestions = mapDisplaySuggestions(state.aiDataset.suggestions, state.aiDataset.selectedSuggestionId);
    const suggestionButtons = suggestions.map(createAiSuggestionButton);
    const suggestionHeading = document.createElement("div");
    suggestionHeading.className = "ai-manual-heading ai-suggestion-heading";
    suggestionHeading.textContent = suggestions.length
      ? "AI đề xuất"
      : "Chưa có kiểu bản đồ phù hợp được đề xuất";
    grid.className = "map-type-grid has-ai-suggestions";
    grid.replaceChildren(suggestionHeading, ...suggestionButtons);
    const source = "AI";
    $("map-type-summary").textContent = `${state.aiDataset.analysis.datasetTitle} · ${state.aiDataset.analysis.grain} · ${suggestions.length} đề xuất từ ${source}`;
    showSupportedChartCatalog(false);
  }

  function aiField(caption, control) {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = caption;
    label.append(text, control);
    return label;
  }

  function aiSelect(className, choices, value) {
    const select = document.createElement("select");
    select.className = className;
    select.replaceChildren(...choices.map(([optionValue, text]) =>
      Object.assign(document.createElement("option"), { value: optionValue, textContent: text })));
    select.value = value;
    return keepSelectOpenAfterMouseClick(select);
  }

  function bindUI() {
    for (const module of context.modules.instances.values()) module.bindControls();
    $("map-metric-toggle").addEventListener("click", () => {
      if (!state.aiDataset) return;
      state.aiDataset.metricControlCollapsed = !state.aiDataset.metricControlCollapsed;
      renderMapMetricControls();
    });
    $("map-metric-list").addEventListener("click", async event => {
      const button = event.target.closest(".map-metric-button");
      if (button) await changeAiMapMetric(button.dataset.metricField);
    });
    $("basemap-options").addEventListener("click", event => {
      const option = event.target.closest(".basemap-option");
      if (option) services.view.selectMapStyle(option.dataset.mapStyle);
    });

    $("ai-filter-controls").addEventListener("change", async event => {
      if (event.target.matches(".ai-popup-metric, .ai-popup-metric-checkbox, .ai-popup-aggregation, .ai-popup-range")) {
        services.popup.changeMapPopupControl(event.target);
        return;
      }
      if (await context.modules.active()?.handleChange(event)) return;
      if (event.target.matches(".ai-metric-selector")) {
        await changeAiMapMetric(event.target.value);
        return;
      }
      if (!event.target.matches(".ai-generated-filter")) return;
      if (event.target.dataset.dimensionFilter === "true" && context.modules.active()?.presentation().regionHex) {
        state.aiDataset.filters = selectedAiFilters();
        populateAiFilters(state.aiDataset);
      }
      if (event.target.dataset.singleToggle === "true" && event.target.checked) {
        for (const control of document.querySelectorAll("#ai-filter-controls .ai-generated-filter")) {
          if (control !== event.target && control.dataset.field === event.target.dataset.field) control.checked = false;
        }
      }
      if (event.target.type === "checkbox") {
        const picker = event.target.closest(".ai-multiselect");
        const summary = picker?.querySelector(".ai-multiselect-toggle span");
        const checked = picker ? [...picker.querySelectorAll(".ai-generated-filter:checked")] : [];
        if (summary) summary.textContent = checked.length === 0
          ? state.aiDataset.recommendation.filters.find(filter => filter.field === event.target.dataset.field)?.emptyLabel || `Chọn ${event.target.dataset.field.toLocaleLowerCase("vi")}`
          : checked.length === 1 ? checked[0].value : `${checked.length} giá trị đã chọn`;
      }
      const filter = state.aiDataset?.recommendation?.filters.find(item => item.field === event.target.dataset.field);
      const shouldFit = event.target.dataset.dimensionFilter === "true" || filter?.fit || event.target.dataset.field === state.aiDataset?.recommendation?.geometry?.field;
      await context.modules.active()?.update({ fit: shouldFit });
    });
    $("ai-filter-controls").addEventListener("click", event => {
      const popupType = event.target.closest(".ai-popup-type");
      if (popupType) {
        if (!services.popup.activeMapPopupSuggestion() || popupType.disabled) return;
        const selection = services.popup.popupSelectionFor();
        selection.mode = popupType.dataset.popupMode;
        services.popup.popupSelectionFor();
        services.popup.refreshMapPopupControls();
        return;
      }
      const popupVariant = event.target.closest("[data-popup-bar-variant]");
      if (popupVariant) {
        if (!services.popup.activeMapPopupSuggestion() || popupVariant.disabled) return;
        const selection = services.popup.popupSelectionFor();
        if (selection.mode !== "bar") return;
        selection.bar.variant = popupVariant.dataset.popupBarVariant;
        selection.bar.metrics = defaultBarMetrics({ bindings: { y: selection.bar.metrics[0] } }, popupChartColumns(state.aiDataset.analysis.columns, services.popup.activeMapPopupSuggestion().bindings), selection.bar.variant);
        services.popup.refreshMapPopupControls();
        return;
      }
      if (context.modules.active()?.handleClick(event)) return;

      if (context.modules.active()?.handleClick(event)) return;
      const toggle = event.target.closest(".ai-multiselect-toggle");
      if (!toggle) return;
      const menu = toggle.nextElementSibling;
      const open = menu.hidden;
      document.querySelectorAll(".ai-multiselect-menu").forEach(item => { item.hidden = true; });
      document.querySelectorAll(".ai-multiselect-toggle").forEach(item => item.setAttribute("aria-expanded", "false"));
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    $("ai-filter-controls").addEventListener("input", event => {
      if (!event.target.matches(".ai-series-search")) return;
      const query = event.target.value.trim().toLocaleLowerCase("vi");
      event.target.closest(".ai-series-picker").querySelectorAll(".ai-series-list label").forEach(row => {
        row.hidden = Boolean(query) && !row.textContent.toLocaleLowerCase("vi").includes(query);
      });
    });

    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => { document.querySelectorAll(".tab,.tab-panel").forEach(x => x.classList.remove("active")); tab.classList.add("active"); document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active"); }));
    $("map-type-grid").addEventListener("click", async event => {
      const button = event.target.closest(".map-type");
      if (!button) return;
      if (button.dataset.aiSuggestion) {
        try { await services.runtime.selectAiSuggestion(button.dataset.aiSuggestion); }
        catch (error) { if (error?.name !== "AbortError") { console.error(error); showToast(error.message || "Không thể dựng đề xuất này."); } }
        return;
      }
      document.querySelectorAll(".map-type").forEach(x => x.classList.remove("active"));
      button.classList.add("active");
      context.modules.active()?.clear();
      state.mapType = button.dataset.type;
      updateModelSections();
      services.view.applyStyle();
      setStatus(`Đang hiển thị kiểu ${button.dataset.label}.`, true);
    });
    services.input.bindFileDropZone();
    $("apply-sheet").addEventListener("click", async () => {
      const pending = state.pendingSheet;
      if (!pending) return;
      context.tasks.tabularAbortController?.abort(); context.tasks.tabularAbortController = services.runtime.createAbortController(); const revision = ++context.tasks.tabularLoadRevision;
      try {
        setStatus(`Đang phân tích sheet ${$("sheet-selector").value}…`);
        const result = await services.input.readSpatialFile(pending.file, { sheetName: $("sheet-selector").value, signal: context.tasks.tabularAbortController.signal });
        if (revision !== context.tasks.tabularLoadRevision) return;
        state.pendingSheet = null; $("sheet-selector-field").hidden = true;
        await services.input.applyReadResult(result, pending.file);
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error(error);
          const message = error.message || "Không thể đọc sheet.";
          setStatus(message, true);
        }
      }
    });
    $("uploaded-layer-list").addEventListener("click", event => {
      const button = event.target.closest(".remove-uploaded-layer");
      if (button?.dataset.uploadId) services.uploads.removeUploadedFile(button.dataset.uploadId);
    });
    $("remove-current-file").addEventListener("click", () => {
      services.runtime.deleteData();
      setStatus("Đã xóa file dữ liệu.", true);
    });

    $("apply-coordinates").addEventListener("click", async () => { try { const raw = $("coordinate-input").value.trim(); let data; if (raw.startsWith("{")) data = JSON.parse(raw); else { const ring = raw.split(/\n/).map(line => line.split(",").map(Number)); if (ring.length < 3 || ring.some(p => p.length < 2 || p.some(Number.isNaN))) throw new Error("Cần ít nhất 3 dòng lng,lat."); ring.push(ring[0]); data = { type: "Polygon", coordinates: [ring] }; } await services.runtime.replaceBoundary(data, "Tọa độ nhập trực tiếp"); } catch (error) { showToast(error.message); } });
    for (const [toggleId, controlsId] of [["feature-toggle", "feature-controls"], ["style-toggle", "style-controls"]]) {
      $(toggleId).addEventListener("click", () => { const open = $(toggleId).getAttribute("aria-expanded") === "true"; $(toggleId).setAttribute("aria-expanded", String(!open)); $(controlsId).style.display = open ? "none" : ""; });
    }
    $("show-map-layers").addEventListener("change", e => { options.onVisibility?.(e.target.checked); $("show-map-layers-status").textContent = e.target.checked ? "Đang bật" : "Đang tắt"; services.view.applyMapLayerVisibility(); });
    $("reset-config").addEventListener("click", async () => {
      try {
        await services.runtime.resetConfiguration();
        setStatus("Đã đặt lại cấu hình mặc định.", true);
      } catch (error) { console.error(error); setStatus("Không thể đặt lại cấu hình."); showToast(error.message); }
    });
    $("clear-data").addEventListener("click", () => {
      services.runtime.deleteData();
      setStatus("Đã xóa dữ liệu. Hãy upload dữ liệu để bắt đầu.", true);
    });
    if (!options.managedWorkspace) {
      $("zoom-in").addEventListener("click", () => context.map.zoomIn()); $("zoom-out").addEventListener("click", () => context.map.zoomOut()); $("fullscreen").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector(".map-panel").requestFullscreen());
      const compass = $("map-compass");
      if (compass) {
        const updateCompass = () => { compass.querySelector(".compass-icon").style.transform = `rotate(${-context.map.getBearing()}deg)`; };
        compass.addEventListener("click", () => context.map.easeTo({ bearing: 0, duration: 300 }));
        context.map.on("rotate", updateCompass);
        updateCompass();
      }
    }
  }

  return { showToast, setStatus, fmt, renderSupportedChartCatalog, showSupportedChartCatalog, updateModelSections, renderCompatibleMapTypes, uniqueRecordValues, mapMetricColumns, mapMetricButtons, renderMapMetricControls, changeAiMapMetric, populateAiFilters, selectedAiFilters, recommendationForSuggestion, createAiSuggestionButton, renderAiSuggestionGrid, aiField, aiSelect, bindUI };
}

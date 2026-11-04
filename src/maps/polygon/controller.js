import { updateRegionHexControls } from "./controls.js";
import { CONFIG as default_CONFIG } from "../../shared/config.js";
import { buildRegionHexGrid as default_buildRegionHexGrid } from "./region-grid.js";
import { analyzeSpatialData as default_analyzeSpatialData } from "../../shared/data/data-capabilities.js";
import { humanizeField as default_humanizeField } from "../../charts/data-transformers.js";
import { polygonColorField as default_polygonColorField } from "./style.js";
import { polygonLegendScale as default_polygonLegendScale } from "./style.js";
import { featureCategoryValues as default_featureCategoryValues } from "../../shared/data/categorical-color.js";
import { polygonLegendLabels as default_polygonLegendLabels } from "../../shared/data/polygon-legend.js";
import { resolvePolygonLegendConfig as default_resolvePolygonLegendConfig } from "../../shared/data/polygon-legend.js";
import { polygonLegendKey as default_polygonLegendKey } from "../../shared/data/polygon-legend-contract.js";
import { polygonLegendTarget as default_polygonLegendTarget } from "../../shared/data/polygon-legend-contract.js";
import { focusMapOnFeature as default_focusMapOnFeature } from "../../shared/search/map-search.js";
import { landOnlyBoundary as default_landOnlyBoundary } from "../../shared/search/map-search.js";
import { administrativeBoundaryLabel as default_administrativeBoundaryLabel } from "../../shared/geography/administrative-boundaries.js";
import { loadAdministrativeBoundaries as default_loadAdministrativeBoundaries } from "../../shared/geography/administrative-boundaries.js";
import { requestRegionBoundary } from '../../shared/geography/region-boundary-lookup.js';
import { comparableFilterValue as default_comparableFilterValue } from "../../shared/import/ai-data-analysis.js";
import { geographicLocationName as default_geographicLocationName } from "../../shared/import/ai-chart-pipeline.js";
import { applyPipelineFilters as default_applyPipelineFilters } from "../../shared/import/ai-chart-pipeline.js";
import { resolveAggregation as default_resolveAggregation } from "../../shared/import/ai-chart-pipeline.js";
import { formatTimeValue as default_formatTimeValue } from "../../shared/data/time-values.js";
import { uniqueTimeValues as default_uniqueTimeValues } from "../../shared/data/time-values.js";
import { popupTimeColumn as default_popupTimeColumn } from "../../shared/popup/ai-popup-chart.js";
import { collapseCountryFeatures as default_collapseCountryFeatures } from "../../shared/geography/vietnam-admin-data.js";
import { joinRecordsToMapTilerBoundaries as default_joinRecordsToMapTilerBoundaries } from "../../shared/geography/vietnam-admin-data.js";

/** polygon operations for one workspace layer. */
export function createController(context) {
  const { state, document, maplibregl, options, services } = context;

  const $ = id => document.getElementById(id);

  const CONFIG = context.dependencies?.CONFIG ?? default_CONFIG;

  const buildRegionHexGrid = (...args) => (context.dependencies?.buildRegionHexGrid ?? default_buildRegionHexGrid)(...args);

  const analyzeSpatialData = (...args) => (context.dependencies?.analyzeSpatialData ?? default_analyzeSpatialData)(...args);

  const humanizeField = (...args) => (context.dependencies?.humanizeField ?? default_humanizeField)(...args);

  const polygonColorField = (...args) => (context.dependencies?.polygonColorField ?? default_polygonColorField)(...args);

  const polygonLegendScale = (...args) => (context.dependencies?.polygonLegendScale ?? default_polygonLegendScale)(...args);

  const featureCategoryValues = (...args) => (context.dependencies?.featureCategoryValues ?? default_featureCategoryValues)(...args);

  const polygonLegendLabels = (...args) => (context.dependencies?.polygonLegendLabels ?? default_polygonLegendLabels)(...args);

  const resolvePolygonLegendConfig = (...args) => (context.dependencies?.resolvePolygonLegendConfig ?? default_resolvePolygonLegendConfig)(...args);

  const polygonLegendKey = (...args) => (context.dependencies?.polygonLegendKey ?? default_polygonLegendKey)(...args);

  const polygonLegendTarget = (...args) => (context.dependencies?.polygonLegendTarget ?? default_polygonLegendTarget)(...args);

  const focusMapOnFeature = (...args) => (context.dependencies?.focusMapOnFeature ?? default_focusMapOnFeature)(...args);

  const landOnlyBoundary = (...args) => (context.dependencies?.landOnlyBoundary ?? default_landOnlyBoundary)(...args);

  const administrativeBoundaryLabel = (...args) => (context.dependencies?.administrativeBoundaryLabel ?? default_administrativeBoundaryLabel)(...args);

  const loadAdministrativeBoundaries = (...args) => (context.dependencies?.loadAdministrativeBoundaries ?? default_loadAdministrativeBoundaries)(...args);

  const comparableFilterValue = (...args) => (context.dependencies?.comparableFilterValue ?? default_comparableFilterValue)(...args);

  const geographicLocationName = (...args) => (context.dependencies?.geographicLocationName ?? default_geographicLocationName)(...args);

  const applyPipelineFilters = (...args) => (context.dependencies?.applyPipelineFilters ?? default_applyPipelineFilters)(...args);

  const resolveAggregation = (...args) => (context.dependencies?.resolveAggregation ?? default_resolveAggregation)(...args);

  const formatTimeValue = (...args) => (context.dependencies?.formatTimeValue ?? default_formatTimeValue)(...args);

  const uniqueTimeValues = (...args) => (context.dependencies?.uniqueTimeValues ?? default_uniqueTimeValues)(...args);

  const popupTimeColumn = (...args) => (context.dependencies?.popupTimeColumn ?? default_popupTimeColumn)(...args);

  const collapseCountryFeatures = (...args) => (context.dependencies?.collapseCountryFeatures ?? default_collapseCountryFeatures)(...args);

  const joinRecordsToMapTilerBoundaries = (...args) => (context.dependencies?.joinRecordsToMapTilerBoundaries ?? default_joinRecordsToMapTilerBoundaries)(...args);

  function activePolygonSuggestion() {
    const dataset = state.aiDataset;
    const suggestion = dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
    return suggestion?.chartType === "choropleth" ? suggestion : null;
  }

  function isRegionHexMode() {
    return state.mapType === "polygon" && state.regionHexEnabled;
  }

  function syncRegionHexControls() { updateRegionHexControls(document,state); }

  function fillExpression() {
    return $("fixed-color").value;
  }

  function usesDefaultPolygonColor() {
    const suggestion = activePolygonSuggestion();
    return Boolean(suggestion) && !suggestion.bindings.value;
  }

  function usesCategoricalPolygonColor() {
    const field = activePolygonSuggestion()?.bindings.value;
    return Boolean(field) && state.aiDataset.analysis.columns.some(column => column.name === field && column.role === "category");
  }

  function activePolygonLegendScale() {
    const suggestion = activePolygonSuggestion();
    if (!suggestion?.bindings.value || state.mapType !== "polygon") return null;
    const dataset = state.aiDataset; const columns = dataset.analysis.columns;
    const cache = dataset.polygonLegendScaleCache ||= { resolved: null, logged: new Set() };
    const column = columns.find(item => item.name === suggestion.bindings.value);
    const aggregation = resolveAggregation(suggestion, columns);
    const key = polygonLegendKey(polygonLegendTarget(column, aggregation));
    const cached = cache.resolved;
    if (cached && cached.data === state.boundary && cached.key === key
      && cached.columnLegend === column?.legend && cached.suggestionLegend === suggestion.legend && cached.title === column?.labelVi) return cached.scale;
    const scale = resolvePolygonLegendConfig({ suggestion, columnMetadata: columns, aggregatedFeatures: state.boundary,
      aggregation,
      onFallback: ({ code, reason }) => {
        const logKey = `${key}:${code}`;
        if (cache.logged.has(logKey)) return;
        cache.logged.add(logKey); console.debug("Polygon legend fallback", { code, field: suggestion.bindings.value, aggregation, reason });
      } });
    cache.resolved = { data: state.boundary, key, columnLegend: column?.legend,
      suggestionLegend: suggestion.legend, title: column?.labelVi, scale };
    return scale;
  }

  function syncPolygonPaletteControls(resolvedScale = activePolygonLegendScale()) {
    const thematicData = state.mapType === "h3" ? state.h3Data : state.boundary;
    const fixed = usesDefaultPolygonColor();
    const colorField = fixed ? null : resolvedScale ? { field: resolvedScale.field } : polygonColorField(thematicData, state.dataProfile);
    const managed = Boolean(resolvedScale);
    $("fixed-color").disabled = managed;
    $("polygon-color-label").textContent = fixed ? "Màu mặc định" : managed ? "Chú giải màu" : "Dải màu";
    $("polygon-palette-options").hidden = managed || fixed;
    $("polygon-palette-help").hidden = managed || fixed;
    const summary = $("polygon-legend-summary");
    summary.hidden = !managed;
    if (managed) {
      const status = !resolvedScale.hasData ? "Không có dữ liệu"
        : resolvedScale.source === "ai" ? "Chú giải do AI đề xuất" : "Chú giải dự phòng";
      summary.textContent = `${resolvedScale.title}${resolvedScale.unit ? ` (${resolvedScale.unit})` : ""} · ${status}`;
      summary.style.setProperty("--legend-gradient", resolvedScale.gradient || resolvedScale.noDataColor);
      summary.title = resolvedScale.reason;
    }
    $("polygon-color-field").textContent = fixed ? "Màu mặc định" : colorField ? `Theo ${humanizeField(colorField.field)}` : "Cần thuộc tính dữ liệu";
    document.querySelectorAll("#polygon-color-ramp .palette").forEach(button => {
      button.disabled = managed || !colorField;
      button.classList.toggle("active", !managed && button.dataset.palette === state.polygonPalette);
    });
  }

  function renderWeatherLegend(resolvedScale = activePolygonLegendScale()) {
    const legend = $("weather-legend");
    const isAiMap = Boolean(state.aiDataset) && state.mapType === "polygon";
    const show = $("show-map-layers").checked && isAiMap && !usesDefaultPolygonColor();
    legend.hidden = !show;
    if (!show) return;
    const mode = $("weather-legend-mode");
    mode.hidden = !resolvedScale;
    const data = state.mapType === "h3" ? state.h3Data : state.boundary;
    const scale = polygonLegendScale(data, state.dataProfile, state.polygonPalette, resolvedScale);
    if (!scale) { legend.hidden = true; return; }
    const categorical = scale.type === "categorical";
    $("weather-legend-labels").classList.toggle("positioned", Boolean(resolvedScale) && !categorical);
    $("weather-legend-labels").classList.toggle("categorical", categorical);
    $("weather-legend-scale").hidden = categorical;
    const metric = state.aiDataset.recommendation.metricField;
    const column = state.aiDataset.analysis.columns.find(item => item.name === metric);
    const unit = resolvedScale ? scale.unit : column?.unit || "";
    const title = resolvedScale ? scale.title : column?.labelVi || metric;
    $("weather-legend-title").textContent = `${title}${unit && !title.includes(unit) ? ` (${unit})` : ""}`;
    mode.textContent = categorical ? "Theo phân loại" : scale.source === "technical-fallback" ? "Chú giải dự phòng"
      : scale.mode === "semantic" ? "Theo ngữ nghĩa" : "Theo dữ liệu";
    mode.title = scale.reason || "";
    if (categorical) renderCategoricalPolygonLegend(scale);
    else {
      $("weather-legend-scale").style.setProperty('background', scale.gradient, 'important');
      const labels = resolvedScale ? polygonLegendLabels(scale, Math.max(100, (legend.clientWidth || 330) - 40))
        : scale.values.map(value => ({ value, text: Number(value.toFixed(1)).toLocaleString("vi-VN") }));
      $("weather-legend-scale").replaceChildren(...labels.filter(item => item.position != null).map(item => {
        const tick = document.createElement("i");
        tick.className = "polygon-legend-tick";
        tick.style.left = `${item.position}%`;
        return tick;
      }));
      $("weather-legend-labels").style.height = resolvedScale ? `${(Math.max(0, ...labels.map(item => item.row)) + 1) * 14}px` : "";
      $("weather-legend-labels").replaceChildren(...labels.map(item => {
        const label = document.createElement("span");
        label.textContent = item.text;
        if (item.position != null) {
          label.style.left = item.offset ? `calc(${item.position}% + ${item.offset}px)` : `${item.position}%`;
          label.style.top = `${item.row * 14}px`;
        }
        return label;
      }));
    }
    const time = state.aiDataset.analysis.columns.find(item => item.role === "time");
    const period = time && state.aiDataset.filters?.[time.name] ? formatTimeValue(state.aiDataset.filters[time.name], time) : "";
    $("weather-legend-note").textContent = [period,
      categorical && scale.mixed.some(entry => !entry.color) ? "Chưa có màu AI cho một số tổ hợp phân loại." : "",
      categorical && scale.unmappedValues.length ? `Chưa có màu AI cho: ${scale.unmappedValues.join(", ")}.` : "",
      isRegionHexMode() ? `Dữ liệu tải lên · H3 res ${state.regionHexResolution}` : "Dữ liệu tải lên · Polygon"].filter(Boolean).join(" · ");
  }

  function renderCategoricalPolygonLegend(scale) {
    const rows = [...scale.entries.map(entry => ({ label: entry.value, background: entry.color, count: entry.count })),
      ...scale.mixed.map(entry => {
        const values = entry.values;

        return { label: `Bao gồm ${values.slice(0, -1).join(", ")} và ${values.at(-1)}${entry.color ? "" : " (chưa có màu AI)"}`,
          background: entry.color || scale.noDataColor, count: entry.count, mixed: true };
      })];
    $("weather-legend-labels").style.height = "";
    $("weather-legend-labels").replaceChildren(...rows.map(item => {
      const row = document.createElement("div"); row.className = "categorical-legend-row";
      if (item.mixed) row.className += " categorical-legend-mixed";
      const swatch = document.createElement("i"); swatch.style.background = item.background; swatch.setAttribute("aria-hidden", "true");
      const label = document.createElement("span"); label.textContent = item.label;
      const count = document.createElement("b"); count.textContent = String(item.count);
      row.append(swatch, label, count); return row;
    }));
  }

  function renderScopeLegend() {
    const legend = $("scope-legend");
    if (!legend) return;
    const markers = activePolygonSuggestion() ? (state.boundary?.features || []).filter(feature =>
      feature.geometry?.type === "Point" && feature.properties?.__geographic_scope === "marker") : [];
    legend.hidden = !$("show-map-layers").checked || !markers.length || state.mapType !== "polygon";
    if (legend.hidden) return;
    legend.replaceChildren(...markers.map(feature => {
      const row = document.createElement("div"); row.className = "scope-legend-row";
      const icon = document.createElement("i"); icon.setAttribute("aria-hidden", "true");
      const name = String(feature.properties.__scope_label || "").trim().replace(/(?:\s*[-–—]\s*lớp\s+riêng)+\s*$/iu, "").trim();
      const label = document.createElement("span"); label.textContent = `${name} - lớp riêng`;
      row.append(icon, label); return row;
    }));
    if (usesDefaultPolygonColor()) {
      $("weather-legend").hidden = false;
      $("weather-legend-title").textContent = "Chú giải";
      $("weather-legend-mode").hidden = true;
      $("weather-legend-scale").hidden = true;
      $("weather-legend-labels").replaceChildren();
      $("weather-legend-note").textContent = "";
    }
  }

  async function rebuildRegionHexGrid({ fit = false } = {}) {
    const revision = ++context.tasks.regionHexBuildRevision;
    const boundary = state.boundary;
    const requestedResolution = state.regionHexResolution;
    if (!boundary || !isRegionHexMode()) return;
    services.ui.setStatus(`Đang tạo lưới lục giác ở độ phân giải ${requestedResolution}…`);
    await new Promise(resolve => setTimeout(resolve, 20));
    if (revision !== context.tasks.regionHexBuildRevision || boundary !== state.boundary || !isRegionHexMode()) return;
    try {
      const result = buildRegionHexGrid(boundary, requestedResolution, CONFIG.MAX_RENDER_CELLS);
      state.h3Data = result.data;
      state.regionHexResolution = result.resolution;
      syncRegionHexControls();
      context.map.getSource("h3-grid")?.setData(state.h3Data);
      const count = result.data.features.length;
      $("region-hex-note").textContent = result.resolution !== requestedResolution
        ? `Đã dùng độ phân giải ${result.resolution} để giữ số ô trong giới hạn ${CONFIG.MAX_RENDER_CELLS.toLocaleString("vi-VN")} ô.`
        : !count ? "Chưa có ô ở độ phân giải này. Tăng độ phân giải để hiển thị vùng nhỏ." : "";
      services.view.updateDashboard();
      syncPolygonPaletteControls(); services.view.applyStyle();
      if (fit && count) services.view.fitBoundary();
      services.ui.setStatus(`Đã vẽ ${count.toLocaleString("vi-VN")} ô lục giác.`, true);
    } catch (error) {
      state.regionHexEnabled = false;
      syncRegionHexControls(); services.view.applyStyle();
      $("region-hex-note").textContent = error.message || "Không thể tạo lưới lục giác.";
      services.ui.setStatus("Không thể tạo lưới lục giác.", true);
    }
  }

  async function refreshBoundary({ fit = false } = {}) {
    if (isRegionHexMode()) return rebuildRegionHexGrid({ fit });
    if (fit) services.view.fitBoundary();
    syncPolygonPaletteControls(); services.view.applyStyle(); services.view.updateDashboard();
  }

  function boundaryProvinceName(feature) {
    const properties = feature?.properties || {};
    return properties.__province_name
      || properties.NAME_1;
  }

  function provinceNames(data) {
    if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) return [];
    return [...new Set(data.features.map(boundaryProvinceName).filter(name => typeof name === "string" && name.trim()))]
      .sort((a, b) => a.localeCompare(b, "vi"));
  }

  function formatProvinceName(name) {
    return name.replace(/([\p{Ll}])([\p{Lu}])/gu, "$1 $2");
  }

  function setupProvinceFilter(data) {
    const names = provinceNames(data); const field = $("province-filter-field"); const options = $("province-filter-options");
    options.replaceChildren(...names.map(name => {
      const label = document.createElement("label"); const input = document.createElement("input"); const text = document.createElement("span");
      input.type = "checkbox"; input.value = name; text.textContent = formatProvinceName(name); label.append(input, text); return label;
    }));
    $("province-filter-label").textContent = "Tất cả tỉnh/thành"; $("province-filter-menu").hidden = true; $("province-filter-toggle").setAttribute("aria-expanded", "false"); field.hidden = names.length === 0;
  }

  function selectedProvinceNames() {
    return [...document.querySelectorAll('#province-filter-options input:checked')].map(input => input.value);
  }

  function updateProvinceFilterLabel(names = selectedProvinceNames()) {
    $("province-filter-label").textContent = names.length === 0 ? "Tất cả tỉnh/thành" : names.length === 1 ? formatProvinceName(names[0]) : `${names.length} tỉnh/thành đã chọn`;
  }

  function boundaryForProvinces(data, names) {
    if (!names.length || data?.type !== "FeatureCollection") return data;
    const selected = new Set(names); return { ...data, features: data.features.filter(feature => selected.has(boundaryProvinceName(feature))) };
  }

  function polygonDimensionChoices(dataset, suggestion) {
    const geoOrder = { country: 0, admin1: 1, admin2: 2 };
    const priority = column => column.role === "geo" ? geoOrder[column.geoLevel] ?? 3 : 4;
    const columns = dataset.analysis.columns.filter(column =>
      !column.name.startsWith("__") && !["point_lat", "point_lng", "h3"].includes(column.geoLevel)
      && (column.role === "geo" || column.role === "category" || column.name === suggestion.bindings.region)
    ).sort((a, b) => priority(a) - priority(b));
    let records = dataset.records;
    return columns.flatMap(column => {
      const choices = services.ui.uniqueRecordValues(records, column.name).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "vi"));
      // Keep the dimension visible even if the selected parent has no value for it.
      if (!choices.length && !services.ui.uniqueRecordValues(dataset.records, column.name).length) return [];
      const saved = dataset.filters?.[column.name];
      const value = choices.some(([key]) => key === saved) ? saved : "";
      if (value !== "") records = applyPipelineFilters(records, { [column.name]: value });
      return [{ column, choices, value }];
    });
  }

  function populatePolygonFilters(dataset, suggestion) {
    const columns = dataset.analysis.columns;
    const time = popupTimeColumn(columns);
    const nodes = services.popup.buildMapPopupControls(dataset, suggestion);
    const mapControls = document.createElement("div"); mapControls.className = "ai-popup-map-controls";
    const measures = services.ui.mapMetricColumns(dataset, suggestion);
    if (measures.length) mapControls.append(services.ui.aiField("Chỉ số tô màu bản đồ", services.ui.aiSelect("ai-metric-selector",
      measures.map(column => [column.name, column.labelVi || humanizeField(column.name)]), dataset.recommendation.metricField)));
    const filters = {};
    const times = time ? uniqueTimeValues(dataset.records, time) : [];
    if (times.length) {
      const choices = times.map(value => [comparableFilterValue(value), formatTimeValue(value, time,
        value instanceof Date && Boolean(value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds()))]);
      const saved = dataset.filters?.[time.name];
      const value = choices.some(([key]) => key === saved) ? saved : choices.at(-1)[0];
      const control = services.ui.aiSelect("ai-generated-filter", choices, value);
      control.dataset.field = time.name; control.setAttribute("aria-label", "Ngày hiển thị bản đồ");
      filters[time.name] = value;
      mapControls.append(services.ui.aiField("Ngày hiển thị", control));
    }
    for (const { column, choices, value } of polygonDimensionChoices(dataset, suggestion)) {
      const caption = column.labelVi || humanizeField(column.name);
      const control = services.ui.aiSelect("ai-generated-filter", [["", `Tất cả ${caption.toLocaleLowerCase("vi")}`], ...choices], value);
      control.dataset.field = column.name;
      control.dataset.dimensionFilter = "true";
      control.setAttribute("aria-label", `Lọc theo ${caption}`);
      filters[column.name] = value;
      mapControls.append(services.ui.aiField(caption, control));
    }
    nodes.push(mapControls);
    const controls = $("ai-filter-controls");
    const repair = controls.querySelector(".geo-repair");
    controls.replaceChildren(...nodes, ...(repair ? [repair] : []));
    $("ai-data-filters").hidden = false;
    dataset.filters = filters;
    renderGeoRepair(dataset.geoMatch?.unmatched || suggestion.geoUnmatched || []);
    return filters;
  }

  function renderGeoRepair(unmatched = []) {
    const controls = $("ai-filter-controls");
    const previous = controls.querySelector(".geo-repair");
    const locations = JSON.stringify(unmatched);
    // Metadata/filter refreshes must preserve choices and aliases not yet applied.
    if (previous && previous.geoMatch === state.aiDataset.geoMatch && previous.dataset.locations === locations) return;
    previous?.remove();
    if (!unmatched.length) return;
    const panel = document.createElement("div"); const title = document.createElement("b"); const button = document.createElement("button");
    panel.className = "geo-repair"; title.textContent = `Chưa khớp ${unmatched.length} địa danh`;
    panel.geoMatch = state.aiDataset.geoMatch; panel.dataset.locations = locations;
    panel.append(title, ...unmatched.map(name => {
      const row = document.createElement("label"); const original = document.createElement("span"); const input = document.createElement("input");
      row.className = "geo-repair-row"; original.textContent = name; input.className = "geo-alias-input"; input.dataset.location = name;
      const scopeIssue = state.aiDataset.geoMatch?.scopeIssues?.[name];
      if (scopeIssue) {
        const note = document.createElement("small"); note.textContent = scopeIssue;
        row.append(original, note); return row;
      }
      input.value = state.aiDataset.geoAliases?.[name] || ""; input.placeholder = "Tên địa danh, tỉnh/thành";
      const fields = document.createElement("div"); fields.className = "geo-repair-fields";
      const candidates = state.aiDataset.geoMatch?.candidates?.[name] || [];
      if (candidates.length > 1) {
        const choice = document.createElement("select"); choice.className = "geo-boundary-choice"; choice.dataset.location = name;
        choice.setAttribute("aria-label", `Chọn ranh giới cho ${name}`);
        const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = `Có ${candidates.length} kết quả — chọn vùng`; choice.append(placeholder);
        const labels = candidates.map(administrativeBoundaryLabel);
        for (const [index, feature] of candidates.entries()) {
          const option = document.createElement("option"); option.value = feature.id;
          const center = feature.center || (feature.bbox && [(feature.bbox[0] + feature.bbox[2]) / 2, (feature.bbox[1] + feature.bbox[3]) / 2]);
          const duplicate = labels.indexOf(labels[index]) !== labels.lastIndexOf(labels[index]);
          option.textContent = `${labels[index]}${duplicate && center ? ` (${center[1].toFixed(3)}, ${center[0].toFixed(3)})` : ""}`;
          choice.append(option);
        }
        choice.value = state.aiDataset.geoSelections?.[name]?.id || "";
        choice.addEventListener("change", () => {
          const feature = candidates.find(candidate => candidate.id === choice.value);
          if (feature) focusMapOnFeature(context.map, feature);
        });
        fields.append(choice);
      }
      fields.append(input); row.append(original, fields); return row;
    }));
    button.type = "button"; button.className = "secondary-button apply-geo-aliases"; button.textContent = "Thử ghép lại";
    button.hidden = unmatched.every(name => state.aiDataset.geoMatch?.scopeIssues?.[name]);
    panel.append(button); controls.append(panel); $("ai-data-filters").hidden = false;
  }

  async function filteredAiBoundary({ fit = false } = {}) {
    if (!state.aiDataset) return;
    if (state.aiDataset.nativeGeometry) return services.runtime.refreshNativeMap({ fit });
    const selected = state.aiDataset.suggestions?.find(item => item.id === state.aiDataset.selectedSuggestionId);
    if (selected?.chartType !== "choropleth") return;
    const { records, boundaries, recommendation } = state.aiDataset;
    const filters = services.ui.selectedAiFilters(); state.aiDataset.filters = filters;
    const searchBoundary = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, {
      filters, columns: state.aiDataset.analysis.columns, includeMissingMetric: true
    });
    const categorical = usesCategoricalPolygonColor();
    const joined = categorical ? collapseCountryFeatures(searchBoundary, recommendation.geometry.field, { categoryField: recommendation.metricField }) : searchBoundary;
    const data = categorical ? { ...joined, features: joined.features.filter(feature => featureCategoryValues(feature.properties, recommendation.metricField).length) } : recommendation.metricField
      ? { ...searchBoundary, features: searchBoundary.features.filter(feature => Number.isFinite(feature.properties.__metric)) }
      : collapseCountryFeatures(searchBoundary, recommendation.geometry.field);
    state.aiDataset.searchBoundary = categorical ? joined : recommendation.metricField ? searchBoundary : data;
    state.boundary = data; state.sourceBoundary = data;

    const numericFields = [recommendation.metricField, ...recommendation.numericFields].filter((field, index, fields) => recommendation.numericFields.includes(field) && fields.indexOf(field) === index);
    state.dataProfile = analyzeSpatialData(data, { numericFields, hasArea: true });
    const polygonData = { ...data, features: data.features.filter(feature => feature.properties?.__geographic_scope !== "marker") };
    const scopeData = { type: "FeatureCollection", features: data.features.filter(feature =>
      feature.geometry?.type === "Point" && feature.properties?.__geographic_scope === "marker") };
    context.map.getSource("polygon-data")?.setData(polygonData);
    context.map.getSource("vietnam-boundary")?.setData(polygonData);
    context.map.getSource("scope-marker-data")?.setData(scopeData);
    if (isRegionHexMode()) await refreshBoundary({ fit });
    else {
      syncPolygonPaletteControls(); services.view.applyStyle();
      if (fit && data.features.length) services.view.fitBoundary();
    }
    services.uploads.setCurrentFileNote(`${data.features.length} khu vực · ${recommendation.metricField || "Màu mặc định"} · ${recommendation.source === "ai" ? "GPT-5.6 Luna đề xuất" : "quy tắc dự phòng"}`);
    services.popup.refreshMapPopup();
  }

  async function activateAiChoropleth(suggestion) {
    services.runtime.cancelAiBoundaryLoad();
    const controller = services.runtime.createAbortController();
    context.tasks.aiBoundaryAbortController = controller;
    const revision = context.tasks.aiBoundaryRevision;
    const dataset = state.aiDataset;
    const records = dataset.records;
    const recommendation = services.ui.recommendationForSuggestion(suggestion);
    const name = dataset.fileName;
    dataset.recommendation = recommendation;
    const countryField = recommendation.geometry.contextFields?.find(field => dataset.analysis.columns.find(column => column.name === field)?.geoLevel === "country");
    const contexts = Object.fromEntries(records.map(record => [geographicLocationName(record, recommendation.geometry), {
      sourceValue: String(record[recommendation.geometry.field] ?? "").trim(),
      country: countryField ? String(record[countryField] ?? "").trim() || null
        : recommendation.geometry.country || (recommendation.geometry.placeType === "country" ? null : "VNM")
    }]).filter(([name]) => name));
    const locations = Object.keys(contexts);
    const geometryLabel = recommendation.filters.find(filter => filter.field === recommendation.geometry.field)?.label || recommendation.geometry.field;
    services.ui.setStatus(`Đang ghép ranh giới cho ${locations.length} giá trị ${geometryLabel}…`);
    let resolvedBoundaries; let boundaries;
    try {
      resolvedBoundaries = await loadAdministrativeBoundaries(locations, {
        apiKey: CONFIG.MAPTILER_API_KEY,
        placeType: recommendation.geometry.placeType,
        country: recommendation.geometry.country,
        contexts,
        geographicScopes: recommendation.geographicScopes,
        resolveMissingBoundary: dataset.regionLookupAllowed === true || dataset.profile?.samplesIncluded === true
          ? (region, options) => (context.dependencies?.requestRegionBoundary ?? requestRegionBoundary)(region, options) : undefined,
        strict: false,
        aliases: dataset.geoAliases || {},
        selections: dataset.geoSelections || {},
        signal: controller.signal,
        onProgress: ({ completed, total }) => services.ui.setStatus(`Đang ghép ranh giới… ${completed}/${total}`)
      });
      if (revision !== context.tasks.aiBoundaryRevision || dataset !== state.aiDataset || dataset.selectedSuggestionId !== suggestion.id) return null;
      services.ui.setStatus("Đang chuẩn hóa ranh giới hành chính…");
      boundaries = {
        ...resolvedBoundaries,
        features: await Promise.all(resolvedBoundaries.features.map(async boundary =>
          await landOnlyBoundary(boundary, {
            country: boundary.properties?.__data_country || (recommendation.geometry.placeType === "country" ? undefined
              : countryField ? contexts[boundary.properties?.__data_location]?.country
                : recommendation.geometry.country || "VNM"),
            signal: controller.signal
          }) || boundary
        ))
      };
      if (revision !== context.tasks.aiBoundaryRevision || dataset !== state.aiDataset || dataset.selectedSuggestionId !== suggestion.id) return null;
      if (boundaries.features.some(feature => feature.properties?.web_boundary)) {
        const attribution = $('geoboundaries-attribution');
        if (attribution) attribution.hidden = false;
      }
    } catch (error) {
      if (error?.name === "AbortError") return null;
      throw error;
    } finally {
      if (context.tasks.aiBoundaryAbortController === controller) context.tasks.aiBoundaryAbortController = null;
    }
    dataset.boundaries = boundaries;
    dataset.geoMatch = { matched: resolvedBoundaries.matched, unmatched: resolvedBoundaries.unmatched, matchRate: resolvedBoundaries.matchRate,
      candidates: resolvedBoundaries.candidates, scopeIssues: resolvedBoundaries.scopeIssues };
    suggestion.boundaryBaseFeasibility ??= suggestion.feasibilityScore;
    suggestion.feasibilityScore = Math.min(suggestion.boundaryBaseFeasibility, resolvedBoundaries.matchRate);
    suggestion.effectiveConfidence = suggestion.confidence;
    const initialFilters = services.ui.populateAiFilters(dataset);
    renderGeoRepair(resolvedBoundaries.unmatched);
    if (boundaries.features.length < 1 || resolvedBoundaries.matchRate < .7) {
      suggestion.available = false;
      suggestion.repairable = resolvedBoundaries.unmatched.length > 0;
      suggestion.geoUnmatched = resolvedBoundaries.unmatched;
      suggestion.unavailableReason = `Chỉ khớp ${boundaries.features.length}/${locations.length} địa danh (${Math.round(resolvedBoundaries.matchRate * 100)}%). Hãy sửa tên hoặc chọn vùng chưa khớp.`;
      services.runtime.clearMapData(); state.mapType = null;
      services.ui.updateModelSections(); services.ui.renderAiSuggestionGrid();
      services.ui.setStatus(suggestion.unavailableReason, true);
      return false;
    }
    const data = joinRecordsToMapTilerBoundaries(records, boundaries, recommendation, { filters: initialFilters, columns: dataset.analysis.columns });
    const numericFields = [recommendation.metricField, ...recommendation.numericFields].filter((field, index, fields) => recommendation.numericFields.includes(field) && fields.indexOf(field) === index);
    // A period with no metric values still supports switching to another period or metric.
    const profile = analyzeSpatialData(data, { numericFields, hasArea: true });
    await services.runtime.replaceBoundary(data, name, profile, { preserveType: 'polygon', preserveAi: true });
    if (context.disposed || revision !== context.tasks.aiBoundaryRevision || dataset !== state.aiDataset || dataset.selectedSuggestionId !== suggestion.id) return null;
    dataset.recommendation = recommendation; dataset.boundaries = boundaries;
    state.aiDataset = dataset;
    suggestion.repairable = false; suggestion.geoUnmatched = [];
    state.dataOrigin = "ai"; state.mapType = "polygon"; state.polygonPalette = "diverging";
    await filteredAiBoundary();
    if (context.disposed || revision !== context.tasks.aiBoundaryRevision || dataset !== state.aiDataset || dataset.selectedSuggestionId !== suggestion.id) return null;
    services.ui.renderAiSuggestionGrid();
    services.ui.setStatus(`Đã tạo bản đồ ${recommendation.title}.`, true);
    return true;
  }

  function bindControls() {
  context.listen($("show-region-hex"), "change", async event => {
      services.popup.closeMapPopup();
      context.tasks.regionHexBuildRevision += 1;
      state.regionHexEnabled = event.target.checked;
      context.popups.cellPopup?.remove();
      $("region-hex-note").textContent = "";
      syncRegionHexControls();
      if (isRegionHexMode()) await rebuildRegionHexGrid();
      else { services.view.applyStyle(); services.ui.setStatus("Đang hiển thị vùng hành chính.", true); }
    });
  context.listen($("region-hex-resolution"), "input", event => {
      $("region-hex-resolution-value").value = event.target.value;
    });
  context.listen($("region-hex-resolution"), "change", async event => {
      services.popup.closeMapPopup();
      state.regionHexResolution = Number(event.target.value);
      await rebuildRegionHexGrid();
    });
  context.listen($("opacity"), "input", e => { $("opacity-value").value = `${Math.round(e.target.value * 100)}%`; services.view.applyStyle(); });
  context.listen($("line-width"), "input", e => { $("line-width-value").value = `${e.target.value} px`; services.view.applyStyle(); });
  for (const id of ["fixed-color", "border-color"]) { context.listen($(id), "input", e => {
      if (id === "fixed-color" && activePolygonLegendScale()) return;
      $(`${id}-value`).textContent = e.target.value.toUpperCase();
      if (id === "fixed-color" && (state.mapType === "polygon" || state.aiDataset)) { state.polygonPalette = null; syncPolygonPaletteControls(); }
      services.view.applyStyle();
    }); }
  context.listen($("polygon-color-ramp"), "click", event => {
      const button = event.target.closest(".palette");
      if (!button || button.disabled || activePolygonLegendScale()) return;
      state.polygonPalette = button.dataset.palette;
      syncPolygonPaletteControls();
      services.view.applyStyle();
    });
  context.listen($("show-border"), "change", services.view.applyStyle);
  context.listen($("province-filter-toggle"), "click", () => {
      const menu = $("province-filter-menu"); const open = menu.hidden; menu.hidden = !open; $("province-filter-toggle").setAttribute("aria-expanded", String(open));
    });
  context.listen($("province-filter-options"), "change", () => updateProvinceFilterLabel());
  context.listen($("clear-provinces"), "click", () => { document.querySelectorAll('#province-filter-options input:checked').forEach(input => input.checked = false); updateProvinceFilterLabel([]); });
  context.listen($("apply-provinces"), "click", async () => {
      const names = selectedProvinceNames(); const toggle = $("province-filter-toggle"); state.boundary = boundaryForProvinces(state.sourceBoundary, names);
      context.map.getSource("vietnam-boundary")?.setData(state.boundary); services.uploads.setCurrentFileNote(names.length ? `Đang lọc: ${names.map(formatProvinceName).join(", ")}` : "Dữ liệu đã tải · đang sử dụng");
      context.map.getSource("polygon-data")?.setData(state.boundary);
      $("province-filter-menu").hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.disabled = true;
      try { await refreshBoundary({ fit: true }); services.uploads.refreshClippedUploadLayers(); } finally { toggle.disabled = false; }
    });
  context.listen(document, "click", event => {
      if (!event.target.closest("[data-control-id=province-filter], #province-filter")) { $("province-filter-menu").hidden = true; $("province-filter-toggle").setAttribute("aria-expanded", "false"); }
      if (!event.target.closest(".ai-multiselect")) {
        document.querySelectorAll(".ai-multiselect-menu").forEach(menu => { menu.hidden = true; });
        document.querySelectorAll(".ai-multiselect-toggle").forEach(toggle => toggle.setAttribute("aria-expanded", "false"));
      }
    });
  }

  function handleChange(event) {

  return false;
  }

  function handleClick(event) {
  if (event.target.closest('.apply-geo-aliases')) {
        const dataset = state.aiDataset; const suggestion = dataset?.suggestions.find(item => item.id === dataset.selectedSuggestionId);
        if (!dataset || suggestion?.chartType !== "choropleth") return true;
        dataset.geoAliases ||= {}; dataset.geoSelections ||= {};
        const changedAliases = new Set();
        for (const input of document.querySelectorAll(".geo-alias-input")) {
          const name = input.dataset.location; const value = input.value.trim();
          if (value !== (dataset.geoAliases[name] || "")) { delete dataset.geoSelections[name]; changedAliases.add(name); }
          if (value) dataset.geoAliases[name] = value;
          else delete dataset.geoAliases[name];
        }
        for (const choice of document.querySelectorAll(".geo-boundary-choice")) {
          const name = choice.dataset.location;
          if (changedAliases.has(name)) continue;
          const feature = dataset.geoMatch?.candidates?.[name]?.find(candidate => candidate.id === choice.value);
          if (feature) dataset.geoSelections[name] = feature;
          else delete dataset.geoSelections[name];
        }
        suggestion.available = true; suggestion.unavailableReason = "";
        api.activateAiChoropleth(suggestion).catch(error => { console.error(error); services.ui.showToast(error.message); });
        return true;
      }
  return false;
  }

  const api = { bindControls, handleChange, handleClick, activePolygonSuggestion, isRegionHexMode, syncRegionHexControls, fillExpression, usesDefaultPolygonColor, usesCategoricalPolygonColor, activePolygonLegendScale, syncPolygonPaletteControls, renderWeatherLegend, renderCategoricalPolygonLegend, renderScopeLegend, rebuildRegionHexGrid, refreshBoundary, boundaryProvinceName, provinceNames, formatProvinceName, setupProvinceFilter, selectedProvinceNames, updateProvinceFilterLabel, boundaryForProvinces, polygonDimensionChoices, populatePolygonFilters, renderGeoRepair, filteredAiBoundary, activateAiChoropleth };

  return api;
}

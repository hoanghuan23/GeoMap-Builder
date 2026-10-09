import React from "react";
import { createRoot } from "react-dom/client";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { dataForBarMapping, humanizeField } from "./data-transformers.js";

const h = React.createElement;
const chartRoots = new WeakMap();
const panelRoots = new WeakMap();

export const PIE_COLORS = Object.freeze([
  "#ff8354", "#4385f5", "#ffba2f", "#4cc783", "#8b55cc", "#4bbde0",
  "#f477a7", "#6f7bf7", "#9acb45", "#f28e2b"
]);

export const DEFAULT_PIE_CONFIG = Object.freeze({
  limit: 6,
  sort: "none",
  chartSize: 78,
  sliceGap: 1,
  showDataLabels: true,
  showLegend: true,
  showTooltip: true
});

const PIE_VARIANTS = new Set(["pie", "halfPie"]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function mergePieConfig(config = {}) {
  const merged = { ...DEFAULT_PIE_CONFIG, ...config };
  merged.limit = merged.limit === "all" ? "all" : Math.max(1, Math.round(Number(merged.limit) || DEFAULT_PIE_CONFIG.limit));
  merged.sort = ["desc", "asc", "none"].includes(merged.sort) ? merged.sort : DEFAULT_PIE_CONFIG.sort;
  merged.chartSize = clamp(merged.chartSize, 45, 100, DEFAULT_PIE_CONFIG.chartSize);
  merged.sliceGap = clamp(merged.sliceGap, 0, 8, DEFAULT_PIE_CONFIG.sliceGap);
  merged.showDataLabels = merged.showDataLabels !== false;
  merged.showLegend = merged.showLegend !== false;
  merged.showTooltip = merged.showTooltip !== false;
  return {
    limit: merged.limit,
    sort: merged.sort,
    chartSize: merged.chartSize,
    sliceGap: merged.sliceGap,
    showDataLabels: merged.showDataLabels,
    showLegend: merged.showLegend,
    showTooltip: merged.showTooltip
  };
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Trường "${field}" phải là một chuỗi không rỗng.`);
  return value.trim();
}

export function pieSeriesFromFields(fields) {
  return fields.map((key, index) => ({
    key,
    label: humanizeField(key),
    color: PIE_COLORS[index % PIE_COLORS.length]
  }));
}

export function createPieOptions(dataset, title = "Cơ cấu các chỉ số") {
  if (!dataset?.suggestedCategory || !dataset.suggestedMetrics.length) return [];
  const metrics = dataset.suggestedMetrics.slice(0, Math.min(6, dataset.suggestedMetrics.length));
  const data = dataForBarMapping(dataset, { xField: dataset.suggestedCategory, metrics });
  if (!data.length) return [];
  const singleCategory = data.length === 1 ? data[0][dataset.suggestedCategory] : null;
  const defaultTitle = metrics.length === 1
    ? `${humanizeField(metrics[0])} theo ${humanizeField(dataset.suggestedCategory).toLowerCase()}`
    : "Cơ cấu các chỉ số";
  const base = {
    chartKind: "pie",
    title: singleCategory ? `Cơ cấu các chỉ số - ${singleCategory}` : metrics.length === 1 ? defaultTitle : title && title !== dataset.label ? title : defaultTitle,
    subtitle: "",
    unit: "",
    sourcePath: dataset.path,
    xField: dataset.suggestedCategory,
    series: pieSeriesFromFields(metrics),
    data,
    ...DEFAULT_PIE_CONFIG
  };
  return [
    { id: "pie_chart", label: "Pie chart", icon: "pieChart", config: { ...base, variant: "pie" } },
    { id: "half_pie", label: "Half pie", icon: "halfPie", config: { ...base, variant: "halfPie" } }
  ];
}

export function createPieOption(dataset, title) {
  return createPieOptions(dataset, title)[0] || null;
}

export function normalizePieChartConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Dữ liệu biểu đồ phải là một JSON object.");
  const xField = requireString(input.xField, "xField");
  if (!Array.isArray(input.series) || !input.series.length) throw new Error('Trường "series" phải có ít nhất một chỉ số.');
  if (!Array.isArray(input.data) || !input.data.length) throw new Error('Trường "data" phải có ít nhất một bản ghi.');

  const keys = new Set();
  const series = input.series.map((item, index) => {
    const key = requireString(item?.key, `series[${index}].key`);
    if (keys.has(key)) throw new Error(`Series key "${key}" bị trùng.`);
    keys.add(key);
    return {
      key,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : humanizeField(key),
      color: typeof item.color === "string" && item.color.trim() ? item.color.trim() : PIE_COLORS[index % PIE_COLORS.length]
    };
  });
  const data = input.data.map((record, rowIndex) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Bản ghi data[${rowIndex}] không hợp lệ.`);
    if (record[xField] == null || String(record[xField]).trim() === "") throw new Error(`Bản ghi data[${rowIndex}] thiếu trường "${xField}".`);
    const normalized = { ...record, [xField]: String(record[xField]) };
    for (const item of series) {
      const value = Number(record[item.key]);
      if (!Number.isFinite(value)) throw new Error(`Giá trị "${item.key}" tại data[${rowIndex}] phải là số.`);
      normalized[item.key] = value;
    }
    return normalized;
  });
  return {
    ...input,
    ...mergePieConfig(input),
    chartKind: "pie",
    variant: PIE_VARIANTS.has(input.variant) ? input.variant : "pie",
    title: typeof input.title === "string" ? input.title.trim() : "",
    subtitle: typeof input.subtitle === "string" ? input.subtitle.trim() : "",
    unit: typeof input.unit === "string" ? input.unit.trim() : "",
    xField,
    series,
    data
  };
}

export function preparePieData(config) {
  let slices;
  if (config.series.length === 1) {
    const metric = config.series[0];
    const grouped = new Map();
    for (const record of config.data) {
      const category = String(record[config.xField]);
      grouped.set(category, (grouped.get(category) || 0) + Number(record[metric.key] || 0));
    }
    slices = [...grouped.entries()].map(([category, value], index) => ({
      key: category,
      name: category,
      color: index === 0 ? metric.color : PIE_COLORS[index % PIE_COLORS.length],
      value
    }));
  } else {
    slices = config.series.map(item => ({
      key: item.key,
      name: item.label,
      color: item.color,
      value: config.data.reduce((total, record) => total + Number(record[item.key] || 0), 0)
    }));
  }
  slices = slices.filter(item => item.value > 0);
  if (config.sort !== "none") {
    const direction = config.sort === "asc" ? 1 : -1;
    slices.sort((a, b) => (a.value - b.value) * direction);
  }
  return config.limit === "all" ? slices : slices.slice(0, config.limit);
}

function formatValue(value) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value));
}

function SliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, value, percent, fill }) {
  if (percent < .035) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * .54;
  const radians = -midAngle * Math.PI / 180;
  const x = cx + radius * Math.cos(radians);
  const y = cy + radius * Math.sin(radians);
  const textColor = fill?.toLowerCase() === "#ffba2f" ? "#fff" : "#fff";
  return h("text", { x, y, fill: textColor, textAnchor: "middle", dominantBaseline: "central", fontSize: 11, fontWeight: 600 },
    h("tspan", { x, dy: "-0.55em" }, formatValue(value)),
    h("tspan", { x, dy: "1.25em", fontSize: 10, fontWeight: 500 }, `(${(percent * 100).toFixed(1)}%)`)
  );
}

function Chart({ config }) {
  const slices = preparePieData(config);
  const isHalf = config.variant === "halfPie";
  const outerRadius = `${config.chartSize}%`;
  return h("section", { className: "bar-chart-card pie-chart-card", "aria-label": config.title || "Biểu đồ tròn" },
    h("header", { className: "bar-chart-heading" }, h("div", null,
      h("h2", null, config.title || "Cơ cấu các chỉ số"),
      config.subtitle || config.unit ? h("p", null, [config.unit ? `Đơn vị: ${config.unit}` : "", config.unit && config.subtitle ? " · " : "", config.subtitle]) : null
    )),
    h("div", { className: `bar-chart-plot pie-chart-plot${isHalf ? " is-half" : ""}` },
      slices.length ? h(ResponsiveContainer, { width: "100%", height: "100%" },
        h(PieChart, null,
          h(Pie, {
            data: slices,
            dataKey: "value",
            nameKey: "name",
            cx: "50%",
            cy: isHalf ? "66%" : "47%",
            startAngle: isHalf ? 180 : 90,
            endAngle: isHalf ? 0 : -270,
            innerRadius: 0,
            outerRadius,
            paddingAngle: config.sliceGap,
            stroke: "#fff",
            strokeWidth: config.sliceGap ? 1 : 0,
            labelLine: false,
            label: config.showDataLabels ? SliceLabel : false,
            animationDuration: 600
          }, ...slices.map(slice => h(Cell, { key: slice.key, fill: slice.color }))),
          config.showTooltip ? h(Tooltip, {
            formatter: (value, name) => [`${formatValue(value)}${config.unit ? ` ${config.unit}` : ""}`, name],
            contentStyle: { border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,.10)" }
          }) : null,
          config.showLegend ? h(Legend, {
            verticalAlign: "bottom",
            align: "center",
            iconType: "circle",
            iconSize: 10,
            wrapperStyle: { fontSize: 11, lineHeight: "20px", color: "#526174" }
          }) : null
        )
      ) : h("p", { className: "pie-chart-empty" }, "Không có giá trị dương để hiển thị.")
    )
  );
}

export const PieRenderer = Object.freeze({
  render(container, input) {
    if (!(container instanceof HTMLElement)) throw new Error("Không tìm thấy vùng hiển thị biểu đồ.");
    const config = normalizePieChartConfig(input);
    let root = chartRoots.get(container);
    if (!root) { root = createRoot(container); chartRoots.set(container, root); }
    root.render(h(Chart, { config }));
    return config;
  },
  clear(container) {
    const root = chartRoots.get(container);
    if (root) { root.unmount(); chartRoots.delete(container); }
    container?.replaceChildren();
  }
});

function RangeControl({ label, value, min, max, suffix, onChange }) {
  return h("div", { className: "bar-style-field bar-range-field" },
    h("div", null, h("label", null, label), h("output", null, `${value}${suffix}`)),
    h("input", { type: "range", min, max, value, onChange: event => onChange(Number(event.target.value)) })
  );
}

function CheckControl({ label, checked, onChange }) {
  return h("label", { className: "bar-check-row" },
    h("input", { type: "checkbox", checked, onChange: event => onChange(event.target.checked) }),
    h("span", null, label)
  );
}

function ColorControl({ item, onChange }) {
  return h("label", { className: "bar-color-row" },
    h("span", { title: item.label }, item.label),
    h("span", { className: "color-control" },
      h("input", { type: "color", value: item.color, "aria-label": `Màu ${item.label}`, onChange: event => onChange(event.target.value) }),
      h("code", null, item.color.toUpperCase())
    )
  );
}

function PieStylePanel({ config, rowCount, series, onChange, onSeriesChange }) {
  const value = mergePieConfig(config);
  const update = patch => onChange({ ...value, ...patch });
  return h("div", { className: "bar-style-panel pie-style-panel" },
    h("section", null,
      h("h3", null, "1. Cấu hình dữ liệu"),
      h("div", { className: "bar-style-grid" },
        h("label", { className: "bar-style-field" }, h("span", null, "Số nhóm hiển thị"),
          h("select", { value: value.limit, onChange: event => update({ limit: event.target.value === "all" ? "all" : Number(event.target.value) }) },
            h("option", { value: 6 }, "Top 6"), h("option", { value: 10 }, "Top 10"), h("option", { value: 20 }, "Top 20"), h("option", { value: "all" }, `Tất cả (${series.length || rowCount})`)
          )
        ),
        h("label", { className: "bar-style-field" }, h("span", null, "Sắp xếp"),
          h("select", { value: value.sort, onChange: event => update({ sort: event.target.value }) },
            h("option", { value: "desc" }, "Giảm dần"), h("option", { value: "asc" }, "Tăng dần"), h("option", { value: "none" }, "Theo dữ liệu gốc")
          )
        )
      )
    ),
    h("section", null,
      h("h3", null, "2. Tùy chỉnh hình tròn"),
      h(RangeControl, { label: "Kích thước biểu đồ", value: value.chartSize, min: 45, max: 100, suffix: "%", onChange: chartSize => update({ chartSize }) }),
      h(RangeControl, { label: "Khoảng cách lát cắt", value: value.sliceGap, min: 0, max: 8, suffix: "°", onChange: sliceGap => update({ sliceGap }) })
    ),
    h("section", null,
      h("h3", null, "3. Màu sắc"),
      h("div", { className: "bar-color-list" }, ...series.map((item, index) => h(ColorControl, { key: item.key, item, onChange: color => onSeriesChange(index, color) })))
    ),
    h("section", null,
      h("h3", null, "4. Nhãn"),
      h(CheckControl, { label: "Hiển thị giá trị và phần trăm", checked: value.showDataLabels, onChange: showDataLabels => update({ showDataLabels }) }),
      h(CheckControl, { label: "Hiển thị chú giải", checked: value.showLegend, onChange: showLegend => update({ showLegend }) }),
      h(CheckControl, { label: "Hiển thị tooltip", checked: value.showTooltip, onChange: showTooltip => update({ showTooltip }) })
    )
  );
}

export function renderPieStylePanel(container, props) {
  let root = panelRoots.get(container);
  if (!root) { root = createRoot(container); panelRoots.set(container, root); }
  root.render(h(PieStylePanel, props));
}

export function clearPieStylePanel(container) {
  const root = panelRoots.get(container);
  if (!root) return;
  root.unmount();
  panelRoots.delete(container);
}

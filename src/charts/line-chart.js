import React from "react";
import { createRoot } from "react-dom/client";
import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { dataForBarMapping, humanizeField } from "./data-transformers.js";

const roots = new WeakMap();
const h = React.createElement;
export const LINE_COLORS = Object.freeze(["#ff8354", "#57c785", "#ffd05b", "#5b8ff9", "#9270ca", "#6dc8ec"]);

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Trường "${field}" phải là một chuỗi không rỗng.`);
  return value.trim();
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (Math.abs(number) >= 1_000_000) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000_000)} Tr`;
  if (Math.abs(number) >= 1_000) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000)} N`;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number);
}

export function lineSeriesFromFields(fields) {
  return fields.map((key, index) => ({ key, label: humanizeField(key), color: LINE_COLORS[index % LINE_COLORS.length] }));
}

export function createLineOption(dataset, title = "Biểu đồ đường") {
  if (!dataset?.suggestedCategory || !dataset.suggestedMetrics.length) return null;
  const metrics = dataset.suggestedMetrics.slice(0, Math.min(3, dataset.suggestedMetrics.length));
  const data = dataForBarMapping(dataset, { xField: dataset.suggestedCategory, metrics });
  if (!data.length) return null;
  return {
    id: "line_chart",
    label: "Biểu đồ đường",
    icon: "line",
    config: {
      chartKind: "line",
      variant: "line",
      title: title && title !== dataset.label ? title : `Xu hướng theo ${humanizeField(dataset.suggestedCategory).toLowerCase()}`,
      subtitle: "Dữ liệu theo chuỗi thời gian hoặc danh mục",
      unit: "",
      sourcePath: dataset.path,
      xField: dataset.suggestedCategory,
      series: lineSeriesFromFields(metrics),
      data,
      showGrid: true,
      showLegend: true,
      showTooltip: true,
      showDataLabels: false
    }
  };
}

export function normalizeLineChartConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Dữ liệu biểu đồ phải là một JSON object.");
  const xField = requireString(input.xField, "xField");
  if (!Array.isArray(input.series) || !input.series.length) throw new Error('Trường "series" phải có ít nhất một chuỗi dữ liệu.');
  if (!Array.isArray(input.data) || !input.data.length) throw new Error('Trường "data" phải có ít nhất một bản ghi.');
  const keys = new Set();
  const series = input.series.map((item, index) => {
    const key = requireString(item?.key, `series[${index}].key`);
    if (keys.has(key)) throw new Error(`Series key "${key}" bị trùng.`);
    keys.add(key);
    return {
      key,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : humanizeField(key),
      color: typeof item.color === "string" && item.color.trim() ? item.color.trim() : LINE_COLORS[index % LINE_COLORS.length]
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
    chartKind: "line",
    variant: "line",
    title: typeof input.title === "string" ? input.title.trim() : "",
    subtitle: typeof input.subtitle === "string" ? input.subtitle.trim() : "",
    unit: typeof input.unit === "string" ? input.unit.trim() : "",
    showGrid: input.showGrid !== false,
    showLegend: input.showLegend !== false,
    showTooltip: input.showTooltip !== false,
    showDataLabels: Boolean(input.showDataLabels),
    xField,
    series,
    data
  };
}

function tooltipValue(value, _name, item, unit) {
  return [`${new Intl.NumberFormat("vi-VN").format(Number(value))}${unit ? ` ${unit}` : ""}`, item?.name || ""];
}

function Chart({ config }) {
  const lines = config.series.map(item => h(Line, {
    key: item.key,
    type: "linear",
    dataKey: item.key,
    name: item.label,
    stroke: item.color,
    strokeWidth: 2,
    dot: { r: 4, fill: item.color, stroke: "#fff", strokeWidth: 1.5 },
    activeDot: { r: 6, stroke: "#fff", strokeWidth: 2 },
    animationDuration: 600,
    connectNulls: false
  }, config.showDataLabels ? h(LabelList, { dataKey: item.key, position: "top", formatter: compactNumber, fill: "#526174", fontSize: 10 }) : null));

  return h("section", { className: "bar-chart-card line-chart-card", "aria-label": config.title || "Biểu đồ đường" },
    h("header", { className: "bar-chart-heading" },
      h("div", null,
        h("h2", null, config.title || "Biểu đồ đường"),
        config.subtitle || config.unit ? h("p", null, [config.unit ? `Đơn vị: ${config.unit}` : "", config.unit && config.subtitle ? " · " : "", config.subtitle]) : null
      )
    ),
    h("div", { className: "bar-chart-plot line-chart-plot" },
      h(ResponsiveContainer, { width: "100%", height: "100%" },
        h(LineChart, { data: config.data, margin: { top: 18, right: 18, left: 4, bottom: 8 } },
          config.showGrid ? h(CartesianGrid, { stroke: "#e9edf2", strokeDasharray: "3 3", vertical: false }) : null,
          h(XAxis, { type: "category", dataKey: config.xField, axisLine: false, tickLine: false, tick: { fill: "#697586", fontSize: 11 }, interval: 0, height: 38 }),
          h(YAxis, { type: "number", axisLine: false, tickLine: false, tick: { fill: "#697586", fontSize: 11 }, tickFormatter: compactNumber, width: 54 }),
          config.showTooltip ? h(Tooltip, {
            formatter: (value, name, item) => tooltipValue(value, name, item, config.unit),
            contentStyle: { border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,.10)" }
          }) : null,
          config.showLegend ? h(Legend, { verticalAlign: "bottom", iconType: "circle", iconSize: 9, wrapperStyle: { paddingTop: 14, fontSize: 12 } }) : null,
          ...lines
        )
      )
    )
  );
}

export const LineRenderer = Object.freeze({
  render(container, input) {
    if (!(container instanceof HTMLElement)) throw new Error("Không tìm thấy vùng hiển thị biểu đồ.");
    const config = normalizeLineChartConfig(input);
    let root = roots.get(container);
    if (!root) { root = createRoot(container); roots.set(container, root); }
    root.render(h(Chart, { config }));
    return config;
  },
  clear(container) {
    const root = roots.get(container);
    if (root) { root.unmount(); roots.delete(container); }
    container?.replaceChildren();
  }
});

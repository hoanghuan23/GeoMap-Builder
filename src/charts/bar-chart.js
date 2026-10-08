import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { mergeBarConfig, prepareBarData } from "./configs/bar-config.js";
import { analyzeDataSets, createBarOptions } from "./data-transformers.js";

const roots = new WeakMap();
const DEFAULT_COLORS = ["#5470C6", "#91CC75", "#FAC858", "#EE6666", "#73C0DE", "#9A60B4"];
const h = React.createElement;

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Trường "${field}" phải là một chuỗi không rỗng.`);
  }
  return value.trim();
}

export function analyzeBarData(input) {
  const datasets = analyzeDataSets(input).filter(dataset => dataset.suggestedCategory && dataset.numericFields.length);
  const best = datasets.find(dataset => createBarOptions(dataset).length);
  if (!best) throw new Error("Không tìm thấy bảng dữ liệu có trường phân loại và trường số để dựng biểu đồ.");
  const titlePrefix = typeof input?.report_name === "string" ? input.report_name : best.label;
  const options = createBarOptions(best, titlePrefix);
  return {
    datasets,
    sourcePath: best.path,
    rowCount: best.rowCount,
    xField: best.suggestedCategory,
    numericFields: best.numericFields.map(field => field.path),
    schema: best.fields,
    titlePrefix,
    options
  };
}

export function normalizeBarChartConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Dữ liệu biểu đồ phải là một JSON object.");
  }
  const xField = requireString(input.xField, "xField");
  if (!Array.isArray(input.series) || input.series.length === 0) {
    throw new Error('Trường "series" phải có ít nhất một chuỗi dữ liệu.');
  }
  if (!Array.isArray(input.data) || input.data.length === 0) {
    throw new Error('Trường "data" phải có ít nhất một bản ghi.');
  }

  const keys = new Set();
  const series = input.series.map((item, index) => {
    const key = requireString(item?.key, `series[${index}].key`);
    if (keys.has(key)) throw new Error(`Series key "${key}" bị trùng.`);
    keys.add(key);
    return {
      key,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : key,
      color: typeof item.color === "string" && item.color.trim() ? item.color.trim() : DEFAULT_COLORS[index % DEFAULT_COLORS.length]
    };
  });

  const data = input.data.map((record, rowIndex) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Bản ghi data[${rowIndex}] không hợp lệ.`);
    }
    const category = record[xField];
    if (category == null || String(category).trim() === "") {
      throw new Error(`Bản ghi data[${rowIndex}] thiếu trường "${xField}".`);
    }
    const normalized = { ...record, [xField]: String(category) };
    for (const item of series) {
      const value = Number(record[item.key]);
      if (!Number.isFinite(value)) {
        throw new Error(`Giá trị "${item.key}" tại data[${rowIndex}] phải là số.`);
      }
      normalized[item.key] = value;
    }
    return normalized;
  });

  return {
    ...mergeBarConfig(input),
    variant: input.variant || (series.length === 1 ? "single" : series.length === 2 ? "double" : "grouped"),
    title: typeof input.title === "string" ? input.title.trim() : "",
    unit: typeof input.unit === "string" ? input.unit.trim() : "",
    xField,
    series,
    data
  };
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (Math.abs(number) >= 1_000_000) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000_000)} Tr`;
  if (Math.abs(number) >= 1_000) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000)} N`;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number);
}

function tooltipValue(value, _name, item, unit) {
  const formatted = new Intl.NumberFormat("vi-VN").format(Number(value));
  return [`${formatted}${unit ? ` ${unit}` : ""}`, item?.name || ""];
}

function Chart({ config }) {
  const data = useMemo(() => prepareBarData(config.data, config, config.series), [config]);
  const initialWindow = Math.min(data.length, 24);
  const [range, setRange] = useState({ startIndex: 0, endIndex: Math.max(0, initialWindow - 1) });
  const isHorizontal = config.orientation === "horizontal";
  const canZoom = data.length > 12;

  useEffect(() => {
    setRange({ startIndex: 0, endIndex: Math.max(0, Math.min(data.length, 24) - 1) });
  }, [data.length, config.limit, config.sort]);

  const zoom = direction => setRange(current => {
    const size = current.endIndex - current.startIndex + 1;
    const nextSize = Math.max(6, Math.min(data.length, direction > 0 ? Math.ceil(size * .7) : Math.ceil(size * 1.4)));
    const center = (current.startIndex + current.endIndex) / 2;
    let startIndex = Math.max(0, Math.round(center - nextSize / 2));
    let endIndex = Math.min(data.length - 1, startIndex + nextSize - 1);
    startIndex = Math.max(0, endIndex - nextSize + 1);
    return { startIndex, endIndex };
  });

  const bars = config.series.map(item => h(Bar, {
    key: item.key,
    dataKey: item.key,
    name: item.label,
    fill: item.color,
    radius: isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
    maxBarSize: config.barWidth,
    animationDuration: 550
  }, config.showDataLabels ? h(LabelList, {
    dataKey: item.key,
    position: isHorizontal ? "right" : "top",
    formatter: compactNumber,
    fill: "#526174",
    fontSize: 10
  }) : null));

  return h("section", { className: "bar-chart-card", "aria-label": config.title || "Biểu đồ cột" },
    h("header", { className: "bar-chart-heading" },
      h("div", null,
        h("h2", null, config.title || "Biểu đồ cột"),
        config.unit ? h("p", null, `Đơn vị: ${config.unit}`) : null
      ),
      canZoom ? h("div", { className: "chart-zoom-controls", "aria-label": "Điều khiển thu phóng biểu đồ" },
        h("button", { type: "button", onClick: () => zoom(1), title: "Phóng to" }, "+"),
        h("button", { type: "button", onClick: () => zoom(-1), title: "Thu nhỏ" }, "−"),
        h("button", { type: "button", onClick: () => setRange({ startIndex: 0, endIndex: data.length - 1 }), title: "Hiển thị tất cả" }, "↺")
      ) : null
    ),
    h("div", { className: "bar-chart-plot" },
      h(ResponsiveContainer, { width: "100%", height: "100%" },
        h(BarChart, { data, layout: isHorizontal ? "vertical" : "horizontal", margin: { top: 18, right: config.showDataLabels ? 50 : 20, left: isHorizontal ? 30 : 4, bottom: canZoom ? 4 : 8 }, barCategoryGap: `${config.barGap}%`, barGap: 3 },
          config.showGrid ? h(CartesianGrid, { stroke: "#e9edf2", strokeDasharray: "3 3", vertical: isHorizontal }) : null,
          isHorizontal
            ? h(XAxis, { type: "number", axisLine: false, tickLine: false, tick: { fill: "#697586", fontSize: 11 }, tickFormatter: compactNumber })
            : h(XAxis, { type: "category", dataKey: config.xField, axisLine: false, tickLine: false, tick: { fill: "#697586", fontSize: 11 }, interval: 0, height: 42 }),
          isHorizontal
            ? h(YAxis, { type: "category", dataKey: config.xField, axisLine: false, tickLine: false, tick: { fill: "#697586", fontSize: 11 }, interval: 0, width: 82 })
            : h(YAxis, { type: "number", axisLine: false, tickLine: false, tick: { fill: "#697586", fontSize: 11 }, tickFormatter: compactNumber, width: 54 }),
          config.showTooltip ? h(Tooltip, {
            formatter: (value, name, item) => tooltipValue(value, name, item, config.unit),
            cursor: { fill: "rgba(15, 23, 42, 0.035)" },
            contentStyle: { border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,.10)" }
          }) : null,
          config.showLegend ? h(Legend, { iconType: "circle", iconSize: 8, wrapperStyle: { paddingTop: 12, fontSize: 11 } }) : null,
          ...bars,
          canZoom ? h(Brush, {
            dataKey: config.xField,
            height: 22,
            travellerWidth: 8,
            startIndex: range.startIndex,
            endIndex: range.endIndex,
            onChange: next => next && setRange(next),
            stroke: "#8aa8d8",
            fill: "#f5f8fc"
          }) : null
        )
      )
    )
  );
}

export const BarRenderer = Object.freeze({
  render(container, input) {
    if (!(container instanceof HTMLElement)) throw new Error("Không tìm thấy vùng hiển thị biểu đồ.");
    const config = normalizeBarChartConfig(input);
    let root = roots.get(container);
    if (!root) {
      root = createRoot(container);
      roots.set(container, root);
    }
    root.render(h(Chart, { config }));
    return config;
  },

  clear(container) {
    const root = roots.get(container);
    if (root) {
      root.unmount();
      roots.delete(container);
    }
    container?.replaceChildren();
  }
});

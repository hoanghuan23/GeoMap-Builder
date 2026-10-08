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

const roots = new WeakMap();
const DEFAULT_COLORS = ["#63c785", "#f58b61", "#5b8ff9", "#f6bd16", "#9270ca", "#6dc8ec"];
const h = React.createElement;
const CATEGORY_HINTS = ["country", "province", "region", "category", "name", "label", "city", "state"];
const SINGLE_VALUE_HINTS = ["score", "happiness_score", "value", "average_score", "total", "amount"];
const MULTI_VALUE_HINTS = ["gdp_per_capita", "social_support", "freedom", "healthy_life_expectancy"];
const NON_METRIC_PATTERN = /(^|_)(id|rank|index|code|year|edition|latitude|longitude|lat|lng|lon)($|_)/i;

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Trường "${field}" phải là một chuỗi không rỗng.`);
  }
  return value.trim();
}

function normalizedName(value) {
  return String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
}

function humanize(value) {
  const text = String(value).replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function flattenRecord(record, output = {}, prefix = "") {
  for (const [key, value] of Object.entries(record || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) flattenRecord(value, output, prefix ? `${prefix}.${key}` : key);
    else if (!Array.isArray(value)) {
      const leaf = key;
      const target = Object.hasOwn(output, leaf) ? `${prefix}.${key}` : leaf;
      output[target] = value;
    }
  }
  return output;
}

function fieldsFrom(records) {
  const keys = [...new Set(records.flatMap(record => Object.keys(record)))];
  const numericFields = []; const textFields = [];
  for (const key of keys) {
    const values = records.map(record => record[key]).filter(value => value != null && value !== "");
    if (values.length < Math.max(1, Math.ceil(records.length * .6))) continue;
    if (values.every(value => Number.isFinite(Number(value)))) numericFields.push(key);
    else if (values.every(value => typeof value === "string" || typeof value === "boolean")) textFields.push(key);
  }
  return { numericFields, textFields };
}

function collectRecordArrays(value, path = "$", candidates = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return candidates;
  seen.add(value);
  if (Array.isArray(value)) {
    const objects = value.filter(item => item && typeof item === "object" && !Array.isArray(item));
    if (objects.length && objects.length === value.length) {
      const records = objects.map(item => flattenRecord(item));
      const fields = fieldsFrom(records);
      if (fields.textFields.length && fields.numericFields.length) {
        const score = fields.numericFields.length * 4 + fields.textFields.length * 2 + Math.min(records.length, 10);
        candidates.push({ path, records, ...fields, score });
      }
    }
    value.forEach((item, index) => collectRecordArrays(item, `${path}[${index}]`, candidates, seen));
  } else {
    for (const [key, child] of Object.entries(value)) collectRecordArrays(child, path === "$" ? key : `${path}.${key}`, candidates, seen);
  }
  return candidates;
}

function hintedField(fields, hints) {
  return hints.map(hint => fields.find(field => normalizedName(field) === hint)).find(Boolean);
}

function seriesFor(fields) {
  return fields.map((key, index) => ({ key, label: humanize(key), color: DEFAULT_COLORS[index % DEFAULT_COLORS.length] }));
}

export function analyzeBarData(input) {
  const candidates = collectRecordArrays(input);
  const best = candidates.sort((a, b) => b.score - a.score || b.records.length - a.records.length)[0];
  if (!best) throw new Error("Không tìm thấy bảng dữ liệu có trường phân loại và trường số để dựng biểu đồ.");

  const xField = hintedField(best.textFields, CATEGORY_HINTS) || best.textFields[0];
  const metrics = best.numericFields.filter(field => !NON_METRIC_PATTERN.test(normalizedName(field)));
  if (!metrics.length) throw new Error("Không tìm thấy trường số phù hợp cho trục Y.");

  const singleField = hintedField(metrics, SINGLE_VALUE_HINTS) || metrics[0];
  const comparisonMetrics = [
    ...MULTI_VALUE_HINTS.map(hint => metrics.find(field => normalizedName(field) === hint)).filter(Boolean),
    ...metrics.filter(field => field !== singleField && !MULTI_VALUE_HINTS.includes(normalizedName(field)))
  ].filter((field, index, all) => all.indexOf(field) === index);
  const doubleMetrics = comparisonMetrics.length >= 2 ? comparisonMetrics : metrics;
  const groupedMetrics = comparisonMetrics.length >= 3 ? comparisonMetrics : metrics;
  const titlePrefix = typeof input?.report_name === "string" ? input.report_name : humanize(best.path.split(".").pop());
  const base = { data: best.records, xField, unit: "", sourcePath: best.path };
  const options = [{
    id: "single_bar",
    label: "Cột đơn",
    icon: "▥",
    config: { ...base, variant: "single", title: `${humanize(singleField)} theo ${humanize(xField).toLowerCase()}`, series: seriesFor([singleField]) }
  }];
  if (doubleMetrics.length >= 2) options.push({
    id: "double_bar",
    label: "Cột đôi",
    icon: "▥▥",
    config: { ...base, variant: "double", title: `So sánh hai chỉ số · ${titlePrefix}`, series: seriesFor(doubleMetrics.slice(0, 2)) }
  });
  if (groupedMetrics.length >= 3) options.push({
    id: "grouped_bar",
    label: "Cột ghép",
    icon: "▥▥▥",
    config: { ...base, variant: "grouped", title: `So sánh nhiều chỉ số · ${titlePrefix}`, series: seriesFor(groupedMetrics.slice(0, 4)) }
  });

  return { sourcePath: best.path, rowCount: best.records.length, xField, numericFields: metrics, options };
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

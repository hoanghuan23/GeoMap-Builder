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
import { humanizeField } from "./data-transformers.js";
import { formatLineX, LINE_COLORS } from "./line-format.js";
export { formatLineX, LINE_COLORS } from "./line-format.js";

const roots = new WeakMap();
const h = React.createElement;

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Trường "${field}" phải là một chuỗi không rỗng.`);
  // Validate nonblank keys without changing their identity in source records.
  return value;
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  if (Math.abs(number) >= 1_000_000) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000_000)} Tr`;
  if (Math.abs(number) >= 1_000) return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number / 1_000)} N`;
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(number);
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
      if (record[item.key] == null || record[item.key] === "") {
        normalized[item.key] = null;
        continue;
      }
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

const numberFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

// co theo dữ liệu, không ép về 0; dữ liệu không âm thì không cho xuống dưới 0
function paddedDomain() {
  return [
    min => { const pad = (Math.abs(min) * 0.03) || 1; const v = Math.floor(min - pad); return min >= 0 ? Math.max(0, v) : v; },
    max => Math.ceil(max + ((Math.abs(max) * 0.03) || 1))
  ];
}

function LineTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(item => item.value != null).sort((a, b) => b.value - a.value);
  return h("div", { style: { background: "var(--template-surface, #fff)", color: "var(--template-text, #222)", border: "1px solid var(--template-border, #e2e8f0)", borderRadius: "var(--template-radius, 8px)", padding: "8px 10px", fontFamily: "var(--template-font, inherit)", fontSize: "var(--template-label-size, 12px)", boxShadow: "var(--template-shadow, 0 8px 24px rgba(15,23,42,.10))" } },
    h("div", { style: { fontWeight: "var(--template-semibold-weight, 600)", marginBottom: 4 } }, formatLineX(label, true)),
    ...items.map(item => h("div", { key: item.dataKey, style: { display: "flex", gap: 8, alignItems: "center" } },
      h("span", { style: { width: 8, height: 8, borderRadius: 4, background: item.color } }),
      h("span", { style: { flex: 1 } }, item.name),
      h("b", null, `${numberFormat.format(item.value)}${unit ? ` ${unit}` : ""}`)
    ))
  );
}

function Chart({ config }) {
  const [hover, setHover] = React.useState(null);
  const showDots = config.data.length <= 31 && config.series.length <= 8;
  // nhãn số chỉ hợp lý khi ít điểm và ít chuỗi; vượt ngưỡng thì tự tắt, giá trị xem ở tooltip
  const labels = config.showDataLabels && config.data.length <= 12 && config.series.length <= 2;

  const lines = config.series.map(item => h(Line, {
    key: item.key,
    type: "monotone",
    dataKey: item.key,
    name: item.label,
    stroke: item.color,
    strokeWidth: hover === item.key ? 3 : 2,
    strokeOpacity: hover && hover !== item.key ? 0.2 : 1,
    dot: showDots ? { r: 2.5, fill: item.color, strokeWidth: 0 } : false,
    activeDot: { r: 5, stroke: "var(--template-surface, #fff)", strokeWidth: 2 },
    isAnimationActive: false,
    connectNulls: false
  }, labels ? h(LabelList, { dataKey: item.key, position: "top", formatter: compactNumber, fill: "var(--template-secondary, #526174)", fontSize: "var(--template-label-size, 10px)" }) : null));

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
          config.showGrid ? h(CartesianGrid, { stroke: "var(--template-border, #e9edf2)", strokeDasharray: "3 3", vertical: false }) : null,
          h(XAxis, {
            type: "category", dataKey: config.xField, axisLine: false, tickLine: false,
            tick: { fill: "var(--template-secondary, #697586)", fontSize: "var(--template-label-size, 11px)" },
            tickFormatter: value => formatLineX(value),
            interval: "preserveStartEnd", minTickGap: 24, height: 38
          }),
          h(YAxis, {
            type: "number", axisLine: false, tickLine: false,
            tick: { fill: "var(--template-secondary, #697586)", fontSize: "var(--template-label-size, 11px)" },
            tickFormatter: compactNumber, width: 54,
            domain: paddedDomain(), allowDecimals: true
          }),
          config.showTooltip ? h(Tooltip, {
            content: h(LineTooltip, { unit: config.unit }),
            cursor: { stroke: "var(--template-secondary, #9ca3af)", strokeDasharray: "3 3" }
          }) : null,
          config.showLegend ? h(Legend, {
            verticalAlign: "bottom", iconType: "circle", iconSize: 9,
            wrapperStyle: { paddingTop: 14, fontSize: "var(--template-label-size, 12px)" },
            onMouseEnter: entry => setHover(entry.dataKey ?? null),
            onMouseLeave: () => setHover(null)
          }) : null,
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

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const roots = new WeakMap();
const h = React.createElement;
export const PIE_COLORS = Object.freeze(['#5296f7', '#b2dfbc', '#f8c4ab', '#ffe7a0', '#bc95f7', '#6cc9d6', '#ed8daa', '#9ab0d2']);
const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const percent = value => `${number.format(value)}%`;

export function normalizePieChartConfig(input) {
  if (!input || !Array.isArray(input.data) || input.data.length < 2) throw new Error('Biểu đồ tròn cần ít nhất hai nhóm thành phần.');
  const names = new Set();
  const data = input.data.map((item, index) => {
    if (typeof item.name !== 'string' || !item.name.trim() || names.has(item.name)) throw new Error('Tên nhóm biểu đồ tròn phải khác nhau và không để trống.');
    names.add(item.name);
    if (item.value == null || typeof item.value === 'string' && !item.value.trim() || !['number', 'string'].includes(typeof item.value)) throw new Error('Có nhóm thiếu giá trị biểu đồ tròn.');
    const value = Number(item.value);
    if (!Number.isFinite(value) || value < 0) throw new Error('Giá trị biểu đồ tròn phải là số không âm.');
    return { ...item, value, color: item.color || PIE_COLORS[index % PIE_COLORS.length] };
  });
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error('Tổng giá trị phải lớn hơn 0.');
  if (data.filter(item => item.value > 0).length < 2) throw new Error('Biểu đồ tròn cần ít nhất hai nhóm có giá trị lớn hơn 0.');
  return { ...input, chartKind: 'pie', total, data: data.map(item => ({ ...item, percentage: item.value / total * 100 })),
    title: input.title || 'Cơ cấu tỷ trọng', unit: input.unit || '', groupLabel: input.groupLabel || 'Thành phần',
    valueLabel: input.valueLabel || 'Giá trị', showLegend: input.showLegend !== false,
    showTooltip: input.showTooltip !== false, showTable: input.showTable !== false };
}

function PieTooltip({ active, payload, unit, valueLabel }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return h('div', { className: 'pie-chart-tooltip' },
    h('strong', null, item.name),
    h('div', null, h('i', { style: { background: item.color } }), `${valueLabel}: ${number.format(item.value)}${unit ? ` ${unit}` : ''}`),
    h('div', null, `Tỷ trọng: ${percent(item.percentage)}`));
}

function Chart({ config }) {
  const [hover, setHover] = React.useState(null);
  const table = config.showTable ? h('div', { className: 'pie-chart-table-scroll' },
    h('table', { className: 'pie-chart-table' },
      h('caption', { className: 'sr-only' }, config.title),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, config.groupLabel), h('th', { scope: 'col' }, `${config.valueLabel}${config.unit ? ` (${config.unit})` : ''}`), h('th', { scope: 'col' }, 'Tỷ trọng'))),
      h('tbody', null, ...config.data.map(item => h('tr', { key: item.name }, h('th', { scope: 'row' }, item.name), h('td', null, number.format(item.value)), h('td', null, percent(item.percentage))))),
      h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'Tổng'), h('td', null, number.format(config.total)), h('td', null, '100%'))))) : null;
  return h('section', { className: 'bar-chart-card pie-chart-card', 'aria-label': config.title },
    table,
    h('header', { className: 'bar-chart-heading' }, h('h2', null, config.title)),
    h('div', { className: 'pie-chart-plot' },
      h(ResponsiveContainer, { width: '100%', height: '100%' },
        h(PieChart, { accessibilityLayer: true, margin: { top: 8, right: 8, bottom: 8, left: 8 } },
          h(Pie, { data: config.data, dataKey: 'value', nameKey: 'name', innerRadius: '51%', outerRadius: '85%',
            startAngle: 90, endAngle: -270, stroke: 'var(--template-surface, #fff)', strokeWidth: 2, isAnimationActive: false,
            onMouseEnter: (_item, index) => setHover(index), onMouseLeave: () => setHover(null) },
          ...config.data.map((item, index) => h(Cell, { key: item.name, fill: item.color, fillOpacity: hover == null || hover === index ? 1 : .45 }))),
          config.showTooltip ? h(Tooltip, { content: h(PieTooltip, { unit: config.unit, valueLabel: config.valueLabel }) }) : null))),
    config.showLegend ? h('ul', { className: 'pie-chart-legend', 'aria-label': 'Chú giải biểu đồ tròn' },
      ...config.data.map((item, index) => h('li', { key: item.name }, h('button', { type: 'button',
        onMouseEnter: () => setHover(index), onMouseLeave: () => setHover(null), onFocus: () => setHover(index), onBlur: () => setHover(null),
        'aria-label': `${item.name}: ${number.format(item.value)}${config.unit ? ` ${config.unit}` : ''}, ${percent(item.percentage)}` },
      h('i', { style: { background: item.color }, 'aria-hidden': true }), item.name)))) : null);
}

export const PieRenderer = Object.freeze({
  render(container, input) {
    if (!(container instanceof HTMLElement)) throw new Error('Không tìm thấy vùng hiển thị biểu đồ.');
    const config = normalizePieChartConfig(input);
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

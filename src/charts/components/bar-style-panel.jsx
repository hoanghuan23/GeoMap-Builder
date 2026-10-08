import React from "react";
import { createRoot } from "react-dom/client";
import { mergeBarConfig } from "../configs/bar-config.js";

const roots = new WeakMap();

function RangeControl({ label, value, min, max, suffix, onChange }) {
  return (
    <div className="bar-style-field bar-range-field">
      <div><label>{label}</label><output>{value}{suffix}</output></div>
      <input type="range" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} />
    </div>
  );
}

function CheckControl({ label, checked, onChange }) {
  return (
    <label className="bar-check-row">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function ColorControl({ label, color, onChange }) {
  return (
    <label className="bar-color-row">
      <span title={label}>{label}</span>
      <span className="color-control">
        <input type="color" value={color} aria-label={`Màu ${label}`} onChange={event => onChange(event.target.value)} />
        <code>{color.toUpperCase()}</code>
      </span>
    </label>
  );
}

export function BarStylePanel({ config, rowCount, series = [], onChange, onSeriesChange }) {
  const value = mergeBarConfig(config);
  const update = patch => onChange({ ...value, ...patch });

  return (
    <div className="bar-style-panel">
      <section>
        <h3>1. Cấu hình dữ liệu</h3>
        <div className="bar-style-grid">
          <label className="bar-style-field">
            <span>Số cột hiển thị</span>
            <select value={value.limit} onChange={event => update({ limit: event.target.value === "all" ? "all" : Number(event.target.value) })}>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
              <option value="all">Tất cả ({rowCount})</option>
            </select>
          </label>
          <label className="bar-style-field">
            <span>Sắp xếp</span>
            <select value={value.sort} onChange={event => update({ sort: event.target.value })}>
              <option value="desc">Giảm dần</option>
              <option value="asc">Tăng dần</option>
              <option value="none">Theo dữ liệu gốc</option>
            </select>
          </label>
        </div>
        <span className="bar-style-caption">Hướng biểu đồ</span>
        <div className="bar-segmented" role="group" aria-label="Hướng biểu đồ">
          <button type="button" className={value.orientation === "vertical" ? "active" : ""} onClick={() => update({ orientation: "vertical" })}>Cột dọc</button>
          <button type="button" className={value.orientation === "horizontal" ? "active" : ""} onClick={() => update({ orientation: "horizontal" })}>Thanh ngang</button>
        </div>
      </section>

      <section>
        <h3>2. Tùy chỉnh cột</h3>
        <RangeControl label="Độ rộng cột" value={value.barWidth} min={5} max={100} suffix="px" onChange={barWidth => update({ barWidth })} />
        <RangeControl label="Khoảng cách nhóm cột" value={value.barGap} min={0} max={60} suffix="%" onChange={barGap => update({ barGap })} />
      </section>

      <section>
        <h3>3. Màu sắc</h3>
        <div className="bar-color-list">
          {series.map((item, index) => (
            <ColorControl
              key={item.key}
              label={item.label}
              color={item.color}
              onChange={color => onSeriesChange(index, color)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3>4. Nhãn và trục tọa độ</h3>
        <CheckControl label="Hiển thị giá trị trên cột" checked={value.showDataLabels} onChange={showDataLabels => update({ showDataLabels })} />
        <CheckControl label="Hiển thị đường lưới" checked={value.showGrid} onChange={showGrid => update({ showGrid })} />
        <CheckControl label="Hiển thị chú giải" checked={value.showLegend} onChange={showLegend => update({ showLegend })} />
        <CheckControl label="Hiển thị tooltip" checked={value.showTooltip} onChange={showTooltip => update({ showTooltip })} />
      </section>
    </div>
  );
}

export function renderBarStylePanel(container, props) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(<BarStylePanel {...props} />);
}

export function clearBarStylePanel(container) {
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}

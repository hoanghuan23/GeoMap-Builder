import React from "react";
import { createRoot } from "react-dom/client";
import { nextMetricSelection, requiredMetricCount } from "../data-transformers.js";

const roots = new WeakMap();

function Panel({ analysis, datasetPath, xField, metrics, variant, warning, onChange, onResetMetrics }) {
  const dataset = analysis.datasets.find(item => item.path === datasetPath) || analysis.datasets[0];
  const rule = requiredMetricCount(variant);
  const metricHint = rule.max === Infinity ? `Tối thiểu ${rule.min}` : `Chọn ${rule.min}`;
  return <div className="data-mapping-panel">
    <label className="mapping-field">
      <b>1. Tập dữ liệu</b>
      <select value={dataset?.path || ""} onChange={event => onChange({ datasetPath: event.target.value })}>
        {analysis.datasets.map(item => <option key={item.path} value={item.path}>{item.label} ({item.rowCount} bản ghi)</option>)}
      </select>
    </label>
    <label className="mapping-field">
      <b>2. Trường danh mục (Trục X)</b>
      <select value={xField || ""} onChange={event => onChange({ xField: event.target.value })}>
        <option value="" disabled>Chọn trường danh mục</option>
        {(dataset?.categoryFields || []).map(field => <option key={field.path} value={field.path}>{field.label} · {field.type}</option>)}
      </select>
    </label>
    <fieldset className="mapping-metrics">
      <legend>
        <b>3. Chỉ số hiển thị (Trục Y)</b>
        <span className="mapping-metrics-actions">
          <span>{metrics.length} đã chọn · {metricHint}</span>
          <button
            type="button"
            className="mapping-metrics-reset"
            aria-label="Đặt lại chỉ số hiển thị"
            title="Đặt lại chỉ số hiển thị"
            onClick={onResetMetrics}
          >↻</button>
        </span>
      </legend>
      <div className="mapping-metric-list">
        {(dataset?.numericFields || []).map(field => <label key={field.path}>
          <input
            type={variant === "single" ? "radio" : "checkbox"}
            name={variant === "single" ? "bar-metric" : undefined}
            checked={metrics.includes(field.path)}
            onChange={() => onChange({ metrics: nextMetricSelection(metrics, field.path, variant) })}
          />
          <span>{field.label}</span>
        </label>)}
      </div>
    </fieldset>
    {warning ? <p className="mapping-warning" role="alert">{warning}</p> : null}
  </div>;
}

export function renderDataMappingPanel(container, props) {
  let root = roots.get(container);
  if (!root) { root = createRoot(container); roots.set(container, root); }
  root.render(<Panel {...props} />);
}

export function clearDataMappingPanel(container) {
  const root = roots.get(container);
  if (root) { root.unmount(); roots.delete(container); }
  container?.replaceChildren();
}

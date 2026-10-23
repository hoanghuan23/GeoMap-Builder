import { humanizeField } from "./charts/data-transformers.js";
import { formatTimeValue } from "./time-values.js";

function isEmpty(value) {
  return value == null || typeof value === "string" && value.trim() === "";
}

function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
}

function formatPopupValue(value, column, label) {
  if (column.role === "time") return formatTimeValue(value, column, column.granularity === "datetime");
  if (column.role === "measure" && typeof value === "number" && Number.isFinite(value)) {
    const formatted = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 20 }).format(value);
    const unit = String(column.unit || "").trim();
    return unit && !normalizedText(label).includes(normalizedText(unit)) ? `${formatted} ${unit}` : formatted;
  }
  return String(value);
}

export function aiPopupRows(properties, columns) {
  const source = properties || {};
  const hasOwn = field => Object.prototype.hasOwnProperty.call(source, field);
  return (columns || []).flatMap(column => {
    if (!column?.name || column.role === "ignore" || !hasOwn(column.name) || isEmpty(source[column.name])) return [];
    const label = column.labelVi || humanizeField(column.name);
    return [{ field: column.name, label, value: formatPopupValue(source[column.name], column, label) }];
  });
}

export function createAiPopupContent(documentRef, feature, columns, geometryField, { records = [] } = {}) {
  const properties = feature?.properties || {};
  const card = documentRef.createElement("div");
  card.className = "weather-popup";
  const title = documentRef.createElement("strong");
  title.textContent = properties[geometryField] || properties.h3 || "Khu vực dữ liệu";
  if (records.length > 1) {
    const sections = documentRef.createElement("div");
    sections.className = "popup-source-records";
    for (const record of records) {
      const section = createAiPopupContent(documentRef, { properties: record }, columns, geometryField);
      section.className = "popup-source-record";
      sections.append(section);
    }
    card.append(title, sections);
    return card;
  }
  const list = documentRef.createElement("dl");
  for (const detail of aiPopupRows(properties, columns)) {
    const row = documentRef.createElement("div");
    const term = documentRef.createElement("dt");
    const value = documentRef.createElement("dd");
    term.textContent = detail.label;
    value.textContent = detail.value;
    row.append(term, value);
    list.append(row);
  }
  card.append(title, list);
  return card;
}

import { humanizeField } from "./charts/data-transformers.js";

function isEmpty(value) {
  return value == null || typeof value === "string" && value.trim() === "";
}

function normalizedText(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
}

function parsedDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value, granularity) {
  const date = parsedDate(value);
  if (!date) return String(value);
  if (granularity === "datetime") return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (granularity === "year") return String(year);
  if (granularity === "month") return `${month}/${year}`;
  const fullDate = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC"
  }).format(date);
  return granularity === "week" ? `Tuần ${fullDate}` : fullDate;
}

function formatPopupValue(value, column, label) {
  if (column.role === "time") return formatTime(value, column.granularity);
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

export function createAiPopupContent(documentRef, feature, columns, geometryField) {
  const properties = feature?.properties || {};
  const card = documentRef.createElement("div");
  card.className = "weather-popup";
  const title = documentRef.createElement("strong");
  title.textContent = properties[geometryField] || properties.h3 || "Khu vực dữ liệu";
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

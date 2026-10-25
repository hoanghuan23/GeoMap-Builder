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

function popupDetailKind(detail, column) {
  const name = normalizedText(`${detail.field} ${detail.label}`).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/ghi chu|\b(notes?|remarks?|comments?)\b/.test(name)) return "note";
  if (detail.value.length <= 80 && /cap nhat|\b(updated?|modified)\b/.test(name)) return "meta";
  if (detail.value.length > 80 || /[\r\n]/.test(detail.value) || column?.role === "text") return "description";
  if (["category", "geo"].includes(column?.role)) return "chip";
  if (["id", "time"].includes(column?.role)) return "meta";
  return "value";
}

export function createAiPopupContent(documentRef, feature, columns, geometryField, { records = [] } = {}) {
  const properties = feature?.properties || {};
  const card = documentRef.createElement("div");
  card.className = "weather-popup";
  const title = documentRef.createElement("strong");
  title.textContent = properties[geometryField] || properties.h3 || "Khu vực dữ liệu";
  if (records.length > 1) {
    title.className = "popup-country-title";
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
  const heading = documentRef.createElement("header");
  heading.className = "popup-info-heading";
  const caption = documentRef.createElement("small");
  caption.className = "popup-info-caption";
  const geometryColumn = (columns || []).find(column => column.name === geometryField);
  caption.textContent = geometryColumn ? `Thông tin ${geometryColumn.labelVi || humanizeField(geometryColumn.name)}` : "Thông tin khu vực";
  heading.append(caption, title);
  const list = documentRef.createElement("dl");
  list.className = "popup-info-details";
  const compactRows = { value: [], meta: [] };
  for (const detail of aiPopupRows(properties, columns)) {
    if (detail.field === geometryField) continue;
    const row = documentRef.createElement("div");
    const kind = popupDetailKind(detail, columns.find(column => column.name === detail.field));
    row.className = `popup-info-${kind}`;
    if (compactRows[kind]) {
      if (detail.label.length > 32 || detail.value.length > 24 || /[\r\n]/.test(detail.label)) {
        if (compactRows[kind].length % 2) compactRows[kind].at(-1).className += " popup-info-wide";
        compactRows[kind] = [];
        row.className += " popup-info-wide";
      } else compactRows[kind].push(row);
    }
    row.title = detail.label;
    const term = documentRef.createElement("dt");
    const value = documentRef.createElement("dd");
    term.textContent = detail.label;
    value.textContent = detail.value;
    row.append(term, value);
    list.append(row);
  }
  // Give an unpaired field the whole row rather than leaving an empty column.
  for (const rows of Object.values(compactRows)) {
    if (rows.length % 2) rows.at(-1).className += " popup-info-wide";
  }
  card.append(heading, list);
  return card;
}

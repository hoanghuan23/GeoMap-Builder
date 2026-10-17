// Calendar dates and recurring periods share ordering/filtering, but a period
// without a year must never acquire an invented year through Date.parse().
const MONTHS = "january february march april may june july august september october november december".split(" ");
const DAY_MS = 86_400_000;
export const TIME_GRANULARITIES = Object.freeze(["day", "week", "month", "quarter", "year"]);

function folded(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function inferTimeGranularity(name) {
  const text = folded(name);
  if (/(quarter|quy)/.test(text)) return "quarter";
  if (/(month|thang)/.test(text)) return "month";
  if (/(week|tuan)/.test(text)) return "week";
  if (/(year|nam)/.test(text)) return "year";
  return "day";
}

function calendarDate(year, month = 1, day = 1) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function instant(date, granularity = "day") {
  return date && Number.isFinite(date.getTime())
    ? { value: date, kind: "instant", key: date.toISOString(), order: date.getTime(), granularity } : null;
}

function period(value, granularity, ordinal, year) {
  const limit = { month: 12, quarter: 4, week: 53 }[granularity];
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > limit) return null;
  if (year == null) return { value, kind: granularity, key: `${granularity}:${ordinal}`, order: ordinal, granularity };
  if (!Number.isInteger(year) || year < 100 || year > 9999) return null;
  if (granularity === "month") return instant(calendarDate(year, ordinal), granularity);
  if (granularity === "quarter") return instant(calendarDate(year, (ordinal - 1) * 3 + 1), granularity);
  const jan4 = calendarDate(year, 1, 4);
  const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY_MS + (ordinal - 1) * 7 * DAY_MS;
  // The Thursday determines the ISO week year; reject W53 in a 52-week year.
  if (new Date(monday + 3 * DAY_MS).getUTCFullYear() !== year) return null;
  return instant(new Date(monday), granularity);
}

export function timeValueInfo(value, column = {}) {
  if (Object.prototype.toString.call(value) === "[object Date]") return instant(new Date(value.getTime()), column.granularity);
  if (value == null || typeof value === "boolean" || String(value).trim() === "") return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  const number = Number(text);
  const mode = column.timeParse;
  if (Number.isFinite(number) && ["excel_serial", "unix_s", "unix_ms"].includes(mode)) {
    return instant(new Date(mode === "excel_serial" ? Date.UTC(1899, 11, 30) + number * DAY_MS : number * (mode === "unix_s" ? 1000 : 1)), column.granularity);
  }
  const normalized = folded(text);
  const prefixes = { month: "(?:thang|month|m|t)", quarter: "(?:quarter|quy|q)", week: "(?:week|tuan|w)" };
  for (const [granularity, prefix] of Object.entries(prefixes)) {
    const leading = new RegExp(`^${prefix}\\s*[-_/]?\\s*(\\d{1,2})(?:[\\s/_-]+(\\d{4}))?$`).exec(normalized);
    const trailing = new RegExp(`^(\\d{4})[\\s/_-]*${prefix}\\s*[-_/]?\\s*(\\d{1,2})$`).exec(normalized);
    if (leading || trailing) {
      const year = leading?.[2] ?? trailing?.[1];
      return period(value, granularity, Number(leading?.[1] ?? trailing[2]), year == null ? null : Number(year));
    }
  }
  const monthName = /^([a-z]+)\.?(?:[\s/-]+(\d{4}))?$/.exec(normalized);
  if (monthName) {
    const index = MONTHS.findIndex(month => month === monthName[1] || month.slice(0, 3) === monthName[1]);
    if (index >= 0) return period(text, "month", index + 1, monthName[2] == null ? null : Number(monthName[2]));
  }
  if (/^\d{1,2}$/.test(text) && ["month", "quarter", "week"].includes(column.granularity)) {
    return period(value, column.granularity, number, null);
  }
  if (/^\d{4}$/.test(text) && number >= 1900 && number <= 2200) return instant(calendarDate(number), "year");
  let match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (match) return instant(calendarDate(Number(match[1]), Number(match[2])), "month");
  match = /^(\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) return instant(calendarDate(Number(match[2]), Number(match[1])), "month");
  match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  if (match && mode === "text") return instant(calendarDate(Number(match[3]), Number(match[2]), Number(match[1])), "day");
  match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (match) {
    const date = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!date || Number(match[4] || 0) > 23 || Number(match[5] || 0) > 59 || Number(match[6] || 0) > 59) return null;
    return instant(match[4] == null ? date : new Date(text), column.granularity);
  }
  if (Number.isFinite(number)) {
    if (number >= 1e12) return instant(new Date(number), column.granularity);
    if (number >= 1e9) return instant(new Date(number * 1000), column.granularity);
    if (number >= 20_000 && number <= 80_000) return instant(new Date(Date.UTC(1899, 11, 30) + number * DAY_MS), column.granularity);
  }
  return null;
}

export function normalizeTimeValue(value, column = {}) {
  const info = timeValueInfo(value, column);
  return info ? info.value instanceof Date ? info.value : typeof info.value === "string" ? info.value.trim().replace(/\s+/g, " ") : info.value : null;
}

export function compareTimeValues(left, right, column = {}) {
  const a = timeValueInfo(left, column); const b = timeValueInfo(right, column);
  if (a && b && a.kind === b.kind) return a.order - b.order;
  return String(left ?? "").localeCompare(String(right ?? ""), "vi", { numeric: true, sensitivity: "base" });
}

export function timeValuesAreComparable(values, column = {}) {
  const infos = values.map(value => timeValueInfo(value, column));
  return infos.length > 0 && infos.every(info => info && info.kind === infos[0].kind);
}

export function uniqueTimeValues(records, column) {
  const values = new Map();
  for (const record of records) {
    const info = timeValueInfo(record?.[column.name], column);
    if (info) values.set(info.key, record[column.name]);
  }
  return [...values.values()].sort((a, b) => compareTimeValues(a, b, column));
}

export function filterTimeRange(records, column, from, to) {
  if (from == null || to == null) return records;
  const low = timeValueInfo(from, column); const high = timeValueInfo(to, column);
  if (!low || !high || low.kind !== high.kind) return records;
  const min = Math.min(low.order, high.order); const max = Math.max(low.order, high.order);
  return records.filter(record => {
    const info = timeValueInfo(record?.[column.name], column);
    return info && info.kind === low.kind && info.order >= min && info.order <= max;
  });
}

export function formatTimeValue(value, column = {}, includeTime = false) {
  const info = timeValueInfo(value, column);
  if (!info || info.kind !== "instant") return String(value ?? "");
  const date = info.value;
  const granularity = column.granularity || info.granularity;
  if (includeTime) return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
  if (granularity === "year") return String(date.getUTCFullYear());
  if (granularity === "quarter") return `Q${Math.floor(date.getUTCMonth() / 3) + 1}/${date.getUTCFullYear()}`;
  if (granularity === "month") return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
  const label = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(date);
  return granularity === "week" ? `Tuần ${label}` : label;
}

export function chartTimeValue(value, column = {}) {
  const info = timeValueInfo(value, column);
  if (!info || info.kind !== "instant") return String(value ?? "");
  const iso = info.value.toISOString();
  if (!iso.endsWith("T00:00:00.000Z")) return iso;
  // Only shorten exact period boundaries; otherwise different observations
  // within the same month/quarter could acquire identical axis labels.
  const startOfMonth = info.value.getUTCDate() === 1;
  if (column.granularity === "quarter" && startOfMonth && info.value.getUTCMonth() % 3 === 0) return formatTimeValue(value, column);
  if (column.granularity === "month" && startOfMonth) return iso.slice(0, 7);
  if (column.granularity === "year" && startOfMonth && info.value.getUTCMonth() === 0) return String(info.value.getUTCFullYear());
  return iso.slice(0, 10);
}

function isDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime());
}

function cleanString(value, maxLength = 160) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function jsonValue(value) {
  if (isDate(value)) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return cleanString(value);
  if (["number", "boolean"].includes(typeof value) || value == null) return value;
  return cleanString(value);
}

function comparable(value) {
  return isDate(value) ? value.toISOString() : `${typeof value}:${String(value)}`;
}

function numericValue(value, commaDecimal = false) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const normalized = commaDecimal && /^-?\d+,\d+$/.test(text) ? text.replace(",", ".") : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

const TIME_COLUMN_HINT = /(^|[ _-])(date|time|day|month|year|ngay|ngày|thang|tháng|nam|năm|timestamp)([ _-]|$)/i;
const ISO_DATE = /^\d{4}-\d{2}(?:-\d{2})?/;

function dateHint(name, state) {
  if (state.nonNullCount && state.allDates) return "iso";
  if (state.nonNullCount && state.allIsoStrings) return "iso";
  if (!TIME_COLUMN_HINT.test(name)) return null;
  if (state.nonNullCount && state.allExcelNumbers) return "excel_serial";
  if (state.nonNullCount && state.allUnixMilliseconds) return "unix_ms";
  if (state.nonNullCount && state.allUnixSeconds) return "unix_s";
  return null;
}

function sampleSeed(name) {
  return [...String(name)].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 2166136261);
}

function createColumnState(name) {
  return {
    name,
    nonNullCount: 0,
    standardNumberCount: 0,
    commaNumberCount: 0,
    standardMin: Infinity,
    standardMax: -Infinity,
    commaMin: Infinity,
    commaMax: -Infinity,
    commaSeen: false,
    allStringCommaCompatible: true,
    allDates: true,
    allIsoStrings: true,
    allExcelNumbers: true,
    allUnixSeconds: true,
    allUnixMilliseconds: true,
    dateMin: Infinity,
    dateMax: -Infinity,
    uniques: new Set(),
    uniqueCountCapped: false,
    samples: [],
    sampleCount: 0,
    sampleState: sampleSeed(name)
  };
}

function updateNumberRange(state, prefix, value) {
  if (!Number.isFinite(value)) return;
  state[`${prefix}NumberCount`] += 1;
  state[`${prefix}Min`] = Math.min(state[`${prefix}Min`], value);
  state[`${prefix}Max`] = Math.max(state[`${prefix}Max`], value);
}

function updateSample(state, value, maxSamples) {
  state.sampleCount += 1;
  if (state.samples.length < maxSamples) {
    state.samples.push(value);
    return;
  }
  state.sampleState = (1664525 * state.sampleState + 1013904223) >>> 0;
  const pick = state.sampleState % state.sampleCount;
  if (pick < maxSamples) state.samples[pick] = value;
}

export function profileTabularData(records, { includeSamples = false, maxSamples = 5, maxHead = 8, uniqueCap = 10_000 } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error("File không có bản ghi dữ liệu.");
  const states = new Map();
  const head = [];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    if (includeSamples && head.length < maxHead) {
      head.push(Object.fromEntries(Object.entries(record).map(([key, value]) => [key, jsonValue(value)])));
    }
    for (const [name, value] of Object.entries(record)) {
      if (!states.has(name)) states.set(name, createColumnState(name));
      const state = states.get(name);
      if (value == null || value === "") continue;
      state.nonNullCount += 1;
      const text = typeof value === "string" ? value.trim() : null;
      const standardNumber = numericValue(value, false);
      const commaNumber = typeof value === "string"
        ? /^-?\d+(?:,\d+)?$/.test(text) ? Number(text.replace(",", ".")) : null
        : numericValue(value, false);
      updateNumberRange(state, "standard", standardNumber);
      updateNumberRange(state, "comma", commaNumber);
      if (typeof value === "string") {
        state.commaSeen ||= /^-?\d+,\d+$/.test(text);
        state.allStringCommaCompatible &&= /^-?\d+(?:,\d+)?$/.test(text);
      }
      state.allDates &&= isDate(value);
      state.allIsoStrings &&= typeof value === "string" && ISO_DATE.test(text);
      state.allExcelNumbers &&= typeof value === "number" && value >= 20_000 && value <= 80_000;
      state.allUnixSeconds &&= typeof value === "number" && value >= 1e9 && value < 1e12;
      state.allUnixMilliseconds &&= typeof value === "number" && value >= 1e12;
      if (isDate(value)) {
        state.dateMin = Math.min(state.dateMin, value.getTime());
        state.dateMax = Math.max(state.dateMax, value.getTime());
      } else if (typeof value === "string" && ISO_DATE.test(text)) {
        const timestamp = Date.parse(text);
        if (!Number.isNaN(timestamp)) {
          state.dateMin = Math.min(state.dateMin, timestamp);
          state.dateMax = Math.max(state.dateMax, timestamp);
        }
      }
      const key = comparable(value);
      if (!state.uniques.has(key)) {
        if (state.uniques.size >= uniqueCap) state.uniqueCountCapped = true;
        else state.uniques.add(key);
      }
      if (includeSamples) updateSample(state, value, maxSamples);
    }
  }
  if (!states.size) throw new Error("Không tìm thấy header hợp lệ trong bảng dữ liệu.");
  const columns = [...states.values()].map(state => {
    const commaDecimal = state.commaSeen && state.allStringCommaCompatible;
    const numericCount = commaDecimal ? state.commaNumberCount : state.standardNumberCount;
    const numericMin = commaDecimal ? state.commaMin : state.standardMin;
    const numericMax = commaDecimal ? state.commaMax : state.standardMax;
    const hint = dateHint(state.name, state);
    const inferredType = hint ? "date" : state.nonNullCount && numericCount === state.nonNullCount ? "number" : "text";
    let min = inferredType === "number" && Number.isFinite(numericMin) ? numericMin : null;
    let max = inferredType === "number" && Number.isFinite(numericMax) ? numericMax : null;
    if (inferredType === "date") {
      if (Number.isFinite(state.dateMin)) {
        min = new Date(state.dateMin).toISOString();
        max = new Date(state.dateMax).toISOString();
      } else if (Number.isFinite(state.standardMin)) {
        min = parseTimeValue(state.standardMin, hint)?.toISOString() || null;
        max = parseTimeValue(state.standardMax, hint)?.toISOString() || null;
      }
    }
    const column = {
      name: state.name,
      inferredType,
      nullPct: Number((((records.length - state.nonNullCount) / records.length) * 100).toFixed(1)),
      uniqueCount: state.uniques.size,
      uniqueCountCapped: state.uniqueCountCapped,
      min,
      max,
      dateHint: hint,
      commaDecimal
    };
    if (includeSamples) column.samples = state.samples.map(jsonValue);
    return column;
  });
  const profile = { rowCount: records.length, columns, samplesIncluded: Boolean(includeSamples) };
  if (includeSamples) profile.head = head;
  return profile;
}

function excelSerialDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const timestamp = Date.UTC(1899, 11, 30) + number * 86_400_000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTimeValue(value, hint = null, granularity = null) {
  if (isDate(value)) return new Date(value.getTime());
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  const fromNumber = mode => {
    if (!Number.isFinite(number)) return null;
    if (mode === "excel_serial") return excelSerialDate(number);
    if (mode === "unix_s") return new Date(number * 1000);
    if (mode === "unix_ms") return new Date(number);
    return null;
  };
  let parsed = fromNumber(hint);
  if (!parsed && granularity === "year" && Number.isInteger(number) && number >= 1900 && number <= 2200) parsed = new Date(Date.UTC(number, 0, 1));
  if (!parsed && hint === "text" && typeof value === "string") {
    const timestamp = Date.parse(String(value));
    if (!Number.isNaN(timestamp)) parsed = new Date(timestamp);
  }
  if (!parsed && hint === "iso" && typeof value === "string" && ISO_DATE.test(value.trim())) {
    const timestamp = Date.parse(value.trim());
    if (!Number.isNaN(timestamp)) parsed = new Date(timestamp);
  }
  if (!parsed && Number.isFinite(number)) {
    if (number >= 1e12) parsed = new Date(number);
    else if (number >= 1e9) parsed = new Date(number * 1000);
    else if (number >= 20_000 && number <= 80_000) parsed = excelSerialDate(number);
  }
  if (!parsed && typeof value === "string" && ISO_DATE.test(value.trim())) {
    const timestamp = Date.parse(value.trim());
    if (!Number.isNaN(timestamp)) parsed = new Date(timestamp);
  }
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function normalizeTabularRecords(records, columns) {
  const columnMap = new Map((columns || []).map(column => [column.name, column]));
  const commaDecimal = new Map();
  for (const column of columns || []) {
    if (column.role !== "measure") continue;
    const strings = records.map(record => record?.[column.name]).filter(value => typeof value === "string" && value.trim());
    commaDecimal.set(column.name, strings.length > 0 && strings.every(value => /^-?\d+(?:,\d+)?$/.test(value.trim())) && strings.some(value => value.includes(",")));
  }
  const validByColumn = new Map((columns || []).map(column => [column.name, 0]));
  const normalized = records.map(record => {
    const next = { ...record };
    for (const [name, column] of columnMap) {
      if (column.role === "time") next[name] = parseTimeValue(record?.[name], column.timeParse, column.granularity);
      else if (column.role === "measure") next[name] = numericValue(record?.[name], commaDecimal.get(name));
      if (next[name] !== null && next[name] !== "" && next[name] !== undefined) validByColumn.set(name, validByColumn.get(name) + 1);
    }
    return next;
  });
  return {
    records: normalized,
    validRowRate: Object.fromEntries([...validByColumn].map(([name, count]) => [name, records.length ? count / records.length : 0]))
  };
}

export function serializeTabularValue(value) {
  return isDate(value) ? value.toISOString() : value;
}

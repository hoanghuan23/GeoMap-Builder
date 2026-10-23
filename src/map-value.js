export const MAP_NO_DATA_COLOR = "rgba(0, 0, 0, 0)";

export function numericMapValue(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Map features store normalized numeric measures. Keep their geometry and identity
// even when a measure is missing; only its thematic paint becomes transparent.
export function numericMapColor(field, color) {
  return ["case", ["==", ["typeof", ["get", field]], "number"], color, MAP_NO_DATA_COLOR];
}

export function coordinatePair(record, { lat, lng }) {
  const valid = value => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value));
  if (!valid(record?.[lat]) || !valid(record?.[lng])) return null;
  const latitude = Number(record[lat]); const longitude = Number(record[lng]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? [longitude, latitude] : null;
}


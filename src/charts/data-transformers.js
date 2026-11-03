export const BAR_COLORS = Object.freeze(["#63c785", "#f58b61", "#5b8ff9", "#f6bd16", "#9270ca", "#6dc8ec"]);

export function humanizeField(value) {
  const text = String(value).replaceAll("_", " ").replaceAll(".", " · ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

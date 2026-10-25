import { categoryColorProperties } from "../categorical-color.js";

export const POLYGON_COLOR_RAMPS = Object.freeze({
  diverging: Object.freeze(["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"]),
  viridis: Object.freeze(["#440154", "#31688e", "#35b779", "#fde725"]),
  blue: Object.freeze(["#eff6ff", "#60a5fa", "#1d4ed8"])
});

function featureProperties(data) {
  if (data?.type === "FeatureCollection") return (data.features || []).map(feature => feature?.properties || {});
  if (data?.type === "Feature") return [data.properties || {}];
  return [];
}

function categoricalField(records, fields) {
  const candidates = fields.map(field => ({
    field,
    values: [...new Set(records.map(record => record[field]).filter(value => value != null && String(value).trim() !== ""))]
  })).filter(candidate => candidate.values.length > 1);
  const hinted = candidates.find(candidate => /(^|[._])(province|region|name_1|name|category)($|[._])/i.test(candidate.field));
  return hinted || candidates.sort((a, b) => a.values.length - b.values.length)[0] || null;
}

export function polygonColorField(data, profile = {}) {
  const records = featureProperties(data);
  for (const field of profile?.numericFields || []) {
    const values = records
      .map(record => record[field])
      .filter(value => value != null && value !== "")
      .map(Number)
      .filter(Number.isFinite);
    if (values.length && Math.min(...values) !== Math.max(...values)) return { field, type: "number", values };
  }
  const category = categoricalField(records, profile?.textFields || []);
  return category ? { ...category, type: "category" } : null;
}

export function polygonFillExpression(data, profile, rampName, fallbackColor, resolvedScale = null) {
  if (resolvedScale) {
    const noDataColor = resolvedScale.noDataColor || fallbackColor;
    if (resolvedScale.type === "categorical") {
      const entries = [...resolvedScale.entries.map(entry => ({ key: categoryColorProperties(resolvedScale.field, [entry.value]).__category_color_key, color: entry.color })),
        ...resolvedScale.mixed.filter(entry => entry.color)];
      return entries.length ? ["match", ["get", "__category_color_key"], ...entries.flatMap(entry => [entry.key, entry.color]), noDataColor] : noDataColor;
    }
    if (!resolvedScale.hasData || !resolvedScale.stops.length) return noDataColor;
    const value = ["get", resolvedScale.field];
    // GeoJSON from this pipeline stores numbers. Missing values must not become zero.
    const paint = resolvedScale.stops.length === 1 ? resolvedScale.colors[0]
      : ["interpolate", ["linear"], ["to-number", value, resolvedScale.min], ...resolvedScale.stops.flat()];
    return ["case", ["==", ["typeof", value], "number"], paint, noDataColor];
  }
  const colors = POLYGON_COLOR_RAMPS[rampName];
  const colorField = colors && polygonColorField(data, profile);
  if (!colors || !colorField) return fallbackColor;

  if (colorField.type === "number") {
    const min = Math.min(...colorField.values);
    const max = Math.max(...colorField.values);
    const stops = colors.flatMap((color, index) => [min + (max - min) * index / (colors.length - 1), color]);
    return ["interpolate", ["linear"], ["to-number", ["get", colorField.field], min], ...stops];
  }

  const matches = colorField.values.flatMap((value, index) => [value, colors[index % colors.length]]);
  return ["match", ["get", colorField.field], ...matches, fallbackColor];
}

export function polygonLegendScale(data, profile, rampName, resolvedScale = null) {
  if (resolvedScale?.type === "categorical") return resolvedScale.hasData ? resolvedScale : null;
  if (resolvedScale) return resolvedScale.hasData && resolvedScale.stops.length ? resolvedScale : null;
  const colors = POLYGON_COLOR_RAMPS[rampName];
  const colorField = colors && polygonColorField(data, profile);
  if (!colors || colorField?.type !== "number") return null;
  const min = Math.min(...colorField.values);
  const max = Math.max(...colorField.values);
  return {
    field: colorField.field,
    colors,
    values: colors.map((_, index) => min + (max - min) * index / (colors.length - 1)),
    gradient: `linear-gradient(90deg, ${colors.join(", ")})`
  };
}

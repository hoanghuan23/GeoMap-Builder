import { categoryColorProperties } from "../categorical-color.js";
import { MAP_NO_DATA_COLOR, numericMapColor, numericMapValue } from "../map-value.js";

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
  })).filter(candidate => candidate.values.length > 0);
  const hinted = candidates.find(candidate => /(^|[._])(province|region|name_1|name|category)($|[._])/i.test(candidate.field));
  return hinted || candidates.sort((a, b) => a.values.length - b.values.length)[0] || null;
}

export function polygonColorField(data, profile = {}) {
  const records = featureProperties(data);
  const field = profile?.numericFields?.[0];
  if (field) {
    const values = records
      .map(record => record[field])
      .map(numericMapValue)
      .filter(value => value != null);
    return { field, type: "number", values };
  }
  const category = categoricalField(records, profile?.textFields || []);
  return category ? { ...category, type: "category" } : null;
}

export function polygonFillExpression(data, profile, rampName, fallbackColor, resolvedScale = null) {
  if (resolvedScale) {
    const noDataColor = resolvedScale.noDataColor || MAP_NO_DATA_COLOR;
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
    return numericMapColor(resolvedScale.field, paint);
  }
  const colors = POLYGON_COLOR_RAMPS[rampName];
  const colorField = polygonColorField(data, profile);
  if (!colorField) return fallbackColor;

  if (colorField.type === "number") {
    if (!colorField.values.length) return MAP_NO_DATA_COLOR;
    const min = Math.min(...colorField.values);
    const max = Math.max(...colorField.values);
    if (!colors || min === max) return numericMapColor(colorField.field, colors ? colors[Math.floor(colors.length / 2)] : fallbackColor);
    const stops = colors.flatMap((color, index) => [min + (max - min) * index / (colors.length - 1), color]);
    return numericMapColor(colorField.field, ["interpolate", ["linear"], ["to-number", ["get", colorField.field], min], ...stops]);
  }

  const matches = colorField.values.flatMap((value, index) => [value, colors ? colors[index % colors.length] : fallbackColor]);
  return ["match", ["get", colorField.field], ...matches, MAP_NO_DATA_COLOR];
}

export function polygonLegendScale(data, profile, rampName, resolvedScale = null) {
  if (resolvedScale?.type === "categorical") return resolvedScale.hasData ? resolvedScale : null;
  if (resolvedScale) return resolvedScale.hasData && resolvedScale.stops.length ? resolvedScale : null;
  const colors = POLYGON_COLOR_RAMPS[rampName];
  const colorField = colors && polygonColorField(data, profile);
  if (!colors || colorField?.type !== "number" || !colorField.values.length) return null;
  const min = Math.min(...colorField.values);
  const max = Math.max(...colorField.values);
  if (min === max) {
    const color = colors[Math.floor(colors.length / 2)];
    return { field: colorField.field, colors: [color], values: [min], gradient: color };
  }
  return {
    field: colorField.field,
    colors,
    values: colors.map((_, index) => min + (max - min) * index / (colors.length - 1)),
    gradient: `linear-gradient(90deg, ${colors.join(", ")})`
  };
}

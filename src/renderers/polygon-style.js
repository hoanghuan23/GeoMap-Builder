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

export function polygonFillExpression(data, profile, rampName, fallbackColor) {
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

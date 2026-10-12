export const TEMPERATURE_STOPS = Object.freeze({
  diverging: [[10, "#313695"], [20, "#74add1"], [25, "#ffffbf"], [30, "#f46d43"], [38, "#a50026"]],
  viridis: [[10, "#440154"], [20, "#31688e"], [25, "#35b779"], [30, "#90d743"], [38, "#fde725"]],
  blue: [[10, "#eff6ff"], [20, "#bfdbfe"], [25, "#60a5fa"], [30, "#2563eb"], [38, "#1e3a8a"]]
});

export function temperatureLegendGradient(palette) {
  const stops = TEMPERATURE_STOPS[palette];
  if (!stops?.length) return "";
  const min = stops[0][0];
  const max = stops.at(-1)[0];
  const range = max - min;
  const colors = stops.map(([temperature, color]) => {
    const position = range ? (temperature - min) / range * 100 : 0;
    return `${color} ${Number(position.toFixed(2))}%`;
  });
  return `linear-gradient(90deg, ${colors.join(", ")})`;
}

export function temperatureFillExpression(palette, fallbackColor) {
  const stops = TEMPERATURE_STOPS[palette];
  if (!stops) return fallbackColor;
  return [
    "case",
    ["has", "temperature"],
    ["interpolate", ["linear"], ["to-number", ["get", "temperature"]], ...stops.flat()],
    fallbackColor
  ];
}

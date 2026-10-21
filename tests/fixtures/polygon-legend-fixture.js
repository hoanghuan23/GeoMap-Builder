export function legendFixture(overrides = {}) {
  return {
    aggregation: "mean", type: "continuous", mode: "semantic",
    title: "Nhiệt độ quan sát", unit: "°C", domain: [-20, 40], center: null,
    stops: [
      { value: -20, color: "#123456" }, { value: -10, color: "#456789" }, { value: 0, color: "#789abc" },
      { value: 10, color: "#abcdef" }, { value: 20, color: "#fedcba" }, { value: 30, color: "#d39076" }, { value: 40, color: "#a86432" }
    ],
    reason: "Thang minh họa do AI đề xuất cho dữ liệu kiểm thử.", ...overrides
  };
}

export const legendColumn = { name: "temperature", role: "measure", unit: "°C", unitSource: "explicit", aggDefault: "mean" };
export const legendSuggestion = { id: "polygon", chartType: "choropleth", bindings: { region: "region", value: "temperature" }, agg: "mean" };
export const legendData = values => ({ type: "FeatureCollection", features: values.map(temperature => ({ type: "Feature", properties: { temperature, unrelated: 999 } })) });

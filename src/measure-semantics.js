export const AGGREGATION_VALUES = Object.freeze(["sum", "mean", "min", "max", "count"]);

export function inferMeasureAggregation(column) {
  const text = `${column?.name || ""} ${column?.labelVi || ""} ${column?.unit || ""}`
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[_./-]/g, " ");
  // Rates and averages take precedence over additive words, e.g. revenue_rate.
  if (/%|°|\b(rate|ratio|average|avg|mean|temperature|humidity|speed|density|price|index)\b|ty le|trung binh|nhiet do|do am|toc do|mat do|don gia/.test(text)) return "mean";
  if (/\b(total|amount|revenue|sales|rainfall|rain|count|quantity|cost|profit)\b|tong|doanh thu|luong mua|so luong|chi phi|loi nhuan/.test(text)) return "sum";
  return null;
}

export function measureAggregation(column) {
  return AGGREGATION_VALUES.includes(column?.aggDefault) ? column.aggDefault : inferMeasureAggregation(column);
}

export function measureUnit(column) {
  return String(column?.unit || "").trim().toLocaleLowerCase("vi");
}

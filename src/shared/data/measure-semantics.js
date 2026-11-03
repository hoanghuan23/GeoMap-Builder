export const AGGREGATION_VALUES = Object.freeze(["sum", "mean", "min", "max", "count"]);

export function measureAggregation(column) {
  return AGGREGATION_VALUES.includes(column?.aggDefault) ? column.aggDefault : null;
}

export function measureUnit(column) {
  return String(column?.unit || "").trim().toLocaleLowerCase("vi");
}

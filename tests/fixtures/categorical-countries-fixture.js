import { descriptiveColumns, descriptiveRecords, descriptiveSuggestion } from "./descriptive-countries-fixture.js";

export const accessField = "Cấp độ tiếp cận";
export const accessLegend = {
  aggregation: null, type: "categorical", mode: "semantic", title: accessField, unit: null, domain: null, center: null,
  stops: [
    { value: "Miễn thị thực", color: "#15803d" }, { value: "Thị thực khi đến", color: "#2563eb" },
    { value: "Giấy phép du lịch điện tử (eTA)", color: "#d97706" }, { value: "Mở một phần / quá cảnh", color: "#9333ea" }
  ],
  combinations: [{ values: ["Miễn thị thực", "Thị thực khi đến"], color: "#be185d" }],
  reason: "Bảng màu mô phỏng đầu ra AI, mỗi loại và tổ hợp có một màu phân biệt."
};
export function categoricalCountryFixture() {
  const columns = descriptiveColumns.map(column => column.name === "Điều kiện"
    ? { name: accessField, labelVi: accessField, role: "category", legend: structuredClone(accessLegend) } : { ...column });
  const records = descriptiveRecords.map((row, index) => {
    const { "Điều kiện": condition, ...properties } = row;
    return { ...properties, [accessField]: accessLegend.stops[(index >= 50 ? index - 50 : index) % 4].value };
  });
  return { records, columns, suggestion: { ...descriptiveSuggestion, bindings: { ...descriptiveSuggestion.bindings, value: accessField }, legend: null } };
}

import test from "node:test";
import assert from "node:assert/strict";
import { displayFilterValue, fallbackMapRecommendation, summarizeTabularData } from "../src/ai-data-analysis.js";

const records = [
  { "Tỉnh/thành phố": "Hà Nội", "Ngày": new Date("2026-09-01T00:00:00Z"), "Nhiệt độ trung bình": 29.4, "Độ ẩm": 70 },
  { "Tỉnh/thành phố": "Đà Nẵng", "Ngày": new Date("2026-09-01T00:00:00Z"), "Nhiệt độ trung bình": 30.1, "Độ ẩm": 74 }
];

test("tóm tắt bảng dữ liệu mà không gửi toàn bộ workbook", () => {
  const summary = summarizeTabularData(records);
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.columns.find(column => column.name === "Ngày").inferredType, "date");
  assert.equal(summary.samples[0]["Ngày"], "2026-09-01");
});

test("rule fallback nhận diện địa phương, thời gian và metric", () => {
  const recommendation = fallbackMapRecommendation(records);
  assert.equal(recommendation.visualization, "polygon");
  assert.deepEqual(recommendation.geometry, { field: "Tỉnh/thành phố", provider: "maptiler", placeType: "region" });
  assert.equal(recommendation.metricField, "Nhiệt độ trung bình");
  assert.deepEqual(recommendation.numericFields, ["Nhiệt độ trung bình", "Độ ẩm"]);
  assert.deepEqual(recommendation.filters, [
    { field: "Tỉnh/thành phố", label: "Tỉnh/thành phố", control: "select", allowAll: true },
    { field: "Ngày", label: "Ngày", control: "date-select", allowAll: false }
  ]);
});

test("không sinh option thời gian khi dataset không có chiều thời gian", () => {
  const recommendation = fallbackMapRecommendation([
    { province: "A", population: 10 },
    { province: "B", population: 20 }
  ]);
  assert.deepEqual(recommendation.filters.map(filter => filter.field), ["province"]);
});

test("định dạng filter thời gian dựa trên spec thay vì tên cột", () => {
  assert.equal(displayFilterValue("2026-09-01", "date-select"), "01/09/2026");
  assert.equal(displayFilterValue("Ca sáng", "select"), "Ca sáng");
});

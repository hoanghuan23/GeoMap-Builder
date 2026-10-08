import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDataSets,
  createBarOptions,
  dataForBarMapping,
  nextMetricSelection,
  reconcileSeriesColors,
  validateBarMapping
} from "../src/charts/data-transformers.js";

const input = {
  regional_averages: [
    { region: "Miền Bắc", observed_at: "2026-01-01", average_score: 7.1, rank: 1, breakdown: { freedom: 5.2 }, empty: null },
    { region: "Miền Nam", observed_at: "2026-02-01", average_score: 7.4, rank: 2, breakdown: { freedom: 5.8 }, active: true }
  ],
  summary: [{ name: "Cả nước", value: 7.25 }]
};

test("phân tích toàn bộ dataset, đường dẫn lồng nhau và schema", () => {
  const datasets = analyzeDataSets(input);
  assert.equal(datasets.length, 2);
  const regional = datasets.find(dataset => dataset.path === "regional_averages");
  assert.equal(regional.rowCount, 2);
  assert.equal(regional.suggestedCategory, "region");
  assert.deepEqual(regional.numericFields.map(field => field.path), ["average_score", "breakdown.freedom"]);
  assert.equal(regional.fields.find(field => field.path === "observed_at").type, "Date");
  assert.equal(regional.fields.find(field => field.path === "active").type, "Boolean");
  assert.equal(regional.fields.find(field => field.path === "active").nullable, true);
  assert.equal(regional.records[0]["breakdown.freedom"], 5.2);
});

test("tạo đủ lựa chọn cột khi có hai chỉ số", () => {
  const dataset = analyzeDataSets(input)[0];
  const options = createBarOptions(dataset);
  assert.deepEqual(options.map(option => option.id), ["single_bar", "double_bar", "grouped_bar"]);
  assert.equal(options[2].config.series.length, 2);
});

test("kiểm tra đúng quy tắc số chỉ số và không tự sửa lựa chọn", () => {
  const dataset = analyzeDataSets(input)[0];
  const mapping = { xField: "region", metrics: ["average_score"] };
  assert.equal(validateBarMapping(dataset, mapping, "single").valid, true);
  assert.deepEqual(mapping.metrics, ["average_score"]);
  assert.equal(validateBarMapping(dataset, mapping, "double").message, "Cột đôi cần đúng 2 chỉ số.");
  assert.equal(validateBarMapping(dataset, { ...mapping, metrics: ["average_score", "breakdown.freedom"] }, "grouped").valid, true);
});

test("loại bản ghi thiếu giá trị thay vì biến null thành 0", () => {
  const dataset = analyzeDataSets([{ region: "A", score: 2 }, { region: "B", score: null }])[0];
  assert.deepEqual(dataForBarMapping(dataset, { xField: "region", metrics: ["score"] }), [{ region: "A", score: 2 }]);
});

test("cột đơn chỉ giữ một chỉ số và cột đôi bỏ lựa chọn cũ nhất", () => {
  assert.deepEqual(nextMetricSelection(["desktop"], "mobile", "single"), ["mobile"]);
  assert.deepEqual(nextMetricSelection(["desktop", "mobile"], "tablet", "double"), ["mobile", "tablet"]);
  assert.deepEqual(nextMetricSelection(["desktop", "mobile"], "desktop", "double"), ["mobile"]);
  assert.deepEqual(nextMetricSelection(["desktop", "mobile"], "tablet", "grouped"), ["desktop", "mobile", "tablet"]);
  assert.deepEqual(nextMetricSelection(["desktop"], "mobile", "line"), ["desktop", "mobile"]);
});

test("không giữ màu trùng khi thay chỉ số của biểu đồ đôi", () => {
  const next = [
    { key: "mobile", label: "Mobile", color: "#63c785" },
    { key: "desktop", label: "Desktop", color: "#f58b61" }
  ];
  const previous = [
    { key: "mobile", color: "#f58b61" },
    { key: "desktop", color: "#f58b61" }
  ];
  const result = reconcileSeriesColors(next, previous);
  assert.equal(result[0].color, "#f58b61");
  assert.equal(result[1].color, "#63c785");
  assert.equal(new Set(result.map(item => item.color)).size, 2);
});

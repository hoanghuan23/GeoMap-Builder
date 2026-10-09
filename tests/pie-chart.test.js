import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDataSets } from "../src/charts/data-transformers.js";
import {
  createPieOptions,
  mergePieConfig,
  normalizePieChartConfig,
  preparePieData
} from "../src/charts/pie-chart.js";

const records = [
  { country: "Finland", gdp: 1.8, support: 1.6, freedom: .6 },
  { country: "Denmark", gdp: 1.7, support: 1.5, freedom: .7 }
];

test("tạo hai biến thể pie và half pie từ dataset", () => {
  const options = createPieOptions(analyzeDataSets(records)[0], "Cơ cấu chỉ số");
  assert.deepEqual(options.map(option => option.id), ["pie_chart", "half_pie"]);
  assert.deepEqual(options.map(option => option.config.variant), ["pie", "halfPie"]);
  assert.ok(options.every(option => option.config.chartKind === "pie"));
});

test("chuẩn hóa cấu hình và tổng hợp mỗi chỉ số thành một lát cắt", () => {
  const config = normalizePieChartConfig({
    variant: "halfPie",
    xField: "country",
    series: [
      { key: "gdp", label: "GDP", color: "#ff8354" },
      { key: "support", label: "Hỗ trợ", color: "#4385f5" }
    ],
    data: records,
    sort: "desc"
  });
  assert.equal(config.variant, "halfPie");
  assert.deepEqual(preparePieData(config).map(slice => slice.value), [3.5, 3.1]);
});

test("một chỉ số tạo một lát cắt cho mỗi danh mục thay vì cộng tổng", () => {
  const config = normalizePieChartConfig({
    variant: "pie",
    xField: "country",
    series: [{ key: "gdp", label: "GDP", color: "#ff8354" }],
    data: records,
    sort: "none"
  });
  assert.deepEqual(preparePieData(config).map(slice => ({ name: slice.name, value: slice.value })), [
    { name: "Finland", value: 1.8 },
    { name: "Denmark", value: 1.7 }
  ]);
});

test("giới hạn an toàn các thông số style", () => {
  const config = mergePieConfig({ chartSize: 200, sliceGap: -2, limit: 0 });
  assert.equal(config.chartSize, 100);
  assert.equal(config.sliceGap, 0);
  assert.equal(config.limit, 6);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLineChartConfig } from "../src/charts/line-chart.js";

const records = [
  { month: "T1", desktop: 82, mobile: 120, tablet: 18 },
  { month: "T2", desktop: 85, mobile: 128, tablet: 19 },
  { month: "T3", desktop: 88, mobile: 137, tablet: 20 }
];

test("chuẩn hóa cấu hình và giữ nguyên thứ tự dữ liệu đường", () => {
  const config = normalizeLineChartConfig({
    xField: "month",
    series: [{ key: "mobile", label: "Điện thoại" }],
    data: records,
    title: "Lượt truy cập"
  });
  assert.equal(config.variant, "line");
  assert.deepEqual(config.data.map(row => row.month), ["T1", "T2", "T3"]);
  assert.deepEqual(config.data.map(row => row.mobile), [120, 128, 137]);
});

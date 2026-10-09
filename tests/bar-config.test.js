import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BAR_CONFIG, mergeBarConfig, prepareBarData } from "../src/charts/configs/bar-config.js";

test("nhãn dữ liệu được bật trong cấu hình mặc định và khi đặt lại", () => {
  assert.equal(DEFAULT_BAR_CONFIG.showDataLabels, true);
  assert.equal(mergeBarConfig({ showDataLabels: false }).showDataLabels, false);
  assert.equal(mergeBarConfig().showDataLabels, true);
});

test("chuẩn hóa giới hạn và kích thước biểu đồ cột", () => {
  const config = mergeBarConfig({ limit: 0, barWidth: 500, barGap: -1, orientation: "horizontal" });
  assert.equal(config.limit, 20);
  assert.equal(config.barWidth, 100);
  assert.equal(config.barGap, 0);
  assert.equal(config.orientation, "horizontal");
  assert.equal(config.sort, "none");
});

test("sắp xếp và giới hạn dữ liệu theo chỉ số đang hiển thị", () => {
  const data = [{ score: 1 }, { score: 3 }, { score: 2 }];
  const result = prepareBarData(data, { sort: "desc", limit: 2 }, [{ key: "score" }]);
  assert.deepEqual(result.map(row => row.score), [3, 2]);
  assert.deepEqual(data.map(row => row.score), [1, 3, 2]);
});

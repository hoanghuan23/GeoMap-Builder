import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BAR_CONFIG, getBarAutoWindowSize, mergeBarConfig, prepareBarData } from "../src/charts/configs/bar-config.js";

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

test("tự fit mở toàn bộ Top 10 vừa khung và 11 nhóm đầu của Top 20 cột ghép", () => {
  const dimensions = { width: 800, height: 450 };
  assert.equal(getBarAutoWindowSize(10, 3, {}, dimensions), 10);
  assert.equal(getBarAutoWindowSize(20, 3, {}, dimensions), 11);
});

test("tự fit thích ứng với kích thước khung, số chuỗi, độ rộng và khoảng cách cột", () => {
  const dimensions = { width: 800, height: 450 };
  const baseline = getBarAutoWindowSize(50, 3, {}, dimensions);
  assert.ok(getBarAutoWindowSize(50, 3, {}, { ...dimensions, width: 1200 }) > baseline);
  assert.ok(getBarAutoWindowSize(50, 4, {}, dimensions) < baseline);
  assert.ok(getBarAutoWindowSize(50, 3, { barWidth: 40 }, dimensions) < baseline);
  assert.ok(getBarAutoWindowSize(50, 3, { barGap: 40 }, dimensions) < baseline);
});

test("cột dọc tự fit theo chiều rộng, thanh ngang tự fit theo chiều cao", () => {
  const vertical = { orientation: "vertical" };
  const horizontal = { orientation: "horizontal" };
  assert.equal(getBarAutoWindowSize(50, 3, vertical, { width: 800, height: 400 }), 11);
  assert.equal(getBarAutoWindowSize(50, 3, vertical, { width: 800, height: 900 }), 11);
  assert.equal(getBarAutoWindowSize(50, 1, horizontal, { width: 400, height: 340 }), 10);
  assert.equal(getBarAutoWindowSize(50, 1, horizontal, { width: 900, height: 340 }), 10);
  assert.equal(getBarAutoWindowSize(50, 1, horizontal, { width: 900, height: 680 }), 20);
});

test("tự fit luôn giới hạn số nhóm theo dữ liệu và tối thiểu sáu nhóm khi đủ dữ liệu", () => {
  for (const seriesCount of [1, 3, 8]) {
    for (const orientation of ["vertical", "horizontal"]) {
      assert.equal(getBarAutoWindowSize(50, seriesCount, { orientation }, { width: 1, height: 1 }), 6);
      assert.equal(getBarAutoWindowSize(50, seriesCount, { orientation }, { width: 100000, height: 100000 }), 50);
      for (const length of [0, 1, 5]) {
        assert.equal(getBarAutoWindowSize(length, seriesCount, { orientation }, { width: 1, height: 1 }), length);
      }
    }
  }
});

test("chưa đo được kích thước thì tự fit tối đa 12 nhóm", () => {
  for (const size of [undefined, 0, -1, NaN, Infinity]) {
    for (const orientation of ["vertical", "horizontal"]) {
      assert.equal(getBarAutoWindowSize(50, 3, { orientation }, { width: size, height: size }), 12);
      assert.equal(getBarAutoWindowSize(5, 3, { orientation }, { width: size, height: size }), 5);
    }
  }
  assert.equal(getBarAutoWindowSize(20, 3), 12);
});

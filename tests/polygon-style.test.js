import test from "node:test";
import assert from "node:assert/strict";
import { polygonColorField, polygonFillExpression } from "../src/renderers/polygon-style.js";

const numericData = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { province: "A", value: 10 }, geometry: null },
    { type: "Feature", properties: { province: "B", value: 30 }, geometry: null }
  ]
};

test("tạo dải màu polygon theo trường số", () => {
  const profile = { numericFields: ["value"], textFields: ["province"] };
  assert.deepEqual(polygonColorField(numericData, profile), { field: "value", type: "number", values: [10, 30] });
  const expression = polygonFillExpression(numericData, profile, "blue", "#6c5ce7");
  assert.equal(expression[0], "interpolate");
  assert.deepEqual(expression[2], ["to-number", ["get", "value"], 10]);
});

test("dùng trường danh mục khi polygon không có trường số", () => {
  const profile = { numericFields: [], textFields: ["province"] };
  const expression = polygonFillExpression(numericData, profile, "viridis", "#6c5ce7");
  assert.equal(expression[0], "match");
  assert.deepEqual(expression[1], ["get", "province"]);
});

test("giữ màu cố định khi chưa chọn dải màu", () => {
  assert.equal(polygonFillExpression(numericData, {}, null, "#6c5ce7"), "#6c5ce7");
});

test("không lỗi khi hồ sơ dữ liệu đang là null", () => {
  assert.equal(polygonColorField(null, null), null);
  assert.equal(polygonFillExpression(null, null, "blue", "#6c5ce7"), "#6c5ce7");
});

import test from "node:test";
import assert from "node:assert/strict";
import { polygonColorField, polygonFillExpression, polygonLegendScale } from "../src/renderers/polygon-style.js";
import { MAP_NO_DATA_COLOR } from "../src/map-value.js";

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
  assert.equal(expression[0], "case");
  assert.deepEqual(expression[2][2], ["to-number", ["get", "value"], 10]);
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

test("thang chú giải dùng cùng miền giá trị và dải màu với polygon", () => {
  const profile = { numericFields: ["value"], textFields: ["province"] };
  assert.deepEqual(polygonLegendScale(numericData, profile, "diverging"), {
    field: "value",
    colors: ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"],
    values: [10, 15, 20, 25, 30],
    gradient: "linear-gradient(90deg, #313695, #74add1, #ffffbf, #f46d43, #a50026)"
  });
  assert.equal(polygonLegendScale(numericData, profile, null), null);
});

test("Polygon and H3 keep the selected numeric field when it is constant or entirely missing", () => {
  for (const field of ["arbitrary_metric", "Lượng mưa", "value.with.dots"]) {
    const data = values => ({ type: "FeatureCollection", features: values.map(value => ({
      type: "Feature", properties: { [field]: value, other: 123, category: "A" }
    })) });
    const profile = { numericFields: [field, "other"], textFields: ["category"] };
    for (const palette of [null, "blue", "viridis"]) {
      const constant = data([null, 0, 0]);
      assert.deepEqual(polygonColorField(constant, profile), { field, type: "number", values: [0, 0] });
      const paint = polygonFillExpression(constant, profile, palette, "#123456");
      assert.deepEqual(paint[1], ["==", ["typeof", ["get", field]], "number"]);
      assert.notEqual(paint[2], MAP_NO_DATA_COLOR);
      assert.equal(paint[3], MAP_NO_DATA_COLOR);
      if (palette) {
        const legend = polygonLegendScale(constant, profile, palette);
        assert.deepEqual(legend.values, [0]);
        assert.deepEqual(legend.colors, [paint[2]]);
        assert.equal(legend.gradient, paint[2]);
      }
      const empty = data([null, undefined, "", " ", false]);
      assert.equal(polygonFillExpression(empty, profile, palette, "#123456"), MAP_NO_DATA_COLOR);
      assert.equal(polygonLegendScale(empty, profile, palette), null);
      assert.equal(polygonColorField(empty, profile).field, field);
    }
  }
});

test("categorical polygon paint leaves missing categories transparent even with one valid category", () => {
  const data = { type: "FeatureCollection", features: ["Open", null, "", " "].map(status => ({ properties: { status } })) };
  for (const palette of [null, "blue"]) {
    const paint = polygonFillExpression(data, { textFields: ["status"] }, palette, "#123456");
    assert.equal(paint[0], "match");
    assert.equal(paint.at(-1), MAP_NO_DATA_COLOR);
    assert.deepEqual(paint.slice(2, 4), ["Open", palette ? "#eff6ff" : "#123456"]);
  }
});

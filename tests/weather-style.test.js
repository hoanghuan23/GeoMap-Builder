import test from "node:test";
import assert from "node:assert/strict";
import { TEMPERATURE_STOPS, temperatureFillExpression, temperatureLegendGradient } from "../src/renderers/weather-style.js";

test("temperature palette interpolates polygon colors and keeps a fallback", () => {
  const expression = temperatureFillExpression("diverging", "#6c5ce7");
  assert.equal(expression[0], "case");
  assert.deepEqual(expression[1], ["has", "temperature"]);
  assert.deepEqual(
    expression[2].slice(0, 3),
    ["interpolate", ["linear"], ["to-number", ["get", "temperature"]]]
  );
  assert.deepEqual(expression[2].slice(3), TEMPERATURE_STOPS.diverging.flat());
  assert.equal(expression[3], "#6c5ce7");
  assert.equal(temperatureFillExpression(null, "#123456"), "#123456");
});

test("temperature legend uses the same colors and proportional stops as the map", () => {
  assert.equal(
    temperatureLegendGradient("diverging"),
    "linear-gradient(90deg, #313695 0%, #74add1 35.71%, #ffffbf 53.57%, #f46d43 71.43%, #a50026 100%)"
  );
  assert.equal(temperatureLegendGradient(null), "");
});

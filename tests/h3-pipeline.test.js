import test from "node:test";
import assert from "node:assert/strict";
import { recordsToAggregatedH3 } from "../src/h3-utils.js";

test("H3 bỏ tọa độ lỗi và aggregate nhiều điểm cùng cell", () => {
  const result = recordsToAggregatedH3([
    { lat: 21.0285, lng: 105.8542, value: 2 },
    { lat: 21.02851, lng: 105.85421, value: 4 },
    { lat: 999, lng: 105, value: 100 },
    { lat: "", lng: null, value: null }
  ], { latField: "lat", lngField: "lng", valueField: "value", aggregation: "sum", resolution: 7 });
  assert.equal(result.stats.coordinateRows, 2);
  assert.equal(result.stats.cellCount, 1);
  assert.equal(result.data.features[0].properties.value, 6);
});

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

test("H3 giữ thuộc tính schema và đánh dấu giá trị phân loại không đồng nhất", () => {
  const columns = [
    { name: "lat", role: "geo" },
    { name: "lng", role: "geo" },
    { name: "value", role: "measure", aggDefault: "sum" },
    { name: "orders", role: "measure", aggDefault: "sum" },
    { name: "channel", role: "category" },
    { name: "ignored", role: "ignore" }
  ];
  const uniform = recordsToAggregatedH3([
    { lat: 21.0285, lng: 105.8542, value: 2, orders: 3, channel: "Website", ignored: "a" },
    { lat: 21.02851, lng: 105.85421, value: 4, orders: 5, channel: "Website", ignored: "b" }
  ], { latField: "lat", lngField: "lng", valueField: "value", aggregation: "sum", resolution: 7, columns });
  const properties = uniform.data.features[0].properties;
  assert.equal(properties.value, 6);
  assert.equal(properties.orders, 8);
  assert.equal(properties.channel, "Website");
  assert.equal(properties.ignored, undefined);

  const mixed = recordsToAggregatedH3([
    { lat: 21.0285, lng: 105.8542, value: 2, orders: 3, channel: "Website" },
    { lat: 21.02851, lng: 105.85421, value: 4, orders: 5, channel: "Cửa hàng" }
  ], { latField: "lat", lngField: "lng", valueField: "value", aggregation: "sum", resolution: 7, columns });
  assert.equal(mixed.data.features[0].properties.channel, "Nhiều giá trị (2)");
});

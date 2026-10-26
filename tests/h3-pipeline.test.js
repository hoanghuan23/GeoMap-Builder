import test from "node:test";
import assert from "node:assert/strict";
import { recordsToAggregatedH3, recordsToPointGeoJSON } from "../src/h3-utils.js";
import { buildDataSearchIndex, searchDataIndex } from "../src/map-search.js";
import { prepareSuggestions } from "../src/ai-chart-pipeline.js";

test("Point GeoJSON dùng binding tọa độ và giữ đủ thuộc tính cho popup", () => {
  const data = recordsToPointGeoJSON([{
    "Mã cửa hàng": "CH0001",
    "Tên cửa hàng": "Siêu thị mini Lý Thường Kiệt 121",
    "Vĩ độ": 21.087831,
    "Kinh độ": 105.832091,
    "Doanh thu": 368.4
  }], { latField: "Vĩ độ", lngField: "Kinh độ" });

  assert.deepEqual(data.features[0].geometry.coordinates, [105.832091, 21.087831]);
  assert.equal(data.features[0].properties["Tên cửa hàng"], "Siêu thị mini Lý Thường Kiệt 121");
  assert.equal(data.features[0].properties["Vĩ độ"], 21.087831);
  assert.equal(data.features[0].properties["Kinh độ"], 105.832091);
});

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

test("H3 retains missing-value cells and other measures while aggregating only valid selected values", () => {
  const columns = [{ name: "name", role: "text" }, { name: "lat", role: "geo" }, { name: "lng", role: "geo" },
    { name: "metric", role: "measure", aggDefault: "mean" }, { name: "other", role: "measure", aggDefault: "sum" }];
  const records = [
    { name: "Điểm A", lat: 21, lng: 105, metric: null, other: 7 },
    { name: "Điểm A", lat: 21, lng: 105, metric: " ", other: 5 },
    { name: "Điểm B", lat: 20, lng: 106, metric: 0, other: 8 },
    { name: "Điểm C", lat: 19, lng: 107, metric: 14, other: 9 }
  ];
  for (const aggregation of ["sum", "mean", "min", "max"]) {
    const result = recordsToAggregatedH3(records, { latField: "lat", lngField: "lng", valueField: "metric", aggregation, resolution: 7, columns });
    assert.equal(result.stats.cellCount, 3);
    assert.deepEqual(result.data.features.map(feature => feature.properties.metric), [null, 0, 14]);
    const index = buildDataSearchIndex({ data: result.data, columns, search_bar: true, search_fields: ["name"] });
    const missing = searchDataIndex(index, "Điểm A")[0].feature;
    assert.equal(missing.properties.__metric, null);
    assert.equal(missing.properties.other, 12);
    assert.equal(missing.properties.__record_count, 2);
    assert.equal(index.uniqueCount, 3);
  }
  const empty = records.map(record => ({ ...record, metric: null }));
  const [suggestion] = prepareSuggestions({ columns, suggestions: [{ id: "h3", chartType: "hex_h3", confidence: .9,
    bindings: { lat: "lat", lng: "lng", value: "metric" } }] }, empty, { lat: 1, lng: 1, metric: 0 });
  assert.equal(suggestion.available, true, "missing measures do not invalidate known locations");
});

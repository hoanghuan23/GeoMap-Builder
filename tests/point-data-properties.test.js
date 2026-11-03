import test from "node:test";
import assert from "node:assert/strict";
import { recordsToPointGeoJSON } from "../src/shared/geography/h3-utils.js";

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


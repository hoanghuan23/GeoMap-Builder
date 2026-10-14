import test from "node:test";
import assert from "node:assert/strict";
import { congestionAtTime, congestionLevel, joinCongestionToRoads, normalizeCongestionRecords, normalizeRoadText } from "../src/congestion-data.js";

test("chuẩn hóa tên đường tiếng Việt và nhận diện bảng ùn tắc", () => {
  assert.equal(normalizeRoadText("  Đường Đỗ-Mười "), "duong do muoi");
  const records = normalizeCongestionRecords([{ "Tên đường": "Đường Ngọc Hồi", "Mã tuyến": "QL.1", "Thời điểm": "2026-10-13 08:00", "Tốc độ TB (km/h)": 10, "Tốc độ thông thoáng (km/h)": 60, "Mức độ": "" }]);
  assert.equal(records[0].level, "Tắc nghẽn nặng");
  assert.equal(records[0].ratio, 1 / 6);
  assert.equal(congestionLevel("ÙN TẮC"), "Ùn tắc");
});

test("nhận diện các tiêu đề mở rộng của bảng ùn tắc toàn tuyến", () => {
  const records = normalizeCongestionRecords([{
    "Tên đường": "Đường Ngọc Hồi",
    "Mã đường": "QL.1",
    "Thời điểm": "2026-10-13 17:30",
    "Tốc độ trung bình (km/h)": 12,
    "Tốc độ thông thoáng (km/h)": 60,
    "Tỷ lệ tốc độ": 0.2,
    "Mức độ ùn tắc": "Ùn tắc",
    "Lưu lượng xe": 850
  }]);

  assert.deepEqual(records, [{
    roadName: "Đường Ngọc Hồi",
    routeRef: "QL.1",
    timestamp: "2026-10-13 17:30",
    speed: 12,
    freeFlowSpeed: 60,
    ratio: 0.2,
    level: "Ùn tắc",
    volume: 850
  }]);
});

test("ghép theo tên trước và chỉ dùng mã tuyến khi tên không khớp", () => {
  const road = (name, ref, id) => ({ type: "Feature", properties: { name, ref, id }, geometry: { type: "LineString", coordinates: [[105, 21], [106, 21]] } });
  const roads = { type: "FeatureCollection", features: [road("Đường Ngọc Hồi", "QL.1", 1), road("Quốc lộ 1", "QL.1", 2), road("Tên mới", "ĐT.428", 3)] };
  const records = [
    { roadName: "duong ngoc hoi", routeRef: "QL.1", timestamp: "08:00", level: "Đông" },
    { roadName: "Tên cũ", routeRef: "ĐT 428", timestamp: "08:00", level: "Ùn tắc" },
    { roadName: "Không có", routeRef: "", timestamp: "08:00", level: "Đông" }
  ];
  const data = congestionAtTime(joinCongestionToRoads(records, roads), "08:00");
  assert.deepEqual(data.features.map(feature => feature.properties.id), [1, 3]);
  assert.equal(data.stats.matchedRows, 2);
  assert.deepEqual(data.stats.unmatched, ["Không có"]);
});

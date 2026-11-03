import * as XLSX from "xlsx";

export const TRAFFIC_TIMES = ["08:00", "17:30", "22:00"];
export const TRAFFIC_SPEED = "Tốc độ trung bình (km/h)";
export const trafficRecords = Array.from({ length: 84 }, (_, index) => {
  const name = index === 0 ? "Đường Lĩnh Nam" : index === 1 ? "Đường Ngọc Hồi" : `Tuyến ${index + 1}`;
  return TRAFFIC_TIMES.map((time, slot) => {
    const speed = index === 0 ? [24, 20, 38][slot] : 15 + index % 20 + slot * 3;
    return {
      "Khu vực": "Hà Nội",
      "Tên đường": name,
      "Mã đường": index === 1 ? "QL.1" : "",
      "Thời điểm": `2026-10-13 ${time}`,
      [TRAFFIC_SPEED]: speed,
      "Tốc độ thông thoáng (km/h)": 60,
      "Tỷ lệ tốc độ": speed / 60,
      "Mức độ ùn tắc": slot === 2 ? "Thông thoáng" : "Đông",
      "Lưu lượng xe": 400 + index + slot * 50
    };
  });
}).flat();

export const trafficAiAnalysis = {
  datasetTitle: "Quan sát giao thông theo tuyến",
  grain: "Một tuyến đường tại một thời điểm",
  columns: [
    { name: "Khu vực", role: "geo", geoLevel: "admin1", country: "VN" },
    { name: "Tên đường", role: "category" },
    { name: "Mã đường", role: "id" },
    { name: "Thời điểm", role: "time", timeParse: "iso", granularity: "day" },
    { name: "Mức độ ùn tắc", role: "category" },
    { name: TRAFFIC_SPEED, role: "measure", unit: "km/h", aggDefault: "mean" }
  ],
  suggestions: [
    { id: "traffic-map-line", chartType: "map_line", title: "Biểu đồ mạng lưới",
      bindings: { region: "Tên đường", value: "Mức độ ùn tắc" }, agg: null, confidence: .99,
      reason: "Thể hiện mức độ ùn tắc của từng tuyến tại vị trí thực tế trên bản đồ." },
  ]
};

export function createRoadTrafficWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(trafficRecords), "Ùn tắc");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

import * as XLSX from "xlsx";

export const WEATHER_PROVINCES = Object.freeze([
  "Hà Nội", "Hải Phòng", "Huế", "Đà Nẵng", "Cần Thơ", "TP. Hồ Chí Minh",
  "Lai Châu", "Điện Biên", "Sơn La", "Lạng Sơn", "Cao Bằng", "Tuyên Quang",
  "Lào Cai", "Thái Nguyên", "Phú Thọ", "Bắc Ninh", "Quảng Ninh", "Hưng Yên",
  "Ninh Bình", "Thanh Hóa", "Nghệ An", "Hà Tĩnh", "Quảng Trị", "Quảng Ngãi",
  "Gia Lai", "Đắk Lắk", "Khánh Hòa", "Lâm Đồng", "Đồng Nai", "Tây Ninh",
  "Vĩnh Long", "Đồng Tháp", "An Giang", "Cà Mau"
]);

export function createWeather34Workbook() {
  const rows = WEATHER_PROVINCES.flatMap((province, provinceIndex) =>
    Array.from({ length: 30 }, (_, dayIndex) => ({
      "Tỉnh/thành phố": province,
      "Ngày": 46_266 + dayIndex,
      "Nhiệt độ trung bình": 24 + provinceIndex % 7 + dayIndex % 3 / 10,
      "Nhiệt độ thấp nhất": 20 + provinceIndex % 6,
      "Nhiệt độ cao nhất": 29 + provinceIndex % 8,
      "Độ ẩm": 65 + (provinceIndex + dayIndex) % 25,
      "Lượng mưa": (provinceIndex * 3 + dayIndex) % 18,
      "Tình trạng thời tiết": dayIndex % 3 === 0 ? "Có mưa" : "Có nắng"
    }))
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Thoi_tiet_thang_9");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Dữ liệu kiểm thử đã ẩn danh"]]), "Huong_dan");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

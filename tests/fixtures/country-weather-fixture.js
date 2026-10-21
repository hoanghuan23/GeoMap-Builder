import * as XLSX from "xlsx";

export const WEATHER_COUNTRIES = [
  { name: "Việt Nam", text: "Vietnam", code: "vn", bbox: [102, 8, 109, 23] },
  { name: "Thái Lan", text: "Thailand", code: "th", bbox: [97, 5, 106, 21] },
  { name: "Lào", text: "Laos", code: "la", bbox: [100, 13, 107, 23] },
  { name: "Campuchia", text: "Cambodia", code: "kh", bbox: [102, 10, 108, 15] },
  { name: "Myanmar", text: "Myanmar (Burma)", code: "mm", bbox: [92, 9, 102, 29] }
];

export const countryWeatherRecords = WEATHER_COUNTRIES.flatMap((country, index) =>
  Array.from({ length: 7 }, (_, day) => ({
    "Quốc gia": country.name,
    "Ngày": `2026-09-${String(day + 1).padStart(2, "0")}`,
    "Nhiệt độ trung bình": 28 + index + day / 10,
    "Nhiệt độ thấp nhất": 25 + index,
    "Nhiệt độ cao nhất": 32 + index,
    "Độ ẩm": 70 + index + day,
    "Lượng mưa": day / 10,
    "Tình trạng thời tiết": day % 2 ? "Mưa nhẹ" : "Có nắng"
  })));

export function countryFeature(country, { point = false } = {}) {
  const [west, south, east, north] = country.bbox;
  return { type: "Feature", id: `country.${country.code}`, text: country.text, place_name: country.text,
    place_type: ["country"], bbox: country.bbox, center: [(west + east) / 2, (south + north) / 2],
    properties: { country_code: country.code },
    // Rectangles are synthetic test geometries, not real country boundaries.
    geometry: point ? { type: "Point", coordinates: [(west + east) / 2, (south + north) / 2] }
      : { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] }
  };
}

export function createCountryWeatherWorkbook(records = countryWeatherRecords) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(records), "Thoi_tiet_quoc_gia");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

import * as XLSX from "xlsx";
import { legendFixture } from "./polygon-legend-fixture.js";

export const weatherText = "Trong tháng 9 năm 2026, Hà Nội ghi nhận nhiệt độ trung bình khoảng 29°C và lượng mưa 120mm. Trong khi đó, Đà Nẵng có nhiệt độ cao hơn, đạt 31°C nhưng lượng mưa chỉ 85mm. TP.HCM ghi nhận lượng mưa cao nhất trong ba địa phương, đạt 150mm, với nhiệt độ trung bình 32°C.";
export const weatherFields = ["Tỉnh thành", "Nhiệt độ (°C)", "Lượng mưa (mm)", "Tháng"];
export const weatherRows = [["Hà Nội", 29, 120, "2026-09"], ["Đà Nẵng", 31, 85, "2026-09"], ["TP.HCM", 32, 150, "2026-09"]];
export const weatherRecords = weatherRows.map(row => Object.fromEntries(weatherFields.map((field, i) => [field, row[i]])));

export function textWeatherAnalysis() {
  const defaults = { labelVi: null, geoLevel: null, country: null, timeParse: null, granularity: null, unit: null,
    unitSource: "unknown", aggDefault: null, semanticType: null, legend: null };
  return {
    datasetTitle: "Thời tiết tháng 9 năm 2026", grain: "Một tỉnh thành trong một tháng", search_bar: true, search_fields: ["Tỉnh thành"],
    columns: [
      { ...defaults, name: weatherFields[0], role: "geo", geoLevel: "admin1", country: "VN" },
      { ...defaults, name: weatherFields[1], role: "measure", unit: "°C", unitSource: "explicit", aggDefault: "mean", semanticType: "air_temperature", legend: legendFixture() },
      { ...defaults, name: weatherFields[2], role: "measure", unit: "mm", unitSource: "explicit", aggDefault: "sum", semanticType: "rainfall", legend: legendFixture({
        aggregation: "sum", unit: "mm", mode: "auto", title: "Lượng mưa", domain: [0, 1], stops: [{ value: 0, color: "#dbeafe" }, { value: 1, color: "#1e40af" }]
      }) },
      { ...defaults, name: weatherFields[3], role: "time", timeParse: "iso", granularity: "month" }
    ],
    suggestions: [{ id: "text-weather", chartType: "choropleth", title: "Bản đồ Polygon thời tiết", confidence: .95,
      bindings: { region: weatherFields[0], value: weatherFields[1], lat: null, lng: null, x: null, y: null, series: null },
      agg: "mean", reason: "Số liệu theo tỉnh thành và tháng", legend: null,
      popupSuggestions: [{ name: "info", confidence: .95 }],
      metricButtons: [
        { field: weatherFields[1], label: "Nhiệt độ", icon: "🌡️", color: "#f97316" },
        { field: weatherFields[2], label: "Lượng mưa", icon: "🌧️", color: "#2563eb" }
      ]
    }]
  };
}

export function textWeatherOutput() {
  return { fields: [...weatherFields], rows: weatherRows.map(row => [...row]), analysis: textWeatherAnalysis() };
}

export const comparativeWeatherText = `Báo cáo tổng hợp tình hình thời tiết tại một số tỉnh, thành phố Việt Nam tháng 9 năm 2026.
Tại khu vực miền Bắc, Hà Nội ghi nhận nhiệt độ trung bình 29°C, độ ẩm trung bình 82% và lượng mưa trung bình 180mm. Hải Phòng có nhiệt độ trung bình thấp hơn Hà Nội 1°C, độ ẩm trung bình đạt 85%, trong khi lượng mưa trung bình cao hơn Hà Nội 15%. Quảng Ninh ghi nhận nhiệt độ trung bình 27,5°C, độ ẩm trung bình 87% và lượng mưa trung bình 230mm.
Ở khu vực trung du và miền núi phía Bắc, Lào Cai có nhiệt độ trung bình 25°C, thấp hơn Hà Nội 4°C. Độ ẩm trung bình tại đây đạt 88%, trong khi lượng mưa trung bình ghi nhận 260mm. Tuyên Quang có nhiệt độ trung bình cao hơn Lào Cai 2°C, độ ẩm trung bình thấp hơn Lào Cai 3 điểm phần trăm và lượng mưa trung bình thấp hơn Lào Cai 40mm.
Tại miền Trung, Đà Nẵng ghi nhận nhiệt độ trung bình 30°C, độ ẩm trung bình 78% và lượng mưa trung bình 120mm. Huế có nhiệt độ trung bình thấp hơn Đà Nẵng 2°C, độ ẩm trung bình cao hơn Đà Nẵng 8 điểm phần trăm, trong khi lượng mưa trung bình đạt 235mm. Quảng Ngãi ghi nhận nhiệt độ trung bình 29°C, độ ẩm trung bình 80% và lượng mưa trung bình bằng 75% so với Đà Nẵng. Gia Lai có nhiệt độ trung bình 26°C, độ ẩm trung bình 83% và lượng mưa trung bình 170mm.`;

export const comparativeWeatherFields = ["Tỉnh thành", "Nhiệt độ (°C)", "Độ ẩm (%)", "Lượng mưa (mm)", "Tháng"];
export const comparativeWeatherRows = [
  ["Hà Nội", 29, 82, 180, "2026-09"],
  ["Hải Phòng", 28, 85, 207, "2026-09"],
  ["Quảng Ninh", 27.5, 87, 230, "2026-09"],
  ["Lào Cai", 25, 88, 260, "2026-09"],
  ["Tuyên Quang", 27, 85, 220, "2026-09"],
  ["Đà Nẵng", 30, 78, 120, "2026-09"],
  ["Huế", 28, 86, 235, "2026-09"],
  ["Quảng Ngãi", 29, 80, 90, "2026-09"],
  ["Gia Lai", 26, 83, 170, "2026-09"]
];
export const comparativeWeatherRecords = comparativeWeatherRows.map(row => Object.fromEntries(comparativeWeatherFields.map((field, i) => [field, row[i]])));

export function comparativeWeatherOutput() {
  const analysis = textWeatherAnalysis();
  analysis.columns.splice(2, 0, { ...analysis.columns[1], name: "Độ ẩm (%)", unit: "%", semanticType: "relative_humidity",
    legend: legendFixture({ unit: "%", mode: "auto", title: "Độ ẩm", domain: [0, 1],
      stops: [{ value: 0, color: "#cffafe" }, { value: 1, color: "#0e7490" }] }) });
  analysis.suggestions[0].metricButtons.splice(1, 0, { field: "Độ ẩm (%)", label: "Độ ẩm", icon: "💧", color: "#0891b2" });
  return { fields: [...comparativeWeatherFields], rows: comparativeWeatherRows.map(row => [...row]), analysis };
}

// Build test documents in memory so no sample data files are needed on disk.
export function weatherDocumentFile(extension, text = weatherText) {
  let bytes = new TextEncoder().encode(text);
  if (extension === "docx") {
    const zip = XLSX.CFB.utils.cfb_new();
    const add = (path, content) => XLSX.CFB.utils.cfb_add(zip, path, Buffer.from(content, "utf8"));
    add("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    add("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    add("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`);
    bytes = XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" });
  }
  return { name: `test-document.${extension}`, size: bytes.length, lastModified: 1,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

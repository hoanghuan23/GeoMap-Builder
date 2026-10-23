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

import { countryFeature } from "./country-weather-fixture.js";
import { countryLookupName } from "../../src/country-boundary-sources.js";

const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
const codes = "VN TH LA KH MM MY SG ID PH JP KR IN LK NP BD PK AE QA OM TR FR DE ES PT IT GB IE NL BE CH AT PL CZ HU GR SE NO DK FI IS CA US MX BR AR CL PE CO AU NZ".split(" ");
export const descriptiveCountries = [...codes.map(code => ({ code: code.toLowerCase(), name: displayNames.of(code), text: displayNames.of(code) })),
  { code: "cn", name: "Trung Quốc", text: "China" }].map((country, index) => ({ ...country, bbox: [index * 2 - 100, 0, index * 2 - 99, 1] }));

export const descriptiveColumns = [
  { name: "STT", role: "id" }, { name: "Điểm đến", role: "geo", geoLevel: "country" },
  { name: "Mã bản đồ", role: "id" }, { name: "Điều kiện", role: "category" }, { name: "Ghi chú", role: "text" }
];
export const descriptiveRecords = [...descriptiveCountries.slice(0, -1).map((country, index) => ({
  STT: index + 1, "Điểm đến": country.name, "Mã bản đồ": country.code.toUpperCase(),
  "Điều kiện": index % 2 ? "Miễn thị thực" : "Thị thực điện tử", "Ghi chú": `Thông tin nguồn ${index + 1}`
})),
  { STT: 51, "Điểm đến": "Trung Quốc — đảo Hải Nam", "Mã bản đồ": "CN", "Điều kiện": "Đoàn du lịch", "Ghi chú": "Chỉ áp dụng tại đảo Hải Nam" },
  { STT: 52, "Điểm đến": "Trung Quốc — quá cảnh", "Mã bản đồ": "CN", "Điều kiện": "Có vé nối chuyến", "Ghi chú": "Giữ nguyên điều kiện quá cảnh" }
];
export const descriptiveSuggestion = { id: "countries", chartType: "choropleth", title: "Điểm đến", confidence: .95,
  geographicScopes: [
    { sourceValue: "Trung Quốc — đảo Hải Nam", render: "boundary", targetName: "Hainan", geoLevel: "admin1", country: "CHN",
      geometryPart: "largest", label: "Đảo Hải Nam", reason: "Chỉ đảo Hải Nam, không phải toàn lãnh thổ Trung Quốc." },
    { sourceValue: "Trung Quốc — quá cảnh", render: "marker", targetName: "Trung Quốc", geoLevel: "country", country: "CHN",
      geometryPart: "all", label: "Quá cảnh Trung Quốc", reason: "Ký hiệu điều kiện quá cảnh; xem điều kiện cụ thể trong dữ liệu." }
  ],
  bindings: { region: "Điểm đến", value: null }, agg: null, legend: null, metricButtons: [], popupSuggestions: [{ name: "info", confidence: .99 }] };

export function descriptiveCountryFetch(requests = []) {
  return async rawUrl => {
    const url = new URL(rawUrl); requests.push(url);
    const query = decodeURIComponent(url.pathname).replace(/^\/geocoding\//, "").replace(/\.json$/, "");
    if (query === "Hainan, Trung Quốc") return { ok: true, json: async () => ({ features: [{
      type: "Feature", id: "region.hainan", text: "Hainan", place_name: "Hainan, China", place_type: ["region"],
      properties: { country_code: "cn" }, bbox: [108.6, 18, 111.1, 20.2],
      geometry: { type: "MultiPolygon", coordinates: [
        [[[108.6, 18], [111.1, 18], [111.1, 20.2], [108.6, 18]]],
        [[[112, 15], [112.01, 15], [112.01, 15.01], [112, 15]]]
      ] }
    }] }) };
    const country = descriptiveCountries.find(item => query === `country.${item.code}` || query === countryLookupName(item.name));
    if (!country) throw new Error(`Unexpected fixture query: ${query}`);
    const feature = countryFeature(country, { point: !query.startsWith("country.") });
    return { ok: true, json: async () => ({ features: [feature] }) };
  };
}

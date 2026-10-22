// Synthetic AI responses for existing rendering fixtures, never used by the application.
import { inferTimeGranularity } from '../../src/time-values.js';
import { administrativeContextFields, preferredAdministrativeColumn } from '../../src/geographic-grain.js';
import { profileTabularData } from '../../src/tabular-data.js';
const TIME_HINT_MAP = /(ngày|date|time|tháng|month|năm|year)/i;
export function inferMeasureAggregation(column) {
  const text = `${column?.name || ""} ${column?.labelVi || ""} ${column?.unit || ""}`
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[_./-]/g, " ");
  // Rates and averages take precedence over additive words, e.g. revenue_rate.
  if (/%|°|\b(rate|ratio|average|avg|mean|temperature|humidity|speed|density|price|index)\b|ty le|trung binh|nhiet do|do am|toc do|mat do|don gia/.test(text)) return "mean";
  if (/\b(total|amount|revenue|sales|rainfall|rain|count|quantity|cost|profit)\b|tong|doanh thu|luong mua|so luong|chi phi|loi nhuan/.test(text)) return "sum";
  return null;
}

const LOCATION_HINT = /(tỉnh|thành phố|province|city|district|quận|huyện|địa điểm|location|region|khu vực|area|state)/i;
const ADMINISTRATIVE_LOCATION_HINT = /(tỉnh|thành phố|province|city|district|quận|huyện|khu vực|region|area|state)/i;
const TIME_HINT = /(^|[\s_.-])(ngày|ngay|date|datetime|timestamp|time|thời điểm|thoi diem|tháng|thang|month|năm|nam|year|quarter|quý|quy|week|tuần|tuan|period|kỳ|ky)([\s_.-]|$)/i;
const ROAD_NAME_HINT = /(^|[\s_.-])(tên đường|ten duong|tên tuyến|ten tuyen|tuyến đường|tuyen duong|road[\s_.-]*name|route[\s_.-]*name|street[\s_.-]*name)([\s_.-]|$)/i;
const ID_HINT = /(^|[\s_.-])(id|mã|ma|code|index|rank)([\s_.-]|$)/i;
const LAT_HINT = /(^|[\s_.-])(lat|latitude|vĩ[\s_.-]*độ|vi[\s_.-]*do)([\s_.-]|$)/i;
const LNG_HINT = /(^|[\s_.-])(lng|lon|long|longitude|kinh[\s_.-]*(độ|do))([\s_.-]|$)/i;

function inferredRole(column) {
  const name = String(column?.name || "");
  if (LAT_HINT.test(name)) return { role: "geo", geoLevel: "point_lat" };
  if (LNG_HINT.test(name)) return { role: "geo", geoLevel: "point_lng" };
  if (/quốc gia|quoc gia|country|nation/i.test(name) && column?.inferredType !== "number") {
    return { role: "geo", geoLevel: "country" };
  }
  if (ID_HINT.test(name)) return { role: "id" };
  if (TIME_HINT.test(name) || column?.inferredType === "date") {
    return { role: "time", timeParse: column?.dateHint || (column?.inferredType === "date" ? "iso" : "text"), granularity: column?.temporalGranularity || inferTimeGranularity(name) };
  }
  if (LOCATION_HINT.test(name) && column?.inferredType !== "number") return { role: "geo", geoLevel: /quận|huyện|district/i.test(name) ? "admin2" : "admin1", country: "VN" };
  if (column?.inferredType === "number") return { role: "measure", aggDefault: inferMeasureAggregation(column) };
  if (ROAD_NAME_HINT.test(name)) return { role: "category" };
  if (Number(column?.uniqueCount) > 0 && Number(column.uniqueCount) <= 80) return { role: "category" };
  return { role: "text" };
}

export function mockColumnInfo(column) {
  const inferred = inferredRole(column);
  return {
    name: String(column?.name || ""),
    role: inferred.role,
    labelVi: null,
    geoLevel: inferred.geoLevel || null,
    country: inferred.country || null,
    timeParse: inferred.timeParse || null,
    granularity: inferred.granularity || null,
    unit: null,
    unitSource: "unknown",
    aggDefault: inferred.aggDefault || null,
    semanticType: null,
    legend: null,
    source: "ai"
  };
}

export function mockAiAnalysis(profile, { datasetTitle = "Dữ liệu tải lên" } = {}) {
  const columns = (profile?.columns || []).map(mockColumnInfo);
  const byRole = role => columns.filter(column => column.role === role);
  const measures = byRole("measure");
  const geo = byRole("geo");
  const time = byRole("time")[0];
  const category = byRole("category").find(column => ROAD_NAME_HINT.test(column.name)) || byRole("category")[0];
  const lat = geo.find(column => column.geoLevel === "point_lat");
  const lng = geo.find(column => column.geoLevel === "point_lng");
  const region = preferredAdministrativeColumn(columns, profile);
  const regionProfile = profile?.columns?.find(column => column.name === region?.name);
  const groupingRegion = Number(regionProfile?.uniqueCount) > 1 ? region : null;
  const suggestions = [];
  const road = byRole("category").find(column => ROAD_NAME_HINT.test(column.name));
  const roadValue = byRole("category").find(column => /mức độ ùn tắc|muc do un tac|traffic status|congestion/i.test(column.name)) || measures[0];
  if (road && roadValue) suggestions.push({ id: "rule-map-line", chartType: "map_line", title: "Bản đồ Line", bindings: { region: road.name, value: roadValue.name }, agg: roadValue.aggDefault, confidence: .8, reason: "Ghép tên tuyến với mạng đường có sẵn để thể hiện dữ liệu theo vị trí thực tế.", source: "ai" });
  if (region && measures[0]) suggestions.push({ id: "rule-choropleth", chartType: "choropleth", title: `${measures[0].name} theo ${region.name}`, bindings: { region: region.name, value: measures[0].name }, agg: measures[0].aggDefault, confidence: .72, reason: "Nhận diện theo quy tắc từ cột địa danh và chỉ số số.", source: "ai" });
  if (lat && lng) suggestions.push({ id: "rule-point", chartType: "point", title: "Vị trí các bản ghi", bindings: { lat: lat.name, lng: lng.name }, agg: null, confidence: .95, reason: "Mỗi dòng có một cặp kinh độ, vĩ độ nên được hiển thị trực tiếp bằng điểm.", source: "ai" });
  if (time && measures.length) suggestions.push({ id: "rule-line", chartType: "line", title: `Xu hướng theo ${time.name}`, bindings: { x: time.name, y: [measures[0].name], ...(groupingRegion || category ? { series: (groupingRegion || category).name } : {}) }, agg: null, confidence: .68, reason: "Nhận diện theo quy tắc từ cột thời gian và chỉ số số.", source: "ai" });
  const x = groupingRegion || category || region;
  if (x) suggestions.push({ id: "rule-bar", chartType: "bar", title: measures[0] ? `${measures[0].name} theo ${x.name}` : `Số bản ghi theo ${x.name}`, bindings: { x: x.name, y: measures[0]?.name || "count" }, agg: measures[0] ? measures[0].aggDefault : "count", confidence: .65, reason: "Nhận diện theo quy tắc từ cột phân loại.", source: "ai" });
  return { datasetTitle, grain: "Một dòng tương ứng một bản ghi dữ liệu", columns,
    suggestions: suggestions.map(suggestion => ({ ...suggestion, popupSuggestions: [], metricButtons: [] })), source: "ai" };
}

export function mockMapRecommendation(records) {
  const profile = profileTabularData(records, { includeSamples: false });
  const metadata = mockAiAnalysis(profile).columns;
  const region = preferredAdministrativeColumn(metadata, profile);
  const location = profile.columns.find(column => column.name === region?.name);
  const time = profile.columns.find(column => TIME_HINT_MAP.test(column.name) || column.inferredType === "date");
  const metrics = profile.columns.filter(column => column.inferredType === "number" && column.name !== time?.name);
  if (!location || !metrics.length) return null;
  return {
    canRenderMap: true,
    visualization: "polygon",
    geometry: { field: location.name, provider: "maptiler",
      placeType: region.geoLevel === "country" ? "country" : region.geoLevel === "admin2" ? "county" : "region",
      country: region.geoLevel === "country" || metadata.some(column => column.geoLevel === "country") ? null : "VNM",
      ...(administrativeContextFields(metadata, location.name).length ? { contextFields: administrativeContextFields(metadata, location.name) } : {}) },
    metricField: metrics[0].name,
    numericFields: metrics.map(column => column.name),
    filters: [
      { field: location.name, label: location.name, control: "select", allowAll: true },
      ...(time ? [{ field: time.name, label: time.name, control: "date-select", allowAll: false }] : [])
    ],
    title: `${metrics[0].name} theo ${location.name}`,
    explanation: "Nhận diện theo quy tắc dự phòng: dữ liệu có địa phương và các chỉ số số.",
    confidence: .7,
    source: "ai"
  };
}

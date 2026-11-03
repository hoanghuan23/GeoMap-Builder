import { administrativeContextFields, geographicLocationName } from "../../shared/geography/geographic-grain.js";
import { normalizeGeographicScopes } from './scopes.js';
import { popup } from './popup.js';

export const definition = Object.freeze({
  popup,
  defaultStyle: Object.freeze({color:"#6c5ce7",opacity:.72,borderColor:"#ffffff",borderWidth:.5}),
  nativeOrder: 2,
  profileKey: "hasArea",
  supportsMetrics: true,
  categoryMetrics: true,
  colorLegend: true,
  nullableValue: true,
  popupSubject: 'vùng',
  tabIcon: '▧',
  searchColumns(fields,title) {
    if(title)fields=[title,...fields.filter(column=>column.name!==title.name)];
    const levels=['country','admin1','admin2'],level=levels.indexOf(fields[0].geoLevel);
    return level<0?[]:fields.filter(column=>!levels.includes(column.geoLevel)||levels.indexOf(column.geoLevel)<=level);
  },
  normalizeScopes(raw, profile, suggestion, onError) {
    return normalizeGeographicScopes(raw, profile, suggestion.bindings.region, onError);
  },
  geometryProvider: "maptiler",
  timeFilter: true,
  stylePanel: "map-style-controls",

  nativeKind: "area",
  id: "choropleth", viewType: "polygon",
  label: "Bản đồ Polygon",
    slots: Object.freeze({ region: Object.freeze(["geo"]), value: Object.freeze(["measure", "category"]) }),
    icon: "polygon",
    renderer: "MapLibre",
  instructions: [
  {
    "order": 14,
    "text": "Polygon/choropleth dùng địa danh hành chính như tỉnh/thành phố, quận/huyện hoặc quốc gia; bindings.region là cột địa danh có role geo và geoLevel admin1/admin2/country. bindings.value là measure hoặc category phù hợp với mục đích bản đồ. Cột phân loại chính như cấp độ tiếp cận, loại thị thực, trạng thái, mức dịch vụ... có thể là trường chú giải dù bảng không có số đo: gán role category, bindings.value bằng đúng tên cột đó, agg null và thiết kế legend categorical. Ví dụ \"Cấp độ tiếp cận\" chứa \"Miễn thị thực\", \"Thị thực khi đến\", \"Giấy phép du lịch điện tử (eTA)\", \"Mở một phần / quá cảnh\" là các nhóm chú giải, không phải measure và không chỉ là bộ lọc. Suy luận theo ý nghĩa và giá trị thực tế, không viết chế độ riêng theo tên file/tên cột. Chỉ khi không có cả measure lẫn category phù hợp mới trả value null, agg null, legend null và metricButtons []; ứng dụng dùng màu mặc định. Một địa danh hợp lệ cũng đủ để dựng bản đồ. Không cần tọa độ hoặc polygon trong bảng; ứng dụng tự tra ranh giới hành chính."
  },
  {
    "order": 15,
    "text": "Trước khi chọn hình học, kiểm tra PHẠM VI THỰC SỰ của từng quan sát từ tên địa danh VÀ điều kiện/ghi chú/mã trên cùng dòng, so với các giá trị khác cùng cột. Một cột có thể trộn quốc gia, đảo, tỉnh, đặc khu và điều kiện như quá cảnh, cửa khẩu, hành lang hoặc dịch vụ chỉ mở một phần. Mã quốc gia/cấp độ tiếp cận giống nhau không có nghĩa là cùng phạm vi. Không bỏ hậu tố sau dấu gạch/ngoặc để tô cả quốc gia; không suy ra toàn lãnh thổ được áp dụng từ điều kiện hạn chế. Không tự sửa category hoặc sinh nhóm chú giải từ ghi chú."
  },
  {
    "order": 16,
    "text": "Với mỗi suggestion choropleth trả geographicScopes là các ngoại lệ theo sourceValue nguyên văn của bindings.region. Dòng bình thường không cần ngoại lệ; các kiểu bản đồ khác trả []. Dùng profile.columns[].distinctValues (khi có, danh sách đầy đủ tối đa 300 giá trị), profile.scopeRows (ngữ cảnh cùng dòng ngoài head) cùng mẫu/ghi chú để tìm các ngoại lệ, không chỉ đọc vài dòng đầu. Scope chỉ là kế hoạch tra/hình học, không sinh dòng dữ liệu, cột hay loại bản đồ thứ tư."
  },
  {
    "order": 17,
    "text": "Mỗi ngoại lệ gồm render, targetName, geoLevel, country, geometryPart, label, reason. render boundary khi phạm vi là một vùng địa lý xác định: tra targetName của vùng con ở geoLevel admin1/admin2, country là quốc gia cha (hoặc null khi có cột cha thay đổi theo dòng); không tra quốc gia cha thay thế nếu chưa tìm được vùng con. geometryPart all cho toàn địa giới, largest CHỈ khi dữ liệu nói rõ đảo/khối đất chính và loại trừ các phần đảo xa của địa giới. Ví dụ “Trung Quốc — đảo Hải Nam” chỉ áp dụng trong phạm vi đảo thì boundary, targetName Hainan, geoLevel admin1, country CHN, geometryPart largest; không tô Trung Quốc hay toàn địa giới tỉnh gồm đảo xa. Áp dụng cùng suy luận cho đảo/tỉnh/vùng con ở bất kỳ nước nào, không hard-code một quốc gia."
  },
  {
    "order": 18,
    "text": "render marker cho điều kiện phi diện tích như “Trung Quốc — quá cảnh”: targetName Trung Quốc, geoLevel country, country CHN, geometryPart all; ứng dụng đặt một vòng tròn nhỏ không có nhãn trên bản đồ làm lớp bổ sung và ghi label kèm “ - lớp riêng” trong chú giải, không tô polygon quốc gia và không giả định tất cả sân bay/cửa khẩu/tỉnh đều áp dụng. label ngắn phản ánh điều kiện và địa danh mốc, ví dụ “Quá cảnh Trung Quốc”; label chỉ dùng trong chú giải và không chứa hậu tố “lớp riêng” vì ứng dụng tự thêm đúng một lần; reason giải thích đây là ký hiệu minh họa, phạm vi cụ thể giữ trong dữ liệu/popup. Không bịa tọa độ hoặc ranh giới. Nếu nguồn đã cung cấp chính xác vùng áp dụng thì boundary theo vùng đó; nếu chưa đủ xác định địa danh làm mốc hay phạm vi thì render unresolved với targetName/geoLevel null, giữ thông tin và chờ xác minh. Địa danh quốc gia không có hậu tố nhưng ghi chú giới hạn rõ vẫn cần ngoại lệ. Giữ nguyên dữ liệu gốc và chi tiết từng dòng trong popup, tìm kiếm và lọc; không gộp marker với vùng con hoặc quốc gia chỉ vì cùng mã cha."
  },
  {
    "order": 19,
    "text": "Chỉ tạo tổ hợp màu categorical cho nhiều giá trị trên CÙNG hình học và phạm vi thực tế; các vùng con hoặc marker khác nhau trong geographicScopes không phải tổ hợp của toàn quốc gia dù profile.categoryGroups có cùng quốc gia cha."
  }
],
  bindingPlan(bindings, profile) {
    const native = profile?.spatial?.nativeGeometry === true && profile.spatial.geometryKinds?.includes('area');
    return { native, required: native ? [] : ['region'], optional: native ? ['region', 'value'] : ['value'] };
  },
  evaluate(suggestion, records, columns) {
    const geometry = { field: suggestion.bindings.region, contextFields: administrativeContextFields(columns, suggestion.bindings.region) };
    return { reason: records.some(record => geographicLocationName(record, geometry)) ? '' : 'Cần ít nhất một địa danh hợp lệ.' };
  }
});

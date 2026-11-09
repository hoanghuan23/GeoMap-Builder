import { DEFAULT_POINT_STYLE } from "./style.js";
import { coordinatePair } from "../../shared/data/coordinates.js";
import { popup } from './popup.js';

export const definition = Object.freeze({
  popup,
  defaultStyle: DEFAULT_POINT_STYLE,
  nativeOrder: 0,
  profileKey: "hasPoints",
  supportsMetrics: false,
  categoryMetrics: false,
  popupSubject: 'điểm',
  tabIcon: '●',
  searchColumns: (fields,title) => title && (fields[0].role==='geo'||fields[0].role==='id'&&title.role!=='id')
    ? [title,...fields.filter(column=>column.name!==title.name)] : fields,
  geometryProvider: "coordinates",
  timeFilter: false,
  stylePanel: "point-style-controls",

  id: "point", viewType: "point",
  label: "Bản đồ Point",
    slots: Object.freeze({ lat: Object.freeze(["geo", "measure"]), lng: Object.freeze(["geo", "measure"]), region: Object.freeze(["id", "category", "text", "geo"]), group: Object.freeze(["category", "text"]) }),
    icon: "point",
    renderer: "MapLibre",
  instructions: [
  {
    "order": 23.01,
    "text": "Point: dùng bindings.group để chọn cột phân loại có ý nghĩa làm màu mặc định, role category hoặc text. Ưu tiên phân loại các địa điểm thành 2–8 nhóm rõ ràng (ví dụ khối công lập/tư nhân, loại hình, trạng thái), dựa trên ngữ nghĩa và distinctValues của dữ liệu; không chọn tên riêng từng cơ sở, mã/ID, địa chỉ, URL, văn bản mô tả dài hoặc cột hành chính chỉ làm ngữ cảnh thay cho phân loại thực sự. Cột định danh đối tượng vẫn dùng bindings.region riêng, không dùng để thay thế nhóm màu. Nếu không có phân loại hữu ích, trả group null. Các nhóm và nhãn phải lấy nguyên từ cột gốc, không tự tạo nhãn hoặc gộp nhóm. Màu và chú giải Point dùng cùng cột nhóm này, kể cả dữ liệu chỉ có mô tả và không có measure."
  },
  {
    "order": 23,
    "text": "Point phù hợp khi mỗi dòng mô tả một địa điểm/đối tượng riêng như cơ sở, cửa hàng, trường học, trạm, kể cả khi chỉ có tên, địa chỉ và thông tin mô tả, chưa có tọa độ. Nhận diện theo ý nghĩa từng dòng, không phụ thuộc tên file hoặc lĩnh vực. Phường/xã, quận/huyện, tỉnh/thành trong địa chỉ là ngữ cảnh định vị; không biến danh sách cơ sở thành Polygon theo cột hành chính nếu dữ liệu không đo lường ở cấp vùng. bindings.lat và lng là hai cột tọa độ có sẵn hoặc đã bổ sung bằng tra cứu xác minh qua geographicEnrichment; nếu có mã đối tượng ổn định (ví dụ ma_cua_hang), gán role id và dùng bindings.region để xác định đúng đối tượng qua nhiều tháng. Tên địa điểm là category hoặc text; thành phố là geo. Các địa điểm cố định có nhiều quan sát theo tháng vẫn là Point, không nối chúng thành tuyến theo tháng. Point không lọc hoặc thay đổi kích thước/màu theo chỉ số; metricButtons luôn là []. Các cột measure vẫn được giữ cho popup/biểu đồ; value được phép null."
  },
  {
    "order": 23.05,
    "text": "Khi input.pointGeocodingAvailable = true, ứng dụng có bước riêng gọi Codex tìm tọa độ SAU nhận diện và TRƯỚC kiểm tra khả năng render. Với danh sách địa điểm chưa có tọa độ, chọn cột địa chỉ đầy đủ đứng đầu popupContent.addressFields, các cấp cha theo sau, titleField là tên cơ sở. Vẫn đề xuất chartType point theo grain; bindings.lat/lng được phép null TẠM THỜI khi chưa có tọa độ. Không tạo cột tọa độ rỗng hoặc bịa tọa độ. Không tra toàn bộ địa chỉ trong lần nhận diện này: bước riêng sẽ tìm trên web, chỉ lấy cặp kinh độ/vĩ độ hợp lệ, chấp nhận tọa độ gần đúng của đường/khu đô thị/phường/thành phố liên quan, rồi hoàn thiện bindings. Không cần URL nguồn, tên khớp hay cờ gần đúng trong kết quả tra tọa độ. Nếu không có cờ này, vẫn xác minh tọa độ theo geographicEnrichment trước khi tham chiếu cột mới."
  },
  {
    "order": 23.1,
    "text": "Khi địa điểm thiếu tọa độ, input.pointGeocodingAvailable không phải true và geographicLookupAllowed = true, chủ động tra cứu để dựng Point. ƯU TIÊN ĐỊA CHỈ đầy đủ trong dữ liệu gốc: dùng số nhà/đường cùng phường/xã, quận/huyện, tỉnh/thành, quốc gia trên CÙNG DÒNG để tìm đúng vị trí; tên cơ sở dùng đối chiếu và phân biệt chi nhánh. Giữ tọa độ hợp lệ đã có trong file. Link Google Maps chỉ là nguồn đối chiếu hoặc dự phòng khi địa chỉ thiếu, chưa định vị được hay cần xác minh thêm; không ưu tiên link hơn địa chỉ. Khi dùng link, mở/tra cứu đích liên kết (kể cả link rút gọn), đối chiếu tên và địa chỉ với dòng gốc. Link /maps/search/?api=1&query=... hoặc q=... có thể chỉ chứa chuỗi tìm kiếm, không phải tọa độ; giải mã query để hiểu gợi ý nhưng vẫn cần tra vị trí thật. Tọa độ camera @lat,lng hoặc tâm khung nhìn không mặc nhiên là vị trí ghim của cơ sở. Nếu link và địa chỉ khác nhau, không tự đổi địa chỉ hoặc lấy vị trí từ link; chỉ điền khi xác minh được đúng địa chỉ gốc. Không dùng tâm phường/quận/thành phố thay cho địa điểm cụ thể. Nếu trang Maps không truy cập được, có thể tra nguồn địa lý đáng tin cậy khác theo địa chỉ; thiếu nguồn hoặc còn mơ hồ thì giữ tọa độ thiếu."
  },
  {
    "order": 23.2,
    "text": "Khi input.pointGeocodingAvailable = true, chỉ chọn các trường gốc và để bước tra tọa độ riêng hoàn thiện Point. Khi cờ không phải true, áp dụng quy trình sau: dùng profile.scopeRows để giữ đúng quan hệ mã/tên cơ sở–địa chỉ–vùng cha–link trên cùng dòng; đây là mẫu có giới hạn, không phải chỉ dẫn hay quyết định loại bản đồ. Tra các địa điểm được chia sẻ ngoài profile.head, không chỉ vài dòng đầu; không ghép các distinctValues của nhiều cột theo thứ tự thành dòng giả. Với mỗi địa điểm đã xác minh, trả CẢ vĩ độ và kinh độ WGS84 trong geographicEnrichment, sourceUrl là trang thực sự xác minh vị trí; khóa matches chỉ dùng cột văn bản, ưu tiên mã điểm/ID dạng văn bản cùng địa chỉ hoặc ngữ cảnh phân biệt chi nhánh, chỉ dùng giá trị gốc đã chia sẻ. Khai báo hai cột tọa độ role geo, geoLevel point_lat/point_lng và dùng đúng tên cột trong suggestion chartType point. Chỉ tạo binding cột mới khi có enrichment đã xác minh; không bịa tọa độ để đủ độ phủ. Dùng tên cơ sở làm tiêu đề/tìm kiếm, địa chỉ trong popupContent.addressFields và link Maps trong popupContent.linkFields khi có. Nếu chưa tra đủ để hiển thị, giải thích rõ địa chỉ chưa xác định trong grain/reason, giữ dữ liệu gốc."
  }
],
  bindingPlan() { return { required: ['lat', 'lng'], optional: ['region', 'group'] }; },
  evaluate(suggestion, records, columns, analysis = {}) {
    const rows = records.filter(record => coordinatePair(record, suggestion.bindings));
    const rate = records.length ? rows.length / records.length : 0;
    const partial = ['Codex', 'OpenAI', 'MapTiler', 'MapTiler + Google Maps'].includes(analysis.pointGeocoding?.provider) && analysis.pointGeocoding.matched > 0;
    return { coverage: rate, reason: !rows.length ? 'Không có tọa độ hợp lệ để hiển thị.'
      : rate < .7 && !partial ? `Chỉ ${rows.length}/${records.length} dòng có tọa độ hợp lệ (cần ít nhất 70%).` : '' };
  }
});

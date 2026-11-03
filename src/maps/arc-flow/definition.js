import { createArcFlowModel, DEFAULT_ARC_FLOW_STYLE } from "./data.js";

export const definition = Object.freeze({
  defaultStyle: DEFAULT_ARC_FLOW_STYLE,
  independentCoverage: true,
  profileKey: null,
  supportsMetrics: false,
  categoryMetrics: false,
  popupSubject: 'luồng',
  tabIcon: '⌒',
  namedPopupFallback: true,
  geometryProvider: "coordinates",
  timeFilter: false,
  stylePanel: "arc-flow-style-controls",
  acceptsNativeProperties: true,

  id: "arc_flow", viewType: "arc_flow",
  label: "Bản đồ Arc Flow 3D", icon: "arc_flow", renderer: "deck.gl",
    slots: Object.freeze({
      source: Object.freeze(["id", "category", "text", "geo"]), target: Object.freeze(["id", "category", "text", "geo"]),
      sourceLat: Object.freeze(["geo", "measure"]), sourceLng: Object.freeze(["geo", "measure"]),
      targetLat: Object.freeze(["geo", "measure"]), targetLng: Object.freeze(["geo", "measure"]),
      value: Object.freeze(["measure"]), time: Object.freeze(["time"]), group: Object.freeze(["category", "id", "text", "time"])
    }),
  instructions: [
  {
    "order": 4,
    "text": "Arc Flow (arc_flow) chỉ phù hợp khi mỗi dòng là một quan hệ CÓ HƯỚNG điểm đi → điểm đến (OD), có cột định danh/tên của hai đầu, HAI cặp tọa độ độc lập sẵn có và số đo lưu lượng. Nhận diện theo ý nghĩa của toàn dòng, không phụ thuộc tên file, ngôn ngữ, thứ tự cột hoặc lĩnh vực. Một dòng OD có thể kèm thời gian và quốc gia/vùng của từng đầu; các cột ngữ cảnh này không biến lưu lượng giữa hai điểm thành số đo theo vùng."
  },
  {
    "order": 5,
    "text": "Với Arc Flow, xác định đủ các cột trước khi tạo suggestion: source và target là tên/mã hai đầu ở đúng cấp quan sát (role id/category/text/geo); sourceLat/sourceLng là vĩ độ/kinh độ đầu đi, targetLat/targetLng là vĩ độ/kinh độ đầu đến (ưu tiên role geo với geoLevel point_lat/point_lng tương ứng, hoặc role measure). Chọn tên/mã điểm cụ thể thay cho quốc gia/vùng cha nếu dòng đo quan hệ giữa các điểm đó. Bảy bindings source, target, sourceLat, sourceLng, targetLat, targetLng, value bắt buộc là bảy tên cột gốc khác nhau, mỗi binding là một string không rỗng, tuyệt đối không null. Không dùng một cặp lat/lng cho cả hai đầu; việc một đầu có cùng tọa độ trên nhiều dòng vẫn hợp lệ."
  },
  {
    "order": 6,
    "text": "bindings.value của Arc Flow là TÊN CỘT chứa đại lượng số đo độ lớn luồng trên từng dòng, không phải giá trị ô hay số tổng đã tính. Số hành khách, khối lượng hàng, lượng giao dịch, lượt di chuyển... là measure khi biểu thị lượng đi từ source đến target; không coi là category chỉ vì là số nguyên, ít giá trị phân biệt, lặp lại hoặc mỗi OD chỉ có một quan sát. Phân biệt đại lượng số với nhóm lưu lượng bằng ý nghĩa và kiểu/thống kê/mẫu thực tế: nhãn thấp/vừa/cao là category, số lượng/khối lượng là measure. Gán columns[].role = measure cho đúng cột được chọn và bindings.value bằng nguyên văn columns[].name đó. Không lấy tọa độ, mã/ID, thời gian, cột ngữ cảnh hoặc nhãn phân nhóm làm value. Nếu có nhiều đại lượng phù hợp, chọn đại lượng phản ánh trực tiếp mục đích luồng, giải thích trong reason; không để value null chỉ vì có nhiều lựa chọn."
  },
  {
    "order": 7,
    "text": "Tách quyết định chọn value khỏi quyết định đơn vị và phép gộp: chưa rõ unit hoặc aggDefault/agg chỉ cho phép các metadata đó null, không được xóa binding value đã xác định. Lượng đếm/khối lượng cộng dồn theo OD dùng columns[].aggDefault và suggestion.agg = sum, kể cả khi các dòng ở nhiều ngày; không dùng count để thay số lượng có sẵn bằng số bản ghi. Tỷ lệ, tốc độ hoặc chỉ số khác chọn phép gộp theo ý nghĩa; chưa đủ cơ sở thì agg null. Đơn vị giữ đúng dữ liệu, có thể suy luận từ tên cột/ngữ cảnh; không chuyển đổi giá trị. Khi tắt gửi mẫu, vẫn dùng tên cột, inferredType, min/max, nullRate và thống kê hiện có để phân tích; không coi thiếu samples/head là thiếu cột lưu lượng."
  },
  {
    "order": 8,
    "text": "Gán time bằng cột thời gian có thật, group bằng cột phân nhóm/khung giờ có thật và role phù hợp; không có thì null. Không đề xuất Arc Flow cho danh sách địa điểm, geometry tuyến hoặc chuỗi tọa độ, dữ liệu chỉ có giá trị theo vùng, dữ liệu thiếu tọa độ một đầu hoặc thực sự không có số đo lưu lượng. Không tìm/bịa tọa độ, tự join sheet hoặc tạo cột số giả. Nếu không xác định đủ bảy cột bắt buộc, bỏ đề xuất Arc Flow thay vì trả một arc_flow có binding null. Ứng dụng kiểm tra từng dòng tọa độ/lưu lượng, tổng hợp OD và tính ngưỡng phân vị bằng code. Arc Flow v1 dùng popupSuggestions chỉ gồm info; metricButtons [], legend null, geographicScopes []; không thiết kế ngưỡng hay màu riêng cho Arc Flow. Các quy tắc cho phép value null của Polygon/Line/Point KHÔNG áp dụng cho Arc Flow; với Arc Flow chỉ các binding không áp dụng (region, lat, lng, x, y, series) và time/group không có dữ liệu mới trả null."
  },
  {
    "order": 47,
    "text": "Kiểm tra nhất quán lần cuối trước khi trả JSON: mỗi arc_flow phải có đủ bảy binding bắt buộc là tên cột có thật, khác nhau và đúng role; đặc biệt bindings.value không null và trỏ tới cột role measure trong columns. Nếu đã nhận diện cột lưu lượng mà value bị null hoặc role sai, sửa đồng thời metadata và binding ngay trong kết quả này. Schema chung cho phép null để phục vụ các loại bản đồ khác, không có nghĩa các binding bắt buộc của Arc Flow được phép null. Không tự bổ sung cột thiếu để vượt kiểm tra."
  }
],
  bindingPlan() { return { required: ['source', 'target', 'sourceLat', 'sourceLng', 'targetLat', 'targetLng', 'value'], optional: ['time', 'group'], distinct: true, scalar: true }; },
  evaluate(suggestion, records, columns) {
    const model = createArcFlowModel(records, columns, suggestion);
    return { coverage: model.stats.validRate, reason: model.unavailableReason };
  }
});

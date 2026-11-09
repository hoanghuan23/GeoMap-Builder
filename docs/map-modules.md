# Kiến trúc module bản đồ

Ứng dụng dùng một canvas MapLibre ở cấp workspace. Mỗi dataset có một runtime riêng; mỗi kiểu hiển thị trong runtime có một instance module riêng. Workspace tiếp tục quản lý nền, nhóm lớp, thứ tự lớp, composition, liên kết thuộc tính, lọc khu vực và overlay deck.gl dùng chung.

`src/app.js` chỉ kết nối cấu hình nền, tài nguyên Vite và runtime rồi khởi tạo workspace. Không thêm điều kiện theo loại bản đồ tại đây.

## Cấu trúc

- `src/maps/{point,line,polygon,arc-flow}/definition.js`: định danh AI và định danh hiển thị, bindings, kiểm tra dữ liệu, cấu hình mặc định, khả năng hỗ trợ và hướng dẫn AI. Import được từ Node và trình duyệt; không tải DOM hoặc deck.gl.
- `src/maps/<loại>/index.js`: tạo instance và triển khai giao diện module. Controller, renderer, style, dữ liệu và markup điều chỉnh nằm cạnh nhau. Lưới vùng và geographic scopes thuộc Polygon; mạng đường thuộc Line.
- `src/maps/registry.js`: registry thuần dùng chung cho server/client, khai báo khả năng dữ liệu và kiểm tra AI. `browser-registry.js` đăng ký các factory chạy trên trình duyệt.
- `src/shared/runtime/`: vòng đời dataset, chuyển module và context. Context giữ dữ liệu chuẩn hóa chung; model style và dữ liệu hiển thị riêng được tạo trong từng module, không thêm trường riêng vào state mà workspace đọc.
- `src/shared/import/`: đọc/profile/phân tích file và quản lý các tài nguyên import.
- `src/shared/data/` và `src/shared/geography/`: thời gian, tổng hợp, màu/chú giải, geometry, tra ranh giới và cache. Các phép xử lý này không phụ thuộc model riêng của module.
- `src/shared/ui/`: catalog từ registry, khung giao diện và điều khiển dùng chung.
- `src/shared/popup/`: vòng đời popup, ảnh, biểu đồ và dữ liệu liên kết. Module cung cấp thông tin đối tượng qua `getPopupContext()`.
- `src/shared/view/`: cập nhật canvas, camera, tìm kiếm, bảng/export và bộ quản lý overlay ở cấp workspace.
- `src/shared/search/`: chỉ mục tìm kiếm và cấu hình tìm kiếm; dữ liệu đầu vào lấy từ snapshot của module đang hoạt động.

Các hàm thuần có sẵn tiếp tục được tái sử dụng, giữ nguyên thuật toán. Liên kết thuộc tính và composition vẫn thuộc workspace. Quy tắc nhận diện đối tượng và ghép bản ghi popup nằm trong `popup.js` của từng module.

## Giao diện chạy

`create(context)` tạo một instance với `activate`, `update`, `setVisible`, `reset`, `restore`, `getView`, `getPopupContext`, `dispose`. Các hook điều chỉnh, chỉ số và bộ lọc là khả năng của module; runtime không cần đọc private model của loại khác.

- `activate(suggestion, dataset)`: gắn dataset và dựng kiểu được chọn.
- `update(change)`: cập nhật theo điều khiển hiện tại; nhận thay đổi style, metric hoặc selection khi module hỗ trợ. Các bộ lọc chung được chuyển thành thay đổi của module đang hoạt động.
- `restore()`: tạo lại source/layer khi cần và giữ nguyên data/style. Không đăng ký sự kiện nhiều lần.
- `getView()`: trả `data`, `sourceData`, `tableRecords`, `search`, `extent`, `legendVisible`, `configuration`, `popupLayerId` và yêu cầu `camera` nếu có.
- `getPopupContext(feature)`: bổ sung bản ghi nguồn, thang chú giải hoặc hành vi mở popup của đối tượng.
- `dispose()`: hủy tác vụ, sự kiện và tài nguyên module. Workspace sau đó dọn namespace MapLibre và DOM của dataset.

Workspace sử dụng snapshot để lấy dữ liệu và chú giải. Arc Flow trả toàn bộ OD đã lọc cho bảng/CSV, còn Top N chỉ giới hạn cung hiển thị. Camera của nhóm lấy từ yêu cầu trong snapshot; không có nhánh Arc Flow riêng trong workspace.

Model cấu hình riêng được tạo lại cho từng instance. Dữ liệu thô, metadata và kết quả chuẩn hóa thuộc dataset của runtime; không truyền state của một runtime cho runtime khác.

`tableRecords` trong snapshot chỉ được tạo khi có nơi đọc (bảng/CSV) và được dùng lại trong cùng snapshot. Đọc metadata, dữ liệu bản đồ hoặc cấu hình tìm kiếm không duyệt lại properties của toàn bộ feature. Snapshot mới phản ánh dữ liệu và properties hiện tại, kể cả khi thay properties trên geometry đang dùng.

SheetJS nằm trong worker đọc bảng; nhánh dự phòng không có Worker tải parser bằng import động khi cần. Renderer popup cột/đường/tròn tải React/Recharts ở lần vẽ đầu tiên qua `src/charts/lazy-renderers.js`; đóng hoặc thay popup hủy lượt vẽ đang chờ. Các hàm định dạng ngày và màu đường dùng chung nằm trong `line-format.js` để pipeline dữ liệu không kéo renderer vào gói khởi động.

## Giao diện và AI

Markup cố định của bộ điều chỉnh thuộc `controls.js` của module. `createLayerDocument.mountHTML()` gắn markup vào slot chung và cấp ID riêng cho mỗi dataset, kể cả `for` và các thuộc tính ARIA. Các bộ lọc động tiếp tục do controller của module dựng.

Server ghép các đoạn hướng dẫn thuần của module với hướng dẫn chung theo thứ tự cũ. Không đổi cấu trúc request/response, số lần gọi AI hay ý nghĩa bindings. Các tính năng đã gỡ vẫn không được chấp nhận. Registry dùng chung không import factory trình duyệt; deck.gl vẫn tải qua renderer động khi Arc Flow được dùng.

## Thêm một loại mới

1. Tạo thư mục module, định nghĩa `id`, `viewType`, tên/icon, slots, `bindingPlan`, `evaluate`, khả năng UI và các hướng dẫn AI riêng. Các bindings mới phải được khai báo trong schema phản hồi dùng chung nếu chưa có.
2. Triển khai factory theo giao diện trên, sở hữu data/style/controls và vòng đời tài nguyên. Dùng các dịch vụ chung qua context; không import controller của module khác.
3. Đăng ký định nghĩa trong registry thuần và factory trong registry trình duyệt. Khai báo thêm slot/markup của bộ điều chỉnh nếu cần; không sửa `app.js` để điều phối loại mới.
4. Bổ sung dữ liệu mẫu và kiểm thử về điều kiện sử dụng, nhiều instance, đổi nền, hide/show, popup, export và dispose.

## Kiểm tra

- `npm test`: kiểm thử dữ liệu, contract, controller, runtime và các tình huống tích hợp hiện có. Các scenario import runtime trực tiếp; driver trong fixtures chỉ nối mock và biểu thức kiểm tra, không đọc/cắt mã ứng dụng để chạy bằng `vm`.
- `npm run test:maps:browser`: Chrome/Chromium headless với DOM thật, canvas/overlay giả lập. Kiểm tra năm instance thuộc bốn loại, ID riêng, điều chỉnh Point/Line, lưới Polygon, popup, overlay Arc Flow và dọn tài nguyên. Có thể đặt `CHROME_PATH` nếu Chrome không ở vị trí mặc định. Không gọi AI hoặc dùng mạng đường bên ngoài.
- `npm run test:maps:webgl`: cùng các tình huống trên với MapLibre và deck.gl thật, chạy WebGL2 bằng SwiftShader trong Chrome. Kiểm tra feature đã render, phục hồi sau đổi nền và detach/attach dataset. Nền và glyph kiểm thử được phục vụ cục bộ, không gọi dịch vụ bản đồ bên ngoài.
- `npm run build`: kiểm tra đóng gói Vite, worker và renderer deck.gl động.

Để xem ảnh render riêng của từng loại, chạy `npm run test:maps:webgl -- --screenshots`. Bộ chạy ghi bốn ảnh PNG vào thư mục tạm của hệ điều hành và in đường dẫn.

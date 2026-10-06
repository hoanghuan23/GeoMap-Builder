
> Tôi đã có một file mẫu `index_openweather.html` đang hoạt động.  
> **Hãy lấy file này làm nền tảng để dựng lại thành giao diện GeoMap Builder theo thiết kế tôi cung cấp.**
>
> Không viết lại logic bản đồ từ đầu và không thay đổi cách xử lý hiện tại nếu không cần thiết.
>
> ## 1. Logic hiện có cần giữ lại
>
> File mẫu hiện đã có:
>
> - MapLibre GL để hiển thị bản đồ.
> - Basemap OpenFreeMap dark.
> - Load ranh giới Việt Nam từ GeoJSON.
> - Dùng `h3-js`.
> - Chuyển polygon Việt Nam thành các H3 cell.
> - H3 hiển thị hiện tại sử dụng resolution 5.
> - Dùng `cellToParent()` để gom các H3 resolution 5 thành các vùng cha resolution 3.
> - Chỉ gọi OpenWeather theo các H3 parent resolution 3 thay vì gọi từng cell resolution 5.
> - Các cell con resolution 5 dùng chung nhiệt độ của cell cha resolution 3.
> - Gọi OpenWeather API theo tâm cell.
> - Có delay giữa các request để hạn chế lỗi rate limit.
> - Có cache nhiệt độ bằng `localStorage`.
> - Có TTL cho cache.
> - Có xử lý HTTP 429.
> - Có legend nhiệt độ.
> - Tô màu H3 theo nhiệt độ.
> - Có popup khi click H3 cell.
> - Có viền H3.
> - Có viền ranh giới Việt Nam.
>
> **Giữ nguyên logic hoạt động này và refactor nó thành cấu trúc code rõ ràng hơn.**
>
> Không tạo fake temperature thay cho OpenWeather vì file mẫu đã gọi API thật.
>
> ---
>
> ## 2. Mục tiêu
>
> Dựng lại file hiện tại thành một ứng dụng **GeoMap Builder** có giao diện giống mockup tôi cung cấp.
>
> Giao diện gồm:
>
> ```text
> ┌─────────────────────────────────────────────────────┐
> │ Header                                              │
> ├───────────────┬─────────────────────────────────────┤
> │               │                                     │
> │   Sidebar     │              Map                    │
> │               │                                     │
> │               │                                     │
> ├───────────────┼─────────────────────────────────────┤
> │               │          Data Table                 │
> └───────────────┴─────────────────────────────────────┘
> ```
>
> Ưu tiên dựng **frontend hoàn chỉnh trước**.
>
> ---
>
> # 3. Khu vực Header
>
> Tạo thanh header giống mockup gồm:
>
> - Logo `GeoMap Builder`
> - Tạo bản đồ
> - Dự án của tôi
> - Dữ liệu mẫu
> - Hướng dẫn
> - Help
> - Notification
> - Avatar người dùng
>
> Hiện tại các menu chưa cần backend, chỉ cần dựng UI.
>
> ---
>
> # 4. Sidebar bên trái
>
> Chia sidebar thành 4 khu vực.
>
> ## Phần 1 – Chọn kiểu bản đồ
>
> Hiển thị các lựa chọn:
>
> - H3 Hexagon
> - Point
> - Line
> - Polygon
> - Rectangle
> - Circle
> - Province
> - Country
>
> Hiện tại chức năng chính đang chạy là:
>
> ```text
> H3 Hexagon
> ```
>
> Khi chọn H3 Hexagon thì sử dụng logic H3 hiện có trong file mẫu.
>
> Các loại còn lại trước mắt chỉ cần dựng UI và state lựa chọn.
>
> Không cần implement đầy đủ ngay.
>
> ---
>
> # 5. Phần cung cấp dữ liệu không gian
>
> Có 3 tab:
>
> ```text
> Upload file
> Vẽ trên bản đồ
> Nhập tọa độ
> ```
>
> ### Upload file
>
> Cho phép chọn:
>
> - GeoJSON
> - JSON
> - CSV có lat/lng
> - ZIP/Shapefile có thể để placeholder trước
>
> File mẫu hiện đang đọc:
>
> ```javascript
> fetch("./gadm41_VNM_0.json")
> ```
>
> Hãy refactor để sau này có thể thay dữ liệu mặc định bằng file người dùng upload.
>
> Trước mắt nếu chưa upload file thì vẫn sử dụng:
>
> ```text
> gadm41_VNM_0.json
> ```
>
> làm dữ liệu mặc định.
>
> Hiển thị tên file đã chọn trong sidebar.
>
> ---
>
> # 6. Tham số H3
>
> Trong sidebar có:
>
> ```text
> Resolution (H3)
>
> 0 -------------------- 15
> ```
>
> Mặc định:
>
> ```text
> resolution = 5
> ```
>
> Thay vì hard-code:
>
> ```javascript
> const resolution = 5;
> ```
>
> hãy đưa giá trị này vào state.
>
> Khi người dùng thay đổi resolution:
>
> 1. Tính lại H3 cells.
> 2. Tạo lại GeoJSON H3.
> 3. Cập nhật layer MapLibre.
> 4. Cập nhật tổng số cell.
> 5. Không cần reload toàn bộ trang.
>
> Tuy nhiên cần tránh gọi OpenWeather lại không cần thiết.
>
> Logic weather parent hiện tại vẫn giữ:
>
> ```text
> WEATHER_RESOLUTION = 3
> ```
>
> Nếu H3 display resolution lớn hơn 3:
>
> ```text
> display H3 cell
>       ↓
> cellToParent(...)
>       ↓
> weather H3 res 3
>       ↓
> 1 OpenWeather request
> ```
>
> ---
>
> # 7. Kiểu hiển thị
>
> Tạo select:
>
> ```text
> Kiểu hiển thị:
> - Tô màu theo dữ liệu
> - Màu cố định
> ```
>
> Và:
>
> ```text
> Thuộc tính dữ liệu:
> - Nhiệt độ
> - Độ ẩm
> ```
>
> Hiện tại file mẫu đã có nhiệt độ.
>
> Nếu dữ liệu OpenWeather đã có humidity thì có thể lưu thêm:
>
> ```javascript
> weatherData.main.humidity
> ```
>
> để chuẩn bị cho việc đổi thuộc tính hiển thị.
>
> ---
>
> # 8. Style
>
> Tạo phần:
>
> ```text
> Tùy chỉnh style
> ```
>
> Bao gồm:
>
> - bảng màu
> - opacity
> - bật/tắt viền
> - màu viền
> - line width
>
> Liên kết trực tiếp các control này với MapLibre.
>
> Ví dụ opacity phải cập nhật:
>
> ```javascript
> map.setPaintProperty(
>     "h3-fill",
>     "fill-opacity",
>     value
> );
> ```
>
> Việc đổi style phải xảy ra ngay lập tức, không reload map.
>
> ---
>
> # 9. Map chính
>
> **Không dùng ảnh thay cho bản đồ.**
>
> Tiếp tục sử dụng MapLibre thật từ code hiện tại:
>
> ```javascript
> const map = new maplibregl.Map({
>     container: "map",
>     style: "https://tiles.openfreemap.org/styles/dark",
>     center: [108.2, 16.2],
>     zoom: 5
> });
> ```
>
> Giữ các chức năng hiện tại:
>
> - zoom
> - pan
> - H3 layer
> - temperature layer
> - Vietnam boundary
> - popup H3
>
> Bổ sung toolbar UI ở góc trên bên phải:
>
> - Select
> - Pan
> - Rectangle
> - Circle
> - Line
> - Polygon
> - Delete
>
> Và:
>
> - Zoom in
> - Zoom out
> - Fullscreen
>
> Các drawing tool chưa cần hoàn thiện toàn bộ ở bước đầu nhưng code phải thiết kế để có thể bổ sung sau.
>
> ---
>
> # 10. Legend
>
> Di chuyển legend hiện tại thành card bên phải bản đồ.
>
> Hiển thị:
>
> ```text
> Nhiệt độ (°C)
>
> ≤10   20   25   30   ≥40
>
> Nguồn: OpenWeather
> Cập nhật: ...
> ```
>
> Giữ nguyên color scale đang có trong file mẫu.
>
> ---
>
> # 11. Statistics
>
> Tạo card bên phải:
>
> ```text
> Tổng số cell (res 5)
> 1,842
>
> Nhiệt độ thấp nhất
> xx °C
>
> Nhiệt độ cao nhất
> xx °C
>
> Nhiệt độ trung bình
> xx °C
> ```
>
> Không fake các giá trị này.
>
> Hãy tính trực tiếp từ dữ liệu H3 hiện tại.
>
> Chỉ tính các cell có:
>
> ```javascript
> temperature !== null
> ```
>
> Khi dữ liệu OpenWeather tiếp tục được tải, statistics phải tự cập nhật.
>
> ---
>
> # 12. Data Table
>
> Phía dưới bản đồ tạo bảng:
>
> ```text
> Dữ liệu thuộc tính
> ```
>
> Các cột:
>
> ```text
> #
> H3 Index
> Tâm ô (Lat, Lng)
> Nhiệt độ (°C)
> Độ ẩm (%)
> Thời gian cập nhật
> ```
>
> Dữ liệu bảng phải lấy từ chính `h3GeoJSON.features`.
>
> Không tạo một bộ fake data riêng.
>
> Có:
>
> - Search
> - Pagination
> - Số bản ghi
> - Export data
>
> Ví dụ:
>
> ```text
> Dữ liệu thuộc tính (10 / 1842)
> ```
>
> Khi OpenWeather tải thêm dữ liệu thì table cập nhật theo.
>
> ---
>
> # 13. Refactor code
>
> File HTML hiện tại đang để tất cả logic trong một file.
>
> Hãy chia thành các module/component rõ ràng.
>
> Nếu sử dụng React, có thể tổ chức:
>
> ```text
> frontend/
> ├── src/
> │
> ├── components/
> │   ├── Header/
> │   ├── Sidebar/
> │   ├── MapView/
> │   ├── MapToolbar/
> │   ├── Legend/
> │   ├── Statistics/
> │   └── DataTable/
> │
> ├── services/
> │   └── weatherService.js
> │
> ├── map/
> │   ├── mapLibre.js
> │   ├── h3Layer.js
> │   └── boundaryLayer.js
> │
> ├── utils/
> │   ├── h3Utils.js
> │   ├── geoJsonUtils.js
> │   └── temperatureUtils.js
> │
> ├── hooks/
> │   └── useMapData.js
> │
> ├── pages/
> │   └── MapBuilder.jsx
> │
> └── App.jsx
> ```
>
> Không bắt buộc phải đúng hoàn toàn cấu trúc trên nhưng phải tách:
>
> ```text
> UI
> Map logic
> H3 logic
> Weather logic
> Cache logic
> ```
>
> ra khỏi nhau.
>
> ---
>
> # 14. OpenWeather
>
> **Không thay OpenWeather bằng fake data.**
>
> Giữ cách gọi API hiện tại.
>
> Tuy nhiên không để API key trực tiếp trong source code sau khi refactor.
>
> Chuyển sang biến môi trường, ví dụ:
>
> ```text
> VITE_OPENWEATHER_API_KEY
> ```
>
> Frontend đọc:
>
> ```javascript
> import.meta.env.VITE_OPENWEATHER_API_KEY
> ```
>
> Ở giai đoạn prototype vẫn có thể gọi API trực tiếp từ frontend.
>
> Sau này backend sẽ đứng giữa:
>
> ```text
> Frontend
>     ↓
> Backend
>     ↓
> OpenWeather
> ```
>
> nhưng **chưa cần implement backend OpenWeather trong bước này**.
>
> ---
>
> # 15. Cache
>
> Giữ logic cache hiện tại:
>
> ```text
> localStorage
> ```
>
> với:
>
> ```text
> CACHE_TTL_MS
> ```
>
> Không gọi lại OpenWeather đối với những weather parent cell vẫn còn cache hợp lệ.
>
> Giữ nguyên ý tưởng:
>
> ```text
> nhiều H3 res 5
>          ↓
> một H3 parent res 3
>          ↓
> một OpenWeather request
> ```
>
> Đây là logic quan trọng, không được bỏ.
>
> ---
>
> # 16. Backend
>
> Hiện tại **chưa cần xây backend đầy đủ**.
>
> Có thể tạo sẵn:
>
> ```text
> backend/
> ```
>
> để chuẩn bị cho giai đoạn sau.
>
> Nhưng ở bước hiện tại tập trung vào:
>
> ```text
> file HTML đang chạy
>         ↓
> refactor
>         ↓
> giao diện GeoMap Builder
> ```
>
> Không tạo fake backend nếu không cần thiết.
>
> ---
>
> # 17. Nguyên tắc quan trọng
>
> 1. File `index_openweather(4).html` là **source of truth cho logic hiện tại**.
> 2. Không viết lại thuật toán H3 nếu logic hiện tại đã hoạt động.
> 3. Không fake dữ liệu nhiệt độ.
> 4. Không thay bản đồ bằng ảnh.
> 5. MapLibre phải hoạt động thật.
> 6. OpenWeather phải tiếp tục hoạt động thật.
> 7. H3 phải tiếp tục được sinh thật từ boundary GeoJSON.
> 8. Cache phải tiếp tục hoạt động.
> 9. Việc thay đổi UI không được làm mất chức năng hiện tại.
> 10. Ưu tiên **refactor và mở rộng**, không rewrite toàn bộ.
>
> ---
>
> # 18. Thứ tự triển khai
>
> Làm theo từng bước:
>
> ```text
> Bước 1
> Đọc và phân tích index_openweather(4).html
>
> Bước 2
> Liệt kê các logic hiện tại và xác định phần nào cần giữ nguyên
>
> Bước 3
> Tạo project frontend mới
>
> Bước 4
> Chuyển MapLibre + H3 + OpenWeather logic sang project mới
>
> Bước 5
> Kiểm tra bản đồ hoạt động giống file cũ
>
> Bước 6
> Dựng layout GeoMap Builder
>
> Bước 7
> Kết nối sidebar với MapLibre/H3
>
> Bước 8
> Thêm statistics
>
> Bước 9
> Thêm data table
>
> Bước 10
> Thêm style controls
> ```
>
> Sau mỗi bước phải đảm bảo chức năng cũ vẫn chạy trước khi chuyển sang bước tiếp theo.

Điểm khác biệt lớn so với prompt trước là **không còn giả định “chưa có logic”** nữa. File của bạn thực tế đã có MapLibre và H3 thật index_openweather, có tô màu H3 dựa trên nhiệt độ index_openweather và có cả cơ chế cache `localStorage` theo TTL. index_openweather

Vì vậy hướng đúng bây giờ là **“lấy code đang chạy → refactor → dựng UI bao quanh nó”**, chứ không phải dựng một prototype fake rồi sau đó mới nối lại logic.
# GeoMap Builder

GeoMap Builder là ứng dụng frontend trực quan hóa dữ liệu không gian Việt Nam bằng lưới H3, MapLibre GL và dữ liệu thời tiết thật từ OpenWeather.

Ứng dụng hiện tập trung vào chế độ **H3 Hexagon**: chuyển polygon thành các H3 cell, lấy nhiệt độ/độ ẩm theo vùng H3 cha, hiển thị dữ liệu trên bản đồ và đồng bộ với bảng thuộc tính.

## Chức năng hiện có

- Bản đồ tương tác bằng MapLibre GL với basemap OpenFreeMap Dark.
- Hiển thị ranh giới Việt Nam từ `gadm41_VNM_0.json`.
- Chuyển `Polygon` và `MultiPolygon` sang lưới H3.
- Thay đổi H3 resolution mà không tải lại trang.
- Lấy nhiệt độ và độ ẩm thật từ OpenWeather.
- Gom các cell hiển thị về H3 resolution 3 trước khi gọi API để giảm số request.
- Cache dữ liệu thời tiết trong `localStorage` với TTL 15 phút.
- Delay giữa các request và thông báo khi OpenWeather trả về HTTP 429.
- Tô màu theo nhiệt độ, độ ẩm hoặc màu cố định.
- Thay đổi palette, opacity, màu viền, độ dày và trạng thái hiển thị viền theo thời gian thực.
- Popup thông tin khi chọn H3 cell.
- Legend và thống kê tự cập nhật khi dữ liệu thời tiết được tải.
- Bảng dữ liệu có tìm kiếm, phân trang và xuất CSV.
- Nhập dữ liệu bằng GeoJSON, JSON, CSV hoặc tọa độ trực tiếp.
- Giao diện responsive cho desktop và màn hình nhỏ.

Các lựa chọn Point, Line, Polygon, Rectangle, Circle, Province và Country hiện mới có UI/state. Các công cụ vẽ cũng đang ở trạng thái chuẩn bị để mở rộng.

## Công nghệ

- Vite 6
- JavaScript ES Modules
- MapLibre GL JS 4.7.1
- h3-js 4.1.0
- OpenFreeMap
- OpenWeather Current Weather API
- HTML5 và CSS thuần

## Yêu cầu môi trường

- Node.js 18 trở lên
- npm
- Trình duyệt hỗ trợ WebGL và ES Modules
- OpenWeather API key
- Kết nối Internet để tải basemap, MapLibre, h3-js và dữ liệu OpenWeather

## Cài đặt

```bash
npm install
```

Tạo file `.env` từ file mẫu:

```bash
cp .env.example .env
```

Cập nhật API key:

```env
VITE_OPENWEATHER_API_KEY=your_openweather_api_key
```

Không commit `.env`. File này đã được khai báo trong `.gitignore`.

> Đây là frontend prototype nên biến `VITE_*` sẽ được Vite đưa vào bundle phía trình duyệt. Khi triển khai production, nên gọi OpenWeather qua backend/proxy để không công khai API key.

## Chạy môi trường phát triển

```bash
npm run dev
```

Mở địa chỉ:

```text
http://localhost:5173/index_openweather.html
```

Không nên mở trực tiếp file HTML bằng `file://`, vì trình duyệt có thể chặn ES Modules, GeoJSON và các request mạng.

## Build production

```bash
npm run build
```

Kết quả được tạo trong thư mục `dist/`. Chạy thử bản build bằng:

```bash
npm run preview
```

## Cấu trúc dự án

```text
.
├── index_openweather.html       # Entry chính của GeoMap Builder
├── gadm41_VNM_0.json            # Ranh giới quốc gia mặc định
├── gadm41_VNM_1.json            # Dữ liệu hành chính cấp 1
├── gadm41_VNM_2.json            # Dữ liệu hành chính cấp 2
├── src/
│   ├── app.js                    # State, MapLibre, UI và điều phối dữ liệu
│   ├── cache.js                  # Đọc/ghi cache localStorage
│   ├── config.js                 # Cấu hình hệ thống và palette
│   ├── h3-utils.js               # Chuyển GeoJSON/CSV sang H3
│   ├── weather-service.js        # Gọi OpenWeather tuần tự
│   ├── styles.css                # Style giao diện chính
│   └── reference-tweaks.css      # Tinh chỉnh layout theo thiết kế mẫu
├── .env.example                  # Mẫu biến môi trường
├── package.json                  # Scripts và dependency
└── vite.config.js                # Cấu hình entry/build Vite
```

`index.html` và `index_temperature_openmeteo.html` là các prototype cũ, không phải entry chính của hệ thống hiện tại.

## Luồng xử lý dữ liệu

```text
GeoJSON Polygon/MultiPolygon
          ↓
polygonToCells(display resolution)
          ↓
H3 cell hiển thị
          ↓
cellToParent(..., 3)
          ↓
H3 weather cell resolution 3
          ↓
localStorage cache hoặc OpenWeather API
          ↓
nhiệt độ + độ ẩm dùng chung cho các cell con
          ↓
MapLibre + Statistics + Data Table
```

Khi display resolution nhỏ hơn 3, hệ thống dùng `cellToCenterChild()` để chọn một weather cell resolution 3 đại diện. Khi bằng 3, chính cell hiển thị được dùng làm weather cell.

## Cấu hình hệ thống

Các giá trị chính nằm trong `src/config.js`:

| Cấu hình | Mặc định | Ý nghĩa |
| --- | ---: | --- |
| `DEFAULT_RESOLUTION` | `5` | H3 resolution ban đầu |
| `WEATHER_RESOLUTION` | `3` | Resolution dùng để gom request thời tiết |
| `REQUEST_INTERVAL_MS` | `1100` | Khoảng nghỉ giữa hai request OpenWeather |
| `CACHE_TTL_MS` | `15 phút` | Thời gian cache còn hiệu lực |
| `CACHE_KEY` | `openweather-h3-weather-v2` | Khóa lưu trong `localStorage` |
| `MAX_RENDER_CELLS` | `120000` | Giới hạn cell để bảo vệ trình duyệt |

Thanh resolution vẫn hiển thị phạm vi 0–15. Nếu số cell ước tính vượt `MAX_RENDER_CELLS`, ứng dụng sẽ trở về mức an toàn thay vì tạo hàng trăm nghìn hoặc hàng triệu polygon làm treo trình duyệt.

## Dữ liệu đầu vào

### GeoJSON và JSON

Hỗ trợ:

- `FeatureCollection`
- `Feature`
- `Polygon`
- `MultiPolygon`

Nếu người dùng chưa upload file, hệ thống sử dụng `gadm41_VNM_0.json`.

### CSV

CSV phải có cột tọa độ với một trong các tên:

- Latitude: `lat`, `latitude` hoặc `vĩ độ`
- Longitude: `lng`, `lon`, `longitude` hoặc `kinh độ`

Các điểm được nối theo thứ tự dòng để tạo thành một polygon. CSV cần ít nhất ba tọa độ hợp lệ.

Ví dụ:

```csv
lat,lng
21.02,105.80
20.90,106.10
20.70,105.95
```

### Nhập tọa độ

Tab **Nhập tọa độ** chấp nhận:

- Một đối tượng GeoJSON hợp lệ; hoặc
- Mỗi dòng là một cặp `lng,lat`.

### ZIP/Shapefile

Giao diện chọn ZIP đã có nhưng chức năng đọc Shapefile chưa được triển khai.

## Cache OpenWeather

Mỗi weather cell lưu:

```js
{
  temperature: 28.4,
  humidity: 78,
  updatedAt: 1791266400000
}
```

Khi cache còn hạn, ứng dụng không gọi lại OpenWeather cho cell đó. Có thể xóa cache thủ công trong DevTools:

```js
localStorage.removeItem("openweather-h3-weather-v2");
```

## Scripts

| Lệnh | Chức năng |
| --- | --- |
| `npm run dev` | Chạy Vite development server |
| `npm run build` | Tạo production build trong `dist/` |
| `npm run preview` | Xem thử production build |

## Xử lý sự cố

### Bản đồ không hiển thị

- Kiểm tra kết nối tới `tiles.openfreemap.org`.
- Kiểm tra trình duyệt đã bật WebGL.
- Mở DevTools Console để xem lỗi MapLibre hoặc CORS.
- Chạy qua Vite thay vì mở file HTML trực tiếp.

### Không có nhiệt độ hoặc độ ẩm

- Kiểm tra `VITE_OPENWEATHER_API_KEY` trong `.env`.
- Khởi động lại Vite sau khi thay đổi `.env`.
- Kiểm tra quota và trạng thái API key trên OpenWeather.
- Nếu gặp HTTP 429, chờ hết giới hạn tốc độ rồi tải lại.

### Resolution cao không được áp dụng

Đây là cơ chế bảo vệ theo `MAX_RENDER_CELLS`. H3 tăng số cell rất nhanh, trung bình khoảng bảy lần sau mỗi cấp resolution.

## Giới hạn hiện tại

- Chỉ H3 Hexagon có đầy đủ logic xử lý.
- Công cụ vẽ Rectangle, Circle, Line, Polygon và Delete mới có giao diện.
- Chưa đọc trực tiếp ZIP/Shapefile.
- Chưa có backend bảo vệ OpenWeather API key.
- Weather request đang chạy tuần tự để hạn chế rate limit nên lần tải đầu có thể mất thời gian.
- Chưa có test tự động.

## Hướng phát triển

- Thêm MapLibre Draw hoặc Terra Draw cho bộ công cụ vẽ.
- Hỗ trợ Shapefile, KML và GeoPackage.
- Chuyển OpenWeather sang backend proxy.
- Lưu dự án và cấu hình style.
- Hỗ trợ thêm Point, Line, Polygon, Province và Country.
- Bổ sung worker cho H3 resolution cao.
- Thêm unit test và end-to-end test.

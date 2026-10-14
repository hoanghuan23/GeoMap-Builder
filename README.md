# GeoMap Builder

## Chạy dự án

```bash
npm install
npm run dev
```

Ô tìm kiếm khu vực dùng MapTiler Geocoding với key trong `.env`:

```env
MAPTILER_API_KEY=your_maptiler_api_key
```

Key được dùng từ trình duyệt cho Geocoding API; khi triển khai nên giới hạn key theo domain trong trang quản lý MapTiler.

Phân tích dữ liệu bảng bằng AI dùng OpenAI Responses API qua middleware phía server. Thêm key không có tiền tố `VITE_` để key không bị đưa vào bundle trình duyệt:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.6-luna
OPENAI_BASE_URL=https://api.openai.com/v1
```

Nếu dùng API tương thích OpenAI của Vilao, cấu hình model và base URL như sau:

```env
OPENAI_MODEL=vgpt/gpt-5.6-luna
OPENAI_BASE_URL=https://api.vilao.ai/v1
```

### AI Chart Pipeline v2 và quyền riêng tư

Excel/CSV được parse và profile trong Web Worker bằng package SheetJS đi cùng source. Workbook nhiều sheet yêu cầu chọn sheet trước khi phân tích. Raw records vẫn nằm trong trình duyệt; server không lưu dataset và không nhận toàn bộ file.

Mặc định request AI chỉ chứa tên cột, kiểu suy luận và thống kê như tỷ lệ null, số giá trị phân biệt, min/max. Tùy chọn **“Gửi giá trị mẫu cho AI”** mặc định tắt. Khi bật, request có tối đa 5 mẫu cho mỗi cột và 8 dòng đầu; chuỗi được loại control character và cắt ở 160 ký tự. Không có trường `samples` hoặc `head` khi tùy chọn này tắt.

Mỗi dataset chỉ tạo đúng một request OpenAI. Server tự đưa registry được phép vào prompt, coi tên cột và mẫu là dữ liệu không tin cậy, rồi kiểm tra structured output trước khi trả về client. AI chỉ đề xuất bốn loại:

- `bar`
- `line`
- `choropleth`
- `hex_h3`

Response AI lỗi, không hợp lệ hoặc không có suggestion dùng được sẽ chuyển ngay sang rule-based fallback với cùng contract; không retry. Pie, Half Pie và các biến thể bar vẫn là lựa chọn thủ công. Thay đổi filter, ngày, series, metric, palette hoặc H3 resolution chỉ dựng lại payload tại client và không gọi AI thêm lần nữa.

`AI_DEBUG` mặc định tắt. Khi tắt, middleware không log sample/head hoặc raw profile. Chỉ bật `AI_DEBUG=true` trong môi trường phát triển có dữ liệu phù hợp để ghi log.

Choropleth lấy geometry hành chính từ MapTiler và cho phép thiếu một phần địa danh, đồng thời báo `matched`, `unmatched` và `matchRate`. GADM chỉ được dùng làm mặt nạ đất liền, không ép tên hoặc số lượng tỉnh. Thiếu MapTiler key chỉ khóa choropleth; Bar, Line và H3 vẫn hoạt động nếu dữ liệu phù hợp.

Các file GeoJSON độc lập cũng được xếp lớp theo nội dung thay vì thứ tự upload. Rule nền luôn đặt polygon/hexagon dưới line/route và đặt point/station trên cùng; AI nhận metadata của các lớp để đề xuất thứ tự chi tiết giữa những lớp cùng nhóm. Nếu chưa cấu hình OpenAI hoặc API lỗi, thứ tự hình học này vẫn được áp dụng ngay ở trình duyệt.

Kết quả ranh giới mới từ MapTiler được cắt bằng polygon GADM tương ứng trước khi hiển thị: cấp quốc gia dùng GADM 0, tỉnh/thành dùng GADM 1, quận/huyện và địa phương dùng GADM 2. Các polygon GADM chồng lấn được dùng như một mặt nạ đất liền, nhằm giữ biên giới hành chính mới từ MapTiler nhưng loại phần ranh giới ngoài biển.

## 1. Mục tiêu dự án

Xây dựng một công cụ cho phép người dùng tải dữ liệu không gian lên hệ thống, sau đó phân tích dữ liệu và lựa chọn kiểu trực quan hóa phù hợp để hiển thị trên bản đồ.

Hệ thống hướng tới việc hỗ trợ nhiều loại dữ liệu, nhiều kiểu hiển thị và có khả năng tích hợp AI để hỗ trợ lựa chọn cấu hình bản đồ.

## 2. Luồng xử lý tổng quát

```text
Upload dữ liệu
→ Phân tích dữ liệu
→ Xác định các kiểu bản đồ có thể sử dụng
→ Đề xuất / lựa chọn kiểu hiển thị
→ Chuẩn hóa dữ liệu
→ Render lên bản đồ
```

## 3. Dữ liệu đầu vào

Hệ thống dự kiến hỗ trợ các định dạng dữ liệu phổ biến như:

- Excel
- CSV
- JSON
- GeoJSON
- Các định dạng dữ liệu không gian khác khi cần mở rộng

Phần upload cần có khả năng đọc và nhận diện cấu trúc dữ liệu trước khi chuyển sang bước trực quan hóa.

Ứng dụng khởi động ở trạng thái trống và chỉ tạo bản đồ sau khi người dùng upload hoặc nhập dữ liệu; không tự nạp bộ ranh giới mặc định.

## 4. Phân tích và lọc dữ liệu

Sau khi upload, hệ thống cần phân tích dữ liệu để xác định:

- Loại dữ liệu không gian
- Các trường tọa độ
- Geometry
- Các trường số
- Các trường phân loại
- Các thuộc tính có thể sử dụng để trực quan hóa

Kết quả phân tích được dùng để lọc ra các kiểu bản đồ phù hợp.

## 5. Các kiểu trực quan hóa

Danh sách kiểu bản đồ không nên được cố định hoàn toàn trên giao diện.

Các lựa chọn hiển thị cần phụ thuộc vào:

- Những renderer mà hệ thống đang hỗ trợ
- Cấu trúc dữ liệu người dùng upload
- Khả năng của thư viện bản đồ đang sử dụng

Một số nhóm visualization dự kiến:

- Point
- Line
- Polygon
- Circle
- Hexagon
- Column
- Heatmap
- Grid
- Các loại khác có thể bổ sung sau

## 6. Hệ thống thư viện

Các thư viện có thể được kết hợp theo từng vai trò:

- **MapLibre GL JS**: nền tảng hiển thị bản đồ
- **H3**: phân chia và xử lý lưới địa lý
- **Turf.js**: xử lý hình học và dữ liệu không gian
- **deck.gl**: các lớp trực quan hóa nâng cao và dữ liệu lớn
- Các thư viện khác có thể được bổ sung tùy nhu cầu

Kiến trúc nên cho phép bổ sung thư viện mới mà không phải thay đổi toàn bộ hệ thống.

## 7. Map Canvas và Renderer

Khu vực bản đồ nên là một `Map Canvas` dùng chung.

Không tạo một màn hình riêng cho từng kiểu bản đồ.

Mỗi kiểu trực quan hóa nên được triển khai dưới dạng renderer/layer riêng, ví dụ:

```text
Map Canvas
├── Hexagon Renderer
├── Point Renderer
├── Line Renderer
├── Polygon Renderer
├── Column Renderer
└── ...
```

Renderer được lựa chọn dựa trên cấu hình hiện tại.

## 8. Cấu hình hiển thị động

Phần cấu hình bên trái không nên cố định theo một loại bản đồ cụ thể.

Mỗi visualization có thể có bộ cấu hình riêng.

Ví dụ:

```text
Hexagon → Resolution, Metric, Aggregation
Column  → Height Field, Scale, Color
Line    → Width, Color, Geometry
Polygon → Fill, Border, Opacity
```

Giao diện cấu hình cần thay đổi theo renderer được chọn.

## 9. Data Preview

Bảng dữ liệu phía dưới bản đồ cũng cần thay đổi theo loại visualization.

Không nên cố định theo cấu trúc H3.

Bảng nên hiển thị dữ liệu hoặc kết quả xử lý tương ứng với renderer hiện tại.

## 10. Chuẩn hóa dữ liệu

Nên có một tầng dữ liệu trung gian để các renderer sử dụng chung.

Luồng xử lý:

```text
Excel / CSV / JSON / GeoJSON
            ↓
         Parser
            ↓
   Dữ liệu chuẩn hóa
            ↓
        Renderer
```

Việc chuẩn hóa giúp tránh để mỗi renderer phải tự xử lý từng định dạng file.

## 11. Template / Renderer Registry

Nên có một nơi quản lý các visualization mà hệ thống hỗ trợ.

Registry có thể lưu các thông tin như:

- Tên visualization
- Loại dữ liệu yêu cầu
- Renderer tương ứng
- Các thuộc tính cấu hình
- Điều kiện có thể sử dụng

Registry sẽ là cơ sở để hệ thống lọc và lựa chọn visualization.

## 12. Rule-based Recommendation

Giai đoạn đầu nên sử dụng các rule để xác định những kiểu bản đồ phù hợp với dữ liệu.

Ví dụ tổng quát:

```text
Point data
→ Point / Hexagon / Column / Heatmap

Line geometry
→ Line

Polygon geometry
→ Polygon
```

Rule engine giúp hệ thống hoạt động ổn định ngay cả khi chưa tích hợp AI.

## 13. AI Recommendation

AI được giới hạn ở vai trò:

- Hiểu ý nghĩa các trường dữ liệu
- Hỗ trợ lựa chọn visualization
- Đề xuất cách mapping dữ liệu vào renderer
- Đề xuất cấu hình ban đầu

AI không trực tiếp sinh code render bản đồ.

Thay vào đó AI trả về contract có cấu trúc, ví dụ rút gọn:

```json
{
  "datasetTitle": "Dân số theo tỉnh",
  "grain": "Một dòng cho mỗi tỉnh",
  "columns": [],
  "suggestions": [{
    "id": "population-by-region",
    "chartType": "choropleth",
    "bindings": { "region": "province", "value": "population" },
    "agg": "sum",
    "confidence": 0.9
  }]
}
```

Renderer có sẵn trong hệ thống sẽ sử dụng cấu hình này để hiển thị bản đồ.

## 14. Quyền lựa chọn của người dùng

AI hoặc rule engine chỉ nên đóng vai trò đề xuất.

Người dùng vẫn có thể:

- Thay đổi visualization
- Thay đổi thuộc tính dữ liệu
- Điều chỉnh style
- Điều chỉnh các tham số hiển thị

## 15. Pipeline hiện tại

Luồng thực thi chính:

```text
1. Parse và profile trong Web Worker
2. Một request AI theo registry dùng chung
3. Soft validation và rule-based fallback
4. Chuẩn hóa kiểu dữ liệu
5. Tính feasibility/effective confidence
6. Aggregate hoặc pivot tại client
7. Render trên canvas hiện có
```

## 16. Nguyên tắc kiến trúc

Hệ thống nên hướng tới:

- Tách biệt dữ liệu và hiển thị
- Renderer có thể thay thế hoặc bổ sung
- Không phụ thuộc cứng vào H3
- Không để AI sinh trực tiếp logic render
- Các visualization dùng chung một Map Canvas
- Có thể mở rộng thêm thư viện và kiểu bản đồ trong tương lai

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

Mỗi dataset chỉ tạo đúng một request OpenAI. Server tự đưa registry được phép vào prompt, coi tên cột và mẫu là dữ liệu không tin cậy, rồi kiểm tra structured output trước khi trả về client. Đầu vào chỉ hỗ trợ ba kiểu bản đồ:

- `choropleth`: **Bản đồ Polygon**, theo khu vực hành chính như tỉnh/thành phố.
- `map_line`: **Bản đồ Line**, theo tên đường hoặc chuỗi tọa độ.
- `point`: **Bản đồ Point**, theo tọa độ của từng đối tượng.

AI đánh giá mức phù hợp của kiểu hiển thị theo grain, role và ý nghĩa dữ liệu; mỗi kiểu chỉ xuất hiện một lần, với bindings làm cấu hình mặc định. Không tách đề xuất theo chỉ số hoặc tự nhóm theo thuộc tính mô tả để tạo thêm bài toán thống kê. Kết quả AI không có đề xuất vẫn được giữ ở bước chuẩn hóa. Khi chuẩn bị hiển thị bảng có địa danh hành chính và chỉ số hợp lệ tại ít nhất hai địa phương (không phải bảng tọa độ), client bổ sung Choropleth nếu AI bỏ sót; đề xuất bổ sung mang nguồn `rule`. Các đối tượng cố định có tọa độ được ưu tiên Point, dù có nhiều quan sát theo thời gian. Không tự chọn một biểu đồ độc lập khi dữ liệu không phù hợp với bản đồ.

Thời gian dùng bộ xử lý chung cho profile, chuẩn hóa, sắp xếp và lọc khoảng. Hỗ trợ Date, ISO, Excel serial, Unix, ngày dạng `dd/mm/yyyy` trong chế độ text, tháng/quý/tuần có hoặc không có năm và tên tháng tiếng Anh. Kỳ không có năm giữ nhãn gốc; không tự bổ sung năm. Chuỗi lẫn kỳ không có năm và ngày có năm được báo chưa tương thích; giá trị không nhận diện được không bị đoán thành ngày. Schema hỗ trợ granularity `day`, `week`, `month`, `quarter`, `year`.

Với cả ba kiểu bản đồ, mục 2 chỉ liệt kê các kiểu bản đồ; mục 3 cho chọn popup **Chỉ hiển thị thông tin** (mặc định), **Biểu đồ cột** hoặc **Biểu đồ đường**. Khi chọn cột/đường, popup chỉ hiển thị biểu đồ, ẩn phần thông tin phía trên. Các điều chỉnh biểu đồ chỉ hiện khi chọn cột/đường; khoảng thời gian biểu đồ độc lập với bộ lọc bản đồ và mặc định bao phủ toàn bộ dữ liệu. Bộ dữ liệu mới trở về popup thông tin. Polygon vẫn hỗ trợ lưới lục giác kế thừa dữ liệu của vùng; H3 từ tọa độ không còn là một kiểu đầu vào riêng.

Trong luồng **Bản đồ Polygon**, bấm một vùng hoặc ô lục giác thuộc polygon để xem thông tin hoặc biểu đồ riêng của vùng đó. Ngày tô màu bản đồ độc lập với khoảng ngày biểu đồ. Chọn địa phương bằng cách bấm trên bản đồ.

Dữ liệu giao thông theo khu vực, tên/mã đường và thời điểm được ưu tiên **Bản đồ Line**; biểu đồ cột/đường nằm trong lựa chọn popup tại mục 3. Khi AI bỏ sót bản đồ tuyến, client bổ sung đề xuất theo quy tắc từ metadata đường và chỉ số quan sát; không tự thêm polygon theo khu vực cho grain tuyến đường. Bấm một đoạn đường để xem thông tin hoặc chuỗi số liệu của đúng tuyến đó, phân biệt bằng khu vực, tên và mã đường. Popup biểu đồ ẩn các thẻ thông tin; chỉ số số và khoảng thời gian của biểu đồ độc lập với chỉ số/trạng thái tô màu và thời điểm của bản đồ. Bộ lọc khu vực, tên đường và thời điểm vẫn được giữ; nếu bộ lọc loại tuyến đang xem, popup đóng lại.

Trong luồng **Bản đồ Point**, bấm một điểm để xem biểu đồ của đúng đối tượng qua các kỳ. Ưu tiên mã đối tượng ổn định (ví dụ `ma_cua_hang`); khi thiếu mã, dùng cặp tọa độ. Các cửa hàng cùng thành phố hoặc trùng tọa độ nhưng khác mã không bị gộp chung. Mục **Hiển thị theo** cho chọn tên cửa hàng, thành phố hoặc cột phân loại/văn bản/địa danh khác có tối đa 80 giá trị. Thời gian bản đồ chỉ chọn một giá trị, mặc định là kỳ mới nhất; chỉ các điểm ở kỳ đó được hiển thị. Bộ lọc nhóm điểm, chỉ số kích thước và thời gian bản đồ hoạt động độc lập với cấu hình và khoảng thời gian biểu đồ popup.

**Line từ chuỗi tọa độ** dùng `bindings.lat`/`lng`, `region` để tách nhóm tuyến nếu có và `x` làm cột thứ tự/thời gian nếu có. Thiếu `x` sẽ nối theo thứ tự dòng trong file. Mỗi nhóm được nối riêng; tọa độ thiếu hoặc sai làm ngắt đường. Dữ liệu cửa hàng cố định lặp theo tháng không tự trở thành tuyến. Nhánh này dùng tọa độ trực tiếp, không cần tải mạng đường hoặc ranh giới hành chính.

Popup cột và đường dùng trục thời gian, giữ đầy đủ kỳ, giá trị 0 và khoảng thiếu số liệu. Khi không có cột thời gian, cột hiển thị giá trị tổng hợp của đối tượng và đường bị vô hiệu hóa kèm lý do. Đường cần ít nhất hai mốc có số liệu. Tọa độ và cột thứ tự không được dùng làm chỉ số biểu đồ.

Phép tính mặc định của biểu đồ cột là “Theo từng chỉ số”, giữ `aggDefault` riêng của từng cột. Người dùng có thể chọn SUM, AVG, MIN hoặc MAX; số bản ghi luôn dùng count. Không tự lấy trung bình khi có nhiều dòng trong một nhóm nhưng chưa xác định được phép gộp. Lựa chọn nhiều chỉ số mặc định ưu tiên cùng đơn vị. Các nhãn thời gian ngoài định dạng được hỗ trợ hoặc chỉ số cần phép tính chuyên biệt (ví dụ tỷ lệ cần trọng số) cần metadata/chuẩn hóa bổ sung; không coi mọi cột số đều cộng được.

Response AI lỗi, không hợp lệ hoặc chỉ chứa suggestion sai contract sẽ chuyển ngay sang rule-based fallback với cùng contract; không retry. Biểu đồ cột/đường là lựa chọn popup, không xuất hiện như kiểu đầu vào riêng. Thay đổi filter, ngày, metric, palette hoặc độ phân giải lưới polygon chỉ dựng lại payload tại client và không gọi AI thêm lần nữa.

`AI_DEBUG` mặc định tắt. Khi tắt, middleware không log sample/head hoặc raw profile. Chỉ bật `AI_DEBUG=true` trong môi trường phát triển có dữ liệu phù hợp để ghi log. Khi bật, mỗi lần phân tích sẽ thêm một phần tử JSON gồm tên file/sheet, input gửi AI, raw output và output sau chuẩn hóa vào `test/ai-analysis-input-output.json`. Có thể đổi đường dẫn bằng biến `AI_DEBUG_FILE`; toàn bộ các lần phân tích được lưu chung trong một mảng JSON và có thể format trực tiếp trong IDE.

Choropleth ưu tiên geometry hành chính từ MapTiler. Tên có tiền tố huyện/quận/thị xã hoặc xã/phường/thị trấn được tra đúng cấp, dùng cùng tìm kiếm hành chính với thanh tìm kiếm. Khi MapTiler thiếu kết quả, client tra tên chính xác trong GADM 4.1 có sẵn: cấp 1 cho tỉnh/thành, cấp 2 cho huyện/quận/thị xã. GADM giữ ranh giới theo phiên bản của bộ dữ liệu, không thay thế các ranh giới mới đã tìm được từ MapTiler. Thiếu MapTiler key vẫn có thể ghép bằng GADM.

Kết quả ghép báo `matched`, `unmatched`, `matchRate` và giữ nguồn `boundary_source` của từng vùng. Tên trùng không được tự chọn kết quả đầu tiên: phần Chưa khớp hiển thị tên kèm tỉnh/thành, cho phép chọn vùng, di chuyển bản đồ để kiểm tra hoặc nhập tên kèm tỉnh/thành. Khi phản hồi thiếu tỉnh, client tra tỉnh tại tọa độ của vùng bằng [MapTiler reverse geocoding](https://docs.maptiler.com/cloud/api/geocoding/#search-by-coordinates-reverse). Bấm Thử ghép lại dùng đúng polygon đã chọn, giữ tên và chỉ số của dòng dữ liệu gốc. GADM cấp 2 không chứa dữ liệu xã/phường; tên xã không được ghép với huyện/thị xã trùng tên.

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

Các kiểu bản đồ hiện được hỗ trợ:

- Point
- Line
- Polygon

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
→ Point (hoặc Line nếu là chuỗi tọa độ)

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

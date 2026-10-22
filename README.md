# GeoMap Builder

## Chạy dự án

```bash
npm install
npm run dev
```

Ghép ranh giới hành chính cho dữ liệu tải lên dùng MapTiler Geocoding với key trong `.env`:

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

Tùy chọn **“Gửi giá trị mẫu cho AI”** mặc định bật. Request AI chứa tên cột, kiểu suy luận, thống kê như tỷ lệ null, số giá trị phân biệt, min/max cùng tối đa 5 mẫu cho mỗi cột và 8 dòng đầu; chuỗi được loại control character và cắt ở 160 ký tự. AI dùng các dòng mẫu để nhận diện cấp quan sát và quan hệ địa lý giữa các cột. Khi tắt tùy chọn này, request không có trường `samples` hoặc `head`.

Mỗi dataset chỉ tạo đúng một request OpenAI. Server tự đưa registry được phép vào prompt, coi tên cột và mẫu là dữ liệu không tin cậy, rồi kiểm tra structured output trước khi trả về client. Đầu vào chỉ hỗ trợ ba kiểu bản đồ:

- `choropleth`: **Bản đồ Polygon**, theo khu vực hành chính như tỉnh/thành phố.
- `map_line`: **Bản đồ Line**, theo tên đường hoặc chuỗi tọa độ.
- `point`: **Bản đồ Point**, theo tọa độ của từng đối tượng.

AI đánh giá mức phù hợp của kiểu hiển thị theo grain, role và ý nghĩa dữ liệu; mỗi kiểu chỉ xuất hiện một lần, với bindings làm cấu hình mặc định. Không tách đề xuất theo chỉ số hoặc tự nhóm theo thuộc tính mô tả để tạo thêm bài toán thống kê. Kết quả AI không có đề xuất vẫn được giữ ở bước chuẩn hóa. Khi chuẩn bị hiển thị bảng có địa danh hành chính và chỉ số hợp lệ tại ít nhất hai địa phương (không phải bảng tọa độ), client bổ sung Choropleth nếu AI bỏ sót; đề xuất bổ sung mang nguồn `rule`. Các đối tượng cố định có tọa độ được ưu tiên Point, dù có nhiều quan sát theo thời gian. Không tự chọn một biểu đồ độc lập khi dữ liệu không phù hợp với bản đồ.

Khi bảng có nhiều cấp địa lý, AI dùng tên cột và dữ liệu mẫu để chọn cấp phản ánh từng quan sát. Dữ liệu theo khu vực thuộc các quốc gia ưu tiên vẽ khu vực; dữ liệu chỉ ở cấp quốc gia thì vẽ quốc gia. Các cấp cha dùng làm ngữ cảnh tra ranh giới và bộ lọc. Quy tắc dự phòng ưu tiên cấp hành chính chi tiết nhất có dữ liệu, không chọn theo thứ tự cột. Từng khu vực được tra bằng tên cùng các cấp cha và quốc gia của chính dòng đó; các vùng trùng tên thuộc những cấp cha khác nhau được tách riêng khi ghép dữ liệu và hiển thị popup. Tra khu vực ngoài Việt Nam dùng phạm vi quốc gia tương ứng và không áp bbox Việt Nam; dữ liệu địa phương cục bộ là nguồn dự phòng khi có.

Thời gian dùng bộ xử lý chung cho profile, chuẩn hóa, sắp xếp và lọc khoảng. Hỗ trợ Date, ISO, Excel serial, Unix, ngày dạng `dd/mm/yyyy` trong chế độ text, tháng/quý/tuần có hoặc không có năm và tên tháng tiếng Anh. Kỳ không có năm giữ nhãn gốc; không tự bổ sung năm. Chuỗi lẫn kỳ không có năm và ngày có năm được báo chưa tương thích; giá trị không nhận diện được không bị đoán thành ngày. Schema hỗ trợ granularity `day`, `week`, `month`, `quarter`, `year`.

Với cả ba kiểu bản đồ, mục 2 chỉ liệt kê các kiểu bản đồ. Trong cùng request phân tích, mỗi `suggestions[]` trả thêm `popupSuggestions` gồm 1–3 phần tử chỉ có `name` (`info`, `bar`, `line`) và `confidence` từ 0 đến 1, ví dụ `[{"name":"line","confidence":0.96},{"name":"info","confidence":0.91}]`. AI đánh giá dữ liệu của một đối tượng được bấm theo grain/bindings của từng bản đồ: chuỗi thời gian phù hợp thì ưu tiên đường, so sánh độ lớn/số đếm có ý nghĩa thì đề xuất cột, dữ liệu mô tả hoặc quan sát đơn lẻ thì ưu tiên thông tin. Mục 3 chỉ hiện các kiểu được đề xuất, sắp giảm dần theo điểm, hiển thị phần trăm AI và mặc định chọn kiểu khả dụng đứng đầu; không áp ngưỡng confidence để khóa lựa chọn. Đề xuất trùng tên lấy điểm cao nhất, bằng điểm giữ thứ tự AI; tên/điểm sai bị loại.

Danh sách thiếu, rỗng, lỗi hoặc không còn kiểu khả dụng chỉ hiện **Thông tin dự phòng**, không gán điểm AI; output cũ và bản đồ bổ sung bằng quy tắc cũng dùng cách này. Kiểu đường thiếu cột thời gian hoặc chỉ số đo hợp lệ bị vô hiệu hóa kèm lý do nếu còn kiểu khác khả dụng. Lựa chọn và cấu hình popup được giữ riêng theo bản đồ, không bị ghi đè khi đổi chỉ số/bộ lọc hoặc mở đối tượng khác. Đối tượng thiếu số liệu hoặc khoảng thời gian rỗng giữ kiểu đã chọn và hiện giải thích trong popup. Khi chọn cột/đường, popup chỉ hiển thị biểu đồ, ẩn phần thông tin phía trên. Các điều chỉnh biểu đồ chỉ hiện khi chọn cột/đường; khoảng thời gian biểu đồ độc lập với bộ lọc bản đồ và mặc định bao phủ toàn bộ dữ liệu. Bộ dữ liệu mới chọn lại mặc định từ đề xuất mới. Tương tác popup không gọi thêm AI. Polygon vẫn hỗ trợ lưới lục giác kế thừa dữ liệu của vùng; H3 từ tọa độ không còn là một kiểu đầu vào riêng.

Thanh tìm kiếm trên bản đồ mặc định ẩn khi chưa có dữ liệu. Trong cùng request phân tích file, AI trả thêm `search_bar` (boolean bật/tắt mặc định) và `search_fields` (mảng tên cột gốc theo thứ tự: định danh chính trước, ngữ cảnh hỗ trợ sau). AI đánh giá số đối tượng duy nhất và lợi ích tìm nhanh, không áp ngưỡng `uniqueCount >= 30` cứng hoặc dựa vào số dòng/ngày/cột đo lường. Ví dụ thời tiết theo khu vực dùng `["Khu vực", "Quốc gia"]`, tuyến dùng `["Tên đường"]`, cửa hàng dùng `["Tên cửa hàng", "Thành phố"]`; thiếu tên có thể dùng mã đối tượng.

Backend và frontend chỉ chấp nhận các tên cột có thật, không trùng nhau, thuộc role địa danh/tên/phân loại/mã/văn bản; loại cột đo lường, thời gian, tọa độ và metadata nội bộ. Trường đầu tiên xác định nhãn chính; khi đổi bản đồ, ứng dụng điều chỉnh theo cột địa lý/tuyến đang vẽ bằng metadata hiện có. Không có trường hoặc đối tượng hợp lệ thì ẩn. `search_bar: false` giữ thanh tìm kiếm ẩn ngay cả khi danh sách trường hợp lệ. Output cũ thiếu `search_fields` tiếp tục dùng các trường tìm kiếm hiện có; thiếu `search_bar` giữ hành vi cũ là hiện khi có dữ liệu tìm được. Giao diện hiện chưa có công tắc ghi đè bật/tắt thủ công.

Số đối tượng được đếm theo giá trị định danh đã bỏ khoảng trắng đầu/cuối, bỏ trống/null; không nhân số đếm vì nhiều quan sát hoặc đoạn đường. Các cột địa lý ngữ cảnh được dùng cùng tên để phân biệt đối tượng trùng tên. Tìm không dấu và bí danh chỉ phục vụ so khớp truy vấn, không gộp đối tượng khi đếm. Nếu bộ lọc làm giảm tập đối tượng và còn dưới 5 đối tượng duy nhất, thanh tìm kiếm tạm ẩn, vô hiệu hóa ô nhập và xóa truy vấn/kết quả cũ; bỏ lọc đủ điều kiện thì hiện lại theo đề xuất ban đầu. Ngưỡng này cấu hình bằng `CONFIG.DATA_SEARCH_MIN_FILTERED_OBJECTS` trong `src/config.js`.

Kết quả chỉ gồm đối tượng phù hợp với bộ lọc bản đồ hiện tại; chọn kết quả để chuyển đến đối tượng và mở popup dữ liệu. Có thể tìm tên có dấu, không dấu hoặc bí danh/mã quốc gia đã cấu hình trên các trường được chọn. Thay file, đổi kiểu bản đồ hoặc bộ lọc cập nhật chỉ mục; đổi màu, zoom hoặc mở popup không gọi lại AI và không làm mất truy vấn khi dữ liệu không đổi. Xóa dữ liệu sẽ ẩn thanh tìm kiếm. Tìm kiếm chạy tại trình duyệt, không gọi geocoding hay tải thời tiết cho khu vực ngoài dữ liệu. Công tắc thời tiết OpenWeather theo vùng đã được bỏ; dữ liệu thời tiết tải lên vẫn hiển thị như các chỉ số thông thường.

Trong luồng **Bản đồ Polygon**, bấm một vùng hoặc ô lục giác thuộc polygon để xem thông tin hoặc biểu đồ riêng của vùng đó. Ngày tô màu bản đồ độc lập với khoảng ngày biểu đồ. Chọn địa phương bằng cách bấm trên bản đồ.

Các nút chọn nhanh dọc cạnh phải bản đồ được AI thiết kế riêng cho từng bộ dữ liệu và kiểu bản đồ trong cùng request phân tích. Mỗi `suggestions[].metricButtons` là danh sách có thứ tự gồm `{ "field": "tên cột gốc", "label": "nhãn hiển thị", "icon": "emoji/ký hiệu Unicode", "color": "#RRGGBB" }`. AI quyết định chỉ số nào cần nút, thứ tự, nhãn, biểu tượng và màu theo nội dung bảng; giao diện không dò từ khóa để gán biểu tượng thời tiết và không tự bổ sung mọi cột số thành nút. Đơn vị lấy từ metadata cột, màu biểu tượng độc lập với thang màu bản đồ. Point dùng nút đầu tiên làm chỉ số kích thước mặc định. Chỉ các cột hợp lệ cho bản đồ mới được nhận; bỏ cột lạ/trùng, địa lý, thời gian, tọa độ, ID, thứ tự và cấu hình sai. Line có thể dùng thêm cột phân loại hợp lệ với tối đa 12 giá trị.

Khi có ít nhất hai nút AI hợp lệ, danh sách xuất hiện với biểu tượng tròn. Bấm nút để đổi chỉ số tô màu Polygon/Line hoặc kích thước Point; bộ chọn ở mục 3 và chú giải được cập nhật cùng lựa chọn. Ngày, khu vực và cấu hình biểu đồ popup được giữ nguyên; thao tác không gọi thêm AI. Có thể thu gọn/mở danh sách bằng nút **Chỉ số bản đồ** và cuộn khi có nhiều cột. Danh sách tự cập nhật khi đổi file/kiểu bản đồ. Output AI cũ thiếu `metricButtons`, danh sách rỗng/lỗi, phân tích dự phòng hoặc dưới hai nút hợp lệ đều ẩn danh sách; bộ chọn chỉ số tại mục 3 vẫn hoạt động và không sinh bộ nút mặc định.

Mục 3 của Polygon tự tạo bộ lọc giá trị cho các cột địa lý và phân nhóm từ metadata, dùng đúng tên/nhãn cột trong bảng. Các cấp địa lý được xếp từ quốc gia đến cấp hành chính nhỏ hơn; cột phân nhóm theo sau. Mỗi bộ lọc có lựa chọn **Tất cả**. Danh sách giá trị phụ thuộc các bộ lọc đứng trước; khi đổi lựa chọn, giá trị phía sau không còn phù hợp được bỏ chọn. Bộ lọc áp dụng trước tổng hợp và cho cả dữ liệu biểu đồ popup; khoảng thời gian biểu đồ vẫn độc lập với ngày tô màu bản đồ. Lựa chọn được giữ khi đổi chỉ số hoặc kiểu popup.

Dữ liệu giao thông theo khu vực, tên/mã đường và thời điểm được ưu tiên **Bản đồ Line**; biểu đồ cột/đường nằm trong lựa chọn popup tại mục 3. Khi AI bỏ sót bản đồ tuyến, client bổ sung đề xuất theo quy tắc từ metadata đường và chỉ số quan sát; không tự thêm polygon theo khu vực cho grain tuyến đường. Bấm một đoạn đường để xem thông tin hoặc chuỗi số liệu của đúng tuyến đó, phân biệt bằng khu vực, tên và mã đường. Popup biểu đồ ẩn các thẻ thông tin; chỉ số số và khoảng thời gian của biểu đồ độc lập với chỉ số/trạng thái tô màu và thời điểm của bản đồ. Bộ lọc khu vực, tên đường và thời điểm vẫn được giữ; nếu bộ lọc loại tuyến đang xem, popup đóng lại.

Trong luồng **Bản đồ Point**, bấm một điểm để xem biểu đồ của đúng đối tượng qua các kỳ. Ưu tiên mã đối tượng ổn định (ví dụ `ma_cua_hang`); khi thiếu mã, dùng cặp tọa độ. Các cửa hàng cùng thành phố hoặc trùng tọa độ nhưng khác mã không bị gộp chung. Mục **Hiển thị theo** cho chọn tên cửa hàng, thành phố hoặc cột phân loại/văn bản/địa danh khác có tối đa 80 giá trị. Thời gian bản đồ chỉ chọn một giá trị, mặc định là kỳ mới nhất; chỉ các điểm ở kỳ đó được hiển thị. Bộ lọc nhóm điểm, chỉ số kích thước và thời gian bản đồ hoạt động độc lập với cấu hình và khoảng thời gian biểu đồ popup.

**Line từ chuỗi tọa độ** dùng `bindings.lat`/`lng`, `region` để tách nhóm tuyến nếu có và `x` làm cột thứ tự/thời gian nếu có. Thiếu `x` sẽ nối theo thứ tự dòng trong file. Mỗi nhóm được nối riêng; tọa độ thiếu hoặc sai làm ngắt đường. Dữ liệu cửa hàng cố định lặp theo tháng không tự trở thành tuyến. Nhánh này dùng tọa độ trực tiếp, không cần tải mạng đường hoặc ranh giới hành chính.

Popup cột ở chế độ “Theo dữ liệu” và popup đường dùng trục thời gian, giữ đầy đủ kỳ, giá trị 0 và khoảng thiếu số liệu. Khi không có cột thời gian, cột hiển thị giá trị tổng hợp của đối tượng và đường bị vô hiệu hóa kèm lý do. Đường cần ít nhất hai mốc có số liệu. Tọa độ và cột thứ tự không được dùng làm chỉ số biểu đồ.

Phép tính mặc định của popup cột là “Theo dữ liệu”, hiển thị theo từng mốc và dùng `aggDefault` riêng của từng cột khi nhiều bản ghi trùng mốc. Khi chọn SUM, AVG, MIN hoặc MAX, biểu đồ tính trực tiếp từ toàn bộ bản ghi của đối tượng trong khoảng thời gian đã chọn (gồm cả hai đầu khoảng), hiển thị một cột tổng hợp cho mỗi chỉ số thay vì chia cột theo ngày. AVG bỏ qua giá trị thiếu và vẫn tính giá trị 0; số bản ghi luôn dùng count. Không tự lấy trung bình khi có nhiều dòng trong một nhóm nhưng chưa xác định được phép gộp. Lựa chọn nhiều chỉ số mặc định ưu tiên cùng đơn vị. Các nhãn thời gian ngoài định dạng được hỗ trợ hoặc chỉ số cần phép tính chuyên biệt (ví dụ tỷ lệ cần trọng số) cần metadata/chuẩn hóa bổ sung; không coi mọi cột số đều cộng được.

Response AI lỗi, không hợp lệ hoặc chỉ chứa suggestion sai contract sẽ chuyển ngay sang rule-based fallback với cùng contract; không retry. Biểu đồ cột/đường là lựa chọn popup, không xuất hiện như kiểu đầu vào riêng. Thay đổi filter, ngày, metric, palette hoặc độ phân giải lưới polygon chỉ dựng lại payload tại client và không gọi AI thêm lần nữa.

`AI_DEBUG` mặc định tắt. Khi tắt, middleware không log sample/head hoặc raw profile. Chỉ bật `AI_DEBUG=true` trong môi trường phát triển có dữ liệu phù hợp để ghi log. Khi bật, mỗi lần phân tích sẽ thêm một phần tử JSON gồm tên file/sheet, input gửi AI, raw output và output sau chuẩn hóa vào `test/ai-analysis-input-output.json`. Có thể đổi đường dẫn bằng biến `AI_DEBUG_FILE`; toàn bộ các lần phân tích được lưu chung trong một mảng JSON và có thể format trực tiếp trong IDE.

Choropleth ưu tiên polygon từ MapTiler khi có API key. Khi không có kết quả phù hợp, API lỗi hoặc thiếu key, ứng dụng mới tra ranh giới trong thư mục mã quốc gia. Bảng ánh xạ dự phòng nằm riêng tại `src/country-boundary-fallbacks.js`, khai báo tên nước, bí danh và URL từng cấp ADM trong thư mục mã quốc gia tương ứng. Các nước đã có ánh xạ được giữ nguyên khi bổ sung nước mới. Khi chưa có dữ liệu cục bộ, để `files: {}`; nước đó vẫn tra MapTiler và giữ nguyên polygon khi chưa có mặt nạ cục bộ. Khi bổ sung dữ liệu, thêm URL file vào mục `files` của nước đó. Các tên `Việt Nam`, `Viet Nam`, `Vietnam`, `VN`, `VNM` trỏ về `administrative_division/VNM/`: quốc gia đọc `VNM_ADM0.geojson`, tỉnh/thành đọc `VNM_ADM1.geojson`, quận/huyện đọc `VNM_ADM2.geojson`. Các tên `Nga`, `Liên bang Nga`, `Russia`, `Russian Federation`, `RU`, `RUS` trỏ về `administrative_division/RUS/RUS_ADM0.geojson` cho ranh giới quốc gia. Hàm phân giải tên, tải file và cache trong bộ nhớ nằm tại `src/country-boundary-sources.js`. Ánh xạ tên nước sang mã thư mục và ghép địa danh được thực hiện bằng code, không cần AI biết đường dẫn hay gọi AI để ghép ranh giới. Bộ tải cũng nhận mã quốc gia có sẵn trong metadata. Chưa có quốc gia thì địa danh tỉnh/huyện mặc định tra Việt Nam; mã quốc gia chưa cấu hình không bị chuyển sang Việt Nam. Khi bổ sung nguồn dự phòng cho một nước, thêm mã thư mục, tên, bí danh và URL từng cấp ADM vào `src/country-boundary-fallbacks.js`; chỉ các nước đã cấu hình được đóng gói khi build. Không đọc các đường dẫn `gadm41_VNM_*.json` cũ.

Bảng có cột `Quốc gia`/`Quoc gia`/`Country` hoặc `Mã quốc gia`/`Ma quoc gia`/`Country Code` được nhận diện là `geoLevel: country`, kể cả khi AI gán nhầm thành ID, category hoặc cấp tỉnh. Giá trị Alpha-3 như `VNM`, `RUS`, `USA`, `AUT`, `AUS`, `JPN`, `KOR` được phân giải qua cấu hình quốc gia: tra MapTiler bằng tên nước tương ứng, đối chiếu mã quốc gia trong phản hồi và dùng đúng file ADM0 khi cần dự phòng. Mã gốc trong bảng được giữ nguyên để ghép chỉ số và bộ lọc. Mỗi tên nước được tra toàn cầu với `types=country`, không thêm hậu tố Việt Nam, `country=vn` hay bbox Việt Nam. Bộ ghép đối chiếu tên trong phản hồi đa ngôn ngữ (`text`, `text_vi`, `text_en`, `matching_text`), mã hai ký tự và tên tiếng Việt/Anh suy ra từ mã này bằng `Intl.DisplayNames`. Nếu gợi ý chỉ là Point thì tra tiếp theo feature ID để lấy polygon, theo [MapTiler Geocoding API](https://docs.maptiler.com/cloud/api/geocoding/). Mỗi tên nước duy nhất được tải một lần trong lượt ghép; kết quả ranh giới tra trực tiếp được cache trong bộ nhớ trình duyệt. Chỉ chấp nhận Polygon/MultiPolygon khớp tên hoặc mã; kết quả khác nước, chỉ có điểm hoặc tên không phân biệt được không được tự chọn. Nước chưa có file dự phòng vẫn được tra MapTiler bình thường. Ví dụ tập thời tiết theo Việt Nam, Thái Lan, Lào, Campuchia, Myanmar qua nhiều ngày được ghép theo tên nước gốc, sau đó lọc ngày và chỉ số tại client.

Tên khu vực chưa ghi rõ loại hành chính được tra theo cấp đề xuất trước, rồi tìm tên khớp chính xác trong các cấp hành chính khác của cùng quốc gia khi cần. Ví dụ Manila là `municipality`, Bandar Seri Begawan là `municipal_district`, Dili là `subregion`; không dùng vùng cha có tên khác để thay thế. Các điểm `virtual_place` được bỏ qua và gợi ý Point phải có polygon thật khi tra theo ID. Nguồn dự phòng bổ sung Brunei (`BRN`) và Timor-Leste (`TLS`); ngoài Việt Nam, bộ tra thử thêm các cấp ADM đã cấu hình khi cấp ban đầu không có tên khớp. Cấu hình `cityState: true` cho phép tên đô thị trùng tên quốc gia như Singapore dùng ranh giới quốc gia tương ứng; các khu vực nhỏ hơn trong nước đó vẫn dùng polygon riêng. Nhiều polygon khớp cùng tên tiếp tục yêu cầu chọn vùng.

Các file ADM dùng cấu trúc thuộc tính `GID_0`, `COUNTRY`, `GID_1/2`, `NAME_1/2`, `VARNAME_1/2`, `NL_NAME_1/2`, `TYPE_1/2` tùy cấp. Bộ đọc lấy định danh từ GID, tìm tên theo NAME/VARNAME/NL_NAME (tách các bí danh bằng `|` hoặc `;`, bỏ giá trị `NA`), lấy tỉnh cha trực tiếp từ `NAME_1` và kiểm tra loại địa danh qua TYPE. Tên ghép liền như `HồChíMinh` được hiển thị có khoảng trắng. Bí danh theo từng cấp có thể khai báo trong `nameAliases`, hiện có `Huế` → `ThừaThiênHuế` và các tên viết tắt TP HCM. Kết quả ghép báo `matched`, `unmatched`, `matchRate`, giữ `boundary_source: Local ADM` và tên dòng dữ liệu gốc. Tên trùng yêu cầu chọn vùng hoặc bổ sung loại địa danh/tỉnh cha; không suy ra tỉnh bằng hình học. Các file VNM hiện dừng ở ADM2; tên xã/phường không được ghép thành huyện. Kết quả MapTiler hợp lệ được giữ nguyên làm nguồn ranh giới; các file ADM của đúng quốc gia chỉ dự phòng và cung cấp mặt nạ cắt.

ADM1 cục bộ hiện chứa 63 tỉnh/thành theo bộ ranh giới nguồn. Khi MapTiler trả ranh giới mới cho tập dữ liệu 34 tỉnh/thành, ứng dụng ưu tiên ranh giới đó. Nếu phải dùng file dự phòng thì polygon giữ nguyên theo file; việc khớp tên không tự hợp nhất các tỉnh.

Riêng tên `TP. Hồ Chí Minh` khi tra cấp `region` tại Việt Nam được gửi tới MapTiler dưới tên `Hồ Chí Minh` để lấy polygon mở rộng, bao gồm Bình Dương và Bà Rịa–Vũng Tàu cũ. Tên dòng dữ liệu gốc được giữ nguyên để ghép chỉ số; alias do người dùng chọn vẫn được ưu tiên.

Các file GeoJSON độc lập cũng được xếp lớp theo nội dung thay vì thứ tự upload. Rule nền luôn đặt polygon/hexagon dưới line/route và đặt point/station trên cùng; AI nhận metadata của các lớp để đề xuất thứ tự chi tiết giữa những lớp cùng nhóm. Nếu chưa cấu hình OpenAI hoặc API lỗi, thứ tự hình học này vẫn được áp dụng ngay ở trình duyệt.

Ranh giới từ MapTiler được cắt bằng GeoJSON của quốc gia tương ứng khi đã cấu hình nguồn cục bộ: ADM0 cho quốc gia, ADM1 cho tỉnh/thành, ADM2 cho quận/huyện; ADM0 dự phòng khi cấp chi tiết không giao nhau. Với polygon cấp quốc gia, chọn mặt nạ theo chính quốc gia trong kết quả. Nước chưa có mặt nạ cục bộ giữ polygon MapTiler; không dùng VNM để cắt nước khác. Polygon đã đọc từ thư mục quốc gia được dùng trực tiếp. File ranh giới nằm trong `administrative_division/` (được gitignore) và cần có trên máy build.

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
2. Một request AI nhận diện metadata và bản đồ theo registry dùng chung
3. Soft validation và rule-based fallback
4. Chuẩn hóa kiểu dữ liệu
5. Tính feasibility/effective confidence
6. Aggregate hoặc pivot tại client
7. Với Polygon: gửi một request AI theo lô để thiết kế chú giải từ thống kê sau lọc/tổng hợp của từng chỉ số
8. Kiểm tra cấu hình chú giải rồi dùng cùng một scale cho Polygon, chú giải và lưới lục giác vùng
9. Render trên canvas hiện có
```

Chú giải Polygon nhận `continuous` với `auto/semantic` hoặc `diverging` với `semantic`. AI trả trực tiếp domain/stops/màu; ứng dụng không dùng registry ngưỡng nhiệt độ. Prompt yêu cầu nhiệt độ không khí (`air_temperature`) đơn vị °C dùng `continuous/semantic`, domain `[-20, 40]` với đúng bảy mốc `-20, -10, 0, 10, 20, 30, 40` cho giá trị trực tiếp hoặc phép gộp `mean/min/max`, kể cả khi dữ liệu chỉ từ 20 đến 30°C; AI tự đề xuất màu cho từng mốc. Chú giải giữ đủ nhãn và chuyển nhãn sang hàng khác khi thiếu chỗ. Khi đổi bộ lọc, `auto` cập nhật miền và giữ màu/vị trí tương đối, còn `semantic` giữ nguyên mốc. Đổi chỉ số dùng cấu hình đã lưu, không gọi AI lại. Thiếu cấu hình hoặc AI lỗi thì dùng thang kỹ thuật trung tính; giao diện ghi rõ chú giải dự phòng.

Output `legend` không chứa `legendSchemaVersion` hoặc `field`; ứng dụng xác định chỉ số từ cột chứa chú giải hoặc `suggestions[].bindings.value`. Dữ liệu chú giải v2 cũ vẫn được kiểm tra và chuẩn hóa về cấu trúc gọn này.

Lựa chọn dải màu thủ công được ẩn khi Polygon dùng chú giải do AI quản lý. Request thiết kế chỉ gửi metadata, bộ lọc và thống kê Polygon; không gửi geometry hay toàn bộ bản ghi nguồn.

## 16. Nguyên tắc kiến trúc

Hệ thống nên hướng tới:

- Tách biệt dữ liệu và hiển thị
- Renderer có thể thay thế hoặc bổ sung
- Không phụ thuộc cứng vào H3
- Không để AI sinh trực tiếp logic render
- Các visualization dùng chung một Map Canvas
- Có thể mở rộng thêm thư viện và kiểu bản đồ trong tương lai

# GeoMap Builder

Bốn loại bản đồ đã được tách thành module riêng; phần nhập dữ liệu, runtime, giao diện chung, popup và view nằm trong `src/shared/`. Xem [kiến trúc và cách thêm module](docs/map-modules.md). Kiểm tra DOM tích hợp bằng `npm run test:maps:browser` (cần Chrome/Chromium).

Luồng nhập dữ liệu hiện hỗ trợ Polygon, Line, Point và Arc Flow 3D. Lưới H3 là chế độ hiển thị của Polygon; biểu đồ cột/đường/tròn chỉ dùng trong popup. Đã gỡ Heatmap, H3 độc lập, biểu đồ toàn màn hình (cột/đường/tròn), OpenWeather và các renderer không được gọi. Cấu hình và bộ điều chỉnh của các chế độ này không còn được giữ trong ứng dụng.

## Chat chỉnh sửa bản đồ

AI có thể đồng nhất cả chiều rộng và chiều cao các nút chỉ số, kể cả nút không có dòng đơn vị: “Chỉnh kích thước các nút chỉ số cho bằng nhau”. Thao tác dùng `appearance`, `key: "metrics"`, `value: "{\"uniformSize\":true}"`; `uniformSize: false` bỏ đồng nhất tự động. Có thể đặt cụ thể `buttonWidth` (64–400 px) và `buttonHeight` (32–160 px), ví dụ “Các nút chỉ số rộng 120 px, cao 60 px”. Kích thước áp dụng cho các nút chọn chỉ số, giữ riêng nút tiêu đề thu gọn và lưu theo nhóm bản đồ.

AI có thể chuyển thanh tìm kiếm, khối chỉ số, chú giải và nút điều khiển sang trái/giữa/phải hoặc trên/giữa/dưới vùng bản đồ; chỉnh khoảng cách tới mép và khôi phục vị trí theo template. Vị trí giữ khi đổi kích thước hoặc render lại; template có sidebar vẫn căn theo vùng bản đồ thực tế. Popup giữ vị trí theo đối tượng đang chọn. Các thao tác này dùng `appearance` với `horizontal`, `vertical`, `offsetX`, `offsetY`; giá trị `default` khôi phục trục về template.

Nếu phản hồi AI không qua kiểm tra thao tác, server gửi lỗi cụ thể và phản hồi đó cho AI tự sửa tối đa một lượt trong cùng thời hạn 120 giây. Chưa có thao tác nào được áp dụng trong lúc sửa; kết quả sửa vẫn phải qua toàn bộ kiểm tra. Lỗi giao diện chỉ rõ thuộc tính sai và giá trị được phép thay vì chỉ báo “Giá trị chỉnh giao diện không hợp lệ”. Ví dụ chuyển chú giải sát mép trái dùng `value` chứa JSON `{"horizontal":"left","offsetX":0}` cho `kind: "appearance"`, `key: "legend"`, `layerId: ""`.

Sau khi dựng bản đồ, mở **AI hỗ trợ** để tiếp tục chỉnh bằng hội thoại: màu/độ mờ/đường viền, chỉ số, thang chú giải Polygon/Line, thuộc tính trong popup thông tin, popup thông tin/ảnh/cột/đường/tròn khi dữ liệu hỗ trợ, ẩn/hiện từng lớp và chú giải, bật/tắt hoặc đổi độ phân giải lưới lục giác Polygon. AI cũng chỉnh được nền, màu chữ, viền, bo góc, cỡ chữ và bóng của thanh tìm kiếm, khung chú giải, chỉ số, nút điều khiển và popup. Đổi nền tự chọn màu chữ tương phản nếu không chỉ định; thiết lập giao diện lưu riêng cho từng nhóm và được áp dụng lại khi template/control render lại, giữ nguyên thang màu dữ liệu. Ví dụ: “Đổi màu nền phần chú giải và thanh tìm kiếm sang màu trắng”, “Đổi thang màu nhiệt độ từ xanh sang đỏ”, “Popup chỉ hiển thị dân số và diện tích”, “Đổi popup sang biểu đồ cột”, “Ẩn lớp trạm quan trắc”. Yêu cầu ngoài khả năng hiện có sẽ được giải thích hoặc hỏi rõ thêm.

`POST /api/ai/edit-map` dùng cấu hình AI hiện có ở server. Client gửi lịch sử tối đa 20 tin nhắn cùng metadata/cấu hình của bản đồ hiện tại; không gửi toàn bộ bản ghi hay geometry. AI trả thao tác có cấu trúc, được kiểm tra ở cả server và client trước khi áp dụng vào runtime. `metric` chọn chỉ số đang xem; `metricFields` đặt danh sách chỉ số còn được hiển thị, loại các mục khác khỏi nút chỉ số, bộ chọn và popup/biểu đồ, đồng thời chặn chọn lại qua control cũ. Danh sách chỉ số gốc và dữ liệu được giữ để thêm lại khi yêu cầu. Còn một chỉ số sau khi chỉnh thì nút đó vẫn hiển thị; nếu loại chỉ số đang xem, phải chọn một chỉ số thay thế hợp lệ (client tự chọn khi chỉ còn một). Bộ lọc ngày/địa lý và chức năng khác được giữ. Đổi màu dữ liệu theo chú giải cập nhật đồng thời cả màu và thang chú giải. Đổi nhóm/lớp, dữ liệu hoặc cấu hình trong lúc chờ sẽ làm kết quả cũ bị từ chối. Nếu render thao tác lỗi, client khôi phục cấu hình trước đó. Lịch sử chat được giữ riêng cho từng nhóm bản đồ trong phiên trang hiện tại. Request lỗi giữ nội dung nhập để gửi lại.

Kiểm thử: `node --test tests/ai-map-edit.test.js`, `npm run test:maps:browser` (gồm hội thoại tiếp nối, màu bản đồ/chú giải, popup biểu đồ, thuộc tính và lưới) và `npm run test:template-composition:browser` (đổi nền trên template tối, tương phản chữ, vị trí các control trên template/sidebar/bản đồ gốc, đổi kích thước, render lại và chuyển nhóm). Kiểm tra tùy chọn với dịch vụ AI thật đang cấu hình: `node scripts/check-ai-map-edit-live.js <request.json>` hoặc truyền JSON qua stdin với đối số `-`. Đầu vào gồm `message`, `history`, `context` của ca cần kiểm tra; script in kết quả AI sau khi kiểm tra hợp đồng. Script không có câu chat, bản đồ mẫu hay màu đích mặc định và không được ứng dụng import.

## Tra cứu địa lý khi dữ liệu thiếu

Prompt cho phép AI tìm trên mạng để bổ sung **tọa độ điểm** còn thiếu. Với **khu vực/ranh giới hành chính**, giữ thứ tự MapTiler API → dữ liệu nội bộ → tra cứu web khi cả hai không có kết quả phù hợp. Phân tích đầu vào không tra web cho khu vực và không tự tạo cột khu vực thay thế luồng ghép ranh giới. Áp dụng cho bảng tính và TXT/DOCX, gồm cả tọa độ hai đầu của luồng OD. AI ưu tiên dữ liệu gốc và nguồn đáng tin cậy, dùng ngữ cảnh quốc gia/vùng cha để phân biệt địa danh trùng tên; không dùng tâm thành phố thay cho sân bay, không điền chỉ số đo, ngày hay lưu lượng từ web.

Kết quả trả `geographicEnrichment` gồm `field`, `geoLevel`, `matches: [{field, value}]`, `value`, `sourceUrl`; cột bổ sung phải được khai báo trong `columns` với role `geo`. Ứng dụng kiểm tra khóa ghép thuộc dữ liệu đã chia sẻ, URL HTTP(S), kiểu/cấp địa lý và giới hạn tọa độ; chỉ điền ô thiếu, giữ giá trị gốc và số dòng, giữ URL nguồn trong kết quả phân tích. Kết quả mâu thuẫn không được điền. Khi không xác minh được thì giữ dữ liệu thiếu; bản đồ vẫn phải vượt các kiểm tra khả dụng như trước. Các phản hồi AI cũ không có trường này vẫn dùng được.

Responses API bật `tools: [{type: "web_search"}]` với `tool_choice: "auto"` cho phân tích dữ liệu có gửi mẫu và văn bản. Cấu hình theo [tài liệu Web search của OpenAI](https://developers.openai.com/api/docs/guides/tools-web-search). Gateway/model phải hỗ trợ công cụ này; chương trình không tự retry bỏ công cụ khi gateway từ chối. Với máy chủ Codex `/analyze`, body gồm `{ prompt, model }`; prompt cho phép sử dụng công cụ tra cứu do máy chủ cung cấp. Nếu máy chủ không có quyền mạng/công cụ tìm kiếm thì sửa prompt không tự cấp được quyền đó. Sắp xếp và tổ hợp lớp không bật web search. Polygon chỉ gọi `/api/ai/resolve-region-boundary` cho vùng chưa khớp sau MapTiler/nội bộ; danh sách ứng viên mơ hồ vẫn giữ để người dùng chọn. Tra cứu web xác minh tên/quốc gia/cấp hành chính rồi tải GeoJSON thật từ [geoBoundaries gbOpen](https://www.geoboundaries.org/api.html); không dùng polygon do AI tự sinh. Giữ URL nguồn và năm ranh giới, hiện attribution geoBoundaries khi dùng. Không tìm được vùng duy nhất, sai quốc gia/cấp, nguồn lỗi hoặc không có công cụ thì vẫn giữ trạng thái chưa khớp.

Tắt **gửi mẫu** sẽ đặt `geographicLookupAllowed: false`, không bật công cụ web search, không gửi thêm tên địa điểm và không nhận dữ liệu địa lý bổ sung. Bật gửi mẫu chỉ chia sẻ profile hiện có (gồm `distinctValues` tối đa 300 giá trị/cột); chương trình không tự gửi toàn bộ workbook để tra các địa điểm chưa có trong profile. Nên bật gửi mẫu và phân tích lại file để dùng tính năng mới.

## Arc Flow 3D

AI có thể đề xuất `arc_flow` khi mỗi dòng có quan hệ điểm đi → điểm đến, định danh hai đầu, hai cặp tọa độ và lưu lượng. Contract dùng `bindings.source/target/sourceLat/sourceLng/targetLat/targetLng/value`, thêm `time/group` khi có. Các binding phải tham chiếu cột thật; dữ liệu được kiểm tra tại client, không nhận dạng theo tên file hoặc lĩnh vực. Giữ nguyên endpoint phân tích và tùy chọn gửi mẫu; lọc, style và popup không gọi AI lại.

Chọn sheet `Luu_luong_OD` trong `metro_arc_flow_gia_lap.xlsx` để thử 182 OD có hướng giữa 14 điểm, tổng **1.663.830 lượt giả lập**. Mặc định Top 100; có Top 50/250 hoặc tất cả. Bộ lọc gồm điểm đi/đến, thời gian và nhóm dữ liệu. Ô **Thời điểm** chỉ chọn một ngày/kỳ, mặc định **Tất cả** để gộp toàn bộ thời gian. Top N chỉ giới hạn hình vẽ; bảng và CSV dùng toàn bộ OD đang lọc/tổng hợp.

Code tính ngưỡng phân vị 1/3, 2/3 trước Top N: thấp đỏ, trung bình vàng, cao xanh lá; cột phân nhóm gốc không bị thay đổi. Chú giải thể hiện ngưỡng, đơn vị và số mức thực tế. Các OD trùng được tổng hợp theo `agg`/`aggDefault`; thiếu phép gộp thì báo lỗi. Giữ riêng hai chiều và các điểm trùng tên ở tọa độ khác nhau. Chỉ khả dụng khi ít nhất 70% dòng hợp lệ; tọa độ thiếu/sai, lưu lượng thiếu/âm và hai đầu trùng vị trí được thống kê. Giá trị 0 giữ trong bảng, không chạy hạt.

Mỗi nhóm Arc Flow mới được fit ở pitch 55° và bearing 0°, giữ basemap đang chọn. Một `MapLibreOverlay` dùng chung ở cấp workspace; `PathLayer` và `TripsLayer` dùng cùng cung 3D. Module deck.gl tải khi kích hoạt Arc Flow; Vite pre-bundle các dependency để lần đầu mở không tự reload workspace. Điểm và nhãn vẫn là lớp MapLibre thuộc từng dataset. Có style chiều cao/độ dày/độ mờ/tốc độ, công tắc chuyển động/nhãn/chú giải; tắt chuyển động mặc định khi có `prefers-reduced-motion`. Hover làm nổi bật cung, click mở popup OD; click điểm xem tổng vào/ra trước Top N. Popup đóng bằng nút × hoặc khi đổi bộ lọc/nhóm, ẩn hay xóa lớp.

Chiều cao cung mặc định bằng 30% khoảng cách hai đầu (tối thiểu 30 m), nhân hệ số **Chiều cao cung**. Độ lệch ngang của hai chiều đi–về cũng tỷ lệ theo chiều dài tuyến để vẫn phân biệt được ở phạm vi thành phố hoặc toàn quốc. Chiều cao là hiệu ứng trực quan; màu và độ dày tiếp tục thể hiện lưu lượng.

Overlay dùng một đồng hồ chung, dừng khi không còn luồng chuyển động đang hiển thị hoặc tab bị ẩn; phục hồi khi chuyển nhóm/đổi nền. Arc Flow cần WebGL2; nếu không có, giao diện báo chưa khả dụng và các loại bản đồ khác vẫn hoạt động. Chưa ghép sheet tọa độ, xuất PNG hoặc suy ra geometry tuyến thực tế từ OD. Tọa độ thiếu được phép bổ sung qua tra cứu địa lý có nguồn trong lần phân tích AI.

Kiểm thử Arc Flow: `node --test tests/arc-flow-*.test.js`. Bài kiểm thử workbook mẫu chạy khi file Excel đính kèm có trong thư mục gốc; các kiểm thử dữ liệu/contract/UI/vòng đời còn lại dùng fixture độc lập. Toàn bộ kiểm thử: `npm test`; build: `npm run build`.

Ứng dụng hỗ trợ nhiều dataset trong cùng phiên làm việc. Sau mỗi đợt import, mỗi file/sheet được phân tích và giữ cấu hình riêng; AI đánh giá các lớp mới với toàn bộ nhóm hiện có qua `/api/ai/analyze-map-composition`. Các lớp phù hợp được hiển thị chung, lớp chưa phù hợp hoặc chưa đánh giá được trở thành bản đồ riêng. Dữ liệu không bị thay thế khi thêm file mới. Khi AI không khả dụng, ứng dụng giữ các bản đồ riêng và cho phép thử đánh giá lại. Bảng không có geometry hoặc đề xuất bản đồ khả dụng được giữ làm nguồn thuộc tính ở trạng thái **Chờ liên kết**, không tạo lớp bản đồ rỗng.

Trong mục 1, **Bản đồ đang hiển thị** chọn nhóm bản đồ. Mục 3 có tab riêng cho từng lớp khi nhóm có nhiều lớp; đổi tab chỉ đổi cấu hình đang chỉnh. Mục 2, style, bảng dữ liệu và export đi theo lớp được chọn. Bộ lọc, chỉ số, ngày, biểu đồ popup và lưới Polygon được giữ riêng; công tắc hiển thị tại mục 4 áp dụng toàn nhóm. Chú giải và nút chỉ số được trình bày theo lớp; thanh tìm kiếm tổng hợp các lớp được đề xuất tìm kiếm và mở đúng popup của đối tượng được chọn.

Lớp Point và Line không có chỉ số vẫn hiện chú giải với ký hiệu điểm/tuyến theo màu đang dùng. Công tắc **Hiển thị chú giải** áp dụng riêng cho từng lớp, kể cả khi nhiều lớp hiển thị chung.

Mỗi lớp có runtime, DOM control và source/layer MapLibre riêng. Chuyển nhóm tháo resource của nhóm cũ khỏi canvas và giữ dữ liệu/cấu hình trong bộ nhớ; đổi basemap phục hồi lại nhóm đang hiển thị. GeoJSON giữ geometry gốc; AI phân tích metadata và quyết định kiểu hiển thị, chỉ số, popup và tìm kiếm. Mọi dữ liệu dùng cùng luồng phân tích; không có nhận dạng Metro/OSM theo tên file, tự ghép bộ, tính tỷ lệ xe buýt/xe máy hay popup chuyên biệt. JSON chứa nhiều bảng/GeoJSON được tách theo cấu trúc thành các tập độc lập; GeoJSON trộn nhiều loại geometry được tách theo geometry trước khi phân tích. AI quyết định có hiển thị các lớp cùng nhau hay không.

Composition đánh giá cả hiển thị chung lẫn `attributeJoins`. Hồ sơ phân biệt `sourceKind: spatial/attribute` và chứa `popupContent` (tên trường tiêu đề, ảnh, mô tả, địa chỉ, liên kết), cùng đề xuất popup. Composition chỉ gửi metadata đã giới hạn: ID, tên, grain, loại geometry, extent, metadata cột và tóm tắt thời gian/tìm kiếm. Không gửi records, URL ảnh, file hoặc toàn bộ geometry. Tắt **Gửi giá trị mẫu cho AI** tiếp tục loại mẫu khỏi bước phân tích; composition không bổ sung giá trị mẫu. Chuyển nhóm/tab, đổi bộ lọc/style/chỉ số, tìm kiếm và popup không gọi lại AI. Kết quả composition chỉ được áp dụng cho đúng revision dữ liệu; lỗi hoặc kết quả sai giữ dữ liệu thành nhóm riêng. Giới hạn một request composition là 50 lớp; workspace lớn hơn dùng bản đồ riêng cho các lớp mới.


Kiểu popup **Thông tin kèm hình ảnh** (`info_image`) được AI đề xuất cùng `info`, `bar`, `line` trong request phân tích hiện có; xếp hạng theo confidence và giữ lựa chọn của người dùng khi còn khả dụng. `popupContent` chỉ được tham chiếu các cột thực tế, áp dụng cho mọi loại dữ liệu. Chỉ `bar` và `line` có cấu hình biểu đồ. Popup ảnh nền trắng rộng tối đa 360 px, ảnh 4:3, thông tin cuộn, có nút đóng và **Chỉ đường** theo tọa độ điểm. Nhiều ảnh có nút trước/sau, chỉ báo vị trí và phím ←/→/Home/End khi vùng ảnh được focus. Một ảnh ẩn điều hướng; ảnh thiếu/lỗi vẫn đọc được thông tin. Ảnh được tải trực tiếp khi mở popup hoặc chọn ảnh; không có dịch vụ lưu ảnh, truy vấn đánh giá hay giờ mở cửa Google Maps.

Một trường ảnh nhận URL đơn, mảng URL hoặc các URL phân cách bằng xuống dòng/dấu chấm phẩy. URL ảnh có query hoặc chuyển hướng (kể cả Wikimedia `Special:FilePath`) được chấp nhận, không bắt buộc đuôi ảnh; cột liên kết web/Google Maps được chọn riêng. Ảnh và liên kết chỉ nhận HTTP/HTTPS. Tên, mô tả và chuỗi HTML trong dữ liệu đều hiển thị bằng văn bản.

Liên kết thuộc tính hỗ trợ nhập GeoJSON và Excel cùng đợt hoặc lần lượt theo cả hai thứ tự. AI đề xuất `sourceId`, `targetLayerId`, `keyPairs`, `popupContent`, `popupSuggestions`, `confidence`, `reason`; ứng dụng kiểm tra tên cột và so khớp khóa cục bộ sau chuẩn hóa Unicode NFC, hoa/thường, khoảng trắng, **giữ dấu tiếng Việt**, không ghép gần đúng. Khóa đơn hoặc ghép chỉ được áp dụng khi có bản ghi khớp duy nhất một đối tượng; khóa thiếu và mơ hồ được bỏ qua. Trạng thái file cho biết số đối tượng/dòng khớp và chưa khớp, cùng lý do khi liên kết không hợp lệ hoặc AI lỗi.

Quan hệ ghép chỉ nằm trong workspace và phục vụ popup: không ghi đè dữ liệu gốc, thay đổi bảng/export, nhân điểm hay nối qua bảng trung gian. Một lớp nhận được nhiều nguồn thuộc tính; nhiều dòng cùng khóa được gom ảnh không trùng và vẫn giữ từng mục thông tin với nhãn nguồn. Đề xuất popup từ composition được dùng khi nguồn ghép có ảnh. Xóa nguồn gỡ phần thông tin tương ứng, cập nhật popup và các lựa chọn khả dụng; phản hồi AI đến muộn bị bỏ qua khi revision không khớp. Phản hồi AI cũ thiếu metadata mới vẫn hoạt động.

Fixture `tests/fixtures/popup-attributes.js` tạo 5 điểm GeoJSON giả lập và workbook Excel trong bộ nhớ, gồm nhiều dòng cùng khóa, nhiều ảnh/mô tả, khóa rỗng và dòng không khớp; kiểm thử không cần file dữ liệu mẫu bên ngoài. Các kiểm thử bổ sung bao phủ khóa ghép/tên trùng khác địa điểm, nhiều nguồn, xóa nguồn, phản hồi cũ, URL và HTML, chuyển kiểu popup và điều hướng ảnh.

Luồng ghép lớp dùng chung cho mọi lĩnh vực, tên file và tổ hợp Polygon/Line/Point/lục giác; không có danh sách cặp dữ liệu được ghép sẵn. AI quyết định dựa trên hồ sơ, ứng dụng kiểm tra hợp đồng JSON và quyền sở hữu lớp/nhóm. Schema được gửi cả qua `text.format` và trong instructions để các gateway không thực thi structured output vẫn nhận đủ cấu trúc. Các lớp mới được đề xuất cùng nhóm dùng chung `newGroupKey`; `append_to_group` chỉ tham chiếu nhóm đã có. `AI_DEBUG=true` ghi phản hồi composition gốc và kết quả chuẩn hóa ra console để kiểm tra lỗi hợp đồng.

Trạng thái được giữ trong phiên hiện tại, chưa lưu sau reload.

## Template giao diện bản đồ

Mục **Mẫu templates** tải danh sách từ `GET /api/map-templates`. Middleware proxy tới `GET /templates` của server có URL `/analyze` đang cấu hình; API key chỉ nằm phía server. Mẫu nguồn khai báo `id`, `name`, `navigation` (`pan_zoom` hoặc `rotate_3d`) và `description` trong `codex_server/templates/config.json`. Dropdown mặc định là **AI đề xuất theo kiểu bản đồ**: khi có bản đồ, client gửi kiểu bản đồ tới `POST /api/ai/recommend-map-template`; server tự đọc danh mục, lọc mẫu phù hợp và yêu cầu AI chọn một mã. Polygon/choropleth, line và point chọn nhóm `pan_zoom`; nhóm có Arc Flow chọn `rotate_3d`. Nếu AI lỗi, ứng dụng dùng mẫu đầu tiên của nhóm; nếu không có mẫu phù hợp thì giữ bản đồ gốc và cho chọn thủ công. Lựa chọn thủ công được giữ đến khi người dùng chọn lại chế độ AI. Với mẫu nguồn như `mau_01`, client gọi thêm `GET /api/map-templates/mau_01` để nhận `html`, `css`, `js` từ `GET /templates/mau_01`. Danh sách vẫn hỗ trợ cấu hình màu/font cũ (`styles`, `typography`) để chọn thủ công.

JS của mẫu không được thực thi. GeoMap Builder áp dụng `navigation` lên MapLibre đang chạy: `pan_zoom` đưa camera về 2D và khóa xoay/nghiêng; `rotate_3d` bật lại xoay/nghiêng.

AI đọc mã nguồn mẫu như tài liệu tham chiếu thiết kế và xử lý nội bộ theo ba bước: trích xuất quy chuẩn → ánh xạ vùng chức năng → sinh giao diện cho bản đồ hiện tại. Quy chuẩn gồm màu giao diện, kiểu chữ, khoảng cách, đường viền, bo góc, bóng, thứ bậc thị giác và bố cục desktop/mobile. AI tự thiết kế bố cục phù hợp, được thay thứ tự, nhóm vùng, đổi sidebar thành control nổi hoặc ngược lại; mẫu cung cấp ngôn ngữ thiết kế thay vì cấu trúc bắt buộc. Client gửi kích thước vùng bản đồ thật, số lượng/nhãn chỉ số, tiêu đề chú giải và khả năng tìm kiếm qua `layoutContext`; không gửi bản ghi dữ liệu cho bước bố cục. HTML/CSS bố cục có thể được viết mới. Popup đường và cột dùng renderer Recharts gốc của ứng dụng; AI chỉ áp dụng màu nền/chữ/viền và font qua biến `--template-*`, trả `components: []`. Trục ngày, tooltip có đơn vị, chú giải, dữ liệu thiếu/giá trị 0 và thu/phóng của biểu đồ cột dùng chung hành vi với bản đồ gốc. Tìm kiếm, chỉ số, chú giải và popup dùng chung quy chuẩn; dữ liệu, tiêu đề biểu đồ và màu biểu diễn dữ liệu tiếp tục lấy từ ứng dụng. Nội dung minh họa và tiêu đề không phù hợp dữ liệu thật được loại bỏ. Contract đầu ra vẫn là `{html, css, components}`. Khi bố cục không dùng được, client tự gửi HTML/CSS vừa thử cùng kích thước slot/wrapper đo trong trình duyệt qua `repair`; AI có tối đa hai lượt tự sửa trong cùng trạng thái chờ. Chỉ bản đã kiểm tra hiển thị thành công mới được cache ở client. Cache phân biệt kích thước vùng hiển thị và yêu cầu sửa luôn bỏ qua cache server. Chất lượng áp dụng thiết kế cần được đánh giá bằng phản hồi AI thật; kiểm thử với phản hồi giả lập chỉ xác nhận tích hợp.

Khi có lớp dữ liệu đã được AI phân tích, `POST /api/ai/compose-map-template` đọc mẫu trên server và yêu cầu AI trả bố cục HTML/CSS và biến giao diện cho biểu đồ gốc. Ứng dụng kiểm tra kết quả rồi chuyển canvas MapLibre, tìm kiếm, nút chỉ số, chú giải và điều khiển hiện có vào vị trí do AI ghép; không tải lại hoặc tạo bản đồ riêng. Số nút, màu và ngưỡng chú giải, kiểu/nội dung popup vẫn theo kết quả phân tích dữ liệu. JS của mẫu và component biểu đồ cũ không được thực thi; popup đường/cột hiển thị trực tiếp bằng renderer gốc, không có iframe hoặc thanh cuộn riêng bên trong biểu đồ. Trong khi ghép mẫu, chỉ hiển thị bản đồ nền có thể tương tác, nút thu/phóng, ghi công và thông báo chờ ở giữa bản đồ, dùng chung style với thông báo trạng thái. Lớp dữ liệu (kể cả Arc Flow), tìm kiếm, nút chỉ số, chú giải, popup và vùng tô sáng tìm kiếm được tạm ẩn; mẫu đang hiển thị được tháo khỏi vùng bản đồ trong thời gian chờ. Khi ghép xong, khôi phục lớp dữ liệu và các control trong mẫu; nếu ghép lại bị lỗi thì khôi phục mẫu trước đó. Trạng thái ẩn/hiện do người dùng chọn và nội dung dữ liệu không bị thay đổi. Mẫu mới chỉ được áp dụng sau khi kiểm tra kích thước/khả năng hiển thị của vùng bản đồ cùng canvas. CSS kích thước của khung bản đồ do lõi ứng dụng quản lý. Kết quả chỉ được cache ở client sau khi kiểm tra hiển thị thành công; bố cục làm ẩn/co vùng bản đồ được tự gửi lại cho AI với số đo thật. Nếu các lượt tự sửa vẫn không dùng được hoặc dịch vụ AI lỗi, ứng dụng khôi phục bản đồ trước đó và cho phép thử lại; không hiện lỗi kích thước kỹ thuật ngay sau lượt đầu. Panel đang ẩn sẽ chờ có kích thước trước khi gọi AI. Khi đổi kích thước màn hình làm bố cục đang dùng bị hỏng, renderer cũng tự yêu cầu sửa theo viewport mới. Thử lại sau lỗi sẽ yêu cầu AI ghép lại, bỏ qua kết quả lỗi trong cache server. Không có dữ liệu thì không hiện bản mẫu tĩnh.
Mỗi slot quản lý vị trí và khung của control. Khi ghép, renderer bỏ offset/transform và khung nền cũ của control; màu chữ được kế thừa từ mẫu. CSS của mẫu được ưu tiên hơn CSS giao diện gốc trong phạm vi shell, kể cả quy tắc mobile và pseudo-element. Gradient, swatch dữ liệu và trạng thái `[hidden]` được giữ nguyên. Kiểm tra browser dùng CSS thật của ứng dụng để phát hiện lệch vị trí và chồng khung.

Ngay khi bấm **Phân tích**, bản đồ dùng một thông báo chung **Đang phân tích và áp dụng template**, giữ xuyên suốt đọc/phân tích dữ liệu, ghép lớp và áp dụng template. Các cập nhật trạng thái trung gian không thay câu này hoặc kết thúc thông báo sớm khi template còn đang chạy; không tạo thông báo nổi riêng cho template. Khi công việc hoàn tất, thông báo trở lại trạng thái kết quả xử lý dữ liệu. Lỗi template **Không ghép được…** cùng nút thử lại chỉ hiển thị trong sidebar.

Khối chỉ số mặc định co theo nội dung, tiêu đề/số lượng/mũi tên nằm trên một hàng, nhãn dài xuống dòng và danh sách dài cuộn dọc; AI tiếp tục quyết định màu, font và hướng bố trí theo template. Mẫu dùng chip nổi không được tự thêm panel nền rộng hoặc kéo từng chip thành cột lấp đầy bản đồ. Trước khi áp dụng và cache, renderer đo cả control ở trạng thái hiển thị: khung chỉ số chồng lên hơn 60% chiều rộng bản đồ và hơn 15% diện tích sẽ bị từ chối (30% diện tích khi vùng bản đồ rộng tối đa 600 px để cho phép chip xuống dòng). Sidebar nằm ngoài vùng bản đồ không chịu giới hạn này. Khung quá lớn được gửi lại cho AI tự thiết kế gọn hơn bằng cùng cơ chế phản hồi đo thật; nếu vẫn lỗi thì khôi phục mẫu trước; kiểm thử browser bao phủ ba chip ngắn, nhiều nhãn dài, thu gọn/mở rộng và giữ màu dữ liệu trên desktop/mobile.
Danh sách chỉ số mặc định là flex hàng có xuống dòng; template xếp dọc cần khai báo hướng cột. Nếu khối chỉ số nổi neo phía trên chồng lên tìm kiếm, renderer đẩy nó xuống dưới toàn bộ khối tìm kiếm, gồm cả select khu vực, và cập nhật khoảng cách khi kích thước control hoặc vùng bản đồ thay đổi. Bố cục sidebar và control neo phía dưới giữ vị trí do template quyết định.

Nếu `OPENAI_BASE_URL` trỏ đến Codex server cục bộ, CLI phải đăng nhập (`codex.cmd login` trong PowerShell) để `/analyze` có thể ghép mẫu; khởi động uvicorn riêng không đăng nhập CLI.

Contract của mẫu màu/font cũ:

```json
{
  "styles": {
    "colors": {
      "background": "#FFFFFF", "surface": "#FFFFFF", "text": "#222222",
      "textSecondary": "#666666", "border": "#DDDDDD", "accent": "#D77A99"
    },
    "layout": { "borderRadius": "10px", "spacing": "12px" }
  },
  "typography": {
    "fontFamily": "Arial, Helvetica, sans-serif",
    "headingFontFamily": "Merriweather, Georgia, serif",
    "sizes": { "body": "16px", "popup": "14px", "legend": "13px", "label": "12px", "heading": "20px", "title": "24px" },
    "weights": { "normal": 400, "semibold": 600, "bold": 700 },
    "lineHeight": 1.55
  }
}
```

Với mẫu màu/font cũ, frontend kiểm tra và chuyển các giá trị thành biến `--template-*` trên workspace. CSS dùng chung áp dụng cho popup thông tin/ảnh/biểu đồ, chú giải, tìm kiếm và điều khiển trên bản đồ. `background` là nền khung, `surface` là nền thành phần bên trong; trạng thái hover/active phối từ `surface` và `accent`. Bóng mặc định được suy ra từ màu chữ; template có thể đặt `layout.shadow` bằng `none` hoặc 2–4 độ dài cùng màu hex. Mã nguồn HTML/CSS/JS gốc của mẫu không được đưa trực tiếp vào trang hoặc thực thi; ứng dụng chỉ áp dụng kết quả do AI tạo sau khi kiểm tra.

`typography.fontFamily` dùng cho nội dung, thẻ `p`, nhãn, nút và ô nhập liệu. `typography.headingFontFamily` dùng cho `h1`–`h6`, tiêu đề popup, biểu đồ và chú giải; nếu thiếu thì dùng lại `fontFamily` để tương thích template cũ. Hai giá trị lần lượt được chuyển thành `--template-font` và `--template-heading-font`.

Đổi mẫu màu/font áp dụng ngay, kể cả popup/biểu đồ đang mở và lớp được thêm sau đó, không gọi lại AI hoặc dựng lại biểu đồ. Các contract AI (`legend`, `popupSuggestions`, `popupContent`, `search_bar`, `search_fields`, `metricButtons`) giữ nguyên: AI vẫn đề xuất thang màu/ngưỡng, kiểu và nội dung popup, tìm kiếm, nhãn/icon/màu icon chỉ số. Template màu/font không đổi màu dữ liệu, basemap, bộ lọc hay lựa chọn người dùng. Nếu tải cấu hình lỗi, giao diện hợp lệ gần nhất được giữ và có nút thử lại; lựa chọn chỉ được giữ trong phiên hiện tại.

Kiểm thử: `node --test tests/map-template*.test.js`, `npm run test:templates:browser` và `npm run test:template-composition:browser` (Chrome/Chromium); thêm `-- --mobile` để kiểm tra viewport 390 × 844. Kiểm tra trình duyệt bao phủ các kiểu popup, typography, tooltip biểu đồ, chuyển Light/Dark, màu dữ liệu/icon, lớp tạo mới, màn hình nhỏ và lỗi tải cấu hình. Khi cập nhật API Python ở dự án `codex_server`, cần khởi động lại tiến trình uvicorn nếu không dùng `--reload`.

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

Nếu dùng server Codex có endpoint `POST /analyze`, đặt URL đầy đủ:

```env
OPENAI_API_KEY=your_codex_server_api_key
OPENAI_MODEL=gpt-5.6-luna
OPENAI_BASE_URL=http://127.0.0.1:8000/analyze
```

Ứng dụng nhận diện URL kết thúc bằng `/analyze`, gửi key qua `x-api-key` và body gồm `{ prompt, model }`; đọc kết quả từ `{ success: true, result }`. Prompt chứa instructions, schema riêng của từng tác vụ và dữ liệu đầu vào cho phân tích bảng, văn bản, tổ hợp hoặc sắp xếp lớp. Trường `model` lấy từ `OPENAI_MODEL` trong `.env`; nếu biến không có hoặc rỗng thì dùng `gpt-5.6-luna` cho cả `/analyze` và Responses API. Không gửi `mode`, `output_format` hay `input` ở cấp body của `/analyze`. Server `/analyze` cần hỗ trợ trường `model`. Những base URL khác vẫn gọi OpenAI Responses API tại `${OPENAI_BASE_URL}/responses`. Khởi động lại `npm run dev` sau khi đổi `.env`.

Phản hồi JSON được chấp nhận khi trả trực tiếp hoặc bọc toàn bộ trong một khối Markdown JSON. JSON sai cú pháp bị từ chối sau một request, không tự sửa nội dung hoặc gọi lại AI. Thông báo lỗi cho biết server trả kết quả lỗi và vị trí lỗi nếu có. Khi bật `AI_DEBUG=true`, phản hồi sai được ghi ở mục `AI invalid JSON debug` trên console server để kiểm tra; mặc định không ghi nội dung này.

### AI Chart Pipeline v2 và quyền riêng tư

Để đánh giá prompt trên các tập dữ liệu, đặt `AI_DEBUG=true` trong `.env` rồi khởi động lại server. Log phân tích ghi đầu vào, phản hồi AI gốc và kết quả sau kiểm tra; không in instructions. Với TXT/DOCX, debug chỉ gồm `text`, `rawOutput` và `normalizedOutput`; với dữ liệu bảng, đầu vào là `profile`. Tùy chọn gửi mẫu vẫn được tôn trọng cho dữ liệu bảng. Kiểm thử tự động dùng phản hồi AI mô phỏng để kiểm tra luồng; chất lượng prompt cần đánh giá bằng các lượt gọi AI thực tế.

Composition hiện chỉ quyết định các lớp hiển thị chung; không join bảng, tính chỉ số mới hay đồng bộ thời gian giữa các tập dữ liệu. Bảng chỉ có khóa tham chiếu sang geometry ở file khác sẽ giữ nguyên nếu chưa có bindings hiển thị hợp lệ; ứng dụng không tự ghép theo tên cột hay tên bộ dữ liệu.

Excel (`.xlsx`, `.xlsm`, `.xls`)/CSV được parse và profile trong Web Worker bằng package SheetJS đi cùng source. Excel nhiều sheet hiện bộ **Chọn bảng (sheet) để phân tích** ngay trong danh sách tệp, không phải chờ tải nền bản đồ. Mỗi file giữ lựa chọn riêng; chọn bảng rồi bấm **Phân tích bảng đã chọn** mới gửi bảng đó cho AI. File một sheet vẫn xử lý trực tiếp. Raw records vẫn nằm trong trình duyệt; server không lưu dataset và không nhận toàn bộ file.

Nếu các dòng đầu là tiêu đề báo cáo, ghi chú, dòng trống hoặc thống kê nhãn–số, bộ đọc tìm hàng tên cột đầy đủ trong 100 dòng đầu của sheet. Tiêu đề ghép ngang toàn bảng được bỏ qua; dữ liệu bắt đầu từ hàng ngay sau tên cột và giữ nguyên kiểu ô, giá trị 0 và ô trống. Header ghép nhiều tầng hoặc thiếu tên cột vẫn cần chuẩn hóa trước khi nhập.

Tùy chọn **“Gửi giá trị mẫu cho AI”** mặc định bật và chỉ áp dụng cho dữ liệu bảng (Excel/CSV/JSON và thuộc tính GeoJSON). Request AI chứa tên cột, kiểu suy luận, thống kê như tỷ lệ null, số giá trị phân biệt, min/max cùng tối đa 5 mẫu cho mỗi cột và 8 dòng đầu; chuỗi mẫu được loại control character và cắt ở 160 ký tự. Cột văn bản có tối đa 300 giá trị ngắn (mỗi giá trị tối đa 500 ký tự) còn gửi `distinctValues` đầy đủ. `scopeRows` bổ sung tối đa 100 dòng có giá trị chứa hậu tố/dấu ngoặc để AI đọc điều kiện cùng dòng ngoài phần đầu bảng; mỗi ô văn bản giới hạn 1.600 ký tự, có cờ khi danh sách dòng bị giới hạn. AI dùng các giá trị và dòng này để nhận diện cấp quan sát, quan hệ địa lý và phạm vi ngoại lệ. Khi tắt tùy chọn này, request không có `samples`, `head`, `distinctValues` hoặc `scopeRows`.

Polygon hỗ trợ `suggestions[].geographicScopes` cho cột trộn nhiều phạm vi. AI chọn `boundary` để tra đúng vùng con với quốc gia cha, `marker` cho ký hiệu điều kiện như quá cảnh, hoặc `unresolved` khi chưa đủ căn cứ. `geometryPart: largest` chỉ dùng khi dữ liệu chỉ rõ đảo/khối đất chính, giữ phần polygon lớn nhất và loại các phần đảo xa. Ví dụ Hải Nam chỉ tô đảo Hải Nam; quá cảnh Trung Quốc dùng nguồn điểm `scope-marker-data` riêng, hiện một vòng tròn nhỏ không có nhãn trên bản đồ, không tô Trung Quốc. Chú giải hiện thêm một dòng với ký hiệu tròn cùng kiểu và tên **Quá cảnh Trung Quốc - lớp riêng**. Bấm vòng tròn để xem điều kiện áp dụng; không có bảng điều khiển ký hiệu riêng. Không tìm được vùng con thì giữ trạng thái chưa khớp; giá trị có hậu tố thiếu quyết định phạm vi không tự ghép vào quốc gia cha. Popup, tìm kiếm, bộ lọc và phân loại giữ từng dòng gốc; marker và vùng con không bị gộp theo cùng mã quốc gia. Quy tắc áp dụng cho mọi quốc gia và lĩnh vực, trong cùng request phân tích hiện có.

Ứng dụng nhận thêm **TXT (UTF-8, có hoặc không có BOM)** và **Word DOCX** qua chọn file hoặc kéo thả nhiều file cùng các định dạng hiện có. DOCX dùng Mammoth tải khi cần để trích văn bản trong Web Worker; không chuyển nội dung thành HTML và không đọc số liệu trong ảnh. File `.doc` cũ cần mở bằng Word rồi lưu thành `.docx`. PDF và tài liệu scan chưa được hỗ trợ.

TXT/DOCX gửi **toàn bộ văn bản trích xuất** tới AI, kể cả khi tắt gửi mẫu. Giới hạn là **50.000 ký tự**, được kiểm tra ở trình duyệt và server; tài liệu vượt giới hạn bị từ chối, không cắt ngắn. File gốc không gửi lên server và không lưu dataset. Dữ liệu Excel/CSV/JSON vẫn dùng parser và prompt hiện tại.

Văn bản đi qua `POST /api/ai/analyze-map-text` với `{ text, source }`. Một lượt gọi AI dùng prompt riêng để trả bảng `fields`/`rows` cùng `analysis` theo hợp đồng chung. Server kiểm tra bảng, chuyển thành records, tạo profile và chuẩn hóa metadata; trả `{ records, analysis }`. Client chuẩn hóa số/thời gian rồi dùng cùng pipeline bản đồ, chú giải, nút chỉ số, tìm kiếm và popup. Không gọi lại prompt phân tích bảng; composition nhiều lớp vẫn là bước riêng. Không có dữ liệu thì báo rõ; bảng hợp lệ nhưng đề xuất lỗi vẫn được giữ trong workspace.

Prompt TXT/DOCX thu thập mọi chỉ số trong câu/đoạn và cho phép suy diễn số khi quan hệ định lượng trong tài liệu xác định duy nhất kết quả: chênh lệch tuyệt đối, tăng/giảm phần trăm, điểm phần trăm, tỷ lệ, bội số, quan hệ ngược và chuỗi tham chiếu kể cả khi mốc nằm phía sau. Ví dụ Hà Nội 29°C, độ ẩm 82%, mưa 180mm; Hải Phòng thấp hơn 1°C, độ ẩm 85%, mưa cao hơn 15% → Hải Phòng **28°C, 85%, 207mm**. Giá trị suy diễn giữ đơn vị của chỉ số, được đưa vào bảng và metadata như số liệu trực tiếp. Chỉ số thiếu mốc, mơ hồ hoặc mâu thuẫn giữ `null`, các chỉ số xác định được vẫn giữ nguyên. Đây là suy diễn của AI trong lượt trích văn bản; server kiểm tra cấu trúc, không tự tính lại các quan hệ.

Prompt giữ số liệu trực tiếp, đơn vị và kỳ quan sát được nêu rõ, không tự thêm năm/tọa độ. Tháng có năm dùng `YYYY-MM`; mỗi đối tượng ở mỗi kỳ quan sát có một dòng, tổng hợp đủ các chỉ số từ những câu/đoạn cùng ngữ cảnh.

Prompt thống nhất các cách diễn đạt của cùng đại lượng thành một cột, giữ nguyên nhân/loại/phạm vi/ngoại lệ đơn lẻ trong **Ghi chú** kiểu văn bản thay vì tạo thêm chỉ số và nút bản đồ trùng nghĩa. Không biến số của một phân nhóm thành tổng đầy đủ hoặc cộng trùng vào tổng; các chỉ số tổng và phân nhóm thực sự được so sánh độc lập vẫn có cột riêng. Phân biệt số được báo cáo, thiếu dữ liệu (`null`) và không ghi nhận (`0`) theo đúng phạm vi; năm xuất bản hay mốc lịch sử trong ghi chú không tự tạo quan sát mới.

Kiểm thử ngữ nghĩa với AI thực tế: `npm run eval:text` (dùng API/model trong `.env`, có gọi API). Các ca gồm báo cáo sốt rét có chú thích phân nhóm, báo cáo nhà máy với nguyên nhân đơn lẻ và bảng so sánh tổng–phân nhóm độc lập. Kiểm thử unit dùng phản hồi giả để kiểm tra truyền dữ liệu/metadata/popup; chúng không thay thế kiểm thử chất lượng trích xuất của model.

Mỗi dataset tạo một request phân tích nội dung OpenAI; đánh giá tổ hợp giữa các dataset là bước riêng theo từng đợt import. Server tự đưa registry được phép vào prompt, coi tên cột và mẫu là dữ liệu không tin cậy, rồi kiểm tra structured output trước khi trả về client. Đầu vào hỗ trợ bốn kiểu bản đồ:

- `choropleth`: **Bản đồ Polygon**, theo khu vực hành chính như tỉnh/thành phố.
- `map_line`: **Bản đồ Line**, theo tên đường hoặc chuỗi tọa độ.
- `point`: **Bản đồ Point**, theo tọa độ của từng đối tượng.
- `arc_flow`: **Bản đồ Arc Flow 3D**, theo lưu lượng có hướng giữa hai điểm có tọa độ.

AI quyết định mức phù hợp, role, bindings, đơn vị, phép gộp, chỉ số và thứ tự ưu tiên của từng kiểu bản đồ. Client chỉ kiểm tra cấu trúc phản hồi, tên cột và khả năng render; không sửa role theo tên cột, không bổ sung Polygon/Line/Point hoặc biểu đồ khi AI bỏ sót, không tự ưu tiên kiểu bản đồ theo lĩnh vực. Điểm hiển thị giữ nguyên confidence của AI, tách biệt với độ phủ/khả năng ghép geometry. AI trả `suggestions: []` thì không dựng bản đồ, kể cả khi GeoJSON có geometry sẵn. AI lỗi hoặc phản hồi không hợp lệ giữ dữ liệu và hiển thị lý do, không tạo đề xuất thay thế. Cột thiếu metadata được giữ ở trạng thái chưa phân loại.

Khi bảng có nhiều cấp địa lý, AI dùng tên cột và dữ liệu mẫu để chọn cấp phản ánh từng quan sát. Dữ liệu theo khu vực thuộc các quốc gia ưu tiên vẽ khu vực; dữ liệu chỉ ở cấp quốc gia thì vẽ quốc gia. Các cấp cha dùng làm ngữ cảnh tra ranh giới và bộ lọc. Từng khu vực được tra bằng tên cùng các cấp cha và quốc gia của chính dòng đó; các vùng trùng tên thuộc những cấp cha khác nhau được tách riêng khi ghép dữ liệu và hiển thị popup. Tra khu vực ngoài Việt Nam dùng phạm vi quốc gia tương ứng và không áp bbox Việt Nam; dữ liệu địa phương cục bộ là nguồn dự phòng khi có.

Polygon, Line và Point vẫn dựng được khi không có chỉ số đo lường. Polygon/Line có thể tô theo cột phân loại phù hợp; khi không chọn cả chỉ số lẫn phân loại thì dùng màu mặc định đang cấu hình, Point dùng kích thước mặc định, ẩn thang màu và các nút chỉ số không áp dụng. Polygon chỉ cần một ranh giới hợp lệ; Line theo tên vẫn cần ghép đúng mạng đường, Point và Line theo tọa độ vẫn kiểm tra tọa độ. `bindings.value: null` không tạo chỉ số đếm/STT/mã thay thế. Khi đã chọn trường tô màu, giá trị thiếu (kể cả cột toàn `null`) không được tô màu và vẫn có trong dữ liệu tìm kiếm; `0` là giá trị hợp lệ.

Với Polygon phân loại, AI chọn cột `category` (ví dụ “Cấp độ tiếp cận”) làm `bindings.value`, giữ `agg: null` và đề xuất `legend.type: categorical`. `stops` ánh xạ nguyên văn từng giá trị sang màu HEX; `combinations` gán màu riêng cho từng tập nhiều giá trị. Cùng một quốc gia có nhiều phân loại được vẽ một vùng bằng màu tổ hợp và có chú giải “Bao gồm … và …”; không tô chồng, chọn dòng đầu hay tự pha màu. Các dòng cùng giá trị dùng chung màu đơn. Màu đơn và màu tổ hợp đều do AI cung cấp trong cùng lượt phân tích. Profile có `categoryValues` đầy đủ cho cột văn bản ít giá trị và `categoryGroups` tóm tắt các tổ hợp theo cùng địa danh và phạm vi; các hậu tố phạm vi khác nhau không bị gộp theo quốc gia cha; hai trường này chỉ gửi khi bật dữ liệu mẫu. Bộ lọc cập nhật màu/chú giải bằng metadata hiện có, popup và tìm kiếm giữ từng nhãn nguồn. Tổ hợp chưa được AI gán màu giữ trạng thái thiếu màu và hiện lý do, không tự chọn màu thay thế.

Tên quốc gia có chú thích sau `—`, `–`, ` - ` hoặc ngoặc cuối tên cần quyết định `geographicScopes` trước khi tra hình học; không tự bỏ chú thích để lấy ranh giới quốc gia cha. Dấu gạch nối trong tên như `Guinea-Bissau` được giữ nguyên. Tên và mã quốc gia thuần túy vẫn dùng cache theo quốc gia chuẩn; các nhãn cùng phạm vi giữ thông tin nguồn trong popup. Vùng con và ký hiệu điều kiện có định danh riêng; tìm kiếm giữ nhãn gốc cùng ngữ cảnh quốc gia. Các dòng có chỉ số tiếp tục dùng phép gộp khai báo trong metadata, không tự cộng vì cùng quốc gia cha.

Dropdown khu vực cạnh ô tìm kiếm dùng `administrative_division/COUNTRY_REGIONS/country_regions.json` làm nguồn ghép quốc gia → châu lục/tiểu vùng. File chứa ISO3, ISO2, tên và phân vùng; bộ ghép nhận tên Việt/Anh, bí danh và tên có chú thích, giữ nguyên nhãn trong dữ liệu nguồn. Profile gửi thêm `columns[].countryRegions` với độ phủ nhận diện, số quốc gia duy nhất và các ID khu vực hiện có khi bật **Gửi giá trị mẫu cho AI**; tắt tùy chọn này không gửi thống kê khu vực suy ra từ giá trị.

Trong cùng lượt phân tích, AI trả `regionNavigation: {countryField, regions}` hoặc `null`. `countryField` phải là cột `geo/country`; `regions` dùng ID có sẵn như `subregion:South-eastern Asia`, `region:Asia`. Dropdown mặc định **Toàn thế giới**, có các khu vực AI chọn với nhãn **Đông Nam Á**, **Châu Á**… Chọn một khu vực chỉ đưa các nước thuộc khu vực đó vào nguồn vẽ và kết quả tìm kiếm; bảng dữ liệu/export cũng theo khu vực đã chọn. Chọn **Toàn thế giới** khôi phục toàn bộ dữ liệu theo các bộ lọc hiện tại. Nguồn dữ liệu gốc được giữ nguyên; đổi chỉ số, bộ lọc khác hoặc nền bản đồ tiếp tục giữ bộ lọc khu vực. Lựa chọn được giữ riêng theo nhóm bản đồ, không gọi lại AI/geocoding. Các khu vực khác vẫn nằm trong dropdown để chuyển trực tiếp; giao diện vẫn có thể hiện dropdown khi AI tắt tìm kiếm. Output AI cũ thiếu cấu hình này không tự tạo dropdown thay thế. File phân vùng nhỏ được lưu trong source; các file ranh giới lớn tiếp tục được gitignore.

Thời gian dùng bộ xử lý chung cho profile, chuẩn hóa, sắp xếp và lọc khoảng. Hỗ trợ Date, ISO, Excel serial, Unix, ngày dạng `dd/mm/yyyy` trong chế độ text, tháng/quý/tuần có hoặc không có năm và tên tháng tiếng Anh. Kỳ không có năm giữ nhãn gốc; không tự bổ sung năm. Chuỗi lẫn kỳ không có năm và ngày có năm được báo chưa tương thích; giá trị không nhận diện được không bị đoán thành ngày. Schema hỗ trợ granularity `day`, `week`, `month`, `quarter`, `year`.

Với Polygon, Line và Point, mục 2 chỉ liệt kê các kiểu bản đồ. Trong cùng request phân tích, mỗi `suggestions[]` trả `popupSuggestions` gồm 1–5 phần tử có `name` (`info`, `info_image`, `bar`, `line`, `pie`), `confidence` từ 0 đến 1 và `pie` (bindings cho biểu đồ tròn; null với kiểu khác). AI đánh giá dữ liệu của một đối tượng theo grain/bindings: ưu tiên tròn khi các nhóm thể hiện tỷ lệ/tỷ trọng của cùng một tổng thể 100%; ưu tiên đường cho chuỗi thời gian; cột cho so sánh độ lớn; thông tin cho mô tả. Tên nhóm, giá trị, chú giải và tiêu đề lấy từ dữ liệu thực tế, không gắn với dữ liệu minh họa hay lĩnh vực cụ thể. Mục 3 chỉ hiện kiểu được AI đề xuất, xếp theo confidence và mặc định chọn kiểu khả dụng đứng đầu. Client không tự bổ sung hoặc đổi thứ tự đề xuất.

Danh sách thiếu, rỗng, lỗi hoặc không còn kiểu khả dụng chỉ hiện **Thông tin dự phòng**, không gán điểm AI; output cũ cũng dùng cách này. Kiểu đường thiếu cột thời gian hoặc chỉ số đo hợp lệ bị vô hiệu hóa kèm lý do nếu còn kiểu khác khả dụng. Lựa chọn và cấu hình popup được giữ riêng theo bản đồ, không bị ghi đè khi đổi chỉ số/bộ lọc hoặc mở đối tượng khác. Đối tượng thiếu số liệu hoặc khoảng thời gian rỗng giữ kiểu đã chọn và hiện giải thích trong popup. Khi chọn cột/đường/tròn, popup chỉ hiển thị biểu đồ, ẩn phần thông tin phía trên. Các điều chỉnh chỉ hiện khi chọn cột/đường/tròn. Khoảng thời gian biểu đồ độc lập với bộ lọc bản đồ; cột/đường mặc định bao phủ toàn bộ dữ liệu, tròn mặc định dùng mốc mới nhất để không cộng tỷ lệ qua nhiều thời điểm. Bộ dữ liệu mới chọn lại mặc định từ đề xuất mới. Tương tác popup không gọi thêm AI. Popup tròn dùng donut, bảng giá trị/tỷ trọng có tổng 100%, chú giải màu và tooltip số lượng/phần trăm. `popupSuggestions[].pie` khai báo `groupField`, `valueField`, `measureFields`, `excludedValues`, `title`, `palette`: dữ liệu theo dòng chọn nhóm + giá trị (hoặc đếm bản ghi), dữ liệu theo cột chọn ít nhất hai thành phần cùng đơn vị. Màu lát, chú giải và tooltip lấy từ `pie.palette` (2–64 màu HEX khác nhau do AI đề xuất trong cùng request phân tích hoặc composition); renderer không còn bảng màu cố định. Màu từng thành phần giữ ổn định theo miền nhóm/cột của toàn bộ dữ liệu khi lọc, đổi đối tượng hoặc đổi template. Đề xuất cũ thiếu bảng màu hoặc bảng màu không hợp lệ hiện yêu cầu phân tích lại dữ liệu. AI chỉ rõ dòng tổng/phụ tổng cần loại qua `excludedValues`; code không dò tên nhóm hoặc tên dòng tổng. Người dùng có thể đổi nhóm/chỉ số/phép gộp và nhóm đưa vào tổng thể trong phần điều chỉnh. Giá trị âm, thiếu số liệu, tổng bằng 0, các chỉ số khác đơn vị hoặc tỷ lệ phần trăm không tạo tổng 100% sẽ hiện giải thích, không ép thành biểu đồ. Code renderer nằm tại `src/charts/pie-chart.js`; xử lý dữ liệu tại `src/shared/popup/pie-chart-data.js`. Polygon vẫn hỗ trợ lưới lục giác kế thừa dữ liệu của vùng; H3 từ tọa độ không còn là một kiểu đầu vào riêng.

Popup thông tin hiển thị tên bộ dữ liệu từ `datasetTitle` (dự phòng bằng tên file input), bên dưới là tên quốc gia/đối tượng. Các trường phân loại dạng thẻ vẫn hiện nhãn cột từ metadata input, ví dụ **Khu vực**, **Cấp độ tiếp cận**, cùng giá trị tương ứng. Với nhiều bản ghi của một quốc gia, tên bộ dữ liệu hiện một lần ở đầu và từng mục giữ nhãn, nội dung gốc.

Thanh tìm kiếm trên bản đồ mặc định ẩn khi chưa có dữ liệu. Trong cùng request phân tích file, AI trả thêm `search_bar` (boolean bật/tắt mặc định) và `search_fields` (mảng tên cột gốc theo thứ tự: định danh chính trước, ngữ cảnh hỗ trợ sau). AI đánh giá số đối tượng duy nhất và lợi ích tìm nhanh, không áp ngưỡng `uniqueCount >= 30` cứng hoặc dựa vào số dòng/ngày/cột đo lường. Ví dụ thời tiết theo khu vực dùng `["Khu vực", "Quốc gia"]`, tuyến dùng `["Tên đường"]`, cửa hàng dùng `["Tên cửa hàng", "Thành phố"]`; thiếu tên có thể dùng mã đối tượng.

Khi ghép nhiều lớp, tìm kiếm giữ cấu hình hợp lệ của từng file và gộp kết quả của các lớp đang hiển thị. Composition không tắt tìm kiếm của một lớp chỉ vì bỏ sót ID trong `searchLayerIds`; ứng dụng bổ sung các lớp có cấu hình tìm kiếm hợp lệ từ hồ sơ đầu vào. `search_bar: false` và các trường không hợp lệ vẫn được tôn trọng. Kết quả kèm tên lớp; chọn kết quả sẽ chuyển tới đối tượng và tab của lớp sở hữu, đóng popup đang mở.

Backend và frontend chỉ chấp nhận các tên cột có thật, không trùng nhau, thuộc role địa danh/tên/phân loại/mã/văn bản; loại cột đo lường, thời gian, tọa độ và metadata nội bộ. Trường đầu tiên xác định nhãn chính; khi đổi bản đồ, ứng dụng điều chỉnh theo cột địa lý/tuyến đang vẽ bằng metadata hiện có. Không có trường hoặc đối tượng hợp lệ thì ẩn. `search_bar: false` giữ thanh tìm kiếm ẩn ngay cả khi danh sách trường hợp lệ. Output cũ thiếu `search_fields` tiếp tục dùng các trường tìm kiếm hiện có; thiếu `search_bar` giữ hành vi cũ là hiện khi có dữ liệu tìm được. Giao diện hiện chưa có công tắc ghi đè bật/tắt thủ công.

Số đối tượng được đếm theo giá trị định danh đã bỏ khoảng trắng đầu/cuối, bỏ trống/null; không nhân số đếm vì nhiều quan sát hoặc đoạn đường. Các cột địa lý ngữ cảnh được dùng cùng tên để phân biệt đối tượng trùng tên. Tìm không dấu và bí danh chỉ phục vụ so khớp truy vấn, không gộp đối tượng khi đếm. Nếu bộ lọc làm giảm tập đối tượng và còn dưới 5 đối tượng duy nhất, thanh tìm kiếm tạm ẩn, vô hiệu hóa ô nhập và xóa truy vấn/kết quả cũ; bỏ lọc đủ điều kiện thì hiện lại theo đề xuất ban đầu. Ngưỡng này cấu hình bằng `CONFIG.DATA_SEARCH_MIN_FILTERED_OBJECTS` trong `src/shared/config.js`.

Kết quả chỉ gồm đối tượng phù hợp với bộ lọc bản đồ hiện tại; chọn kết quả chỉ di chuyển bản đồ tới đối tượng và đánh dấu ranh giới vùng. Popup dữ liệu mở khi bấm trực tiếp lên đối tượng trên bản đồ. Có thể tìm tên có dấu, không dấu hoặc bí danh/mã quốc gia đã cấu hình trên các trường được chọn. Thay file, đổi kiểu bản đồ hoặc bộ lọc cập nhật chỉ mục; đổi màu, zoom hoặc mở popup không gọi lại AI và không làm mất truy vấn khi dữ liệu không đổi. Xóa dữ liệu sẽ ẩn thanh tìm kiếm. Tìm kiếm chạy tại trình duyệt, không gọi geocoding hay tải thời tiết cho khu vực ngoài dữ liệu. Công tắc thời tiết OpenWeather theo vùng đã được bỏ; dữ liệu thời tiết tải lên vẫn hiển thị như các chỉ số thông thường.

Trong luồng **Bản đồ Polygon**, bấm một vùng hoặc ô lục giác thuộc polygon để xem thông tin hoặc biểu đồ riêng của vùng đó. Ngày tô màu bản đồ độc lập với khoảng ngày biểu đồ. Chọn địa phương bằng cách bấm trên bản đồ.

Các nút chọn nhanh dọc cạnh phải bản đồ được AI thiết kế riêng cho từng bộ dữ liệu và kiểu bản đồ trong cùng request phân tích. Mỗi `suggestions[].metricButtons` là danh sách có thứ tự gồm `{ "field": "tên cột gốc", "label": "nhãn hiển thị", "icon": "emoji/ký hiệu Unicode", "color": "#RRGGBB" }`. AI quyết định chỉ số nào cần nút, thứ tự, nhãn, biểu tượng và màu theo nội dung bảng; giao diện không dò từ khóa để gán biểu tượng thời tiết và không tự bổ sung mọi cột số thành nút. Đơn vị lấy từ metadata cột, màu biểu tượng độc lập với thang màu bản đồ. Point dùng nút đầu tiên làm chỉ số kích thước mặc định. Chỉ các cột hợp lệ cho bản đồ mới được nhận; bỏ cột lạ/trùng, địa lý, thời gian, tọa độ, ID, thứ tự và cấu hình sai. Line có thể dùng thêm cột phân loại hợp lệ với tối đa 12 giá trị.

Khi có ít nhất hai nút AI hợp lệ, danh sách xuất hiện với biểu tượng tròn. Bấm nút để đổi chỉ số tô màu Polygon/Line hoặc kích thước Point; bộ chọn ở mục 3 và chú giải được cập nhật cùng lựa chọn. Ngày, khu vực và cấu hình biểu đồ popup được giữ nguyên; thao tác không gọi thêm AI. Có thể thu gọn/mở danh sách bằng nút **Chỉ số bản đồ** và cuộn khi có nhiều cột. Danh sách tự cập nhật khi đổi file/kiểu bản đồ. Output AI cũ thiếu `metricButtons`, danh sách rỗng/lỗi, phân tích dự phòng hoặc dưới hai nút hợp lệ đều ẩn danh sách; bộ chọn chỉ số tại mục 3 vẫn hoạt động và không sinh bộ nút mặc định.

Mục 3 của Polygon tự tạo bộ lọc giá trị cho các cột địa lý và phân nhóm từ metadata, dùng đúng tên/nhãn cột trong bảng. Các cấp địa lý được xếp từ quốc gia đến cấp hành chính nhỏ hơn; cột phân nhóm theo sau. Mỗi bộ lọc có lựa chọn **Tất cả**. Danh sách giá trị phụ thuộc các bộ lọc đứng trước; khi đổi lựa chọn, giá trị phía sau không còn phù hợp được bỏ chọn. Bộ lọc áp dụng trước tổng hợp và cho cả dữ liệu biểu đồ popup; khoảng thời gian biểu đồ vẫn độc lập với ngày tô màu bản đồ. Lựa chọn được giữ khi đổi chỉ số hoặc kiểu popup.

Khi AI đề xuất Bản đồ Line từ tên/mã đường, renderer tra mạng đường đã cấu hình theo cột được AI gán `geo/admin1`, tên tuyến từ bindings và metadata ID. Dữ liệu chuỗi tọa độ dùng bindings nhóm/thứ tự do AI chỉ định. Không có quy tắc tự thêm Line từ tên cột giao thông hoặc bảng màu trạng thái ùn tắc. Popup và bộ lọc tiếp tục dùng metadata chung của từng lớp.

Trong luồng **Bản đồ Point**, bấm một điểm để xem biểu đồ của đúng đối tượng qua các kỳ. Ưu tiên mã đối tượng ổn định (ví dụ `ma_cua_hang`); khi thiếu mã, dùng cặp tọa độ. Các cửa hàng cùng thành phố hoặc trùng tọa độ nhưng khác mã không bị gộp chung. Mục **Hiển thị theo** cho chọn tên cửa hàng, thành phố hoặc cột phân loại/văn bản/địa danh khác có tối đa 80 giá trị. Thời gian bản đồ chỉ chọn một giá trị, mặc định là kỳ mới nhất; chỉ các điểm ở kỳ đó được hiển thị. Bộ lọc nhóm điểm, chỉ số kích thước và thời gian bản đồ hoạt động độc lập với cấu hình và khoảng thời gian biểu đồ popup.

**Line từ chuỗi tọa độ** dùng `bindings.lat`/`lng`, `region` để tách nhóm tuyến nếu có và `x` làm cột thứ tự/thời gian nếu có. Thiếu `x` sẽ nối theo thứ tự dòng trong file. Mỗi nhóm được nối riêng; tọa độ thiếu hoặc sai làm ngắt đường. Dữ liệu cửa hàng cố định lặp theo tháng không tự trở thành tuyến. Nhánh này dùng tọa độ trực tiếp, không cần tải mạng đường hoặc ranh giới hành chính.

Popup cột ở chế độ “Theo dữ liệu” và popup đường dùng trục thời gian, giữ đầy đủ kỳ, giá trị 0 và khoảng thiếu số liệu. Khi không có cột thời gian, cột hiển thị giá trị tổng hợp của đối tượng và đường bị vô hiệu hóa kèm lý do. Đường cần ít nhất hai mốc có số liệu. Tọa độ và cột thứ tự không được dùng làm chỉ số biểu đồ.

Phép tính mặc định của popup cột là “Theo dữ liệu”, hiển thị theo từng mốc và dùng `aggDefault` riêng của từng cột khi nhiều bản ghi trùng mốc. Khi chọn SUM, AVG, MIN hoặc MAX, biểu đồ tính trực tiếp từ toàn bộ bản ghi của đối tượng trong khoảng thời gian đã chọn (gồm cả hai đầu khoảng), hiển thị một cột tổng hợp cho mỗi chỉ số thay vì chia cột theo ngày. AVG bỏ qua giá trị thiếu và vẫn tính giá trị 0; số bản ghi luôn dùng count. Không tự lấy trung bình khi có nhiều dòng trong một nhóm nhưng chưa xác định được phép gộp. Lựa chọn nhiều chỉ số mặc định ưu tiên cùng đơn vị. Các nhãn thời gian ngoài định dạng được hỗ trợ hoặc chỉ số cần phép tính chuyên biệt (ví dụ tỷ lệ cần trọng số) cần metadata/chuẩn hóa bổ sung; không coi mọi cột số đều cộng được.

Response AI lỗi, không hợp lệ hoặc chỉ chứa suggestion sai contract sẽ chuyển ngay sang rule-based fallback với cùng contract; không retry. Biểu đồ cột/đường là lựa chọn popup, không xuất hiện như kiểu đầu vào riêng. Thay đổi filter, ngày, metric, palette hoặc độ phân giải lưới polygon chỉ dựng lại payload tại client và không gọi AI thêm lần nữa.

`AI_DEBUG` mặc định tắt. Khi tắt, middleware không log sample/head hoặc raw profile. Chỉ bật `AI_DEBUG=true` trong môi trường phát triển có dữ liệu phù hợp để ghi log. Khi bật, mỗi lần phân tích sẽ thêm một phần tử JSON gồm tên file/sheet, input gửi AI, raw output và output sau chuẩn hóa vào `test/ai-analysis-input-output.json`. Có thể đổi đường dẫn bằng biến `AI_DEBUG_FILE`; toàn bộ các lần phân tích được lưu chung trong một mảng JSON và có thể format trực tiếp trong IDE.

Choropleth ưu tiên polygon từ MapTiler khi có API key. Khi không có kết quả phù hợp, API lỗi hoặc thiếu key, ứng dụng mới tra ranh giới trong thư mục mã quốc gia. Bảng ánh xạ dự phòng nằm riêng tại `src/shared/geography/country-boundary-fallbacks.js`, khai báo tên nước, bí danh và URL từng cấp ADM trong thư mục mã quốc gia tương ứng. Các nước đã có ánh xạ được giữ nguyên khi bổ sung nước mới. Khi chưa có dữ liệu cục bộ, để `files: {}`; nước đó vẫn tra MapTiler và giữ nguyên polygon khi chưa có mặt nạ cục bộ. Khi bổ sung dữ liệu, thêm URL file vào mục `files` của nước đó. Các tên `Việt Nam`, `Viet Nam`, `Vietnam`, `VN`, `VNM` trỏ về `administrative_division/VNM/`: quốc gia đọc `VNM_ADM0.geojson`, tỉnh/thành đọc `VNM_ADM1.geojson`, quận/huyện đọc `VNM_ADM2.geojson`. Các tên `Nga`, `Liên bang Nga`, `Russia`, `Russian Federation`, `RU`, `RUS` trỏ về `administrative_division/RUS/RUS_ADM0.geojson` cho ranh giới quốc gia. Hàm phân giải tên, tải file và cache trong bộ nhớ nằm tại `src/shared/geography/country-boundary-sources.js`. Ánh xạ tên nước sang mã thư mục và ghép địa danh được thực hiện bằng code, không cần AI biết đường dẫn hay gọi AI để ghép ranh giới. Bộ tải cũng nhận mã quốc gia có sẵn trong metadata. Chưa có quốc gia thì địa danh tỉnh/huyện mặc định tra Việt Nam; mã quốc gia chưa cấu hình không bị chuyển sang Việt Nam. Khi bổ sung nguồn dự phòng cho một nước, thêm mã thư mục, tên, bí danh và URL từng cấp ADM vào `src/shared/geography/country-boundary-fallbacks.js`; chỉ các nước đã cấu hình được đóng gói khi build. Không đọc các đường dẫn `gadm41_VNM_*.json` cũ.

Bảng có cột `Quốc gia`/`Quoc gia`/`Country` hoặc `Mã quốc gia`/`Ma quoc gia`/`Country Code` được nhận diện là `geoLevel: country`, kể cả khi AI gán nhầm thành ID, category hoặc cấp tỉnh. Giá trị Alpha-3 như `VNM`, `RUS`, `USA`, `AUT`, `AUS`, `JPN`, `KOR` được phân giải qua cấu hình quốc gia: tra MapTiler bằng tên nước tương ứng, đối chiếu mã quốc gia trong phản hồi và dùng đúng file ADM0 khi cần dự phòng. Mã gốc trong bảng được giữ nguyên để ghép chỉ số và bộ lọc. Mỗi tên nước được tra toàn cầu với `types=country`, không thêm hậu tố Việt Nam, `country=vn` hay bbox Việt Nam. Bộ ghép đối chiếu tên trong phản hồi đa ngôn ngữ (`text`, `text_vi`, `text_en`, `matching_text`), mã hai ký tự và tên tiếng Việt/Anh suy ra từ mã này bằng `Intl.DisplayNames`. Nếu gợi ý chỉ là Point thì tra tiếp theo feature ID để lấy polygon, theo [MapTiler Geocoding API](https://docs.maptiler.com/cloud/api/geocoding/). Mỗi tên nước duy nhất được tải một lần trong lượt ghép; kết quả ranh giới tra trực tiếp được cache trong bộ nhớ trình duyệt. Chỉ chấp nhận Polygon/MultiPolygon khớp tên hoặc mã; kết quả khác nước, chỉ có điểm hoặc tên không phân biệt được không được tự chọn. Nước chưa có file dự phòng vẫn được tra MapTiler bình thường. Ví dụ tập thời tiết theo Việt Nam, Thái Lan, Lào, Campuchia, Myanmar qua nhiều ngày được ghép theo tên nước gốc, sau đó lọc ngày và chỉ số tại client.

Tên khu vực chưa ghi rõ loại hành chính được tra theo cấp đề xuất trước, rồi tìm tên khớp chính xác trong các cấp hành chính khác của cùng quốc gia khi cần. Ví dụ Manila là `municipality`, Bandar Seri Begawan là `municipal_district`, Dili là `subregion`; không dùng vùng cha có tên khác để thay thế. Các điểm `virtual_place` được bỏ qua và gợi ý Point phải có polygon thật khi tra theo ID. Nguồn dự phòng bổ sung Brunei (`BRN`) và Timor-Leste (`TLS`); ngoài Việt Nam, bộ tra thử thêm các cấp ADM đã cấu hình khi cấp ban đầu không có tên khớp. Cấu hình `cityState: true` cho phép tên đô thị trùng tên quốc gia như Singapore dùng ranh giới quốc gia tương ứng; các khu vực nhỏ hơn trong nước đó vẫn dùng polygon riêng. Nhiều polygon khớp cùng tên tiếp tục yêu cầu chọn vùng.

Các file ADM dùng cấu trúc thuộc tính `GID_0`, `COUNTRY`, `GID_1/2`, `NAME_1/2`, `VARNAME_1/2`, `NL_NAME_1/2`, `TYPE_1/2` tùy cấp. Bộ đọc lấy định danh từ GID, tìm tên theo NAME/VARNAME/NL_NAME (tách các bí danh bằng `|` hoặc `;`, bỏ giá trị `NA`), lấy tỉnh cha trực tiếp từ `NAME_1` và kiểm tra loại địa danh qua TYPE. Tên ghép liền như `HồChíMinh` được hiển thị có khoảng trắng. Bí danh theo từng cấp có thể khai báo trong `nameAliases`, hiện có `Huế` → `ThừaThiênHuế` và các tên viết tắt TP HCM. Kết quả ghép báo `matched`, `unmatched`, `matchRate`, giữ `boundary_source: Local ADM` và tên dòng dữ liệu gốc. Tên trùng yêu cầu chọn vùng hoặc bổ sung loại địa danh/tỉnh cha; không suy ra tỉnh bằng hình học. Các file VNM hiện dừng ở ADM2; tên xã/phường không được ghép thành huyện. Kết quả MapTiler hợp lệ được giữ nguyên làm nguồn ranh giới; các file ADM của đúng quốc gia chỉ dự phòng và cung cấp mặt nạ cắt.

ADM1 cục bộ hiện chứa 63 tỉnh/thành theo bộ ranh giới nguồn. Khi MapTiler trả ranh giới mới cho tập dữ liệu 34 tỉnh/thành, ứng dụng ưu tiên ranh giới đó. Nếu phải dùng file dự phòng thì polygon giữ nguyên theo file; việc khớp tên không tự hợp nhất các tỉnh.

Các lớp trong cùng nhóm được xếp theo geometry: vùng dưới, đường giữa, điểm trên; tên file không quyết định thứ tự. Đây là ràng buộc hiển thị kỹ thuật. AI quyết định nhóm lớp thông qua composition; lỗi hoặc chưa đủ bằng chứng giữ các tập dữ liệu thành nhóm riêng.

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
- Arc Flow 3D (quan hệ đi–đến có tọa độ)

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
3. Kiểm tra hợp đồng và khả năng render; giữ nguyên quyết định AI, báo lỗi khi chưa phân tích được
4. Chuẩn hóa kiểu dữ liệu
5. Đánh giá khả năng render; giữ nguyên confidence AI
6. Aggregate hoặc pivot tại client
7. Với Polygon: gửi một request AI theo lô để thiết kế chú giải từ thống kê sau lọc/tổng hợp của từng chỉ số
8. Kiểm tra cấu hình chú giải rồi dùng cùng một scale cho Polygon, chú giải và lưới lục giác vùng
9. Render trên canvas hiện có
```

Chú giải Polygon nhận `continuous` với `auto/semantic` hoặc `diverging` với `semantic`. AI trả trực tiếp domain/stops/màu; ứng dụng không dùng registry ngưỡng nhiệt độ. AI quyết định miền/mốc tham chiếu và màu từ ngữ cảnh từng chỉ số; prompt không ép một miền nhiệt độ cố định. Chú giải giữ đủ nhãn và chuyển nhãn sang hàng khác khi thiếu chỗ. Khi đổi bộ lọc, `auto` cập nhật miền và giữ màu/vị trí tương đối, còn `semantic` giữ nguyên mốc. Đổi chỉ số dùng cấu hình đã lưu, không gọi AI lại. Thiếu cấu hình hoặc AI lỗi thì dùng thang kỹ thuật trung tính; giao diện ghi rõ chú giải dự phòng.

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

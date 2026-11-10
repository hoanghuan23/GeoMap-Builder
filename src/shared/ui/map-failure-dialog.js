import { diagnoseMapData } from '../data/map-failure-diagnostics.js';

/** Data guidance comes from structured checks, never from parsing binding errors. */
export function explainMapFailure({ dataset, error, stage, suggestion, mapType } = {}) {
  const analysis = dataset?.analysis;
  const selected = suggestion || dataset?.suggestions?.find(item => item.id === dataset.selectedSuggestionId);
  const details = [error?.message, !analysis?.validationErrors?.length && dataset?.fallbackReason,
    selected?.unavailableReason].filter(Boolean).join(' ');
  const notice = (title, reason, ...steps) => ({ title, reason, steps, detectedFields: [], missingFields: [] });
  if (stage === 'basemap') return notice('Chưa tải được nền bản đồ', 'Chương trình chưa nhận được nền để hiển thị bản đồ.',
    'Kiểm tra kết nối Internet, sau đó chọn một nền bản đồ khác để thử lại.');
  if (/WebGL|bộ dựng 3D|deck\.gl/i.test(details)) return notice('Trình duyệt chưa hiển thị được bản đồ ba chiều',
    'Chức năng hiển thị bản đồ ba chiều chưa hoạt động trên trình duyệt này.',
    'Thử mở bằng phiên bản mới của Chrome hoặc Edge.');
  if (stage === 'read' && /không có dữ liệu|không có bản ghi|không có đối tượng|(?:tệp|bảng|file) trống|empty/i.test(details))
    return notice('Tệp chưa có dữ liệu để vẽ', 'Không tìm thấy dòng dữ liệu trong tệp hoặc bảng đã chọn.',
      'Thêm dữ liệu vào bảng, hoặc chọn lại bảng có dữ liệu trong tệp Excel.');
  if (stage === 'read' && /định dạng|chưa hỗ trợ|\.doc\b|ZIP\/Shapefile/i.test(details))
    return notice('Chưa đọc được loại tệp này', 'Định dạng của tệp chưa được chương trình hỗ trợ.',
      'Lưu lại thành tệp Excel (.xlsx), CSV, JSON, GeoJSON, văn bản (.txt) hoặc Word (.docx), rồi tải lên lại.');
  if (/\bHTTP\b|\bAPI\b|API_KEY|fetch|network|kết nối|timeout|timed out|dịch vụ|quá lâu|không thể gọi AI|chưa nhận được|tra tọa độ gặp lỗi/i.test(details)
    || analysis?.pointGeocoding?.matched === 0 && analysis.pointGeocoding.reason)
    return notice('Dịch vụ xử lý chưa phản hồi', 'Chương trình chưa nhận được kết quả từ dịch vụ phân tích hoặc tìm vị trí.',
      'Kiểm tra kết nối Internet rồi tải tệp lên lại sau ít phút.',
      'Nếu vẫn gặp lỗi, liên hệ người quản lý ứng dụng để kiểm tra dịch vụ.');
  if (stage === 'read') return notice('Chưa đọc được nội dung tệp', 'Chương trình chưa đọc được nội dung tệp để tạo bản đồ.',
    'Mở tệp để kiểm tra nội dung, đặt tên rõ ràng cho các cột và lưu lại rồi tải lên lần nữa.',
    'Với Excel, kiểm tra bạn đã chọn bảng có dữ liệu cần vẽ.');
  if (error) return notice('Gặp lỗi khi hiển thị bản đồ', 'Chương trình gặp lỗi khi tạo bản đồ từ dữ liệu này.',
    'Thử tải tệp lên lại. Nếu vẫn gặp lỗi, liên hệ người quản lý ứng dụng để kiểm tra.');
  return diagnoseMapData(dataset, { suggestion, mapType });
}

export function createMapFailureDialog(document) {
  const node = (tag, text, className) => Object.assign(document.createElement(tag), { textContent: text, className: className || '' });
  const dialog = node('dialog', '', 'map-failure-dialog');
  dialog.setAttribute('aria-labelledby', 'map-failure-title');
  const close = node('button', '×', 'map-failure-close');
  close.type = 'button'; close.setAttribute('aria-label', 'Đóng thông báo');
  close.autofocus = true;
  close.addEventListener('click', () => dialog.close());
  const icon = node('div', '!', 'map-failure-icon'); icon.setAttribute('aria-hidden', 'true');
  const title = node('h2', 'Chưa thể vẽ bản đồ'); title.id = 'map-failure-title';
  const content = node('div', '', 'map-failure-content');
  dialog.append(close, icon, title, content);
  document.body.append(dialog);
  return {
    show(failures) {
      if (!failures.length) return;
      const reports = failures.map(failure => ({ ...failure, diagnostic: explainMapFailure(failure) }));
      title.textContent = reports.length === 1 ? reports[0].diagnostic.title : 'Một số tệp chưa hiển thị được bản đồ';
      content.replaceChildren(...reports.map(failure => {
        const section = node('section', '', 'map-failure-item');
        const { title, reason, detectedFields, missingFields, steps, stepsIntro, orderedSteps } = failure.diagnostic;
        if (reports.length > 1) section.append(node('h3', title));
        if (failure.fileName) section.append(node('p', failure.fileName, 'map-failure-file'));
        if (detectedFields.length || missingFields.length) {
          const summary = node('dl', '', 'map-failure-summary');
          if (detectedFields.length) summary.append(node('dt', 'Đã có'), node('dd', detectedFields.join(', ')));
          if (missingFields.length) summary.append(node('dt', 'Còn thiếu'), node('dd', missingFields.join('; ')));
          section.append(summary);
        }
        section.append(node('p', reason), node('h4', 'Cách khắc phục'));
        if (stepsIntro) section.append(node('p', stepsIntro, 'map-failure-steps-intro'));
        const list = node(orderedSteps ? 'ol' : 'ul', ''); list.append(...steps.map(step => node('li', step)));
        section.append(list); return section;
      }));
      if (!dialog.open) dialog.showModal();
    },
    dispose() { dialog.close(); dialog.remove(); }
  };
}

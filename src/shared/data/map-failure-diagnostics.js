import { coordinatePair } from './coordinates.js';
import { normalizeRoadText } from './text-utils.js';
import { buildCoordinateLines } from '../../maps/line/coordinates.js';
import { createArcFlowModel } from '../../maps/arc-flow/data.js';

const filled = value => value != null && String(value).trim() !== '';
const unique = values => [...new Set(values.filter(Boolean))];
const coordinateHelp = 'Tọa độ: hai cột Vĩ độ và Kinh độ cho từng địa điểm.';
const addressHelp = 'Địa chỉ cụ thể: ví dụ Số 6 phố Gia Thụy, phường Bồ Đề, Hà Nội.';

/** Local evidence only. Does not infer a new map or change AI recommendations. */
export function diagnoseMapData(dataset = {}, { suggestion, mapType } = {}) {
  dataset ||= {};
  const analysis = dataset.analysis || {};
  const context = analysis.mapFailureContext;
  const records = (dataset.records || dataset.rawRecords || []).map((record, index) => {
    const raw = dataset.rawRecords?.[index];
    if (!raw) return record;
    return Object.fromEntries(unique([...Object.keys(raw), ...Object.keys(record)]).map(name => [name, record[name] ?? raw[name]]));
  });
  const columns = new Map();
  for (const column of [...(dataset.profile?.columns || []), ...(context?.columns || []), ...(analysis.columns || [])]) {
    if (!column?.name) continue;
    const previous = columns.get(column.name);
    // Fallback columns are unclassified; retain the earlier diagnostic metadata.
    columns.set(column.name, column.role === 'ignore' && previous ? { ...column, ...previous } : { ...previous, ...column });
  }
  for (const record of records) for (const name of Object.keys(record)) if (!columns.has(name)) columns.set(name, { name });
  const actualNames = records.length ? new Set(records.flatMap(Object.keys)) : new Set(dataset.profile?.columns?.map(column => column.name) || []);
  const actual = [...columns.values()].filter(column => actualNames.has(column.name));
  const has = field => actualNames.has(field);
  const populated = field => has(field) && records.some(record => filled(record[field]));
  const find = (pattern, predicate = () => false) => actual.find(column => (!column.name.startsWith('__') || populated(column.name))
    && (predicate(column) || pattern.test(normalizeRoadText(column.name))))?.name;
  const name = find(/^(?:ten )?(?:co so|don vi|dia diem|truong|benh vien)|^ten$|^name$|^facility name$|^location name$/);
  const ward = find(/^(?:ten )?(?:phuong|xa|ward|commune)(?: |$)/);
  const province = find(/^(?:ten )?(?:tinh|thanh pho|province|city)(?: |$)/, column => column.geoLevel === 'admin1');
  const district = find(/^(?:ten )?(?:quan|huyen|district)(?: |$)/, column => column.geoLevel === 'admin2');
  const country = find(/^(?:ten )?(?:quoc gia|country)(?: |$)/, column => column.geoLevel === 'country');
  const address = find(/(?:dia chi|address|street address)/);
  const road = find(/^(?:ten )?(?:duong|tuyen)|^road(?: name)?$|^route(?: name)?$/);
  const lat = find(/^(?:vi do|latitude|lat)$/, column => column.geoLevel === 'point_lat');
  const lng = find(/^(?:kinh do|longitude|lng|lon|long)$/, column => column.geoLevel === 'point_lng');
  const attempts = [...(dataset.suggestions || analysis.suggestions || []), ...(context?.attempts || [])];
  const selected = suggestion || attempts.find(item => item.id === dataset.selectedSuggestionId)
    || attempts.find(item => mapType && item.chartType === mapType) || attempts[0];
  const chartType = mapType || selected?.chartType || null;
  const bindings = selected?.bindings || {};
  const field = (key, inferred) => has(bindings[key]) && (!bindings[key].startsWith('__') || populated(bindings[key])) ? bindings[key] : inferred;
  const label = (field, fallback) => {
    const column = columns.get(field);
    if (!column || String(field).startsWith('__')) return fallback;
    // Readable original Vietnamese headers help users recognize their own file.
    return /[^\x00-\x7f]/.test(column.name) ? column.name : column.labelVi || fallback;
  };
  const relevant = [[name, 'Tên địa điểm'], [ward, 'Phường/xã'], [district, 'Quận/huyện'], [province, 'Tỉnh/thành phố'],
    [country, 'Quốc gia'], [address, 'Địa chỉ'], [road, 'Tên đường']];
  const detectedFields = unique(relevant.filter(([field]) => populated(field)).map(([field, fallback]) => label(field, fallback)));
  const result = (title, reason, missingFields, steps, extra = {}) => ({
    title, mapType: chartType, detectedFields: unique(detectedFields), missingFields: unique(missingFields), reason, steps, ...extra
  });
  const checkCoordinates = (latitude, longitude, suffix = '') => {
    const validRows = records.filter(record => coordinatePair(record, { lat: latitude, lng: longitude })).length;
    const missingFields = []; const steps = []; let invalid = false;
    for (const [field, caption, limit] of [[latitude, 'Vĩ độ', 90], [longitude, 'Kinh độ', 180]]) {
      const display = caption + suffix;
      const values = records.map(record => record[field]);
      if (populated(field)) detectedFields.push(label(field, display));
      if (!has(field) || !values.some(filled)) {
        missingFields.push(display);
        steps.push(`${has(field) ? 'Điền các ô còn trống trong' : 'Bổ sung'} cột ${display}.`);
      } else {
        const bad = values.filter(value => filled(value) && (!['number', 'string'].includes(typeof value)
          || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit)).length;
        const blank = values.filter(value => !filled(value)).length;
        if (bad) {
          invalid = true; missingFields.push(`${display} hợp lệ`);
          steps.push(`Sửa ${bad} ô ${display} chưa hợp lệ: dùng số từ -${limit} đến ${limit}.`);
        }
        if (blank) {
          missingFields.push(`${display} cho các dòng còn trống`);
          steps.push(`Điền ${blank} ô còn trống trong cột ${display}.`);
        }
      }
    }
    return { validRows, missingFields, steps, invalid, complete: has(latitude) && has(longitude) };
  };

  if (!records.length) return result('Tệp chưa có dữ liệu để vẽ', 'Không tìm thấy dòng dữ liệu trong bảng đã chọn.',
    ['Các dòng dữ liệu cần hiển thị'], ['Thêm dữ liệu vào bảng, hoặc chọn lại bảng có dữ liệu trong tệp Excel.']);

  const native = dataset.nativeGeometry || dataset.profile?.spatial?.nativeGeometry;
  if (native && chartType !== 'arc_flow') return result('Chưa hiển thị được bản đồ từ tệp',
    'Tệp đã có sẵn hình dạng và vị trí trên bản đồ, nhưng chương trình chưa tạo được cách hiển thị phù hợp.', [],
    ['Thử tải tệp lên lại. Nếu vẫn gặp lỗi, liên hệ người quản lý ứng dụng để kiểm tra.'],
    { detectedFields: ['Hình dạng và vị trí có sẵn trong tệp'] });

  if (chartType === 'choropleth') {
    const region = field('region', ward || district || province || country);
    if (!populated(region)) return result('Thiếu tên địa phương để vẽ bản đồ',
      'Bản đồ theo địa phương cần biết mỗi dòng thuộc tỉnh, thành phố, quận, huyện hoặc xã, phường nào.',
      ['Tên địa phương cho từng dòng'], ['Bổ sung hoặc điền đầy đủ cột tên địa phương cần hiển thị.']);
    if (!detectedFields.includes(label(region, 'Tên địa phương'))) detectedFields.push(label(region, 'Tên địa phương'));
    const match = dataset.geoMatch;
    const count = match?.unmatched?.length;
    return result('Chưa xác định được địa phương trên bản đồ',
      count ? `Có ${count} địa phương chưa tìm được vùng tương ứng trên bản đồ.`
        : 'Đã nhận diện được tên địa phương, nhưng chưa tìm được đủ vùng tương ứng trên bản đồ.',
      ['Tên hoặc thông tin phân biệt các địa phương chưa tìm thấy'], [
        'Kiểm tra tên địa phương chưa tìm thấy và viết đầy đủ tên chính thức.',
        ...(!populated(province) && region !== province && region !== country ? ['Bổ sung tỉnh hoặc thành phố đi kèm các địa phương có tên trùng nhau.'] : []),
        ...(!populated(country) && region !== country ? ['Nếu dữ liệu thuộc nhiều nước, bổ sung quốc gia tương ứng.'] : [])
      ]);
  }

  if (chartType === 'arc_flow') {
    const slotLabels = { source: 'Tên nơi đi', target: 'Tên nơi đến', value: 'Số lượng di chuyển' };
    const missing = []; const steps = [];
    for (const [key, caption] of Object.entries(slotLabels)) {
      const current = field(key);
      if (populated(current)) detectedFields.push(label(current, caption));
      else { missing.push(caption); steps.push(`Bổ sung hoặc điền đầy đủ cột ${caption.toLocaleLowerCase('vi')}.`); }
    }
    const origin = checkCoordinates(field('sourceLat'), field('sourceLng'), ' nơi đi');
    const target = checkCoordinates(field('targetLat'), field('targetLng'), ' nơi đến');
    missing.push(...origin.missingFields, ...target.missingFields);
    steps.push(...origin.steps, ...target.steps);
    if (missing.length) return result('Chưa đủ thông tin nối nơi đi với nơi đến',
      'Mỗi dòng cần có tên, vị trí của cả nơi đi lẫn nơi đến và số lượng di chuyển giữa hai nơi.', missing, steps,
      { detectedFields: unique(detectedFields) });
    const model = createArcFlowModel(records, actual, selected);
    if (model.stats.reasons.negativeValue) {
      missing.push('Số lượng di chuyển không âm'); steps.push('Sửa các số lượng di chuyển nhỏ hơn 0.');
    }
    if (model.stats.reasons.samePosition) {
      missing.push('Hai vị trí khác nhau cho nơi đi và nơi đến'); steps.push('Kiểm tra các dòng có nơi đi và nơi đến cùng một vị trí.');
    }
    if (model.stats.reasons.missingValue) {
      missing.push('Số lượng di chuyển ghi bằng số'); steps.push('Điền số lượng di chuyển bằng số cho từng cặp nơi đi và nơi đến.');
    }
    return result(missing.length ? 'Dữ liệu nơi đi và nơi đến chưa hợp lệ' : 'Chưa hiển thị được các luồng di chuyển',
      `Có ${model.stats.validRows}/${records.length} dòng đủ thông tin để nối nơi đi với nơi đến.`, missing,
      steps.length ? steps : ['Thử phân tích lại tệp để chương trình đọc đúng thông tin nơi đi và nơi đến.'],
      { detectedFields: unique(detectedFields) });
  }

  const latitude = field('lat', lat); const longitude = field('lng', lng);
  if (chartType === 'map_line') {
    if (bindings.lat || bindings.lng || !bindings.region && (has(latitude) || has(longitude))) {
      const coords = checkCoordinates(latitude, longitude);
      if (coords.missingFields.length) return result(coords.invalid ? 'Tọa độ của đường chưa hợp lệ' : 'Thiếu vị trí các điểm trên đường',
        `Có ${coords.validRows}/${records.length} dòng có đủ vị trí hợp lệ để nối thành đường.`, coords.missingFields, coords.steps,
        { detectedFields: unique(detectedFields) });
      const lines = buildCoordinateLines(records, actual, { ...bindings, lat: latitude, lng: longitude });
      return result('Chưa có đủ điểm khác nhau để nối thành đường',
        lines.features.length ? 'Các điểm đã có vị trí, nhưng chương trình chưa hiển thị được đường tương ứng.'
          : 'Các điểm đã có tọa độ, nhưng chưa tạo thành đường có ít nhất hai vị trí khác nhau trong cùng một nhóm.',
        lines.features.length ? [] : ['Ít nhất hai vị trí khác nhau trên mỗi đường'],
        ['Kiểm tra nhóm đường và thứ tự các điểm; mỗi đường cần ít nhất hai điểm ở hai vị trí khác nhau.'],
        { detectedFields: unique(detectedFields) });
    }
    const route = field('region', road);
    const area = province || find(/^khu vuc$/);
    if (populated(route)) detectedFields.push(label(route, 'Tên đường hoặc tuyến'));
    if (populated(area)) detectedFields.push(label(area, 'Tỉnh/thành phố'));
    const missing = [!populated(route) && 'Tên đường hoặc tuyến', !populated(area) && 'Tỉnh/thành phố có đường hoặc tuyến'];
    return result(missing.some(Boolean) ? 'Thiếu thông tin để xác định đường' : 'Chưa tìm được đường tương ứng',
      missing.some(Boolean) ? 'Để tìm đúng đường trên bản đồ, cần biết tên đường và tỉnh hoặc thành phố có đường đó.'
        : 'Tệp đã có tên đường và khu vực, nhưng chương trình chưa tìm được đường tương ứng trong dữ liệu bản đồ.', missing, [
        ...(!populated(route) ? ['Bổ sung hoặc điền đầy đủ tên đường hoặc tuyến.'] : []),
        ...(!populated(area) ? ['Bổ sung tỉnh hoặc thành phố có đường hoặc tuyến đó.'] : []),
        ...(populated(route) && populated(area) ? ['Kiểm tra tên đường và khu vực đã ghi đúng; nếu đã đúng, thử tải tệp lên lại.'] : [])
      ]);
  }

  // No type is invented for rendering; recognizable location fields only help
  // explain a rejected or absent Point recommendation to the file's owner.
  if (chartType === 'point' || !chartType && (name || ward || address || lat || lng)) {
    const noun = /co so/.test(normalizeRoadText(name)) ? 'cơ sở' : 'địa điểm';
    const report = analysis.pointGeocoding;
    if (has(latitude) || has(longitude)) {
      const coords = checkCoordinates(latitude, longitude);
      if (coords.missingFields.length) return result(coords.invalid ? 'Tọa độ chưa hợp lệ'
        : coords.missingFields.length === 1 ? `Thiếu ${coords.missingFields[0].toLocaleLowerCase('vi')}` : `Thiếu tọa độ ${noun}`,
        `Có ${coords.validRows}/${records.length} dòng có đủ vĩ độ và kinh độ hợp lệ để xác định vị trí.`, coords.missingFields, coords.steps,
        { detectedFields: unique(detectedFields) });
      return result('Chưa hiển thị được các vị trí đã có',
        'Tệp đã có vĩ độ và kinh độ hợp lệ, nhưng chương trình chưa hiển thị được các vị trí này trên bản đồ.', [],
        ['Thử phân tích lại tệp để chương trình đọc đúng hai cột vị trí.'], { detectedFields: unique(detectedFields) });
    }
    if (populated(address)) return result('Chưa tìm được vị trí từ địa chỉ',
      report?.matched === 0 ? 'Đã đọc được địa chỉ, nhưng chưa tìm thấy vị trí tương ứng để đặt lên bản đồ.'
        : 'Tệp đã có địa chỉ, nhưng chương trình chưa xác định được vị trí cụ thể từ các địa chỉ này.',
      ['Vị trí xác định từ địa chỉ hoặc tọa độ'], [
        'Kiểm tra địa chỉ có đủ số nhà, tên đường, xã hoặc phường, tỉnh hoặc thành phố; sửa những phần còn thiếu hoặc ghi nhầm.',
        'Nếu địa chỉ đã đầy đủ, thử tra lại hoặc bổ sung hai cột Vĩ độ và Kinh độ cho từng địa điểm.'
      ]);
    return result(`Thiếu vị trí ${noun}`,
      populated(ward) ? `Tên phường/xã mới cho biết khu vực chung, chưa đủ để xác định vị trí từng ${noun} trên bản đồ.`
        : `Chưa có địa chỉ cụ thể hoặc tọa độ để xác định vị trí từng ${noun} trên bản đồ.`,
      [`Địa chỉ cụ thể hoặc tọa độ cho từng ${noun}`], [addressHelp, coordinateHelp],
      { stepsIntro: 'Bổ sung một trong hai thông tin sau:', orderedSteps: true });
  }
  return result('Chưa xác định được cách hiển thị dữ liệu',
    'Chương trình chưa xác định được dữ liệu trong tệp tương ứng với những vị trí hoặc vùng nào trên bản đồ.',
    ['Thông tin xác định vị trí hoặc vùng tương ứng với từng dòng'],
    ['Kiểm tra tên cột và thông tin địa điểm hoặc địa phương trong tệp, rồi phân tích lại.']);
}

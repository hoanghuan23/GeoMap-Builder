import test from 'node:test';
import assert from 'node:assert/strict';
import { explainMapFailure } from '../src/shared/ui/map-failure-dialog.js';
import { diagnoseMapData } from '../src/shared/data/map-failure-diagnostics.js';
import { validateAndNormalizeAnalysis } from '../src/shared/import/ai-chart-contract.js';
import { profileTabularData } from '../src/shared/import/tabular-data.js';

const point = { id: 'points', chartType: 'point', bindings: { lat: 'lat', lng: 'lng' } };
const data = (records, suggestion = point, extra = {}) => ({ records, suggestions: [suggestion], ...extra });
const copy = result => [result.title, result.reason, ...result.detectedFields, ...result.missingFields, ...result.steps].join(' ');

test('facility and ward data gets specific missing-location guidance without coordinate ranges', () => {
  const records = [{ 'Tên cơ sở': 'Cơ sở A', 'Phường/xã': 'Bồ Đề' }];
  const result = explainMapFailure({ dataset: data(records) });
  assert.equal(result.title, 'Thiếu vị trí cơ sở');
  assert.deepEqual(result.detectedFields, ['Tên cơ sở', 'Phường/xã']);
  assert.deepEqual(result.missingFields, ['Địa chỉ cụ thể hoặc tọa độ cho từng cơ sở']);
  assert.match(result.reason, /phường\/xã.*khu vực chung/);
  assert.equal(result.stepsIntro, 'Bổ sung một trong hai thông tin sau:');
  assert.doesNotMatch(copy(result), /-90|180|chưa hợp lệ|bindings|suggestion|Point|Polygon|Arc Flow/);
});

test('only the missing coordinate column is requested', () => {
  const result = diagnoseMapData(data([{ name: 'A', lat: 21 }]));
  assert.equal(result.title, 'Thiếu kinh độ');
  assert.ok(result.detectedFields.includes('Vĩ độ'));
  assert.deepEqual(result.missingFields, ['Kinh độ']);
  assert.equal(result.steps.length, 1);
  assert.doesNotMatch(result.steps[0], /Vĩ độ|-90|180/);
});

test('invalid existing coordinates show counts and ranges only for the invalid axis', () => {
  const result = diagnoseMapData(data([{ lat: 200, lng: 105 }, { lat: null, lng: 106 }]));
  assert.equal(result.title, 'Tọa độ chưa hợp lệ');
  assert.match(result.reason, /0\/2/);
  assert.match(result.steps.join(' '), /1 ô Vĩ độ chưa hợp lệ.*-90 đến 90/);
  assert.match(result.steps.join(' '), /1 ô còn trống/);
  assert.doesNotMatch(result.steps.join(' '), /-180|Bổ sung.*Kinh độ/);
});

test('blank coordinate columns do not trigger range instructions', () => {
  const result = diagnoseMapData(data([{ lat: '', lng: null }]));
  assert.deepEqual(result.missingFields, ['Vĩ độ', 'Kinh độ']);
  assert.match(result.steps.join(' '), /ô còn trống/);
  assert.doesNotMatch(copy(result), /-90|180|chưa hợp lệ/);
});

test('valid coordinates are acknowledged even if rendering fails', () => {
  const result = diagnoseMapData(data([{ lat: 21, lng: 105 }]));
  assert.equal(result.title, 'Chưa hiển thị được các vị trí đã có');
  assert.deepEqual(result.missingFields, []);
  assert.doesNotMatch(result.steps.join(' '), /Bổ sung|-90|180/);
});

test('an existing address is acknowledged and empty generated coordinates are ignored', () => {
  const dataset = data([{ 'Tên cơ sở': 'A', 'Địa chỉ': '6 Gia Thụy, Bồ Đề, Hà Nội', __lat: null, __lng: null }],
    { ...point, bindings: { lat: '__lat', lng: '__lng' } }, {
      analysis: { columns: [{ name: '__lat', role: 'geo', geoLevel: 'point_lat' }, { name: '__lng', role: 'geo', geoLevel: 'point_lng' }], pointGeocoding: { matched: 0 } }
    });
  const result = diagnoseMapData(dataset);
  assert.equal(result.title, 'Chưa tìm được vị trí từ địa chỉ');
  assert.ok(result.detectedFields.includes('Địa chỉ'));
  assert.doesNotMatch(copy(result), /__lat|__lng|-90|180|chưa có địa chỉ/);
});

test('rejected map context and recognized fields survive server/client normalization', () => {
  const records = [{ 'Tên cơ sở': 'A', 'Phường/xã': 'Bồ Đề' }];
  const profile = profileTabularData(records);
  const server = validateAndNormalizeAnalysis({ columns: [{ name: 'Tên cơ sở', role: 'text' }, { name: 'Phường/xã', role: 'geo', geoLevel: 'admin2' }],
    suggestions: [{ id: 'point-facilities', chartType: 'point', bindings: { region: 'Tên cơ sở' } }] }, profile);
  assert.equal(server.source, 'rule');
  assert.deepEqual(server.suggestions, []);
  const client = validateAndNormalizeAnalysis(JSON.parse(JSON.stringify(server)), profile);
  assert.deepEqual(client.mapFailureContext, server.mapFailureContext);
  const result = diagnoseMapData({ records, analysis: client, profile });
  assert.equal(result.mapType, 'point');
  assert.equal(result.title, 'Thiếu vị trí cơ sở');
  assert.ok(result.detectedFields.includes('Phường/xã'));
  assert.doesNotMatch(copy(result), /point-facilities|bindings|suggestion|-90/);
});

test('Polygon failure acknowledges locality fields and never asks for point coordinates', () => {
  const result = diagnoseMapData(data([{ 'Phường/xã': 'Bồ Đề', 'Tỉnh/thành phố': 'Hà Nội' }],
    { chartType: 'choropleth', bindings: { region: 'Phường/xã' } }, { geoMatch: { matchRate: 0, unmatched: ['Bồ Đề'] } }));
  assert.match(result.title, /địa phương/);
  assert.match(result.reason, /1 địa phương/);
  assert.ok(result.detectedFields.includes('Tỉnh/thành phố'));
  assert.doesNotMatch(copy(result), /Vĩ độ|Kinh độ|từng cơ sở|Bổ sung tỉnh/);
});

test('Line asks for its missing area, or distinct points, as appropriate', () => {
  const road = diagnoseMapData(data([{ 'Tên đường': 'Gia Thụy', 'Giới tính': 'Nam', 'Cơ quan quản lý': 'A' }],
    { chartType: 'map_line', bindings: { region: 'Tên đường' } }));
  assert.deepEqual(road.detectedFields, ['Tên đường']);
  assert.deepEqual(road.missingFields, ['Tỉnh/thành phố có đường hoặc tuyến']);
  assert.doesNotMatch(copy(road), /Vĩ độ|Kinh độ|địa chỉ cụ thể/);
  const line = diagnoseMapData(data([{ lat: 21, lng: 105 }, { lat: 21, lng: 105 }],
    { chartType: 'map_line', bindings: { lat: 'lat', lng: 'lng' } }));
  assert.match(line.reason, /hai vị trí khác nhau/);
  assert.doesNotMatch(copy(line), /-90|180|chưa hợp lệ/);
});

test('country maps do not ask for a province and named-road maps ignore incidental coordinate columns', () => {
  const country = diagnoseMapData(data([{ 'Quốc gia': 'VN' }], { chartType: 'choropleth', bindings: { region: 'Quốc gia' } }));
  assert.doesNotMatch(country.steps.join(' '), /tỉnh|Bổ sung quốc gia/);
  const road = diagnoseMapData(data([{ 'Tên đường': 'Gia Thụy', lat: 21, lng: 105 }],
    { chartType: 'map_line', bindings: { region: 'Tên đường' } }));
  assert.deepEqual(road.missingFields, ['Tỉnh/thành phố có đường hoặc tuyến']);
  assert.doesNotMatch(copy(road), /hai vị trí khác nhau|Vĩ độ|Kinh độ/);
});

test('Arc Flow reports only missing endpoint fields and leaves valid origin coordinates alone', () => {
  const result = diagnoseMapData(data([{ origin: 'A', destination: 'B', from_lat: 21, from_lng: 105, to_lat: 22, count: 10 }],
    { chartType: 'arc_flow', bindings: { source: 'origin', target: 'destination', sourceLat: 'from_lat', sourceLng: 'from_lng', targetLat: 'to_lat', targetLng: 'to_lng', value: 'count' } }));
  assert.deepEqual(result.missingFields, ['Kinh độ nơi đến']);
  assert.ok(result.detectedFields.includes('Vĩ độ nơi đi'));
  assert.ok(result.detectedFields.includes('Tên nơi đến'));
  assert.doesNotMatch(result.steps.join(' '), /nơi đi|Số lượng|-90|180/);
});

test('explicitly requested map takes precedence over unrelated failed suggestions', () => {
  const polygon = { chartType: 'choropleth', bindings: { region: 'province' } };
  const result = explainMapFailure({ dataset: { records: [{ province: 'Hà Nội' }], suggestions: [point, polygon] }, suggestion: polygon });
  assert.equal(result.mapType, 'choropleth');
  assert.doesNotMatch(copy(result), /Vĩ độ|Kinh độ/);
});

test('invented metadata and native geometry do not cause requests for nonexistent point requirements', () => {
  const result = diagnoseMapData(data([{ name: 'A' }], point, { analysis: { columns: [{ name: 'Địa chỉ', role: 'text' }] } }));
  assert.ok(!result.detectedFields.includes('Địa chỉ'));
  const native = diagnoseMapData(data([{ name: 'A' }], { chartType: 'choropleth' }, { nativeGeometry: { features: [] } }));
  assert.deepEqual(native.missingFields, []);
  assert.doesNotMatch(copy(native), /Vĩ độ|Kinh độ|Bổ sung/);
});

test('service and file errors remain separate from data-repair advice', () => {
  const service = explainMapFailure({ dataset: { records: [{ lat: 21, lng: 105 }], fallbackReason: 'AI HTTP 503' } });
  assert.equal(service.title, 'Dịch vụ xử lý chưa phản hồi');
  assert.deepEqual(service.missingFields, []);
  assert.doesNotMatch(copy(service), /HTTP|503|-90|Bổ sung/);
  assert.match(explainMapFailure({ dataset: { records: [] } }).title, /chưa có dữ liệu/);
  assert.match(explainMapFailure({ stage: 'read', error: new Error('Chưa hỗ trợ file .doc.') }).steps.join(' '), /docx/);
  const error = explainMapFailure({ stage: 'read', error: new Error('SyntaxError: secret_variable <script>alert(1)</script>') });
  assert.doesNotMatch(copy(error), /SyntaxError|secret_variable|script/);
});

test('unavailable 3D rendering and exceptions do not claim data is missing', () => {
  const graphics = explainMapFailure({ error: new Error('Arc Flow 3D cần WebGL2') });
  assert.match(graphics.title, /Trình duyệt/);
  assert.deepEqual(graphics.missingFields, []);
  const error = explainMapFailure({ error: new Error('TypeError: internalRenderer is undefined') });
  assert.match(error.reason, /gặp lỗi khi tạo bản đồ/);
  assert.doesNotMatch(copy(error), /internalRenderer|TypeError|vĩ độ/);
});

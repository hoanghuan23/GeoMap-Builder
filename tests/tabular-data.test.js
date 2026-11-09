import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTabularRecords, parseTimeValue, profileTabularData } from "../src/shared/import/tabular-data.js";

test("profile mặc định có mẫu và cho phép tắt samples/head", () => {
  const records = Array.from({ length: 20 }, (_, index) => ({ place: `P${index}`, value: index }));
  const profile = profileTabularData(records, { includeSamples: false });
  assert.equal(profile.samplesIncluded, false);
  assert.equal("head" in profile, false);
  assert.ok(profile.columns.every(column => !("samples" in column)));
  const shared = profileTabularData(records);
  assert.equal(shared.samplesIncluded, true);
  assert.equal(shared.head.length, 8);
  assert.equal(shared.columns[0].samples.length, 5);
});

test("profile quét toàn bộ dữ liệu và đánh dấu unique count bị chặn", () => {
  const profile = profileTabularData(Array.from({ length: 12 }, (_, value) => ({ value })), { uniqueCap: 5 });
  assert.equal(profile.columns[0].min, 0);
  assert.equal(profile.columns[0].max, 11);
  assert.equal(profile.columns[0].uniqueCount, 5);
  assert.equal(profile.columns[0].uniqueCountCapped, true);
});

test("không nhận nhầm measure trong khoảng Excel serial thành ngày", () => {
  const profile = profileTabularData([{ amount: 40_000 }, { amount: 40_001 }]);
  assert.equal(profile.columns[0].inferredType, "number");
  assert.equal(profile.columns[0].dateHint, null);
});

test("giữ Date hợp lệ, parse Excel/Unix và số thập phân dấu phẩy", () => {
  const original = new Date("2026-09-01T00:00:00Z");
  assert.equal(parseTimeValue(original, "excel_serial").toISOString(), original.toISOString());
  assert.equal(parseTimeValue(46266, "excel_serial").toISOString().slice(0, 10), "2026-09-01");
  assert.equal(parseTimeValue(46266, "iso").toISOString().slice(0, 10), "2026-09-01");
  assert.equal(parseTimeValue(1_788_220_800, "unix_s").toISOString().slice(0, 10), "2026-09-01");
  assert.equal(parseTimeValue("01/02/03"), null);
  const result = normalizeTabularRecords([{ date: 46266, rainfall: "12,5" }], [
    { name: "date", role: "time", timeParse: "excel_serial", granularity: "day" },
    { name: "rainfall", role: "measure" }
  ]);
  assert.equal(result.records[0].date.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(result.records[0].rainfall, 12.5);
});

test("giữ nhãn tháng thứ tự T01-T12 thay vì đổi thành null", () => {
  const result = normalizeTabularRecords([
    { "Tháng": "T01", value: 10 },
    { "Tháng": "T12", value: 20 }
  ], [
    { name: "Tháng", role: "time", timeParse: "text", granularity: "month" },
    { name: "value", role: "measure" }
  ]);

  assert.deepEqual(result.records.map(record => record["Tháng"]), ["T01", "T12"]);
  assert.equal(result.validRowRate["Tháng"], 1);
});

test("chuẩn hóa tọa độ geo dạng số và dấu phẩy, giữ nguyên địa danh và mã H3", () => {
  const result = normalizeTabularRecords([
    { lat: '21,2212', lng: '105,8072', country: 'Việt Nam', h3: '8928308280fffff' },
    { lat: '-33,9399', lng: '151,1753', country: 'Úc', h3: '8928308280bffff' },
    { lat: 0, lng: 0, country: '0', h3: '123456789012345' },
    { lat: '', lng: null, country: 'Không rõ', h3: null }
  ], [
    { name: 'lat', role: 'geo', geoLevel: 'point_lat' },
    { name: 'lng', role: 'geo', geoLevel: 'point_lng' },
    { name: 'country', role: 'geo', geoLevel: 'country' },
    { name: 'h3', role: 'geo', geoLevel: 'h3' }
  ]);
  assert.deepEqual(result.records.map(({ lat, lng }) => [lat, lng]), [[21.2212, 105.8072], [-33.9399, 151.1753], [0, 0], [null, null]]);
  assert.equal(result.validRowRate.lat, .75);
  assert.equal(result.validRowRate.lng, .75);
  assert.equal(result.records[0].country, 'Việt Nam');
  assert.equal(result.records[2].country, '0');
  assert.equal(result.records[2].h3, '123456789012345');
});

test("profile ngày có min/max chính xác và reservoir sampling lặp lại được", () => {
  const records = Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, index + 1)), value: index }));
  const first = profileTabularData(records, { includeSamples: true });
  const second = profileTabularData(records, { includeSamples: true });
  const date = first.columns.find(column => column.name === "date");
  assert.equal(date.min.slice(0, 10), "2026-09-01");
  assert.equal(date.max.slice(0, 10), "2026-09-30");
  assert.deepEqual(first.columns[1].samples, second.columns[1].samples);
});

test("address evidence preserves same-row identities, full addresses and Maps links beyond the head", () => {
  const records = Array.from({ length: 47 }, (_, index) => ({
    id: `P${index}`, name: "Cơ sở trùng tên",
    "Địa chỉ": `Số ${index + 1} đường Thử Nghiệm, khu vực ${index % 2 ? 'A' : 'B'}`,
    map: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Cơ sở trùng tên ${index}, ${'địa chỉ đối chiếu '.repeat(8)}`)}`
  }));
  const snapshot = structuredClone(records);
  const profile = profileTabularData(records);
  assert.equal(profile.head.length, 8);
  assert.equal(profile.scopeRows.length, 47);
  assert.deepEqual(profile.scopeRows, records);
  assert.ok(profile.scopeRows[46].map.length > 160);
  assert.equal(profile.scopeRowsTruncated, false);
  assert.deepEqual(records, snapshot);
  const privateProfile = profileTabularData(records, { includeSamples: false });
  assert.equal(privateProfile.scopeRows, undefined);
  assert.equal(privateProfile.scopeRowsTruncated, undefined);
  assert.ok(privateProfile.columns.every(column => !column.samples && !column.distinctValues));
});

for (const field of ['Địa chỉ', 'dia_chi', 'street_address']) {
  test(`address sampling is bounded and works without Maps links: ${field}`, () => {
    const records = Array.from({ length: 130 }, (_, index) => ({ id: `P${index}`, [field]: `${index + 1} Test Street` }));
    const profile = profileTabularData(records);
    assert.equal(profile.scopeRows.length, 100);
    assert.equal(profile.scopeRowsTruncated, true);
    assert.deepEqual(profile.scopeRows[99], records[99]);
  });
}

test("Maps links select evidence without relying on a column name; other links and email do not", () => {
  for (const url of [
    'https://www.google.com/maps/search/?api=1&query=Test', 'https://maps.google.com/?q=Test',
    'https://www.google.co.uk/maps/place/Test', 'https://maps.app.goo.gl/fixture', 'https://goo.gl/maps/fixture'
  ]) {
    const records = Array.from({ length: 12 }, (_, index) => ({ id: `P${index}`, reference: `${url}${index}` }));
    assert.equal(profileTabularData(records).scopeRows.length, 12);
  }
  assert.equal(profileTabularData([{ 'Email address': 'a@example.org', reference: 'https://example.org/page' }]).scopeRows, undefined);
  assert.equal(profileTabularData([{ reference: 'https://google.evil.com/maps/place/Test' }]).scopeRows, undefined);
});

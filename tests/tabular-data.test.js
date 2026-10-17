import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTabularRecords, parseTimeValue, profileTabularData } from "../src/tabular-data.js";

test("privacy mode mặc định không đưa samples/head vào profile", () => {
  const records = Array.from({ length: 20 }, (_, index) => ({ place: `P${index}`, value: index }));
  const profile = profileTabularData(records);
  assert.equal(profile.samplesIncluded, false);
  assert.equal("head" in profile, false);
  assert.ok(profile.columns.every(column => !("samples" in column)));
  const shared = profileTabularData(records, { includeSamples: true });
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

test("profile ngày có min/max chính xác và reservoir sampling lặp lại được", () => {
  const records = Array.from({ length: 30 }, (_, index) => ({ date: new Date(Date.UTC(2026, 8, index + 1)), value: index }));
  const first = profileTabularData(records, { includeSamples: true });
  const second = profileTabularData(records, { includeSamples: true });
  const date = first.columns.find(column => column.name === "date");
  assert.equal(date.min.slice(0, 10), "2026-09-01");
  assert.equal(date.max.slice(0, 10), "2026-09-30");
  assert.deepEqual(first.columns[1].samples, second.columns[1].samples);
});

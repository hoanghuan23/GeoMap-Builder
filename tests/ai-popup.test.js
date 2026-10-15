import test from "node:test";
import assert from "node:assert/strict";
import { aiPopupRows, createAiPopupContent } from "../src/ai-popup.js";
import { summarizeFeatureProperties } from "../src/feature-properties.js";

const columns = [
  { name: "province", role: "geo", labelVi: "Tỉnh/thành phố" },
  { name: "month", role: "time", labelVi: "Tháng", granularity: "month" },
  { name: "revenue", role: "measure", labelVi: "Doanh thu (triệu đồng)", unit: "triệu đồng" },
  { name: "temperature", role: "measure", labelVi: "Nhiệt độ trung bình", unit: "°C" },
  { name: "zero", role: "measure", labelVi: "Giá trị 0" },
  { name: "record_id", role: "id", labelVi: "Mã" },
  { name: "enabled", role: "category", labelVi: "Kích hoạt" },
  { name: "channel", role: "category", labelVi: "Kênh bán chính" },
  { name: "note", role: "text", labelVi: "Ghi chú" },
  { name: "empty", role: "text" },
  { name: "ignored", role: "ignore" }
];

test("popup dùng schema nguồn, giữ thứ tự và định dạng vai trò cột", () => {
  const rows = aiPopupRows({
    province: "Lào Cai",
    month: "2026-12-01T00:00:00.000Z",
    revenue: 4105,
    temperature: 30,
    zero: 0,
    record_id: 4105,
    enabled: false,
    channel: "Website",
    note: "<b>x</b>",
    empty: "   ",
    ignored: "không dùng",
    __metric: 30,
    boundary_source: "MapTiler"
  }, columns);

  assert.deepEqual(rows.map(row => row.field), [
    "province", "month", "revenue", "temperature", "zero", "record_id", "enabled", "channel", "note"
  ]);
  assert.equal(rows.find(row => row.field === "month").value, "12/2026");
  assert.equal(rows.find(row => row.field === "revenue").value, "4.105");
  assert.equal(rows.find(row => row.field === "temperature").value, "30 °C");
  assert.equal(rows.find(row => row.field === "zero").value, "0");
  assert.equal(rows.find(row => row.field === "record_id").value, "4105");
  assert.equal(rows.find(row => row.field === "enabled").value, "false");
  assert.equal(rows.find(row => row.field === "channel").label, "Kênh bán chính");
  assert.equal(rows.find(row => row.field === "note").value, "<b>x</b>");
});

test("popup định dạng thời gian theo granularity", () => {
  const properties = { day: "2026-12-01", week: "2026-12-01", month: "2026-12-01", year: "2026-12-01" };
  const rows = aiPopupRows(properties, [
    { name: "day", role: "time", granularity: "day" },
    { name: "week", role: "time", granularity: "week" },
    { name: "month", role: "time", granularity: "month" },
    { name: "year", role: "time", granularity: "year" }
  ]);
  assert.deepEqual(rows.map(row => row.value), ["01/12/2026", "Tuần 01/12/2026", "12/2026", "2026"]);
});

test("tổng hợp giữ 0 và false, đồng thời coi thiếu dữ liệu là một trạng thái", () => {
  const properties = summarizeFeatureProperties([
    { code: 0, enabled: false, channel: "Website", empty: "", ignored: "a" },
    { code: 0, enabled: false, channel: null, empty: null, ignored: "b" }
  ], [
    { name: "code", role: "id" },
    { name: "enabled", role: "category" },
    { name: "channel", role: "category" },
    { name: "empty", role: "text" },
    { name: "ignored", role: "ignore" }
  ]);
  assert.equal(properties.code, 0);
  assert.equal(properties.enabled, false);
  assert.equal(properties.channel, "Nhiều giá trị (2)");
  assert.equal(properties.empty, undefined);
  assert.equal(properties.ignored, undefined);
});

test("renderer ghi chuỗi HTML bằng textContent", () => {
  let innerHtmlWrites = 0;
  const documentRef = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        children: [],
        _textContent: "",
        set textContent(value) { this._textContent = String(value); },
        get textContent() { return this._textContent; },
        set innerHTML(_value) { innerHtmlWrites += 1; },
        append(...children) { this.children.push(...children); }
      };
    }
  };
  const card = createAiPopupContent(documentRef, {
    properties: { province: "Lào Cai", note: "<b>x</b>" }
  }, [columns[0], columns[8]], "province");
  const list = card.children[1];
  assert.equal(list.children[1].children[1].textContent, "<b>x</b>");
  assert.equal(innerHtmlWrites, 0);
});

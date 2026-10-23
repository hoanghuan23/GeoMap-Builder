import assert from "node:assert/strict";
import { legendFixture } from "./polygon-legend-fixture.js";

export const malariaText = `Báo cáo tình hình sốt rét tại một số quốc gia châu Á và Thái Bình Dương năm 2023
Theo báo cáo sốt rét thế giới năm 2024 của Tổ chức Y tế Thế giới (WHO), tình hình sốt rét tại các quốc gia trong khu vực châu Á và Thái Bình Dương tiếp tục có những khác biệt đáng kể trong năm 2023.
Campuchia ghi nhận khoảng 6.012 ca sốt rét ước tính, trong khi Lào ghi nhận 1.143 ca, thấp hơn Campuchia 4.869 ca. Việt Nam có số ca ước tính thấp hơn đáng kể, chỉ khoảng 373 ca trong cùng năm.
Tại khu vực Đông Bắc Á, Hàn Quốc ghi nhận khoảng 662 ca sốt rét ước tính, cao hơn Việt Nam 289 ca nhưng vẫn thấp hơn Lào. Trong khi đó, Vanuatu, một quốc đảo thuộc khu vực Thái Bình Dương, ghi nhận 5.748 ca, chỉ thấp hơn Campuchia 264 ca.
Malaysia duy trì không có ca sốt rét ở người do các loài ký sinh trùng sốt rét thông thường trong sáu năm liên tiếp tính đến năm 2023. Tuy nhiên, quốc gia này vẫn ghi nhận các trường hợp nhiễm ký sinh trùng Plasmodium knowlesi có nguồn gốc từ động vật, với 14 trường hợp tử vong do loài ký sinh trùng này trong năm 2023.
Xét về tử vong, Việt Nam không ghi nhận ca tử vong do sốt rét được báo cáo kể từ năm 2019. Campuchia cũng duy trì tình trạng không ghi nhận tử vong được báo cáo kể từ năm 2018.
Nhìn chung, Campuchia và Vanuatu có số ca sốt rét ước tính cao hơn các quốc gia còn lại được đề cập trong nhóm có dưới 10.000 ca. Việt Nam thuộc nhóm có số ca thấp, trong khi dữ liệu của Malaysia cần được phân loại riêng theo loại ký sinh trùng để tránh hiểu nhầm rằng quốc gia này hoàn toàn không còn sốt rét.`;

const factoryText = `Báo cáo năm 2024 về hoạt động năm 2023. Nhà máy A có sản lượng 1200 sản phẩm và ghi nhận 3 sự cố. Nhà máy B có sản lượng 800 sản phẩm, ghi nhận 2 sự cố do quá nhiệt, chưa nêu tổng sự cố mọi nguyên nhân. Nhà máy C có sản lượng 600 sản phẩm, không có dữ liệu về sự cố. Chi tiết nguyên nhân của nhà máy B là chú thích cho số sự cố được báo cáo, không phải bảng thống kê riêng theo nguyên nhân.`;
const breakdownText = `Năm 2023, nhà máy A có tổng cộng 10 sự cố, trong đó 2 sự cố do quá nhiệt. Nhà máy B có tổng cộng 20 sự cố, trong đó 5 sự cố do quá nhiệt. Báo cáo so sánh riêng hai chỉ số: tổng số sự cố và số sự cố do quá nhiệt giữa các nhà máy.`;
const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").toLowerCase();
const rowsOf = result => result.rawRecords || result.records;
const measuresOf = result => result.analysis.columns.filter(column => column.role === "measure");
const columnMatching = (result, pattern) => {
  const matches = measuresOf(result).filter(column => pattern.test(normalize(column.name)));
  assert.equal(matches.length, 1, `Expected one measure matching ${pattern}: ${measuresOf(result).map(column => column.name)}`);
  return matches[0].name;
};
const notesOf = (result, row) => result.analysis.columns.filter(column => column.role === "text")
  .map(column => row[column.name] ?? "").join(" ");

function output({ title, dimension, geoLevel, measures, rows }) {
  const fields = [dimension, ...measures.map(measure => measure.name), "Năm", "Ghi chú"];
  const defaults = { labelVi: null, geoLevel: null, country: null, timeParse: null, granularity: null, unit: null,
    unitSource: "unknown", aggDefault: null, semanticType: null, legend: null };
  const columns = [{ ...defaults, name: dimension, role: geoLevel ? "geo" : "category", geoLevel: geoLevel || null },
    ...measures.map(({ name, unit }) => ({ ...defaults, name, role: "measure", unit, unitSource: "explicit", aggDefault: "sum",
      legend: legendFixture({ title: name, unit, aggregation: "sum", mode: "auto", domain: [0, 1],
        stops: [{ value: 0, color: "#e2e8f0" }, { value: 1, color: "#475569" }] }) })),
    { ...defaults, name: "Năm", role: "time", timeParse: "text", granularity: "year" },
    { ...defaults, name: "Ghi chú", role: "text" }];
  const suggestions = geoLevel ? [{ id: "report", chartType: "choropleth", title: "Bản đồ Polygon", confidence: .95,
    bindings: { region: dimension, value: measures[0].name, lat: null, lng: null, x: null, y: null, series: null },
    agg: "sum", reason: "So sánh các số được báo cáo; giữ giới hạn phạm vi trong ghi chú.", legend: null,
    popupSuggestions: [{ name: "info", confidence: .95 }],
    metricButtons: measures.map(({ name }) => ({ field: name, label: name, icon: "📊", color: "#475569" })) }] : [];
  return { fields, rows, analysis: { datasetTitle: title, grain: "Một đối tượng trong một năm; ghi chú giữ phạm vi số liệu",
    columns, suggestions, search_bar: Boolean(geoLevel), search_fields: geoLevel ? [dimension] : [] } };
}

export const metricExtractionCases = [
  {
    id: "malaria-reported-measures", text: malariaText,
    output: () => output({ title: "Sốt rét năm 2023", dimension: "Quốc gia", geoLevel: "country",
      measures: [{ name: "Ca sốt rét ước tính", unit: "ca" }, { name: "Tử vong báo cáo", unit: "ca" }],
      rows: [["Campuchia", 6012, 0, 2023, "Không ghi nhận tử vong từ 2018"], ["Lào", 1143, null, 2023, null],
        ["Việt Nam", 373, 0, 2023, "Không ghi nhận tử vong từ 2019"], ["Hàn Quốc", 662, null, 2023, null],
        ["Vanuatu", 5748, null, 2023, null], ["Malaysia", null, 14, 2023,
          "14 ca tử vong do Plasmodium knowlesi; chưa nêu tổng tử vong mọi loài và tổng ca sốt rét tương ứng. Không có ca do các loài thông thường không có nghĩa là không còn mọi loại sốt rét."]] }),
    check(result) {
      assert.equal(measuresOf(result).length, 2, "a one-country qualifier must not create a third measure");
      assert.ok(measuresOf(result).every(column => !/knowles/.test(normalize(`${column.name} ${column.labelVi || ""}`))));
      const deaths = columnMatching(result, /tu vong/);
      const cases = columnMatching(result, /uoc tinh/);
      const country = result.analysis.columns.find(column => column.role === "geo" && column.geoLevel === "country")?.name;
      assert.ok(country, "country observations must retain their geographic identity");
      const rows = rowsOf(result);
      assert.equal(rows.length, 6, "publication and historical years must not become extra observations");
      for (const [name, expectedCases, expectedDeaths] of [
        ["Campuchia", 6012, 0], ["Lào", 1143, null], ["Việt Nam", 373, 0],
        ["Hàn Quốc", 662, null], ["Vanuatu", 5748, null], ["Malaysia", null, 14]
      ]) {
        const row = rows.find(row => normalize(row[country]) === normalize(name));
        assert.ok(row, `Missing country: ${name}`);
        assert.equal(row[cases], expectedCases, `${name}: estimated cases`);
        assert.equal(row[deaths], expectedDeaths, `${name}: reported deaths`);
        if (name === "Malaysia") assert.match(normalize(notesOf(result, row)), /knowles/);
      }
      for (const suggestion of result.analysis.suggestions) {
        assert.ok(suggestion.metricButtons.every(button => measuresOf(result).some(column => column.name === button.field)));
        assert.equal(suggestion.metricButtons.length, 2);
      }
    }
  },
  {
    id: "factory-qualifier", text: factoryText,
    output: () => output({ title: "Nhà máy năm 2023", dimension: "Nhà máy",
      measures: [{ name: "Sản lượng", unit: "sản phẩm" }, { name: "Sự cố được báo cáo", unit: "sự cố" }],
      rows: [["A", 1200, 3, 2023, null], ["B", 800, 2, 2023, "2 sự cố do quá nhiệt; chưa nêu tổng sự cố mọi nguyên nhân"], ["C", 600, null, 2023, null]] }),
    check(result) {
      assert.equal(measuresOf(result).length, 2);
      const incidents = columnMatching(result, /su co/);
      const production = columnMatching(result, /san luong/);
      assert.doesNotMatch(normalize(incidents), /qua nhiet/);
      const rows = rowsOf(result);
      assert.equal(rows.length, 3);
      for (const [index, expected] of [[0, 1200], [1, 800], [2, 600]]) assert.equal(rows.find(row => row[production] === expected)?.[incidents], [3, 2, null][index]);
      const b = rows.find(row => row[production] === 800);
      assert.match(normalize(notesOf(result, b)), /qua nhiet/);
      assert.match(normalize(notesOf(result, b)), /tong/);
    }
  },
  {
    id: "independent-total-and-subgroup", text: breakdownText,
    output: () => output({ title: "So sánh sự cố năm 2023", dimension: "Nhà máy",
      measures: [{ name: "Tổng sự cố", unit: "sự cố" }, { name: "Sự cố do quá nhiệt", unit: "sự cố" }],
      rows: [["A", 10, 2, 2023, null], ["B", 20, 5, 2023, null]] }),
    check(result) {
      assert.equal(measuresOf(result).length, 2, "independently defined total and subgroup must not be merged");
      const total = columnMatching(result, /tong/);
      const subgroup = columnMatching(result, /qua nhiet/);
      assert.notEqual(total, subgroup);
      const pairs = rowsOf(result).map(row => [row[total], row[subgroup]]).sort((a, b) => a[0] - b[0]);
      assert.deepEqual(pairs, [[10, 2], [20, 5]], "subgroup counts must not be added to totals");
    }
  }
];

import test from "node:test";
import assert from "node:assert/strict";
import countries from "../administrative_division/COUNTRY_REGIONS/country_regions.json" with { type: "json" };
import { buildCountryRegionNavigation, normalizeRegionNavigation, resolveCountryRegion } from "../src/country-regions.js";
import { profileTabularData } from "../src/tabular-data.js";
import { validateAndNormalizeAnalysis } from "../src/ai-chart-contract.js";

const sea = "subregion:South-eastern Asia";
const asia = "region:Asia";
const columns = [{ name: "country", role: "geo", geoLevel: "country" }, { name: "city", role: "geo", geoLevel: "admin1" }];
const config = { countryField: "country", regions: [sea, asia] };
const point = (country, coordinates = [105, 21]) => ({ type: "Feature", properties: { country }, geometry: { type: "Point", coordinates } });

test("country region matching supports the full source catalog, localized names, aliases, codes and annotations", () => {
  assert.equal(new Set(countries.map(country => country.iso3)).size, countries.length);
  assert.equal(new Set(countries.map(country => country.iso2)).size, countries.length);
  for (const country of countries) {
    for (const value of [country.name, country.iso3, country.iso2, new Intl.DisplayNames(["vi"], { type: "region" }).of(country.iso2)]) {
      assert.equal(resolveCountryRegion(value)?.iso3, country.iso3, value);
    }
  }
  for (const [name, iso3] of [["Việt Nam — quá cảnh", "VNM"], ["Trung Quốc (đảo Hải Nam)", "CHN"],
    ["viet nam", "VNM"], ["Miến Điện", "MMR"], ["Mỹ", "USA"], ["MY", "MYS"], ["Áo", "AUT"], ["AO", "AGO"],
    ["Guinea-Bissau", "GNB"], ["South Korea", "KOR"], ["Laos", "LAO"], ["Đông Timor", "TLS"]]) {
    assert.equal(resolveCountryRegion(name)?.iso3, iso3, name);
  }
  assert.equal(resolveCountryRegion("NGA")?.iso3, "NGA");
  assert.equal(resolveCountryRegion("Nga")?.iso3, "RUS");
  assert.equal(resolveCountryRegion("nga")?.iso3, "RUS");
  for (const value of ["Hà Nội", "Đông Nam Á", "not a country", "", null, 123]) assert.equal(resolveCountryRegion(value), null);
  assert.equal(resolveCountryRegion("ATA").region, null);
});

test("profile summarizes countries across the full column and never sends geography values when samples are disabled", () => {
  const values = ["Việt Nam", "VN", "VNM", "Lào", "Thái Lan", "Japan", "Germany", "unknown"];
  const records = values.flatMap(country => [{ country, value: 1 }, { country, value: 2 }]);
  const profile = profileTabularData(records, { maxSamples: 1, maxHead: 1 });
  const summary = profile.columns.find(column => column.name === "country").countryRegions;
  assert.equal(summary.countryCount, 5);
  assert.equal(summary.matchedValueCount, 7);
  assert.equal(summary.valueCount, 8);
  assert.deepEqual(summary.regions.find(region => region.id === sea), { id: sea, countryCount: 3 });
  assert.deepEqual(summary.regions.find(region => region.id === asia), { id: asia, countryCount: 4 });
  const privateProfile = profileTabularData(records, { includeSamples: false });
  assert.ok(privateProfile.columns.every(column => !Object.hasOwn(column, "countryRegions")));
  assert.equal(Object.hasOwn(privateProfile, "head"), false);
});

test("AI navigation survives server and client normalization and rejects unrelated columns or invalid region IDs", () => {
  const profile = { rowCount: 1, columns: columns.map(column => ({ name: column.name, inferredType: "text" })) };
  const raw = { columns, suggestions: [], regionNavigation: { ...config, regions: [sea, sea, "bogus", asia] } };
  const normalized = validateAndNormalizeAnalysis(raw, profile);
  assert.deepEqual(normalized.regionNavigation, config);
  assert.deepEqual(validateAndNormalizeAnalysis(normalized, profile).regionNavigation, config);
  for (const countryField of ["city", "missing", "__country"]) {
    assert.equal(normalizeRegionNavigation({ ...config, countryField }, columns), null);
  }
  for (const regions of [[], ["bogus"], null, "region:Asia"]) assert.equal(normalizeRegionNavigation({ ...config, regions }, columns), null);
  assert.equal(normalizeRegionNavigation(null, columns), null);
  assert.equal(normalizeRegionNavigation(config, [{ name: "country", role: "text" }]), null);
  assert.equal(validateAndNormalizeAnalysis({ ...raw, source: "rule" }, profile).regionNavigation, null);
  assert.equal(validateAndNormalizeAnalysis({ columns, suggestions: [] }, profile).regionNavigation, undefined);
});

test("region navigation intersects AI choices with the current layer data and deduplicates countries across layers", () => {
  const vn = point("Việt Nam"); const jp = point("JPN"); const unknown = point("unknown");
  const data = { type: "FeatureCollection", features: [vn, point("VN"), jp, unknown] };
  const layers = [{ data, columns, regionNavigation: config },
    { data: { features: [point("VNM"), point("Lào")] }, columns, regionNavigation: config }];
  const groups = buildCountryRegionNavigation(layers);
  assert.deepEqual(groups.map(group => [group.label, group.countryCount, group.features.length]), [
    ["Đông Nam Á", 2, 4], ["Châu Á", 3, 5]
  ]);
  assert.ok(groups.every(group => !group.features.includes(unknown)));
  assert.deepEqual(buildCountryRegionNavigation([{ ...layers[0], data: { features: [jp, vn] } }]).map(group => group.id), [sea, asia]);
  assert.deepEqual(buildCountryRegionNavigation([{ data, columns }]), []);
  assert.deepEqual(buildCountryRegionNavigation([{ ...layers[0], data: { features: [jp] } }]).map(group => group.id), [asia]);
  assert.deepEqual(buildCountryRegionNavigation([{ ...layers[0], data: { features: [unknown] } }]), []);
});

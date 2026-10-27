import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInfoImagePopup, popupImageUrls, pointDirectionsUrl } from '../src/info-image-popup.js';
import { normalizePopupContent, popupUrls } from '../src/popup-content-contract.js';
import { popupDisplayOptions } from '../src/ai-popup-chart.js';
import { validateAndNormalizeAnalysis, ANALYSIS_RESPONSE_SCHEMA } from '../src/ai-chart-contract.js';
import { popupAttributeRecords, imagePopupContent } from './fixtures/popup-attributes.js';

class Element {
  children = []; events = {}; attributes = {}; textContent = ''; hidden = false;
  constructor(tagName) { this.tagName = tagName; }
  set innerHTML(_) { assert.fail('data must never enter innerHTML'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, handler) { this.events[type] = handler; }
}
const documentRef = { createElement: tag => new Element(tag) };
const all = element => [element, ...element.children.flatMap(all)];
const find = (element, className) => all(element).find(child => child.className === className);
const geojson = JSON.parse(readFileSync(new URL('../dulieu_chua_mienbac.geojson', import.meta.url)));
const columns = Object.keys(geojson.features[0].properties).map(name => ({ name, role: 'text' }));
const sources = [{ title: 'GeoJSON', columns, records: [geojson.features[1].properties], popupContent: imagePopupContent },
  { title: 'Excel', columns: [...columns, { name: 'ghi_chu', role: 'text' }], records: popupAttributeRecords.slice(0, 2), popupContent: imagePopupContent }];

test('image URL parsing allows HTTP(S), arrays, newlines, semicolons and redirects, without requiring extensions', () => {
  assert.deepEqual(popupUrls(['https://example.org/a?id=1;https://example.org/b\nhttp://example.org/c', 'https://example.org/b',
    'javascript:alert(1)', 'data:image/png,a', '//example.org/a', 'file:///tmp/a']), ['https://example.org/a?id=1', 'https://example.org/b', 'http://example.org/c']);
  assert.deepEqual(popupUrls('["https://example.org/a","https://example.org/b"]'), ['https://example.org/a', 'https://example.org/b']);
  for (const feature of geojson.features) assert.equal(popupImageUrls([{ ...sources[0], records: [feature.properties] }]).length, 1);
  const images = popupImageUrls(sources);
  assert.equal(images.length, 4); assert.match(images[0], /utm_campaign/);
  assert.equal(images.some(url => url.includes('google.com')), false);
});

test('the renderer preserves separate sources and all descriptions, treats HTML as text and validates links', () => {
  const card = createInfoImagePopup(documentRef, { sources, coordinates: geojson.features[1].geometry.coordinates });
  assert.equal(all(card).find(child => child.tagName === 'h2').textContent, 'Chùa Trấn Quốc');
  assert.deepEqual(all(card).filter(child => child.className === 'info-image-source-label').map(child => child.textContent), ['Mục 1', 'Mục 2']);
  assert.equal(all(card).filter(child => child.className === 'info-image-description').length, 3);
  assert.ok(all(card).some(child => child.textContent === '<img src=x onerror=alert(1)>'));
  const directions = find(card, 'info-image-directions');
  assert.equal(directions.href, 'https://www.google.com/maps/dir/?api=1&destination=21.0479,105.837');
  assert.equal(directions.rel, 'noopener noreferrer');
  const bad = createInfoImagePopup(documentRef, { sources: [{ ...sources[0], records: [{ ten_chua: '<script>x</script>', hinh_anh: 'javascript:alert(1)', google_maps_url: 'data:text/html,x' }] }] });
  assert.equal(all(bad).some(child => child.tagName === 'img' || child.tagName === 'a'), false);
  assert.equal(all(bad).find(child => child.tagName === 'h2').textContent, '<script>x</script>');
});

test('carousel wraps using buttons and keyboard, exposes position, and keeps information readable after an error', () => {
  const card = createInfoImagePopup(documentRef, { sources });
  const media = find(card, 'info-image-media'); const counter = find(card, 'info-image-counter');
  const nav = find(card, 'info-image-navigation'); const frame = find(card, 'info-image-frame');
  const placeholder = find(card, 'info-image-placeholder');
  assert.equal(counter.textContent, '1 / 4'); assert.equal(nav.hidden, false);
  frame.children[0].events.error(); assert.equal(placeholder.textContent, 'Không tải được hình ảnh');
  assert.equal(find(card, 'info-image-body').children[0].textContent, 'Chùa Trấn Quốc');
  nav.children[2].events.click(); assert.equal(counter.textContent, '2 / 4');
  frame.children[0].events.load(); assert.equal(placeholder.hidden, true); assert.equal(frame.children[0].hidden, false);
  let prevented = 0;
  for (const [key, expected] of [['End', '4 / 4'], ['ArrowRight', '1 / 4'], ['ArrowLeft', '4 / 4'], ['Home', '1 / 4']]) {
    media.events.keydown({ key, preventDefault() { prevented++; } }); assert.equal(counter.textContent, expected);
  }
  assert.equal(prevented, 4); assert.equal(media.tabIndex, 0);
  nav.children[0].events.click(); assert.equal(counter.textContent, '4 / 4');
});

test('missing and single images hide navigation, and non-point geometry has no fabricated directions', () => {
  for (const value of ['', 'javascript:alert(1)', 'https://example.org/one']) {
    const card = createInfoImagePopup(documentRef, { sources: [{ ...sources[0], records: [{ ten_chua: 'A', hinh_anh: value }] }] });
    assert.equal(find(card, 'info-image-navigation').hidden, true);
    assert.equal(find(card, 'info-image-directions'), undefined);
    assert.ok(find(card, 'info-image-placeholder'));
  }
  for (const coordinates of [null, [181, 21], [105, 91], ['105', 21], [NaN, 21]]) assert.equal(pointDirectionsUrl(coordinates), null);
  assert.match(pointDirectionsUrl([0, 0]), /destination=0,0/);
});

test('popup metadata uses only exact real columns and survives both analysis normalization passes', () => {
  assert.ok(ANALYSIS_RESPONSE_SCHEMA.required.includes('popupContent'));
  const rawContent = { ...imagePopupContent, imageFields: ['hinh_anh', 'https://example.org/private', 'missing', 'hinh_anh'], titleField: 'missing' };
  assert.deepEqual(normalizePopupContent(rawContent, columns), { ...imagePopupContent, titleField: null });
  const profile = { columns, rowCount: 5 };
  const response = { datasetTitle: 'Các điểm tham quan', grain: 'Một điểm', columns, suggestions: [], popupContent: rawContent };
  const normalized = validateAndNormalizeAnalysis(response, profile);
  assert.deepEqual(validateAndNormalizeAnalysis(normalized, profile).popupContent, normalized.popupContent);
  const options = popupDisplayOptions({ popupContent: normalized.popupContent, popupSuggestions: [
    { name: 'info_image', confidence: .98 }, { name: 'info', confidence: .7 }, { name: 'bar', confidence: .2 }
  ] }, columns);
  assert.deepEqual(options.map(item => item.name), ['info_image', 'info', 'bar']);
  assert.equal(options[0].available, true);
  assert.equal(popupDisplayOptions({ popupSuggestions: [{ name: 'info_image', confidence: 1 }] }, columns)[0].name, 'info');
});

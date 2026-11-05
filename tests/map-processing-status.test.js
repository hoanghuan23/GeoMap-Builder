import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapProcessingStatus, MAP_PROCESSING_MESSAGE } from '../src/shared/ui/map-processing-status.js';

const notice = () => ({ textContent: '', hidden: true, setAttribute() {} });

test('one notice spans analysis, intermediate updates and delayed template application', () => {
  const element = notice();
  const status = createMapProcessingStatus(element);
  const finishAnalysis = status.begin();
  assert.equal(element.textContent, MAP_PROCESSING_MESSAGE);
  status.set('Đang phân tích...');
  assert.equal(element.textContent, MAP_PROCESSING_MESSAGE);
  const finishTemplate = status.begin();
  status.set('Đã thêm lớp dữ liệu.');
  finishAnalysis();
  assert.equal(element.textContent, MAP_PROCESSING_MESSAGE);
  assert.equal(element.hidden, false);
  finishTemplate();
  assert.equal(element.textContent, 'Đã thêm lớp dữ liệu.');
});

test('queued analyses keep the notice busy and finishing an operation twice is harmless', () => {
  const element = notice();
  const status = createMapProcessingStatus(element);
  const first = status.begin();
  const second = status.begin();
  status.set('');
  first(); first();
  assert.equal(element.textContent, MAP_PROCESSING_MESSAGE);
  second();
  assert.equal(element.hidden, true);
});

test('analysis failure ends the waiting notice without needing a template request', () => {
  const element = notice();
  const status = createMapProcessingStatus(element);
  const finish = status.begin();
  status.set('Không thể đọc dữ liệu.');
  finish();
  assert.equal(element.textContent, 'Không thể đọc dữ liệu.');
  assert.equal(element.hidden, false);
});

test('auto-hide timers cannot hide active analysis or template work', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const element = notice();
  const status = createMapProcessingStatus(element);
  status.set('Thông báo cũ', true);
  const finish = status.begin();
  status.set('Đã hoàn tất', true);
  t.mock.timers.tick(10_000);
  assert.equal(element.hidden, false);
  assert.equal(element.textContent, MAP_PROCESSING_MESSAGE);
  finish();
  assert.equal(element.textContent, 'Đã hoàn tất');
  t.mock.timers.tick(3500);
  assert.equal(element.hidden, true);
});

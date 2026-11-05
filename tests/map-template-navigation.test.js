import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapTemplateNavigation } from '../src/map-template-navigation.js';

test('2D templates disable rotation and tilt; 3D templates restore live map controls', () => {
  const calls = [];
  const handler = name => ({ enable: () => calls.push(`${name}:enable`), disable: () => calls.push(`${name}:disable`),
    enableRotation: () => calls.push(`${name}:enableRotation`), disableRotation: () => calls.push(`${name}:disableRotation`) });
  const map = { getMaxPitch: () => 85, dragRotate: handler('drag'), touchZoomRotate: handler('touch'), keyboard: handler('keyboard'),
    jumpTo: view => calls.push(view), setMaxPitch: value => calls.push(`pitch:${value}`) };
  const apply = createMapTemplateNavigation(map);
  apply('pan_zoom');
  assert.deepEqual(calls, ['drag:disable', 'touch:disableRotation', 'keyboard:disableRotation', { bearing: 0, pitch: 0 }, 'pitch:0']);
  calls.length = 0;
  apply('rotate_3d');
  assert.deepEqual(calls, ['drag:enable', 'touch:enableRotation', 'keyboard:enableRotation', 'pitch:85']);
});

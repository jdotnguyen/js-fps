import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.ts';

test('garbage storage falls back to defaults', () => {
  assert.deepEqual(mergeSettings('nope'), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
});

test('keeps valid values, drops wrong types and unknown options', () => {
  const s = mergeSettings({ fov: 90, invertY: 'yes', quality: 'ultra', subtitles: false, extra: 1 });
  assert.equal(s.fov, 90);
  assert.equal(s.invertY, false);
  assert.equal(s.quality, 'medium');
  assert.equal(s.subtitles, false);
  assert.ok(!('extra' in s));
});

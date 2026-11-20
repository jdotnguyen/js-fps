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

test('saves from before the bus volume settings load with full music, SFX and voice', () => {
  const s = mergeSettings({ masterVolume: 0.5, fov: 90 });
  assert.equal(s.masterVolume, 0.5);
  assert.equal(s.musicVolume, 1);
  assert.equal(s.sfxVolume, 1);
  assert.equal(s.voiceVolume, 1);
});

test('bus volumes keep valid values and drop out-of-range ones', () => {
  const s = mergeSettings({ musicVolume: 0.2, sfxVolume: 3, voiceVolume: -1 });
  assert.equal(s.musicVolume, 0.2);
  assert.equal(s.sfxVolume, 1);
  assert.equal(s.voiceVolume, 1);
});

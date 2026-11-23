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

test('physics switches default off and merge field by field (adopt-physics-engine D9)', () => {
  assert.deepEqual(DEFAULT_SETTINGS.physics, { debris: false, ragdoll: false, powered: false, interact: false });
  const s = mergeSettings({ physics: { debris: true, ragdoll: 'yes', cloth: true } });
  assert.deepEqual(s.physics, { debris: true, ragdoll: false, powered: false, interact: false });
  assert.ok(!('cloth' in s.physics));
  assert.deepEqual(mergeSettings({ physics: 'on' }).physics, DEFAULT_SETTINGS.physics);
  assert.notEqual(mergeSettings(null).physics, DEFAULT_SETTINGS.physics, 'a fresh object, never the frozen default');
});

test('physics switches survive a save round trip', () => {
  const saved = JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, physics: { debris: true, ragdoll: true, powered: false, interact: false } }));
  assert.deepEqual(mergeSettings(saved).physics, { debris: true, ragdoll: true, powered: false, interact: false });
});

test('eye adaptation defaults on, and settings saved before it existed load with it on (post-processing spec)', () => {
  assert.equal(DEFAULT_SETTINGS.eyeAdaptation, true);
  const old = mergeSettings({ fov: 90, filmGrain: false });
  assert.equal(old.eyeAdaptation, true);
  assert.equal(old.filmGrain, false);
  assert.equal(mergeSettings({ eyeAdaptation: false }).eyeAdaptation, false);
  assert.equal(mergeSettings({ eyeAdaptation: 'off' }).eyeAdaptation, true, 'a wrong type falls back to on');
});

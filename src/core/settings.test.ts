import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeSettings, PHYSICS_REVISION } from './settings.ts';

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

test('debris and interaction default on, and stored switches merge field by field (adopt-physics-engine D9)', () => {
  assert.deepEqual(DEFAULT_SETTINGS.physics, { debris: true, ragdoll: false, powered: false, interact: true });
  const s = mergeSettings({ physicsRevision: PHYSICS_REVISION, physics: { debris: false, ragdoll: 'yes', cloth: true } });
  assert.deepEqual(s.physics, { debris: false, ragdoll: false, powered: false, interact: true });
  assert.ok(!('cloth' in s.physics));
  assert.deepEqual(mergeSettings({ physicsRevision: PHYSICS_REVISION, physics: 'on' }).physics, DEFAULT_SETTINGS.physics);
  assert.notEqual(mergeSettings(null).physics, DEFAULT_SETTINGS.physics, 'a fresh object, never the frozen default');
});

test('a save written while physics defaulted off loads with the new defaults', () => {
  const old = mergeSettings({ fov: 90, physics: { debris: false, ragdoll: false, powered: false, interact: false } });
  assert.deepEqual(old.physics, DEFAULT_SETTINGS.physics);
  assert.equal(old.fov, 90);
});

test('physics switches survive a save round trip, including switched off', () => {
  const physics = { debris: false, ragdoll: true, powered: false, interact: false };
  const saved = JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, physics, physicsRevision: PHYSICS_REVISION }));
  assert.deepEqual(mergeSettings(saved).physics, physics);
});

test('eye adaptation defaults on, and settings saved before it existed load with it on (post-processing spec)', () => {
  assert.equal(DEFAULT_SETTINGS.eyeAdaptation, true);
  const old = mergeSettings({ fov: 90, filmGrain: false });
  assert.equal(old.eyeAdaptation, true);
  assert.equal(old.filmGrain, false);
  assert.equal(mergeSettings({ eyeAdaptation: false }).eyeAdaptation, false);
  assert.equal(mergeSettings({ eyeAdaptation: 'off' }).eyeAdaptation, true, 'a wrong type falls back to on');
});

test('HUD settings default for a save from before them, and stay inside their ranges (visor-hud D10)', () => {
  const old = mergeSettings({ fov: 90, filmGrain: false });
  assert.deepEqual([old.hudOpacity, old.hudScale, old.calmHud], [0.85, 1, true]);
  const kept = mergeSettings({ hudOpacity: 0.4, hudScale: 1.25, calmHud: false });
  assert.deepEqual([kept.hudOpacity, kept.hudScale, kept.calmHud], [0.4, 1.25, false]);
  const bad = mergeSettings({ hudOpacity: 0, hudScale: 4, calmHud: 'no' });
  assert.deepEqual([bad.hudOpacity, bad.hudScale, bad.calmHud], [0.85, 1, true]);
});

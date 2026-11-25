import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCURACY_DISTURBANCE, ACCURACY_PROFILES, WeaponAccuracy, type AccuracyStepInput } from './accuracy.ts';

function stepMany(acc: WeaponAccuracy, input: Omit<AccuracyStepInput, 'dt'>, seconds: number, hz = 60): void {
  const steps = Math.round(seconds * hz);
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) acc.step({ ...input, dt });
}

const BASE: Omit<AccuracyStepInput, 'dt'> = {
  weapon: 'pistol',
  aimBlend: 0,
  moveSpeed: 0,
  turnRate: 0,
  sprinting: false,
  reloading: false,
  armed: true,
};

test('rapid hipfire compounds bloom up to cap and decays when pausing', () => {
  const acc = new WeaponAccuracy();
  acc.step({ ...BASE, dt: 0.016 });
  const rested = acc.spreadRad;
  assert.equal(rested, ACCURACY_PROFILES.pistol.hipSpread);

  acc.onShot('pistol');
  const after1 = acc.spreadRad;
  assert.ok(after1 > rested, 'first shot widens spread');

  // Fire again before bloom recovers (0.24 s pistol interval).
  stepMany(acc, BASE, 0.12);
  acc.onShot('pistol');
  const after2 = acc.spreadRad;
  assert.ok(after2 > after1, 'rapid second shot compounds bloom');

  // Spam many shots: bloom clamps at bloomMax.
  for (let i = 0; i < 10; i++) acc.onShot('pistol');
  assert.ok(Math.abs(acc.bloom - ACCURACY_PROFILES.pistol.bloomMax) < 1e-9, 'bloom caps at bloomMax');

  // Pause long enough for full recovery.
  stepMany(acc, BASE, 2.0);
  assert.equal(acc.bloom, 0);
  assert.ok(Math.abs(acc.spreadRad - rested) < 1e-9, 'spread returns to rested hipfire baseline');
});

test('rapid ADS fire adds bloom and breaks built-up focus', () => {
  const acc = new WeaponAccuracy();
  const ads = { ...BASE, aimBlend: 1 };

  stepMany(acc, ads, ACCURACY_PROFILES.pistol.focusTime + 0.1);
  assert.equal(acc.focused, true);
  assert.ok(Math.abs(acc.spreadRad - ACCURACY_PROFILES.pistol.focusSpread) < 1e-6);

  acc.onShot('pistol');
  assert.equal(acc.focused, false, 'shot breaks focus');
  assert.equal(acc.focus, 0);
  const after1 = acc.spreadRad;
  assert.ok(after1 > ACCURACY_PROFILES.pistol.adsSpread, 'ADS shot widens spread above initial ADS baseline');

  stepMany(acc, ads, 0.1);
  acc.onShot('pistol');
  assert.ok(acc.spreadRad > after1, 'rapid ADS follow-up compounds bloom');
});

test('hold-to-focus tightens both pistol and shotgun spread when steady', () => {
  const pistol = new WeaponAccuracy();
  const pistolAds = { ...BASE, weapon: 'pistol' as const, aimBlend: 1 };
  pistol.step({ ...pistolAds, dt: 0.001 });
  const pistolStart = pistol.spreadRad;
  stepMany(pistol, pistolAds, ACCURACY_PROFILES.pistol.focusTime + 0.05);
  assert.equal(pistol.focused, true);
  assert.ok(pistol.spreadRad < pistolStart);
  assert.ok(Math.abs(pistol.spreadRad - ACCURACY_PROFILES.pistol.focusSpread) < 1e-6);

  const shotgun = new WeaponAccuracy();
  const shotgunAds = { ...BASE, weapon: 'shotgun' as const, aimBlend: 1 };
  shotgun.step({ ...shotgunAds, dt: 0.001 });
  const shotgunStart = shotgun.spreadRad;
  stepMany(shotgun, shotgunAds, ACCURACY_PROFILES.shotgun.focusTime + 0.05);
  assert.equal(shotgun.focused, true);
  assert.ok(shotgun.spreadRad < shotgunStart);
  assert.ok(Math.abs(shotgun.spreadRad - ACCURACY_PROFILES.shotgun.focusSpread) < 1e-6);
});

test('movement slows focus, sharp flicks shed focus, and gentle micro-tracking is tolerated', () => {
  const still = new WeaponAccuracy();
  const moving = new WeaponAccuracy();
  const tracking = new WeaponAccuracy();
  const halfTime = ACCURACY_PROFILES.pistol.focusTime * 0.5;

  stepMany(still, { ...BASE, aimBlend: 1 }, halfTime);
  stepMany(moving, { ...BASE, aimBlend: 1, moveSpeed: 2.0 }, halfTime);
  stepMany(tracking, { ...BASE, aimBlend: 1, turnRate: ACCURACY_DISTURBANCE.turnFreeRate * 0.8 }, halfTime);

  assert.ok(Math.abs(tracking.focus - still.focus) < 1e-6, 'gentle micro-tracking matches standing still');
  assert.ok(moving.focus > 0 && moving.focus < still.focus * 0.6, 'walking slows focus without wiping it');

  // Sharp flick sheds built-up focus.
  const beforeFlick = still.focus;
  stepMany(still, { ...BASE, aimBlend: 1, turnRate: ACCURACY_DISTURBANCE.turnFlickRate + 0.5 }, 0.2);
  assert.ok(still.focus < beforeFlick, 'sharp flick sheds focus');
});

test('sprinting, reloading, and switching weapons clear focus', () => {
  const acc = new WeaponAccuracy();
  const ads = { ...BASE, aimBlend: 1 };

  stepMany(acc, ads, 1.0);
  assert.equal(acc.focused, true);
  acc.step({ ...ads, dt: 0.016, sprinting: true });
  assert.equal(acc.focus, 0);
  assert.equal(acc.suppressed, true);

  stepMany(acc, ads, 1.0);
  assert.equal(acc.focused, true);
  acc.step({ ...ads, dt: 0.016, reloading: true });
  assert.equal(acc.focus, 0);
  assert.equal(acc.suppressed, true);

  stepMany(acc, ads, 1.0);
  assert.equal(acc.focused, true);
  acc.step({ ...ads, dt: 0.016, weapon: 'shotgun' });
  assert.equal(acc.focus, 0);
  assert.equal(acc.weapon, 'shotgun');
});

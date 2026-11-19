import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flickerIntensity, sweepProgress, VISOR_ACT_LENGTH } from './splashVisor.ts';

test('flickerIntensity ramps from 0, dips during ignition, and settles near 1', () => {
  assert.equal(flickerIntensity(0), 0);
  assert.ok(flickerIntensity(0.36) < flickerIntensity(0.22), 'first voltage dip');
  assert.ok(flickerIntensity(0.78) < flickerIntensity(0.6), 'second voltage dip');
  const settled = flickerIntensity(VISOR_ACT_LENGTH - 0.1);
  assert.ok(settled >= 0.95 && settled <= 1.05, `settled=${settled}`);
});

test('sweepProgress is monotonic from 0 to 1', () => {
  assert.equal(sweepProgress(0), 0);
  assert.ok(sweepProgress(0.8) > sweepProgress(0.3));
  assert.equal(sweepProgress(VISOR_ACT_LENGTH), 1);
});

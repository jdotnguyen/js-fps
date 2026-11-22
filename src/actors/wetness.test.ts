import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRY_RATE, stepWetHeight, wetLine } from './wetness.ts';

// standing-water spec "Bodies stay wet" (overhaul-flooded-tunnel D7).

test('the wet line jumps to the deepest the body has waded and stays while it wades shallower', () => {
  let w = 0;
  w = stepWetHeight(w, 0.3, 1 / 60);
  w = stepWetHeight(w, 0.75, 1 / 60);
  assert.equal(w, 0.75);
  w = stepWetHeight(w, 0.5, 1 / 60);
  assert.ok(w > 0.74, 'wading shallower does not dry the legs above the water');
});

test('out of the water it dries over about a minute', () => {
  let w = 0.6;
  for (let i = 0; i < 30 * 60; i++) w = stepWetHeight(w, 0, 1 / 60);
  assert.ok(Math.abs(w - (0.6 - DRY_RATE * 30)) < 1e-6, `half dry after 30 s (${w})`);
  for (let i = 0; i < 40 * 60; i++) w = stepWetHeight(w, 0, 1 / 60);
  assert.equal(w, 0);
});

test('the line sits that high above the feet, and far below anything when dry', () => {
  assert.ok(Math.abs(wetLine(-1.2, 0.75, -1e4) - -0.45) < 1e-9);
  assert.equal(wetLine(-1.2, 0, -1e4), -1e4);
});

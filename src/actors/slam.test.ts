import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLAM, SlamState, slamFalloff } from './slam.ts';

const DT = 1 / 60;
const runUntilIdle = (s: SlamState, max = 600): { impacts: number; steps: number } => {
  let impacts = 0;
  let steps = 0;
  while (s.busy && steps < max) {
    if (s.update(DT)) impacts++;
    steps++;
  }
  return { impacts, steps };
};

test('a slam only starts in range, roughly in front, and off cooldown', () => {
  const s = new SlamState();
  assert.equal(s.start(SLAM.range + 0.1, 0), false, 'too far');
  assert.equal(s.start(1, SLAM.arc + 0.1), false, 'target off to the side');
  assert.equal(s.start(1, 0.1), true);
  assert.equal(s.start(1, 0.1), false, 'already slamming');
});

test('windup, strike, recover: the impact happens exactly once, after the windup', () => {
  const s = new SlamState();
  s.start(1, 0);
  let t = 0;
  let impactAt = -1;
  while (s.busy) {
    t += DT;
    if (s.update(DT)) impactAt = t;
  }
  assert.ok(Math.abs(impactAt - (SLAM.windup + SLAM.strike)) < 2 * DT, `impact at ${impactAt}`);
  assert.ok(Math.abs(t - (SLAM.windup + SLAM.strike + SLAM.recover)) < 2 * DT, `finished at ${t}`);
  const fresh = new SlamState();
  fresh.start(1, 0);
  assert.equal(runUntilIdle(fresh).impacts, 1);
});

test('after a slam it cannot slam again until the cooldown runs out', () => {
  const s = new SlamState();
  s.start(1, 0);
  runUntilIdle(s);
  assert.equal(s.start(1, 0), false);
  for (let t = 0; t < SLAM.cooldown + 0.05; t += DT) s.update(DT);
  assert.equal(s.start(1, 0), true);
});

test('a cancelled slam never lands and goes on cooldown', () => {
  const s = new SlamState();
  s.start(1, 0);
  for (let i = 0; i < 10; i++) s.update(DT);
  s.cancel();
  assert.equal(s.busy, false);
  assert.equal(s.start(1, 0), false);
  assert.equal(runUntilIdle(s).impacts, 0);
});

test('damage is full in the core, falls off smoothly, and is zero past the radius', () => {
  assert.equal(slamFalloff(0), 1);
  assert.equal(slamFalloff(SLAM.radius * SLAM.core), 1);
  assert.equal(slamFalloff(SLAM.radius), 0);
  assert.equal(slamFalloff(SLAM.radius + 1), 0);
  let prev = 1;
  for (let d = SLAM.radius * SLAM.core; d <= SLAM.radius; d += 0.02) {
    const f = slamFalloff(d);
    assert.ok(f <= prev + 1e-9, 'never rises with distance');
    prev = f;
  }
});

test('a slam started at the edge of range reaches the target', () => {
  // The target stands at `range` in front; the impact lands at `reach`.
  assert.ok(slamFalloff(SLAM.range - SLAM.reach) > 0.5, 'a target at the trigger range is hit hard');
});

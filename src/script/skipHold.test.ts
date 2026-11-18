import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkipHold } from './skipHold.ts';

const HOLD = { seconds: 3, assist: false };
const ASSIST = { seconds: 3, assist: true };
const none = { held: false, pressed: false };
const down = { held: true, pressed: false };
const tap = { held: true, pressed: true };

function run(s: SkipHold, seconds: number, input: typeof none, opts: typeof HOLD, dt = 0.1): boolean {
  let fired = false;
  for (let t = 0; t < seconds - 1e-9; t += dt) fired = s.update(dt, input, opts) || fired;
  return fired;
}

test('holding for the full time fires exactly once, and not before', () => {
  const s = new SkipHold();
  assert.equal(run(s, 2.7, down, HOLD), false);
  assert.ok(s.progress > 0.85 && s.progress < 1);
  assert.equal(run(s, 0.5, down, HOLD), true);
  assert.equal(s.progress, 1);
  assert.equal(run(s, 1, down, HOLD), false, 'does not fire again');
});

test('progress is proportional to hold time (so the bar tells the truth)', () => {
  const s = new SkipHold();
  run(s, 1.5, down, HOLD);
  assert.ok(Math.abs(s.progress - 0.5) < 0.02);
});

test('releasing drains the bar at 3x speed and a tap cannot build up', () => {
  const s = new SkipHold();
  run(s, 1.5, down, HOLD);
  run(s, 0.5, none, HOLD);
  assert.ok(Math.abs(s.progress - 0) < 0.02, `drained: ${s.progress}`);
  for (let i = 0; i < 20; i++) {
    run(s, 0.3, down, HOLD);
    run(s, 0.3, none, HOLD);
  }
  assert.equal(s.progress < 1, true);
});

test('a configurable hold time is respected', () => {
  const s = new SkipHold();
  assert.equal(run(s, 1.4, down, { seconds: 1.5, assist: false }), false);
  assert.equal(run(s, 0.2, down, { seconds: 1.5, assist: false }), true);
});

test('assist mode: one press runs the countdown without holding', () => {
  const s = new SkipHold();
  s.update(0.1, tap, ASSIST);
  assert.equal(s.armed, true);
  assert.equal(run(s, 2.7, none, ASSIST), false);
  assert.equal(run(s, 0.4, none, ASSIST), true);
});

test('assist mode: pressing again cancels and drains', () => {
  const s = new SkipHold();
  s.update(0.1, tap, ASSIST);
  run(s, 1, none, ASSIST);
  s.update(0.1, tap, ASSIST);
  assert.equal(s.armed, false);
  run(s, 1, none, ASSIST);
  assert.equal(s.progress, 0);
});

test('reset clears everything for the next scene', () => {
  const s = new SkipHold();
  run(s, 4, down, HOLD);
  s.reset();
  assert.equal(s.progress, 0);
  assert.equal(run(s, 3.1, down, HOLD), true);
});

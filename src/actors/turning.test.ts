import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRAWL_TURN, newTurnState, settleTurn, stepTurn } from './turning.ts';

const DT = 1 / 60;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Run the steering toward a fixed target heading; returns the log of heading and speed factor per step. */
function run(start: number, target: number, steps: number): Array<{ heading: number; speed: number; inPlace: boolean; vel: number }> {
  const s = newTurnState();
  let heading = start;
  const log = [];
  for (let i = 0; i < steps; i++) {
    const r = stepTurn(s, wrap(target - heading), DT, CRAWL_TURN);
    heading += r.dHeading;
    log.push({ heading, speed: r.speedFactor, inPlace: s.inPlace, vel: s.vel });
  }
  return log;
}

test('a target far off the heading is turned to in place first, with no forward speed', () => {
  const log = run(0, Math.PI * 0.8, 40);
  assert.ok(log.every((l) => l.speed === 0), 'no forward motion while pivoting');
  assert.ok(log.every((l) => l.inPlace));
});

test('once facing the target the body moves off, and does not creep before then', () => {
  const log = run(0, Math.PI * 0.8, 600);
  const firstMove = log.findIndex((l) => l.speed > 0);
  assert.ok(firstMove > 0, 'it moves eventually');
  const heading = (log[firstMove]?.heading ?? 0) - Math.PI * 0.8;
  assert.ok(Math.abs(wrap(heading)) < CRAWL_TURN.end + 0.02, `moved off with ${Math.abs(wrap(heading))} rad of error`);
  assert.equal(log[600 - 1]?.inPlace, false);
});

test('the turn eases in and out: no jump in turn speed from one step to the next', () => {
  const log = run(0, Math.PI * 0.6, 300);
  let worst = 0;
  for (let i = 1; i < log.length; i++) worst = Math.max(worst, Math.abs((log[i]?.vel ?? 0) - (log[i - 1]?.vel ?? 0)));
  assert.ok(worst < 0.25, `turn speed changed by ${worst} rad/s in one step`);
  assert.ok(Math.abs(log[0]?.vel ?? 1) < CRAWL_TURN.rate * 0.2, 'starts well below the top turn speed');
});

test('the turn settles on the target without swinging past it', () => {
  const target = Math.PI * 0.6;
  const log = run(0, target, 600);
  const over = Math.max(...log.map((l) => l.heading - target));
  assert.ok(over < 0.03, `overshoots by ${over} rad`);
  assert.ok(Math.abs((log[599]?.heading ?? 0) - target) < 0.02);
});

test('turns either way: a target on the right turns right', () => {
  const log = run(0, -Math.PI * 0.7, 30);
  assert.ok((log[29]?.heading ?? 0) < 0);
  assert.ok((log[29]?.vel ?? 0) < 0);
});

test('a small error is steered gently while moving, not pivoted', () => {
  const log = run(0, 0.3, 120);
  assert.ok(log.every((l) => !l.inPlace));
  assert.ok(log.every((l) => l.speed > 0.7), 'keeps most of its speed');
});

test('the in-place state does not flicker between start and end thresholds', () => {
  const s = newTurnState();
  stepTurn(s, CRAWL_TURN.start + 0.05, DT, CRAWL_TURN);
  assert.equal(s.inPlace, true);
  stepTurn(s, (CRAWL_TURN.start + CRAWL_TURN.end) / 2, DT, CRAWL_TURN);
  assert.equal(s.inPlace, true, 'stays pivoting until the error is small');
  stepTurn(s, CRAWL_TURN.end - 0.05, DT, CRAWL_TURN);
  assert.equal(s.inPlace, false);
});

test('with no target the turn dies away', () => {
  const s = newTurnState();
  for (let i = 0; i < 20; i++) stepTurn(s, 2, DT, CRAWL_TURN);
  assert.ok(s.vel > 0);
  for (let i = 0; i < 120; i++) settleTurn(s, DT, CRAWL_TURN);
  assert.equal(s.vel, 0);
  assert.equal(s.inPlace, false);
});

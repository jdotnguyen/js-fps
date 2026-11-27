import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EASE_S, KillRoute, yawAlong } from './killRoute.ts';

// voss-death-scene D3: the route curve and its timing (infection-kills "A clip beat can carry the victim along a route").

const MARKS = [
  { x: 0, z: -2.4, t: 2 },
  { x: -1.2, z: -4.2, t: 3.5 },
  { x: -1.5, z: -5, t: 4.5 },
];

test('On her marks: she is on each mark at its time, and on the start before the route begins', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 0, MARKS);
  for (const m of MARKS) {
    const p = r.pointAt(m.t);
    assert.ok(Math.hypot(p.x - m.x, p.z - m.z) < 1e-6, `at ${m.t} s she is ${Math.hypot(p.x - m.x, p.z - m.z)} m off`);
  }
  assert.deepEqual(r.pointAt(0), { x: 0, z: 0 });
  assert.deepEqual(r.pointAt(9), { x: -1.5, z: -5 });
});

test('No snap: at 60 fps she never moves more than 0.15 m a frame, eases out of the start and into the last mark', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 0, MARKS);
  let prev = r.pointAt(0);
  let most = 0;
  for (let f = 1; f <= 6 * 60; f++) {
    const p = r.pointAt(f / 60);
    most = Math.max(most, Math.hypot(p.x - prev.x, p.z - prev.z));
    prev = p;
  }
  assert.ok(most <= 0.15, `largest step ${most.toFixed(3)} m`);
  assert.ok(r.speedAt(0.001) < 0.05 && r.speedAt(4.499) < 0.05, 'she starts and stops at rest');
  assert.ok(r.speedAt(2) > 0.5, `she passes through a mark on the way without stopping (${r.speedAt(2).toFixed(2)} m/s)`);
});

test('she never runs back along the path, even with a short leg between long ones', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 0, [{ x: 0, z: -3, t: 1 }, { x: 0.05, z: -3.1, t: 2 }, { x: 0, z: -6, t: 3 }]);
  let along = -Infinity;
  for (let f = 0; f <= 180; f++) {
    const z = -r.pointAt(f / 60).z;
    assert.ok(z >= along - 1e-6, `at ${(f / 60).toFixed(2)} s she went back (${z} after ${along})`);
    along = z;
  }
});

test('a mark she stays on is a stop: she arrives at rest and holds it until the next leg', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 0, [{ x: 0, z: -2, t: 1.5 }, { x: 0, z: -2, t: 2.5 }, { x: 1, z: -3, t: 3.5 }]);
  assert.ok(r.speedAt(1.499) < 0.05);
  for (const t of [1.6, 2, 2.4]) assert.ok(Math.hypot(r.pointAt(t).x, r.pointAt(t).z + 2) < 1e-6, `held at ${t} s`);
});

test('facing: along the way she goes, turning to a mark\'s facing as she arrives and keeping it there', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 1, [{ x: 0, z: -2, t: 1 }, { x: 0, z: -4, t: 2, face: { yaw: Math.PI / 2 } }, { x: 2, z: -4, t: 3, face: { at: { x: 2, z: 0 } } }]);
  const near = (a: number, b: number): boolean => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.05;
  assert.ok(near(r.yawAt(0.6, r.pointAt(0.6), 0), yawAlong(0, -1)), 'down -Z on the first leg');
  assert.ok(near(r.yawAt(2, r.pointAt(2), 0), Math.PI / 2), 'the yaw asked for at the second mark');
  const end = r.pointAt(4);
  assert.ok(near(r.yawAt(4, end, 0), yawAlong(0, 4)), 'turned to the point asked for at the last, and holds it');
  assert.ok(near(r.yawAt(0, r.pointAt(0), 0), 1), 'before she moves, as the beat found her');
});

test('legs: their lengths and cruise speeds (for the clip speed check); she cruises at it between short ramps', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 0, [{ x: 0, z: -2, t: 2 }, { x: 0, z: -2, t: 3 }]);
  assert.equal(r.legs.length, 2);
  // 2 m in 2 s, from rest to rest, with EASE_S ramps at both ends: 2 / (2 - EASE_S).
  const cruise = 2 / (2 - EASE_S);
  assert.ok(Math.abs(r.legs[0]!.length - 2) < 1e-3 && Math.abs(r.legs[0]!.speed - cruise) < 1e-3, `${r.legs[0]!.speed}`);
  for (const t of [0.6, 1, 1.4]) assert.ok(Math.abs(r.speedAt(t) - cruise) < 0.01, `steady at ${t} s (${r.speedAt(t).toFixed(3)} m/s)`);
  assert.equal(r.legs[1]!.length, 0);
});

test('passing through a mark she keeps going: no stop, and no jump in speed', () => {
  const r = new KillRoute({ x: 0, z: 0 }, 0, MARKS);
  for (const m of MARKS.slice(0, 2)) {
    const before = r.speedAt(m.t - 0.002);
    const after = r.speedAt(m.t + 0.002);
    assert.ok(before > 0.5 && Math.abs(before - after) < 0.05, `at ${m.t} s: ${before.toFixed(3)} then ${after.toFixed(3)} m/s`);
  }
});

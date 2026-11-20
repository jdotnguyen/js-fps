import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxColliders, DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import { catmullRom, clearChain, PathFollower, roundCorners } from './walkPath.ts';
import type { P3 } from './nav.ts';

const P = (x: number, z: number): P3 => ({ x, y: 0, z });

test('catmullRom passes through every control point, evenly sampled', () => {
  const c = [P(0, 0), P(2, 0), P(3, 2), P(3, 5)];
  const pts = catmullRom(c);
  for (const k of c) assert.ok(pts.some((p) => Math.hypot(p.x - k.x, p.z - k.z) < 1e-6), `through ${k.x},${k.z}`);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z) < 0.35);
});

// An L corridor: walk east, turn north round a pillar's corner.
const floor = { min: [-5, -0.2, -5] as [number, number, number], max: [10, 0, 10] as [number, number, number] };
const pillar = { min: [3, 0, 1] as [number, number, number], max: [6, 3, 6] as [number, number, number] };
const world = new BoxColliders([floor, pillar]);

test('roundCorners rounds a nav corner without clipping the pillar at body radius', () => {
  // String-pulled path hugging the pillar corner at 0.45 m.
  const from = P(0, 0.55);
  const path = [P(6.45, 0.55), P(6.45, 8)];
  const dense = roundCorners(from, path, { world, radius: DEFAULT_MOTOR.radius });
  assert.ok(clearChain(world, dense, DEFAULT_MOTOR.radius), 'clear at body radius');
  // It actually rounded: no sample sits on the sharp corner.
  assert.ok(!dense.some((p) => Math.hypot(p.x - 6.45, p.z - 0.55) < 0.05), 'corner rounded');
  const last = dense[dense.length - 1]!;
  assert.ok(Math.hypot(last.x - 6.45, last.z - 8) < 1e-6);
});

test('PathFollower slows into the turn and eases to a stop at the spot, never overshooting', () => {
  const dense = roundCorners(P(0, 0.55), [P(6.45, 0.55), P(6.45, 8)], { world, radius: DEFAULT_MOTOR.radius });
  const f = new PathFollower(dense, { speed: 1.4 });
  const body: MotorState = { x: 0, y: 0, z: 0.55, vy: 0, grounded: true };
  let maxCruise = 0;
  let cornerSpeed = Infinity;
  let t = 0;
  let done = false;
  for (let i = 0; i < 30 * 30 && !done; i++) {
    const st = f.update(body.x, body.z, 1 / 30);
    done = st.done;
    const dx = st.tx - body.x;
    const dz = st.tz - body.z;
    const d = Math.hypot(dx, dz) || 1;
    const before = { x: body.x, z: body.z };
    moveBody(body, (dx / d) * st.speed / 30, (dz / d) * st.speed / 30, 1 / 30, DEFAULT_MOTOR, world);
    const moved = Math.hypot(body.x - before.x, body.z - before.z);
    assert.ok(moved >= st.speed / 30 * 0.9 - 1e-9, `no wall contact at ${body.x.toFixed(2)},${body.z.toFixed(2)}`);
    if (body.x < 3) maxCruise = Math.max(maxCruise, st.speed);
    if (Math.hypot(body.x - 6.3, body.z - 0.7) < 0.4) cornerSpeed = Math.min(cornerSpeed, st.speed);
    t += 1 / 30;
  }
  assert.ok(done, 'arrived');
  assert.ok(Math.hypot(body.x - 6.45, body.z - 8) < 0.2, `at the spot (${body.x.toFixed(2)},${body.z.toFixed(2)})`);
  assert.ok(maxCruise > 1.3, `cruises (${maxCruise.toFixed(2)})`);
  assert.ok(cornerSpeed < maxCruise * 0.85, `slows in the turn (${cornerSpeed.toFixed(2)})`);
  assert.ok(f.speed < 0.6, 'eased in to the stop');
});

test('PathFollower starts from a stand gently and keeps a re-plan moving', () => {
  const f = new PathFollower(catmullRom([P(0, 0), P(10, 0)]), { speed: 1.4 });
  assert.ok(f.update(0, 0, 1 / 30).speed < 0.2);
  const g = new PathFollower(catmullRom([P(0, 0), P(10, 0)]), { speed: 1.4, v0: 1.3 });
  assert.ok(g.update(0, 0, 1 / 30).speed > 1.2);
});

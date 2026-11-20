import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airStep, DEFAULT_MOTOR, jumpApex, jumpHold, moveBody, type MotorState } from './motor.ts';
import { SIM_STEP } from '../core/loop.ts';
import { CollisionWorld } from '../world/collision.ts';

function floor(): CollisionWorld {
  const w = new CollisionWorld();
  w.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'metal');
  return w;
}

function jump(s: MotorState): void {
  s.vy = DEFAULT_MOTOR.jumpSpeed;
  s.grounded = false;
  s.jumping = true;
}

const WALK = 3.2;
const SPRINT = 5;
const R = DEFAULT_MOTOR.radius;

interface Run {
  s: MotorState;
  /** stepUp reported on the landing step. */
  landStepUp: number;
}

/**
 * Jump toward +x at `speed` from a sweep of start points (so one of them reaches the box at the top of the arc) and
 * run each until it lands. The box under test starts at x = 1.
 */
function jumpRuns(w: CollisionWorld, speed: number, fromY = 0): Run[] {
  const runs: Run[] = [];
  for (let x0 = -1.5; x0 <= 1 - R; x0 += 0.01) {
    const s: MotorState = { x: x0, y: fromY, z: 0, vy: 0, grounded: true };
    jump(s);
    let landStepUp = 0;
    for (let i = 0; i < 120 && !s.grounded; i++) landStepUp = moveBody(s, speed * SIM_STEP, 0, SIM_STEP, DEFAULT_MOTOR, w).stepUp;
    runs.push({ s, landStepUp });
  }
  return runs;
}

const mounts = (w: CollisionWorld, top: number, speed: number, fromY = 0): boolean =>
  jumpRuns(w, speed, fromY).some((r) => r.s.grounded && Math.abs(r.s.y - top) < 1e-6);

/** Every run is stopped in front of the box at x = 1 and lands back on the floor at `floorY`. */
function assertBlocked(w: CollisionWorld, speed: number, label: string, floorY = 0): void {
  for (const { s } of jumpRuns(w, speed, floorY)) {
    assert.ok(s.grounded && Math.abs(s.y - floorY) < 1e-6, `${label}: landed at y ${s.y.toFixed(3)}`);
    assert.ok(s.x <= 1 - R + 0.01, `${label}: got to x ${s.x.toFixed(3)}`);
  }
}

function withBox(top: number): CollisionWorld {
  const w = floor();
  w.add({ min: [1, 0, -2], max: [3, top, 2] }, 'box');
  return w;
}

test('a jump rises about jumpSpeed^2 / 2g, then lands back on the floor', () => {
  const w = floor();
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  jump(s);
  let apex = 0;
  let frames = 0;
  while (!s.grounded && frames++ < 600) {
    moveBody(s, 0, 0, 1 / 60, DEFAULT_MOTOR, w);
    apex = Math.max(apex, s.y);
  }
  const expected = DEFAULT_MOTOR.jumpSpeed ** 2 / (2 * DEFAULT_MOTOR.gravity);
  assert.ok(Math.abs(apex - expected) < 0.05, `apex ${apex.toFixed(2)} vs ${expected.toFixed(2)}`);
  assert.ok(s.grounded && s.y === 0 && s.vy === 0, 'lands on the floor');
  assert.ok(frames > 20 && frames < 60, `airtime ${frames} frames`);
});

test('a jump clears a knee-high crate but not a full-height wall', () => {
  const w = floor();
  w.add({ min: [1, 0, -1], max: [2, 0.55, 1] }, 'crate');
  w.add({ min: [4, 0, -1], max: [4.3, 2.5, 1] }, 'wall');
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  jump(s);
  for (let i = 0; i < 60 && s.x < 2.6; i++) moveBody(s, 0.08, 0, 1 / 60, DEFAULT_MOTOR, w);
  assert.ok(s.x > 1.6, `got up onto or past the crate (x ${s.x.toFixed(2)})`);
  const t: MotorState = { x: 3, y: 0, z: 0, vy: 0, grounded: true };
  jump(t);
  for (let i = 0; i < 90; i++) moveBody(t, 0.08, 0, 1 / 60, DEFAULT_MOTOR, w);
  assert.ok(t.x < 4 - DEFAULT_MOTOR.radius + 0.01, `wall still blocks (x ${t.x.toFixed(2)})`);
});

test('a low ceiling stops the rise instead of letting the head through', () => {
  const w = floor();
  w.add({ min: [-5, 2.0, -5], max: [5, 2.3, 5] }, 'ceiling'); // 2.0 m up: 0.25 m above a 1.75 m head
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  jump(s);
  let top = 0;
  for (let i = 0; i < 90; i++) {
    moveBody(s, 0, 0, 1 / 60, DEFAULT_MOTOR, w);
    top = Math.max(top, s.y + DEFAULT_MOTOR.height);
  }
  assert.ok(top <= 2.0, `head reached ${top.toFixed(3)} m, ceiling is at 2.0`);
  assert.ok(s.grounded, 'falls back down');
});

test('airStep sizes the jump so the top of the arc reaches jumpReach', () => {
  const step = airStep(DEFAULT_MOTOR);
  assert.ok(Math.abs(step - 0.422) < 0.002, `airStep ${step.toFixed(4)}`);
  for (const [jumpSpeed, gravity] of [[DEFAULT_MOTOR.jumpSpeed, DEFAULT_MOTOR.gravity], [5.5, 22], [4.6, 18]] as const) {
    const cfg = { ...DEFAULT_MOTOR, jumpSpeed, gravity };
    const reach = jumpHold(jumpSpeed, gravity) + airStep(cfg);
    assert.ok(Math.abs(reach - cfg.jumpReach) < 0.001, `held reach ${reach.toFixed(4)} at ${jumpSpeed} m/s, g ${gravity}`);
    const peak = jumpApex(jumpSpeed, gravity) + airStep(cfg);
    assert.ok(peak >= cfg.jumpReach && peak < 1.02, `peak reach ${peak.toFixed(4)} at ${jumpSpeed} m/s, g ${gravity}`);
  }
  // The integrated apex matches what moveBody actually does.
  const w = floor();
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  jump(s);
  let apex = 0;
  for (let i = 0; i < 90 && !s.grounded; i++) {
    moveBody(s, 0, 0, SIM_STEP, DEFAULT_MOTOR, w);
    apex = Math.max(apex, s.y);
  }
  assert.ok(Math.abs(apex - jumpApex(DEFAULT_MOTOR.jumpSpeed, DEFAULT_MOTOR.gravity)) < 1e-9, `moveBody apex ${apex}`);
});

test('a walking jump gets onto a 0.75 m desk, a 0.90 m counter and a 1.00 m box', () => {
  for (const top of [0.75, 0.9, 1.0]) {
    assert.ok(mounts(withBox(top), top, WALK), `walking jump onto ${top} m`);
    assert.ok(mounts(withBox(top), top, SPRINT), `sprinting jump onto ${top} m`);
  }
});

test('tops above the reach block a jump: 1.10 m at a walk or sprint, 1.02 m at a sprint, a full-height wall', () => {
  assertBlocked(withBox(1.1), WALK, '1.10 m walking');
  assertBlocked(withBox(1.1), SPRINT, '1.10 m sprinting');
  assertBlocked(withBox(1.02), SPRINT, '1.02 m sprinting');
  assertBlocked(withBox(2.5), SPRINT, 'wall');
});

test('reach is measured from the takeoff floor', () => {
  const w = floor();
  w.add({ min: [-5, 0, -2], max: [1, 0.5, 2] }, 'platform');
  w.add({ min: [1, 0, -2], max: [3, 1.5, 2] }, 'box');
  assert.ok(mounts(w, 1.5, WALK, 0.5), 'from a 0.5 m platform onto a 1.5 m top');
});

test('walking off a ledge keeps the 0.35 m step limit', () => {
  const w = floor();
  w.add({ min: [-5, 0, -2], max: [0, 1, 2] }, 'ledge');
  w.add({ min: [1, 0, -2], max: [3, 1.4, 2] }, 'box');
  const s: MotorState = { x: -0.5, y: 1, z: 0, vy: 0, grounded: true };
  for (let i = 0; i < 120; i++) moveBody(s, WALK * SIM_STEP, 0, SIM_STEP, DEFAULT_MOTOR, w);
  assert.ok(s.grounded && s.y === 0, `fell to the floor (y ${s.y.toFixed(3)})`);
  assert.ok(s.x <= 1 - R + 0.01, `box blocked the fall (x ${s.x.toFixed(3)})`);
});

test('a body that does not jump is blocked by a 0.75 m desk', () => {
  const w = withBox(0.75);
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  for (let i = 0; i < 60; i++) moveBody(s, WALK * SIM_STEP, 0, SIM_STEP, { ...DEFAULT_MOTOR, radius: 0.3 }, w);
  assert.ok(s.y === 0 && s.x <= 1 - 0.3 + 0.01, `stopped at x ${s.x.toFixed(3)}, y ${s.y}`);
});

test('mounting a counter reports the pop as stepUp; a flat landing reports none', () => {
  const runs = jumpRuns(withBox(0.9), WALK);
  const mounted = runs.filter((r) => Math.abs(r.s.y - 0.9) < 1e-6);
  assert.ok(mounted.length > 0, 'some run mounts the counter');
  for (const r of mounted) assert.ok(r.landStepUp > 0 && r.landStepUp <= airStep(DEFAULT_MOTOR) + 1e-3, `stepUp ${r.landStepUp.toFixed(3)}`);
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  jump(s);
  let last = -1;
  for (let i = 0; i < 90 && !s.grounded; i++) last = moveBody(s, 0, 0, SIM_STEP, DEFAULT_MOTOR, floor()).stepUp;
  assert.ok(s.grounded && last === 0, `flat landing stepUp ${last}`);
  assert.ok(!s.jumping, 'landing clears jumping');
});

test('a counter needs headroom: blocked under a wall cabinet, mounted in an open room', () => {
  const room = (underside: number | null): CollisionWorld => {
    const w = withBox(0.9);
    w.add({ min: [-20, 3.2, -20], max: [20, 3.4, 20] }, 'ceiling');
    if (underside !== null) w.add({ min: [1, 0.9 + underside, -2], max: [3, 0.9 + underside + 0.4, 2] }, 'cabinet');
    return w;
  };
  // 1.20 m: a wall cabinet. 1.55 m: a shelf above the head's reach in the jump (~2.33 m) but too low to stand under,
  // so only the headroom rule stops it.
  for (const underside of [1.2, 1.55]) {
    assertBlocked(room(underside), WALK, `under ${underside} m, walking`);
    assertBlocked(room(underside), SPRINT, `under ${underside} m, sprinting`);
  }
  assert.ok(mounts(room(null), 0.9, WALK), 'open room counter');
});

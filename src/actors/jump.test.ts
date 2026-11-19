import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTOR, moveBody, type MotorState } from './motor.ts';
import { CollisionWorld } from '../world/collision.ts';

function floor(): CollisionWorld {
  const w = new CollisionWorld();
  w.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'metal');
  return w;
}

function jump(s: MotorState): void {
  s.vy = DEFAULT_MOTOR.jumpSpeed;
  s.grounded = false;
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

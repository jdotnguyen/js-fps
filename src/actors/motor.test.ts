import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxColliders, DEFAULT_MOTOR, floorBelow, moveBody, type Aabb, type MotorState } from './motor.ts';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({
  min: [x0, y0, z0],
  max: [x1, y1, z1],
});
const FLOOR = box(-50, -0.2, -50, 50, 0, 50);
const at = (x: number, z: number, y = 0): MotorState => ({ x, y, z, vy: 0, grounded: true });

/** Walk `steps` fixed steps of 1/60 s at `speed` m/s along (dirX, dirZ). */
function walk(s: MotorState, world: BoxColliders, dirX: number, dirZ: number, speed: number, steps: number): void {
  const len = Math.hypot(dirX, dirZ);
  const dt = 1 / 60;
  for (let i = 0; i < steps; i++) moveBody(s, (dirX / len) * speed * dt, (dirZ / len) * speed * dt, dt, DEFAULT_MOTOR, world);
}

test('stands on the floor and stays put with no input', () => {
  const s = at(0, 0);
  moveBody(s, 0, 0, 1 / 60, DEFAULT_MOTOR, new BoxColliders([FLOOR]));
  assert.equal(s.y, 0);
  assert.ok(s.grounded);
});

test('a wall stops the body at its radius and keeps it there', () => {
  const world = new BoxColliders([FLOOR, box(-5, 0, -2.2, 5, 3, -2)]);
  const s = at(0, 0);
  walk(s, world, 0, -1, 5, 120);
  assert.ok(Math.abs(s.z - (-2 + DEFAULT_MOTOR.radius)) < 1e-3, `z=${s.z}`);
});

test('slides along a wall when walking into it at an angle', () => {
  const world = new BoxColliders([FLOOR, box(-50, 0, -2.2, 50, 3, -2)]);
  const s = at(0, -1.5);
  walk(s, world, 1, -1, 3.2, 60);
  assert.ok(s.x > 1.5, `slid only to x=${s.x}`);
  assert.ok(s.z >= -2 + DEFAULT_MOTOR.radius - 1e-3);
});

test('walks up a 0.3 m ledge and is stopped by a 0.5 m one', () => {
  const low = new BoxColliders([FLOOR, box(-2, 0, -5, 2, 0.3, -1)]);
  const a = at(0, 0);
  walk(a, low, 0, -1, 3.2, 60);
  assert.equal(a.y, 0.3);
  assert.ok(a.z < -1.5);

  const high = new BoxColliders([FLOOR, box(-2, 0, -5, 2, 0.5, -1)]);
  const b = at(0, 0);
  walk(b, high, 0, -1, 3.2, 60);
  assert.equal(b.y, 0);
  assert.ok(Math.abs(b.z - (-1 + DEFAULT_MOTOR.radius)) < 1e-3);
});

test('climbs a flight of stairs (0.18 m rise, 0.28 m run) to the top', () => {
  const steps: Aabb[] = [FLOOR];
  for (let i = 0; i < 10; i++) steps.push(box(-1, 0, -1 - (i + 1) * 0.28, 1, (i + 1) * 0.18, -1 - i * 0.28));
  steps.push(box(-1, 0, -10, 1, 1.8, -1 - 10 * 0.28)); // landing
  const s = at(0, 0);
  walk(s, new BoxColliders(steps), 0, -1, 3.2, 180);
  assert.ok(Math.abs(s.y - 1.8) < 1e-6, `y=${s.y}`);
  assert.ok(s.z < -5);
});

test('steps down stairs without leaving the ground', () => {
  const steps: Aabb[] = [FLOOR];
  for (let i = 0; i < 6; i++) steps.push(box(-1, 0, -1 - (i + 1) * 0.28, 1, 1.08 - i * 0.18, -1 - i * 0.28));
  const world = new BoxColliders(steps);
  const s = at(0, -1.1, 1.08);
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) {
    moveBody(s, 0, -3.2 * dt, dt, DEFAULT_MOTOR, world);
    assert.ok(s.grounded, `airborne at step ${i}, y=${s.y}`);
  }
  assert.equal(s.y, 0);
});

test('passes through a 2 m door without snagging when entering off-centre', () => {
  // Wall at z -3 with a 2 m gap between door frames at x = +-1.
  const world = new BoxColliders([FLOOR, box(-6, 0, -3.3, -1, 3, -3), box(1, 0, -3.3, 6, 3, -3)]);
  // Reaches the wall at x ~0.8: the body overlaps the right frame by 0.15 m.
  const s = at(0.5, 0);
  walk(s, world, 0.1, -1, 3.2, 120);
  assert.ok(s.z < -4, `stuck at z=${s.z}, x=${s.x}`);
});

test('a fast move does not tunnel through a thin wall', () => {
  const world = new BoxColliders([FLOOR, box(-5, 0, -1.05, 5, 3, -1)]);
  const s = at(0, 0);
  moveBody(s, 0, -3, 1 / 60, DEFAULT_MOTOR, world);
  assert.ok(s.z > -1, `tunnelled to z=${s.z}`);
});

test('a low beam blocks the body (head height) but a high one does not', () => {
  const low = new BoxColliders([FLOOR, box(-5, 1.5, -2.2, 5, 1.8, -2)]);
  const a = at(0, 0);
  walk(a, low, 0, -1, 3.2, 60);
  assert.ok(a.z > -2);

  const high = new BoxColliders([FLOOR, box(-5, 1.8, -2.2, 5, 2.1, -2)]);
  const b = at(0, 0);
  walk(b, high, 0, -1, 3.2, 60);
  assert.ok(b.z < -2.5);
});

test('falls off a high ledge under gravity and lands', () => {
  const world = new BoxColliders([FLOOR, box(-2, 0, -2, 2, 1, 2)]);
  const s = at(0, 1.9, 1);
  let airborne = false;
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    moveBody(s, 0, 2 * dt, dt, DEFAULT_MOTOR, world);
    if (!s.grounded) airborne = true;
  }
  assert.ok(airborne);
  assert.equal(s.y, 0);
  assert.ok(s.grounded);
});

test('floorBelow finds the floor under a ceiling slab, never the slab above the feet', () => {
  // A 4 m room's ceiling slab spans 4.00-4.12 (ceilingTile); a body at 3.8 is within step height of its top.
  const world = new BoxColliders([FLOOR, box(-5, 4, -5, 5, 4.12, 5)]);
  assert.equal(floorBelow(at(0, 0, 3.8), world), 0);
});

test('floorBelow finds a crate top the body stands on', () => {
  const world = new BoxColliders([FLOOR, box(-1, 0, -1, 1, 1, 1)]);
  assert.equal(floorBelow(at(0, 0, 1), world), 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTOR, moveBody, type Aabb, type MotorState } from '../actors/motor.ts';
import { CollisionWorld } from './collision.ts';

function floorWorld(): CollisionWorld {
  const w = new CollisionWorld();
  w.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', 'metal');
  return w;
}

test('query appends only boxes whose footprint overlaps, once each', () => {
  const w = new CollisionWorld();
  const a = w.add({ min: [0, 0, 0], max: [5, 1, 5] }); // spans several 2 m cells
  w.add({ min: [10, 0, 10], max: [11, 1, 11] });
  const out: Aabb[] = [{ min: [0, 0, 0], max: [1, 1, 1] }];
  w.query(1, 1, 4, 4, out);
  assert.equal(out.length, 2, 'keeps what was already in out and adds the big box once');
  assert.equal(out[1], a);
});

test('disabled colliders (open doors) are invisible to queries and the motor', () => {
  const w = floorWorld();
  const door = w.add({ min: [-1, 0, -2.1], max: [1, 2.4, -1.9] }, 'door:test');
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  for (let i = 0; i < 60; i++) moveBody(s, 0, -2 / 60, 1 / 60, DEFAULT_MOTOR, w);
  assert.ok(s.z > -2, `blocked at z=${s.z}`);
  door.enabled = false;
  for (let i = 0; i < 60; i++) moveBody(s, 0, -2 / 60, 1 / 60, DEFAULT_MOTOR, w);
  assert.ok(s.z < -2.5, `walked through to z=${s.z}`);
});

test('the ADR-0004 motor climbs kit stairs (0.25 m steps) through the hash', () => {
  const w = floorWorld();
  for (let i = 0; i < 8; i++) w.add({ min: [-1.5, 0, -1 - (i + 1) * 0.45], max: [1.5, (i + 1) * 0.25, -1 - i * 0.45] });
  w.add({ min: [-1.5, 0, -12], max: [1.5, 2, -4.6] });
  const s: MotorState = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
  for (let i = 0; i < 180; i++) moveBody(s, 0, -2.5 / 60, 1 / 60, DEFAULT_MOTOR, w);
  assert.equal(s.y, 2);
});

test('raycast returns the nearest hit and skips disabled boxes', () => {
  const w = new CollisionWorld();
  const near = w.add({ min: [-1, 0, -3], max: [1, 2, -2.5] });
  w.add({ min: [-1, 0, -8], max: [1, 2, -7] });
  const hit = w.raycast(0, 1, 0, 0, 0, -1, 20);
  assert.ok(hit);
  assert.equal(hit.collider, near);
  assert.ok(Math.abs(hit.distance - 2.5) < 1e-6);
  near.enabled = false;
  const hit2 = w.raycast(0, 1, 0, 0, 0, -1, 20);
  assert.ok(hit2 && Math.abs(hit2.distance - 7) < 1e-6);
  assert.equal(w.raycast(0, 1, 0, 0, 0, -1, 5), null);
});

test('surfaceAt reports the material underfoot; later boxes win ties', () => {
  const w = floorWorld();
  w.add({ min: [2, 0, -1], max: [4, 0.02, 1] }, 'grate', 'grate');
  w.add({ min: [-4, -0.2, -1], max: [-2, 0, 1] }, 'strip', 'grate');
  assert.equal(w.surfaceAt(0, 0, 0), 'metal');
  assert.equal(w.surfaceAt(3, 0.02, 0), 'grate');
  assert.equal(w.surfaceAt(-3, 0, 0), 'grate');
});

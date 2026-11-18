import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipMove, pushOut, removeInward, JAY_RADIUS } from './bodyPush.ts';

const o = { x: 0, z: 0 };

test('clipMove stops a fast step at the body and slides the rest', () => {
  const body = { x: 0, z: -2, r: 0.3 };
  // A 3 m step straight at it from the origin would tunnel through.
  clipMove(0, 0, 0, -3, [body], JAY_RADIUS, o);
  assert.ok(Math.abs(o.z) < 2 - 0.65 + 1e-6, `z ${o.z}`);
  assert.ok(Math.hypot(o.x, o.z + 2) >= 0.65 - 1e-6);
});

test('clipMove lets a clear move through and slides along the tangent', () => {
  clipMove(0, 0, 1, 0, [{ x: 0, z: -3, r: 0.3 }], JAY_RADIUS, o);
  assert.deepEqual({ x: o.x, z: o.z }, { x: 1, z: 0 });
  // Glancing hit: some sideways motion survives.
  clipMove(0.3, 0, 0, -3, [{ x: 0, z: -2, r: 0.3 }], JAY_RADIUS, o);
  assert.ok(Math.hypot(0.3 + o.x, o.z + 2) >= 0.65 - 1e-6);
  assert.ok(o.x > 0, 'slides to the side it is on');
});

test('clipMove ignores bodies it moves away from or already overlaps', () => {
  clipMove(0, 0, 0, 1, [{ x: 0, z: -0.5, r: 0.3 }], JAY_RADIUS, o);
  assert.equal(o.z, 1);
});

test('pushOut reaches exactly the minimum separation, and handles coincident centres', () => {
  pushOut(0.3, 0, { x: 0, z: 0, r: 0.3 }, JAY_RADIUS, 0, 0, o);
  assert.ok(Math.abs(Math.hypot(0.3 + o.x, o.z) - 0.65) < 1e-9);
  pushOut(0, 0, { x: 0, z: 0, r: 0.3 }, JAY_RADIUS, 0, -1, o);
  assert.ok(Math.abs(o.z + 0.65) < 1e-9 && o.x === 0);
  pushOut(0, 0, { x: 0, z: 0, r: 0.3 }, JAY_RADIUS, 0, 0, o);
  assert.ok(Math.abs(o.x - 0.65) < 1e-9);
  pushOut(2, 0, { x: 0, z: 0, r: 0.3 }, JAY_RADIUS, 0, 0, o);
  assert.deepEqual({ x: o.x, z: o.z }, { x: 0, z: 0 });
});

test('removeInward keeps tangential and outward velocity only', () => {
  const b = [{ x: 0, z: 0, r: 0.3 }];
  removeInward(-1, -1, 0.65, 0, b, JAY_RADIUS, 0.05, o);
  assert.ok(Math.abs(o.x) < 1e-9 && o.z === -1);
  removeInward(1, 0, 0.65, 0, b, JAY_RADIUS, 0.05, o);
  assert.equal(o.x, 1);
});

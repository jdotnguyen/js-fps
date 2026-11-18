import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayCapsule } from './capsule.ts';

const v = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x, y, z });
const A = v(0, 0, 0);
const B = v(0, 1, 0);

test('hits the side of the cylinder', () => {
  const t = rayCapsule(v(-5, 0.5, 0), v(1, 0, 0), A, B, 0.25);
  assert.ok(Math.abs(t - 4.75) < 1e-9, `t=${t}`);
});

test('hits the rounded end cap', () => {
  const t = rayCapsule(v(0, 5, 0), v(0, -1, 0), A, B, 0.25);
  assert.ok(Math.abs(t - 3.75) < 1e-9, `t=${t}`);
});

test('ray along the axis from below hits the bottom cap first', () => {
  const t = rayCapsule(v(0, -3, 0), v(0, 1, 0), A, B, 0.2);
  assert.ok(Math.abs(t - 2.8) < 1e-9, `t=${t}`);
});

test('misses beside, behind and past the end', () => {
  assert.equal(rayCapsule(v(-5, 0.5, 0.4), v(1, 0, 0), A, B, 0.25), -1);
  assert.equal(rayCapsule(v(-5, 0.5, 0), v(-1, 0, 0), A, B, 0.25), -1);
  assert.equal(rayCapsule(v(-5, 1.4, 0), v(1, 0, 0), A, B, 0.25), -1);
});

test('diagonal capsule', () => {
  const t = rayCapsule(v(0.5, 5, 0.5), v(0, -1, 0), v(0, 0, 0), v(1, 0, 1), 0.1);
  assert.ok(Math.abs(t - 4.9) < 1e-6, `t=${t}`);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WATER_REFLECTION_SCALE, mirrorCamera } from './system.ts';

// standing-water spec (overhaul-flooded-tunnel D4): the planar reflection's mirror camera.

function eye(y: number): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  c.position.set(0, y, 0);
  c.lookAt(0, -0.45, -5);
  c.updateMatrixWorld();
  return c;
}

const clipZ = (cam: THREE.PerspectiveCamera, p: THREE.Vector3): number => {
  const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  return v.z / v.w;
};

test('the mirror camera sits as far under the surface as the eye is above it', () => {
  const out = new THREE.PerspectiveCamera();
  assert.equal(mirrorCamera(eye(1.2), -0.45, out, new THREE.Matrix4()), true);
  assert.ok(Math.abs(out.position.y - (-0.45 - 1.65)) < 1e-6, `mirror y ${out.position.y}`);
});

test('nothing under the water is drawn into the reflection (oblique clip at the surface)', () => {
  const out = new THREE.PerspectiveCamera();
  mirrorCamera(eye(1.2), -0.45, out, new THREE.Matrix4());
  const above = clipZ(out, new THREE.Vector3(0, -0.2, -4));
  const below = clipZ(out, new THREE.Vector3(0, -0.8, -4));
  assert.ok(above > -1 && above < 1, `a wall above the water is kept (${above})`);
  assert.ok(below < -1 || below > 1, `the floor under the water is clipped (${below})`);
});

test('no reflection when the eye is at or under the surface', () => {
  assert.equal(mirrorCamera(eye(-0.5), -0.45, new THREE.PerspectiveCamera(), new THREE.Matrix4()), false);
});

test('a point on the surface maps into the reflection texture', () => {
  const out = new THREE.PerspectiveCamera();
  const m = new THREE.Matrix4();
  mirrorCamera(eye(1.2), -0.45, out, m);
  const v = new THREE.Vector4(0, -0.45, -3, 1).applyMatrix4(m);
  const u = v.x / v.w;
  const t = v.y / v.w;
  assert.ok(u > 0 && u < 1 && t > 0 && t < 1, `uv ${u}, ${t}`);
});

test('Low has no mirror pass; Medium renders it smaller than High', () => {
  assert.equal(WATER_REFLECTION_SCALE.low, 0);
  assert.ok(WATER_REFLECTION_SCALE.medium < WATER_REFLECTION_SCALE.high);
});

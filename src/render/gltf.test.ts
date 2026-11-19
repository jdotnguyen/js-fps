import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dequantizeForTransform } from './gltf.ts';

test('dequantizeForTransform promotes normalized Int16 attributes so applyMatrix4 does not overflow', () => {
  const geom = new THREE.BufferGeometry();
  // Normalized Int16 position: 16384 / 32767 ≈ 0.5
  const rawPos = new Int16Array([16384, -16384, 32767]);
  geom.setAttribute('position', new THREE.BufferAttribute(rawPos, 3, true));
  const rawNorm = new Int8Array([0, 127, 0]);
  geom.setAttribute('normal', new THREE.BufferAttribute(rawNorm, 3, true));

  dequantizeForTransform(geom);
  geom.applyMatrix4(new THREE.Matrix4().makeScale(40, 40, 40));

  const pos = geom.getAttribute('position');
  assert.ok(pos instanceof THREE.BufferAttribute && pos.array instanceof Float32Array);
  assert.equal(pos.normalized, false);
  assert.ok(Math.abs(pos.getX(0) - 20) < 0.01);
  assert.ok(Math.abs(pos.getY(0) + 20) < 0.01);
  assert.ok(Math.abs(pos.getZ(0) - 40) < 0.01);

  const norm = geom.getAttribute('normal');
  assert.ok(norm instanceof THREE.BufferAttribute && norm.array instanceof Float32Array);
  assert.ok(Math.abs(norm.getY(0) - 1) < 0.01);
});

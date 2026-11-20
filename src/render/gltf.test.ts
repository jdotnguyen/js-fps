import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dequantizeForTransform, normalizeGltf } from './gltf.ts';

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

/** A centimetre-scale "model": a 60 x 180 x 40 cm box floating off-centre, plus a nose marker at +X. */
function cmModel(): THREE.Group {
  const scene = new THREE.Group();
  scene.name = 'Scene';
  const body = new THREE.Mesh(new THREE.BoxGeometry(60, 180, 40), new THREE.MeshStandardMaterial());
  body.position.set(500, 300, -200);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshStandardMaterial());
  nose.name = 'nose';
  nose.position.set(535, 300, -200);
  scene.add(body, nose);
  return scene;
}

test('normalizeGltf scales to a height and puts the base centre on the origin', () => {
  const { root, size, scale } = normalizeGltf(cmModel(), { height: 1.8 });
  assert.ok(Math.abs(size.y - 1.8) < 1e-6);
  assert.ok(Math.abs(scale - 0.01) < 1e-6);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.z) < 1e-6);
});

test('normalizeGltf leaves the file\'s own node transforms alone', () => {
  const scene = cmModel();
  scene.position.set(1, 2, 3);
  normalizeGltf(scene, { height: 1.8 });
  assert.deepEqual(scene.position.toArray(), [1, 2, 3]);
  assert.equal(scene.scale.x, 1);
});

test('normalizeGltf turns a +X-facing model to face -Z', () => {
  const scene = cmModel();
  const { root } = normalizeGltf(scene, { scale: 0.01, front: '+x' });
  root.updateMatrixWorld(true);
  const nose = scene.getObjectByName('nose')!.getWorldPosition(new THREE.Vector3());
  assert.ok(nose.z < -0.2, `nose should point to -Z, got ${nose.toArray()}`);
  assert.ok(Math.abs(nose.x) < 1e-6);
});

test('normalizeGltf tags colour maps sRGB and data maps linear', () => {
  const map = new THREE.Texture();
  const normalMap = new THREE.Texture();
  normalMap.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map, normalMap })));
  normalizeGltf(scene);
  assert.equal(map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(normalMap.colorSpace, THREE.NoColorSpace);
});

test('normalizeGltf rejects an empty scene', () => {
  assert.throws(() => normalizeGltf(new THREE.Group()), /no geometry/);
});

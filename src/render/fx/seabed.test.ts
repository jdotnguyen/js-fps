import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SEABED_BASE_Y, createSeabed, seabedHeight } from './seabed.ts';

const footprint = (x: number, z: number): number => Math.max(0, Math.hypot(Math.max(0, Math.abs(x) - 8), Math.max(0, Math.abs(z) - 8)));

test('seabed ground is continuous: no step over 0.3 m between neighbouring vertices', () => {
  const s = createSeabed({ minX: -60, maxX: 60, minZ: -60, maxZ: 60, distance: footprint });
  const mesh = s.group.getObjectByName('seabed-ground') as THREE.Mesh;
  const pos = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex()!;
  let worst = 0;
  for (let i = 0; i < index.count; i += 3) {
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]] as const) {
      worst = Math.max(worst, Math.abs(pos.getY(index.getX(i + a)) - pos.getY(index.getX(i + b))));
    }
  }
  assert.ok(worst < 0.3, `largest step ${worst.toFixed(3)} m`);
});

test('seabed falls away from the station, so it fades instead of ending', () => {
  let near = 0;
  let far = 0;
  for (let k = 0; k < 40; k++) {
    near += seabedHeight(k * 0.4 - 8, 3, 0);
    far += seabedHeight(k * 0.4 - 8, 3, 50);
  }
  near /= 40;
  far /= 40;
  assert.ok(Math.abs(near - SEABED_BASE_Y) < 0.6, `ground under the station near ${SEABED_BASE_Y} (got ${near.toFixed(2)})`);
  assert.ok(far < near - 3, `far margin is lower (${far.toFixed(2)} vs ${near.toFixed(2)})`);
});

test('seabed builds without the model, with no shadows and no caustic shader', () => {
  const s = createSeabed({ minX: -10, maxX: 10, minZ: -10, maxZ: 10, distance: footprint });
  const ground = s.group.getObjectByName('seabed-ground') as THREE.Mesh;
  assert.ok(ground, 'ground mesh');
  assert.equal(ground.castShadow, false);
  assert.equal((ground.material as THREE.Material).userData['exterior'], true, 'uses the exterior lighting');
  assert.ok(Math.abs(s.heightAt(0, 0) - seabedHeight(0, 0, 0)) < 1e-4);
  s.addRocks([{ x: 0, z: 0, yaw: 0, scale: 1 }]); // queued until the model loads
});

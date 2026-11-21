import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Materials } from '../../render/materials.ts';
import { windowWall, wallFrame } from './detail.ts';
import { PieceBuilder } from './types.ts';

/** Every slot a plain standard material; the wall only reads a handful. */
const cache: Record<string, THREE.Material> = {};
const mats = new Proxy({}, {
  get: (_t, k: string) => (cache[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : new THREE.MeshStandardMaterial()),
}) as Materials;

const build = (view: 'ocean' | 'screen'): THREE.Object3D => {
  const pb = new PieceBuilder();
  windowWall(pb, mats, wallFrame(0, 0, 0), { length: 4, height: 3.2 }, view);
  return pb.object;
};

const named = (root: THREE.Object3D, name: string): THREE.Object3D[] => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => void (o.name === name && out.push(o)));
  return out;
};

test('a sanity screen wall has a screen per bay, blinds, a dark back and no ocean marker', () => {
  const root = build('screen');
  const byMaterial = (name: string): number => {
    let n = 0;
    root.traverse((o) => void (o instanceof THREE.Mesh && (o.material as THREE.Material).name === name && n++));
    return n;
  };
  assert.equal(byMaterial('sanity-screen'), 2, 'one screen per bay between three mullions');
  assert.equal(byMaterial('screen-floor-stripes'), 2, 'floor stripes in front of each bay');
  root.traverse((o) => assert.ok(!o.userData.dynamic || o.name !== 'sanity-screen', 'screens are static, merged per room'));
  assert.equal(named(root, 'ocean-zone').length, 0, 'no fish or floodlight behind a screen');
  let slats = 0;
  root.traverse((o) => void (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'screen-blind' && slats++));
  assert.ok(slats >= 30, `blind slats (found ${slats})`);
});

test('a real window wall builds nothing outside the glass, only the ocean marker', () => {
  const root = build('ocean');
  const zones = named(root, 'ocean-zone');
  assert.equal(zones.length, 1);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    box.setFromObject(o);
    assert.ok(box.min.z > -0.2, `${o.name || 'mesh'} stays at the wall, not out in the water (z ${box.min.z.toFixed(2)})`);
  });
});

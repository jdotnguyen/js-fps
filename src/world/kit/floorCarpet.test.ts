import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { SLICE_STRUCTURE } from './slice.ts';
import type { PieceParams } from './types.ts';

// level-kit spec, "Carpet floor with a bare metal edge": floor_carpet's optional bareEdge / bareWidth band.

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;
const carpet = (params: PieceParams) => SLICE_STRUCTURE.find((p) => p.id === 'floor_carpet')!.generate({ area: 'gallery', ...params }, new Rng('carpet'), mats);
const r = (v: number): number => Math.round(v * 100) / 100 + 0; // + 0 folds -0 into 0

test('floor_carpet without a bare edge is one rubber floor collider under carpet', () => {
  const out = carpet({});
  assert.deepEqual(out.surfaces.map((s) => [s.material, s.box.min.map(r), s.box.max.map(r)]), [['rubber', [-2, -0.2, -2], [2, 0, 2]]]);
  const names = new Set<string>();
  out.object.traverse((c) => c instanceof THREE.Mesh && names.add((c.material as THREE.Material).name));
  assert.ok(!names.has('steelBrushed'), 'no metal band');
});

test('floor_carpet with a 1.25 m bare south edge: metal band by the edge, carpet and rubber footsteps elsewhere', () => {
  const out = carpet({ bareEdge: 's', bareWidth: 1.25 });
  const surf = Object.fromEntries(out.surfaces.map((s) => [s.material, [s.box.min.map(r), s.box.max.map(r)]]));
  assert.deepEqual(surf['metal'], [[-2, -0.2, 0.75], [2, 0, 2]], 'metal band along +Z (south)');
  assert.deepEqual(surf['rubber'], [[-2, -0.2, -2], [2, 0, 0.75]], 'carpet up to the seam');
  // The band uses the gallery palette's floorAlt (brushed steel), and a carpet border runs along the seam.
  let band: THREE.Box3 | null = null;
  let seamBorder = false;
  out.object.traverse((c) => {
    if (!(c instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(c);
    if ((c.material as THREE.Material).name === 'steelBrushed') band = box;
    if (box.max.x - box.min.x > 3.9 && box.max.z - box.min.z < 0.13 && Math.abs(box.max.z - 0.75) < 1e-6) seamBorder = true;
  });
  assert.ok(band, 'bare band mesh');
  assert.equal(r((band as THREE.Box3).min.z), 0.75);
  assert.equal(r((band as THREE.Box3).max.y), 0, 'band top flush with the floor');
  assert.ok(seamBorder, 'carpet border on the seam');
});

test('floor_carpet bare edges follow piece space for every side, and an unknown edge is ignored', () => {
  const metal = (edge: string) => carpet({ bareEdge: edge, bareWidth: 1 }).surfaces.find((s) => s.material === 'metal')?.box;
  assert.deepEqual([metal('n')!.min[2], metal('n')!.max[2]], [-2, -1]);
  assert.deepEqual([metal('e')!.min[0], metal('e')!.max[0]], [1, 2]);
  assert.deepEqual([metal('w')!.min[0], metal('w')!.max[0]], [-2, -1]);
  assert.equal(metal('up'), undefined);
});

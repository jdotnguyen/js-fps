import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../../core/rng.ts';
import type { Materials } from '../../render/materials.ts';
import { CollisionWorld } from '../collision.ts';
import { STRUCTURE_PIECES } from './structure.ts';
import { transformBox } from './types.ts';

// in-world-audio "Glass muffles lightly": glass partitions carry an acoustic marker from the kit to the collision world.

const mats = new Proxy({} as Record<string | symbol, THREE.Material>, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial()),
}) as unknown as Materials;

const piece = (id: string) => STRUCTURE_PIECES.find((p) => p.id === id)!.generate({}, new Rng('glass-acoustic'), mats);

test('every wall_glass_partition collider is marked glass, and a panel wall is not', () => {
  const glass = piece('wall_glass_partition');
  assert.ok(glass.colliders.length > 0);
  for (const c of glass.colliders) assert.equal(c.acoustic, 'glass');
  for (const c of piece('wall_panel').colliders) assert.equal(c.acoustic, undefined);
});

test('the glass marker survives transformBox and CollisionWorld.add', () => {
  const [box] = piece('wall_glass_partition').colliders;
  const moved = transformBox(box!, new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(8, 0, 4));
  assert.equal(moved.acoustic, 'glass');
  const world = new CollisionWorld();
  assert.equal(world.add(moved, 'room:test').acoustic, 'glass');
  assert.equal(world.add({ min: [0, 0, 0], max: [1, 3, 1] }, 'room:test').acoustic, undefined);
});

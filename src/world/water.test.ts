import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { Level } from './level.ts';
import { KitRegistry } from './registry.ts';
import { WaterBody } from './water.ts';

// standing-water spec (overhaul-flooded-tunnel D1): one water body per room.

const cells = [{ minX: -2, maxX: 2, minZ: -2, maxZ: 2 }, { minX: 2, maxX: 6, minZ: -2, maxZ: 2 }];

test('depth on the sunken floor is the level minus the feet', () => {
  const w = new WaterBody({ room: 'A', level: -0.45, floor: -1.2, cells });
  assert.ok(Math.abs(w.depthAt(0, -1.2, 0) - 0.75) < 1e-9);
  assert.ok(Math.abs(w.depthAt(4, -1.2, 1) - 0.75) < 1e-9, 'the second cell is water too');
});

test('a submerged step is shallower, and a step above the surface is dry', () => {
  const w = new WaterBody({ room: 'A', level: -0.45, floor: -1.2, cells });
  assert.ok(Math.abs(w.depthAt(0, -0.72, 0) - 0.27) < 1e-9);
  assert.equal(w.depthAt(0, -0.24, 0), 0);
  assert.equal(w.depthAt(0, 0, 0), 0, 'the landing at deck level is dry');
});

test('outside the footprint there is no water', () => {
  const w = new WaterBody({ room: 'A', level: -0.45, floor: -1.2, cells });
  assert.equal(w.depthAt(7, -1.2, 0), 0);
  assert.equal(w.depthAt(0, -1.2, 3), 0);
});

test('a scripted rise eases to the target and reports when it is done', () => {
  const w = new WaterBody({ room: 'A', level: -0.45, floor: -1.2, cells });
  w.setLevel(0.55, 2);
  assert.equal(w.changing, true);
  assert.equal(w.targetLevel, 0.55);
  w.update(1);
  assert.ok(Math.abs(w.level - 0.05) < 1e-9, `halfway through the ease: ${w.level}`);
  w.update(1.5);
  assert.equal(w.level, 0.55);
  assert.equal(w.changing, false);
  w.setLevel(-0.45);
  assert.equal(w.level, -0.45, 'an instant change applies at once');
});

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

test('a room with a water block gets a body over its cells, and level reset restores the authored level', () => {
  const data: LevelData = {
    id: 'water_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, -1.2, 0], yaw: 0 },
    rooms: [{ id: 'A', name: 'A', floorY: -1.2, water: { level: -0.45 }, pieces: [{ kit: 'floor', cells: [[0, 0, 0], [1, 0, 0]] }] }],
    doors: [],
    checkpoints: [],
  };
  const level = new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
  const body = level.water.room('A');
  assert.ok(body);
  assert.equal(body.floor, -1.2, 'the bottom defaults to the room floor');
  assert.ok(Math.abs(level.water.depthAt(5, -1.2, 0) - 0.75) < 1e-9);
  body.setLevel(2.2);
  level.resetToData();
  assert.equal(body.level, -0.45);
});

test('footsteps under the surface read water; above it, the floor under them', () => {
  const data: LevelData = {
    id: 'water_surface_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, -1.2, 0], yaw: 0 },
    rooms: [{ id: 'A', name: 'A', floorY: -1.2, water: { level: -0.45 }, pieces: [{ kit: 'floor', cell: [0, 0, 0] }] }],
    doors: [],
    checkpoints: [],
  };
  const level = new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
  assert.equal(level.surfaceAt(0, -1.2, 0), 'water');
  level.water.room('A')!.setLevel(-1.5);
  assert.notEqual(level.surfaceAt(0, -1.2, 0), 'water', 'drained: the floor surface');
});

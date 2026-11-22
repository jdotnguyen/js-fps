import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { Level, sunkenPlacementProblems } from './level.ts';
import { KitRegistry } from './registry.ts';

// level-kit spec (overhaul-flooded-tunnel): sunken room floors.

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

/** One 1x1 room at cell (0,0,0) with a floor, a ceiling and a plain wall on its -Z edge. */
function build(floorY: number | undefined): Level {
  const cell: [number, number, number] = [0, 0, 0];
  const data: LevelData = {
    id: 'sunken_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, floorY ?? 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        ...(floorY !== undefined ? { floorY } : {}),
        pieces: [{ kit: 'floor', cell }, { kit: 'ceiling', cell }, { kit: 'wall_plain', cell }],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  return new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
}

/** Top of the highest collider under the cell centre that is below `below`. */
function floorTop(level: Level, below: number): number {
  const out = level.collision.query(-0.2, -0.2, 0.2, 0.2, []);
  return Math.max(...out.filter((b) => b.max[1] <= below).map((b) => b.max[1]));
}

test('a room with floorY -1.2 has its floor colliders at -1.2', () => {
  const level = build(-1.2);
  assert.ok(Math.abs(floorTop(level, 0.5) - -1.2) < 0.02, `floor top ${floorTop(level, 0.5)}`);
});

test('a room without floorY keeps its floor at deck level', () => {
  const level = build(undefined);
  assert.ok(Math.abs(floorTop(level, 0.5)) < 0.02, `floor top ${floorTop(level, 0.5)}`);
});

test('walls of a sunken room span from the sunken floor to the ceiling, with no seam at deck level', () => {
  const level = build(-1.2);
  // The -Z wall band (z in [-2, -1.75]).
  const walls = level.collision.query(-1, -2, 1, -1.8, []).filter((b) => b.max[1] - b.min[1] > 2);
  assert.ok(walls.length > 0, 'a wall collider on the -Z edge');
  const lo = Math.min(...walls.map((b) => b.min[1]));
  const hi = Math.max(...walls.map((b) => b.max[1]));
  assert.ok(lo <= -1.19, `wall starts at ${lo}`);
  assert.ok(hi >= 3.19, `wall reaches ${hi}`);
  // No gap: some single wall box covers deck level.
  assert.ok(walls.some((b) => b.min[1] < -0.1 && b.max[1] > 0.1), 'one wall box spans deck level');
});

function withAnchor(pos: [number, number, number], floorY = -1.2): LevelData {
  const cell: [number, number, number] = [0, 0, 0];
  return {
    id: 'sunken_anchor_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, floorY, 0], yaw: 0 },
    rooms: [{ id: 'A', name: 'A', floorY, pieces: [{ kit: 'floor', cell }, { kit: 'ceiling', cell }], anchors: [{ id: 'a1', pos }] }],
    doors: [],
    checkpoints: [],
  };
}
const deps = (): ConstructorParameters<typeof Level>[1] => ({ materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });

test('an anchor left at deck level over a sunken floor is rejected', () => {
  assert.throws(() => new Level(withAnchor([0, 0, 0]), deps()), /anchor a1 at \[0, 0, 0\] has no walkable top/);
});

test('an anchor on the sunken floor, or high on a wall, is accepted', () => {
  assert.doesNotThrow(() => new Level(withAnchor([0.5, -1.2, 0.5]), deps()));
  assert.doesNotThrow(() => new Level(withAnchor([0, 1.4, 0]), deps()));
});

test('sunkenPlacementProblems ignores rooms at deck level', () => {
  const data = withAnchor([0, -0.6, 0]);
  data.rooms[0] = { ...data.rooms[0]!, floorY: 0 } as LevelData['rooms'][number];
  assert.deepEqual(sunkenPlacementProblems(data, new Level(data, deps()).collision), []);
});

test('the ceiling of a sunken room stays at its height above the deck', () => {
  const level = build(-1.2);
  const out = level.collision.query(-0.2, -0.2, 0.2, 0.2, []);
  const ceil = Math.min(...out.filter((b) => b.min[1] > 1).map((b) => b.min[1]));
  assert.ok(Math.abs(ceil - 3.2) < 0.05, `ceiling underside ${ceil}`);
});

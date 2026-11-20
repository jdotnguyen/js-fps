import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { Level } from './level.ts';
import { KitRegistry } from './registry.ts';
import { Rng } from '../core/rng.ts';
import { SLICE_PROPS } from './kit/slice.ts';

// render-lighting spec (openspec refresh-observation-gallery): glow-only lights and pool sharing.

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

/** Room A: 8 ceiling cells in a row (x 0..7), all lit; `glowOnly` slots get `pool: false`. Room B (x 9..10) is visible from A with 2 lights. */
function build(glowOnly: number[]): Level {
  const aCells = Array.from({ length: 8 }, (_, x) => [x, 0, 0] as [number, number, number]);
  const data: LevelData = {
    id: 'pool_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        pieces: [...aCells.map((cell) => ({ kit: 'ceiling', cell })), { kit: 'floor', cells: aCells }],
        lights: aCells.map((_, i) => ({ slot: i, pattern: 'steady' as const, ...(glowOnly.includes(i) ? { pool: false } : {}) })),
      },
      {
        id: 'B',
        name: 'B',
        visibleFrom: ['A'],
        pieces: [{ kit: 'ceiling', cell: [9, 0, 0] }, { kit: 'ceiling', cell: [10, 0, 0] }, { kit: 'floor', cells: [[9, 0, 0], [10, 0, 0]] }],
        lights: [{ slot: 0, pattern: 'steady' }, { slot: 1, pattern: 'steady' }],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  const level = new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
  level.update(0, 1 / 60, new THREE.Vector3(0, 1.62, 0), false);
  return level;
}
const bound = (level: Level, room: string): number => level.roomLights(room).filter((l) => l.light.light !== null).length;

test('with every light pooled, the current room takes the whole 8-light pool and the room behind the glass gets none', () => {
  const level = build([]);
  assert.equal(bound(level, 'A'), 8);
  assert.equal(bound(level, 'B'), 0);
});

test('glow-only lights keep their glowing fixture and pattern but never take a pooled light, freeing it for the next room', () => {
  const level = build([2, 5]);
  assert.equal(bound(level, 'A'), 6, 'only the pooled lights in A are bound');
  assert.equal(bound(level, 'B'), 2, 'the two freed pool lights go to B');
  const glow = level.roomLights('A').filter((_, i) => i === 2 || i === 5);
  for (const g of glow) {
    assert.equal(g.light.light, null);
    assert.ok(g.light.emissives.length > 0, 'glow-only slot still has a glowing fixture');
  }
  assert.ok(level.setRoomLights('A', 'alarm'));
  assert.ok(glow.every((g) => g.light.pattern === 'alarm'), 'patterns reach glow-only lights');
});

/** One room: floor, no ceiling, a two-bulb `pendant_light` (`slots` as given) with `claim` slots claimed. */
function lampRoom(slots: boolean, claim: number[]): Level {
  const data: LevelData = {
    id: 'lamp_test',
    seed: 1,
    playerStart: { room: 'L', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'L',
        name: 'L',
        height: 3.6,
        pieces: [{ kit: 'floor', cell: [0, 0, 0] }],
        props: [{ kit: 'pendant_light', pos: [0, 0, 0], params: { count: 2, spacing: 0.9, drop: 1.55, ...(slots ? { slots: true } : {}) } }],
        lights: claim.map((slot) => ({ slot, pattern: 'steady' as const })),
      },
    ],
    doors: [],
    checkpoints: [],
  };
  const level = new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
  level.update(0, 1 / 60, new THREE.Vector3(0, 1.62, 0), false);
  return level;
}

test('pendant_light with slots offers one pendant slot per bulb; a claimed one is a real lamp light, an unclaimed one a dark bulb', () => {
  const level = lampRoom(true, [0]);
  assert.deepEqual(level.debug.slots.map((s) => [s.kind, s.claimed]), [['pendant', true], ['pendant', false]]);
  const [lamp] = level.roomLights('L');
  assert.ok(lamp, 'claimed lamp is a room light');
  assert.ok(lamp.light.light !== null, 'it takes a real pooled light');
  assert.ok(lamp.light.emissives.length > 0, 'its bulb glows');
  // The light sits just under the bulb: ceiling 3.6 - drop 1.55 + 0.055 bulb centre - 0.15 pendant drop.
  assert.ok(Math.abs(lamp.position.y - (3.6 - 1.55 + 0.055 - 0.15)) < 1e-6, `light height ${lamp.position.y}`);
});

test('pendant_light without slots is unchanged: no light slots, a static bulb glow', () => {
  const gen = (params: Record<string, number | boolean>) => SLICE_PROPS.find((p) => p.id === 'pendant_light')!.generate({ ceiling: 3.6, count: 2, ...params }, new Rng('lamp'), mats);
  const plain = gen({});
  assert.equal(plain.lightSlots.length, 0);
  const bulbs = (o: THREE.Object3D): number => {
    let n = 0;
    o.traverse((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry && n++);
    return n;
  };
  assert.equal(bulbs(plain.object), 2, 'two static bulbs');
  const slotted = gen({ slots: true });
  assert.deepEqual(slotted.lightSlots.map((s) => s.kind), ['pendant', 'pendant']);
  assert.equal(bulbs(slotted.object), 0, 'bulbs come from the claimed light slots instead');
});

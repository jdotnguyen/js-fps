import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import { createMaterials } from '../render/materials.ts';
import { ShadowCasterSet } from '../render/shadowCasters.ts';

// Headless canvas for the jamb status screen.
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { Path2D?: unknown }).Path2D ??= function Path2D(): unknown {
  return new Proxy({}, { get: () => noop });
};
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };

const { KitRegistry } = await import('./registry.ts');
const { Level } = await import('./level.ts');

// shadow-rich-rooms D4: a level's doors are moving shadow casters while their leaves move.

const data: LevelData = {
  id: 'door_caster',
  name: 'Door Caster',
  seed: 'test',
  playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
  checkpoints: [],
  rooms: [
    { id: 'A', name: 'A', pieces: [{ kit: 'corridor_straight', cell: [0, 0, 0], rot: 0 }] },
    { id: 'B', name: 'B', pieces: [{ kit: 'corridor_straight', cell: [0, 0, 1], rot: 0 }] },
  ],
  doors: [{ id: 'D', kit: 'pressure_slide', between: ['A', 'B'], cell: [0, 0, 1], rot: 0, state: 'sealed' }],
};

test('a door bumps its caster only while its leaves move, and the level releases it on dispose', () => {
  const casters = new ShadowCasterSet();
  const level = new Level(data, { materials: createMaterials(8, 4), registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene(), inventory: null, shadowCasters: casters });
  assert.equal(casters.size, 1, 'one caster for the one door');
  const door = [...casters][0]!;
  const eye = new THREE.Vector3(0, 1.7, -30);
  const run = (s: number, from = 0): void => {
    for (let i = 0; i < Math.round(s * 60); i++) level.update(from + i / 60, 1 / 60, eye, false);
  };
  run(0.2);
  const shut = door.version;
  run(0.5, 0.2);
  assert.equal(door.version, shut, 'a shut door does not bump');
  assert.ok(level.setDoor('D', 'open'));
  run(0.1, 0.7);
  assert.notEqual(door.version, shut, 'opening leaves bump');
  run(4, 0.8);
  const open = door.version;
  run(0.5, 4.8);
  assert.equal(door.version, open, 'an open door at rest does not bump');
  level.dispose();
  assert.equal(casters.size, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import type { LevelData } from '../data/types/level.ts';
import { createMaterials, disposeMaterials } from '../render/materials.ts';

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

// level-kit spec "A sliding door can be forced partly open" (overhaul-flooded-tunnel D13).
function twoRooms(): LevelData {
  return {
    id: 'pry_test',
    name: 'Pry Test',
    seed: 'test',
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    checkpoints: [],
    rooms: [
      { id: 'A', name: 'A', pieces: [{ kit: 'corridor_straight', cell: [0, 0, 0], rot: 0 }] },
      { id: 'B', name: 'B', pieces: [{ kit: 'corridor_straight', cell: [0, 0, 1], rot: 0 }] },
    ],
    doors: [{ id: 'D', kit: 'pressure_slide', between: ['A', 'B'], cell: [0, 0, 1], rot: 0, state: 'sealed' }],
  };
}

test('doorPry parts a sealed door to a fraction over time, keeps it sealed, and the next state slams it from there', () => {
  const materials = createMaterials(8, 4);
  const events = new EventBus();
  const states: string[] = [];
  events.on('door:state', (e) => states.push(e.state));
  const level = new Level(twoRooms(), { materials, registry: new KitRegistry({ glb: {} }), events, scene: new THREE.Scene(), inventory: null });
  // Far from the door, so the doorway rules never come into it.
  const eye = new THREE.Vector3(0, 1.7, -30);
  const run = (s: number): void => {
    for (let i = 0; i < Math.round(s * 60); i++) level.update(i / 60, 1 / 60, eye, false);
  };
  const leaves = level.group.getObjectByName('door-leaves:pressure_slide')!;
  const leafX = (): number => Math.abs(leaves.children[1]!.position.x);
  const shutX = leafX();

  assert.ok(level.pryDoor('D', 0.45, 1));
  run(0.5);
  const half = level.doorOpenness('D')!;
  assert.ok(half > 0.15 && half < 0.3, `halfway through the pry (${half.toFixed(2)})`);
  run(0.7);
  assert.ok(Math.abs(level.doorOpenness('D')! - 0.45) < 1e-6, 'held at the forced fraction');
  assert.ok(leafX() > shutX + 0.2, 'the leaves have parted from the middle');
  assert.equal(level.doorStates()['D'], 'sealed', 'still sealed while pried');
  assert.deepEqual(states, [], 'prying never changes the state');

  level.setDoor('D', 'sealed');
  run(0.3);
  assert.ok(level.doorOpenness('D')! > 0, 'closing at the normal speed, not snapped');
  run(0.3);
  assert.equal(level.doorOpenness('D'), 0, 'slammed shut from the part-open position');

  // A zero-time pry snaps (a skipped scene).
  level.pryDoor('D', 0.3, 0);
  assert.equal(level.doorOpenness('D'), 0.3);
  assert.equal(level.pryDoor('nope', 0.5, 1), false);
  level.dispose();
  disposeMaterials(materials);
});

// game-pause: a frozen scene gives the level no time.
test('a moving door given no time stays part way open, then carries on', () => {
  const materials = createMaterials(8, 4);
  const events = new EventBus();
  let moves = 0;
  events.on('door:move', () => moves++);
  const level = new Level(twoRooms(), { materials, registry: new KitRegistry({ glb: {} }), events, scene: new THREE.Scene(), inventory: null });
  const eye = new THREE.Vector3(0, 1.7, -30);
  const run = (s: number, dt = 1 / 60): void => {
    for (let i = 0; i < Math.round(s * 60); i++) level.update(i / 60, dt, eye, false);
  };
  level.pryDoor('D', 0.45, 1);
  run(0.5);
  const part = level.doorOpenness('D')!;
  const started = moves;
  run(10, 0);
  assert.equal(level.doorOpenness('D'), part);
  assert.equal(moves, started, 'and starts no new door sound');
  run(0.7);
  assert.ok(Math.abs(level.doorOpenness('D')! - 0.45) < 1e-6);
  level.dispose();
  disposeMaterials(materials);
});

// flooded-tunnel spec (overhaul-valve-cutscene D7): the ambush pries wider, to 0.5, but the gap is still too narrow to pass.
test('at the widest pry the ambush uses (0.5) the door still blocks the doorway; only a fuller opening lets a body through', () => {
  const materials = createMaterials(8, 4);
  const events = new EventBus();
  const level = new Level(twoRooms(), { materials, registry: new KitRegistry({ glb: {} }), events, scene: new THREE.Scene(), inventory: null });
  const eye = new THREE.Vector3(0, 1.7, -30);
  const run = (s: number): void => {
    for (let i = 0; i < Math.round(s * 60); i++) level.update(i / 60, 1 / 60, eye, false);
  };
  const blocked = (): boolean => level.collision.raycast(0, 1, -2, 0, 0, 1, 16) !== null;
  level.pryDoor('D', 0.5, 0.5);
  run(1);
  assert.ok(Math.abs(level.doorOpenness('D')! - 0.5) < 1e-6);
  assert.equal(blocked(), true, 'the doorway is still blocked at 0.5');
  assert.equal(level.doorStates()['D'], 'sealed');
  level.pryDoor('D', 1, 0.5);
  run(1);
  assert.equal(blocked(), false, 'a fully open door lets a body through (proves the probe)');
  level.dispose();
  disposeMaterials(materials);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { Rng } from '../core/rng.ts';
import type { LevelData } from '../data/types/level.ts';
import type { Materials } from '../render/materials.ts';
import { DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import { CollisionWorld } from '../world/collision.ts';
import { Level } from '../world/level.ts';
import { KitRegistry } from '../world/registry.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';
import { PhysicsProps, PlayerPusher } from './interaction.ts';
import { physicsDebris, STATIC_AFTER } from './debris.ts';

// physical-interaction spec, Block 5 tasks 6.1 and 6.3, headless (a stub 2D canvas for the gore system's textures).
const noop = (): void => undefined;
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k, v) => ((t[k] = v), true),
});
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, getContext: () => ctx, style: {} }) };
const { GoreSystem } = await import('../actors/gore.ts');

const STEP = 1 / 60;
const WALK = 3.2;

function floorRoom(): CollisionWorld {
  const c = new CollisionWorld();
  c.add({ min: [-10, -0.2, -10], max: [10, 0, 10] }, 'floor', 'concrete');
  return c;
}

/** Walk the player motor from x = -3 to x = 3 along z = 0; return the per-step feet positions. */
function walk(colliders: CollisionWorld, each?: (feet: MotorState) => void): MotorState[] {
  const s: MotorState = { x: -3, y: 0, z: 0, vy: 0, grounded: true };
  const trail: MotorState[] = [];
  for (let i = 0; i < Math.round(6 / WALK / STEP); i++) {
    moveBody(s, WALK * STEP, 0, STEP, DEFAULT_MOTOR, colliders);
    each?.(s);
    trail.push({ ...s });
  }
  return trail;
}

test('walking over a severed arm nudges it aside and leaves the player speed and height unchanged', async () => {
  const colliders = floorRoom();
  const baseline = walk(colliders);

  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  const gore = new GoreSystem(new Rng('push'));
  const debris = physicsDebris(world);
  gore.setDebrisBackend(debris);
  const arm = new THREE.Group();
  arm.position.set(0, 0.06, -0.15);
  arm.updateMatrixWorld(true);
  gore.addDebris(arm, new THREE.Vector3(), [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.6)], 0.05, noop);
  // Let it settle and lock (as an arm lying there a while would be).
  for (let i = 0; i < Math.round((STATIC_AFTER + 0.5) / STEP); i++) {
    world.step(STEP);
    gore.update(STEP);
  }
  const before = arm.position.clone();

  const pusher = new PlayerPusher(world, DEFAULT_MOTOR.radius);
  const pushed = walk(colliders, (feet) => {
    debris.wakeNear(feet, DEFAULT_MOTOR.radius + 0.8);
    pusher.update(feet);
    world.step(STEP);
    gore.update(STEP);
  });
  for (let i = 0; i < 60; i++) {
    world.step(STEP);
    gore.update(STEP);
  }
  assert.ok(arm.position.distanceTo(before) > 0.2, `the arm moved (${arm.position.distanceTo(before).toFixed(2)} m)`);
  assert.ok(arm.position.y < 0.3, 'and stays on the floor');
  assert.deepEqual(pushed, baseline, 'the player walked exactly as without the arm');
  pusher.destroy();
  world.destroy();
});

const mats = new Proxy({} as Record<string, THREE.Material>, {
  get: (t, k: string) => (t[k] ??= k === 'glass' ? new THREE.MeshPhysicalMaterial({ transparent: true }) : Object.assign(new THREE.MeshStandardMaterial(), { name: k })),
}) as unknown as Materials;

/** One 3 x 1 cell room with a crate marked dynamic at x = 0 and a locker (unmarked) at x = 8. */
function propLevel(): Level {
  const cells = [0, 1, 2].map((x) => [x, 0, 0] as [number, number, number]);
  const data: LevelData = {
    id: 'props_test',
    seed: 1,
    playerStart: { room: 'A', pos: [0, 0, 0], yaw: 0 },
    rooms: [
      {
        id: 'A',
        name: 'A',
        pieces: [{ kit: 'floor', cells }],
        props: [
          { kit: 'crate', pos: [0, 0, 0], params: { id: 'crate_a' }, dynamic: { mass: 20 } },
          { kit: 'locker', pos: [8, 0, 0] },
        ],
      },
    ],
    doors: [],
    checkpoints: [],
  };
  return new Level(data, { materials: mats, registry: new KitRegistry({ glb: {} }), events: new EventBus(), scene: new THREE.Scene() });
}

test('only props marked dynamic get a body; the player pushes one, and its collision follows it', async () => {
  const level = propLevel();
  assert.deepEqual(level.physicsProps().map((p) => p.id), ['crate_a']);
  const world = await PhysicsWorld.create(createRapierEngine, level.collision);
  const props = new PhysicsProps(world, level);
  const pusher = new PlayerPusher(world, DEFAULT_MOTOR.radius);
  const crate = level.propState('crate_a')!;
  const startX = crate.pos.x;
  const lockerBoxes = level.collision.colliders.filter((c) => c.minX > 7).map((c) => [c.minX, c.maxX, c.minY]);

  // Walk into the crate from -x at walking speed; the motor collides with the crate's live boxes.
  const s: MotorState = { x: -2, y: 0, z: 0, vy: 0, grounded: true };
  for (let i = 0; i < 80; i++) {
    moveBody(s, WALK * STEP, 0, STEP, DEFAULT_MOTOR, level.collision);
    pusher.update(s);
    world.step(STEP);
    props.sync();
  }
  const moved = level.propState('crate_a')!;
  assert.ok(moved.pos.x - startX > 1, `the crate was pushed (${(moved.pos.x - startX).toFixed(2)} m)`);
  assert.ok(s.x > 0, `and the player kept walking behind it (feet at x ${s.x.toFixed(2)})`);
  const box = moved.colliders[0]!;
  assert.ok(box.minX > s.x, 'its collision box moved with it, ahead of the player');
  assert.deepEqual(level.collision.colliders.filter((c) => c.minX > 7).map((c) => [c.minX, c.maxX, c.minY]), lockerBoxes, 'the unmarked locker never moved');

  // A blast at the locker does nothing to it: it has no body, only its static mirror.
  const hit = world.engine.raycast({ x: 6, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 5);
  assert.ok(hit, 'the locker is solid to physics');
  assert.equal(props.near({ x: 8, y: 0, z: 0 }, 1.5).length, 0, 'and there is no locker body to push');
  pusher.destroy();
  world.destroy();
});

test('a level reset puts a pushed prop back, and the rebuilt world starts it there', async () => {
  const level = propLevel();
  const world = await PhysicsWorld.create(createRapierEngine, level.collision);
  const props = new PhysicsProps(world, level);
  const body = props.bodyOf('crate_a')!;
  world.engine.applyImpulse(body, { x: 80, y: 0, z: 0 });
  for (let i = 0; i < 60; i++) {
    world.step(STEP);
    props.sync();
  }
  assert.ok(level.propState('crate_a')!.pos.x > 0.5, 'pushed away');
  const reset = world.reset();
  props.sync(); // while the reset is in flight: must not write the old body over the level's restore
  level.setPropTransform('crate_a', { x: 0, y: 0, z: 0 }, 0); // what level:reset does
  props.sync();
  await reset;
  for (let i = 0; i < 30; i++) {
    world.step(STEP);
    props.sync();
  }
  assert.ok(Math.abs(level.propState('crate_a')!.pos.x) < 0.05, `back at its spot (${level.propState('crate_a')!.pos.x.toFixed(3)})`);
  assert.equal(props.ids.length, 1);
  world.destroy();
});

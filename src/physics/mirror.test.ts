import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../world/collision.ts';
import type { BodyHandle } from './engine.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';

// physics-world "Physics collides with the level as the player does" (task 2.4).

const STEP = 1 / 60;

/** Floor, a wall at x = 0 with a 2 m doorway (z -1..1) and a closed door in it. */
function room(): { colliders: CollisionWorld; door: ReturnType<CollisionWorld['add']> } {
  const colliders = new CollisionWorld();
  colliders.add({ min: [-10, -0.2, -10], max: [10, 0, 10] }, 'floor', 'concrete');
  colliders.add({ min: [-0.2, 0, -10], max: [0.2, 3, -1] }, 'wall');
  colliders.add({ min: [-0.2, 0, 1], max: [0.2, 3, 10] }, 'wall');
  const door = colliders.add({ min: [-0.1, 0, -1], max: [0.1, 2.4, 1] }, 'door:test');
  return { colliders, door };
}

/** A ball rolled from x = 3 toward the doorway. */
function rollThrough(world: PhysicsWorld): BodyHandle {
  const e = world.engine;
  const ball = e.createBody({ kind: 'dynamic', position: { x: 3, y: 0.5, z: 0 }, linvel: { x: -6, y: 0, z: 0 }, ccd: true });
  e.createCollider({ shape: { kind: 'ball', radius: 0.2 }, friction: 0.1 }, ball);
  return ball;
}

test('every enabled collider is mirrored with matching bounds', async () => {
  const { colliders } = room();
  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  assert.equal(world.staticCount, colliders.colliders.length);
  world.step(STEP); // queries see colliders as of the last step
  // A ray dropped from high above a point inside each box's footprint (90% of the way across, clear of the
  // other boxes in this room) lands on that box's top.
  for (const c of colliders.colliders) {
    const px = c.minX + (c.maxX - c.minX) * 0.9;
    const pz = c.minZ + (c.maxZ - c.minZ) * 0.9;
    const hit = world.engine.raycast({ x: px, y: 10, z: pz }, { x: 0, y: -1, z: 0 }, 20);
    assert.equal(hit?.tag, c.id, `ray hits collider ${c.id} (${c.tag})`);
    assert.ok(Math.abs(hit!.point.y - c.maxY) < 1e-3, `top of ${c.tag} at ${c.maxY}`);
  }
  world.destroy();
});

test('a closed door blocks a body; an open door lets it through', async () => {
  const { colliders, door } = room();
  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  const blocked = rollThrough(world);
  for (let i = 0; i < 120; i++) world.step(STEP);
  assert.ok(world.engine.transform(blocked).position.x > 0.1, 'stopped by the closed door');
  world.engine.destroyBody(blocked);
  door.enabled = false;
  const passes = rollThrough(world);
  for (let i = 0; i < 120; i++) world.step(STEP);
  const x = world.engine.transform(passes).position.x;
  assert.ok(x < -0.5, `rolled through the open door (x = ${x.toFixed(2)})`);
  world.destroy();
});

test('a door closing on a body pushes it out of the door volume', async () => {
  const { colliders, door } = room();
  door.enabled = false;
  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  const e = world.engine;
  // A severed limb lying across the doorway, inside where the door will be.
  const limb = e.createBody({ kind: 'dynamic', position: { x: 0.05, y: 0.06, z: 0 } });
  e.createCollider({ shape: { kind: 'capsule', halfHeight: 0.13, radius: 0.05 }, rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } }, limb);
  for (let i = 0; i < 30; i++) world.step(STEP);
  door.enabled = true;
  for (let i = 0; i < 120; i++) world.step(STEP);
  const p = e.transform(limb).position;
  // The limb's centre must have left the door slab (|x| < 0.1) or be resting on top of it.
  const insideDoor = Math.abs(p.x) < 0.1 && p.y < 2.4 && Math.abs(p.z) < 1;
  assert.ok(!insideDoor, `limb pushed out of the door volume (x ${p.x.toFixed(2)}, y ${p.y.toFixed(2)})`);
  assert.ok(p.y > -0.05, 'and not through the floor');
  world.destroy();
});

test('colliders added to the level after creation are mirrored on the next step', async () => {
  const { colliders } = room();
  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  const before = world.staticCount;
  colliders.add({ min: [4, 0, 4], max: [5, 1, 5] }, 'prop:crate', 'metal');
  world.step(STEP);
  assert.equal(world.staticCount, before + 1);
  assert.ok(world.engine.raycast({ x: 4.5, y: 3, z: 4.5 }, { x: 0, y: -1, z: 0 }, 5)!.point.y > 0.99);
  world.destroy();
});

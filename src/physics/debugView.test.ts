import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../world/collision.ts';
import { BODY_COLOURS, PhysicsDebugView } from './debugView.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { PhysicsWorld } from './world.ts';

// physics-world "Physics colliders can be inspected" (task 2.6).

const STEP = 1 / 60;

test('the view draws the level mirror and colours bodies by state', async () => {
  const colliders = new CollisionWorld();
  colliders.add({ min: [-5, -0.2, -5], max: [5, 0, 5] }, 'floor', 'concrete');
  const door = colliders.add({ min: [-0.1, 0, -1], max: [0.1, 2.4, 1] }, 'door:test');
  const world = await PhysicsWorld.create(createRapierEngine, colliders);
  const e = world.engine;
  const resting = e.createBody({ kind: 'dynamic', position: { x: 2, y: 0.25, z: 0 } });
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 0.25, y: 0.25, z: 0.25 } } }, resting);
  const falling = e.createBody({ kind: 'dynamic', position: { x: -2, y: 4, z: 0 }, canSleep: false });
  e.createCollider({ shape: { kind: 'ball', radius: 0.2 } }, falling);
  const frozen = e.createBody({ kind: 'fixed', position: { x: 3, y: 0.1, z: 3 } });
  e.createCollider({ shape: { kind: 'capsule', halfHeight: 0.2, radius: 0.05 } }, frozen);
  for (let i = 0; i < 90; i++) world.step(STEP);

  const view = new PhysicsDebugView();
  view.update(e);
  assert.equal(view.counts.statics, 2, 'floor and closed door');
  assert.equal(view.counts.asleep, 1, 'the resting box is asleep');
  assert.equal(view.counts.active, 1, 'the never-sleeping ball is active');
  assert.equal(view.counts.frozen, 1, 'the fixed body is shown frozen');
  const colours = view.group.children
    .filter((c): c is THREE.LineSegments => c instanceof THREE.LineSegments && c.visible)
    .map((c) => (c.material as THREE.LineBasicMaterial).color.getHex());
  for (const want of [BODY_COLOURS.active, BODY_COLOURS.asleep, BODY_COLOURS.frozen]) assert.ok(colours.includes(want), `draws a ${want.toString(16)} collider`);

  door.enabled = false;
  world.step(STEP);
  view.update(e);
  assert.equal(view.counts.statics, 1, 'an open door is not drawn');
  door.enabled = true;
  world.step(STEP);
  view.update(e);
  assert.equal(view.counts.statics, 2, 'and comes back when it closes');

  view.visible = false;
  e.destroyBody(falling);
  view.update(e);
  assert.equal(view.counts.active, 1, 'a hidden view does not update');
  view.dispose();
  world.destroy();
});

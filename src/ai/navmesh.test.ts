import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CollisionWorld } from '../world/collision.ts';
import type { Aabb } from '../actors/motor.ts';
import { buildNavMeshBytes, initNavmesh, NavMeshNav } from './navmesh.ts';

function twoRoomsWithDoor(): { world: CollisionWorld; boxes: Aabb[]; doorBox: Aabb } {
  const world = new CollisionWorld(2);
  const addBox = (min: [number, number, number], max: [number, number, number]): void => {
    world.add({ min, max });
  };
  // Floor spanning two 4x4 rooms joined along X = 0.
  addBox([-4, -0.2, -2], [4, 0, 2]);
  // Dividing wall at X = 0 with a 1.6 m doorway in the middle (Z in [-0.8, 0.8]).
  addBox([-0.15, 0, -2], [0.15, 3, -0.8]);
  addBox([-0.15, 0, 0.8], [0.15, 3, 2]);
  // Perimeter walls.
  addBox([-4.2, 0, -2], [-4, 3, 2]);
  addBox([4, 0, -2], [4.2, 3, 2]);
  addBox([-4, 0, -2.2], [4, 3, -2]);
  addBox([-4, 0, 2], [4, 3, 2.2]);

  const doorBox: Aabb = { min: [-0.1, 0, -0.8], max: [0.1, 2.4, 0.8] };
  return { world, boxes: world.colliders, doorBox };
}

test('NavMeshNav.buildAsync and bytes round-trip match synchronous pathfinding and door-area toggling', async () => {
  await initNavmesh();
  const { world, boxes, doorBox } = twoRoomsWithDoor();
  let open = true;
  const doors = [{ id: 'D1', box: doorBox, isOpen: () => open }];

  const syncNav = new NavMeshNav({ world, boxes, doors });
  const bytes = buildNavMeshBytes(boxes, doors);
  const fromBytesNav = new NavMeshNav({ world, boxes, doors, bytes });
  const asyncNav = await NavMeshNav.buildAsync({ world, boxes, doors });

  assert.ok(bytes.byteLength > 0);
  assert.equal(fromBytesNav.edgeCount(), syncNav.edgeCount());
  assert.equal(asyncNav.edgeCount(), syncNav.edgeCount());
  assert.deepEqual(fromBytesNav.unmarkedDoors(), []);
  assert.deepEqual(asyncNav.unmarkedDoors(), []);

  const from = { x: -2.5, y: 0, z: 0 };
  const to = { x: 2.5, y: 0, z: 0 };

  // Open door: route succeeds on all three.
  open = true;
  const pSync = syncNav.findPath(from, to);
  const pBytes = fromBytesNav.findPath(from, to);
  const pAsync = asyncNav.findPath(from, to);
  assert.ok(pSync && pSync.length > 0, 'sync finds path across open door');
  assert.deepEqual(pBytes, pSync, 'bytes-loaded navmesh matches sync path');
  assert.deepEqual(pAsync, pSync, 'buildAsync navmesh matches sync path');

  // Closed door: route is blocked on all three.
  open = false;
  assert.equal(syncNav.findPath(from, to), null);
  assert.equal(fromBytesNav.findPath(from, to), null);
  assert.equal(asyncNav.findPath(from, to), null);

  syncNav.destroy();
  fromBytesNav.destroy();
  asyncNav.destroy();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxColliders, type Aabb } from '../actors/motor.ts';
import { clearWalk, gridNodes, NavGraph, type NavDoor } from './nav.ts';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb => ({ min: [x0, y0, z0], max: [x1, y1, z1] });

/**
 * Two rooms side by side (x -6..0 and 0..6, z -4..4), a dividing wall at x=0 with a 2 m gap
 * at z -1..1 holding a door, and a pillar in the left room.
 */
function rooms(doorClosed: { v: boolean }): { world: BoxColliders; door: NavDoor } {
  const doorBox = box(-0.15, 0, -1, 0.15, 2.4, 1);
  const statics = [
    box(-6, -0.3, -4, 6, 0, 4), // floor
    box(-6.3, 0, -4, -6, 3, 4),
    box(6, 0, -4, 6.3, 3, 4),
    box(-6, 0, -4.3, 6, 3, -4),
    box(-6, 0, 4, 6, 3, 4.3),
    box(-0.15, 0, -4, 0.15, 3, -1), // dividing wall
    box(-0.15, 0, 1, 0.15, 3, 4),
    box(-3.5, 0, -0.5, -2.5, 3, 0.5), // pillar
  ];
  const all = [...statics, doorBox];
  const world = new BoxColliders(all);
  // A closed door blocks bodies; an open one is removed from the query.
  const query = world.query.bind(world);
  world.query = (a, b, c, d, out) => {
    const res = query(a, b, c, d, out);
    if (!doorClosed.v) {
      const i = res.indexOf(doorBox);
      if (i >= 0) res.splice(i, 1);
    }
    return res;
  };
  return { world, door: { id: 'D', box: doorBox, isOpen: () => !doorClosed.v } };
}

test('clearWalk sees walls and pillars', () => {
  const closed = { v: false };
  const { world } = rooms(closed);
  assert.equal(clearWalk(world, { x: -5, y: 0, z: 2 }, { x: -1, y: 0, z: 2 }, 0.3), true);
  assert.equal(clearWalk(world, { x: -5, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, 0.3), false, 'pillar');
  assert.equal(clearWalk(world, { x: -3, y: 0, z: 3 }, { x: 3, y: 0, z: 3 }, 0.3), false, 'wall');
});

test('grid nodes skip walls and the pillar', () => {
  const { world } = rooms({ v: false });
  const nodes = gridNodes(world, { minX: -5.5, maxX: 5.5, minZ: -3.5, maxZ: 3.5, maxY: 1 });
  assert.ok(nodes.length > 40);
  assert.ok(!nodes.some((n) => Math.abs(n.x + 3) < 0.6 && Math.abs(n.z) < 0.6), 'no node inside the pillar');
  assert.ok(nodes.every((n) => n.y === 0));
});

test('paths go round the pillar and through an open door, and stop at a closed one', () => {
  const closed = { v: false };
  const { world, door } = rooms(closed);
  const nodes = gridNodes(world, { minX: -5.5, maxX: 5.5, minZ: -3.5, maxZ: 3.5, maxY: 1 });
  const g = new NavGraph({ world, nodes, doors: [door] });
  assert.ok(g.edgeCount() > nodes.length);

  // Round the pillar: start and goal on either side of it.
  const p1 = g.findPath({ x: -5, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
  assert.ok(p1 && p1.length >= 2, 'needs a detour');
  let prev = { x: -5, y: 0, z: 0 };
  for (const w of p1!) {
    assert.ok(clearWalk(world, prev, w, 0), 'every leg is walkable');
    prev = w;
  }

  // Through the door into the other room.
  const p2 = g.findPath({ x: -4, y: 0, z: 3 }, { x: 4, y: 0, z: 3 });
  assert.ok(p2, 'route through the open door');
  assert.deepEqual(p2!.at(-1), { x: 4, y: 0, z: 3 });

  closed.v = true;
  assert.equal(g.findPath({ x: -4, y: 0, z: 3 }, { x: 4, y: 0, z: 3 }), null, 'closed door blocks');
  assert.ok(g.findPath({ x: -4, y: 0, z: 3 }, { x: -1, y: 0, z: -3 }), 'same room still fine');
});

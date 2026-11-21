import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initNavmesh } from './navmesh.ts';
import { loadSlice01 } from '../world/headlessSlice.ts';

// NavMeshNav.nodes once sampled one poly per column across the full height, which returned ceiling-slab tops and
// hid the floors, so the director's reachable() culled every out-of-view group enemy after 10 s (rebuild-lab-wing 5.1).

await initNavmesh();

test('nav nodes include the floor under rooms that have walkable slab tops above them', () => {
  const nav = loadSlice01().level.navGraph();
  const nodes = nav.nodes;
  const near = (x: number, z: number, maxY: number) => nodes.filter((n) => Math.abs(n.x - x) <= 1 && Math.abs(n.z - z) <= 1 && n.y <= maxY);
  // R06 floor around the hold point and the trench, R05 floor, Lab B floor.
  for (const [x, z] of [[-0.5, 29.2], [-5.15, 35.4], [-2.6, 20], [6, 27]] as const)
    assert.ok(near(x, z, 0.6).length > 0, `a floor node near (${x}, ${z})`);
});

test('nav nodes are not duplicated within a level of a column', () => {
  const nodes = loadSlice01().level.navGraph().nodes;
  const key = new Map<string, number[]>();
  for (const n of nodes) {
    const k = `${Math.round(n.x * 2)},${Math.round(n.z * 2)}`;
    const ys = key.get(k) ?? [];
    assert.ok(!ys.some((y) => Math.abs(y - n.y) < 0.3), `duplicate node at ${k} y ${n.y}`);
    ys.push(n.y);
    key.set(k, ys);
  }
});

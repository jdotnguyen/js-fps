import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SpawnPointData } from '../ai/spawner.ts';
import { director, run, stubTarget } from '../ai/enemyTestKit.ts';
import { initNavmesh } from '../ai/navmesh.ts';
import { loadSlice01 } from './headlessSlice.ts';

// lab-wing spec, "The fight still resolves" (openspec rebuild-lab-wing 5.1): the R05 trickle and the R06 cover group,
// simulated on the real slice01 geometry and navmesh against Jay and Giles standing where the fights put them.

await initNavmesh();
const LEVEL = JSON.parse(readFileSync(new URL('../data/levels/slice01.json', import.meta.url), 'utf8')) as { rooms: Array<{ spawns?: SpawnPointData[] }> };

function fight(group: string, open: string[], targets: Array<{ id: string; at: [number, number, number]; kind: 'player' | 'squad' }>) {
  const { level, doors } = loadSlice01();
  for (const d of doors) if (open.includes(d.data.id)) d.collider.enabled = false;
  const world = { colliders: level.playerWorld.colliders, nav: level.navGraph() };
  const { dir, events } = director(world as never, { seed: group });
  for (const t of targets) dir.addTarget(stubTarget(t.id, t.at, { kind: t.kind, grabbable: false }));
  dir.setSpawns(LEVEL.rooms.flatMap((r) => r.spawns ?? []));
  const spawned = new Set<string>();
  const reached = new Set<string>();
  const culled = new Set<string>();
  events.on('enemy:spawned', (p: { id: string; group?: string | null }) => void (p.group === group && spawned.add(p.id)));
  events.on('enemy:attack', (p) => void reached.add(p.id));
  events.on('enemy:culled', (p) => void culled.add(p.id));
  assert.ok(dir.spawnGroup(group), `${group} spawns`);
  const resolved = () => spawned.size > 0 && [...spawned].every((id) => reached.has(id) || culled.has(id));
  const t = run(dir, 90, () => resolved() && spawned.size === expected.get(group));
  // Then finish them: a point-blank shove around each live member kills it (test enemies have 1 hp).
  for (const e of dir.list.filter((x) => x.alive && x.group === group)) dir.shove([e.motor.x, e.motor.y + 1, e.motor.z], [0, 0, 1], 2, 360, 10_000, 0);
  run(dir, 3, () => dir.groupCleared(group));
  return { spawned, reached, culled, seconds: t, cleared: dir.groupCleared(group) };
}
const expected = new Map([['r06_cover', 6], ['r05_trickle', 3]]);

test('R06 cover-me: all six reach Jay or Giles (or are resolved), and the group completes', () => {
  const r = fight('r06_cover', ['D_R05_R06'], [
    { id: 'player', at: [-0.5, 0, 29.2], kind: 'player' },
    { id: 'giles', at: [-2.2, 0, 37.0], kind: 'squad' },
  ]);
  assert.equal(r.spawned.size, 6, `spawned ${[...r.spawned].join(', ')}`);
  const stuck = [...r.spawned].filter((id) => !r.reached.has(id) && !r.culled.has(id));
  assert.deepEqual(stuck, [], `unresolved after ${r.seconds.toFixed(0)} s`);
  assert.ok(r.reached.size >= 5, `${r.reached.size} of 6 reached a target (culled: ${[...r.culled].join(', ') || 'none'})`);
  assert.ok(r.cleared, 'group cleared');
});

test('R05 trickle: the vent pair and the drain enemy reach the squad and the group completes', () => {
  const r = fight('r05_trickle', [], [
    { id: 'player', at: [-1.6, 0, 18.5], kind: 'player' },
    { id: 'okafor', at: [0.4, 0, 17.0], kind: 'squad' },
  ]);
  assert.equal(r.spawned.size, 3);
  assert.deepEqual([...r.spawned].filter((id) => !r.reached.has(id) && !r.culled.has(id)), []);
  assert.ok(r.cleared);
});

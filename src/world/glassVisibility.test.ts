import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { levelFileIds, loadLevel } from './headlessSlice.ts';
import { edgeDir } from './kit/grid.ts';

// room-visibility spec, "Level data declares glass visibility both ways": every glass partition joins two
// rooms that are each in the other's `visibleFrom`, so either side draws the other (and the glass) when
// the camera stands in it. One-way glass shows a hole into the void from behind.

type Cell = [number, number, number];
type Piece = { kit: string; cell?: Cell; cells?: Cell[]; rot?: number };
const cellsOf = (p: Piece): Cell[] => p.cells ?? (p.cell ? [p.cell] : []);
type Room = { id: string; pieces: Piece[]; visibleFrom?: string[] };

const SIDE: Record<string, string> = { '0,-1': 'n', '1,0': 'e', '0,1': 's', '-1,0': 'w' };

/** One message per glass partition edge whose two rooms do not each list the other in `visibleFrom`. */
export function glassVisibilityGaps(rooms: readonly Room[]): string[] {
  const owner = new Map<string, string>();
  for (const r of rooms) for (const p of r.pieces) if (p.kit.startsWith('floor')) for (const [x, , z] of cellsOf(p)) owner.set(`${x},${z}`, r.id);
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const gaps: string[] = [];
  for (const r of rooms) {
    for (const p of r.pieces) {
      if (p.kit !== 'wall_glass_partition') continue;
      const [dx, dz] = edgeDir(p.rot ?? 0);
      for (const [x, , z] of cellsOf(p)) {
        const edge = `${x},${z},${SIDE[`${dx},${dz}`]}`;
        const other = owner.get(`${x + dx},${z + dz}`);
        if (!other) {
          gaps.push(`${r.id} glass at ${edge} has no room behind it`);
          continue;
        }
        const sees = (from: string, to: string): boolean => byId.get(to)?.visibleFrom?.includes(from) ?? false;
        if (!sees(r.id, other) || !sees(other, r.id)) {
          gaps.push(`glass ${r.id} <-> ${other} at ${edge}: ${r.id} draws ${other}=${sees(r.id, other)}, ${other} draws ${r.id}=${sees(other, r.id)}`);
        }
      }
    }
  }
  return gaps;
}

for (const id of levelFileIds()) {
  test(`${id}: glass partitions are see-through from both sides`, () => {
    const data = JSON.parse(readFileSync(new URL(`../data/levels/${id}.json`, import.meta.url), 'utf8')) as { rooms: Room[] };
    assert.deepEqual(glassVisibilityGaps(data.rooms), []);
  });
}

test('one-way glass is reported with both rooms and the edge', () => {
  const rooms: Room[] = [
    { id: 'A', pieces: [{ kit: 'floor', cells: [[0, 0, 0]] }, { kit: 'wall_glass_partition', cells: [[0, 0, 0]], rot: 180 }] },
    { id: 'B', pieces: [{ kit: 'floor', cells: [[0, 0, 1]] }], visibleFrom: ['A'] },
  ];
  const gaps = glassVisibilityGaps(rooms);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]!, /A <-> B at 0,0,s/);
  rooms[0]!.visibleFrom = ['B'];
  assert.deepEqual(glassVisibilityGaps(rooms), []);
});

test('slice01: Lab B draws the gallery and its glass, and the gallery draws Lab B', async () => {
  const THREE = await import('three');
  const { level } = loadLevel('slice01');
  const room = (id: string) => level.group.getObjectByName(`room:${id}`)!;
  level.group.updateMatrixWorld(true);
  // Cell centres: Lab B (2,6) and the gallery (2,4); cells are 4 m.
  level.renderFromEye(new THREE.Vector3(8, 1.7, 26), () => {
    assert.ok(room('R03').visible, 'gallery drawn from Lab B');
    // The panes are R03's pieces (the headless loader gives `glass` a physical material); all three must draw.
    const panes: InstanceType<typeof THREE.Mesh>[] = [];
    room('R03').traverse((o) => {
      const m = o as InstanceType<typeof THREE.Mesh>;
      if (m.isMesh && m.material instanceof THREE.MeshPhysicalMaterial) panes.push(m);
    });
    assert.ok(panes.length >= 3, `gallery glass panes found: ${panes.length}`);
    for (const pane of panes) {
      let shown = true;
      pane.traverseAncestors((a) => void (shown &&= a.visible));
      assert.ok(shown && pane.visible, 'every gallery pane draws from Lab B');
    }
    assert.equal(room('R02').visible, false, 'the commons is not drawn through the gallery glass');
  });
  level.renderFromEye(new THREE.Vector3(8, 1.7, 18), () => {
    assert.ok(room('R04').visible, 'Lab B drawn from the gallery');
  });
});

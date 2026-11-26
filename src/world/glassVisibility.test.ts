import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelFileIds, loadLevel } from './headlessSlice.ts';
import { edgeDir } from './kit/grid.ts';
import { readLevel } from '../data/levels/readLevel.ts';

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
    const data = readLevel(id) as { rooms: Room[] };
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

test('slice01: glass partitions, multi-hop portal sightlines, and frustum culling', async () => {
  const THREE = await import('three');
  const { level } = loadLevel('slice01');
  const room = (id: string) => level.group.getObjectByName(`room:${id}`)!;
  const makeCam = (pos: [number, number, number], target: [number, number, number]) => {
    const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100);
    c.position.set(...pos);
    c.lookAt(...target);
    c.updateMatrixWorld(true);
    return c;
  };
  level.group.updateMatrixWorld(true);

  // 1. Existing bidirectional glass partition guarantee (Lab B <-> Observation Gallery, closed D_R02_R03 keeps Commons hidden).
  level.renderFromEye(new THREE.Vector3(8, 1.7, 26), () => {
    assert.ok(room('R03').visible, 'gallery drawn from Lab B');
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
    assert.equal(room('R02').visible, false, 'the commons is not drawn through the gallery glass while D_R02_R03 is shut');
  });
  level.renderFromEye(new THREE.Vector3(8, 1.7, 18), () => {
    assert.ok(room('R04').visible, 'Lab B drawn from the gallery');
  });

  // 2. TAG Offices glass chain (R02 -> R14a -> R14b -> R14d/R14c) with all opaque doors shut.
  const camTag = makeCam([31.5, 1.7, 13.5], [40, 1.7, 6]);
  level.renderFromEye(camTag.position, () => {
    assert.ok(room('R02').visible, 'Commons visible');
    assert.ok(room('R14a').visible, 'TAG Reception visible through D_R02_R14a glass');
    assert.ok(room('R14b').visible, 'Open Office visible 2 hops through D_R02_R14a -> D_R14a_R14b glass');
    assert.ok(room('R14d').visible || room('R14c').visible, '3-hop glass office visible down TAG sightline');
  }, camTag);

  // Facing away from TAG Offices on the far west side of Commons culls TAG Offices.
  const camWest = makeCam([18, 1.7, 18], [8, 1.7, 18]);
  level.renderFromEye(camWest.position, () => {
    assert.equal(room('R14a').visible, false, 'TAG Reception culled when behind camera beyond light-bleed distance');
    assert.equal(room('R14b').visible, false, 'Open Office culled when facing away');
  }, camWest);

  // 3. Commons -> Observation Gallery -> Lab B (R02 -> R03 -> R04) when D_R02_R03 opens.
  const camGallery = makeCam([15.2, 1.7, 15.2], [10, 1.7, 22]);
  // Step level.update so auto-door D_R02_R03 slides open while player stands in Commons.
  for (let i = 0; i < 20; i++) level.update(i * 0.05, 0.05, camGallery.position, false, camGallery);
  assert.ok(room('R02').visible, 'player is still in Commons');
  assert.ok(room('R03').visible, 'Observation Gallery visible through open D_R02_R03');
  assert.ok(room('R04').visible, 'Lab B visible 2 hops through open D_R02_R03 and gallery glass before entering R03');

  // 4. Commons -> Hydroponics Vestibule -> Grow Hall -> Seed Lab (R02 -> R12a -> R12b -> R12c) when D_R02_R12a opens.
  const camHydro = makeCam([32.5, 1.7, 20], [52, 1.7, 20]);
  for (let i = 0; i < 20; i++) level.update(1 + i * 0.05, 0.05, camHydro.position, false, camHydro);
  assert.ok(room('R12a').visible, 'Hydroponics Vestibule visible through open D_R02_R12a');
  assert.ok(room('R12b').visible, 'Grow Hall visible 2 hops through D_R12a_R12b glass');
  assert.ok(room('R12c').visible, 'Seed Lab visible 3 hops straight east through Grow Hall glass');
});

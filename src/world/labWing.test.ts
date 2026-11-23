import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { LevelData } from '../data/types/level.ts';
import { AREA_PALETTES } from './kit/palettes.ts';

// lab-wing spec (openspec rebuild-lab-wing): R04 Lab B, R05 Lab Junction, R06 Pressure Door Hall.

const data = JSON.parse(readFileSync(new URL('../data/levels/slice01.json', import.meta.url), 'utf8')) as LevelData;
const room = (id: string) => data.rooms.find((r) => r.id === id)!;
const WING = ['R04', 'R05', 'R06'] as const;
const WORN = new Set(['rustHeavy', 'rustDrip', 'rustBlotch', 'diamondRusty', 'hazard', 'servicePaint', 'labPanel', 'paintBone', 'paintTeal', 'paintDark']);

test('No rust materials: no wall, floor or ceiling piece in the wing uses a worn slot', () => {
  for (const id of WING) {
    const r = room(id);
    assert.equal(r.area, 'labs', `${id} is in the labs area`);
    for (const p of r.pieces) {
      const mat = p.params?.['material'];
      if (typeof mat === 'string') assert.ok(!WORN.has(mat), `${id} ${p.kit} overrides to ${mat}`);
    }
  }
  const pal = AREA_PALETTES['labs']!;
  for (const [k, v] of Object.entries(pal)) assert.ok(typeof v !== 'string' || !WORN.has(v), `labs.${k} = ${v}`);
});

/** World position of a room's ceiling light slot `i`: ceiling pieces provide the slots in piece order, one per cell. */
function ceilingSlotCell(roomId: string, i: number): [number, number] {
  const cells: Array<[number, number]> = [];
  for (const p of room(roomId).pieces) {
    if (!p.kit.startsWith('ceiling')) continue;
    for (const c of p.cells ?? (p.cell ? [p.cell] : [])) cells.push([c[0], c[2]]);
  }
  return cells[i]!;
}
const cellOf = (pos: readonly number[]): [number, number] => [Math.round(pos[0]! / 4), Math.round(pos[2]! / 4)];
const isWhite = (hex = '#ffffff') => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return Math.min(r, g, b) > 200;
};

test('Cover-me under lockdown: a steady white light over the cell of Giles\'s panel; red alarm elsewhere; thin fog', () => {
  const r06 = room('R06');
  const panel = r06.anchors!.find((a) => a.id === 'r06_panel')!;
  const work = (r06.lights ?? []).filter((l) => l.pattern === 'steady' && l.pool !== false && isWhite(l.color));
  assert.equal(work.length, 1, 'one white work light');
  assert.deepEqual(ceilingSlotCell('R06', work[0]!.slot as number), cellOf(panel.pos));
  assert.ok((r06.lights ?? []).some((l) => l.pattern === 'alarm'), 'red alarm light');
  for (const id of WING) assert.ok((room(id).atmosphere?.fogDensity ?? 1) <= 0.03, `${id} fog`);
  const r05 = room('R05');
  assert.equal((r05.lights ?? []).filter((l) => l.pattern === 'steady' && isWhite(l.color)).length, 1, 'R05 has one white work light');
});

// ---------------------------------------------------------------- the bloom (D3) and the sequences (D8)

const seqDir = new URL('../data/sequences/', import.meta.url);
const seq = (file: string): Array<Record<string, unknown>> => {
  const d = JSON.parse(readFileSync(new URL(file, seqDir), 'utf8')) as unknown;
  return (Array.isArray(d) ? d : [d]) as Array<Record<string, unknown>>;
};
/** Every step in order, depth-first, with the step that opened its block (for "after waitFor X" checks). */
function flatten(steps: unknown[], out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  for (const st of steps as Array<Record<string, unknown>>) {
    if (Array.isArray(st['parallel'])) {
      flatten(st['parallel'] as unknown[], out);
      continue;
    }
    out.push(st);
    for (const k of ['steps', 'then', 'else']) if (Array.isArray(st[k])) flatten(st[k] as unknown[], out);
  }
  return out;
}

test('Before the drop: only the drop emits bloom:spread, and only after the burst', () => {
  const emitters: string[] = [];
  for (const f of readdirSync(seqDir).filter((x) => x.endsWith('.json'))) {
    for (const s of seq(f)) if (flatten((s['steps'] as unknown[]) ?? []).some((st) => st['do'] === 'emit' && st['event'] === 'bloom:spread')) emitters.push(String(s['id']));
  }
  assert.deepEqual(emitters.sort(), ['action_restore', 'drop']);
  const drop = flatten(seq('drop.json').find((s) => s['id'] === 'drop')!['steps'] as unknown[]);
  const burst = drop.findIndex((st) => st['do'] === 'waitFor' && st['event'] === 'kill:burst');
  const spread = drop.findIndex((st) => st['do'] === 'emit' && st['event'] === 'bloom:spread');
  assert.ok(burst >= 0 && spread === burst + 1, 'spread right after the burst');
  // Lab B's growth outside the column is hidden until then.
  const hidden = room('R04').props!.filter((p) => /^bloom_/.test(p.kit));
  assert.ok(hidden.length >= 2 && hidden.every((p) => p.params?.['reveal'] === 'spread'), 'every R04 bloom waits for the spread');
});

test('After the drop: loading with drop_done re-emits bloom:spread', () => {
  const restore = seq('action_restore.json').find((s) => s['id'] === 'action_restore')!;
  const ifDrop = (restore['steps'] as Array<Record<string, unknown>>).find((st) => st['do'] === 'if' && st['flag'] === 'drop_done')!;
  assert.ok((ifDrop['then'] as Array<Record<string, unknown>>).some((st) => st['do'] === 'emit' && st['event'] === 'bloom:spread'));
});

/** Waypoints of every coolant_line piece in a room, as segments (world space: the pieces sit at the origin). */
function lineSegments(id: string): Array<[number[], number[]]> {
  const segs: Array<[number[], number[]]> = [];
  for (const p of room(id).props ?? []) {
    if (p.kit !== 'coolant_line') continue;
    const pts = String(p.params?.['path']).split(';').map((t) => t.split(',').map(Number).map((v, k) => v + (p.pos[k] ?? 0)));
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i]!, pts[i + 1]!]);
  }
  return segs;
}
/** Horizontal distance from a point to a segment's plan projection. */
function planDistance(pt: readonly number[], [a, b]: [number[], number[]]): number {
  const [ax, az, bx, bz, px, pz] = [a[0]!, a[2]!, b[0]!, b[2]!, pt[0]!, pt[2]!];
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

test('The bloom follows the line: counts per room, every piece within 1.5 m of the coolant line', () => {
  const counts: Record<string, number> = {};
  for (const id of WING) {
    const segs = lineSegments(id);
    assert.ok(segs.length > 0, `${id} has its part of the line`);
    const blooms = (room(id).props ?? []).filter((p) => /^bloom_/.test(p.kit));
    counts[id] = blooms.length;
    for (const b of blooms) {
      const d = Math.min(...segs.map((s) => planDistance(b.pos, s)));
      assert.ok(d <= 1.5, `${id} ${b.kit} at ${b.pos.join(',')} is ${d.toFixed(2)} m from the line`);
    }
  }
  assert.ok(counts['R04']! >= 2, `R04 ${counts['R04']}`);
  assert.ok(counts['R05']! >= 1 && counts['R05']! <= 3, `R05 ${counts['R05']}`);
  assert.ok(counts['R06']! >= 1 && counts['R06']! <= 2, `R06 ${counts['R06']}`);
  // Giles's panel has one of R06's.
  const panel = room('R06').anchors!.find((a) => a.id === 'r06_panel')!;
  assert.ok((room('R06').props ?? []).some((p) => /^bloom_/.test(p.kit) && Math.hypot(p.pos[0]! - panel.pos[0]!, p.pos[2]! - (panel.pos[2]! + 0.7)) < 1));
});

test('The coolant line is continuous: each room\'s part starts where the previous one ended (at a wall collar)', () => {
  const ends = WING.map((id) => {
    const p = (room(id).props ?? []).find((x) => x.kit === 'coolant_line' && String(x.params?.['collars'] ?? '') !== '')!;
    const pts = String(p.params?.['path']).split(';').map((t) => t.split(',').map(Number));
    return { first: pts[0]!, last: pts[pts.length - 1]! };
  });
  assert.deepEqual(ends[0]!.last.slice(0, 1), [2.0], 'Lab B part ends in the R04/R05 wall');
  assert.deepEqual([ends[1]!.first[0], ends[1]!.first[2]], [ends[0]!.last[0], ends[0]!.last[2]], 'R05 picks it up at the same point');
  assert.deepEqual([ends[2]!.first[0], ends[2]!.first[2]], [ends[1]!.last[0], ends[1]!.last[2]], 'R06 picks it up at the same point');
  const panel = room('R06').anchors!.find((a) => a.id === 'r06_panel')!;
  assert.ok(Math.abs(ends[2]!.last[0]! - panel.pos[0]!) < 0.01, 'it ends at Giles\'s panel');
});

test('Floor spawn has a source: R05\'s floor enemy rises from the drain grate; three sources in all', () => {
  const r05 = room('R05');
  const drain = r05.props!.find((p) => p.kit === 'floor_drain')!;
  const sp = r05.spawns!.find((s) => s.id === 'r05_drain')!;
  assert.equal(sp.kind, 'floor');
  assert.ok(Math.hypot(sp.pos[0]! - drain.pos[0]!, sp.pos[2]! - drain.pos[2]!) < 0.3);
  assert.deepEqual(r05.spawns!.map((s) => s.id).sort(), ['r05_door', 'r05_drain', 'r05_vent']);
});

// ---------------------------------------------------------------- built-level checks (headless slice01)

const { loadSlice01 } = await import('./headlessSlice.ts');
const built = loadSlice01();
interface Box { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; tag?: string; enabled?: boolean }
const colliders = (built.level as unknown as { collision: { colliders: Box[] } }).collision.colliders.filter((c) => c.enabled !== false);
const roomColliders = (id: string) => colliders.filter((c) => c.tag === `room:${id}`);

/** Does the segment a-b pass through the box (slab test)? */
function segmentHits(a: number[], b: number[], c: Box, pad = 0): boolean {
  let t0 = 0;
  let t1 = 1;
  const lo = [c.minX - pad, c.minY - pad, c.minZ - pad];
  const hi = [c.maxX + pad, c.maxY + pad, c.maxZ + pad];
  for (let k = 0; k < 3; k++) {
    const d = b[k]! - a[k]!;
    if (Math.abs(d) < 1e-9) {
      if (a[k]! < lo[k]! || a[k]! > hi[k]!) return false;
      continue;
    }
    let ta = (lo[k]! - a[k]!) / d;
    let tb = (hi[k]! - a[k]!) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

test('Voss stays visible: nothing in Lab B crosses the line from the glass to her chest', () => {
  const victim = room('R04').anchors!.find((a) => a.id === 'labb_victim')!.pos;
  for (const x of [victim[0]! - 0.25, victim[0]!, victim[0]! + 0.25]) {
    const a = [x, 1.3, 22.35];
    const b = [x, 1.3, victim[2]! - 0.25];
    const hit = roomColliders('R04').find((c) => segmentHits(a, b, c));
    assert.ok(!hit, `blocked at x ${x} by ${JSON.stringify(hit)}`);
  }
});

test('R06 lane: a 1.2 m clear lane from the north door to Giles\'s spot', () => {
  const panel = room('R06').anchors!.find((a) => a.id === 'r06_panel')!.pos;
  const path = [[0, 26.4], [0, 36.3], [panel[0]!, panel[2]! - 0.4]];
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i]!;
    const [bx, bz] = path[i + 1]!;
    const steps = Math.ceil(Math.hypot(bx! - ax!, bz! - az!) / 0.25);
    for (let s = 0; s <= steps; s++) {
      const x = ax! + ((bx! - ax!) * s) / steps;
      const z = az! + ((bz! - az!) * s) / steps;
      const hit = roomColliders('R06').find((c) => c.maxY > 0.05 && c.minY < 1.8 && c.minX < x + 0.6 && c.maxX > x - 0.6 && c.minZ < z + 0.6 && c.maxZ > z - 0.6);
      assert.ok(!hit, `lane blocked at (${x.toFixed(2)}, ${z.toFixed(2)}) by ${JSON.stringify(hit)}`);
    }
  }
});

test('door unlock device resolver: resolves R06 power_box and R07 jamb status screens within natural arm reach', () => {
  const r06Anchor = built.level.anchor('r06_panel')!;
  const r06Dev = built.level.panelDevice('D_R06_R07', r06Anchor.pos)!;
  assert.ok(r06Dev, 'R06 power_box device resolved');
  assert.ok(Math.abs(r06Dev.pos.x - -2.6) < 0.02 && Math.abs(r06Dev.pos.y - 1.32) < 0.05 && Math.abs(r06Dev.pos.z - 37.3) < 0.05);
  assert.ok(r06Dev.normal.z < -0.99, `R06 normal points into R06 (${JSON.stringify(r06Dev.normal)})`);
  const d06 = Math.hypot(r06Dev.pos.x - r06Anchor.pos.x, r06Dev.pos.z - r06Anchor.pos.z);
  assert.ok(d06 >= 0.42 && d06 <= 0.58, `r06_panel reach ${d06.toFixed(2)} m`);

  for (const [anchorId, doorId, expectZ] of [['r07_armory_panel', 'D_R07_R07a', 41.16], ['okafor_biometric', 'D_R07_R09', 45.16]] as const) {
    const a = built.level.anchor(anchorId)!;
    const dev = built.level.panelDevice(doorId, a.pos)!;
    assert.ok(dev, `${doorId} jamb device resolved`);
    assert.ok(Math.abs(dev.pos.x - 5.684) < 0.02 && Math.abs(dev.pos.y - 1.5) < 0.02 && Math.abs(dev.pos.z - expectZ) < 0.02);
    assert.ok(dev.normal.x < -0.99, `${doorId} normal points into R07 (${JSON.stringify(dev.normal)})`);
    const d = Math.hypot(dev.pos.x - a.pos.x, dev.pos.z - a.pos.z);
    assert.ok(d >= 0.45 && d <= 0.58, `${anchorId} reach ${d.toFixed(2)} m`);
  }
});

test('Every source in view but one: from the hold point facing south, duct, trench and vent are in view and unblocked', () => {
  const r06 = room('R06');
  const hold = r06.anchors!.find((a) => a.id === 'r06_hold')!;
  const eye = [hold.pos[0]!, 1.62, hold.pos[2]!];
  const facing = ((hold.yaw ?? 0) * Math.PI) / 180; // 0 faces -Z, 180 faces +Z
  const fwd = [-Math.sin(facing), -Math.cos(facing)];
  const angleTo = (p: readonly number[]) => {
    const dx = p[0]! - eye[0]!;
    const dz = p[2]! - eye[2]!;
    return (Math.acos((dx * fwd[0]! + dz * fwd[1]!) / Math.hypot(dx, dz)) * 180) / Math.PI;
  };
  for (const id of ['r06_duct', 'r06_trench', 'r06_vent_e']) {
    const sp = r06.spawns!.find((s) => s.id === id)!;
    assert.ok(angleTo(sp.pos) <= 75, `${id} is ${angleTo(sp.pos).toFixed(0)} deg off the facing`);
    const target = [sp.pos[0]!, Math.max(1.2, sp.pos[1]!), sp.pos[2]!];
    const blocker = roomColliders('R06').find((c) => segmentHits(eye, target, c) && !(target[0]! >= c.minX && target[0]! <= c.maxX && target[2]! >= c.minZ && target[2]! <= c.maxZ));
    assert.ok(!blocker, `${id} hidden by ${JSON.stringify(blocker)}`);
  }
  const corridor = r06.spawns!.find((s) => s.id === 'r06_corridor')!;
  assert.ok(angleTo(corridor.pos) > 120, 'the corridor source comes from behind');
  assert.equal(r06.spawns!.reduce((n, s) => n + ((s as { count?: number }).count ?? 1), 0), 6, 'six enemies');
});

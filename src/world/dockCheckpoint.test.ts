import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { P3 } from '../ai/nav.ts';
import { loadSlice01 } from './headlessSlice.ts';

// dock-checkpoint spec: the booth, the counter and the detector line split R01 into a dock side and a
// station side, and the arch is the only way through. Uses the navmesh, like the game (ADR-0028).

const { level } = loadSlice01();
const nav = level.navGraph();

/** The detector line (x), and the arch opening along it (z), as laid out in scripts/gen-slice01.mjs. */
const LINE_X = 7.675;
const ARCH_Z: [number, number] = [0.57, 1.77];
const WINDOW_Z = -1.875;
const COUNTER_Z = 1.8;
const LEG_X = 4.5;
const SOUTH_Z = 5.875;

/** Solid at waist height (where a body would pass), ignoring door leaves. */
function solidAt(x: number, z: number, y = 0.5): boolean {
  return level.collision.find(x - 0.005, z - 0.005, x + 0.005, z + 0.005).some((c) => c.enabled && c.minY <= y && c.maxY >= y && !String(c.tag).startsWith('door'));
}

/** Free (walkable) runs along a straight boundary segment, in metres. */
function freeRuns(a: [number, number], b: [number, number], step = 0.01): Array<{ from: [number, number]; len: number }> {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const runs: Array<{ from: [number, number]; len: number }> = [];
  let open: { from: [number, number]; len: number } | null = null;
  for (let s = 0; s <= len; s += step) {
    const p: [number, number] = [a[0] + ((b[0] - a[0]) * s) / len, a[1] + ((b[1] - a[1]) * s) / len];
    if (!solidAt(p[0], p[1])) {
      open ??= { from: p, len: 0 };
      open.len += step;
    } else if (open) {
      runs.push(open);
      open = null;
    }
  }
  if (open) runs.push(open);
  return runs;
}

/** Where a path crosses x = LINE_X (z of each crossing). */
function crossings(path: P3[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if ((a.x - LINE_X) * (b.x - LINE_X) > 0 || a.x === b.x) continue;
    const t = (LINE_X - a.x) / (b.x - a.x);
    out.push(a.z + (b.z - a.z) * t);
  }
  return out;
}

const DOCK_SIDE: P3 = { x: 0.5, y: 0, z: -1.0 };
const CORRIDOR: P3 = { x: 17, y: 0, z: 0 };

test('the route from the airlock to the corridor passes through the arch', () => {
  const path = nav.findPath(DOCK_SIDE, CORRIDOR);
  assert.ok(path, 'a route exists');
  const zs = crossings(path!);
  assert.equal(zs.length, 1, `crosses the line once (${zs.map((z) => z.toFixed(2)).join(', ')})`);
  assert.ok(zs[0]! > ARCH_Z[0] && zs[0]! < ARCH_Z[1], `crosses at z ${zs[0]!.toFixed(2)}, inside the arch`);
});

test('no walkable gap of 0.8 m or more along the counter and detector line, except the arch', () => {
  const segments: Array<[[number, number], [number, number]]> = [
    [[LINE_X, WINDOW_Z - 0.05], [LINE_X, COUNTER_Z]],
    [[LINE_X, COUNTER_Z], [LEG_X, COUNTER_Z]],
    [[LEG_X, COUNTER_Z], [LEG_X, SOUTH_Z + 0.05]],
  ];
  const gaps = segments.flatMap(([a, b]) => freeRuns(a, b));
  const arch = gaps.filter((g) => g.from[0] === LINE_X && g.from[1] >= ARCH_Z[0] - 0.02 && g.from[1] <= ARCH_Z[0] + 0.02);
  assert.equal(arch.length, 1, 'the arch opening is free');
  assert.ok(arch[0]!.len >= 1.0, `arch opening ${arch[0]!.len.toFixed(2)} m`);
  for (const g of gaps) {
    if (g === arch[0]) continue;
    assert.ok(g.len < 0.8, `gap of ${g.len.toFixed(2)} m at ${g.from.map((v) => v.toFixed(2)).join(',')}`);
  }
});

test('Jay leaves the booth by its open east side without crossing the line', () => {
  const post = level.anchor('post_front')!.pos;
  const path = nav.findPath({ x: post.x, y: 0, z: post.z }, CORRIDOR);
  assert.ok(path, 'a route exists');
  for (const z of crossings(path!)) assert.ok(z > COUNTER_Z + 0.1, `crosses x ${LINE_X} at z ${z.toFixed(2)}, south of the counter (open side)`);
});

test('leaning on the desk, Jay sees the dock door, the counter and the arch with the guard all at once without turning', () => {
  const post = level.anchor('post_front')!;
  const yaw = post.yaw; // radians
  // Back against the desk: the desk is right behind him, the counter ahead.
  assert.ok(solidAt(post.pos.x, post.pos.z + 0.6), 'the desk is at his back');
  assert.ok(solidAt(post.pos.x, COUNTER_Z), 'the counter is ahead');
  // Everything he watches sits within 50 deg of where he faces (a 75 deg vertical FOV is ~113 deg across at 16:9).
  // Everyone going through security; the squad's waits past it are off to the right, where speaker shots turn to them.
  for (const name of ['dock_door', 'walkby_queue', 'walkby_stop', 'arch', 'arch_scan', 'guard_post']) {
    const a = level.anchor(name)!.pos;
    const ang = Math.atan2(-(a.x - post.pos.x), -(a.z - post.pos.z));
    let d = ang - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    assert.ok(Math.abs(d) < (50 * Math.PI) / 180, `${name} is ${((d * 180) / Math.PI).toFixed(0)} deg off his facing`);
  }
});

test('the detector line stays under 1.2 m except the arch', () => {
  for (let z = WINDOW_Z + 0.08; z < ARCH_Z[0] - 0.2; z += 0.05) {
    for (const c of level.collision.find(LINE_X - 0.01, z - 0.01, LINE_X + 0.01, z + 0.01)) {
      if (!c.enabled || c.maxX - c.minX > 2 || c.maxZ - c.minZ > 2) continue; // walls
      assert.ok(c.maxY <= 1.2, `collider ${c.maxY.toFixed(2)} m tall at z ${z.toFixed(2)}`);
    }
  }
});

test('the rails and gate never block the view from the post, and the berth stays in view', () => {
  const post = level.anchor('post_front')!.pos;
  const eye = { x: post.x, y: 1.62, z: post.z };
  const ray = (t: { x: number; y: number; z: number }) => {
    const dx = t.x - eye.x;
    const dy = t.y - eye.y;
    const dz = t.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    return { hit: level.collision.raycast(eye.x, eye.y, eye.z, dx / d, dy / d, dz / d, d), dz: dz / d };
  };
  for (const name of ['sub_dock', 'dock_window']) {
    const { hit, dz } = ray(level.anchor(name)!.pos);
    if (hit) assert.ok(eye.z + dz * hit.distance < WINDOW_Z + 0.2, `view to ${name} blocked`);
  }
  // Sweep the whole window at eye height: anything the checkpoint puts in the way is the arch, never a rail or the gate.
  for (let x = 2; x <= 13.5; x += 0.25) {
    const { hit } = ray({ x, y: 1.5, z: WINDOW_Z });
    if (hit && hit.collider.maxZ > WINDOW_Z + 0.2) assert.ok(hit.collider.maxY > 2, `low prop blocks the window at x ${x}`);
  }
});

// ---- nobody walks into anybody at the checkpoint: every arrival move keeps clear of whoever stands still meanwhile

import { planWalk } from '../ai/walkPath.ts';
const P = (name: string): P3 => {
  const a = level.anchor(name)!;
  return { x: a.pos.x, y: 0, z: a.pos.z };
};
/** Two 0.35 m bodies plus a hand's width. */
const CLEAR = 0.35 * 2 + 0.15;

/** Closest the planned route (as the game walks it) comes to `spot`. */
function closest(from: string, to: string, spot: P3, via?: string): number {
  const curve = via ? level.walk(via)!.points.map((p) => ({ ...p, y: 0 })) : undefined;
  const plan = planWalk(P(from), P(to), { nav, world: level.collision, radius: 0.35 }, curve);
  let best = Infinity;
  for (let i = 1; i < plan.points.length; i++) {
    const a = plan.points[i - 1]!;
    const b = plan.points[i]!;
    for (let t = 0; t <= 1; t += 0.02) best = Math.min(best, Math.hypot(a.x + (b.x - a.x) * t - spot.x, a.z + (b.z - a.z) * t - spot.z));
  }
  return best;
}

test('checkpoint moves keep a body width clear of the guard and the squadmate already waiting', () => {
  // [who moves, from, to, via, who stands still meanwhile] in intro order.
  const moves: Array<[string, string, string, string | undefined, string[]]> = [
    ['crew', 'walkby_stop', 'arch_scan', undefined, ['guard_post']],
    ['crew', 'arch_scan', 'arch_exit', 'checkpoint_exit', ['guard_post']],
    ['okafor', 'walkby_stop', 'arch_scan', undefined, ['guard_post']],
    ['okafor', 'arch_scan', 'post_okafor', undefined, ['guard_post']],
    ['giles', 'walkby_stop', 'arch_scan', undefined, ['guard_post', 'post_okafor']],
    ['giles', 'arch_scan', 'post_giles', undefined, ['guard_post', 'post_okafor']],
    ['okafor', 'post_okafor', 'counter_okafor', 'intro_okafor_counter', ['guard_post']],
    ['giles', 'post_giles', 'counter_giles', 'intro_giles_counter', ['guard_post']],
    ['jay', 'post_front', 'kitchen_stand', 'intro_jay_kitchen', ['guard_post']],
  ];
  const bad: string[] = [];
  const gap = (a: string, b: string): number => Math.hypot(P(a).x - P(b).x, P(a).z - P(b).z);
  // Someone at arch_scan is scanned face to face, a body width from the guard; the two waits are apart.
  if (gap('arch_scan', 'guard_post') < CLEAR) bad.push(`arch_scan is ${gap('arch_scan', 'guard_post').toFixed(2)} m from the guard`);
  if (gap('post_okafor', 'post_giles') < CLEAR + 0.3) bad.push(`the waits are ${gap('post_okafor', 'post_giles').toFixed(2)} m apart`);
  for (const [who, from, to, via, standing] of moves) {
    for (const s of standing) {
      const d = closest(from, to, P(s), via);
      if (d < CLEAR) bad.push(`${who} ${from} -> ${to} passes ${d.toFixed(2)} m from ${s}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('guard return staging: route clears counter, Jay and waiting squad; chair and seat align facing the keyboard', () => {
  // All four staging anchors and the authored return walk exist in R01.
  for (const name of ['guard_desk_approach', 'guard_wand_spot', 'guard_chair_grip', 'guard_seat']) {
    assert.ok(level.anchor(name), `R01 anchor ${name}`);
  }
  const route = level.walk('guard_return_desk');
  assert.ok(route, 'guard_return_desk walk exists');

  // The return route clears the counter corner, Jay's booth spot and the waiting squad spots.
  const pts = planWalk(P('guard_post'), P('guard_desk_approach'), { nav, world: level.collision, radius: 0.3 }, route.points.map((p) => ({ ...p, y: 0 }))).points;
  const distTo = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      for (let t = 0; t <= 1; t += 0.02) best = Math.min(best, Math.hypot(a.x + (b.x - a.x) * t - x, a.z + (b.z - a.z) * t - z));
    }
    return best;
  };
  // Every point along the route stays clear of the front counter collider (x <= 7.4, z <= 1.93), Jay's booth exit and the waiting squad.
  assert.ok(distTo(7.4, 1.93) >= 0.42, `route clears front counter east corner (${distTo(7.4, 1.93).toFixed(2)} m)`);
  assert.ok(distTo(P('post_okafor').x, P('post_okafor').z) >= 0.72, `route clears post_okafor (${distTo(P('post_okafor').x, P('post_okafor').z).toFixed(2)} m)`);
  assert.ok(distTo(P('post_giles').x, P('post_giles').z) >= CLEAR, `route clears post_giles (${distTo(P('post_giles').x, P('post_giles').z).toFixed(2)} m)`);
  // Along the approach before reaching the desk, keep clear of Jay's exit lane.
  assert.ok(distTo(7.85, 3.5) >= 0.85, `route clears Jay's booth exit waypoint (${distTo(7.85, 3.5).toFixed(2)} m)`);

  // Final seat faces the left keyboard (x = 6.45, z = 4.98) and the CCTV wall (+Z, yaw = PI).
  const seat = level.anchor('guard_seat')!;
  assert.ok(Math.abs(seat.pos.x - 6.45) < 0.05, 'aligned with left keyboard X');
  assert.ok(Math.abs(seat.pos.z - 4.38) < 0.05, 'workstation chair distance from desk');
  const fwdZ = -Math.cos(seat.yaw);
  assert.ok(fwdZ > 0.99, `final seat faces +Z toward keyboard and CCTV wall (fwdZ=${fwdZ.toFixed(3)})`);

  // Controllable chair and desk wand exist, keep mesh and collider aligned when moved, and reset cleanly.
  const chair0 = level.propState('dock_chair');
  assert.ok(chair0 && chair0.colliders.length === 1, 'dock_chair registered with collider');
  assert.ok(Math.hypot(chair0.pos.x - 5.45, chair0.pos.z - 4.55) < 0.02);
  const wand0 = level.propState('dock_wand');
  assert.ok(wand0 && wand0.visible === false, 'dock_wand starts hidden on desk');

  assert.equal(level.setPropTransform('dock_chair', seat.pos, seat.yaw), true);
  const chair1 = level.propState('dock_chair')!;
  const col = chair1.colliders[0]!;
  assert.ok(Math.hypot(chair1.pos.x - seat.pos.x, chair1.pos.z - seat.pos.z) < 1e-4);
  assert.ok(Math.abs((col.minX + col.maxX) / 2 - seat.pos.x) < 0.01 && Math.abs((col.minZ + col.maxZ) / 2 - seat.pos.z) < 0.01, 'chair collider tracks moved mesh');
  assert.ok(level.collision.find(seat.pos.x - 0.1, seat.pos.z - 0.1, seat.pos.x + 0.1, seat.pos.z + 0.1).includes(col), 'spatial hash finds moved chair collider');
  assert.ok(!level.collision.find(5.45 - 0.1, 4.55 - 0.1, 5.45 + 0.1, 4.55 + 0.1).includes(col), 'old chair position is cleared in spatial hash');
  // Restore chair to start so later tests see initial level state.
  level.setPropTransform('dock_chair', chair0.pos, chair0.yaw);
});

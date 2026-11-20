import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import type { P3 } from '../ai/nav.ts';
import { NavMeshNav } from '../ai/navmesh.ts';
import { PathFollower, planWalk } from '../ai/walkPath.ts';
import { loadSequenceFiles, loadSlice01 } from './headlessSlice.ts';

// ADR-0028: every scripted walk in every slice01 sequence (npcMoveTo / playerWalkTo to an anchor,
// from the same actor's previous anchor in that file) has a route, and a body walking it with the
// game's follower reaches the spot without getting stuck or grinding along a wall. Doors count as
// open: scripts open them before anyone walks through.

const { level, doors } = loadSlice01();
const nav = level.navGraph();
const sequences = loadSequenceFiles();

interface Move {
  file: string;
  who: string;
  from: P3;
  to: P3;
  toName: string;
  curve: P3[] | undefined;
}

function moves(): Move[] {
  const out: Move[] = [];
  const anchor = (ref: unknown): { p: P3; name: string } | null => {
    if (typeof ref !== 'string' || !ref.startsWith('anchor:')) return null;
    const a = level.anchor(ref.slice(7));
    return a ? { p: { x: a.pos.x, y: a.pos.y < 0.5 ? a.pos.y : 0, z: a.pos.z }, name: ref.slice(7) } : null;
  };
  for (const [file, seq] of sequences) {
    if (file.startsWith('test_') || file === 'cutscene_test') continue;
    const last = new Map<string, P3>();
    const visit = (o: unknown): void => {
      if (Array.isArray(o)) return o.forEach(visit);
      if (!o || typeof o !== 'object') return;
      const s = o as Record<string, unknown>;
      if (s['do'] === 'npcMoveTo' || s['do'] === 'playerWalkTo') {
        const who = s['do'] === 'playerWalkTo' ? 'jay' : String(s['npc']);
        const to = anchor(s['to']);
        if (to) {
          const from = last.get(who);
          const via = typeof s['via'] === 'string' ? level.walk(s['via']) : null;
          if (from && Math.hypot(from.x - to.p.x, from.z - to.p.z) > 0.5) out.push({ file, who, from, to: to.p, toName: to.name, curve: via?.points.map((p) => ({ ...p, y: p.y < 0.5 ? p.y : 0 })) });
          last.set(who, to.p);
        }
      } else if ((s['do'] === 'playerPlace' || s['do'] === 'npcPlace' || s['do'] === 'spawn') && anchor(s['at'] ?? s['to'])) {
        last.set(s['do'] === 'playerPlace' ? 'jay' : String(s['npc']), anchor(s['at'] ?? s['to'])!.p);
      }
      for (const v of Object.values(s)) if (v && typeof v === 'object') visit(v);
    };
    visit(seq);
  }
  return out;
}

test('slice01 scripted walks: routed, walkable, no wall grinding', () => {
  const all = moves();
  assert.ok(all.length >= 15, `found ${all.length} scripted walks`);
  const saved = doors.map((d) => d.collider.enabled);
  for (const d of doors) d.collider.enabled = false;
  const navDoors = nav.doors.map((d) => d.isOpen);
  nav.doors.forEach((d) => (d.isOpen = () => true));
  const failures: string[] = [];
  const offFloor = new Set<string>();
  try {
    for (const m of all) {
      const label = `${m.file}: ${m.who} -> ${m.toName}`;
      const plan = planWalk(m.from, m.to, { nav, world: level.collision, radius: DEFAULT_MOTOR.radius }, m.curve);
      if (!plan.routed) {
        failures.push(`${label}: no route`);
        continue;
      }
      const f = new PathFollower(plan.points, { speed: 1.3 });
      // How far the spot is from the walkable floor (0 when it's on it).
      const onMesh = nav instanceof NavMeshNav ? nav.closest(m.to, 2) : m.to;
      const goalOff = onMesh ? Math.hypot(onMesh.x - m.to.x, onMesh.z - m.to.z) : Infinity;
      const body: MotorState = { x: m.from.x, y: m.from.y, z: m.from.z, vy: 0, grounded: true };
      let scrape = 0;
      let best = Infinity;
      let stall = 0;
      let done = false;
      let left = Infinity;
      for (let i = 0; i < 30 * 120 && !done; i++) {
        const st = f.update(body.x, body.z, 1 / 30);
        done = st.done;
        left = st.remaining;
        const dx = st.tx - body.x;
        const dz = st.tz - body.z;
        const d = Math.hypot(dx, dz) || 1;
        const v = Math.max(st.speed, 0.2) / 30;
        const bx = body.x;
        const bz = body.z;
        moveBody(body, (dx / d) * v, (dz / d) * v, 1 / 30, DEFAULT_MOTOR, level.collision);
        // Squeezing into a nook in the last metre is the point of such a spot; anywhere else it's a bad route.
        const squeezing = left < 1 && goalOff > 0.45;
        if (Math.hypot(body.x - bx, body.z - bz) < v * 0.8 && !squeezing) scrape++;
        if (st.remaining < best - 0.05) {
          best = st.remaining;
          stall = 0;
        } else if (++stall > 60) break;
        // Like the game: stalled 0.6 s at the very end of the route counts as arrived.
        else if (left < 1 && stall > 18 && Math.hypot(body.x - m.to.x, body.z - m.to.z) < 1.6) break;
      }
      const off = Math.hypot(body.x - m.to.x, body.z - m.to.z);
      // A spot in a nook or by furniture counts as reached once the body is as close as it gets.
      if (goalOff > 0.45) offFloor.add(`${m.toName} (${goalOff.toFixed(2)} m)`);
      if (!done && !(left < 1 && off < 1.6)) failures.push(`${label}: stuck at ${body.x.toFixed(2)},${body.z.toFixed(2)}`);
      else if (scrape > 4) failures.push(`${label}: ground along a wall for ${scrape} frames`);
    }
  } finally {
    doors.forEach((d, i) => (d.collider.enabled = saved[i]!));
    nav.doors.forEach((d, i) => (d.isOpen = navDoors[i]!));
  }
  // Anchors a body can't stand on (inside furniture or a nook): walkers stop as close as they can.
  if (offFloor.size) console.log(`# slice01 anchors off the walkable floor: ${[...offFloor].join(', ')}`);
  assert.deepEqual(failures, [], `${failures.length} of ${all.length} scripted walks fail`);
});

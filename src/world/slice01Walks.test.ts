import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTOR, moveBody, type MotorState } from '../actors/motor.ts';
import { blockedLegs, catmullRom, PathFollower, planWalk } from '../ai/walkPath.ts';
import { loadSequenceFiles, loadSlice01 } from './headlessSlice.ts';

// ADR-0028: authored curve walks stay clear of walls at body radius, sequences only name walks
// that exist, and a body actually walks each one end to end through the real colliders.

const { level, doors } = loadSlice01();
const sequences = loadSequenceFiles();

/** Every step object in a sequence file, depth first. */
function steps(o: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(o)) for (const x of o) steps(x, out);
  else if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    if (typeof r['do'] === 'string') out.push(r);
    for (const v of Object.values(r)) steps(v, out);
  }
  return out;
}

test('slice01 walks: every authored curve clears the walls at body radius (doors open)', () => {
  const ids = level.walkIds();
  assert.ok(ids.length >= 5, 'the intro walks are authored');
  const saved = doors.map((d) => d.collider.enabled);
  for (const d of doors) d.collider.enabled = false;
  try {
    for (const id of ids) {
      const w = level.walk(id);
      assert.ok(w, id);
      const curve = catmullRom(w.points.map((p) => ({ ...p, y: p.y < 0.5 ? p.y : 0 })));
      const bad = blockedLegs(level.collision, curve, DEFAULT_MOTOR.radius);
      assert.deepEqual(bad.map((i) => `${curve[i]!.x.toFixed(2)},${curve[i]!.z.toFixed(2)}`), [], `${id}: curve clips a wall (fix with npm run walks:suggest)`);
    }
  } finally {
    doors.forEach((d, i) => (d.collider.enabled = saved[i]!));
  }
});

test('slice01 walks: sequences only use walks that exist', () => {
  const known = new Set(level.walkIds());
  let used = 0;
  for (const [file, seq] of sequences) {
    for (const s of steps(seq)) {
      if (typeof s['via'] === 'string') {
        used++;
        assert.ok(known.has(s['via']), `${file}: ${String(s['do'])} via unknown walk "${s['via']}"`);
      }
    }
  }
  assert.ok(used >= 5, 'the intro uses its walks');
});

test('slice01 walks: a body follows every authored walk to its end without scraping a wall', () => {
  const saved = doors.map((d) => d.collider.enabled);
  for (const d of doors) d.collider.enabled = false;
  try {
    for (const id of level.walkIds()) {
      const w = level.walk(id)!;
      const ctrl = w.points.map((p) => ({ ...p, y: p.y < 0.5 ? p.y : 0 }));
      const start = ctrl[0]!;
      const end = ctrl[ctrl.length - 1]!;
      const plan = planWalk(start, end, { nav: null, world: level.collision }, ctrl);
      const f = new PathFollower(plan.points, { speed: 1.3 });
      const body: MotorState = { x: start.x, y: 0, z: start.z, vy: 0, grounded: true };
      let scrape = 0;
      let frames = 0;
      let done = false;
      for (; frames < 30 * 120 && !done; frames++) {
        const st = f.update(body.x, body.z, 1 / 30);
        done = st.done;
        const dx = st.tx - body.x;
        const dz = st.tz - body.z;
        const d = Math.hypot(dx, dz) || 1;
        const v = Math.max(st.speed, 0.2) / 30;
        const bx = body.x;
        const bz = body.z;
        moveBody(body, (dx / d) * v, (dz / d) * v, 1 / 30, DEFAULT_MOTOR, level.collision);
        if (Math.hypot(body.x - bx, body.z - bz) < v * 0.8) scrape++;
      }
      assert.ok(done, `${id}: reached the end (stopped at ${body.x.toFixed(2)},${body.z.toFixed(2)})`);
      assert.ok(scrape <= 2, `${id}: scraped a wall on ${scrape} frames`);
    }
  } finally {
    doors.forEach((d, i) => (d.collider.enabled = saved[i]!));
  }
});

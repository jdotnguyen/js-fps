/** The camera flinch and aim punch of a hit (player-hit-feedback D2). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HitInfo, HitKind, HitSide } from './hit.ts';
import { HitFlinch } from './hitFlinch.ts';

const DEG = Math.PI / 180;
const DT = 1 / 60;

const hit = (kind: HitKind, severity: number, side: HitSide | null = null): HitInfo => ({ kind, severity, side, dir: { x: 0, y: 0 } });

interface Trace {
  peak: { pitch: number; yaw: number; roll: number; push: number; dip: number; aimYaw: number; aimPitch: number };
  /** Signed values at their furthest. */
  far: { pitch: number; yaw: number; roll: number; push: number; aimYaw: number };
  aim: { yaw: number; pitch: number };
  flinch: HitFlinch;
}

/** Step one hit for `seconds`, moving an aim the way the player does. */
function play(info: HitInfo, opts: { seconds?: number; reduced?: boolean; dt?: number } = {}): Trace {
  const flinch = new HitFlinch();
  const dt = opts.dt ?? DT;
  const out: Trace = {
    peak: { pitch: 0, yaw: 0, roll: 0, push: 0, dip: 0, aimYaw: 0, aimPitch: 0 },
    far: { pitch: 0, yaw: 0, roll: 0, push: 0, aimYaw: 0 },
    aim: { yaw: 0, pitch: 0 },
    flinch,
  };
  flinch.hit(info, opts.reduced ?? false);
  for (let t = 0; t < (opts.seconds ?? 0.4) - 1e-9; t += dt) {
    flinch.update(dt);
    const s = flinch.aimStep();
    out.aim.yaw += s.yaw;
    out.aim.pitch += s.pitch;
    flinch.aimMoved(s.yaw, s.pitch);
    const v = flinch.view;
    for (const k of ['pitch', 'yaw', 'roll', 'push', 'dip'] as const) out.peak[k] = Math.max(out.peak[k], Math.abs(v[k]));
    for (const k of ['pitch', 'yaw', 'roll', 'push'] as const) if (Math.abs(v[k]) > Math.abs(out.far[k])) out.far[k] = v[k];
    if (Math.abs(out.aim.yaw) > Math.abs(out.far.aimYaw)) out.far.aimYaw = out.aim.yaw;
    out.peak.aimYaw = Math.max(out.peak.aimYaw, Math.abs(out.aim.yaw));
    out.peak.aimPitch = Math.max(out.peak.aimPitch, Math.abs(out.aim.pitch));
  }
  return out;
}

test('a swipe from the left rolls and turns the view and the aim to the right', () => {
  const { far } = play(hit('swipe', 1, 'L'));
  // Yaw falls as the view turns right; roll is negative as the head tips right.
  assert.ok(far.yaw < -2 * DEG, `yaw ${far.yaw / DEG}`);
  assert.ok(far.roll < -3 * DEG, `roll ${far.roll / DEG}`);
  assert.ok(far.aimYaw < -0.5 * DEG, `aim ${far.aimYaw / DEG}`);
  const other = play(hit('swipe', 1, 'R')).far;
  assert.ok(other.yaw > 2 * DEG && other.roll > 3 * DEG && other.aimYaw > 0.5 * DEG);
});

test('each kind moves its own way', () => {
  const bite = play(hit('bite', 1));
  assert.ok(bite.far.pitch < -3 * DEG, 'down');
  assert.ok(bite.far.push > 0.04, 'forward');
  assert.equal(bite.peak.roll, 0);
  const slam = play(hit('slam', 1));
  assert.ok(slam.peak.dip > 0.08 && slam.far.pitch < -2 * DEG);
  assert.ok(slam.peak.roll > 0.2 * DEG, 'it shakes');
  const grab = play(hit('grab', 0.1));
  assert.ok(grab.peak.pitch > 0.1 * DEG && grab.peak.pitch < 1 * DEG, 'a small tremor');
  assert.equal(grab.peak.aimYaw + grab.peak.aimPitch, 0, 'which leaves the aim alone');
  assert.ok(play(hit('generic', 1)).far.pitch > 1 * DEG, 'a small pitch up');
});

test('a 25-point hit moves the view further than an 8-point hit', () => {
  const big = play(hit('swipe', 1, 'L')).peak;
  const small = play(hit('swipe', 8 / 25, 'L')).peak;
  for (const k of ['pitch', 'yaw', 'roll', 'aimYaw'] as const) assert.ok(big[k] > small[k] * 1.4, k);
});

test('the view settles within 0.4 s and the aim comes back, at 30 or 144 frames a second', () => {
  for (const dt of [1 / 30, 1 / 144]) {
    for (const kind of ['swipe', 'bite', 'slam', 'grab', 'generic'] as const) {
      const t = play(hit(kind, 1, 'L'), { seconds: 0.4, dt });
      const v = t.flinch.view;
      for (const k of ['pitch', 'yaw', 'roll'] as const) assert.ok(Math.abs(v[k]) < 0.25 * DEG, `${kind} ${k} ${v[k] / DEG}`);
      assert.ok(Math.abs(v.push) < 0.005 && Math.abs(v.dip) < 0.008, kind);
      assert.ok(Math.hypot(t.aim.yaw, t.aim.pitch) < 0.3 * DEG, `${kind} aim ${Math.hypot(t.aim.yaw, t.aim.pitch) / DEG}`);
    }
  }
  const settled = play(hit('swipe', 1, 'R'), { seconds: 2 });
  assert.ok(Math.abs(settled.aim.yaw) < 1e-9 && Math.abs(settled.aim.pitch) < 1e-9, 'nothing is left over');
});

test('aim that was held back is not taken off again', () => {
  const f = new HitFlinch();
  f.hit(hit('generic', 1), false); // up, against a pitch limit that takes none of it
  let moved = 0;
  for (let i = 0; i < 120; i++) {
    f.update(DT);
    const step = f.aimStep();
    const applied = Math.min(0, step.pitch);
    moved += applied;
    f.aimMoved(0, applied);
  }
  assert.ok(Math.abs(moved) < 1e-9, `pushed down by ${moved / DEG} deg`);
});

test('reduced motion moves the view and the aim at most a third as far', () => {
  for (const kind of ['swipe', 'bite', 'slam', 'grab'] as const) {
    const full = play(hit(kind, 1, 'L')).peak;
    const less = play(hit(kind, 1, 'L'), { reduced: true }).peak;
    for (const k of Object.keys(full) as Array<keyof typeof full>) assert.ok(less[k] <= full[k] / 3 + 1e-6, `${kind} ${k}`);
  }
});

test('no time passes, nothing moves; reset clears it', () => {
  const { flinch } = play(hit('swipe', 1, 'L'), { seconds: 0.05 });
  const held = { ...flinch.view };
  flinch.update(0);
  assert.deepEqual({ ...flinch.view }, held);
  flinch.reset();
  assert.deepEqual({ ...flinch.view }, { pitch: 0, yaw: 0, roll: 0, push: 0, dip: 0 });
  assert.deepEqual(flinch.aimStep(), { yaw: 0, pitch: 0 });
});

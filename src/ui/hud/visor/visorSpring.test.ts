// visor-hud: the panels lag behind the view and jolt on a hit, the same at any frame rate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OFFSET, VisorSpring, type MotionInput, type Strike } from './visorSpring.ts';

const STEP = 1 / 60;

const input = (over: Partial<MotionInput> = {}): MotionInput => ({ yaw: 0, pitch: 0, bob: 0, scale: 1, reduced: false, ...over });

/** Step at `rate` a second for `seconds`, with the camera where `view` puts it at each moment. */
function run(s: VisorSpring, rate: number, seconds: number, view: (t: number) => Partial<MotionInput> = () => ({}), from = 0): void {
  for (let i = 1; i <= Math.round(seconds * rate); i++) s.step(input(view(from + i / rate)), 1 / rate);
}

function resting(): VisorSpring {
  const s = new VisorSpring();
  s.step(input(), STEP);
  return s;
}

/** The furthest each panel gets from rest in the half second after a hit. */
function reach(strike: Strike): { bio: number; ammo: number; bioX: number } {
  const s = resting();
  s.hit(strike);
  const far = { bio: 0, ammo: 0, bioX: 0 };
  for (let i = 0; i < 30; i++) {
    s.step(input(), STEP);
    far.bio = Math.max(far.bio, Math.hypot(s.bio.x, s.bio.y));
    far.ammo = Math.max(far.ammo, Math.hypot(s.ammo.x, s.ammo.y));
    if (Math.abs(s.bio.x) > Math.abs(far.bioX)) far.bioX = s.bio.x;
  }
  return far;
}

test('a flick to the right leaves the panels behind on the left, and they settle once it stops', () => {
  const s = resting();
  // Turning right lowers the yaw.
  run(s, 60, 0.1, (t) => ({ yaw: -3 * t }));
  assert.ok(s.bio.x < -2 && s.ammo.x < -2, `${s.bio.x}`);
  run(s, 60, 0.5, () => ({ yaw: -0.3 }));
  assert.ok(Math.abs(s.bio.x) < 0.05, `${s.bio.x}`);
});

test('looking up leaves them below, and so does the head rising', () => {
  const up = resting();
  run(up, 60, 0.1, (t) => ({ pitch: 2 * t }));
  assert.ok(up.bio.y > 1);
  const bob = resting();
  run(bob, 60, 0.3, () => ({ bob: 0.03 }));
  assert.ok(bob.bio.y > 2 && bob.bio.y < 4, `${bob.bio.y}`);
});

test('no turn or hit throws a panel past 12 px times the HUD scale', () => {
  for (const scale of [0.75, 1, 1.5]) {
    const s = resting();
    let furthest = 0;
    for (let i = 1; i <= 30; i++) {
      if (i % 5 === 0) s.hit({ side: 'L', severity: 1 });
      s.step(input({ yaw: i * 0.9, pitch: i * 0.5, scale }), STEP);
      furthest = Math.max(furthest, Math.hypot(s.bio.x, s.bio.y), Math.hypot(s.ammo.x, s.ammo.y));
    }
    assert.ok(furthest <= MAX_OFFSET * scale + 1e-9, `${furthest} at ${scale}`);
    assert.ok(furthest > MAX_OFFSET * scale * 0.9);
  }
});

test('a swipe from the left jolts the biomonitor and barely moves the weapon panel', () => {
  const far = reach({ side: 'L', severity: 0.8 });
  assert.ok(far.bio > 6, `${far.bio}`);
  assert.ok(far.ammo < far.bio * 0.2, `${far.ammo}`);
  assert.ok(far.bioX > 0, 'pushed away from the blow');
  const right = reach({ side: 'R', severity: 0.8 });
  assert.ok(right.ammo > 6 && right.bio < right.ammo * 0.2);
});

test('a hit with no side jolts both panels slightly', () => {
  for (const strike of [{}, { side: null, dir: { x: 0, y: 0 }, severity: 0.8 }]) {
    const far = reach(strike);
    assert.ok(far.bio > 0.5 && far.bio < 5, `${far.bio}`);
    assert.equal(far.bio, far.ammo);
  }
  assert.ok(reach({ dir: { x: 1 } }).bioX < 0, 'pushed away from the attacker');
});

test('a harder hit throws further', () => {
  assert.ok(reach({ side: 'L', severity: 1 }).bio > reach({ side: 'L', severity: 0.1 }).bio);
});

test('Reduced motion keeps the panels at rest', () => {
  const s = resting();
  s.hit({ side: 'L', severity: 1 });
  for (let i = 1; i <= 20; i++) {
    s.step(input({ yaw: -i * 0.2, bob: 0.05, reduced: true }), STEP);
    assert.deepEqual([s.bio, s.ammo], [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  }
});

test('a frozen scene leaves them where they are', () => {
  const s = resting();
  run(s, 60, 0.1, (t) => ({ yaw: -3 * t }));
  const x = s.bio.x;
  s.step(input({ yaw: -0.3 }), 0);
  assert.equal(s.bio.x, x);
});

test('30 and 144 steps a second move the panels alike', () => {
  // A half-second turn, a hit as it starts, then still. The sample moments fall on a step at both rates.
  const view = (t: number): Partial<MotionInput> => ({ yaw: -2 * Math.min(t, 0.5), pitch: 0.8 * Math.min(t, 0.5) });
  const sample = (rate: number): number[] => {
    const s = resting();
    s.hit({ side: 'L', severity: 0.5 });
    const out: number[] = [];
    let from = 0;
    for (const until of [1 / 6, 0.5, 2 / 3]) {
      run(s, rate, until - from, view, from);
      from = until;
      out.push(s.bio.x, s.bio.y, s.ammo.x, s.ammo.y);
    }
    return out;
  };
  const slow = sample(30);
  const fast = sample(144);
  slow.forEach((v, i) => assert.ok(Math.abs(v - fast[i]!) < 0.05, `sample ${i}: ${v} against ${fast[i]}`));
});

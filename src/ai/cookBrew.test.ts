import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COOK_BREW_TUNING, CookBrew, type CookBrewHost } from './cookBrew.ts';

const STATION = { pos: { x: 30.6, y: 0, z: 11.7 }, yaw: 0 };
const MACHINE = { pos: { x: 26.75, y: 0, z: 11.32 }, yaw: 0 };

type Point = { x: number; y: number; z: number };

function rig() {
  const cook = {
    pos: { ...STATION.pos },
    yaw: STATION.yaw,
    pose: 'idle',
    free: true,
    /** Walks run at their speed unless blocked: then they neither move nor end. */
    blocked: false,
    walking: null as null | { to: Point; yaw: number; speed: number; done: () => void },
    walks: [] as Point[],
  };
  const world = { introOver: true, over: false, playerFree: true, talking: false, scene: false, ready: true };
  const sounds: Array<{ at: number; stoppedAt: number | null }> = [];
  let now = 0;
  const host: CookBrewHost = {
    cook: {
      free: () => cook.free && cook.walking === null,
      feet: () => cook.pos,
      walk: (to, yaw, speed, done) => {
        cook.walks.push({ ...to });
        cook.walking = { to: { ...to }, yaw, speed, done };
      },
      stop: () => {
        cook.walking = null;
      },
      pose: (name) => (cook.pose = name),
      rest: () => (cook.pose = 'idle'),
    },
    introOver: () => world.introOver,
    over: () => world.over,
    playerFree: () => world.playerFree,
    talking: () => world.talking,
    sceneRunning: () => world.scene,
    soundReady: () => world.ready,
    playSound: () => {
      const s = { at: now, stoppedAt: null as number | null };
      sounds.push(s);
      return { setGain: () => {}, stop: () => (s.stoppedAt ??= now) };
    },
  };
  const brew = new CookBrew(host, STATION, MACHINE);
  const dt = 0.1;
  const tick = (): void => {
    now += dt;
    const w = cook.walking;
    if (w && !cook.blocked) {
      const dx = w.to.x - cook.pos.x;
      const dz = w.to.z - cook.pos.z;
      const d = Math.hypot(dx, dz);
      const step = w.speed * dt;
      if (d <= step) {
        cook.pos = { ...w.to };
        cook.yaw = w.yaw;
        cook.walking = null;
        w.done();
      } else {
        cook.pos = { x: cook.pos.x + (dx / d) * step, y: 0, z: cook.pos.z + (dz / d) * step };
      }
    }
    brew.update(dt);
  };
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds - 1e-9; t += dt) tick();
  };
  /** Run until `done`, failing after `limit` seconds; returns how long it took. */
  const until = (done: () => boolean, limit: number, what: string): number => {
    const from = now;
    while (!done()) {
      assert.ok(now - from < limit, `${what} within ${limit} s`);
      tick();
    }
    return now - from;
  };
  const near = (p: { x: number; z: number }) => Math.hypot(cook.pos.x - p.x, cook.pos.z - p.z) < 0.05;
  return { brew, cook, world, sounds, run, until, near, now: () => now };
}

test('a full brew: walk to the machine, work it with the sound, walk back and face as before', () => {
  const r = rig();
  const wait = r.until(() => r.cook.walking !== null, 61, 'the first brew starts');
  assert.ok(wait >= COOK_BREW_TUNING.firstWait[0] - 0.2, `not before ${COOK_BREW_TUNING.firstWait[0]} s, was ${wait.toFixed(1)}`);
  assert.equal(r.brew.atStation(), false);
  assert.equal(r.sounds.length, 0, 'silent on the way there');
  r.until(() => r.brew.state === 'brewing', 10, 'he reaches the machine');
  assert.ok(r.near(MACHINE.pos));
  assert.equal(r.cook.pose, 'typing');
  assert.equal(r.sounds.length, 1);
  const took = r.until(() => r.cook.walking !== null, 10, 'he finishes');
  assert.ok(Math.abs(took - COOK_BREW_TUNING.brew) < 0.3, `works it about ${COOK_BREW_TUNING.brew} s, was ${took.toFixed(1)}`);
  assert.equal(r.cook.pose, 'idle');
  assert.equal(r.brew.atStation(), false);
  r.until(() => r.brew.state === 'waiting', 10, 'he gets back');
  assert.ok(r.near(STATION.pos));
  assert.equal(r.cook.yaw, STATION.yaw);
  assert.equal(r.brew.atStation(), true);
  assert.equal(r.sounds[0]!.stoppedAt, null, 'the clip was left to finish');
});

test('later brews are two to three minutes of free time apart', () => {
  const r = rig();
  r.until(() => r.sounds.length === 1, 75, 'first brew');
  r.until(() => r.brew.state === 'waiting', 20, 'back');
  const wait = r.until(() => r.cook.walking !== null, 181, 'second brew');
  assert.ok(wait >= COOK_BREW_TUNING.wait[0] - 0.2, `second wait ${wait.toFixed(1)}`);
});

test('the wait runs only while Jay is free in the Commons after the intro', () => {
  for (const key of ['introOver', 'playerFree'] as const) {
    const r = rig();
    r.world[key] = false;
    r.run(300);
    assert.equal(r.cook.walks.length, 0, `${key} false`);
    r.world[key] = true;
    const wait = r.until(() => r.cook.walking !== null, 61, 'starts afterwards');
    assert.ok(wait >= COOK_BREW_TUNING.firstWait[0] - 0.2, 'none of the time away counted');
  }
});

test('a due brew waits while anyone is talking, a scene runs, the sound is missing or Bram is not free at his station', () => {
  const blocks: Array<[string, (r: ReturnType<typeof rig>, on: boolean) => void]> = [
    ['talking', (r, on) => (r.world.talking = on)],
    ['scene', (r, on) => (r.world.scene = on)],
    ['sound not decoded', (r, on) => (r.world.ready = !on)],
    ['Bram busy', (r, on) => (r.cook.free = !on)],
    ['Bram elsewhere', (r, on) => (r.cook.pos = on ? { x: 25, y: 0, z: 13 } : { ...STATION.pos })],
  ];
  for (const [name, set] of blocks) {
    const r = rig();
    set(r, true);
    r.run(120);
    assert.equal(r.cook.walks.length, 0, name);
    set(r, false);
    r.until(() => r.cook.walking !== null, 0.5, `${name} cleared: starts at once`);
  }
});

test('leaving the Commons mid-brew lets him finish and come back', () => {
  const r = rig();
  r.until(() => r.brew.state === 'brewing', 75, 'brewing');
  r.world.playerFree = false;
  r.until(() => r.brew.state === 'waiting', 20, 'finishes');
  assert.ok(r.near(STATION.pos));
});

test('blocked on the way, he gives up without the sound and goes home once the way clears', () => {
  const r = rig();
  r.until(() => r.cook.walking !== null, 61, 'starts');
  r.run(1);
  r.cook.blocked = true;
  const gaveUp = r.until(() => r.brew.state === 'back', COOK_BREW_TUNING.walkLimit + 1, 'gives up');
  assert.ok(gaveUp >= COOK_BREW_TUNING.walkLimit - 1.5);
  assert.equal(r.sounds.length, 0);
  r.run(40);
  assert.equal(r.brew.state, 'back', 'still trying to get home');
  r.cook.blocked = false;
  r.until(() => r.brew.state === 'waiting', COOK_BREW_TUNING.walkLimit + COOK_BREW_TUNING.retry + 5, 'gets home');
  assert.ok(r.near(STATION.pos));
  assert.equal(r.sounds.length, 0);
});

test('a walk that ends short of the machine is abandoned', () => {
  const r = rig();
  r.until(() => r.cook.walking !== null, 61, 'starts');
  r.run(1.5);
  const w = r.cook.walking!;
  r.cook.walking = null;
  w.done();
  r.run(0.2);
  assert.equal(r.brew.state, 'back');
  assert.equal(r.sounds.length, 0);
});

test('a script taking Bram stops the sound, clears his pose and leaves him to it', () => {
  for (const when of ['out', 'brewing', 'back'] as const) {
    const r = rig();
    r.until(() => r.brew.state === when, 90, when);
    r.run(0.5);
    r.brew.interrupt('okafor');
    assert.equal(r.brew.state, when, 'another NPC’s command changes nothing');
    r.brew.interrupt('cook');
    assert.equal(r.brew.state, 'waiting');
    assert.equal(r.cook.walking, null);
    assert.equal(r.cook.pose, 'idle');
    if (when === 'brewing') assert.ok(r.sounds[0]!.stoppedAt !== null, 'sound stopped');
    const walks = r.cook.walks.length;
    r.cook.pos = { x: 25, y: 0, z: 13 }; // where the script put him
    r.run(400);
    assert.equal(r.cook.walks.length, walks, 'the routine does not walk him again');
  }
});

test('the drop ends a brew, sends him back and allows no more', () => {
  for (const when of ['out', 'brewing'] as const) {
    const r = rig();
    r.until(() => r.brew.state === when, 90, when);
    r.run(0.5);
    r.world.over = true;
    r.run(0.1);
    assert.equal(r.brew.state, 'back');
    assert.equal(r.cook.pose, 'idle');
    if (when === 'brewing') assert.ok(r.sounds[0]!.stoppedAt !== null);
    r.until(() => r.brew.state === 'waiting', 20, 'home');
    assert.ok(r.near(STATION.pos));
    const walks = r.cook.walks.length;
    r.run(600);
    assert.equal(r.cook.walks.length, walks);
  }
});

test('a reset silences the brew, walks nobody and starts the first wait again', () => {
  const r = rig();
  r.until(() => r.brew.state === 'brewing', 75, 'brewing');
  const walks = r.cook.walks.length;
  r.brew.reset();
  assert.ok(r.sounds[0]!.stoppedAt !== null);
  assert.equal(r.brew.state, 'waiting');
  assert.equal(r.cook.walks.length, walks);
  r.cook.pos = { ...STATION.pos };
  r.cook.pose = 'idle';
  const wait = r.until(() => r.cook.walking !== null, 61, 'first wait again');
  assert.ok(wait >= COOK_BREW_TUNING.firstWait[0] - 0.2);
});

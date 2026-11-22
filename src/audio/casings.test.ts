import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EventBus } from '../core/events.ts';
import { CollisionWorld, type ColliderSurface } from '../world/collision.ts';
import type { VoiceOptions } from './engine.ts';
import {
  CASING_DELAY_MAX,
  CASING_DELAY_MIN,
  CASING_VOICES,
  CasingAudio,
  casingSound,
  ejectOnWeaponEvents,
  resolveCasingLanding,
  type CasingEjection,
  type CasingKind,
  type CasingSurface,
  type CasingWorld,
} from './casings.ts';
import { SAMPLE_URLS, type SoundName } from './sounds.ts';

/** Jay at the origin looking down -Z: his right is +X. The pistol's port is about 1.4 m up. */
const EJECT: CasingEjection = { kind: 'brass', x: 0, y: 1.4, z: 0, rightX: 1, rightZ: 0, forwardX: 0, forwardZ: -1 };

function world(build: (w: CollisionWorld) => void, extra: Partial<CasingWorld> = {}): CasingWorld {
  const w = new CollisionWorld();
  build(w);
  return {
    raycast: (...r) => w.raycast(...r),
    surfaceAt: (x, y, z) => w.surfaceAt(x, y, z),
    ...extra,
  };
}
const floor = (surface: ColliderSurface | null) => (w: CollisionWorld) => void w.add({ min: [-20, -0.2, -20], max: [20, 0, 20] }, 'floor', surface);

test('a casing lands to the right, on the floor, inside the delay window', () => {
  const w = world(floor('concrete'));
  for (let seed = 1; seed <= 200; seed++) {
    const l = resolveCasingLanding(EJECT, w, seed)!;
    assert.ok(l, `seed ${seed} lands`);
    assert.ok(l.x >= 0.4 - 1e-9 && l.x <= 1.5 + 1e-9, `lateral ${l.x}`);
    assert.ok(l.z >= -0.5 - 1e-9 && l.z <= 0.2 + 1e-9, `forward ${l.z}`);
    assert.ok(Math.abs(l.y) < 1e-6, `on the floor (${l.y})`);
    assert.ok(l.delay >= CASING_DELAY_MIN && l.delay <= CASING_DELAY_MAX, `delay ${l.delay}`);
    assert.equal(l.surface, 'concrete');
  }
});

test('the same seed lands in the same place', () => {
  const w = world(floor('metal'));
  assert.deepEqual(resolveCasingLanding(EJECT, w, 42), resolveCasingLanding(EJECT, w, 42));
  assert.notDeepEqual(resolveCasingLanding(EJECT, w, 42), resolveCasingLanding(EJECT, w, 43));
});

test('the surface is read where the casing lands, not under the shooter', () => {
  // Bare deck under Jay, carpet (tagged rubber) from 0.3 m to his right.
  const w = world((c) => {
    c.add({ min: [-20, -0.2, -20], max: [0.3, 0, 20] }, 'deck', 'metal');
    c.add({ min: [0.3, -0.2, -20], max: [20, 0, 20] }, 'carpet', 'rubber');
  });
  for (let seed = 1; seed <= 50; seed++) assert.equal(resolveCasingLanding(EJECT, w, seed)!.surface, 'soft');
});

test('an untagged floor reads as metal plate', () => {
  assert.equal(resolveCasingLanding(EJECT, world(floor(null)), 1)!.surface, 'metal');
});

test('a wall to the right stops the casing short of it', () => {
  const w = world((c) => {
    floor('concrete')(c);
    c.add({ min: [0.3, 0, -5], max: [0.5, 3, 5] }, 'wall');
  });
  for (let seed = 1; seed <= 50; seed++) {
    const l = resolveCasingLanding(EJECT, w, seed)!;
    assert.ok(l.x < 0.3, `seed ${seed}: landed at x=${l.x}, beyond the wall face`);
    assert.equal(l.surface, 'concrete');
  }
});

test('water depth: a film is still the floor, ankle-deep plips, thigh-deep is deep', () => {
  const at = (depth: number) => resolveCasingLanding(EJECT, world(floor('concrete'), { waterDepth: () => depth }), 3)!.surface;
  assert.equal(at(0.01), 'concrete');
  assert.equal(at(0.2), 'shallow');
  assert.equal(at(0.5), 'deep');
});

test('a water tag with no depth data reads as shallow', () => {
  assert.equal(resolveCasingLanding(EJECT, world(floor('water')), 3)!.surface, 'shallow');
});

test('a grate over a deck sometimes drops the casing through to a later, lower landing', () => {
  const w = world((c) => {
    c.add({ min: [-20, -0.05, -20], max: [20, 0, 20] }, 'grate', 'grate');
    c.add({ min: [-20, -2.2, -20], max: [20, -2, 20] }, 'lower', 'concrete');
  });
  let through = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const l = resolveCasingLanding(EJECT, w, seed)!;
    assert.equal(l.surface, 'grate');
    if (!l.under) continue;
    through++;
    assert.equal(l.under.surface, 'concrete');
    assert.ok(Math.abs(l.under.y + 2) < 1e-6, `lower landing at ${l.under.y}`);
    assert.ok(l.under.delay > l.delay + 0.5, 'falls 2 m further, so lands well after the rattle');
  }
  assert.ok(through > 40 && through < 120, `about 40% fall through (${through}/200)`);
});

test('a grate over nothing never drops a second landing', () => {
  const w = world((c) => void c.add({ min: [-20, -0.05, -20], max: [20, 0, 20] }, 'grate', 'grate'));
  for (let seed = 1; seed <= 100; seed++) assert.equal(resolveCasingLanding(EJECT, w, seed)!.under, undefined);
});

test('no floor within reach: nothing lands', () => {
  assert.equal(resolveCasingLanding(EJECT, world(() => {}), 1), null);
});

const KINDS: CasingKind[] = ['brass', 'hull'];
const SURFACES: CasingSurface[] = ['concrete', 'metal', 'grate', 'soft', 'shallow', 'deep'];

test('every kind and surface maps to a registered bank, except deep water', () => {
  for (const k of KINDS)
    for (const s of SURFACES) {
      const pick = casingSound(k, s);
      if (s === 'deep') {
        assert.equal(pick, null, `${k} in deep water is silent`);
        continue;
      }
      assert.ok(pick, `${k} on ${s}`);
      assert.ok(pick.sound in SAMPLE_URLS, `${pick.sound} is registered`);
      assert.ok(pick.gain > 0 && pick.rate > 0);
    }
});

test('brass and hulls never share a floor bank; only the water plip is shared, pitched down for hulls', () => {
  for (const s of ['concrete', 'metal', 'grate', 'soft'] as const) assert.notEqual(casingSound('brass', s)!.sound, casingSound('hull', s)!.sound);
  assert.equal(casingSound('brass', 'shallow')!.sound, casingSound('hull', 'shallow')!.sound);
  assert.ok(casingSound('hull', 'shallow')!.rate < casingSound('brass', 'shallow')!.rate);
});

test('soft floors are at least 8 dB under concrete', () => {
  for (const k of KINDS) {
    const db = 20 * Math.log10(casingSound(k, 'soft')!.gain / casingSound(k, 'concrete')!.gain);
    assert.ok(db <= -8, `${k}: soft is ${db.toFixed(1)} dB vs concrete`);
  }
});

test('every casing bank has at least 4 variants', () => {
  for (const [name, urls] of Object.entries(SAMPLE_URLS)) if (name.startsWith('casing')) assert.ok(Array.isArray(urls) && urls.length >= 4, `${name}`);
});

// ---- playback ----------------------------------------------------------------------------------------------------

interface Played {
  name: SoundName;
  opts: VoiceOptions;
  stopped: number | null;
}

function harness(surface: ColliderSurface = 'concrete', listener = new THREE.Vector3(0, 1.6, 0)) {
  const played: Played[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let clock = 0;
  const audio = {
    hasSound: () => true,
    variantCount: () => 4,
    play(name: SoundName, opts: VoiceOptions = {}) {
      const p: Played = { name, opts, stopped: null };
      played.push(p);
      return { stop: (f?: number) => void (p.stopped = f ?? 0) };
    },
  };
  const casings = new CasingAudio({
    audio,
    world: world(floor(surface)),
    listener: () => listener,
    later: (fn, ms) => void timers.push({ at: clock + ms / 1000, fn }),
    now: () => clock,
  });
  const advance = (dt: number) => {
    clock += dt;
    timers.sort((a, b) => a.at - b.at);
    while (timers.length && timers[0]!.at <= clock) timers.shift()!.fn();
  };
  return { casings, played, advance, listener };
}

test('one ejection plays one landing, at the landing point, after its delay', () => {
  const h = harness();
  const l = h.casings.eject(EJECT)!;
  h.advance(l.delay - 0.01);
  assert.equal(h.played.length, 0, 'nothing before the casing reaches the floor');
  h.advance(0.02);
  assert.equal(h.played.length, 1);
  assert.equal(h.played[0]!.name, 'casingBrassConcrete');
  assert.equal(h.played[0]!.opts.bus, 'sfx');
  assert.ok(h.played[0]!.opts.position!.distanceTo(new THREE.Vector3(l.x, l.y, l.z)) < 0.1);
});

test('five landings at once leave at most 4 voices, and the oldest fades out', () => {
  const h = harness();
  for (let i = 0; i < 5; i++) {
    h.casings.eject(EJECT);
    h.advance(0.02);
  }
  h.advance(1);
  assert.equal(h.played.length, 5);
  const live = h.played.filter((p) => p.stopped === null);
  assert.ok(live.length <= CASING_VOICES, `${live.length} voices`);
  const stolen = h.played.filter((p) => p.stopped !== null);
  assert.equal(stolen.length, 1);
  assert.ok(stolen[0]!.stopped! > 0 && stolen[0]!.stopped! <= 0.05, `fade ${stolen[0]!.stopped}`);
  assert.equal(stolen[0], h.played[0], 'the voice that started first is the one faded out');
});

test('consecutive landings from one bank never repeat a variant, and the pitch varies', () => {
  const h = harness();
  for (let i = 0; i < 40; i++) {
    h.casings.eject(EJECT);
    h.advance(2);
  }
  const rates = new Set<number>();
  for (let i = 1; i < h.played.length; i++) {
    assert.notEqual(h.played[i]!.opts.variant, h.played[i - 1]!.opts.variant, `play ${i} repeats its variant`);
    rates.add(h.played[i]!.opts.rate!);
  }
  assert.ok(rates.size > 30, 'rates differ');
  for (const r of rates) assert.ok(r >= 0.94 && r <= 1.06);
});

test('a casing more than 8 m from the listener is not heard', () => {
  const h = harness('concrete', new THREE.Vector3(9.5, 1.6, 0));
  h.casings.eject(EJECT);
  h.advance(1);
  assert.equal(h.played.length, 0);
});

test('a casing in deep water plays nothing', () => {
  const h = harness();
  const deep = new CasingAudio({
    audio: { hasSound: () => true, play: (name, opts) => void h.played.push({ name, opts: opts ?? {}, stopped: null }) },
    world: world(floor('concrete'), { waterDepth: () => 0.8 }),
    listener: () => h.listener,
    later: (fn) => fn(),
  });
  deep.eject(EJECT);
  assert.equal(h.played.length, 0);
});

test('a fall-through landing is quieter and duller than the rattle', () => {
  const played: Played[] = [];
  const c = new CasingAudio({
    audio: { hasSound: () => true, variantCount: () => 4, play: (name, opts) => void played.push({ name, opts: opts ?? {}, stopped: null }) },
    world: world((w) => {
      w.add({ min: [-20, -0.05, -20], max: [20, 0, 20] }, 'grate', 'grate');
      w.add({ min: [-20, -2.2, -20], max: [20, -2, 20] }, 'lower', 'metal');
    }),
    listener: () => new THREE.Vector3(0, 1.6, 0),
    later: (fn) => fn(),
    now: () => 0,
  });
  let pair: Played[] | null = null;
  for (let i = 0; i < 30 && !pair; i++) {
    const before = played.length;
    const l = c.eject(EJECT);
    if (l?.under) pair = played.slice(before);
  }
  assert.ok(pair && pair.length === 2, 'some casing fell through');
  const [rattle, below] = pair;
  assert.equal(rattle!.name, 'casingBrassGrate');
  assert.equal(below!.name, 'casingBrassMetal');
  assert.ok(below!.opts.gain! < rattle!.opts.gain! * 0.5);
  assert.ok(below!.opts.cutoff !== undefined && rattle!.opts.cutoff === undefined);
});

test('stopAll drops landings still in the air', () => {
  const h = harness();
  h.casings.eject(EJECT);
  h.casings.stopAll();
  h.advance(2);
  assert.equal(h.played.length, 0);
});

// ---- Jay's guns -------------------------------------------------------------------------------------------------

function weaponBus() {
  const bus = new EventBus();
  const ejected: CasingKind[] = [];
  const off = ejectOnWeaponEvents(bus, (k) => ejected.push(k));
  // Everything emitted on the bus from here on, besides what the test emits itself.
  const emitted: string[] = [];
  const emit = bus.emit.bind(bus);
  let own = false;
  const send = ((name: never, payload: never) => {
    own = true;
    emit(name, payload);
    own = false;
  }) as EventBus['emit'];
  bus.emit = ((name: string, payload: unknown) => {
    if (!own) emitted.push(name);
    emit(name as never, payload as never);
  }) as EventBus['emit'];
  return { send, ejected, emitted, off };
}

test('one pistol shot ejects one brass casing', () => {
  const b = weaponBus();
  b.send('weapon:fired', { weapon: 'pistol' });
  assert.deepEqual(b.ejected, ['brass']);
});

test('a shotgun shot ejects its hull on the pump, not on the shot', () => {
  const b = weaponBus();
  b.send('weapon:fired', { weapon: 'shotgun' });
  assert.deepEqual(b.ejected, [], 'nothing at the shot');
  b.send('weapon:cue', { weapon: 'shotgun', cue: 'pump' });
  assert.deepEqual(b.ejected, ['hull']);
  b.send('weapon:cue', { weapon: 'shotgun', cue: 'pump' });
  assert.deepEqual(b.ejected, ['hull'], 'a second rack with nothing fired ejects nothing');
});

test('drawing the shotgun, dry fire, reload cues and shell inserts eject nothing', () => {
  const b = weaponBus();
  b.send('weapon:cue', { weapon: 'shotgun', cue: 'pump' });
  b.send('weapon:dryFire', { weapon: 'pistol' });
  b.send('weapon:shellInsert', { weapon: 'shotgun' });
  for (const cue of ['magOut', 'magIn', 'slide', 'slideSoft', 'cockBack'] as const) b.send('weapon:cue', { weapon: 'pistol', cue });
  assert.deepEqual(b.ejected, []);
});

test('ejecting puts nothing on the bus, so infected only ever hear the gunshot', () => {
  const b = weaponBus();
  b.send('weapon:fired', { weapon: 'pistol' });
  b.send('weapon:fired', { weapon: 'shotgun' });
  b.send('weapon:cue', { weapon: 'shotgun', cue: 'pump' });
  assert.deepEqual(b.ejected, ['brass', 'hull']);
  assert.deepEqual(b.emitted, []);
});

test('unsubscribing stops ejecting', () => {
  const b = weaponBus();
  b.off();
  b.send('weapon:fired', { weapon: 'pistol' });
  assert.deepEqual(b.ejected, []);
});

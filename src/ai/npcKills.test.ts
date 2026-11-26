import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import posesJson from '../data/poses.json' with { type: 'json' };
import killsJson from '../data/kills.json' with { type: 'json' };
import type { GoreSystem } from '../actors/gore.ts';
import { clearOfBand } from '../actors/goreClip.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { validate } from '../core/validate.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { validateKillTable } from '../data/types/kills.ts';
import { NpcDirector } from './npcs.ts';
import { JOINT_NAMES, type JointName } from '../actors/skeleton.ts';
import type { BodyModelLibrary } from '../actors/bodyModelLibrary.ts';
import { CollisionWorld } from '../world/collision.ts';
import { measureBladePenetration } from '../actors/blade/clearance.ts';
import { creatureLib, necromorphModel } from '../actors/blade/bladeTestKit.ts';

/** The Lab B kill on Voss (optional bodyModels for real blade creature): glass at z = 0, she starts 4.7 m behind it. */
function setup(opts: { bodyModels?: BodyModelLibrary } = {}) {
  const goreCalls: Array<{ kind: string; at?: THREE.Vector3; size?: number; band?: { min: number; max: number } }> = [];
  const gore = {
    burst: (at: THREE.Vector3) => void goreCalls.push({ kind: 'burst', at: at.clone() }),
    chunks: () => void goreCalls.push({ kind: 'chunks' }),
    pool: () => void goreCalls.push({ kind: 'pool' }),
    spurt: () => void goreCalls.push({ kind: 'spurt' }),
    glassMark: (at: THREE.Vector3, _n: THREE.Vector3, kind: string, size: number, opts: { band?: { min: number; max: number } }) =>
      void goreCalls.push({ kind: `glass:${kind}`, at: at.clone(), size, ...(opts.band ? { band: opts.band } : {}) }),
  } as unknown as GoreSystem;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emitted: Array<{ name: string; at: number }> = [];
  const sounds: string[] = [];
  const warnings: string[] = [];
  let now = 0;
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, ...(opts.bodyModels ? { bodyModels: opts.bodyModels } : {}) },
    nav: null,
    colliders: null,
    player: () => ({ feet: new THREE.Vector3(0, 0, -3), head: new THREE.Vector3(0, 1.62, -3) }),
    emit: (name, payload) => {
      emitted.push({ name, at: now });
      for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
    },
    listen: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    sfx: (ids) => {
      const id = ids.find((i) => ['fleshTear', 'glassThud', 'drip', 'zombieVoice'].includes(i));
      if (id) sounds.push(id);
      return id !== undefined;
    },
    warn: (m) => warnings.push(m),
    kills: validate(validateKillTable, killsJson, 'kills'),
  });
  npcs.setResolver(() => ({ pos: { x: 0, y: 1.5, z: 0 } }));
  npcs.spawnFromLevel([{ id: 'researcher_b', look: 'voss', pos: { x: 0, y: 0, z: 4.7 }, yaw: 0, pose: 'typing', transformable: true }]);
  const camera = new THREE.Vector3(0, 1.62, -3);
  const step = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1 / 60;
      npcs.update(1 / 60, camera);
      each?.();
    }
  };
  const say = (id: string): void => {
    for (const fn of [...(handlers.get('speech:ended') ?? [])]) fn({ id, speaker: 'crew_lab' });
  };
  const beatAt = (b: string): number => emitted.find((e) => e.name === `kill:${b}`)?.at ?? -1;
  return { npcs, goreCalls, emitted, sounds, warnings, step, say, beatAt, time: () => now };
}

/** Play the kill to the end: her plea ends at 2.5 s, the scream 1.5 s after she starts pounding the glass. */
function playThrough(g: ReturnType<typeof setup>, each?: () => void): void {
  void g.npcs.command('kill', KILL);
  g.step(2.5, each);
  g.say('drop_voss_01');
  let screamed = false;
  g.step(18, () => {
    each?.();
    if (!screamed && g.beatAt('glass') > 0 && g.time() - g.beatAt('glass') > 1.5) {
      screamed = true;
      g.say('drop_voss_02');
    }
  });
}

const KILL = { npc: 'researcher_b', kind: 'grownInside', glass: 'anchor:labb_glass', lines: { scratch: 'drop_voss_01', glass: 'drop_voss_02' } };

test('the Lab B kill: she staggers to the glass, pounds it, arches, bursts, dies torn open, and the creature stands', async () => {
  const g = setup();
  const voss = g.npcs.actor('researcher_b')!;
  let done = false;
  void g.npcs.command('kill', KILL).then(() => (done = true));
  let handStretch = 0;
  const watchHands = (): void => {
    for (const h of ['hand_L', 'hand_R', 'foreArm_L', 'foreArm_R'] as const) handStretch = Math.max(handStretch, Math.abs(voss.body.bones[h].scale.y - 1));
  };
  g.step(2.5, watchHands);
  g.say('drop_voss_01');
  g.step(4, watchHands);
  assert.ok(g.beatAt('glass') > 0, 'she reached the glass');
  assert.ok(Math.abs(voss.position.z - 0.71) < 0.35, `she stands at the glass (z ${voss.position.z.toFixed(2)})`);
  g.say('drop_voss_02');
  const arch = g.time();
  g.step(1 / 60, watchHands);
  assert.ok(Math.abs(g.beatAt('arch') - arch) < 0.05, 'the arch starts as the scream ends');
  g.step(8, watchHands);
  await Promise.resolve();
  const order = g.emitted.filter((e) => e.name.startsWith('kill:')).map((e) => e.name.slice(5));
  assert.deepEqual(order, ['scratch', 'panic', 'glass', 'arch', 'burst', 'still', 'creature', 'done']);
  assert.ok(done, 'the kill step finishes');
  assert.equal(handStretch, 0, 'her hands and forearms keep their length through every beat');
  assert.equal(voss.body.alive, false, 'she is dead');
  assert.ok(voss.body.chestTorn, 'her chest is torn open');
  const creature = g.npcs.actor('researcher_b_creature', false);
  assert.ok(creature, 'the creature is there');
  assert.ok(creature.body.alive && creature.body.group.scale.x === 1, 'it is standing, full size');
  assert.ok(g.goreCalls.some((c) => c.kind === 'burst') && g.goreCalls.some((c) => c.kind === 'chunks') && g.goreCalls.some((c) => c.kind === 'pool'));
  assert.ok(g.sounds.filter((s) => s === 'fleshTear').length >= 3, 'crunches and the tear are heard (stand-ins until the recordings exist)');
  assert.ok(g.warnings.every((w) => !w.includes('unknown pose')), g.warnings.join('; '));
});

test('the creature shows within a second of the burst', () => {
  const g = setup();
  let seenAt = -1;
  playThrough(g, () => {
    if (seenAt < 0 && g.npcs.actor('researcher_b_creature', false)) seenAt = g.time();
  });
  assert.ok(g.beatAt('burst') > 0 && seenAt >= g.beatAt('burst') && seenAt - g.beatAt('burst') < 1);
});

test('blood on the glass keeps clear of the band from her chest to head height', () => {
  const g = setup();
  playThrough(g);
  const marks = g.goreCalls.filter((c) => c.kind === 'glass:splat' || c.kind === 'glass:streak');
  assert.ok(marks.length >= 3, 'splats and a streak land on the glass');
  for (const m of marks) {
    const band = m.band!;
    assert.deepEqual(band, { min: 1.1, max: 1.8 });
    if (m.kind === 'glass:streak') assert.ok(m.at!.y <= band.min, 'the streak runs down from below the band');
    else {
      const y = clearOfBand(m.at!.y, m.size!, band);
      assert.ok(y + m.size! / 2 <= band.min || y - m.size! / 2 >= band.max, `splat at ${y.toFixed(2)} clears the band`);
    }
  }
  const prints = g.goreCalls.filter((c) => c.kind === 'glass:print');
  assert.ok(prints.length >= 2, 'palm smears as she pounds');
  // Palm smears are sweat, not blood (no blood on her until the burst), so they may sit where her hands are.
});

test('the key light is on her from the glass to the still beat, and off after', () => {
  const g = setup();
  const lit: Array<[number, number]> = [];
  playThrough(g, () => lit.push([g.time(), g.npcs.kills.light.intensity]));
  const on = (t0: number, t1: number): boolean => lit.filter(([t]) => t > t0 + 0.05 && t < t1 - 0.05).every(([, i]) => i > 0);
  assert.ok(on(g.beatAt('glass'), g.beatAt('burst')), 'lit through glass and arch');
  assert.ok(on(g.beatAt('burst') + 0.1, g.beatAt('creature')), 'lit through the still beat');
  assert.equal(lit[lit.length - 1]![1], 0, 'off once the creature stands');
});

test('a restored kill (instant) leaves the torn corpse and the standing creature, with no gore or sounds replayed', () => {
  const g = setup();
  void g.npcs.command('kill', { ...KILL, instant: true });
  const voss = g.npcs.actor('researcher_b')!;
  assert.equal(voss.body.alive, false);
  assert.ok(voss.body.chestTorn);
  assert.ok(g.npcs.actor('researcher_b_creature', false));
  assert.equal(g.goreCalls.length, 0);
  assert.equal(g.sounds.length, 0);
  g.npcs.reset();
  const again = g.npcs.actor('researcher_b')!;
  assert.ok(again.body.alive && !again.body.chestTorn, 'a new game has Voss alive at her desk');
  assert.equal(g.npcs.actor('researcher_b_creature', false), null);
});

test('a converted kill turns the victim herself and spawns no creature', () => {
  const g = setup();
  void g.npcs.command('kill', { npc: 'researcher_b', kind: 'converted', instant: true });
  assert.equal(g.npcs.actor('researcher_b')!.body.infection, 3);
  assert.equal(g.npcs.actor('researcher_b_creature', false), null);
});

test('after the kill the creature hammers on the glass beside her body until the level lets it out', () => {
  const g = setup();
  playThrough(g);
  assert.ok(g.npcs.kills.pounding('researcher_b_creature'), 'it is at the glass');
  const before = g.sounds.filter((x) => x === 'glassThud').length;
  g.step(8);
  const creature = g.npcs.actor('researcher_b_creature', false)!;
  assert.ok(Math.abs(creature.position.z - 0.66) < 0.4, `it stands at the pane (z ${creature.position.z.toFixed(2)})`);
  const voss = g.npcs.actor('researcher_b')!;
  assert.ok(creature.position.distanceTo(voss.position) > 0.5, 'beside her body, not on it');
  assert.ok(g.sounds.filter((x) => x === 'glassThud').length - before >= 4, 'the blows land on the glass');
  void g.npcs.command('despawn', { npc: 'researcher_b_creature' });
  g.step(1);
  assert.equal(g.npcs.kills.pounding('researcher_b_creature'), false, 'gone once it escapes in the blackout');
});

test('a restored kill has the creature pounding at once', () => {
  const g = setup();
  void g.npcs.command('kill', { ...KILL, instant: true });
  assert.ok(g.npcs.kills.pounding('researcher_b_creature'));
});

test('the glass beat fires a score stinger on each of her palm hits (adaptive-music)', () => {
  const g = setup();
  playThrough(g);
  const stingers = g.emitted.filter((e) => e.name === 'score:stinger');
  const prints = g.goreCalls.filter((c) => c.kind === 'glass:print').length;
  assert.ok(prints >= 3, `${prints} palm hits`);
  assert.equal(stingers.length, prints, 'one stab per palm hit');
  const glass = g.beatAt('glass');
  for (const s of stingers) assert.ok(s.at >= glass && s.at < glass + 2, `stinger at ${s.at.toFixed(2)} is in the glass beat`);
});

test('each flurry on the glass reports one pound event, at its first blow', () => {
  const g = setup();
  playThrough(g);
  const blowsBefore = g.sounds.filter((x) => x === 'glassThud').length;
  const poundsBefore = g.emitted.filter((e) => e.name === 'creature:pound').length;
  g.step(10);
  const blows = g.sounds.filter((x) => x === 'glassThud').length - blowsBefore;
  const pounds = g.emitted.filter((e) => e.name === 'creature:pound').length - poundsBefore;
  assert.ok(pounds >= 2, `${pounds} flurries`);
  // 3-6 blows a flurry; the last one may still be under way.
  assert.ok(blows >= (pounds - 1) * 3 && blows <= pounds * 6, `${blows} blows in ${pounds} flurries`);
});

test('a restored kill fires no stingers', () => {
  const g = setup();
  void g.npcs.command('kill', { ...KILL, instant: true });
  assert.equal(g.emitted.filter((e) => e.name === 'score:stinger').length, 0);
});

// ---- mauled (infection-kills / medbay-attack specs): an attacker that is already there kills her by hand.
// A pane on z = 0 seen from z < 0 (Jay's side); Priya pleads at it from z = 0.4; the cart is 1.4 m behind it.

const MARKS: Record<string, { x: number; y: number; z: number }> = {
  pane: { x: 0, y: 1.5, z: 0 },
  // She sits against the west wall, then backs into the corner away from it.
  sit: { x: -2.2, y: 0, z: 0.9 },
  cower: { x: -2.7, y: 0, z: 0.6 },
  // It comes along the glass from the surgery door, past Jay, and takes her in the corner.
  along: { x: 2.4, y: 0, z: 0.7 },
  impale: { x: -2.1, y: 0, z: 0.6 },
  around: { x: 1.3, y: 0, z: 1.2 },
  // The attacker's right hand reaches 0.61 m ahead and 0.32 m to its right in its slam pose: it stands so that lands on the cart.
  slamSpot: { x: -0.32, y: 0, z: 2.01 },
  slamFace: { x: -0.32, y: 0, z: 0.5 },
  cart: { x: 0, y: 0.925, z: 1.4 },
  throwAt: { x: -0.2, y: 1.45, z: 0.0 },
  rest: { x: -0.2, y: 0, z: 0.6 },
  exit: { x: 2.4, y: 0, z: 0.7 },
  surgery: { x: 4.2, y: 0, z: 3.5 },
};

/** The R08 beats on a small test room (design D16): plead, impale, carry, slam, throw, still. */
export const MAULED_TEST_STYLE = {
  kind: 'mauled',
  glassStand: 0.55,
  beats: [
    {
      id: 'plead', poses: ['kill_backaway_0', 'kill_backaway_1'], period: 0.5, convulse: 0, until: 'time', s: 6.5, max: 8, lines: ['plea'],
      events: [{ t: 0, do: 'haulTo', mark: 'impale', via: ['along'], faceMark: 'cower', speed: 1.1 }, { t: 0.4, do: 'backTo', mark: 'cower', speed: 0.45 }],
    },
    {
      id: 'impale', startWhen: 'inReach', reach: 0.75, poses: ['kill_impaled'], blend: 0.08, convulse: 0.5, until: 'time', s: 1.4, max: 2, lines: ['scream'],
      events: [
        { t: 0, do: 'attackerPose', pose: 'maul_impale', blend: 0.08 },
        { t: 0, do: 'grip', hand: 'R', joint: 'chest' },
        { t: 0, do: 'sfx', id: ['impale_stab'], joint: 'chest' },
        { t: 0.05, do: 'gore', kind: 'spurt', joint: 'chest', s: 2 },
        { t: 0.08, do: 'gore', kind: 'burst', joint: 'chest', count: 120 },
        { t: 0.3, do: 'gore', kind: 'pool', joint: 'chest', size: 0.8 },
      ],
    },
    {
      id: 'carry', poses: ['kill_carried'], blend: 0.35, convulse: 0.35, until: 'time', s: 3.2, max: 4,
      events: [{ t: 0, do: 'attackerPose', pose: 'maul_carry' }, { t: 0, do: 'haulTo', mark: 'slamSpot', faceMark: 'slamFace', speed: 1.2 }, { t: 1, do: 'gore', kind: 'pool', joint: 'chest', size: 0.3 }],
    },
    {
      id: 'slam', poses: ['kill_slammed'], convulse: 0.6, until: 'impacts', impacts: 3, max: 6,
      lines: ['scream_full', 'cry_cut', 'gasp_wet', ''],
      events: [{ t: 0, do: 'grip', hand: 'R', joint: 'head' }, { t: 0.4, do: 'slam', mark: 'cart' }, { t: 1.5, do: 'slam', mark: 'cart' }, { t: 2.5, do: 'slam', mark: 'cart' }],
    },
    {
      id: 'throw', poses: ['kill_thrown'], blend: 0.08, convulse: 0.2, until: 'time', s: 1.8, max: 2.5,
      events: [{ t: 0, do: 'grip', release: true }, { t: 0, do: 'throw', mark: 'throwAt', s: 0.5 }, { t: 0.55, do: 'pose', pose: 'kill_slide', blend: 0.5 }],
    },
    {
      id: 'still', poses: ['corpseProne'], convulse: 0, until: 'time', s: 6, max: 6,
      events: [
        { t: 0, do: 'die', pose: 'corpseProne', blend: 0.6 },
        { t: 0.3, do: 'gore', kind: 'pool', joint: 'chest', size: 1.0 },
        { t: 0.8, do: 'haulTo', mark: 'surgery', via: ['exit'], speed: 1.2 },
        { t: 2, do: 'gore', kind: 'pool', joint: 'chest', size: 1.4 },
      ],
    },
  ],
};

/** The engine's older grips (still in the engine for other users): pinned by the hair, then dragged by the ankle. */
const DRAG_TEST_STYLE = {
  kind: 'mauled',
  beats: [
    { id: 'plead', poses: ['kill_glass_0'], convulse: 0, until: 'time', s: 0.5, max: 1 },
    { id: 'grab', poses: ['kill_grabbed'], convulse: 0.3, until: 'time', s: 4.5, max: 5, events: [{ t: 0, do: 'pin', behind: 0.42, side: 0.1 }, { t: 0, do: 'attackerPose', pose: 'maul_grip' }, { t: 0, do: 'grip', hand: 'R', joint: 'head' }] },
    { id: 'haul', poses: ['kill_hauled'], convulse: 0.4, until: 'time', s: 3.2, max: 4, events: [{ t: 0, do: 'attackerPose', pose: 'maul_haul' }, { t: 0, do: 'haulTo', mark: 'around', speed: 1.3 }] },
    {
      id: 'drag', poses: ['kill_dragged'], convulse: 0.05, until: 'time', s: 5, max: 6,
      events: [{ t: 0, do: 'attackerPose', pose: 'maul_drag' }, { t: 0, do: 'pin', behind: 1.2, side: 0.15 }, { t: 0, do: 'grip', hand: 'R', joint: 'foot_R' }, { t: 0, do: 'drag', mark: 'exit', speed: 1.0 }, { t: 2.6, do: 'drag', mark: 'surgery', speed: 1.0 }],
    },
    { id: 'still', poses: ['corpseProne'], convulse: 0, until: 'time', s: 1, max: 1, events: [{ t: 0, do: 'grip', release: true }, { t: 0, do: 'die', pose: 'corpseProne', blend: 0.6 }] },
  ],
};

type Spot = { x: number; y: number; z: number };
function mauledSetup(
  extraStyles: Record<string, unknown> = {},
  opts: { marks?: Record<string, Spot>; priya?: Spot; thing?: Spot; jay?: Spot; bodyModels?: BodyModelLibrary } = {},
) {
  const marks = opts.marks ?? MARKS;
  const jay = opts.jay ?? { x: 0.3, y: 0, z: -0.5 };
  type Clip = { axis: string; at: number; keep: string };
  const goreCalls: Array<{ kind: string; at?: THREE.Vector3; clip?: Clip | undefined; along?: THREE.Vector3 | undefined; size?: number }> = [];
  const gore = {
    burst: (at: THREE.Vector3, _d: THREE.Vector3, _n: number, _dark: unknown, clip?: Clip) => void goreCalls.push({ kind: 'burst', at: at.clone(), clip }),
    chunks: (at: THREE.Vector3, _d: THREE.Vector3, _n: number, clip?: Clip) => void goreCalls.push({ kind: 'chunks', at: at.clone(), clip }),
    pool: (at: THREE.Vector3, size: number) => void goreCalls.push({ kind: 'pool', at: at.clone(), size }),
    spurt: (bone: THREE.Object3D, _p: THREE.Vector3, _d: THREE.Vector3, _s: number, _dark: unknown, clip?: Clip) =>
      void goreCalls.push({ kind: 'spurt', at: bone.getWorldPosition(new THREE.Vector3()), clip }),
    glassMark: (at: THREE.Vector3, _n: THREE.Vector3, kind: string, size: number, opts: { along?: THREE.Vector3 } = {}) =>
      void goreCalls.push({ kind: `glass:${kind}`, at: at.clone(), along: opts.along?.clone(), size }),
  } as unknown as GoreSystem;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emitted: Array<{ name: string; at: number; payload: unknown }> = [];
  const sounds: string[] = [];
  /** livelier-cart-slam: what the slams play (with the take), throw, move and lay out. */
  const takes: Array<{ id: string; variant: number | undefined }> = [];
  const bursts: Array<{ at: THREE.Vector3; reach: number; strength: number; along?: THREE.Vector3Like; toward?: THREE.Vector3Like }> = [];
  const props = new Map<string, { pos: THREE.Vector3; rotation: THREE.Quaternion }>([['r08_cart', { pos: new THREE.Vector3(0, 0, 47.4), rotation: new THREE.Quaternion() }]]);
  const moves: Array<{ id: string; pos: THREE.Vector3; rotation: THREE.Quaternion }> = [];
  const layouts: string[] = [];
  const warnings: string[] = [];
  let now = 0;
  const kills = validate(validateKillTable, { ...killsJson, mauledTest: MAULED_TEST_STYLE, dragTest: DRAG_TEST_STYLE, ...extraStyles }, 'kills');
  const emit = (name: string, payload: unknown): void => {
    emitted.push({ name, at: now, payload });
    for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
  };
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, ...(opts.bodyModels ? { bodyModels: opts.bodyModels } : {}) },
    nav: null,
    colliders: null,
    player: () => ({ feet: new THREE.Vector3(jay.x, 0, jay.z), head: new THREE.Vector3(jay.x, 1.62, jay.z) }),
    emit,
    listen: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    sfx: (ids, _at, _gain, variant) => {
      sounds.push(ids[0]!);
      takes.push({ id: ids[0]!, variant });
      return true;
    },
    warn: (m) => warnings.push(m),
    kills,
    burst: (at, reach, strength, o) => void bursts.push({ at: new THREE.Vector3(at.x, at.y, at.z), reach, strength, ...(o.along ? { along: o.along } : {}), ...(o.toward ? { toward: o.toward } : {}) }),
    propPose: (id) => {
      const q = props.get(id);
      return q ? { pos: q.pos.clone(), rotation: q.rotation.clone() } : null;
    },
    moveProp: (id, pos, rotation) => {
      props.set(id, { pos: pos.clone(), rotation: rotation.clone() });
      moves.push({ id, pos: pos.clone(), rotation: rotation.clone() });
    },
    layOut: (group) => void layouts.push(group),
  });
  npcs.setResolver((ref) => {
    const name = String(ref).replace(/^anchor:/, '');
    const p = marks[name];
    return p ? { pos: p } : null;
  });
  npcs.spawnFromLevel([
    { id: 'priya', look: 'priya', pos: opts.priya ?? MARKS['sit']!, yaw: 0, pose: 'idle' },
    { id: 'r08_thing', look: 'lab_creature', pos: opts.thing ?? { x: 3.2, y: 0, z: 3.0 }, yaw: 0, pose: 'idle' },
  ]);
  const camera = new THREE.Vector3(jay.x, 1.62, jay.z);
  const step = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1 / 60;
      npcs.update(1 / 60, camera);
      each?.();
    }
  };
  const beatAt = (b: string): number => emitted.find((e) => e.name === `kill:${b}`)?.at ?? -1;
  const beat = (): string | null => npcs.kills.running('priya')?.beatId ?? null;
  return { npcs, goreCalls, emitted, sounds, takes, bursts, props, moves, layouts, warnings, step, beatAt, beat, emit, time: () => now };
}

const MAUL_STEP = {
  npc: 'priya',
  kind: 'mauledTest',
  attacker: 'r08_thing',
  glass: 'anchor:pane',
  marks: Object.fromEntries(Object.keys(MARKS).map((k) => [k, `anchor:${k}`])),
};

/** Nearest distance (m) from a point to the victim's body (any joint). */
function toBody(body: { jointWorld: (j: JointName, out?: THREE.Vector3) => THREE.Vector3 }, p: THREE.Vector3): number {
  let best = Infinity;
  for (const j of JOINT_NAMES) best = Math.min(best, body.jointWorld(j, new THREE.Vector3()).distanceTo(p));
  return best;
}

/** The kill's beats as they began, without the impact, voice and throw events. */
const beatOrder = (g: ReturnType<typeof mauledSetup>): string[] =>
  g.emitted.filter((e) => e.name.startsWith('kill:') && !['kill:impact', 'kill:say', 'kill:cut', 'kill:thrown', 'kill:noticed'].includes(e.name)).map((e) => e.name.slice(5));

/** medbay-attack "No jump" (task 8.1): the attacker's largest move between two frames of a kill played live. */
function largestStep(g: ReturnType<typeof mauledSetup>, seconds: number, each?: () => void): number {
  const thing = g.npcs.actor('r08_thing')!;
  let last = thing.position.clone();
  let worst = 0;
  g.step(seconds, () => {
    worst = Math.max(worst, thing.position.distanceTo(last));
    last = thing.position.clone();
    each?.();
  });
  return worst;
}

test('mauled: the beats run plead, impale, carry, slam, throw, still, and she ends dead, limbs whole', async () => {
  const g = mauledSetup();
  let done = false;
  void g.npcs.command('kill', MAUL_STEP).then(() => (done = true));
  // Every new pose on both bodies: no bone is stretched or squashed (the posesSandbox check, headless).
  const bodies = [g.npcs.actor('priya')!.body, g.npcs.actor('r08_thing')!.body];
  let stretch = 0;
  g.step(26, () => {
    for (const b of bodies) for (const j of JOINT_NAMES) if (j !== 'root') stretch = Math.max(stretch, Math.abs(b.bones[j].scale.y - 1));
  });
  assert.ok(stretch < 1e-6, `bones keep their length (worst ${stretch.toFixed(4)})`);
  await Promise.resolve();
  assert.deepEqual(beatOrder(g), ['plead', 'impale', 'carry', 'slam', 'throw', 'still', 'done']);
  assert.ok(done, 'the kill step finishes');
  assert.equal(g.npcs.actor('priya')!.body.alive, false, 'she is dead');
  assert.ok(g.warnings.every((w) => !w.includes('unknown pose') && !w.includes('no mark') && !w.includes('never reached')), g.warnings.join('; '));
});

test('mauled: a kill with no attacker warns and does nothing', async () => {
  const g = mauledSetup();
  await g.npcs.command('kill', { ...MAUL_STEP, attacker: 'nobody' });
  assert.ok(g.warnings.some((w) => w.includes('needs an "attacker"')));
  assert.equal(g.npcs.kills.running('priya'), null);
});

test('No jump: the attacker never moves more than 0.3 m between two frames, from its first step to the end of the kill', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const worst = largestStep(g, 26);
  assert.ok(worst <= 0.3, `largest step ${worst.toFixed(3)} m`);
});

test('No jump with a pin: a pinned attacker walks to her during play (the pin only places it for a skip or restore)', () => {
  const g = mauledSetup({}, { priya: { x: 0, y: 0, z: 0.4 } });
  void g.npcs.command('kill', { ...MAUL_STEP, kind: 'dragTest' });
  const worst = largestStep(g, 16);
  assert.ok(worst <= 0.3, `largest step ${worst.toFixed(3)} m`);
  assert.deepEqual(beatOrder(g), ['plead', 'grab', 'haul', 'drag', 'still', 'done']);
});

test('In reach first: the impale begins only once the creature stands within arm\'s reach of her, in front of her', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const thing = g.npcs.actor('r08_thing')!;
  const priya = g.npcs.actor('priya')!;
  let gap = -1;
  let facing = Infinity;
  g.step(14, () => {
    if (gap < 0 && g.beat() === 'impale') {
      gap = Math.hypot(thing.position.x - priya.position.x, thing.position.z - priya.position.z);
      const want = Math.atan2(-(priya.position.x - thing.position.x), -(priya.position.z - thing.position.z));
      facing = Math.abs(Math.atan2(Math.sin(want - thing.body.heading), Math.cos(want - thing.body.heading)));
    }
  });
  assert.ok(gap >= 0 && gap <= 0.75, `it is ${gap.toFixed(2)} m from her when the impale begins`);
  assert.ok(facing < THREE.MathUtils.degToRad(60), `it faces her (${THREE.MathUtils.radToDeg(facing).toFixed(0)} deg off)`);
});

test('Backing away: she backs to the corner facing the creature, a step at a time, never moved instantly', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  const thing = g.npcs.actor('r08_thing')!;
  let last = priya.position.clone();
  let worstStep = 0;
  let worstFace = 0;
  g.step(6, () => {
    if (g.beat() !== 'plead') return;
    worstStep = Math.max(worstStep, priya.position.distanceTo(last));
    last = priya.position.clone();
    if (g.time() > 1.5) {
      const want = Math.atan2(-(thing.position.x - priya.position.x), -(thing.position.z - priya.position.z));
      worstFace = Math.max(worstFace, Math.abs(Math.atan2(Math.sin(want - priya.body.heading), Math.cos(want - priya.body.heading))));
    }
  });
  const cower = MARKS['cower']!;
  assert.ok(Math.hypot(priya.position.x - cower.x, priya.position.z - cower.z) < 0.1, `she reached the corner (${priya.position.x.toFixed(2)}, ${priya.position.z.toFixed(2)})`);
  assert.ok(worstStep < 0.05, `she backs away in small steps (${worstStep.toFixed(3)} m a frame at most)`);
  assert.ok(worstFace < THREE.MathUtils.degToRad(45), `she keeps facing it (${THREE.MathUtils.radToDeg(worstFace).toFixed(0)} deg off at worst)`);
  const said = g.emitted.filter((e) => e.name === 'kill:say').map((e) => (e.payload as { line: string }).line);
  assert.equal(said[0], 'plea', 'her plea plays as she backs away');
});

test('Carried on the claw: from the impale to the cart her chest stays on its hand, and it walks her there', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const thing = g.npcs.actor('r08_thing')!;
  const priya = g.npcs.actor('priya')!;
  let worst = 0;
  let worstRoot = 0;
  let samples = 0;
  let walked = 0;
  let last: THREE.Vector3 | null = null;
  g.step(16, () => {
    const b = g.beat();
    if (b !== 'impale' && b !== 'carry') return;
    if (b === 'impale' && g.time() - g.beatAt('impale') < 0.5) return; // the claw draws her in
    const gp = g.npcs.kills.gripPoints('priya');
    assert.ok(gp, `gripped during ${b}`);
    worst = Math.max(worst, gp.joint.distanceTo(gp.hand));
    worstRoot = Math.max(worstRoot, Math.abs(priya.position.y));
    if (b === 'carry') {
      if (last) walked += thing.position.distanceTo(last);
      last = thing.position.clone();
    }
    samples++;
  });
  assert.ok(samples > 100, `sampled ${samples} frames`);
  assert.ok(worst <= 0.1, `her chest was ${worst.toFixed(3)} m from the claw at worst`);
  assert.ok(worstRoot <= 0.56, `her body hangs from the arm, never flung up (${worstRoot.toFixed(2)} m)`);
  assert.ok(walked > 1.2, `it carried her to the cart (${walked.toFixed(1)} m)`);
});

test('Held for the slams: at the slam the hold moves to her head, and her head meets the cart top on each impact', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  const seenOnImpact: number[] = [];
  let headOnCart = Infinity;
  let joint: string | null = null;
  g.step(26, () => {
    if (g.beat() === 'slam' && joint === null && g.time() - g.beatAt('slam') > 0.2) joint = g.npcs.kills.gripPoints('priya') ? 'held' : 'none';
    const imp = g.emitted.filter((e) => e.name === 'kill:impact');
    if (imp.length > seenOnImpact.length && imp[imp.length - 1]!.at === g.time()) {
      seenOnImpact.push((imp[imp.length - 1]!.payload as { n: number }).n);
      headOnCart = Math.min(headOnCart, priya.body.jointWorld('head', new THREE.Vector3()).distanceTo(new THREE.Vector3(MARKS['cart']!.x, MARKS['cart']!.y, MARKS['cart']!.z)));
    }
  });
  assert.equal(joint, 'held');
  assert.deepEqual(seenOnImpact, [1, 2, 3], 'kill:impact 1..3, each seen the frame it lands');
  assert.ok(headOnCart < 0.12, `her head met the cart top (${headOnCart.toFixed(3)} m)`);
  const crunches = g.sounds.filter((s) => s.startsWith('head_crunch'));
  assert.equal(crunches.length, 3, 'one crunch per impact');
  assert.ok(crunches[0] !== crunches[1] && crunches[1] !== crunches[2], `consecutive crunches differ: ${crunches.join(', ')}`);
  assert.ok(g.sounds.includes('impale_stab'), 'the impale is heard');
});

test('engine: pinned by the hair her head stays in the hand; dragged by the ankle her foot does (drag stays for other users)', () => {
  const g = mauledSetup({}, { priya: { x: 0, y: 0, z: 0.4 } });
  void g.npcs.command('kill', { ...MAUL_STEP, kind: 'dragTest' });
  const priya = g.npcs.actor('priya')!;
  const worst: Record<string, number> = { haul: 0, drag: 0 };
  let stepping = 0;
  g.step(16, () => {
    const b = g.beat();
    if (b !== 'haul' && b !== 'drag') return;
    if (g.time() - g.beatAt(b) < (b === 'drag' ? 1.6 : 0.2)) return; // the drag's pin walks round her first
    const gp = g.npcs.kills.gripPoints('priya');
    if (!gp) return;
    worst[b] = Math.max(worst[b]!, gp.joint.distanceTo(gp.hand));
    if (b === 'drag' && priya.body.carried === null) stepping++;
  });
  assert.ok(worst['haul']! <= 0.1, `her head was ${worst['haul']!.toFixed(3)} m from the hand at worst while hauled`);
  assert.ok(worst['drag']! <= 0.1, `her ankle was ${worst['drag']!.toFixed(3)} m from the hand at worst while dragged`);
  assert.equal(stepping, 0, 'she lies in the dragged pose, no walking legs');
});

test('mauled: thrown into the pane where it was aimed, she slides to the floor at its base and is left there', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  const hit: { contact: THREE.Vector3 | null } = { contact: null };
  g.step(26, () => {
    if (!hit.contact && g.emitted.some((e) => e.name === 'kill:thrown')) hit.contact = priya.body.jointWorld('head', new THREE.Vector3());
  });
  const contact = hit.contact;
  assert.ok(contact, 'she struck the pane');
  const aim = new THREE.Vector3(MARKS['throwAt']!.x, MARKS['throwAt']!.y, MARKS['throwAt']!.z);
  assert.ok(contact.distanceTo(aim) < 0.3, `her head met the pane ${contact.distanceTo(aim).toFixed(2)} m from the aimed point`);
  assert.ok(g.goreCalls.some((c) => c.kind === 'glass:splat' && c.at!.distanceTo(aim) < 0.15), 'the mark is where she struck');
  assert.ok(Math.abs(priya.position.y) < 0.02, `she is on the floor (${priya.position.y.toFixed(2)})`);
  assert.ok(priya.position.z > 0 && priya.position.z < 0.75, `at the base of the pane (z ${priya.position.z.toFixed(2)})`);
});

test('Left on the floor: she lies where she landed in a growing pool while it walks back out to the surgery', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  const thing = g.npcs.actor('r08_thing')!;
  let landed: THREE.Vector3 | null = null;
  let moved = 0;
  g.step(26, () => {
    if (g.beat() === 'still') {
      if (!landed) landed = priya.position.clone();
      moved = Math.max(moved, priya.position.distanceTo(landed));
    }
  });
  assert.ok(landed, 'the still beat played');
  assert.ok(moved < 0.05, `her body stays where it lay (${moved.toFixed(3)} m)`);
  const pools = g.goreCalls.filter((c) => c.kind === 'pool' && Math.hypot(c.at!.x - landed!.x, c.at!.z - landed!.z) < 1.5).map((c) => c.size!);
  assert.ok(pools.length >= 2 && pools[pools.length - 1]! > pools[0]!, `the pool grows (${pools.join(', ')})`);
  const s = MARKS['surgery']!;
  assert.ok(Math.hypot(thing.position.x - s.x, thing.position.z - s.z) < 1.2, `it walked back to the surgery (${thing.position.x.toFixed(1)}, ${thing.position.z.toFixed(1)})`);
  assert.ok(g.goreCalls.every((c) => !c.kind.startsWith('glass:streak') || c.along === undefined), 'no drag streak: she is not dragged');
});

test('mauled: silenced by the third slam', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  g.step(26);
  const third = g.emitted.filter((e) => e.name === 'kill:impact')[2]!;
  const cut = g.emitted.find((e) => e.name === 'kill:cut' && e.at >= third.at);
  assert.ok(cut && cut.at - third.at < 0.2, 'her line is cut within 0.2 s of the third impact');
  const after = g.emitted.filter((e) => e.name === 'kill:say' && e.at > third.at);
  assert.deepEqual(after, [], 'no scream or word from her for the rest of the kill');
  const said = g.emitted.filter((e) => e.name === 'kill:say').map((e) => (e.payload as { line: string }).line);
  assert.deepEqual(said, ['plea', 'scream', 'scream_full', 'cry_cut', 'gasp_wet']);
});

test('mauled: blood starts on her', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  let seen = 0;
  let worst = 0;
  g.step(26, () => {
    for (; seen < g.goreCalls.length; seen++) {
      const c = g.goreCalls[seen]!;
      if (c.kind === 'burst' || c.kind === 'chunks' || c.kind === 'spurt') worst = Math.max(worst, toBody(priya.body, c.at!));
    }
  });
  assert.ok(seen > 0);
  assert.ok(worst <= 0.4, `blood started ${worst.toFixed(2)} m from her body`);
});

// ---- "It notices him" (medbay-attack spec): the attacker stops once on its way to her and stares at Jay.

const STARE_STYLE = {
  ...MAULED_TEST_STYLE,
  noticed: { kind: 'stare', at: 2.2, hold: 1.5, target: 'player' },
  beats: [
    { id: 'plead', poses: ['kill_glass_0', 'kill_glass_1'], period: 0.5, convulse: 0, until: 'time', s: 6, max: 7, events: [{ t: 0, do: 'haulTo', mark: 'approach', faceMark: 'pane', speed: 1.0 }] },
    ...MAULED_TEST_STYLE.beats.slice(1),
  ],
};
MARKS['approach'] = { x: 0.15, y: 0, z: 0.85 };

function stareSetup() {
  const g = mauledSetup({ stareTest: STARE_STYLE }, { priya: { x: 0, y: 0, z: 0.4 } });
  const step = { ...MAUL_STEP, kind: 'stareTest', marks: { ...MAUL_STEP.marks, approach: 'anchor:approach' } };
  return { g, step };
}

/** Yaw (rad) from the attacker's facing to Jay's eye. */
function offJay(thing: { position: THREE.Vector3; body: { heading: number } }): number {
  const eye = new THREE.Vector3(0.3, 1.62, -0.5);
  const want = Math.atan2(-(eye.x - thing.position.x), -(eye.z - thing.position.z));
  return Math.abs(Math.atan2(Math.sin(want - thing.body.heading), Math.cos(want - thing.body.heading)));
}

function runStare(bangAt: number[]) {
  const { g, step } = stareSetup();
  void g.npcs.command('kill', step);
  const thing = g.npcs.actor('r08_thing')!;
  const stares: Array<{ at: number; pos: THREE.Vector3 }> = [];
  let still = 0;
  let faced = Infinity;
  let approachGap = -1;
  const pending = [...bangAt];
  g.step(8, () => {
    while (pending.length && g.time() >= pending[0]!) {
      pending.shift();
      g.emit('kill:notice', { npc: 'priya' });
    }
    const staring = g.npcs.kills.staring('priya');
    if (staring && (stares.length === 0 || g.time() - stares[stares.length - 1]!.at > 1 / 30)) stares.push({ at: g.time(), pos: thing.position.clone() });
    if (staring) {
      still = Math.max(still, thing.position.distanceTo(stares[0]!.pos));
      if (g.time() - stares[0]!.at > 0.8) faced = Math.min(faced, offJay(thing));
    }
    if (approachGap < 0 && g.beat() === 'impale') approachGap = Math.hypot(thing.position.x - MARKS['approach']!.x, thing.position.z - MARKS['approach']!.z);
  });
  const noticed = g.emitted.filter((e) => e.name === 'kill:noticed');
  const stareSpan = stares.length ? stares[stares.length - 1]!.at - stares[0]!.at : 0;
  return { g, stares, noticed, still, faced, stareSpan, impaleAt: g.beatAt('impale'), approachGap };
}

test('it notices him: the first bang brings the stare forward; it stops, turns to Jay and holds still, then goes on', () => {
  const r = runStare([0.8]);
  assert.equal(r.noticed.length, 1);
  assert.ok(r.noticed[0]!.at - 0.8 < 0.3, `the stare starts ${(r.noticed[0]!.at - 0.8).toFixed(2)} s after the bang`);
  assert.ok(r.stareSpan > 1.3 && r.stareSpan < 1.7, `it holds about 1.5 s (${r.stareSpan.toFixed(2)})`);
  assert.ok(r.still < 0.05, `it stands still while it stares (moved ${r.still.toFixed(3)} m)`);
  assert.ok(r.faced < THREE.MathUtils.degToRad(25), `it faces Jay (${THREE.MathUtils.radToDeg(r.faced).toFixed(0)} deg off)`);
});

test('it notices him: with no bang it still stops and stares at its authored point', () => {
  const r = runStare([]);
  assert.equal(r.noticed.length, 1);
  assert.ok(Math.abs(r.noticed[0]!.at - 2.2) < 0.05, `at ${r.noticed[0]!.at.toFixed(2)} s`);
});

test('it notices him only once: later bangs get no reaction', () => {
  const r = runStare([0.8, 2.6, 3.0, 4.2]);
  assert.equal(r.noticed.length, 1, 'one stare');
  assert.ok(r.stares.every((s) => s.at < r.noticed[0]!.at + 1.7), 'no stopping or turning after it');
});

test('it notices him: the impale starts at the same time with an early stare and without one, and it has reached her', () => {
  const early = runStare([0.05]);
  const authored = runStare([]);
  assert.ok(Math.abs(early.impaleAt - authored.impaleAt) < 1 / 60 + 1e-6, `impale at ${early.impaleAt.toFixed(3)} vs ${authored.impaleAt.toFixed(3)}`);
  assert.ok(early.approachGap < 0.35 && authored.approachGap < 0.35, `it is at her when the impale begins (${early.approachGap.toFixed(2)} / ${authored.approachGap.toFixed(2)} m)`);
});

test('Splatter at the impact: on the struck pane only, one crack and a splat on her head\'s point of contact, a ring, runs and a smear', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  const hit: { head: THREE.Vector3 | null } = { head: null };
  g.step(26, () => {
    if (!hit.head && g.emitted.some((e) => e.name === 'kill:thrown')) hit.head = priya.body.jointWorld('head', new THREE.Vector3());
  });
  const marks = g.goreCalls.filter((c) => c.kind.startsWith('glass:'));
  // The pane is the plane z = 0 (its face toward her at z 0.06), x -2..2.
  for (const m of marks) {
    assert.ok(Math.abs(m.at!.z - 0.06) < 1e-6, `${m.kind} sits on the struck pane's face (z ${m.at!.z.toFixed(3)})`);
    assert.ok(Math.abs(m.at!.x) < 2, `${m.kind} is on that pane (x ${m.at!.x.toFixed(2)})`);
  }
  const aim = new THREE.Vector3(MARKS['throwAt']!.x, MARKS['throwAt']!.y, 0.06);
  const cracks = marks.filter((m) => m.kind === 'glass:crack');
  assert.equal(cracks.length, 1, 'one crack');
  const onPane = hit.head!.clone().setZ(0.06);
  assert.ok(cracks[0]!.at!.distanceTo(onPane) < 0.15, `the crack is ${cracks[0]!.at!.distanceTo(onPane).toFixed(2)} m from her head's point of contact`);
  const splats = marks.filter((m) => m.kind === 'glass:splat');
  assert.ok(splats.some((m) => m.at!.distanceTo(aim) < 1e-6), 'a splat exactly on the point (no jitter, no clear-band shift)');
  const ring = splats.filter((m) => m.at!.distanceTo(aim) > 1e-6 && m.at!.distanceTo(aim) <= 0.3);
  assert.ok(ring.length >= 6 && ring.length <= 10, `a ring of ${ring.length} small splats within 0.3 m`);
  const streaks = marks.filter((m) => m.kind === 'glass:streak');
  assert.ok(streaks.length >= 3, `runs under the splatter and a smear down the pane (${streaks.length})`);
  assert.ok(streaks.every((s) => s.along === undefined && s.at!.y <= aim.y + 0.31), 'they run down from the splatter');
});

test('mauled: nothing on Jay\'s side - every spray, spurt and chunk is clipped at the pane', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  g.step(26);
  const sprays = g.goreCalls.filter((c) => c.kind === 'spurt' || c.kind === 'burst' || c.kind === 'chunks');
  assert.ok(sprays.length >= 3);
  for (const c of sprays) {
    assert.ok(c.clip, `${c.kind} has a clip plane`);
    assert.deepEqual({ axis: c.clip.axis, keep: c.clip.keep }, { axis: 'z', keep: 'above' }, 'it keeps to her side');
    assert.ok(Math.abs(c.clip.at - 0.06) < 1e-6, `at the pane's face (${c.clip.at})`);
  }
});

// ---- The R08 kill itself (kills.json "mauled") on the real slice01 anchors (medbay-attack spec, task 9.3).

import levelJson from '../data/levels/slice01.json' with { type: 'json' };

const LEVEL_ANCHORS: Record<string, Spot> = Object.fromEntries(
  (levelJson as { rooms: Array<{ anchors?: Array<{ id: string; pos: number[] }> }> }).rooms.flatMap((r) => (r.anchors ?? []).map((a) => [a.id, { x: a.pos[0]!, y: a.pos[1]!, z: a.pos[2]! }])),
);
/** The marks `sec_glass` passes (the parent's contract). */
const R08_MARKS = {
  along: 'r08_along', lane: 'r08_lane', lane2: 'r08_lane2', back: 'r08_back', cower: 'priya_cower', impale: 'r08_impale', around: 'r08_around', slamSpot: 'r08_slam_spot', slamFace: 'r08_slam_face',
  cart: 'r08_cart_top', throwAt: 'r08_throw_point', rest: 'priya_rest', exit: 'r08_along', surgery: 'r08_lurk',
  surgeryIn: 'r08_surgery_in', surgeryOut: 'r08_surgery_out', glassLook: 'medbay_c_glass',
};
export const R08_KILL = {
  npc: 'priya',
  kind: 'mauled',
  attacker: 'r08_thing',
  glass: 'anchor:medbay_c_glass',
  marks: Object.fromEntries(Object.entries(R08_MARKS).map(([k, a]) => [k, `anchor:${a}`])),
};

test('the R08 kill (kills.json mauled) plays end to end on the slice01 anchors: walks in, impales her, carries her to the cart, slams, throws, leaves her', () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_sit']!, thing: a['r08_lurk']!, jay: a['r07_glass_jay']! });
  void g.npcs.command('kill', R08_KILL);
  const priya = g.npcs.actor('priya')!;
  const thing = g.npcs.actor('r08_thing')!;
  let handWorst = 0;
  let headOnCart = Infinity;
  let reachGap = -1;
  const thrown: { head: THREE.Vector3 | null } = { head: null };
  let stretch = 0;
  const cart = new THREE.Vector3(a['r08_cart_top']!.x, a['r08_cart_top']!.y, a['r08_cart_top']!.z);
  const worstStep = largestStep(g, 40, () => {
    const b = g.beat();
    for (const body of [priya.body, thing.body]) for (const j of JOINT_NAMES) if (j !== 'root') stretch = Math.max(stretch, Math.abs(body.bones[j].scale.y - 1));
    if (b === 'impale' && reachGap < 0) reachGap = Math.hypot(thing.position.x - priya.position.x, thing.position.z - priya.position.z);
    if (!thrown.head && g.emitted.some((e) => e.name === 'kill:thrown')) thrown.head = priya.body.jointWorld('head', new THREE.Vector3());
    const imp = g.emitted.filter((e) => e.name === 'kill:impact');
    if (imp.length && imp[imp.length - 1]!.at === g.time()) headOnCart = Math.min(headOnCart, priya.body.jointWorld('head', new THREE.Vector3()).distanceTo(cart));
    if (!b || !['impale', 'carry', 'slam'].includes(b) || g.time() - g.beatAt(b) < 0.5) return;
    handWorst = Math.max(handWorst, Math.min(toBody(priya.body, thing.body.jointWorld('hand_R', new THREE.Vector3())), toBody(priya.body, thing.body.jointWorld('hand_L', new THREE.Vector3()))));
  });
  const order = g.emitted.filter((e) => /^kill:(plead|impale|carry|slam|throw|still|done)$/.test(e.name)).map((e) => e.name.slice(5));
  assert.deepEqual(order, ['plead', 'impale', 'carry', 'slam', 'throw', 'still', 'done']);
  assert.ok(g.warnings.every((w) => !/unknown pose|no mark|needs an|never reached/.test(w)), g.warnings.join('; '));
  assert.ok(stretch < 1e-6, 'no stretched limbs');
  assert.ok(worstStep <= 0.3, `no jump (largest step ${worstStep.toFixed(3)} m)`);
  assert.ok(reachGap >= 0 && reachGap <= 0.75, `it has reached her when the impale begins (${reachGap.toFixed(2)} m)`);
  assert.ok(handWorst <= 0.25, `its hand stays on her (${handWorst.toFixed(2)} m at worst)`);
  assert.ok(headOnCart < 0.12, `her head meets the cart top (${headOnCart.toFixed(3)} m)`);
  const aim = new THREE.Vector3(a['r08_throw_point']!.x, a['r08_throw_point']!.y, a['r08_throw_point']!.z);
  const head = thrown.head;
  assert.ok(head && head.distanceTo(aim) < 0.3, `thrown into the centre pane where aimed (${head?.distanceTo(aim).toFixed(2)} m)`);
  const marks = g.goreCalls.filter((c) => c.kind.startsWith('glass:'));
  for (const m of marks) assert.ok(Math.abs(m.at!.z - 45.78) < 1e-6 && m.at!.x > -2 && m.at!.x < 2, `${m.kind} on the centre pane (${m.at!.x.toFixed(2)}, ${m.at!.z.toFixed(2)})`);
  assert.equal(marks.filter((m) => m.kind === 'glass:crack').length, 1);
  for (const c of g.goreCalls.filter((c) => ['spurt', 'burst', 'chunks'].includes(c.kind))) assert.ok(c.clip && c.clip.keep === 'above' && Math.abs(c.clip.at - 45.78) < 1e-6, 'clipped at the pane, nothing on Jay\'s side');
  assert.equal(priya.body.alive, false);
  const rest = a['priya_rest']!;
  assert.ok(Math.hypot(priya.position.x - rest.x, priya.position.z - rest.z) < 0.5, `she lies at the foot of the pane (${priya.position.x.toFixed(2)}, ${priya.position.z.toFixed(2)})`);
  assert.ok(g.emitted.filter((e) => e.name === 'kill:noticed').length <= 1, 'it stares at Jay at most once (the rush is over before the nine-second stare)');
  const lurk = a['r08_lurk']!;
  assert.ok(Math.hypot(thing.position.x - lurk.x, thing.position.z - lurk.z) < 1.5, `it went back toward the surgery (${thing.position.x.toFixed(1)}, ${thing.position.z.toFixed(1)})`);
});

// livelier-cart-slam: the slams' rhythm, the cart's jolt, the sounds of each hit, what they throw.
test('the R08 slams build, rock and slide the cart a little, sound a different steel each time and no glass, and throw what is near', () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_sit']!, thing: a['r08_lurk']!, jay: a['r07_glass_jay']! });
  void g.npcs.command('kill', R08_KILL);
  const priya = g.npcs.actor('priya')!;
  const placed = g.props.get('r08_cart')!;
  const headInCart: number[] = [];
  g.step(40, () => {
    const imp = g.emitted.filter((e) => e.name === 'kill:impact');
    if (!imp.length || imp[imp.length - 1]!.at !== g.time()) return;
    // Her head over the cart's top where the cart is now, in its own frame.
    const cart = g.props.get('r08_cart')!;
    const local = priya.body.jointWorld('head', new THREE.Vector3()).sub(cart.pos).applyQuaternion(cart.rotation.clone().invert());
    headInCart.push(Math.abs(local.x) < 0.5 && Math.abs(local.z) < 0.3 && local.y > 0.85 ? 1 : 0);
  });
  const impacts = g.emitted.filter((e) => e.name === 'kill:impact').map((e) => e.at);
  assert.equal(impacts.length, 3);
  const [g1, g2] = [impacts[1]! - impacts[0]!, impacts[2]! - impacts[1]!];
  assert.ok(g2 >= g1 + 0.3, `the last gap is the longest (${g1.toFixed(2)} s, then ${g2.toFixed(2)} s)`);
  assert.deepEqual(headInCart, [1, 1, 1], 'her head lands on the cart top, where the cart is now, every time');
  // Skewed, not far: every corner of the cart within 0.25 m of where it stood, and it did move.
  const end = g.props.get('r08_cart')!;
  let worst = 0;
  for (const [x, z] of [[-0.5, -0.275], [0.5, -0.275], [-0.5, 0.275], [0.5, 0.275]]) {
    const was = new THREE.Vector3(x, 0, z).applyQuaternion(placed.rotation).add(placed.pos);
    const now = new THREE.Vector3(x, 0, z).applyQuaternion(end.rotation).add(end.pos);
    worst = Math.max(worst, was.distanceTo(now));
  }
  assert.ok(worst > 0.02 && worst <= 0.25, `the cart ends skewed (${(worst * 100).toFixed(1)} cm at worst)`);
  assert.ok(Math.abs(new THREE.Euler().setFromQuaternion(end.rotation, 'YXZ').x) < 1e-3, 'and back on its casters');
  assert.ok(g.moves.some((m) => Math.abs(new THREE.Euler().setFromQuaternion(m.rotation, 'YXZ').x) > 0.02), 'it rocked on the way');
  const steel = g.takes.filter((t) => t.id === 'cartSlam').map((t) => t.variant);
  assert.deepEqual(steel, [0, 1, 2], 'a different steel impact on each slam');
  assert.equal(g.takes.filter((t) => t.id === 'cartRattle').length, 3, 'and the instruments rattle each time');
  assert.ok(g.sounds.every((id) => !/glass_break|cart_impact/.test(id)), 'no glass breaks');
  assert.equal(g.bursts.length, 3);
  assert.ok(g.bursts[0]!.reach < g.bursts[1]!.reach && g.bursts[1]!.reach < g.bursts[2]!.reach, 'each slam reaches further');
  assert.ok(g.bursts.every((b) => b.along && b.toward), 'along the cart, and toward the glass');
  assert.deepEqual(g.layouts, [], 'a played kill lays nothing out');
});

test('a skipped R08 kill throws nothing and leaves the cart where its layout puts it', () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_sit']!, jay: a['r07_glass_jay']! });
  void g.npcs.command('kill', { npc: 'priya', kind: 'mauled', glass: 'anchor:medbay_c_glass', marks: { throwAt: 'anchor:r08_throw_point', rest: 'anchor:priya_rest' }, instant: true });
  g.step(1);
  assert.equal(g.bursts.length, 0, 'nothing thrown');
  assert.equal(g.moves.length, 0, 'no jolt');
  assert.deepEqual(g.layouts, ['r08_cart'], 'the cart and its instruments are laid out as a played kill leaves them');
});

test('medbay-attack restore: an instant R08 kill with no attacker leaves her dead at her resting spot and the centre pane marked, nothing thrown', () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_wait']!, thing: a['r08_lurk']!, jay: a['r07_glass_jay']! });
  void g.npcs.command('kill', { npc: 'priya', kind: 'mauled', glass: 'anchor:medbay_c_glass', marks: { throwAt: 'anchor:r08_throw_point', rest: 'anchor:priya_rest' }, instant: true });
  g.step(0.5);
  const priya = g.npcs.actor('priya')!;
  assert.equal(priya.body.alive, false, 'she is dead');
  const rest = a['priya_rest']!;
  assert.ok(Math.hypot(priya.position.x - rest.x, priya.position.z - rest.z) < 0.05, 'at her resting spot');
  assert.ok(g.warnings.every((w) => !/needs an "attacker"|no mark/.test(w)), g.warnings.join('; '));
  const marks = g.goreCalls.filter((c) => c.kind.startsWith('glass:'));
  assert.equal(marks.filter((m) => m.kind === 'glass:crack').length, 1);
  assert.ok(marks.filter((m) => m.kind === 'glass:splat').length >= 7, 'the splat and its ring');
  assert.ok(marks.filter((m) => m.kind === 'glass:streak').length >= 3, 'runs and the smear');
  assert.equal(marks.filter((m) => m.kind === 'glass:print').length, 0, 'no palm prints: she never pleaded at the glass');
  for (const m of marks) assert.ok(Math.abs(m.at!.z - 45.78) < 1e-6 && m.at!.x > -2 && m.at!.x < 2, `${m.kind} on the centre pane only`);
  const crack = marks.find((m) => m.kind === 'glass:crack')!;
  assert.ok(Math.abs(crack.at!.x - a['r08_throw_point']!.x) < 1e-6 && Math.abs(crack.at!.y - a['r08_throw_point']!.y) < 1e-6, 'the crack is where her head struck');
  const again = mauledSetup({}, { marks: a, priya: a['priya_wait']!, thing: a['r08_lurk']!, jay: a['r07_glass_jay']! });
  void again.npcs.command('kill', { npc: 'priya', kind: 'mauled', glass: 'anchor:medbay_c_glass', marks: { throwAt: 'anchor:r08_throw_point', rest: 'anchor:priya_rest' }, instant: true });
  again.step(0.1);
  const pos = (c: { at?: THREE.Vector3 }) => c.at!.toArray().map((v) => v.toFixed(4)).join(',');
  assert.deepEqual(again.goreCalls.filter((c) => c.kind.startsWith('glass:')).map(pos), marks.map(pos), 'the same marks on every restore');
  assert.equal(g.goreCalls.filter((c) => ['spurt', 'burst', 'chunks'].includes(c.kind)).length, 0, 'no blood thrown on a restore');
  assert.equal(g.sounds.length, 0, 'no sounds replayed');
});


test('slice-stinger: her corpse lies still at least 3 s, twitches, gets up infected, and turns her face to the camera; one breath, no words', () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_rest']!, thing: { x: 30, y: 0, z: 30 }, jay: { x: 36, y: 0, z: 40 } }); // Jay in R11 during the stinger: the feed shows a room he is not in
  const priya = g.npcs.actor('priya')!;
  // Dead from R08 (as the drag left her).
  void g.npcs.command('kill', { npc: 'priya', kind: 'mauled', glass: 'anchor:medbay_c_glass', instant: true });
  g.step(0.3);
  priya.place(a['priya_rest']!, 0);
  assert.equal(priya.body.alive, false);
  const head = (): number => priya.body.jointWorld('head', new THREE.Vector3()).y;
  void g.npcs.command('kill', { npc: 'priya', kind: 'convertedRise', marks: { camera: 'anchor:cam04_pos' } });
  let lyingUntil = 0;
  let headAtFace = 0;
  let facing = Infinity;
  g.step(12, () => {
    if (head() < 0.95) lyingUntil = g.time();
    const f = g.beatAt('face');
    if (f > 0 && Math.abs(g.time() - (f + 1.2)) < 1 / 120) {
      headAtFace = head();
      const cam = a['cam04_pos']!;
      const want = Math.atan2(-(cam.x - priya.position.x), -(cam.z - priya.position.z));
      facing = Math.abs(Math.atan2(Math.sin(want - priya.body.heading), Math.cos(want - priya.body.heading)));
    }
  });
  const start = g.beatAt('still');
  assert.ok(g.beatAt('twitch') - start >= 3, `still for ${(g.beatAt('twitch') - start).toFixed(1)} s`);
  assert.ok(lyingUntil > g.beatAt('twitch'), 'still lying as she starts to move');
  assert.ok(headAtFace > 1.2, `standing when the feed cuts (head at ${headAtFace.toFixed(2)} m)`);
  assert.ok(facing < THREE.MathUtils.degToRad(30), `facing the camera (${THREE.MathUtils.radToDeg(facing).toFixed(0)} deg off)`);
  assert.ok(priya.body.alive, 'up and moving');
  const said = g.emitted.filter((e) => e.name === 'kill:say').map((e) => (e.payload as { line: string }).line);
  assert.deepEqual(said, ['stinger_priya_06'], 'one breath, no words');
});

test('infection-kills "Thrown from the wrong side": a mauled kill started with her past the pane still lands her in her room', () => {
  const g = mauledSetup();
  const priya = g.npcs.actor('priya')!;
  priya.place({ x: priya.position.x, y: 0, z: -0.9 });
  void g.npcs.command('kill', MAUL_STEP);
  g.step(26);
  assert.ok(priya.position.z > 0 && priya.position.z < 0.75, `she lies at the base of the pane on her side (z ${priya.position.z.toFixed(2)})`);
});

test('infection-kills "The body stays on her side": once the throw lands, no joint of her body is past the pane', () => {
  const g = mauledSetup();
  void g.npcs.command('kill', MAUL_STEP);
  const priya = g.npcs.actor('priya')!;
  let worst = Infinity;
  const p = new THREE.Vector3();
  g.step(26, () => {
    if (g.beat() !== 'still') return;
    for (const j of JOINT_NAMES) worst = Math.min(worst, priya.body.jointWorld(j, p).z);
  });
  assert.ok(worst > 0, `her nearest joint is ${worst.toFixed(3)} m from the pane`);
});

test('medbay-attack "It leaves through the door" (D37): in and out of the surgery only through D_R08_R08b, walking, never placed', () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_sit']!, thing: a['r08_lurk']!, jay: a['r07_glass_jay']! });
  void g.npcs.command('kill', R08_KILL);
  const thing = g.npcs.actor('r08_thing')!;
  // R08's east wall is at x 6; the surgery door is centred on z 52 (scripts/gen-slice01.mjs, D_R08_R08b).
  const crossings: number[] = [];
  let prev = thing.position.clone();
  let stillFrom = -1;
  let speedStill = 0;
  const worstStep = largestStep(g, 40, () => {
    const p = thing.position;
    if ((prev.x < 6) !== (p.x < 6)) crossings.push((prev.z + p.z) / 2);
    if (g.beat() === 'still') {
      if (stillFrom < 0) stillFrom = g.time();
      else speedStill = Math.max(speedStill, Math.hypot(p.x - prev.x, p.z - prev.z) * 60);
    }
    prev = p.clone();
  });
  assert.ok(crossings.length >= 2, `it comes out of the surgery and goes back in (${crossings.length} crossings)`);
  for (const z of crossings) assert.ok(Math.abs(z - 52) < 0.6, `crossed the east wall through the doorway (z ${z.toFixed(2)})`);
  assert.ok(worstStep <= 0.3, `never placed (largest step ${worstStep.toFixed(3)} m)`);
  assert.ok(speedStill > 1.45, `it walks away faster than it hauled her (${speedStill.toFixed(2)} m/s)`);
  const s = a['r08_lurk']!;
  assert.ok(Math.hypot(thing.position.x - s.x, thing.position.z - s.z) < 0.6, 'back in the surgery by the end');
});

// ---- rig-necromorph tasks 7.3 & 7.4: real blade creature in Lab B pounding and R08 Priya's death.

test('infection-kills "Forearms bang on the pane" (rig-necromorph task 7.3): Lab B blade creature bangs its forearms within 10 cm of the glass, blades upright, never more than 5 cm through', async () => {
  const g = setup({ bodyModels: creatureLib(await necromorphModel()) });
  // Glass pane at z = 0 (thickness -0.06..+0.06), victim-side face at z = 0.06; floor y <= 0, ceiling y >= 3.2.
  const world = new CollisionWorld();
  world.add({ min: [-4, 0, -0.06], max: [4, 3.2, 0.06] }, 'labb_glass');
  world.add({ min: [-4, -0.2, -4], max: [4, 0, 8] }, 'floor');
  world.add({ min: [-4, 3.2, -4], max: [4, 3.4, 8] }, 'ceiling');

  playThrough(g);
  const creature = g.npcs.actor('researcher_b_creature', false)!;
  assert.ok(creature.body.blade, 'Lab B creature wears the blade rig');
  assert.ok(g.npcs.kills.pounding('researcher_b_creature'), 'it starts pounding');

  // At each frame, the nearest point of either blade (wrist to tip) to the pane's face, and at the nearest frame how far
  // each blade points into the glass (1 = straight at it, a poke; 0 = upright along it, a bang).
  let minDistToPane = Infinity;
  let nearestWrist = Infinity;
  let pokeAtNearest = 1;
  let worstPen = 0;
  // The furthest any blade point gets past the pane's face (the clearance helper only sees points inside the pane).
  let worstThrough = 0;
  let blows = 0;
  const before = g.sounds.filter((x) => x === 'glassThud').length;
  g.step(8, () => {
    let near = Infinity;
    for (const s of ['L', 'R'] as const) {
      for (let k = 0; k <= 8; k++) {
        const ahead = creature.body.bladePoint(s, k / 8).z - 0.06;
        near = Math.min(near, Math.abs(ahead));
        worstThrough = Math.max(worstThrough, -ahead);
      }
    }
    if (near < minDistToPane) {
      minDistToPane = near;
      pokeAtNearest = Math.max(...(['L', 'R'] as const).map((s) => Math.abs(creature.body.bladePoint(s, 1).sub(creature.body.bladePoint(s, 0)).normalize().z)));
    }
    for (const s of ['L', 'R'] as const) nearestWrist = Math.min(nearestWrist, Math.abs(creature.body.bladePoint(s, 0).z - 0.06));
    const pen = measureBladePenetration(creature.body, world);
    worstPen = Math.max(worstPen, pen.depth);
  });
  blows = g.sounds.filter((x) => x === 'glassThud').length - before;
  assert.ok(blows >= 3, `creature landed ${blows} glass blows`);
  assert.ok(minDistToPane <= 0.1, `nearest blade point reached ${minDistToPane.toFixed(3)} m from the pane (limit 0.10 m)`);
  assert.ok(nearestWrist <= 0.1, `wrists reached ${nearestWrist.toFixed(3)} m from the pane (limit 0.10 m): the forearms bang on it`);
  assert.ok(pokeAtNearest < 0.5, `at the blow the blades point ${pokeAtNearest.toFixed(2)} into the glass (upright along it is 0, a poke is 1)`);
  assert.ok(worstPen <= 0.05, `blade penetration ${worstPen.toFixed(3)} m exceeded 0.05 m during pounding`);
  assert.ok(worstThrough <= 0.05, `a blade point got ${worstThrough.toFixed(3)} m past the pane's face (limit 0.05 m)`);
});

test('medbay-attack "The blade goes through her" & "It screams over her body" & "Then it leaves" (rig-necromorph task 7.4)', async () => {
  const a = LEVEL_ANCHORS;
  const g = mauledSetup({}, { marks: a, priya: a['priya_sit']!, thing: a['r08_lurk']!, jay: a['r07_glass_jay']!, bodyModels: creatureLib(await necromorphModel()) });
  void g.npcs.command('kill', R08_KILL);
  const priya = g.npcs.actor('priya')!;
  const thing = g.npcs.actor('r08_thing')!;
  assert.ok(thing.body.blade, 'R08 attacker wears the blade rig');

  let bestChestToBlade = Infinity;
  let tipPastBack = false;
  let sawScreamPeak = false;
  let screamStoppedBeforeWalk = false;
  let stillStart = -1;
  let walkStart = -1;
  let prevThing = thing.position.clone();
  const slamFacesOk: boolean[] = [];
  let slamCount = 0;
  const seg = new THREE.Line3();
  const closest = new THREE.Vector3();

  const worstStep = largestStep(g, 36, () => {
    const b = g.beat();
    if (b === 'impale' || b === 'carry') {
      const root = thing.body.bladePoint('R', 0);
      const tip = thing.body.bladePoint('R', 1);
      const chest = priya.body.jointWorld('chest', new THREE.Vector3());
      seg.set(root, tip);
      seg.closestPointToPoint(chest, true, closest);
      bestChestToBlade = Math.min(bestChestToBlade, chest.distanceTo(closest));
      // Blade runs from root through chest and tip extends beyond her back (further from root than chest).
      if (tip.distanceTo(root) > chest.distanceTo(root) + 0.12 && chest.distanceTo(closest) <= 0.1) tipPastBack = true;
    }
    const impacts = g.emitted.filter((e) => e.name === 'kill:impact').length;
    if (impacts > slamCount) {
      slamCount = impacts;
      // Both faces angled toward Jay's glass (medbay_c_glass sits at smaller Z than the cart/actors).
      const pane = a['medbay_c_glass']!;
      const toGlass = new THREE.Vector2(pane.x - thing.position.x, pane.z - thing.position.z).normalize();
      const thingFwd = new THREE.Vector2(-Math.sin(thing.body.heading), -Math.cos(thing.body.heading));
      const priyaFwd = new THREE.Vector2(-Math.sin(priya.body.heading), -Math.cos(priya.body.heading));
      slamFacesOk.push(thingFwd.dot(toGlass) > 0 && priyaFwd.dot(toGlass) > 0);
    }
    if (b === 'still') {
      if (stillStart < 0) stillStart = g.time();
      const dtStill = g.time() - stillStart;
      if (dtStill > 1.2 && dtStill < 3.2 && thing.body.performancePlaying) {
        const tipL = thing.body.bladePoint('L', 1);
        const tipR = thing.body.bladePoint('R', 1);
        const shL = thing.body.jointWorld('upperArm_L', new THREE.Vector3());
        const shR = thing.body.jointWorld('upperArm_R', new THREE.Vector3());
        const jawQ = thing.body.bones.jaw.quaternion;
        const jawDeg = THREE.MathUtils.radToDeg(2 * Math.acos(THREE.MathUtils.clamp(Math.abs(jawQ.w), 0, 1)));
        if (tipL.y > shL.y && tipR.y > shR.y && jawDeg >= 30) sawScreamPeak = true;
      }
      if (dtStill >= 3.45 && walkStart < 0 && thing.position.distanceTo(prevThing) > 0.01) {
        walkStart = dtStill;
        screamStoppedBeforeWalk = !thing.body.performancePlaying;
      }
    }
    prevThing = thing.position.clone();
  });

  assert.ok(bestChestToBlade <= 0.1, `Priya's chest was ${bestChestToBlade.toFixed(3)} m from the blade (limit 0.10 m)`);
  assert.ok(tipPastBack, 'blade tip extended beyond Priya\'s back while held');
  assert.ok(sawScreamPeak, 'creature reared with blades above shoulders and jaw >= 30 deg after throwing Priya');
  assert.ok(walkStart >= 3.3 && walkStart <= 4.2, `creature walked back at ${walkStart.toFixed(2)} s into still (expected ~3.4 s)`);
  assert.ok(screamStoppedBeforeWalk, 'scream ended cleanly before walking back to surgery');
  assert.ok(worstStep <= 0.3, `largest step ${worstStep.toFixed(3)} m exceeded 0.30 m`);
  assert.equal(slamFacesOk.length, 3, 'all 3 cart slams landed');
  assert.ok(slamFacesOk.every(Boolean), 'creature faced toward the glass on each slam');
});

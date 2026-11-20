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

/** The Lab B kill on a procedural Voss (no imported models in Node): glass at z = 0, she starts 4.7 m behind it. */
function setup() {
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
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore },
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
  assert.equal(g.npcs.kills.pounding('researcher_b_creature'), false, 'gone once the contact scene takes it');
});

test('a restored kill has the creature pounding at once', () => {
  const g = setup();
  void g.npcs.command('kill', { ...KILL, instant: true });
  assert.ok(g.npcs.kills.pounding('researcher_b_creature'));
});

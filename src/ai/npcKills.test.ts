import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { posesJson } from '../data/poseFiles.ts';
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
import { readLevel } from '../data/levels/readLevel.ts';
import { SAMPLE_URLS } from '../audio/sounds.ts';
import { existsSync } from 'node:fs';
import vossPack from '../data/cast/voss/mocap.json' with { type: 'json' };
import { sharedMocapLibrary, type RawMocapFile } from '../actors/mocap.ts';
import { ANKLE_CLEARANCE, OVERSTRETCH_RELEASE_S } from '../actors/footIk.ts';
import type { FootstepEvent } from '../actors/humanoid.ts';
import { loadMainCast, makeLib, type MainCastModel } from '../actors/castModelTestKit.ts';

/**
 * Lab B's anchors from slice01 (her route and contact marks), moved so the gallery glass (`labb_glass`) is at the origin:
 * the pane at z = 0, Lab B toward +z. She waits at `labb_victim`, 4.5 m behind the glass.
 */
const LAB_B: Record<string, Spot> = (() => {
  const all = (readLevel('slice01') as { rooms: Array<{ anchors?: Array<{ id: string; pos: number[] }> }> }).rooms.flatMap((r) => r.anchors ?? []);
  const glass = all.find((a) => a.id === 'labb_glass')!.pos;
  return Object.fromEntries(all.map((a) => [a.id, { x: a.pos[0]! - glass[0]!, y: a.pos[1]!, z: a.pos[2]! - glass[2]! }]));
})();

/** The Lab B kill on Voss (optional bodyModels for real blade creature), on Lab B's anchors with the glass at z = 0. */
function setup(opts: { bodyModels?: BodyModelLibrary; fps?: number; kills?: unknown; playerHead?: THREE.Vector3 } = {}) {
  const fps = opts.fps ?? 60;
  /** Every sound and gore call, with when it came. */
  const fired: Array<{ name: string; at: number }> = [];
  const goreCalls: Array<{ kind: string; at?: THREE.Vector3; size?: number; band?: { min: number; max: number } }> = [];
  const goreCall = (c: (typeof goreCalls)[number]): void => {
    goreCalls.push(c);
    fired.push({ name: `gore ${c.kind}`, at: now });
  };
  const gore = {
    // A tight burst (spread under 1) is blood she coughs up.
    burst: (at: THREE.Vector3, _dir: unknown, _count?: number, _dark?: boolean, _clip?: unknown, spread = 1) =>
      goreCall({ kind: spread < 1 ? 'cough' : 'burst', at: at.clone() }),
    chunks: () => goreCall({ kind: 'chunks' }),
    pool: () => goreCall({ kind: 'pool' }),
    spurt: () => goreCall({ kind: 'spurt' }),
    glassMark: (at: THREE.Vector3, _n: THREE.Vector3, kind: string, size: number, opts: { band?: { min: number; max: number } }) =>
      goreCall({ kind: `glass:${kind}`, at: at.clone(), size, ...(opts.band ? { band: opts.band } : {}) }),
  } as unknown as GoreSystem;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const emitted: Array<{ name: string; at: number; payload?: unknown }> = [];
  const sounds: string[] = [];
  const warnings: string[] = [];
  let now = 0;
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore, ...(opts.bodyModels ? { bodyModels: opts.bodyModels } : {}) },
    nav: null,
    colliders: null,
    player: () => {
      const head = opts.playerHead ?? new THREE.Vector3(0, 1.62, -3);
      return { feet: head.clone().setY(0), head: head.clone() };
    },
    emit: (name, payload) => {
      emitted.push({ name, at: now, payload });
      for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
    },
    listen: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    sfx: (ids) => {
      fired.push({ name: `sfx ${ids[0]}`, at: now });
      const id = ids.find((i) => ['fleshTear', 'glassThud', 'drip', 'zombieVoice'].includes(i));
      if (id) sounds.push(id);
      return id !== undefined;
    },
    warn: (m) => warnings.push(m),
    kills: validate(validateKillTable, opts.kills ?? killsJson, 'kills'),
  });
  npcs.setResolver((ref) => {
    const a = LAB_B[String(ref).replace(/^anchor:/, '')];
    return { pos: a ?? { x: 0, y: 1.5, z: 0 } };
  });
  npcs.spawnFromLevel([{ id: 'researcher_b', look: 'voss', pos: LAB_B['labb_victim']!, yaw: 0, pose: 'typing', transformable: true }]);
  const camera = new THREE.Vector3(0, 1.62, -3);
  const step = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      now += 1 / fps;
      npcs.update(1 / fps, camera);
      each?.();
    }
  };
  const say = (id: string): void => {
    for (const fn of [...(handlers.get('speech:ended') ?? [])]) fn({ id, speaker: 'crew_lab' });
  };
  const beatAt = (b: string): number => emitted.find((e) => e.name === `kill:${b}`)?.at ?? -1;
  return { npcs, goreCalls, emitted, fired, sounds, warnings, step, say, beatAt, time: () => now };
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
  g.step(6.6, watchHands);
  assert.ok(g.beatAt('glass') > 0, 'she reached the glass');
  assert.ok(Math.abs(voss.position.z - 0.71) < 0.35, `she stands at the glass (z ${voss.position.z.toFixed(2)})`);
  g.step(3.7, watchHands);
  assert.ok(Math.abs(g.beatAt('arch') - g.beatAt('glass') - 3.6) < 0.05, 'the arch starts when the glass beat has run its length, with the scream still sounding');
  g.say('drop_voss_02');
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

// ------------------------------------------------------------------ the fixed clock (voss-death-scene, infection-kills)

/**
 * One Lab B kill whose question ends `asked` s in, played at `fps`; the scream ends 5 s after the glass beat starts, or
 * never. Every beat start from panic to the end of still, and every sound, gore call and stinger in that time, in seconds
 * on the kill's clock: from the frame the question's end reaches the kill, where panic begins.
 */
function onTheClock(opts: { asked: number; fps?: number; scream?: boolean }) {
  const g = setup(opts.fps !== undefined ? { fps: opts.fps } : {});
  void g.npcs.command('kill', KILL);
  g.step(opts.asked);
  const asked = g.time();
  g.say('drop_voss_01');
  let screamed = false;
  g.step(16, () => {
    if (opts.scream === false || screamed || g.beatAt('glass') < 0 || g.time() - g.beatAt('glass') < 5) return;
    screamed = true;
    g.say('drop_voss_02');
  });
  const start = g.beatAt('panic');
  assert.ok(start > asked && start - asked <= 1 / (opts.fps ?? 60) + 1e-6, `panic begins on the frame after the question (${(start - asked).toFixed(3)} s)`);
  const end = g.beatAt('creature');
  assert.ok(end > 0, 'the still beat ended');
  const beats = ['panic', 'glass', 'arch', 'burst', 'still', 'creature'].map((b) => ({ name: b, at: g.beatAt(b) - start }));
  const events = [...g.fired, ...g.emitted.filter((e) => e.name === 'score:stinger')]
    .filter((e) => e.at > start - 1e-6 && e.at < end - 1e-6)
    .map((e) => ({ name: e.name, at: e.at - start }));
  return { beats, events };
}

/** The same things, each within one frame of `fps` (the slower run). */
function sameTimes(a: ReturnType<typeof onTheClock>, b: ReturnType<typeof onTheClock>, fps: number): void {
  for (const key of ['beats', 'events'] as const) {
    // By name, so two events a frame apart in one run and in the same frame in the other still pair up.
    const byName = (list: typeof a.beats): typeof a.beats => [...list].sort((p, q) => p.name.localeCompare(q.name) || p.at - q.at);
    const [x, y] = [byName(a[key]), byName(b[key])];
    assert.deepEqual(x.map((e) => e.name), y.map((e) => e.name), key);
    x.forEach((e, i) => assert.ok(Math.abs(e.at - y[i]!.at) <= 1 / fps + 1e-6, `${e.name} at ${e.at.toFixed(3)} s and ${y[i]!.at.toFixed(3)} s`));
  }
}

test('Fixed clock: each beat from panic on starts its set time after the question, about 13 s to the end of still', () => {
  const r = onTheClock({ asked: 3 });
  const due: Record<string, number> = { panic: 0, glass: 6.5, arch: 10.1, burst: 12.5, still: 13.1, creature: 14.9 };
  for (const b of r.beats) assert.ok(Math.abs(b.at - due[b.name]!) < 2 / 60, `${b.name} at ${b.at.toFixed(3)} s`);
  for (const name of ['sfx palm_glass_hit', 'sfx kill_burst', 'gore glass:print', 'gore burst', 'score:stinger']) {
    assert.ok(r.events.some((e) => e.name === name), `${name} is among the timed events`);
  }
});

test('Different arrivals: the question ending at 3 s or at 12 s gives the same beats and events, to the frame', () => {
  sameTimes(onTheClock({ asked: 3 }), onTheClock({ asked: 12 }), 60);
});

test('Different frame rates: 30 fps and 144 fps give the same beats and events, to a frame of the slower', () => {
  sameTimes(onTheClock({ asked: 3, fps: 30 }), onTheClock({ asked: 3, fps: 144 }), 30);
});

test('Scream missing: the arch, burst and still beats start when they do with it', () => {
  sameTimes(onTheClock({ asked: 3 }), onTheClock({ asked: 3, scream: false }), 60);
});

/** Her run's designed sounds and her voice (voss-death-scene D10), each at its time on the kill's clock (s). */
const RUN_SOUNDS: Record<string, number[]> = {
  voss_gasp: [0, 4.25, 5.8],
  body_bench_hit: [0.4],
  bench_sweep: [0.55],
  voss_grunt: [0.9, 2, 3.3],
  voss_cough: [1.15, 1.58, 3.65, 3.98],
  voss_scuff: [2.15, 4.4, 5.55],
  knee_floor: [3.3],
  cart_crash: [6.2],
  palm_glass_hit: [6.9, 7.3, 7.7, 8.1],
};

test('Designed sounds and her voice: each fires at its time from the end of the question, by its own name with no stand-in, and has its recordings', () => {
  const heard = onTheClock({ asked: 3 }).events;
  for (const [id, times] of Object.entries(RUN_SOUNDS)) {
    const at = heard.filter((e) => e.name === `sfx ${id}`).map((e) => e.at).sort((a, b) => a - b);
    assert.equal(at.length, times.length, `${id} fires ${times.length} times (${at.map((t) => t.toFixed(2)).join(', ')})`);
    times.forEach((t, i) => assert.ok(Math.abs(at[i]! - t) <= 2 / 60, `${id} at ${t} s (${at[i]!.toFixed(3)})`));
    const files = [(SAMPLE_URLS as Record<string, string | readonly string[]>)[id] ?? []].flat();
    assert.ok(files.length > 0, `${id} is registered`);
    for (const f of files) assert.ok(existsSync(new URL(`../../public/${f}`, import.meta.url)), `${f} is there`);
  }
  // Nothing in the run or at the glass names a second sound to fall back on.
  for (const beat of killsJson.grownInside.beats.filter((b) => b.id === 'panic' || b.id === 'glass')) {
    for (const e of beat.events ?? []) {
      if (e.do !== 'sfx') continue;
      const ids = (e as { id: string[] }).id;
      assert.ok(ids.length === 1 && ids[0]! in RUN_SOUNDS, `${beat.id} at ${e.t} s plays ${ids.join(' or ')}`);
    }
  }
});

// ------------------------------------------------------------------ waiting for the question (voss-death-scene D6, gallery-drop)

/** Lab B with the scratch beat's layer holding still on its first pose (the same arms, without the scratching). */
function withoutScratching(): unknown {
  const k = structuredClone(killsJson) as unknown as { grownInside: { beats: Array<Record<string, unknown>> } };
  const layer = k.grownInside.beats.find((b) => b.id === 'scratch')!['layer'] as { poses: string[] };
  layer.poses = [layer.poses[0]!];
  return k;
}

/** Her joints every frame of `seconds` of the wait, from `from` s into it (60 fps). */
function waitTrack(opts: { kills?: unknown; playerHead?: THREE.Vector3; from?: number; seconds: number; bodyModels?: BodyModelLibrary; each?: (voss: ReturnType<ReturnType<typeof setup>['npcs']['actor']> & object) => void }) {
  const g = setup({ ...(opts.kills ? { kills: opts.kills } : {}), ...(opts.playerHead ? { playerHead: opts.playerHead } : {}), ...(opts.bodyModels ? { bodyModels: opts.bodyModels } : {}) });
  const voss = g.npcs.actor('researcher_b')!;
  void g.npcs.command('kill', KILL);
  g.step(opts.from ?? 0);
  const frames: Array<Record<'head' | 'pelvis' | 'hand_R' | 'hand_L' | 'chest', THREE.Vector3> & { ahead: THREE.Vector3; pitch: number }> = [];
  g.step(opts.seconds, () => {
    voss.body.group.updateMatrixWorld(true);
    const j = (n: JointName): THREE.Vector3 => voss.body.jointWorld(n, new THREE.Vector3());
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(voss.body.bones.head.getWorldQuaternion(new THREE.Quaternion()));
    const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(look.y, -1, 1)));
    frames.push({ head: j('head'), pelvis: j('pelvis'), hand_R: j('hand_R'), hand_L: j('hand_L'), chest: j('chest'), ahead: look.setY(0).normalize(), pitch });
    opts.each?.(voss);
  });
  assert.equal(g.npcs.kills.running('researcher_b')?.beatId, 'scratch', 'still waiting for the question');
  return { g, voss, frames };
}

test('Only her hands are fast: her scratching hand goes back and forth 3+ times a second; head and hips under 0.3 m/s, untouched by it', () => {
  const { frames, g } = waitTrack({ from: 1, seconds: 6 });
  // The scratching hand, against her own chest: its main line of motion, and how often it turns back along it.
  const rel = frames.map((f) => f.hand_R.clone().sub(f.chest));
  const mean = rel.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(rel.length);
  let axis = new THREE.Vector3(1, 1, 1).normalize();
  for (let k = 0; k < 20; k++) {
    const next = new THREE.Vector3();
    for (const v of rel) {
      const d = v.clone().sub(mean);
      next.addScaledVector(d, d.dot(axis));
    }
    axis = next.normalize();
  }
  const x = rel.map((v) => v.clone().sub(mean).dot(axis));
  // Turns back: coming 1.5 cm back from the furthest point since the last turn.
  let turns = 0;
  let dir = 0;
  let hi = x[0]!;
  let lo = x[0]!;
  for (const v of x) {
    hi = Math.max(hi, v);
    lo = Math.min(lo, v);
    if (dir !== -1 && hi - v > 0.015) {
      if (dir === 1) turns++;
      dir = -1;
      lo = v;
    } else if (dir !== 1 && v - lo > 0.015) {
      if (dir === -1) turns++;
      dir = 1;
      hi = v;
    }
  }
  const hz = turns / 2 / 6;
  const swing = Math.max(...x) - Math.min(...x);
  assert.ok(hz >= 3, `her hand scratches at ${hz.toFixed(2)} Hz`);
  assert.ok(swing > 0.05, `over ${(swing * 100).toFixed(1)} cm`);
  const fastest = (j: 'head' | 'pelvis'): number => Math.max(...frames.slice(1).map((f, i) => f[j].distanceTo(frames[i]![j]) * 60));
  assert.ok(fastest('head') <= 0.3, `head at most ${fastest('head').toFixed(2)} m/s`);
  assert.ok(fastest('pelvis') <= 0.3, `hips at most ${fastest('pelvis').toFixed(2)} m/s`);
  // Not jittering with the scratching: with her arms held still in the first pose, her head and hips go exactly the same way.
  const plain = waitTrack({ kills: withoutScratching(), from: 1, seconds: 6 }).frames;
  const off = Math.max(...frames.map((f, i) => Math.max(f.head.distanceTo(plain[i]!.head), f.pelvis.distanceTo(plain[i]!.pelvis))));
  assert.ok(off < 1e-6, `the scratching moves her head or hips by ${off} m`);
  // (No squad in this harness: her glances at Okafor and Giles find nobody and say so.)
  assert.deepEqual(g.warnings.filter((w) => !w.includes('no sound') && !w.includes('nobody to look at as "npc:')), [], 'no pose, clip or look problems');
});

test('She looks at them: in her first 4 s of waiting her head comes up off her arm to Jay behind the glass, then goes back down to it', () => {
  // Jay stands off to her left in the gallery, 25 degrees from where she faces.
  const jay = new THREE.Vector3(-3.2, 1.62, -2.2);
  const { frames, voss } = waitTrack({ playerHead: jay, seconds: 5 });
  // Resting on her arm just before the first glance (1.8 s).
  const rest = 100;
  const start = frames[rest]!.ahead;
  const toJay = (i: number): number => {
    const head = frames[i]!.head;
    const d = jay.clone().sub(head).setY(0).normalize();
    return THREE.MathUtils.radToDeg(frames[i]!.ahead.angleTo(d));
  };
  const first4 = frames.slice(0, 240).map((_, i) => i);
  const best = first4.reduce((b, i) => (toJay(i) < toJay(b) ? i : b), 0);
  const turned = THREE.MathUtils.radToDeg(start.angleTo(frames[best]!.ahead));
  assert.ok(toJay(best) < 8, `at best her head is ${toJay(best).toFixed(1)} deg off Jay (at ${(best / 60).toFixed(2)} s)`);
  assert.ok(turned > 12, `it turned ${turned.toFixed(1)} deg to him`);
  assert.ok(frames[best]!.pitch > frames[rest]!.pitch + 15, `her head came up to him (${frames[rest]!.pitch.toFixed(0)} to ${frames[best]!.pitch.toFixed(0)} deg)`);
  const last = frames[frames.length - 1]!;
  assert.ok(last.pitch < -25, `and goes back down to her arm after the glance (${last.pitch.toFixed(0)} deg)`);
  assert.ok(voss.body.lookTarget && voss.body.lookTarget.distanceTo(last.hand_L) < 0.05, 'watching her left wrist');
});

test('Watching her arm: between glances she looks down at the forearm she scratches', () => {
  const { frames, voss } = waitTrack({ seconds: 1.7 });
  // From 1.2 s (settled) to just before the first glance at 1.8 s. Her wrist is nearly under her face, so: head well
  // down, and her look on the wrist.
  for (const f of frames.slice(72)) assert.ok(f.pitch < -25, `her head points ${f.pitch.toFixed(0)} deg below level`);
  const last = frames[frames.length - 1]!;
  assert.ok(voss.body.lookTarget && voss.body.lookTarget.distanceTo(last.hand_L) < 0.05, 'her look is on her left wrist');
});

test('Scratching on her own body: her fingers stay on her forearm\'s skin from above, with both elbows at her sides (Voss\'s model)', async () => {
  const lib = makeLib({ office3: await loadMainCast('office_3') });
  let skin: { meshes: THREE.SkinnedMesh[]; fore: Array<[THREE.SkinnedMesh, number]>; hand: Array<[THREE.SkinnedMesh, number]> } | null = null;
  const gaps: number[] = [];
  const above: number[] = [];
  const elbows: number[] = [];
  let frame = 0;
  waitTrack({
    bodyModels: lib,
    from: 1,
    seconds: 3,
    each: (voss) => {
      if (frame++ % 6 !== 0) return;
      const b = voss.body;
      const under = (bone: THREE.Object3D, root: THREE.Object3D): boolean => {
        for (let o: THREE.Object3D | null = bone; o; o = o.parent) if (o === root) return true;
        return false;
      };
      if (!skin) {
        const meshes: THREE.SkinnedMesh[] = [];
        b.group.traverse((o) => void ((o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh)));
        // Skin vertices by the bone carrying most of their weight: her left forearm, and her right hand and fingers.
        const owned = (pred: (bone: THREE.Bone) => boolean): Array<[THREE.SkinnedMesh, number]> => {
          const out: Array<[THREE.SkinnedMesh, number]> = [];
          for (const m of meshes) {
            const si = m.geometry.getAttribute('skinIndex');
            const sw = m.geometry.getAttribute('skinWeight');
            for (let i = 0; si && sw && i < si.count; i += 2) {
              let best = 0;
              let bi = -1;
              for (let c = 0; c < 4; c++) if (sw.getComponent(i, c) > best) [best, bi] = [sw.getComponent(i, c), si.getComponent(i, c)];
              const bone = m.skeleton.bones[bi];
              if (bone && pred(bone)) out.push([m, i]);
            }
          }
          return out;
        };
        skin = {
          meshes,
          fore: owned((bone) => under(bone, b.bones.foreArm_L) && !under(bone, b.bones.hand_L)),
          hand: owned((bone) => under(bone, b.bones.hand_R)),
        };
      }
      for (const m of skin.meshes) m.skeleton.update();
      const at = ([m, i]: [THREE.SkinnedMesh, number]): THREE.Vector3 => m.localToWorld(m.getVertexPosition(i, new THREE.Vector3()));
      const fore = skin.fore.map(at);
      let gap = Infinity;
      for (const h of skin.hand.map(at)) for (const f of fore) gap = Math.min(gap, h.distanceTo(f));
      gaps.push(gap);
      // Her right wrist over her left forearm's line, and each elbow out from her middle (she faces -Z: her right is +X).
      const e = b.jointWorld('foreArm_L', new THREE.Vector3());
      const seg = b.jointWorld('hand_L', new THREE.Vector3()).sub(e);
      const w = b.jointWorld('hand_R', new THREE.Vector3()).sub(e);
      above.push(w.sub(seg.multiplyScalar(THREE.MathUtils.clamp(w.dot(seg) / seg.lengthSq(), 0, 1))).y);
      const mid = b.jointWorld('chest', new THREE.Vector3()).x;
      elbows.push(Math.min(mid - b.jointWorld('foreArm_L', new THREE.Vector3()).x, b.jointWorld('foreArm_R', new THREE.Vector3()).x - mid));
    },
  });
  // (Set inside the callback, which the compiler cannot see run.)
  const found = skin as { fore: unknown[]; hand: unknown[] } | null;
  assert.ok(found && found.fore.length > 50 && found.hand.length > 50, 'found her forearm and hand skin');
  assert.ok(Math.max(...gaps) < 0.015, `fingers within ${(Math.max(...gaps) * 100).toFixed(1)} cm of her forearm's skin at worst`);
  assert.ok(Math.min(...above) > 0.02, `her hand rests on top of the arm (wrist ${(Math.min(...above) * 100).toFixed(1)} cm over its line at least)`);
  assert.ok(Math.min(...elbows) > 0.08, `her elbows stay at her sides, at least ${(Math.min(...elbows) * 100).toFixed(1)} cm out from her middle`);
});

test('look: a glance at an NPC follows their head while it lasts; an unknown target warns and does nothing', () => {
  const beat = { id: 'wait', poses: ['idle'], convulse: 0, until: 'time', s: 3, max: 3, events: [{ t: 0.2, do: 'look', target: 'npc:watcher', hold: 1.5 }, { t: 2, do: 'look', target: 'npc:nobody' }] };
  const g = motionSetup({ beats: [beat] });
  g.npcs.spawnFromLevel([{ id: 'watcher', look: 'giles', pos: { x: -2.5, y: 0, z: -3 }, yaw: 0, pose: 'idle' }]);
  const watcher = g.npcs.actor('watcher')!;
  g.start();
  g.step(1.2);
  const target = g.actor.body.lookTarget;
  // (Read as her frame began; his body has moved on a little since.)
  assert.ok(target && target.distanceTo(watcher.body.jointWorld('head', new THREE.Vector3())) < 0.05, 'she looks at his head');
  watcher.place({ x: 2.5, y: 0, z: -3 }, 0);
  g.step(0.1);
  assert.ok(g.actor.body.lookTarget!.x > 2, 'and follows him when he moves');
  g.step(0.6);
  assert.equal(g.actor.body.lookTarget, null, 'the glance ends after its hold');
  g.step(0.5);
  assert.ok(g.warnings.some((w) => w.includes('nobody to look at as "npc:nobody"')), g.warnings.join('; '));
  assert.equal(g.actor.body.lookTarget, null);
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

test('the creature hammers on the glass from where it appears, until the level lets it out', () => {
  const g = setup();
  let spawn: THREE.Vector3 | null = null;
  let moved = 0;
  let firstBlow = -1;
  let blowsBeforeDone = 0;
  const watch = (): void => {
    const c = g.npcs.actor('researcher_b_creature', false);
    if (!c) return;
    spawn ??= c.position.clone();
    moved = Math.max(moved, c.position.distanceTo(spawn));
    const blows = g.sounds.filter((x) => x === 'glassThud').length;
    if (g.beatAt('done') < 0) blowsBeforeDone = blows;
    else if (firstBlow < 0 && blows > blowsBeforeDone) firstBlow = g.time();
  };
  playThrough(g, watch);
  assert.ok(g.npcs.kills.pounding('researcher_b_creature'), 'it is at the glass');
  const before = g.sounds.filter((x) => x === 'glassThud').length;
  g.step(8, watch);
  const creature = g.npcs.actor('researcher_b_creature', false)!;
  assert.equal(creature.body.state, 'alive', 'it finished getting up before the first blow');
  assert.ok(moved < 0.01, `it never takes a step (moved ${moved.toFixed(2)} m)`);
  assert.ok(Math.abs(creature.position.x) < 0.05, `square to where she stood at the pane (x ${creature.position.x.toFixed(2)})`);
  assert.ok(Math.abs(creature.position.z - 0.71) < 0.4, `it stands at the pane (z ${creature.position.z.toFixed(2)})`);
  const wait = firstBlow - g.beatAt('done');
  assert.ok(firstBlow > 0 && wait < 0.8, `the first blow lands as soon as it stands (${wait.toFixed(2)} s)`);
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
  const named = (id: string) => g.emitted.filter((e) => e.name === 'score:stinger' && (e.payload as { id: string }).id === id);
  const stingers = named('stab');
  const prints = g.goreCalls.filter((c) => c.kind === 'glass:print').length;
  assert.ok(prints >= 3, `${prints} palm hits`);
  assert.equal(stingers.length, prints, 'one stab per palm hit');
  const glass = g.beatAt('glass');
  for (const s of stingers) assert.ok(s.at >= glass && s.at < glass + 2, `stinger at ${s.at.toFixed(2)} is in the glass beat`);
  // voss-death-scene 4.7: a deep bass hit under each blow of her run (the bench, her knee, the cart), all before the glass.
  const hits = named('hit');
  assert.equal(hits.length, 3, 'a bass hit at the bench, her knee and the cart');
  for (const s of hits) assert.ok(s.at >= g.beatAt('panic') && s.at < glass, `bass hit at ${s.at.toFixed(2)} is in the run`);
  assert.equal(g.emitted.filter((e) => e.name === 'score:stinger').length, prints + hits.length, 'no other stingers');
});

test('she coughs up blood in the run: four tight sprays from her mouth, two over the bench and two on her knee (voss-death-scene 4.7)', () => {
  const g = setup();
  const voss = g.npcs.actor('researcher_b')!;
  void g.npcs.command('kill', KILL);
  g.step(2.5);
  g.say('drop_voss_01');
  const mouths: Array<{ at: THREE.Vector3; head: THREE.Vector3 }> = [];
  let seen = 0;
  g.step(6.6, () => {
    const coughs = g.goreCalls.filter((c) => c.kind === 'cough');
    for (; seen < coughs.length; seen++) mouths.push({ at: coughs[seen]!.at!, head: voss.body.jointWorld('head', new THREE.Vector3()) });
  });
  assert.equal(mouths.length, 4, 'four coughs');
  for (const m of mouths) assert.ok(m.at.distanceTo(m.head) < 0.15, `from her mouth (${m.at.distanceTo(m.head).toFixed(2)} m from her head)`);
  const coughAt = g.fired.filter((f) => f.name === 'gore cough').map((f) => f.at - g.beatAt('panic'));
  assert.ok(coughAt.slice(0, 2).every((t) => t > 0.9 && t < 1.95), `two over the bench (${coughAt.map((t) => t.toFixed(2)).join(', ')} s)`);
  assert.ok(coughAt.slice(2).every((t) => t > 3.3 && t < 4.35), 'two down on her knee');
});

test('each flurry on the glass reports one pound event, at its first blow', () => {
  const g = setup();
  playThrough(g);
  const thuds = (): number => g.sounds.filter((x) => x === 'glassThud').length;
  const events = (): number => g.emitted.filter((e) => e.name === 'creature:pound').length;
  const poundsBefore = events();
  // Count blows from the next flurry's start: one may already be under way.
  let blowsBefore = -1;
  g.step(10, () => {
    if (blowsBefore < 0 && events() > poundsBefore) blowsBefore = thuds();
  });
  const blows = thuds() - blowsBefore;
  const pounds = events() - poundsBefore;
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

const LEVEL_ANCHORS: Record<string, Spot> = Object.fromEntries(
  (readLevel('slice01') as { rooms: Array<{ anchors?: Array<{ id: string; pos: number[] }> }> }).rooms.flatMap((r) => (r.anchors ?? []).map((a) => [a.id, { x: a.pos[0]!, y: a.pos[1]!, z: a.pos[2]! }])),
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
  // R08's east wall is at x 6; the surgery door is centred on z 52 (D_R08_R08b in data/levels/slice01/doors.json).
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

// ------------------------------------------------------------------ routes, planted feet, footsteps, touches (voss-death-scene §2)

/**
 * A kill made only of the given beats, played on one victim (Voss, or `look`) standing at the origin facing -Z, with room
 * anchors at `anchors`. Her footsteps, the warnings and her joints are recorded; `fps` sets the frame rate.
 */
function motionSetup(opts: { beats: unknown[]; anchors?: Record<string, Spot>; look?: string; bodyModels?: BodyModelLibrary; fps?: number }) {
  const fps = opts.fps ?? 60;
  const anchors = opts.anchors ?? {};
  const warnings: string[] = [];
  const steps: Array<FootstepEvent & { at: number }> = [];
  let now = 0;
  const kills = validate(validateKillTable, { motion: { kind: 'grownInside', beats: opts.beats } }, 'kills');
  const npcs = new NpcDirector({
    ctx: {
      poses: new PoseLibrary(loadPoseFile(posesJson)),
      gore: { burst: () => undefined, chunks: () => undefined, pool: () => undefined, spurt: () => undefined, glassMark: () => undefined } as unknown as GoreSystem,
      onFootstep: (s) => void steps.push({ ...s, at: now }),
      ...(opts.bodyModels ? { bodyModels: opts.bodyModels } : {}),
    },
    nav: null,
    colliders: null,
    player: () => ({ feet: new THREE.Vector3(3, 0, 3), head: new THREE.Vector3(3, 1.62, 3) }),
    emit: () => undefined,
    listen: () => () => undefined,
    sfx: () => true,
    warn: (m) => warnings.push(m),
    kills,
  });
  npcs.setResolver((ref) => {
    const p = anchors[String(ref).replace(/^anchor:/, '')];
    return p ? { pos: p } : null;
  });
  npcs.spawnFromLevel([{ id: 'victim', look: opts.look ?? 'voss', pos: { x: 0, y: 0, z: 0 }, yaw: 0, pose: 'idle' }]);
  const actor = npcs.actor('victim')!;
  const camera = new THREE.Vector3(3, 1.62, 3);
  const step = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      now += 1 / fps;
      npcs.update(1 / fps, camera);
      each?.();
    }
  };
  const start = (instant = false): void => void npcs.command('kill', { npc: 'victim', kind: 'motion', ...(instant ? { instant: true } : {}) });
  const run = (): ReturnType<typeof npcs.kills.running> => npcs.kills.running('victim');
  const hips = (): THREE.Vector3 => actor.body.jointWorld('pelvis', new THREE.Vector3());
  return { npcs, actor, warnings, steps, step, start, run, hips, anchors, time: () => now };
}

// Voss's own clips (her pack is loaded with her body in the game; Node adds it here and holds it for the file).
sharedMocapLibrary().addPack('voss', vossPack as unknown as RawMocapFile);
sharedMocapLibrary().retainPack('voss');

/** Her walk take, laid end to end over `seconds` (a looping base clip is §3's; here each cycle is its own piece). */
function walkPieces(seconds: number, from = 0): Array<{ at: number; clip: string; blend: number }> {
  const cycle = sharedMocapLibrary().get('voss_walk').duration;
  const out: Array<{ at: number; clip: string; blend: number }> = [];
  for (let at = from; at < seconds - 1e-6; at += cycle) out.push({ at: Math.round(at * 1000) / 1000, clip: 'voss_walk', blend: 0.05 });
  return out;
}

const ROUTE_ANCHORS: Record<string, Spot> = { m1: { x: 0, y: 0, z: -2.4 }, m2: { x: -1.2, y: 0, z: -4.2 }, m3: { x: -1.5, y: 0, z: -5 }, look: { x: -4, y: 1.5, z: -5 } };
const ROUTE_MARKS = [{ mark: 'm1', t: 2 }, { mark: 'm2', t: 3.5 }, { mark: 'm3', t: 4.5, face: 'look' }];
const WAIT_BEAT = { id: 'wait', poses: ['idle'], convulse: 0, until: 'time', s: 0.5, max: 0.5 };
const END_BEAT = { id: 'end', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1 };
const routeBeat = (extra: Record<string, unknown> = {}) => ({ id: 'run', poses: ['idle'], convulse: 0, until: 'time', s: 5, max: 5, track: walkPieces(5), route: ROUTE_MARKS, ...extra });

/** Play the routed kill, sampling her hips every frame of the route beat (with the beat time). */
function playRoute(beat: Record<string, unknown>, opts: { fps?: number } = {}) {
  const g = motionSetup({ beats: [WAIT_BEAT, beat, END_BEAT], anchors: ROUTE_ANCHORS, ...opts });
  const samples: Array<{ t: number; hips: THREE.Vector3; origin: THREE.Vector3 }> = [];
  g.start();
  g.step(7, () => {
    const r = g.run();
    if (r?.beatId === 'run') samples.push({ t: r.beatTime, hips: g.hips(), origin: g.actor.position.clone() });
  });
  return { g, samples };
}

const across = (a: THREE.Vector3, b: Spot): number => Math.hypot(a.x - b.x, a.z - b.z);

test('infection-kills "On her marks": a route beat has her hips within 0.1 m of each mark, across the floor, at its time', () => {
  const { samples, g } = playRoute(routeBeat());
  for (const m of ROUTE_MARKS) {
    const s = samples.reduce((best, x) => (Math.abs(x.t - m.t) < Math.abs(best.t - m.t) ? x : best));
    const off = across(s.hips, ROUTE_ANCHORS[m.mark]!);
    assert.ok(off < 0.1, `${m.mark} at ${m.t} s: hips ${off.toFixed(3)} m off`);
  }
  assert.ok(g.warnings.every((w) => !w.includes('route leg')), g.warnings.join('; '));
});

test('infection-kills "A route beat moves her": playing a clip, she travels the route instead of staying where the beat began', () => {
  const routed = playRoute(routeBeat());
  const still = playRoute(routeBeat({ route: undefined }));
  assert.ok(across(routed.g.actor.position, ROUTE_ANCHORS['m3']!) < 0.05, 'she ends on the last mark');
  assert.ok(across(still.g.actor.position, { x: 0, y: 0, z: 0 }) < 0.05, 'without a route the clip plays where she stands');
});

test('infection-kills "No snap": every frame of a route beat she moves at most 0.15 m at 60 fps, hips and feet', () => {
  const { samples } = playRoute(routeBeat());
  let most = 0;
  for (let i = 1; i < samples.length; i++) most = Math.max(most, samples[i]!.hips.distanceTo(samples[i - 1]!.hips), samples[i]!.origin.distanceTo(samples[i - 1]!.origin));
  assert.ok(samples.length > 250, `${samples.length} frames sampled`);
  assert.ok(most <= 0.15, `largest step ${most.toFixed(3)} m`);
});

test('infection-kills "Clip missing": she still travels the route on time with the beat\'s poses, and one warning is logged', () => {
  const { samples, g } = playRoute(routeBeat({ track: [{ at: 0, clip: 'voss_no_such_take' }, { at: 2.5, clip: 'voss_no_such_take' }] }));
  for (const m of ROUTE_MARKS) {
    const s = samples.reduce((best, x) => (Math.abs(x.t - m.t) < Math.abs(best.t - m.t) ? x : best));
    assert.ok(across(s.hips, ROUTE_ANCHORS[m.mark]!) < 0.1, `${m.mark} at ${m.t} s`);
  }
  assert.equal(g.warnings.filter((w) => w.includes('no clip')).length, 1, g.warnings.join('; '));
});

test('a route turns her the way she goes, and to a mark\'s facing as she arrives', () => {
  const { g } = playRoute(routeBeat());
  const look = ROUTE_ANCHORS['look']!;
  const p = g.actor.position;
  const want = Math.atan2(-(look.x - p.x), -(look.z - p.z));
  const h = g.actor.body.heading;
  assert.ok(Math.abs(Math.atan2(Math.sin(want - h), Math.cos(want - h))) < 0.1, `faces the "look" mark (${h.toFixed(2)} vs ${want.toFixed(2)})`);
});

test('a skipped or restored kill puts her at the last mark of its last route beat', () => {
  const g = motionSetup({ beats: [WAIT_BEAT, routeBeat(), END_BEAT], anchors: ROUTE_ANCHORS });
  g.start(true);
  g.step(0.1);
  assert.ok(across(g.actor.position, ROUTE_ANCHORS['m3']!) < 1e-6, `at ${g.actor.position.x.toFixed(2)}, ${g.actor.position.z.toFixed(2)}`);
  assert.equal(g.steps.length, 0, 'and no footsteps');
});

test('Route speed check: a leg more than 35% off its clip\'s own speed warns once; within range it is silent', () => {
  // Her walk goes about 1.16 m/s. 2.4 m in 2.5 s (a 1.14 m/s cruise) is within range; 2.4 m in 0.8 s is not.
  const ok = playRoute(routeBeat({ route: [{ mark: 'm1', t: 2.5 }] }));
  assert.equal(ok.g.warnings.filter((w) => w.includes('route leg')).length, 0, ok.g.warnings.join('; '));
  const fast = playRoute(routeBeat({ route: [{ mark: 'm1', t: 0.8 }] }));
  const warned = fast.g.warnings.filter((w) => w.includes('route leg'));
  assert.equal(warned.length, 1, warned.join('; '));
  assert.match(warned[0]!, /"run" route leg to "m1" goes \d+\.\d\d m\/s, \d+% off its clip "voss_walk" \(1\.\d\d m\/s\)/);
});

test('infection-kills "Planted foot": while a foot is down on the run it moves under 3 cm until it lifts, its sole within 2 cm of the floor', () => {
  const g = motionSetup({ beats: [WAIT_BEAT, routeBeat({ route: [{ mark: 'm1', t: 2.5 }] }), END_BEAT], anchors: ROUTE_ANCHORS });
  const body = g.actor.body;
  const ankle = ANKLE_CLEARANCE * (body as unknown as { geo: { scale: { y: number } } }).geo.scale.y;
  const plant: Array<THREE.Vector3 | null> = [null, null];
  const down = [false, false];
  const lastW = [0, 0];
  let drift = 0;
  let sole = 0;
  let stances = 0;
  let fastest = 0;
  g.start();
  g.step(3, () => {
    const r = g.run();
    if (r?.beatId !== 'run' || r.beatTime < 0.3 || r.beatTime > 1.9) return;
    (['L', 'R'] as const).forEach((s, i) => {
      const c = body.killFootContacts[i]!;
      const w = body.footLockWeight(s);
      const at = body.jointWorld(`foot_${s}`, new THREE.Vector3());
      // A stance: from the frame its lock is full until it lifts (its contact falls under 0.5), or its leg, reaching
      // full stretch as the heel comes up, starts letting it go.
      if (!down[i] && c >= 0.5 && w > 0.999) {
        down[i] = true;
        plant[i] = at.clone();
        stances++;
      } else if (down[i] && (c < 0.5 || w < 0.999)) down[i] = false;
      if (down[i] && plant[i]) {
        drift = Math.max(drift, across(at, plant[i]!));
        sole = Math.max(sole, Math.abs(at.y - ankle));
      }
      // Letting go while still in contact takes at least OVERSTRETCH_RELEASE_S: never a pop.
      if (c >= 0.5) fastest = Math.max(fastest, lastW[i]! - w);
      lastW[i] = w;
    });
  });
  assert.ok(stances >= 2, `${stances} stances measured`);
  assert.ok(drift < 0.03, `a planted foot moved ${drift.toFixed(3)} m`);
  assert.ok(sole < 0.02, `a planted sole was ${sole.toFixed(3)} m off the floor`);
  assert.ok(fastest <= 1 / 60 / OVERSTRETCH_RELEASE_S + 1e-6, `a lock let go by ${fastest.toFixed(3)} in one frame`);
});
test('infection-kills "Footsteps heard": one footstep per landing on the run, at the landing frame, from the landing foot', () => {
  const g = motionSetup({ beats: [WAIT_BEAT, routeBeat({ route: [{ mark: 'm1', t: 2.5 }] }), END_BEAT], anchors: ROUTE_ANCHORS });
  const body = g.actor.body;
  const landings: Array<{ side: 'L' | 'R'; at: number; foot: THREE.Vector3 }> = [];
  const was = [true, true];
  g.start();
  g.step(3, () => {
    if (!body.killFeetOn) return;
    (['L', 'R'] as const).forEach((s, i) => {
      const c = body.killFootContacts[i]!;
      if (!was[i] && c >= 0.58) landings.push({ side: s, at: g.time(), foot: body.jointWorld(`foot_${s}`, new THREE.Vector3()) });
      if (c >= 0.58) was[i] = true;
      else if (c < 0.42) was[i] = false;
    });
  });
  assert.ok(landings.length >= 3, `${landings.length} landings`);
  assert.equal(g.steps.length, landings.length, 'a footstep for each landing, no more');
  g.steps.forEach((s, i) => {
    const l = landings[i]!;
    assert.equal(s.side, l.side);
    assert.ok(Math.abs(s.at - l.at) < 1e-9, `step ${i} on its landing frame`);
    assert.ok(Math.hypot(s.x - l.foot.x, s.z - l.foot.z) < 0.03 && Math.abs(s.y - 0.05) < 1e-6, `step ${i} from that foot, on the floor`);
    assert.equal(s.actor, body.spec.seed, 'through the NPC footstep path, as hers');
  });
});

test('beats with no route are unchanged: no foot lock and no footsteps through a clip played where she stands', () => {
  const g = motionSetup({ beats: [WAIT_BEAT, routeBeat({ route: undefined }), END_BEAT], anchors: ROUTE_ANCHORS });
  let on = false;
  g.start();
  g.step(6.5, () => void (on ||= g.actor.body.killFeetOn));
  assert.equal(on, false);
  assert.equal(g.steps.length, 0);
});

// voss-death-scene D4: `touch` puts a hand, a hip, a knee or the chest on a mark, on Voss's body and on a second woman's.
const TOUCHES: Array<{ part: 'hand_R' | 'hand_L' | 'hip_L' | 'knee_R' | 'chest'; joint: JointName; off: [number, number, number] }> = [
  { part: 'hand_R', joint: 'hand_R', off: [0.05, 0.25, -0.25] },
  { part: 'hand_L', joint: 'hand_L', off: [-0.05, 0.2, -0.22] },
  { part: 'hip_L', joint: 'thigh_L', off: [-0.06, 0, -0.05] },
  { part: 'knee_R', joint: 'shin_R', off: [0, -0.12, -0.15] },
  { part: 'chest', joint: 'chest', off: [0, -0.05, -0.12] },
];
const TOUCH_AT = 0.2;
const TOUCH_EVERY = 1.4;
const TOUCH_BLEND = 0.4;
const TOUCH_HOLD = 0.4;

async function touchRun(look: string, model: MainCastModel, key: string) {
  const g = motionSetup({
    look,
    bodyModels: makeLib({ [key]: await loadMainCast(model) }),
    beats: [
      { id: 'wait', poses: ['idle'], convulse: 0, until: 'time', s: 1, max: 1 },
      {
        id: 'touch', poses: ['idle'], convulse: 0, until: 'time', s: 7.4, max: 7.4,
        events: TOUCHES.map((tc, i) => ({ t: TOUCH_AT + i * TOUCH_EVERY, do: 'touch', part: tc.part, mark: `touch_${tc.part}`, blend: TOUCH_BLEND, hold: TOUCH_HOLD })),
      },
      END_BEAT,
    ],
  });
  g.start();
  // The pose as it stands before any touch: each mark is a reach away from its part.
  g.step(0.9);
  const rest = new Map<string, THREE.Vector3>();
  for (const tc of TOUCHES) {
    const p = g.actor.body.jointWorld(tc.joint, new THREE.Vector3());
    rest.set(tc.part, p.clone());
    g.anchors[`touch_${tc.part}`] = { x: p.x + tc.off[0], y: p.y + tc.off[1], z: p.z + tc.off[2] };
  }
  const result = TOUCHES.map(() => ({ worstHold: 0, worstStep: 0, back: 0 }));
  const last = TOUCHES.map((tc) => g.actor.body.jointWorld(tc.joint, new THREE.Vector3()));
  g.step(8, () => {
    const r = g.run();
    if (r?.beatId !== 'touch') return;
    TOUCHES.forEach((tc, i) => {
      const at = g.actor.body.jointWorld(tc.joint, new THREE.Vector3());
      const t = r.beatTime - (TOUCH_AT + i * TOUCH_EVERY);
      const res = result[i]!;
      const mark = g.anchors[`touch_${tc.part}`]!;
      if (t > TOUCH_BLEND + 2 / 60 && t < TOUCH_BLEND + TOUCH_HOLD) res.worstHold = Math.max(res.worstHold, at.distanceTo(new THREE.Vector3(mark.x, mark.y, mark.z)));
      if (t > -0.05 && t < 2 * TOUCH_BLEND + TOUCH_HOLD + 0.05) res.worstStep = Math.max(res.worstStep, at.distanceTo(last[i]!));
      if (t > 2 * TOUCH_BLEND + TOUCH_HOLD + 0.1 && t < TOUCH_EVERY - 0.05) res.back = Math.max(res.back, at.distanceTo(rest.get(tc.part)!));
      last[i]!.copy(at);
    });
  });
  return { result, warnings: g.warnings };
}

for (const [label, look, model, key] of [['Voss', 'voss', 'office_3', 'office3'], ['Priya', 'priya', 'priya', 'priya']] as const) {
  test(`Touch on ${label}'s body: each hand, hip, knee and the chest is within 5 cm of its mark while held, and lets go with no pop`, async () => {
    const { result, warnings } = await touchRun(look, model, key);
    TOUCHES.forEach((tc, i) => {
      const r = result[i]!;
      assert.ok(r.worstHold < 0.05, `${tc.part}: ${r.worstHold.toFixed(3)} m from its mark while held`);
      assert.ok(r.worstStep < 0.03, `${tc.part}: moved ${r.worstStep.toFixed(3)} m in one frame going on or off`);
      assert.ok(r.back < 0.01, `${tc.part}: back in her pose after (${r.back.toFixed(3)} m)`);
    });
    assert.ok(warnings.every((w) => !w.includes('touch')), warnings.join('; '));
  });
}

test('a sliding touch (voss-death-scene §4): her hand keeps to the mark\'s height while her pose sweeps it across, then lets go', () => {
  const g = motionSetup({
    anchors: {},
    beats: [
      { id: 'wait', poses: ['idle'], convulse: 0, until: 'time', s: 0.5, max: 0.5 },
      {
        id: 'sweep', poses: ['idle'], convulse: 0, until: 'time', s: 2, max: 2,
        track: [{ at: 0, pose: 'kill_bench_hit', blend: 0.1 }, { at: 0.6, pose: 'kill_sweep', blend: 0.5 }],
        events: [{ t: 0.2, do: 'touch', part: 'hand_L', mark: 'top', slide: true, blend: 0.1, hold: 1.3 }],
      },
      END_BEAT,
    ],
  });
  g.start();
  g.step(0.6);
  // The bench top at her left hand's height as the hit pose holds it, 5 cm up.
  const y = g.actor.body.jointWorld('hand_L', new THREE.Vector3()).y + 0.05;
  g.anchors['top'] = { x: 0, y, z: 0 };
  let worst = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  g.step(2, () => {
    const r = g.run();
    if (r?.beatId !== 'sweep' || r.beatTime < 0.32 || r.beatTime > 1.55) return;
    const hand = g.actor.body.jointWorld('hand_L', new THREE.Vector3());
    worst = Math.max(worst, Math.abs(hand.y - y));
    minX = Math.min(minX, hand.x);
    maxX = Math.max(maxX, hand.x);
  });
  assert.ok(maxX - minX > 0.1, `her hand sweeps ${(maxX - minX).toFixed(2)} m across`);
  assert.ok(worst < 0.01, `and stays on the top (${(worst * 100).toFixed(1)} cm off it)`);
});

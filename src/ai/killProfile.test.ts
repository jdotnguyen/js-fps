import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { posesJson } from '../data/poseFiles.ts';
import killsJson from '../data/kills.json' with { type: 'json' };
import vossPack from '../data/cast/voss/mocap.json' with { type: 'json' };
import type { GoreSystem } from '../actors/gore.ts';
import { PoseLibrary } from '../actors/poses.ts';
import { validate } from '../core/validate.ts';
import { loadPoseFile } from '../data/types/poses.ts';
import { validateKillTable } from '../data/types/kills.ts';
import { JOINT_NAMES } from '../actors/skeleton.ts';
import { sharedMocapLibrary, type RawMocapFile } from '../actors/mocap.ts';
import { resolveProfile, sharedMotionProfiles } from '../actors/motionProfiles.ts';
import { NpcDirector } from './npcs.ts';

/**
 * Voss's own motion (per-character-motion task 6.5) must not change her Lab B kill (character-motion: infected and scripted
 * kills keep their own motion). The kill is played twice, once on her own profile and once on the plain feminine default, and
 * her body is compared frame by frame.
 */

// Her clips are a pack the game loads with her body; Node adds it directly (see mocapPacks.test.ts).
sharedMocapLibrary().addPack('voss', vossPack as unknown as RawMocapFile);

const KILL = { npc: 'researcher_b', kind: 'grownInside', glass: 'anchor:labb_glass', lines: { scratch: 'drop_voss_01', glass: 'drop_voss_02' } };

interface Run {
  /** Per frame: every joint's rotation, and her position. */
  frames: { q: THREE.Quaternion[]; pos: THREE.Vector3 }[];
  /** Frame each kill beat started. */
  beats: Record<string, number>;
}

function play(ownProfile: boolean, beforeKill: number): Run {
  const gore = new Proxy({}, { get: () => () => undefined }) as unknown as GoreSystem;
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const beats: Record<string, number> = {};
  const frames: Run['frames'] = [];
  const npcs = new NpcDirector({
    ctx: { poses: new PoseLibrary(loadPoseFile(posesJson)), gore },
    nav: null,
    colliders: null,
    player: () => ({ feet: new THREE.Vector3(0, 0, -3), head: new THREE.Vector3(0, 1.62, -3) }),
    emit: (name, payload) => {
      if (name.startsWith('kill:') && !(name in beats)) beats[name.slice(5)] = frames.length;
      for (const fn of [...(handlers.get(name) ?? [])]) fn(payload);
    },
    listen: (name, fn) => {
      const set = handlers.get(name) ?? new Set();
      handlers.set(name, set);
      set.add(fn);
      return () => set.delete(fn);
    },
    sfx: () => true,
    warn: () => {},
    kills: validate(validateKillTable, killsJson, 'kills'),
  });
  npcs.setResolver(() => ({ pos: { x: 0, y: 1.5, z: 0 } }));
  npcs.spawnFromLevel([{ id: 'researcher_b', look: 'voss', pos: { x: 0, y: 0, z: 4.7 }, yaw: 0, pose: 'typing', transformable: true }]);
  const voss = npcs.actor('researcher_b')!;
  if (!ownProfile) voss.body['animator'].setMotion(resolveProfile(sharedMocapLibrary(), sharedMotionProfiles(), undefined, 'f'));
  const camera = new THREE.Vector3(0, 1.62, -3);
  const say = (id: string): void => {
    for (const fn of [...(handlers.get('speech:ended') ?? [])]) fn({ id, speaker: 'crew_lab' });
  };
  const step = (seconds: number, each?: () => void): void => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      npcs.update(1 / 60, camera);
      frames.push({ q: JOINT_NAMES.map((j) => voss.body.bones[j].quaternion.clone()), pos: voss.position.clone() });
      each?.();
    }
  };
  step(beforeKill);
  beats['typing_end'] = frames.length;
  void npcs.command('kill', KILL);
  step(2.5);
  say('drop_voss_01');
  let screamed = false;
  step(18, () => {
    if (!screamed && beats['glass'] !== undefined && frames.length - beats['glass']! > 90) {
      screamed = true;
      say('drop_voss_02');
    }
  });
  return { frames, beats };
}

function worstDiff(a: Run, b: Run, from: number, to: number): { deg: number; cm: number } {
  let rad = 0;
  let m = 0;
  for (let f = from; f < to; f++) {
    for (let j = 0; j < JOINT_NAMES.length; j++) rad = Math.max(rad, a.frames[f]!.q[j]!.angleTo(b.frames[f]!.q[j]!));
    m = Math.max(m, a.frames[f]!.pos.distanceTo(b.frames[f]!.pos));
  }
  return { deg: (rad * 180) / Math.PI, cm: m * 100 };
}

test('Voss\'s own motion shows at the bench, and her Lab B kill plays as on the default profile once it blends out of it', () => {
  const own = play(true, 2);
  const plain = play(false, 2);
  assert.deepEqual(own.beats, plain.beats, 'every beat starts on the same frame');
  const typing = worstDiff(own, plain, 30, own.beats['typing_end']!);
  assert.ok(typing.deg > 0.5, `before the kill her own motion shows at the bench (${typing.deg.toFixed(2)} deg), so the comparison is live`);
  const start = own.beats['scratch']!;
  assert.ok(start >= own.beats['typing_end']!, 'the kill starts after the bench work');
  // The first beat blends out of wherever she was at the bench, which is her own motion; that hand-off settles within 1.5 s.
  const settled = worstDiff(own, plain, start + 90, own.beats['panic']!);
  assert.ok(settled.deg < 0.5, `the blend out of her bench motion settles (${settled.deg.toFixed(2)} deg after 1.5 s)`);
  // From the second beat on, the kill is the same to the frame.
  const kill = worstDiff(own, plain, own.beats['panic']!, Math.min(own.frames.length, plain.frames.length));
  assert.ok(kill.deg < 0.1 && kill.cm < 0.01, `the kill is unchanged (worst joint ${kill.deg.toFixed(3)} deg, position ${kill.cm.toFixed(3)} cm)`);
  // No pop at the hand-off: her biggest frame-to-frame joint step entering the kill is no bigger than the default's.
  const maxStep = (r: Run): number => {
    let m = 0;
    for (let f = start; f < start + 30; f++) for (let j = 0; j < JOINT_NAMES.length; j++) m = Math.max(m, r.frames[f]!.q[j]!.angleTo(r.frames[f - 1]!.q[j]!));
    return (m * 180) / Math.PI;
  };
  assert.ok(maxStep(own) <= maxStep(plain) * 1.25 + 1, `no pop entering the kill (${maxStep(own).toFixed(2)} vs ${maxStep(plain).toFixed(2)} deg per frame)`);
  for (const beat of ['scratch', 'panic', 'glass', 'arch', 'burst', 'still', 'creature', 'done']) assert.ok(beat in own.beats, `the ${beat} beat happens`);
});

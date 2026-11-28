import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ES module without types
import { loadManifest } from './lib/mocapSources.mjs';
// @ts-expect-error plain ES module without types
import { groundClip, rotateJoints } from './lib/rotateJoints.mjs';
import mocapJson from '../src/data/mocap-core.json' with { type: 'json' };

// A clip made from another is built by the bake, so the library must hold exactly what the bake list says: these checks need no
// source files.

type Clip = { joints: Record<string, number[]> } & Record<string, unknown>;
type Entry = { id: string; from?: string; rotate?: Record<string, number[]>; pack?: string };
const clips = (mocapJson as unknown as { clips: Record<string, Clip> }).clips;

test('derived clips: the library holds what the bake list builds from each base', () => {
  const derived = (loadManifest().clips as Entry[]).filter((c) => c.from);
  for (const id of ['giles_pistol', 'okafor_pistol']) assert.ok(derived.some((c) => c.id === id), `${id} is in the bake list`);
  // A pack's clips are read from its character's file by the pack tests; every derived clip so far is in the core.
  for (const c of derived.filter((c) => !c.pack)) assert.deepEqual(rotateJoints(clips[c.from!], c.rotate), clips[c.id], c.id);
});

test('derived clips: only the named joints turn, and an unknown joint is an error', () => {
  const base: Clip = { frames: 2, joints: { hand_L: [0, 0, 0, 1, 0, 0, 0, 1], hand_R: [0, 0, 0, 1, 0, 0, 0, 1] } };
  const out = rotateJoints(base, { hand_R: [90, 0, 0] }) as Clip;
  assert.deepEqual(out.joints['hand_L'], base.joints['hand_L']);
  assert.deepEqual(out.joints['hand_R'], [0.7071, 0, 0, 0.7071, 0.7071, 0, 0, 0.7071]);
  assert.deepEqual(base.joints['hand_R'], [0, 0, 0, 1, 0, 0, 0, 1], 'the base is left alone');
  assert.throws(() => rotateJoints(base, { tail: [1, 0, 0] }), /no joint "tail"/);
});

test('derived clips: the bake list rejects one whose base is not listed before it, or with no rotations', () => {
  const load = (change: (clips: Entry[]) => void): void => {
    const m = loadManifest() as { clips: Entry[] };
    change(m.clips);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mocap-')), 'sources.json');
    fs.writeFileSync(f, JSON.stringify(m));
    loadManifest(f);
  };
  const pistol = (list: Entry[]): Entry => list.find((c) => c.id === 'giles_pistol')!;
  assert.throws(() => load((l) => void (pistol(l).from = 'nothing')), /"from" must name a clip listed before it/);
  assert.throws(() => load((l) => void l.unshift(...l.splice(l.indexOf(pistol(l)), 1))), /"from" must name a clip listed before it/);
  assert.throws(() => load((l) => void delete pistol(l).rotate), /"from" needs "rotate"/);
});

test('turned takes: bent legs are grounded again, frame by frame, with the lower foot on the floor', () => {
  const still = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const clip: Clip = { frames: 3, loop: false, pelvis: [0, 0, 0, 0, 0, 0, 0, 0, 0], joints: { thigh_L: still, shin_L: still, thigh_R: still, shin_R: still } };
  assert.deepEqual(groundClip(clip).pelvis, clip.pelvis, 'straight legs stay where they are');
  // Both knees bent 60°: the shins (0.42) now reach 0.21 down, so the hips drop by 0.21.
  const bent = groundClip(rotateJoints(clip, { shin_L: [-60, 0, 0], shin_R: [-60, 0, 0] })) as Clip & { pelvis: number[] };
  for (let f = 0; f < 3; f++) assert.ok(Math.abs(bent.pelvis[f * 3 + 1]! + 0.21) < 0.002, `frame ${f} hips at ${bent.pelvis[f * 3 + 1]}`);
});

test('turned takes: a bake-list clip with "rotate" and no "from" is its own take with those joints turned', () => {
  const walk = (loadManifest().clips as Entry[]).find((c) => c.id === 'voss_hurt_walk')!;
  assert.ok(walk.rotate && !walk.from, 'Voss hurt walk turns its own arms');
  const pack = JSON.parse(fs.readFileSync(new URL('../src/data/cast/voss/mocap.json', import.meta.url), 'utf8')) as { clips: Record<string, Clip> };
  assert.ok(pack.clips['voss_hurt_walk'], 'the turned clip is in her pack under its own id');
});

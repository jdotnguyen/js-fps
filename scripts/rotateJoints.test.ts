import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ES module without types
import { loadManifest } from './lib/mocapSources.mjs';
// @ts-expect-error plain ES module without types
import { rotateJoints } from './lib/rotateJoints.mjs';
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
  assert.throws(() => load((l) => void delete pistol(l).rotate), /"from" and "rotate" go together/);
});

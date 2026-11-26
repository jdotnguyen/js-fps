import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import {
  FIXTURE_PATH,
  HEAD,
  JAW,
  MODEL_PATH,
  SOURCE_PATH,
  bindMesh,
  createIO,
  jawOpened,
  prepareWrite,
  primitiveOf,
  repair,
  skinOf,
  sourceFacts,
  unitsPerMetre,
  // @ts-expect-error plain ES module without types
} from './lib/necromorphRepair.mjs';
import { loadWithoutTextures } from '../src/actors/castModelTestKit.ts';

/**
 * The Necromorph Slasher as `scripts/fix-necromorph-glb.mjs` ships it (openspec rig-necromorph, design D2). The source (commit
 * 822dddf) is not in the working tree, so what the tests compare against is in scripts/fixtures/necromorph-source.json,
 * written by the same script from the source.
 */

const ROOT = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(ROOT, FIXTURE_PATH), 'utf8'));
const io = await createIO();
// NECROMORPH_MODEL tests a candidate before it replaces the shipped file.
const MODEL = process.env['NECROMORPH_MODEL'] ?? MODEL_PATH;
const doc = await io.read(join(ROOT, MODEL));

test('the jaw is the only joint added, and every other joint and inverse bind matrix is the source\'s', () => {
  const skin = skinOf(doc);
  const names = skin.listJoints().map((j: { getName(): string }) => j.getName());
  assert.deepEqual(names, [...fixture.joints, JAW]);
  const jaw = skin.listJoints()[names.indexOf(JAW)];
  assert.equal(jaw.getParentNode()?.getName(), HEAD, 'the jaw hangs from the head');
  const ibm = Array.from(skin.getInverseBindMatrices().getArray() as Float32Array);
  for (let i = 0; i < fixture.ibm.length; i++) assert.ok(Math.abs(ibm[i]! - fixture.ibm[i]) <= 1e-6 * Math.max(1, Math.abs(fixture.ibm[i])), `inverse bind ${Math.floor(i / 16)}[${i % 16}]`);
});

test('only skin that carried head weight changed', () => {
  const now = sourceFacts(doc, fixture.headVertices);
  assert.equal(now.vertices, fixture.vertices);
  assert.equal(now.otherSkinHash, fixture.otherSkinHash, 'a vertex without head weight changed');
  const prim = primitiveOf(doc);
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  const jaw = fixture.joints.length;
  const head = new Set<number>(fixture.headVertices);
  let onJaw = 0;
  for (let v = 0; v < J.getCount(); v++) {
    const jj = J.getElement(v, []) as number[];
    const ww = W.getElement(v, []) as number[];
    const w = jj.reduce((s, j, k) => s + (j === jaw ? ww[k]! : 0), 0);
    if (w > 0) {
      assert.ok(head.has(v), `vertex ${v} took jaw weight without having head weight`);
      onJaw++;
    }
    assert.ok(Math.abs(ww.reduce((a, b) => a + b, 0) - 1) < 1e-3, `vertex ${v} weights sum to 1`);
  }
  assert.ok(onJaw >= 60, `${onJaw} vertices move with the jaw`);
});

// blade-creature "Its jaw opens": 30 degrees from closed with the skull still and no edge of 3 mm or more stretched past 2.5x.
test('opened 30 degrees the jaw swings without tearing the head', () => {
  const { points, tris } = bindMesh(doc);
  const open = jawOpened(doc, 30);
  const mm = unitsPerMetre(doc) * 0.001;
  const head = new Set<number>(fixture.headVertices);
  let worst = 0;
  let moved = 0;
  for (const t of tris) {
    for (let e = 0; e < 3; e++) {
      const a = t[e]!;
      const b = t[(e + 1) % 3]!;
      const rest = points[a]!.distanceTo(points[b]!);
      if (rest < 3 * mm) continue;
      worst = Math.max(worst, open[a]!.distanceTo(open[b]!) / rest);
    }
  }
  for (let v = 0; v < points.length; v++) {
    const d = open[v]!.distanceTo(points[v]!);
    if (!head.has(v)) assert.ok(d < 1e-9, `vertex ${v} is not on the head and moved`);
    if (d > 10 * mm) moved++;
  }
  assert.ok(worst <= 2.5, `an edge stretched to ${worst.toFixed(2)}x`);
  assert.ok(moved >= 40, `${moved} vertices move more than 1 cm`);
});

test('the shipped model loads, with one skinned mesh using the jaw', async () => {
  const scene = await loadWithoutTextures(new URL(`../${MODEL}`, import.meta.url));
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  assert.equal(meshes.length, 1);
  assert.ok(meshes[0]!.skeleton.bones.some((b) => b.name === JAW));
});

// rig-necromorph 2.1: with every fix switched off the script writes the source back unchanged in substance.
test('with no fixes the script writes the source back: same meshes, joints, weights and extensions', { skip: !existsSync(join(ROOT, SOURCE_PATH)) && 'no source copy' }, async () => {
  const src = await io.read(join(ROOT, SOURCE_PATH));
  const plain = await io.read(join(ROOT, SOURCE_PATH));
  repair(plain, { skip: new Set(['jaw']) });
  prepareWrite(plain);
  const back = await io.readBinary(await io.writeBinary(plain));
  const facts = (d: unknown) => sourceFacts(d);
  assert.deepEqual(facts(back), facts(src));
  const ext = (d: { getRoot(): { listExtensionsUsed(): Array<{ extensionName: string }> } }) => d.getRoot().listExtensionsUsed().map((e) => e.extensionName).sort();
  assert.deepEqual(ext(back), ext(src));
  const pts = (d: unknown) => bindMesh(d).points as THREE.Vector3[];
  const a = pts(src);
  const b = pts(back);
  assert.equal(a.length, b.length);
  assert.ok(a.every((p, i) => p.distanceTo(b[i]!) < 1e-4), 'positions unchanged');
});

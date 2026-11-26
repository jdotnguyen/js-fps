import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import {
  AIM_MARKER,
  BODY_MESH,
  FACE_GROUPS,
  FIXTURE_PATH,
  MODEL_PATH,
  POSES_PATH,
  REPARENT,
  createIO,
  faceChecks,
  poseWorlds,
  skinHashes,
  skinnedPositions,
  storedPositions,
  // @ts-expect-error plain ES module without types
} from './lib/juggernautRepair.mjs';

/**
 * The Juggernaut as `scripts/fix-juggernaut-glb.mjs` ships it (openspec rig-juggernaut D1-D4). The source (Sketchfab export,
 * commit 900e513) is not in the working tree, so what the tests compare against is in scripts/fixtures/juggernaut-source.json,
 * written by the same script from the source: its joint list, hashes of its skin and weighted inverse-binds, and every joint's
 * world matrix in the exported pose.
 */

const ROOT = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(ROOT, FIXTURE_PATH), 'utf8'));
const poses = JSON.parse(readFileSync(join(ROOT, POSES_PATH), 'utf8'));
const doc = await createIO().read(join(ROOT, MODEL_PATH));
const metresPerUnit: number = fixture.metresPerUnit;
const MM = 0.001 / metresPerUnit;

type Node = { getName(): string; getParentNode(): Node | null };
const maxGap = (a: THREE.Vector3[], b: THREE.Vector3[]): number => Math.max(...a.map((p, i) => p.distanceTo(b[i]!)));

test('the face parts sit on the head, mirrored, on their joints, teeth between the jaws (D2)', () => {
  for (const c of faceChecks(doc, metresPerUnit)) assert.ok(c.ok, `${c.part}: ${c.check} (${(c.metres * 100).toFixed(2)} cm)`);
});

test('every face part is skinned to the head in the neutral pose, not hundreds of units away', () => {
  const head = new THREE.Box3().setFromPoints(skinnedPositions(doc, BODY_MESH));
  for (const group of FACE_GROUPS) {
    for (const mesh of group.meshes as string[]) {
      const box = new THREE.Box3().setFromPoints(skinnedPositions(doc, mesh));
      assert.ok(head.containsBox(box), `${mesh} inside the body's bounds`);
      assert.ok(box.min.y > head.min.y + (head.max.y - head.min.y) * 0.55, `${mesh} in the upper part of the body, where the head is`);
    }
  }
});

test('joint names, their order, weighted inverse-binds and every vertex skin are the source\'s (D3)', () => {
  const now = skinHashes(doc);
  assert.deepEqual(now.joints, fixture.joints);
  assert.deepEqual(now.weighted, fixture.weighted);
  assert.equal(now.weightedInverseBinds, fixture.weightedInverseBinds);
  assert.deepEqual(now.skins, fixture.skins);
});

test('hands ride the forearms, feet the shins, the aim marker the head (D3)', () => {
  const nodes = doc.getRoot().listNodes() as Node[];
  for (const [joint, parent] of REPARENT as [string, string][]) {
    assert.equal(nodes.find((n) => n.getName() === joint)?.getParentNode()?.getName(), parent, `${joint} under ${parent}`);
  }
});

test('in the exported pose the aim marker is where it was, within 1 mm', () => {
  const worlds = poseWorlds(doc, poses.poses.exported_rest) as Map<Node, THREE.Matrix4>;
  const marker = [...worlds].find(([n]) => n.getName() === AIM_MARKER)![1];
  const now = new THREE.Vector3().setFromMatrixPosition(marker);
  const before = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(fixture.exportedWorld[AIM_MARKER]));
  assert.ok(now.distanceTo(before) <= MM, `${(now.distanceTo(before) * metresPerUnit * 1000).toFixed(3)} mm`);
});

test('the model loads in its neutral pose: every body vertex where it was modelled, within 1 mm (D4)', () => {
  const gap = maxGap(skinnedPositions(doc, BODY_MESH), storedPositions(doc, BODY_MESH));
  assert.ok(gap <= MM, `${(gap * metresPerUnit * 1000).toFixed(3)} mm`);
});

test('exported_rest reproduces the source\'s exported body within 1 mm (D4)', () => {
  const worlds = poseWorlds(doc, poses.poses.exported_rest) as Map<Node, THREE.Matrix4>;
  const posed = skinnedPositions(doc, BODY_MESH, (j: Node) => worlds.get(j)!);
  const source = skinnedPositions(doc, BODY_MESH, (j: Node) => new THREE.Matrix4().fromArray(fixture.exportedWorld[j.getName()]));
  const gap = maxGap(posed, source);
  assert.ok(gap <= MM, `${(gap * metresPerUnit * 1000).toFixed(3)} mm`);
  // And it is a different pose from neutral (head turned, jaw open): the comparison is not trivially true.
  assert.ok(maxGap(skinnedPositions(doc, BODY_MESH), source) > 0.1 / metresPerUnit);
});

test('CREDITS.md names the author and the page the model carries', () => {
  const extras = doc.getRoot().getAsset().extras as { author: string; source: string };
  const row = readFileSync(join(ROOT, 'CREDITS.md'), 'utf8').split('\n').find((l) => l.includes('monster_juggernaut.glb'))!;
  assert.ok(row.includes(extras.author.split(' ')[0]!), `author ${extras.author}`);
  assert.ok(row.includes(extras.source), `source ${extras.source}`);
  assert.ok(row.includes('CC BY 4.0'));
});

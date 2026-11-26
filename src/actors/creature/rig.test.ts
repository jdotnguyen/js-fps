import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mirrorPairs } from './rig.ts';
import { juggernautFixture, loadJuggernaut, METRES_PER_UNIT, modelledWorld, skinnedMeshes, skinnedWorld } from './creatureTestKit.ts';

// openspec rig-juggernaut, spec creature-rig: neutral pose, named poses and blending (D4, D7).

const maxGap = (a: THREE.Vector3[], b: THREE.Vector3[]): number => Math.max(...a.map((p, i) => p.distanceTo(b[i]!)));
/** Angle between two rotations, normalised first (the model's float32 rotations are ~1e-7 off unit length). */
const gap = (a: THREE.Quaternion, b: THREE.Quaternion): number => a.clone().normalize().angleTo(b.clone().normalize());

test('neutral: every skinned vertex where it was modelled (1 mm), every left joint mirrors its right (1 cm)', async () => {
  const { scene, rig } = await loadJuggernaut();
  rig.update(0);
  for (const meshes of skinnedMeshes(scene).values()) {
    for (const mesh of meshes) {
      const gap = maxGap(skinnedWorld(mesh), modelledWorld(mesh, scene));
      assert.ok(gap <= 0.001, `${mesh.name}: ${(gap * 1000).toFixed(3)} mm`);
    }
  }
  const pairs = mirrorPairs(rig);
  assert.equal(pairs.length, 36, "lashes 12, fingers 6, crown 3, jaw 3, arms 4, legs 4, eyes 2, fat 1, tongue sides 1");
  const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  for (const [l, r] of pairs) {
    const pl = l.bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const pr = r.bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const gap = new THREE.Vector3(-pl.x, pl.y, pl.z).distanceTo(pr) * METRES_PER_UNIT;
    assert.ok(gap <= 0.01, `${l.name} / ${r.name}: ${(gap * 100).toFixed(2)} cm`);
  }
});

test('exported_rest is a named pose and reproduces the exported body within 1 mm, inside every limit', async () => {
  const { scene, rig } = await loadJuggernaut();
  assert.ok(rig.poseNames().includes('exported_rest'));
  rig.setPose('exported_rest');
  rig.update(0);
  assert.deepEqual(rig.jointsAtLimit(1 + 1e-6).map((j) => j.name), [], 'no joint clamped or past a bound');
  // The source's skinned body, from its exported joint matrices (scene frame) and the shipped skin.
  const body = skinnedMeshes(scene).get('body')![0]!;
  const now = skinnedWorld(body);
  const bones = body.skeleton.bones;
  const saved = bones.map((b) => b.matrixWorld.clone());
  bones.forEach((b) => {
    const m = juggernautFixture.exportedWorld[nameOf(b)];
    if (m) b.matrixWorld.copy(scene.matrixWorld).multiply(new THREE.Matrix4().fromArray(m));
  });
  const before = skinnedWorld(body);
  bones.forEach((b, i) => b.matrixWorld.copy(saved[i]!));
  const gap = maxGap(now, before);
  assert.ok(gap <= 0.001, `${(gap * 1000).toFixed(3)} mm`);
});

/** The model file's joint name for a bone (three.js strips dots). */
function nameOf(b: THREE.Object3D): string {
  const strip = (s: string) => s.replace(/\./g, '');
  return Object.keys(juggernautFixture.exportedWorld).find((n) => strip(n) === b.name) ?? b.name;
}

test('a 0.5 s blend is part-way at 0.25 s and exact at 0.5 s', async () => {
  const { rig } = await loadJuggernaut();
  rig.update(0);
  const neutral = rig.joints.map((j) => j.bone.quaternion.clone());
  rig.setPose('exported_rest', 0.5);
  rig.update(0);
  rig.update(0.25);
  const half = rig.joints.map((j) => j.bone.quaternion.clone());
  rig.update(0.25);
  const end = rig.joints.map((j) => j.bone.quaternion.clone());
  rig.setPose('exported_rest');
  rig.update(0);
  const target = rig.joints.map((j) => j.bone.quaternion.clone());
  let moving = 0;
  rig.joints.forEach((j, i) => {
    assert.ok(gap(end[i]!, target[i]!) < 1e-6, `${j.name} matches the pose at 0.5 s`);
    const total = gap(neutral[i]!, target[i]!);
    if (total < 1e-4) return;
    moving++;
    const a = gap(neutral[i]!, half[i]!);
    const b = gap(half[i]!, target[i]!);
    assert.ok(a > 0.1 * total && b > 0.1 * total, `${j.name} part-way at 0.25 s`);
  });
  assert.ok(moving > 20, `${moving} joints move in the blend`);
});

test('the same inputs give the same pose', async () => {
  const runs = await Promise.all([loadJuggernaut(), loadJuggernaut()]);
  const out = runs.map(({ rig }) => {
    rig.setPose('exported_rest', 0.4);
    rig.setFace({ jaw: 0.6, tongueExtend: 0.3 });
    rig.setLookTarget(new THREE.Vector3(2, 4, 6));
    rig.setLimbTarget('arm.L', new THREE.Vector3(2.2, 0.6, 1.5));
    rig.setLimbTarget('leg.R', new THREE.Vector3(-1.1, 0, -1.4));
    for (let i = 0; i < 5; i++) rig.update(0.1);
    return rig.joints.map((j) => j.bone.quaternion.toArray());
  });
  assert.deepEqual(out[0], out[1]);
  // And evaluating again with nothing changed leaves the pose where it is.
  const { rig } = runs[0]!;
  rig.update(0);
  assert.deepEqual(rig.joints.map((j) => j.bone.quaternion.toArray()), out[0]);
});

test('a pose naming a joint the rig does not have fails, naming the pose and the joint', async () => {
  const { scene } = await loadJuggernaut();
  const { CreatureRig } = await import('./rig.ts');
  const { JUGGERNAUT_DEF, JUGGERNAUT_POSES } = await import('./juggernaut.ts');
  const poses = { poses: { ...JUGGERNAUT_POSES.poses, roar: { joints: { tail_07: [10, 0, 0] as [number, number, number] } } } };
  assert.throws(() => new CreatureRig(scene, JUGGERNAUT_DEF, poses, 'juggernaut'), /roar.*tail_07/);
});

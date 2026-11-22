import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
// @ts-expect-error plain ES module without types
import { BONE_MAPS, bakeBvh, guessBoneMap, loadBvh } from './lib/bvhBake.mjs';

const fixture = (f: string): string => fs.readFileSync(path.join(import.meta.dirname, 'fixtures/mocap', f), 'utf8');

interface Clip {
  frames: number;
  stride?: number;
  contactL?: number[];
  contactR?: number[];
  pelvis: number[];
  joints: Record<string, number[]>;
}

function q(arr: number[], f: number): THREE.Quaternion {
  return new THREE.Quaternion(arr[f * 4], arr[f * 4 + 1], arr[f * 4 + 2], arr[f * 4 + 3]);
}

/** Joints whose step across the loop seam (last frame to first) is bigger than their own largest ordinary frame step. */
function seamPops(clip: Clip): string[] {
  const out: string[] = [];
  for (const [j, arr] of Object.entries(clip.joints)) {
    let maxStep = 0;
    for (let f = 1; f < clip.frames; f++) maxStep = Math.max(maxStep, q(arr, f - 1).angleTo(q(arr, f)) * (180 / Math.PI));
    const seam = q(arr, clip.frames - 1).angleTo(q(arr, 0)) * (180 / Math.PI);
    if (seam > maxStep * 1.25 + 1) out.push(`${j} ${seam.toFixed(1)} deg (largest step ${maxStep.toFixed(1)})`);
  }
  return out;
}

function checkWalk(name: string, clip: Clip, info: { segmentError: number }): void {
  const stanceL = clip.contactL!.filter((c) => c > 0.5).length / clip.frames;
  const stanceR = clip.contactR!.filter((c) => c > 0.5).length / clip.frames;
  for (const [side, s] of [['left', stanceL], ['right', stanceR]] as const) {
    assert.ok(s > 0.3 && s < 0.8, `${name}: ${side} foot planted ${(s * 100).toFixed(0)}% of the cycle`);
  }
  assert.ok(clip.stride! > 0.5 && clip.stride! < 1.9, `${name}: stride ${clip.stride} m per cycle`);
  const both = clip.contactL!.filter((c, i) => c > 0.5 && clip.contactR![i]! > 0.5).length;
  assert.ok(both < clip.frames * 0.4, `${name}: feet alternate (double support ${both} frames)`);
  // No visible pop: across the seam every joint moves no more than it does between ordinary frames.
  assert.deepEqual(seamPops(clip), [], `${name}: loop seam`);
  assert.ok(info.segmentError < 4, `${name}: bone directions follow the source (${info.segmentError.toFixed(2)} deg mean)`);
}

test('BVH bake: a CMU walk retargets with foot contacts and stride and loops without a pop', () => {
  const { clip, info } = bakeBvh(fixture('cmu_35_01_walk.bvh'), BONE_MAPS.cmu, { id: 'cmu_walk', loop: true, loco: true });
  checkWalk('CMU walk', clip, info);
});

test('BVH bake: a Bandai walk retargets with foot contacts and stride and loops without a pop', () => {
  const { clip, info } = bakeBvh(fixture('bandai2_walk_feminine_001.bvh'), BONE_MAPS.bandai, { id: 'bandai_walk', loop: true, loco: true });
  checkWalk('Bandai walk', clip, info);
});

test('BVH bake: output is 24 fps with the shared skeleton\'s joints and a standing pelvis', () => {
  const { clip } = bakeBvh(fixture('cmu_35_01_walk.bvh'), BONE_MAPS.cmu, { id: 'cmu_walk', loop: true, loco: true });
  assert.ok(Math.abs(clip.frames / (clip as unknown as { duration: number }).duration - 24) < 1);
  for (const j of ['pelvis', 'spine', 'chest', 'neck', 'head', 'hand_L', 'foot_R']) assert.equal(clip.joints[j]!.length, clip.frames * 4, j);
  assert.ok(!('jaw' in clip.joints) && !('root' in clip.joints), 'root and jaw stay procedural');
  for (let f = 0; f < clip.frames; f++) assert.ok(Math.abs(clip.pelvis[f * 3 + 1]!) < 0.12, 'pelvis height stays near standing');
});

test('BVH bake: bone maps can be guessed from common names', () => {
  const map = guessBoneMap(loadBvh(fixture('bandai2_walk_feminine_001.bvh')).names);
  assert.equal(map.foreArm_L, 'LowerArm_L');
  assert.equal(map.thigh_R, 'UpperLeg_R');
  assert.equal(map.toe_L, 'Toes_L');
});

test('BVH load: a file whose every joint carries its own position (Bandai) keeps its real bone lengths', () => {
  const text = fixture('bandai2_walk_feminine_001.bvh');
  const offsetOf = (joint: string): number => {
    const m = new RegExp(String.raw`JOINT ${joint}\s*\{\s*OFFSET ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)`).exec(text);
    assert.ok(m, `${joint} offset in the file`);
    return Math.hypot(Number(m[1]), Number(m[2]), Number(m[3]));
  };
  const src = loadBvh(text);
  src.pose(10);
  const bone = (n: string): THREE.Vector3 => src.byName.get(n).getWorldPosition(new THREE.Vector3());
  const map = BONE_MAPS.bandai;
  const shin = bone(map.thigh_L).distanceTo(bone(map.shin_L));
  assert.ok(Math.abs(shin / offsetOf(map.shin_L) - 1) < 0.02, `thigh length ${shin.toFixed(1)} matches the file's offset (not doubled)`);
});

test('BVH bake: Bandai and CMU walks travel at a normal walking speed (a doubled skeleton would halve it)', () => {
  for (const [name, file, map] of [['Bandai', 'bandai2_walk_feminine_001.bvh', BONE_MAPS.bandai], ['CMU', 'cmu_35_01_walk.bvh', BONE_MAPS.cmu]] as const) {
    const { clip } = bakeBvh(fixture(file), map, { id: name, loop: true, loco: true }) as { clip: Clip };
    const speed = clip.stride! / (clip.frames / 24);
    assert.ok(speed > 0.9 && speed < 1.7, `${name}: walks at ${speed.toFixed(2)} m/s, a normal walking speed`);
    assert.ok(clip.stride! > 1.0, `${name}: stride ${clip.stride!.toFixed(2)} m per cycle`);
  }
});

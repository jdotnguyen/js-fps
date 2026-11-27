import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
// @ts-expect-error plain ES module without types
import { BONE_MAPS, bakeBvh, loadBvh } from './lib/bvhBake.mjs';
// @ts-expect-error plain ES module without types
import { buildRig, clearanceProblems, fixClearance, poseRig, twoBone } from './lib/clipChecks.mjs';
import mocapJson from '../src/data/mocap-core.json' with { type: 'json' };
import { MOCAP_PACKS } from '../src/data/mocap/packs.ts';

type Clip = { frames: number; loop: boolean; pelvis: number[]; joints: Record<string, number[]> };
const fixture = (f: string): string => fs.readFileSync(path.join(import.meta.dirname, 'fixtures/mocap', f), 'utf8');

test('clearance: every clip in the library keeps hands out of the torso and feet out of the other leg', () => {
  for (const [id, clip] of Object.entries((mocapJson as unknown as { clips: Record<string, Clip> }).clips)) {
    assert.deepEqual(clearanceProblems(clip).slice(0, 3), [], id);
  }
});

test('clearance: baked BVH fixture walks are clear', () => {
  for (const [f, map] of [['cmu_35_01_walk.bvh', 'cmu'], ['bandai2_walk_feminine_001.bvh', 'bandai']] as const) {
    const { clip } = bakeBvh(fixture(f), BONE_MAPS[map], { id: f, loop: true, loco: true });
    fixClearance(clip);
    assert.deepEqual(clearanceProblems(clip).slice(0, 3), [], f);
  }
});

test('clearance: a hand pushed into the chest is found and fixed without moving the other frames much', () => {
  const { clip } = bakeBvh(fixture('cmu_35_01_walk.bvh'), BONE_MAPS.cmu, { id: 'probe', loop: true, loco: true }) as { clip: Clip };
  const f = 5;
  // Reach the left hand into the middle of the chest with IK: the hand ends inside the torso.
  const rig = buildRig();
  poseRig(rig, clip, f);
  const target = rig.chest.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, -0.02));
  twoBone(rig, 'upperArm_L', 'foreArm_L', 'hand_L', target);
  for (const j of ['upperArm_L', 'foreArm_L']) {
    const q = rig[j].quaternion;
    clip.joints[j]!.splice(f * 4, 4, q.x, q.y, q.z, q.w);
  }
  const found = clearanceProblems(clip);
  assert.ok(found.some((p: { frame: number; what: string }) => p.frame === f && p.what === 'hand_L in torso'), 'penetration found');
  const before = clip.joints['upperArm_L']!.slice(20 * 4, 21 * 4);
  fixClearance(clip);
  assert.deepEqual(clearanceProblems(clip), [], 'fixed');
  assert.deepEqual(clip.joints['upperArm_L']!.slice(20 * 4, 21 * 4), before, 'a frame far from the fix is untouched');
});

// ---------------------------------------------------------------- shoulder carriage

type Rig = Record<string, THREE.Object3D>;

/** Mean clavicle elevation (degrees, shoulder -> upper arm against the chest's up) over a clip on the shared rig. */
function clavicleElevation(clip: Clip | null, rig: Rig = buildRig()): number {
  const one = (): number => {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig['chest']!.getWorldQuaternion(new THREE.Quaternion()));
    let e = 0;
    for (const s of ['L', 'R']) {
      const v = rig[`upperArm_${s}`]!.getWorldPosition(new THREE.Vector3()).sub(rig[`shoulder_${s}`]!.getWorldPosition(new THREE.Vector3())).normalize();
      e += (Math.asin(THREE.MathUtils.clamp(v.dot(up), -1, 1)) * 180) / Math.PI / 2;
    }
    return e;
  };
  if (!clip) {
    rig['root']!.updateMatrixWorld(true);
    return one();
  }
  let sum = 0;
  for (let f = 0; f < clip.frames; f++) {
    for (const b of Object.values(rig)) b.quaternion.identity();
    poseRig(rig, clip, f);
    sum += one();
  }
  return sum / clip.frames;
}

function libraryClips(): [string, Clip][] {
  const cast = path.resolve(import.meta.dirname, '../src/data/cast');
  const files = [mocapJson as unknown as { clips: Record<string, Clip & { additive?: boolean }> }, ...Object.keys(MOCAP_PACKS).map((n) => JSON.parse(fs.readFileSync(path.join(cast, n, 'mocap.json'), 'utf8')))];
  return files.flatMap((f) => Object.entries(f.clips as Record<string, Clip & { additive?: boolean }>).filter(([id, c]) => !c.additive && !id.startsWith('zombie')));
}

test('shoulder carriage: no baked clip shrugs; every clip carries its shoulders near the shared rest', () => {
  // Source skeletons run the clavicle up from the sternum; copying that direction once lifted every BVH-baked character's
  // shoulders 25-40 degrees (per-character-motion: the shoulders are calibrated against the chest).
  const rest = clavicleElevation(null);
  const bad = libraryClips()
    .map(([id, c]) => [id, clavicleElevation(c)] as const)
    .filter(([, e]) => Math.abs(e - rest) > 4)
    .map(([id, e]) => `${id} ${e.toFixed(1)} deg (rest ${rest.toFixed(1)})`);
  assert.deepEqual(bad, []);
});

test('shoulder carriage: CMU and Bandai bakes keep the shoulders at rest on average and keep their movement', () => {
  const rest = clavicleElevation(null);
  for (const [name, file, map] of [['CMU', 'cmu_35_01_walk.bvh', BONE_MAPS.cmu], ['Bandai', 'bandai2_walk_feminine_001.bvh', BONE_MAPS.bandai]] as const) {
    const text = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/mocap', file), 'utf8');
    const { clip } = bakeBvh(text, map, { id: name, loop: true, loco: true }) as { clip: Clip };
    const mean = clavicleElevation(clip);
    assert.ok(Math.abs(mean - rest) < 2, `${name}: shoulders at ${mean.toFixed(1)} deg on average (rest ${rest.toFixed(1)})`);
    // Shoulder movement against the chest is kept where the source has it (Bandai). CMU's BVH conversion holds the shoulder
    // fixed to the chest, so there is none to keep.
    let moved = 0;
    for (let f = 1; f < clip.frames; f++) moved = Math.max(moved, q4(clip.joints['shoulder_L']!, f).angleTo(q4(clip.joints['shoulder_L']!, 0)));
    const src = sourceShoulderRange(text, map);
    if (src > 0.01) assert.ok(moved > src * 0.4, `${name}: the shoulder keeps its movement (${((moved * 180) / Math.PI).toFixed(1)} of ${((src * 180) / Math.PI).toFixed(1)} deg)`);
    else assert.ok(moved < 1e-3, `${name}: a source without shoulder movement gets none`);
  }
});

/** Largest rotation of the source's left shoulder against its chest over a take (radians). */
function sourceShoulderRange(text: string, map: Record<string, string>): number {
  const src = loadBvh(text);
  const sh = src.byName.get(map['shoulder_L']);
  const ch = src.byName.get(map['chest']);
  let first: THREE.Quaternion | null = null;
  let range = 0;
  for (let f = 2; f < src.frames; f += 2) {
    src.pose(f);
    const local = ch.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(sh.getWorldQuaternion(new THREE.Quaternion()));
    first ??= local.clone();
    range = Math.max(range, local.angleTo(first));
  }
  return range;
}

function q4(arr: number[], f: number): THREE.Quaternion {
  return new THREE.Quaternion(arr[f * 4], arr[f * 4 + 1], arr[f * 4 + 2], arr[f * 4 + 3]);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
// @ts-expect-error plain ES module without types
import { LEVEL_CHEST_BACK, LEVEL_CHEST_FORWARD, THALASSA_JOINTS, levelTrunk, trunkPitch } from './lib/bvhBake.mjs';

/**
 * The bake's `levelTrunk` option (level-mocap-trunk-posture design D2; standing-posture-stability: standing idle and talk
 * mocap keeps an upright trunk) on a synthetic swayback take: pelvis tipped forward, lower back folded forward, upper back
 * bent backwards, with breathing-sized motion on every joint and the character turned off-axis.
 */

type Sample = Record<string, THREE.Quaternion> & { hips: THREE.Vector3 };

const FRAMES = 88;
const YAW = 0.35;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, YAW);
const yaw = new THREE.Quaternion().setFromAxisAngle(UP, YAW);
/** World rotation for a segment leaning `deg` forward (Thalassa faces -Z: forward is a negative turn about the right axis). */
const lean = (deg: number, extra = new THREE.Quaternion()): THREE.Quaternion =>
  yaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(deg))).multiply(extra);
const turn = (x: number, y: number, z: number): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

function take(pelvis: number, spine: number, chest: number): Sample[] {
  const out: Sample[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const s = Math.sin((2 * Math.PI * f) / FRAMES);
    const c = Math.cos((2 * Math.PI * f) / FRAMES);
    const w = {
      pelvis: lean(pelvis + 2 * s, turn(0, 0.05 * c, 0.03 * s)),
      spine: lean(spine + 3 * s, turn(0, 0.08 * c, 0)),
      chest: lean(chest + s, turn(0.02 * c, 0.1 * s, 0.02 * c)),
      thigh_L: lean(-6 + 3 * s, turn(0, 0.2, 0.05)),
      shin_L: lean(4 - 2 * s),
      foot_L: lean(0, turn(0.1, 0.2, 0)),
      thigh_R: lean(-4 - 2 * s, turn(0, -0.15, -0.04)),
      shin_R: lean(3 + s),
      foot_R: lean(0, turn(0.1, -0.2, 0)),
      hips: new THREE.Vector3(0.01 * s, 0.015 * c, -0.005 * s),
    } as unknown as Sample;
    w['neck'] = w['chest']!.clone().multiply(turn(-0.1 + 0.05 * s, 0.1 * c, 0));
    w['head'] = w['neck']!.clone().multiply(turn(0.05 * c, 0.2 * s, 0));
    for (const side of ['L', 'R']) {
      const k = side === 'L' ? 1 : -1;
      w[`shoulder_${side}`] = w['chest']!.clone().multiply(turn(0, 0, k * 0.1));
      w[`upperArm_${side}`] = w[`shoulder_${side}`]!.clone().multiply(turn(0.3 + 0.1 * s, 0, k * 0.2));
      w[`foreArm_${side}`] = w[`upperArm_${side}`]!.clone().multiply(turn(-1.2 + 0.2 * c, 0, 0));
      w[`hand_${side}`] = w[`foreArm_${side}`]!.clone().multiply(turn(0.1, 0, 0));
    }
    out.push(w);
  }
  return out;
}
const copy = (ws: Sample[]): Sample[] =>
  ws.map((w) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v.clone()])) as Sample);

const offsetOf = (name: string): THREE.Vector3 => new THREE.Vector3(...THALASSA_JOINTS.find((j: { name: string }) => j.name === name).offset);
/** World position of a joint below the pelvis origin (hip joints), with the pelvis at the sample's hips position. */
const hipJoint = (w: Sample, side: 'L' | 'R'): THREE.Vector3 => offsetOf(`thigh_${side}`).applyQuaternion(w['pelvis']!).add(w.hips);
/** World position of the feet: hips, then thigh and shin down the shared skeleton's rest offsets. */
const foot = (w: Sample, side: 'L' | 'R'): THREE.Vector3 =>
  hipJoint(w, side).add(offsetOf(`shin_${side}`).applyQuaternion(w[`thigh_${side}`]!)).add(offsetOf(`foot_${side}`).applyQuaternion(w[`shin_${side}`]!));
const against = (w: Sample, parent: string, child: string): THREE.Quaternion => w[parent]!.clone().invert().multiply(w[child]!);
const deg = (a: THREE.Quaternion, b: THREE.Quaternion): number => THREE.MathUtils.radToDeg(a.angleTo(b));

test('upright talk levels sustained side tilt and centres gaze while preserving the gesture and stance', () => {
  const samples = take(0, 0, 0);
  const leanLeft = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35);
  for (const w of samples) {
    for (const j of ['spine', 'chest', 'neck', 'head', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R']) {
      w[j]!.premultiply(leanLeft);
    }
  }
  const original = copy(samples);
  levelTrunk(samples, samples, true, 0.1);
  const meanUp = new THREE.Vector3();
  for (const [i, w] of samples.entries()) {
    meanUp.add(UP.clone().applyQuaternion(w['chest']!));
    assert.ok(deg(w['head']!, yaw) < 3, 'the eyes face ahead');
    assert.ok(deg(against(w, 'chest', 'hand_R'), against(original[i]!, 'chest', 'hand_R')) < 0.001);
    for (const side of ['L', 'R'] as const) assert.ok(foot(w, side).distanceTo(foot(original[i]!, side)) < 0.002);
  }
  assert.ok(Math.abs(meanUp.normalize().dot(RIGHT)) < 0.02, 'the chest is centred over the loop');
});

test('levelTrunk: a swayback take comes upright, keeping its motion, its feet and its head against the chest', () => {
  const src = take(16, 34, 10);
  const ws = copy(src);
  const { before, after } = levelTrunk(ws, ws);
  assert.ok(Math.abs(before.pelvis - 16) < 0.5 && Math.abs(before.spine - 34) < 0.5, `measured ${JSON.stringify(before)}`);

  // Upright: pelvis level, the chest's own lean kept (within the limit) and spread evenly, so neither back bends against the other.
  const check = trunkPitch(ws, RIGHT);
  assert.ok(Math.abs(check.pelvis) < 0.5, `pelvis ${check.pelvis.toFixed(2)}`);
  assert.ok(Math.abs(check.chest - 10) < 0.5, `chest ${check.chest.toFixed(2)}`);
  assert.ok(Math.abs(check.spine - check.chest / 2) < 0.5, `spine ${check.spine.toFixed(2)}`);
  assert.ok(check.spine - check.chest <= 0.5, 'the upper back no longer bends backwards');
  // levelTrunk measures about the take's averaged right axis, the test about the exact one.
  assert.ok(Math.abs(after.pelvis - check.pelvis) < 0.1, `reports the levelled pitch (${after.pelvis.toFixed(3)} vs ${check.pelvis.toFixed(3)})`);

  for (let f = 0; f < FRAMES; f++) {
    const a = src[f]!;
    const b = ws[f]!;
    for (const side of ['L', 'R'] as const) {
      assert.ok(foot(a, side).distanceTo(foot(b, side)) < 0.01, `frame ${f}: ${side} foot moved ${(foot(a, side).distanceTo(foot(b, side)) * 100).toFixed(2)} cm`);
      for (const j of ['thigh', 'shin', 'foot']) assert.ok(deg(a[`${j}_${side}`]!, b[`${j}_${side}`]!) < 1e-4, `frame ${f}: ${j}_${side} keeps its world rotation`);
      for (const [p, c] of [['chest', `shoulder_${side}`], [`shoulder_${side}`, `upperArm_${side}`], [`upperArm_${side}`, `foreArm_${side}`]]) {
        assert.ok(deg(against(a, p!, c!), against(b, p!, c!)) < 1e-3, `frame ${f}: ${c} keeps its pose against ${p}`);
      }
    }
    assert.ok(deg(against(a, 'chest', 'head'), against(b, 'chest', 'head')) < 1, `frame ${f}: head keeps its angle to the chest`);
    // Turning and side-lean are untouched: each segment's correction is the same pure pitch on every frame, a turn about one
    // horizontal axis (the take's right axis), so it adds no twist or side-lean of its own.
    for (const j of ['pelvis', 'spine', 'chest']) {
      const fix = (k: number): THREE.Quaternion => ws[k]![j]!.clone().multiply(src[k]![j]!.clone().invert());
      assert.ok(deg(fix(f), fix(0)) < 1e-3, `frame ${f}: ${j} correction is the same on every frame`);
      if (deg(fix(f), new THREE.Quaternion()) < 0.01) continue; // no correction (the chest's own lean is within the limit)
      const axis = new THREE.Vector3(fix(f).x, fix(f).y, fix(f).z).normalize();
      assert.ok(Math.abs(axis.y) < 1e-3, `frame ${f}: ${j} corrected about a tilted axis (y ${axis.y.toFixed(4)})`);
      assert.ok(Math.abs(axis.dot(RIGHT)) > 0.999, `frame ${f}: ${j} corrected about the take's right axis`);
    }
    // Motion around the average: every trunk segment moves by the same amount from frame to frame as before.
    if (f > 0) {
      for (const j of ['pelvis', 'spine', 'chest', 'head']) {
        const da = deg(src[f - 1]![j]!, a[j]!);
        const db = deg(ws[f - 1]![j]!, b[j]!);
        assert.ok(Math.abs(da - db) < 1e-3, `frame ${f}: ${j} step ${da.toFixed(3)} -> ${db.toFixed(3)} deg`);
      }
    }
  }
});

test('levelTrunk: a chest leaning back comes nearly upright and a forward one keeps only a slight lean', () => {
  const back = copy(take(11, 14, -13));
  levelTrunk(back, back);
  const b = trunkPitch(back, RIGHT);
  assert.ok(Math.abs(b.chest + LEVEL_CHEST_BACK) < 0.5, `chest ${b.chest.toFixed(2)} (limit ${LEVEL_CHEST_BACK} back)`);
  assert.ok(Math.abs(b.pelvis) < 0.5);

  const fwd = copy(take(5, 20, 25));
  levelTrunk(fwd, fwd);
  const f = trunkPitch(fwd, RIGHT);
  assert.ok(Math.abs(f.chest - LEVEL_CHEST_FORWARD) < 0.5, `chest ${f.chest.toFixed(2)} (limit ${LEVEL_CHEST_FORWARD} forward)`);
});

test('levelTrunk: the loop-closing sample gets the same correction as the frames it was measured from', () => {
  const ws = copy(take(16, 34, 10));
  const closing = copy(take(16, 34, 10))[0]!;
  levelTrunk(ws, [...ws, closing]);
  for (const j of ['pelvis', 'spine', 'chest', 'head', 'hand_L']) assert.ok(deg(ws[0]![j]!, closing[j]!) < 1e-4, `${j} matches frame 0`);
  assert.ok(ws[0]!.hips.distanceTo(closing.hips) < 1e-6);
});

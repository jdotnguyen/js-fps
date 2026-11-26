import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
// @ts-expect-error plain ES module without types
import { THALASSA_JOINTS, armPitch, hangArms } from './lib/bvhBake.mjs';

/**
 * The bake's `hangArms` option (standing-posture-stability: a standing idle's arms hang at the sides) on a synthetic waiting
 * take: both arms carried forward (the left more), swinging a little, held slightly out from the sides, elbows bent, wrists
 * turned, with the character turned off-axis and its trunk leaning.
 */

type Sample = Record<string, THREE.Quaternion> & { hips: THREE.Vector3 };

const FRAMES = 96;
const YAW = -0.6;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, YAW);
const yaw = new THREE.Quaternion().setFromAxisAngle(UP, YAW);
const turn = (x: number, y: number, z: number): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
/** World rotation for an arm segment swung `deg` forward of straight down (a positive turn about the right axis: Thalassa faces -Z). */
const swing = (deg: number, extra = new THREE.Quaternion()): THREE.Quaternion =>
  yaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(deg))).multiply(extra);

function take(left: number, right: number): Sample[] {
  const out: Sample[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const s = Math.sin((2 * Math.PI * f) / FRAMES);
    const c = Math.cos((2 * Math.PI * f) / FRAMES);
    const w = {
      pelvis: yaw.clone().multiply(turn(0.02 * s, 0.04 * c, 0)),
      spine: yaw.clone().multiply(turn(-0.05, 0.05 * c, 0.02 * s)),
      chest: yaw.clone().multiply(turn(-0.1 + 0.02 * s, 0.08 * s, 0)),
      thigh_L: yaw.clone().multiply(turn(0.05, 0, 0.04)),
      thigh_R: yaw.clone().multiply(turn(0.03, 0, -0.04)),
      hips: new THREE.Vector3(0.01 * s, 0.01 * c, 0),
    } as unknown as Sample;
    for (const [side, carry, k] of [['L', left, 1], ['R', right, -1]] as const) {
      w[`shoulder_${side}`] = w['chest']!.clone().multiply(turn(0, 0, k * 0.08));
      const out = turn(0, 0, -k * 0.12); // slightly out from the side
      w[`upperArm_${side}`] = swing(carry + 3 * s, out);
      w[`foreArm_${side}`] = swing(carry + 3 * s + 18 + 4 * c, out);
      w[`hand_${side}`] = w[`foreArm_${side}`]!.clone().multiply(turn(0.15, 0.5 * k, 0.05 * s));
    }
    out.push(w);
  }
  return out;
}

/** Each upper arm's forward swing on one sample, degrees (the same measure as `armPitch`). */
function swingOf(w: Sample, side: 'L' | 'R'): number {
  const fwd = new THREE.Vector3().crossVectors(UP, RIGHT);
  const bone = new THREE.Vector3(...(THALASSA_JOINTS.find((j: { name: string }) => j.name === `foreArm_${side}`).offset as [number, number, number]));
  const d = bone.applyQuaternion(w[`upperArm_${side}`]!);
  return THREE.MathUtils.radToDeg(Math.atan2(d.dot(fwd), -d.y));
}
const against = (w: Sample, parent: string, child: string): THREE.Quaternion => w[parent]!.clone().invert().multiply(w[child]!);
const deg = (a: THREE.Quaternion, b: THREE.Quaternion): number => THREE.MathUtils.radToDeg(a.angleTo(b));

test('hangArms hangs each upper arm straight down on average and keeps the swing, elbow, wrist and trunk', () => {
  const before = take(9, 3);
  const after = take(9, 3);
  const pitch = armPitch(before, RIGHT);
  assert.ok(Math.abs(pitch.L - 9) < 0.2 && Math.abs(pitch.R - 3) < 0.2, `the take carries its arms 9° and 3° forward (${pitch.L.toFixed(1)}, ${pitch.R.toFixed(1)})`);
  const r = hangArms(after, after);
  assert.ok(Math.abs(r.before.L - 9) < 0.2 && Math.abs(r.before.R - 3) < 0.2, 'the report gives the average before');
  for (const side of ['L', 'R'] as const) assert.ok(Math.abs(r.after[side]) < 0.1, `${side} upper arm hangs straight down on average (${r.after[side].toFixed(2)}°)`);
  for (let f = 0; f < FRAMES; f++) {
    const b = before[f]!;
    const a = after[f]!;
    for (const side of ['L', 'R'] as const) {
      // The swing around the average keeps its size and timing.
      const swingBefore = swingOf(b, side) - r.before[side];
      const swingAfter = swingOf(a, side) - r.after[side];
      assert.ok(Math.abs(swingAfter - swingBefore) < 0.1, `${side} swing kept on frame ${f} (${swingBefore.toFixed(2)} -> ${swingAfter.toFixed(2)})`);
      assert.ok(deg(against(a, `upperArm_${side}`, `foreArm_${side}`), against(b, `upperArm_${side}`, `foreArm_${side}`)) < 1e-3, `${side} elbow bend kept on frame ${f}`);
      assert.ok(deg(against(a, `foreArm_${side}`, `hand_${side}`), against(b, `foreArm_${side}`, `hand_${side}`)) < 1e-3, `${side} wrist kept on frame ${f}`);
    }
    for (const j of ['pelvis', 'spine', 'chest', 'shoulder_L', 'shoulder_R', 'thigh_L', 'thigh_R']) assert.ok(a[j]!.equals(b[j]!), `${j} untouched on frame ${f}`);
    assert.ok(a.hips.equals(b.hips), 'hips untouched');
  }
});

test('hangArms takes another average in degrees forward, and carries the loop-closing sample along', () => {
  const ws = take(9, 3);
  const closing = take(9, 3)[0]!;
  const r = hangArms(ws, [...ws, closing], -4);
  for (const side of ['L', 'R'] as const) assert.ok(Math.abs(r.after[side] + 4) < 0.1, `${side} hangs 4° back on average (${r.after[side].toFixed(2)}°)`);
  // The closing sample (a copy of frame 0) is corrected exactly as frame 0 is, so the loop still closes.
  for (const j of ['upperArm_L', 'foreArm_L', 'hand_L', 'upperArm_R', 'foreArm_R', 'hand_R']) assert.ok(deg(closing[j]!, ws[0]![j]!) < 1e-3, `${j} closes the loop`);
});

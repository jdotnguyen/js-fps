import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import priyaPack from '../data/mocap/priya.json' with { type: 'json' };
import { Humanoid } from './humanoid.ts';
import { Animator } from './animator.ts';
import { sharedMocapLibrary, type RawMocapFile } from './mocap.ts';
import { JOINT_NAMES, type JointName } from './skeleton.ts';
import { ctx } from '../ai/enemyTestKit.ts';

// One-shot clips in kill beats (stinger-feed-and-rise, infection-kills "A kill beat can play a captured clip" and
// "Convulsion layers over captured motion"). Priya's pack is loaded with her body in the game; Node adds it directly.
sharedMocapLibrary().addPack('priya', priyaPack as unknown as RawMocapFile);

const TRUNK: readonly JointName[] = ['pelvis', 'spine', 'chest', 'neck', 'head', 'thigh_L', 'thigh_R', 'shin_L', 'upperArm_R'];

/** A raised-corpse body in a kill, lying prone, then (optionally) playing `priya_rise` at phase `u` for `frames`. */
function body(opts: { clip?: boolean; u?: number; convulse?: number; frames?: number } = {}): Humanoid {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  h.beginKill();
  h.setPose('corpseProne', 0.01);
  h.update(1 / 30);
  h.killConvulse(opts.convulse ?? 0, 100);
  if (opts.clip !== false) {
    assert.ok(h.playKillClip('priya_rise', 0.01) !== null);
    h.killClipPhase(opts.u ?? 0.5);
  }
  for (let i = 0; i < (opts.frames ?? 20); i++) h.update(1 / 30);
  return h;
}

const rotations = (h: Humanoid): THREE.Quaternion[] => JOINT_NAMES.map((j) => h.bones[j].quaternion.clone());
const maxAngle = (a: THREE.Quaternion[], b: THREE.Quaternion[], only?: readonly JointName[]): number =>
  Math.max(...JOINT_NAMES.map((j, i) => (only && !only.includes(j) ? 0 : a[i]!.angleTo(b[i]!))));

test('playKillClip finds priya_rise in her pack and returns its length; an unknown clip returns null', () => {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  h.beginKill();
  assert.ok(Math.abs(h.playKillClip('priya_rise', 0.3)! - 4.4) < 0.01);
  assert.equal(h.playKillClip('no_such_clip', 0.3), null);
  h.dispose();
});

test('the clip drives the body: the trunk moves a long way from lying (u 0) to standing (u 1)', () => {
  const lying = body({ u: 0 });
  const standing = body({ u: 1 });
  const moved = maxAngle(rotations(lying), rotations(standing), ['pelvis', 'thigh_L', 'shin_L']);
  assert.ok(moved > 0.8, `hips and legs turned ${moved.toFixed(2)} rad from lying to standing`);
  lying.dispose();
  standing.dispose();
});

test('without convulsion the body is the clip, frame for frame (same phase -> same pose)', () => {
  const a = body({ u: 0.6 });
  const b = body({ u: 0.6, frames: 35 });
  assert.ok(maxAngle(rotations(a), rotations(b), TRUNK) < 0.002, 'held clip frame: only spring settling (< 0.1 deg)');
  a.dispose();
  b.dispose();
});

test('convulsion layers over the clip: joints shake around the clip pose, not replace it', () => {
  const still = body({ u: 0.6 });
  const shaking = body({ u: 0.6, convulse: 0.1 });
  const lying = body({ u: 0 });
  const shake = maxAngle(rotations(still), rotations(shaking));
  const clipMotion = maxAngle(rotations(lying), rotations(still), ['pelvis', 'thigh_L', 'shin_L']);
  assert.ok(shake > 0.005, `convulsion moves the joints (${shake.toFixed(3)} rad)`);
  assert.ok(shake < clipMotion * 0.5, `but far less than the clip itself (${shake.toFixed(3)} vs ${clipMotion.toFixed(3)} rad)`);
  still.dispose();
  shaking.dispose();
  lying.dispose();
});

test('the body keeps the clip while it plays (its own per-frame pose choice does not cut it) and setPose stops it', () => {
  const h = body({ u: 0.5 });
  const held = rotations(h);
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  assert.ok(maxAngle(held, rotations(h), TRUNK) < 0.002, 'still on the clip after a second of updates');
  h.setPose('idle', 0.2);
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  assert.ok(maxAngle(held, rotations(h), ['pelvis', 'thigh_L']) > 0.2, 'blended away to idle');
  h.dispose();
});

test('a body that never plays a clip convulses exactly as before (its convulsion clock is its time)', () => {
  const h = body({ clip: false, convulse: 0.7, frames: 90 });
  const a = (h as unknown as { animator: { time: number; convulsePhase: number } }).animator;
  assert.equal(a.convulsePhase, a.time);
  h.dispose();
});

test('during a clip the convulsion clock runs at a third of its speed', () => {
  assert.ok(Math.abs(Animator.CLIP_CONVULSE_RATE - 1 / 3) < 1e-9);
  const h = body({ u: 0.4, convulse: 0.1, frames: 60 });
  const a = (h as unknown as { animator: { time: number; convulsePhase: number } }).animator;
  // One frame before the clip at full rate, then 60 frames under it.
  const expected = 1 / 30 + (60 / 30) * Animator.CLIP_CONVULSE_RATE;
  assert.ok(Math.abs(a.convulsePhase - expected) < 1e-6, `${a.convulsePhase} vs ${expected}`);
  h.dispose();
});

test('the get-up starts where the body lies: no jump or dip through the floor in the blend, and the origin moves under it', () => {
  const h = new Humanoid({ seed: 'rise-test', outfit: 'crew', role: 'npc' }, ctx());
  h.group.position.set(4, 0, 7);
  h.setHeading(1.1);
  h.beginKill();
  h.setPose('corpseProne', 0.01);
  for (let i = 0; i < 30; i++) h.update(1 / 30);
  const at = (j: JointName): THREE.Vector3 => h.bones[j].getWorldPosition(new THREE.Vector3());
  h.group.updateMatrixWorld(true);
  const lying = { head: at('head'), pelvis: at('pelvis'), origin: h.group.position.clone() };
  h.playKillClip('priya_rise', 0.3);
  let prev = lying.head.clone();
  let jump = 0;
  let low = Infinity;
  for (let f = 0; f < 12; f++) {
    h.killClipPhase(f / 132);
    h.update(1 / 30);
    h.group.updateMatrixWorld(true);
    const head = at('head');
    jump = Math.max(jump, head.distanceTo(prev));
    low = Math.min(low, head.y);
    prev = head;
  }
  assert.ok(jump < 0.04, `head moves at most ${jump.toFixed(3)} m a frame while the clip blends in`);
  assert.ok(low > 0.05, `head stays above the floor (lowest ${low.toFixed(2)} m)`);
  assert.ok(at('pelvis').distanceTo(lying.pelvis) < 0.12, 'hips start where they lay');
  assert.ok(h.group.position.distanceTo(lying.origin) > 0.3, 'the origin moved under the body');
  assert.equal(h.group.position.y, lying.origin.y, 'on the floor plane');
  h.dispose();
});

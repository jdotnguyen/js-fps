import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';
import { loadMainCast, makeLib, type MainCastModel } from './castModelTestKit.ts';
import type { FingerBoneDef } from './handPhysics.ts';
import { Humanoid } from './humanoid.ts';
import type { Side } from './skeleton.ts';
import { OKAFOR } from './squadLooks.ts';

/**
 * Hands at rest (imported-body-models: a prepared body's palms rest toward the thighs; standing-posture-stability: Okafor waits
 * for Jay). Okafor's model is bound holding a clipboard with its forearms turned palm-forward. Until scripts/fix-doctor-glb.mjs
 * turned them back, his prepared body rested its palms 30° (left) and 42° (right) forward of his thighs, and every clip played on
 * top of that. In his standing idle the palms turned 41° and 52° forward, almost outward, with the hands held 14-17 cm in front of
 * the hip joints because the take also carried his arms forward (scripts/mocap.sources.json `hangArms`).
 *
 * Palm direction is read from the knuckle row, as bodyModel.ts calibrates it: 0° when the index-to-pinky line points straight back
 * (palm to the thigh), positive as the palm turns forward.
 */

const REST_LIMIT = 25;
const IDLE_PALM_LIMIT = 20;
const IDLE_WRIST_FORWARD = 0.14;

/** Every main cast body with a hand rig (Ruiz's and Sung's scans fuse their fingers). */
const HAND_RIGGED: readonly MainCastModel[] = ['mechanic', 'doctor', 'priya', 'hale', 'heins', 'office_3', 'bram'];

const sign = (s: Side): number => (s === 'L' ? 1 : -1);
const deg = (r: number): number => THREE.MathUtils.radToDeg(r);

test('every hand-rigged main cast body rests each palm toward its thigh', async () => {
  const bad: string[] = [];
  for (const id of HAND_RIGGED) {
    const m = await loadMainCast(id);
    for (const s of ['L', 'R'] as const) {
      // Rest space: facing -Z with the left side at -X; the knuckles' offsets from the hand are in that frame.
      const knuckle = (finger: string): number[] | undefined =>
        (m.handBones.find((b): b is FingerBoneDef => b.kind === 'finger' && b.name === `finger_${s}_${finger}_1`)?.offset as number[] | undefined);
      const index = knuckle('index');
      const pinky = knuckle('pinky') ?? knuckle('ring');
      assert.ok(index && pinky, `${id} ${s}: knuckles`);
      const roll = deg(Math.atan2(sign(s) * (pinky[0]! - index[0]!), pinky[2]! - index[2]!));
      if (Math.abs(roll) > REST_LIMIT) bad.push(`${id} ${s} palm ${roll.toFixed(0)}° ${roll > 0 ? 'forward' : 'back'}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('Okafor stands idle with his palms toward his thighs and his hands at his sides', async () => {
  const bodyModels = makeLib({ doctor: await loadMainCast('doctor') });
  const h = new Humanoid({ ...OKAFOR, role: 'npc', pose: 'idle' }, { ...enemyCtx(), bodyModels });
  const fingers = new Map<string, THREE.Object3D>();
  h.group.traverse((o) => {
    if (/^finger_[LR]_(index|pinky)_1$/.test(o.name)) fingers.set(o.name, o);
  });
  const FPS = 30;
  const sum = { rollL: 0, rollR: 0, wristL: 0, wristR: 0, n: 0 };
  const wp = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
  // Settle, then one pass of his eight-second idle.
  for (let i = 0; i < 10 * FPS; i++) {
    h.update(1 / FPS);
    if (i < 2 * FPS) continue;
    h.group.updateMatrixWorld(true);
    // A level frame at the chest: +x toward the left shoulder, +y up, +z forward.
    const x = wp(h.bones.upperArm_L).sub(wp(h.bones.upperArm_R)).setY(0).normalize();
    const z = new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)).normalize();
    for (const s of ['L', 'R'] as const) {
      const across = wp(fingers.get(`finger_${s}_pinky_1`)!).sub(wp(fingers.get(`finger_${s}_index_1`)!));
      sum[`roll${s}`] += deg(Math.atan2(-sign(s) * across.dot(x), -across.dot(z)));
      sum[`wrist${s}`] += wp(h.bones[`hand_${s}`]).sub(wp(h.bones[`thigh_${s}`])).dot(z);
    }
    sum.n++;
  }
  h.dispose();
  for (const s of ['L', 'R'] as const) {
    const roll = sum[`roll${s}`] / sum.n;
    const wrist = sum[`wrist${s}`] / sum.n;
    assert.ok(Math.abs(roll) <= IDLE_PALM_LIMIT, `${s} palm turned ${roll.toFixed(0)}° ${roll > 0 ? 'forward' : 'back'} of his thigh on average`);
    assert.ok(wrist <= IDLE_WRIST_FORWARD, `${s} wrist held ${(wrist * 100).toFixed(1)} cm in front of his hip joint on average`);
  }
});

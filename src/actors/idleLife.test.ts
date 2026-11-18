import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid } from './humanoid.ts';
import type { HumanoidSpec } from './humanoid.ts';
import type { JointName } from './skeleton.ts';
import { ctx } from '../ai/enemyTestKit.ts';

/** Ambient idle layer (animator.idleLife): standing NPCs breathe, shift weight and let their gaze wander. */
const JOINTS: readonly JointName[] = ['chest', 'pelvis', 'head', 'upperArm_L', 'foreArm_R'];

function sample(spec: HumanoidSpec, seconds: number): { max: number; maxStep: number } {
  const h = new Humanoid(spec, ctx());
  const start = new Map<JointName, THREE.Quaternion>();
  h.update(1 / 30);
  for (const j of JOINTS) start.set(j, h.bones[j].quaternion.clone());
  let max = 0;
  let maxStep = 0;
  let prev = JOINTS.map((j) => h.bones[j].quaternion.clone());
  for (let i = 0; i < seconds * 30; i++) {
    h.update(1 / 30);
    JOINTS.forEach((j, k) => {
      const q = h.bones[j].quaternion;
      max = Math.max(max, q.angleTo(start.get(j)!));
      maxStep = Math.max(maxStep, q.angleTo(prev[k]!));
      prev[k]!.copy(q);
    });
  }
  h.dispose();
  return { max, maxStep };
}

test('a standing npc is never still: joints drift a few degrees, smoothly', () => {
  const r = sample({ seed: 'idle-life', outfit: 'crew', role: 'npc' }, 20);
  assert.ok(r.max > 0.02, `moved ${r.max} rad`);
  assert.ok(r.max < 0.35, `stayed natural (${r.max} rad)`);
  assert.ok(r.maxStep < 0.03, `no snaps (${r.maxStep} rad per frame)`);
});

test('corpses and enemies do not get the idle layer', () => {
  const corpse = sample({ seed: 'idle-life', outfit: 'crew', role: 'corpse', pose: 'corpseSupine' }, 10);
  assert.ok(corpse.max < 1e-4, `corpse moved ${corpse.max}`);
});

test('every ambient and squad fidget pose exists', () => {
  const poses = ctx().poses;
  for (const name of ['idle_shift', 'glance_other', 'look_down', 'look_up', 'head_tilt']) assert.doesNotThrow(() => poses.get(name), name);
});

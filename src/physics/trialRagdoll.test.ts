import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Humanoid } from '../actors/humanoid.ts';
import { ctx as humanoidCtx } from '../ai/enemyTestKit.ts';
import type { PhysicsEngine } from './engine.ts';
import { createRapierEngine } from './rapierAdapter.ts';
import { RAGDOLL_PARTS, TrialRagdoll } from './trialRagdoll.ts';

// adopt-physics-engine Block 0: the three trial cases, headless, with a procedural shambler.

const STEP = 1 / 60;

function shambler(x: number, y: number, z: number): Humanoid {
  const h = new Humanoid({ seed: 'trial', outfit: 'crew', role: 'enemy', infection: 1 }, humanoidCtx());
  h.group.position.set(x, y, z);
  h.group.visible = true;
  h.update(STEP, null);
  h.group.updateMatrixWorld(true);
  return h;
}

/** Floor at y 0, plus four 0.2 m steps rising toward -z, starting at z = 0. */
function stage(e: PhysicsEngine, stairs: boolean): void {
  e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 10, y: 0.1, z: 10 } }, offset: { x: 0, y: -0.1, z: 0 } }, null);
  if (!stairs) return;
  for (let i = 0; i < 4; i++) {
    const top = 0.2 * (i + 1);
    e.createCollider({ shape: { kind: 'cuboid', halfExtents: { x: 1.5, y: top / 2, z: 0.15 } }, offset: { x: 0, y: top / 2, z: -0.15 - 0.3 * i } }, null);
  }
}

/** Distance between each body and its parent body's anchor bone, to catch joints pulled apart. */
function maxJointGap(h: Humanoid, r: TrialRagdoll, e: PhysicsEngine): number {
  let worst = 0;
  for (const part of RAGDOLL_PARTS) {
    if (!part.parent) continue;
    const p = e.transform(r.body(part.bone)!).position;
    const bone = h.bones[part.bone].getWorldPosition(new THREE.Vector3());
    worst = Math.max(worst, bone.distanceTo(new THREE.Vector3(p.x, p.y, p.z)));
  }
  return worst;
}

test('a dropped ragdoll lands in one piece, stays above the floor and settles', async () => {
  const e = await createRapierEngine();
  stage(e, false);
  const h = shambler(0, 0.3, 0);
  const r = new TrialRagdoll(e, h.bones, { group: 1, velocity: { x: 1.5, y: 0, z: 0 } });
  assert.equal(r.bodies.length, 14);
  let lowest = Infinity;
  let settledAt = -1;
  for (let i = 0; i < 8 * 60; i++) {
    e.step(STEP);
    for (const b of r.bodies) lowest = Math.min(lowest, e.transform(b.handle).position.y);
    if (settledAt < 0 && r.maxSpeed() < 0.05) settledAt = i * STEP;
  }
  r.writeBones();
  h.group.updateMatrixWorld(true);
  const gap = maxJointGap(h, r, e);
  console.log(`[trial] flat drop: settled at ${settledAt.toFixed(2)} s, lowest body ${lowest.toFixed(3)} m, joint gap ${(gap * 100).toFixed(1)} cm`);
  assert.ok(lowest > -0.05, `no body sinks through the floor (${lowest.toFixed(3)})`);
  assert.ok(settledAt >= 0 && settledAt < 6, `settles within 6 s (${settledAt.toFixed(2)})`);
  assert.ok(gap < 0.02, `bones follow their bodies (${(gap * 100).toFixed(1)} cm)`);
  r.destroy();
  assert.deepEqual(e.liveCounts(), { bodies: 0, colliders: 1, joints: 0 }, "only the floor is left");
  e.destroy();
});

test('a chest shot on the stairs sends the body back down them, resting on the steps or the floor', async () => {
  const e = await createRapierEngine();
  stage(e, true);
  // Standing on the third step (top at 0.6 m), facing down the stairs (+z), shot from below.
  const h = shambler(0, 0.6, -0.75);
  h.setHeading(Math.PI);
  h.update(STEP, null);
  h.group.updateMatrixWorld(true);
  const r = new TrialRagdoll(e, h.bones, { group: 2 });
  e.applyImpulse(r.body('chest')!, { x: 0, y: 0, z: -35 });
  let settledAt = -1;
  for (let i = 0; i < 8 * 60; i++) {
    e.step(STEP);
    if (settledAt < 0 && i > 30 && r.maxSpeed() < 0.05) settledAt = i * STEP;
  }
  const pelvis = e.transform(r.body('pelvis')!).position;
  let lowest = Infinity;
  for (const b of r.bodies) lowest = Math.min(lowest, e.transform(b.handle).position.y);
  console.log(`[trial] stairs: settled at ${settledAt.toFixed(2)} s, pelvis at y ${pelvis.y.toFixed(2)} z ${pelvis.z.toFixed(2)}, lowest body ${lowest.toFixed(3)} m`);
  assert.ok(pelvis.z < -0.75, `falls back along the shot (pelvis z ${pelvis.z.toFixed(2)})`);
  assert.ok(lowest > -0.05, 'nothing ends up under the floor');
  assert.ok(settledAt >= 0, 'settles');
  r.destroy();
  e.destroy();
});

test('a powered ragdoll (kinematic pelvis, world-space pose drive) holds the animated pose and recovers from a shoulder hit', async () => {
  const e = await createRapierEngine();
  stage(e, false);
  const h = shambler(0, 0, 0);
  const r = new TrialRagdoll(e, h.bones, { group: 3, kinematicPelvis: true });
  // Joint motors cannot hold this chain under gravity in Rapier (see design "Block 0 result"); the world-space
  // drive pulls each body to its animated pose with velocity and gravity feed-forward.
  const tick = (): void => {
    h.update(STEP, null);
    h.group.updateMatrixWorld(true);
    r.driveToBonesWorld(1600, 70, STEP);
    e.step(STEP);
  };
  let held = 0;
  for (let i = 0; i < 60; i++) {
    tick();
    if (i >= 20) held = Math.max(held, r.poseError());
  }
  // A shotgun-strength shove to the right shoulder and chest. The peak is taken in the first 0.25 s only:
  // later spikes come from the shambler's own lurching animation, not the hit.
  e.applyImpulse(r.body('upperArm_R')!, { x: 0, y: 0, z: 60 });
  e.applyImpulse(r.body('chest')!, { x: 0, y: 0, z: 60 });
  let peak = 0;
  let backAt = -1;
  for (let i = 1; i <= 36; i++) {
    tick();
    const err = r.poseError();
    if (i <= 15) peak = Math.max(peak, err);
    if (backAt < 0 && i > 1 && peak > 0.04 && err < 0.03) backAt = i * STEP;
  }
  console.log(`[trial] powered (world drive): held error up to ${(held * 100).toFixed(1)} cm, hit peak ${(peak * 100).toFixed(1)} cm, back within 3 cm at ${backAt < 0 ? 'never' : `${backAt.toFixed(2)} s`}`);
  assert.ok(held < 0.035, `holds the animated pose before the hit (${(held * 100).toFixed(1)} cm)`);
  assert.ok(peak > 0.04, `the hit visibly pushes the body (${(peak * 100).toFixed(1)} cm)`);
  assert.ok(backAt >= 0 && backAt <= 0.6, `returns near the animated pose within 0.6 s (${backAt.toFixed(2)} s)`);
  r.destroy();
  e.destroy();
});

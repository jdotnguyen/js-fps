import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { limitUse, swingTwist } from './limits.ts';
import { loadJuggernaut } from './creatureTestKit.ts';
import type { CreatureRig, RigJoint } from './rig.ts';

// openspec rig-juggernaut, spec creature-rig "Head and eyes look at targets" and "The aim point follows the head".

const R2D = 180 / Math.PI;
const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const turned = (rig: CreatureRig, j: RigJoint) => rig.delta(j).normalize().angleTo(new THREE.Quaternion()) * R2D;
const atLimit = (rig: CreatureRig, j: RigJoint) => {
  const u = limitUse(swingTwist(rig.delta(j).normalize(), j.limit), j.limit);
  return Math.max(u.twist, u.swing) >= 0.995;
};

/** A point `deg` to the creature's side (about its up axis) from straight ahead of its head, `dist` metres out. */
function aside(rig: CreatureRig, deg: number, dist = 6): THREE.Vector3 {
  const head = rig.joint('head_09');
  const fwd = rig.lookAt.forward(head, new THREE.Vector3());
  fwd.y = 0;
  fwd.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), deg / R2D);
  return pos(head.bone).add(fwd.multiplyScalar(dist));
}

test('a target 20 degrees aside: neck and head share the turn, the head faces it, every eye aims at it (2 degrees)', async () => {
  const { rig } = await loadJuggernaut();
  rig.update(0);
  const target = aside(rig, 20);
  rig.setLookTarget(target);
  rig.update(0);
  const head = rig.joint('head_09');
  const err = rig.lookAt.error(head) * R2D;
  assert.ok(err <= 2, `head ${err.toFixed(2)} deg off`);
  assert.ok(turned(rig, rig.lookAt.neck) > 1 && turned(rig, head) > 1, `neck ${turned(rig, rig.lookAt.neck).toFixed(1)} deg, head ${turned(rig, head).toFixed(1)} deg`);
  for (const eye of rig.lookAt.eyes) {
    const e = rig.lookAt.error(eye) * R2D;
    assert.ok(e <= 2, `${eye.name} ${e.toFixed(2)} deg off`);
  }
});

test('a target past the head\'s limit: the head stops at its limit, the eyes turn further to theirs', async () => {
  const { rig } = await loadJuggernaut();
  rig.update(0);
  rig.setLookTarget(aside(rig, 150));
  rig.update(0);
  const head = rig.joint('head_09');
  assert.ok(atLimit(rig, head) || atLimit(rig, rig.lookAt.neck), 'neck or head at its limit');
  assert.ok(rig.lookAt.error(head) * R2D > 10, 'the head cannot face it');
  for (const eye of rig.lookAt.eyes) {
    assert.ok(turned(rig, eye) > 5, `${eye.name} turns past the head (${turned(rig, eye).toFixed(1)} deg)`);
    assert.ok(atLimit(rig, eye), `${eye.name} stops at its limit`);
  }
});

test('the aim point rides the head: a 30 degree turn keeps its offset within 1 cm', async () => {
  const { rig } = await loadJuggernaut();
  rig.update(0);
  const head = rig.joint('head_09');
  const local = (p: THREE.Vector3) => p.applyMatrix4(new THREE.Matrix4().copy(head.bone.matrixWorld).invert());
  const scale = new THREE.Vector3().setFromMatrixScale(head.bone.matrixWorld).x;
  const before = local(rig.aimPoint(new THREE.Vector3()));
  const world0 = rig.aimPoint(new THREE.Vector3());
  // Turn about axes across the head-to-marker line (turning about the line itself would barely move the marker).
  const toMarker = before.clone().normalize();
  const across1 = new THREE.Vector3(0, 1, 0).cross(toMarker).normalize();
  const across2 = toMarker.clone().cross(across1).normalize();
  for (const axis of [across1, across2]) {
    rig.write(head, new THREE.Quaternion().setFromAxisAngle(axis, 30 / R2D));
    rig.model.updateMatrixWorld(true);
    assert.ok(rig.aimPoint(new THREE.Vector3()).distanceTo(world0) > 0.3, 'the aim point moved with the head');
    const gap = local(rig.aimPoint(new THREE.Vector3())).distanceTo(before) * scale;
    assert.ok(gap <= 0.01, `${(gap * 100).toFixed(2)} cm`);
  }
});

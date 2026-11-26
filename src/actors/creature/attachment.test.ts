import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadJuggernaut, skinnedMeshes, skinnedWorld } from './creatureTestKit.ts';
import type { CreatureRig, RigJoint } from './rig.ts';

// openspec rig-juggernaut D3, spec creature-rig "Hands and feet ride their limbs" and "Every part of a creature model is on
// its body": what hangs below a joint moves with it.

const D2R = Math.PI / 180;
const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const endOf = (j: RigJoint) => j.bone.children.find((c) => /_end/.test(c.name))!;

/** Rotate a joint by `deg` about a world-ish direction across its bone (in its neutral frame), then update the model. */
function swing(rig: CreatureRig, j: RigJoint, dir: THREE.Vector3, deg: number): void {
  const across = dir.clone().addScaledVector(j.limit.axis, -dir.dot(j.limit.axis)).normalize();
  assert.equal(rig.write(j, new THREE.Quaternion().setFromAxisAngle(across, deg * D2R)), false, `${j.name} ${deg} deg is inside its limit`);
  rig.model.updateMatrixWorld(true);
}

const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => new THREE.Vector3(Math.cos(a * D2R), 0, Math.sin(a * D2R)));

test('swinging an upper arm 45 degrees in any direction carries the hand and its fingers', async () => {
  const { rig } = await loadJuggernaut();
  for (const side of ['L', 'R']) {
    const upper = rig.chain(`arm.${side}` as 'arm.L')[1]!;
    const fore = rig.chain(`arm.${side}` as 'arm.L')[2]!;
    const hand = rig.chain(`arm.${side}` as 'arm.L')[3]!;
    const fingers = rig.chain(`fingers.${side}` as 'fingers.L');
    for (const dir of DIRECTIONS) {
      rig.setPose(null);
      rig.update(0);
      const gap0 = pos(endOf(fore)).distanceTo(pos(hand.bone));
      const handInv = new THREE.Matrix4().copy(hand.bone.matrixWorld).invert();
      const fingers0 = fingers.map((f) => pos(f.bone).applyMatrix4(handInv));
      const hand0 = pos(hand.bone);
      swing(rig, upper, dir, 45);
      assert.ok(pos(hand.bone).distanceTo(hand0) > 0.5, 'the hand moved');
      const gap = pos(endOf(fore)).distanceTo(pos(hand.bone));
      assert.ok(Math.abs(gap - gap0) <= 0.001, `arm.${side}: forearm end to hand ${(gap * 1000).toFixed(2)} mm, was ${(gap0 * 1000).toFixed(2)}`);
      const inv = new THREE.Matrix4().copy(hand.bone.matrixWorld).invert();
      fingers.forEach((f, i) => assert.ok(pos(f.bone).applyMatrix4(inv).distanceTo(fingers0[i]!) < 1e-6, `${f.name} stays on the hand`));
    }
  }
});

test('bending a thigh 30 degrees carries the foot on the last leg segment', async () => {
  const { rig } = await loadJuggernaut();
  for (const side of ['L', 'R']) {
    const [thigh, , third, foot] = rig.chain(`leg.${side}` as 'leg.L') as [RigJoint, RigJoint, RigJoint, RigJoint];
    for (const dir of DIRECTIONS) {
      rig.setPose(null);
      rig.update(0);
      const gap0 = pos(endOf(third)).distanceTo(pos(foot.bone));
      const foot0 = pos(foot.bone);
      swing(rig, thigh, dir, 30);
      assert.ok(pos(foot.bone).distanceTo(foot0) > 0.3, 'the foot moved');
      const gap = pos(endOf(third)).distanceTo(pos(foot.bone));
      assert.ok(Math.abs(gap - gap0) <= 0.001, `leg.${side}: ${(Math.abs(gap - gap0) * 1000).toFixed(3)} mm`);
    }
  }
});

test('turning the head 30 degrees carries the eyes, teeth and tongue with it (1 cm)', async () => {
  const { scene, rig } = await loadJuggernaut();
  rig.update(0);
  const head = rig.joint('head_09');
  const details = skinnedMeshes(scene).get('details')!;
  assert.equal(details.length, 4, 'eyes, teeth, tongue, tongue teeth');
  const inHead = () => {
    const inv = new THREE.Matrix4().copy(head.bone.matrixWorld).invert();
    return details.map((m) => skinnedWorld(m).map((p) => p.applyMatrix4(inv)));
  };
  const before = inHead();
  for (const axis of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    rig.setPose(null);
    rig.update(0);
    const world0 = skinnedWorld(details[0]!)[0]!;
    rig.write(head, new THREE.Quaternion().setFromAxisAngle(axis, 30 * D2R));
    rig.model.updateMatrixWorld(true);
    assert.ok(skinnedWorld(details[0]!)[0]!.distanceTo(world0) > 0.1, 'the face moved in the world');
    const after = inHead();
    details.forEach((m, i) => {
      const worst = Math.max(...after[i]!.map((p, k) => p.distanceTo(before[i]![k]!)));
      assert.ok(worst * new THREE.Vector3().setFromMatrixScale(head.bone.matrixWorld).x <= 0.01, `${m.name}: ${(worst * 100).toFixed(2)} cm in the head's frame`);
    });
  }
});

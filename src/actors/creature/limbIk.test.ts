import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { limitUse, swingTwist } from './limits.ts';
import { loadJuggernaut } from './creatureTestKit.ts';
import type { LimbSide } from './limbIk.ts';
import type { CreatureRig } from './rig.ts';

// openspec rig-juggernaut D12, spec creature-rig "Arms reach targets" and "Three-segment legs plant their feet".

const D2R = Math.PI / 180;
const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

function assertLengths(before: number[], after: number[], what: string): void {
  before.forEach((l, i) => assert.ok(Math.abs(after[i]! - l) <= 0.001, `${what}: segment ${i} ${(after[i]! * 1000).toFixed(2)} mm, was ${(l * 1000).toFixed(2)}`));
}

function assertInside(rig: CreatureRig, side: LimbSide): void {
  for (const j of rig.chain(side)) {
    const u = limitUse(swingTwist(rig.delta(j).normalize(), j.limit), j.limit);
    assert.ok(u.twist <= 1 + 1e-6 && u.swing <= 1 + 1e-6, `${j.name} inside its limit`);
  }
}

/** How far the elbow or knee sits toward `pole`, off the line from the limb's root to its end. */
function poleSide(rig: CreatureRig, side: LimbSide, pole: THREE.Vector3): number {
  const limb = rig.limb(side);
  const a = pos(limb.root.bone);
  const b = pos(limb.end.bone);
  const m = pos(limb.hinges[0]!.bone).sub(a);
  const line = b.sub(a).normalize();
  return m.addScaledVector(line, -m.dot(line)).dot(pole);
}

for (const side of ['arm.L', 'arm.R'] as const) {
  test(`${side}: a reachable hand target is met within 1 cm, the elbow on the pole's side, no bone stretched`, async () => {
    const { rig, scene } = await loadJuggernaut();
    rig.update(0);
    const limb = rig.limb(side);
    const lengths = limb.segmentLengths();
    const sign = side === 'arm.L' ? 1 : -1;
    const targets = [
      new THREE.Vector3(0.3 * sign, 0.5, 0.6),
      new THREE.Vector3(-0.4 * sign, 0.9, 0.2),
      new THREE.Vector3(0.2 * sign, -0.3, -0.5),
    ].map((d) => pos(limb.end.bone).add(d));
    const pole = new THREE.Vector3(...rig.def.ik[side].pole).applyQuaternion(scene.quaternion);
    for (const t of targets) {
      rig.setLimbTarget(side, t);
      rig.update(0);
      assert.ok(limb.lastError <= 0.01, `${side} reaches ${t.toArray().map((x) => x.toFixed(2))} within ${(limb.lastError * 100).toFixed(2)} cm`);
      assert.ok(poleSide(rig, side, pole) > 0, 'elbow on the pole side');
      assertLengths(lengths, limb.segmentLengths(), side);
      assertInside(rig, side);
    }
  });

  test(`${side}: a hand target out of reach straightens the arm toward it without stretching`, async () => {
    const { rig } = await loadJuggernaut();
    rig.update(0);
    const limb = rig.limb(side);
    const lengths = limb.segmentLengths();
    const root = pos(limb.root.bone);
    const far = pos(limb.end.bone).sub(root).normalize().multiplyScalar(30).add(root);
    rig.setLimbTarget(side, far);
    rig.update(0);
    const dir = pos(limb.end.bone).sub(root).normalize();
    const off = dir.angleTo(far.clone().sub(root).normalize()) / D2R;
    assert.ok(off <= 2, `arm points at the target (${off.toFixed(2)} deg off)`);
    const elbow = swingTwist(rig.delta(limb.hinges[0]!).normalize(), limb.hinges[0]!.limit).twist;
    assert.ok(Math.abs(elbow - limb.hinges[0]!.limit.twist[0]) < 1e-6, 'the elbow is at its straightest');
    assertLengths(lengths, limb.segmentLengths(), side);
  });
}

for (const side of ['leg.L', 'leg.R'] as const) {
  test(`${side}: a foot target on level ground is planted within 1 cm, sole flat, ankle behind the knee`, async () => {
    const { rig, scene } = await loadJuggernaut();
    rig.update(0);
    const limb = rig.limb(side);
    const lengths = limb.segmentLengths();
    const neutralContact = limb.contactPoint(new THREE.Vector3());
    const forward = new THREE.Vector3(...rig.def.forward).applyQuaternion(scene.quaternion);
    const pole = new THREE.Vector3(...rig.def.ik[side].pole).applyQuaternion(scene.quaternion);
    for (const d of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 0, 0.5), new THREE.Vector3(-0.2, 0, -0.4), new THREE.Vector3(0, 0.3, 0.2)]) {
      const target = neutralContact.clone().add(d);
      rig.setLimbTarget(side, target);
      rig.update(0);
      assert.ok(limb.lastError <= 0.01, `${side} planted within ${(limb.lastError * 100).toFixed(2)} cm`);
      const tilt = limb.soleUp(new THREE.Vector3()).angleTo(new THREE.Vector3(0, 1, 0)) / D2R;
      assert.ok(tilt <= 5, `sole ${tilt.toFixed(2)} deg off the ground`);
      const [knee, hock] = limb.hinges;
      assert.ok(pos(hock!.bone).sub(pos(knee!.bone)).dot(forward) < 0, 'the ankle (hock) stays behind the knee');
      assert.ok(poleSide(rig, side, pole) > 0, 'knee on the pole side');
      assertLengths(lengths, limb.segmentLengths(), side);
      assertInside(rig, side);
    }
  });

  test(`${side}: on a 15 degree slope the sole follows the ground`, async () => {
    const { rig } = await loadJuggernaut();
    rig.update(0);
    const limb = rig.limb(side);
    const target = limb.contactPoint(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0.2));
    for (const tiltAxis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 1).normalize()]) {
      const normal = new THREE.Vector3(0, 1, 0).applyAxisAngle(tiltAxis, 15 * D2R);
      rig.setLimbTarget(side, target, { groundNormal: normal });
      rig.update(0);
      const off = limb.soleUp(new THREE.Vector3()).angleTo(normal) / D2R;
      assert.ok(off <= 5, `sole ${off.toFixed(2)} deg off the slope`);
      assert.ok(limb.lastError <= 0.01, `planted within ${(limb.lastError * 100).toFixed(2)} cm`);
      assertInside(rig, side);
    }
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clampRotation, compileLimit, fromSwingTwist, limitUse, swingTwist } from './limits.ts';
import { loadJuggernaut } from './creatureTestKit.ts';
import type { CreatureRig } from './rig.ts';

// openspec rig-juggernaut D6, spec creature-rig "Joints stay inside their limits".

const D2R = Math.PI / 180;

test('swing and twist rebuild the rotation they came from', () => {
  const lim = compileLimit({ kind: 'ball', axis: [0.2, 1, 0.1], twist: [-180, 180], cone: [180, 180] });
  const rnd = mulberry(7);
  for (let i = 0; i < 200; i++) {
    const q = new THREE.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const back = fromSwingTwist(swingTwist(q, lim), lim, new THREE.Quaternion());
    assert.ok(Math.abs(Math.abs(back.dot(q)) - 1) < 1e-9, `rotation ${i}`);
  }
});

test('a hinge keeps the bend within its range and drops the wobble beyond its play', () => {
  const lim = compileLimit({ kind: 'hinge', axis: [1, 0, 0], range: [-10, 90], play: 2 });
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 120 * D2R);
  assert.equal(clampRotation(q, lim), true);
  assert.ok(Math.abs(swingTwist(q, lim).twist - 90 * D2R) < 1e-9, 'bend stops at 90');
  const back = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -40 * D2R);
  clampRotation(back, lim);
  assert.ok(Math.abs(swingTwist(back, lim).twist + 10 * D2R) < 1e-9, 'it straightens only to -10');
  const wobble = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 20 * D2R);
  clampRotation(wobble, lim);
  const st = swingTwist(wobble, lim);
  assert.ok(Math.abs(Math.hypot(st.su, st.sv) - 2 * D2R) < 1e-9, 'off-axis wobble cut to the play');
  const inside = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 30 * D2R);
  assert.equal(clampRotation(inside, lim), false, 'a bend inside the range is left alone');
});

test('a ball joint scales its swing back onto the ellipse, keeping its direction', () => {
  const lim = compileLimit({ kind: 'ball', twist: [-20, 20], cone: [40, 20] });
  const dir = new THREE.Vector3().addScaledVector(lim.u, 1).addScaledVector(lim.v, 1).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(dir, 80 * D2R);
  clampRotation(q, lim);
  const st = swingTwist(q, lim);
  assert.ok(Math.abs(limitUse(st, lim).swing - 1) < 1e-9, 'on the ellipse');
  assert.ok(Math.abs(st.su - st.sv) < 1e-9, 'same direction');
});

/** Every joint's rotation relative to neutral is within its limit. */
function assertInside(rig: CreatureRig, what: string): void {
  const st = { twist: 0, su: 0, sv: 0 };
  const q = new THREE.Quaternion();
  for (const j of rig.joints) {
    swingTwist(rig.delta(j, q).normalize(), j.limit, st);
    const use = limitUse(st, j.limit);
    assert.ok(use.twist <= 1 + 1e-6 && use.swing <= 1 + 1e-6, `${what}: ${j.name} twist ${use.twist.toFixed(4)} swing ${use.swing.toFixed(4)}`);
  }
}

test('a knee driven against its hinge stops at its limit', async () => {
  const { rig } = await loadJuggernaut();
  rig.update(0);
  const knee = rig.joint('leg2.L_065');
  const backwards = new THREE.Quaternion().setFromAxisAngle(knee.limit.axis, -150 * D2R);
  assert.equal(rig.write(knee, backwards), true);
  assert.ok(Math.abs(swingTwist(rig.delta(knee).normalize(), knee.limit).twist - knee.limit.twist[0]) < 1e-6, 'at its straight limit');
  // An IK target right under the hip asks for more fold than the knee has: it stops at its bent limit.
  const hip = rig.joint('leg1.L_064').bone.getWorldPosition(new THREE.Vector3());
  rig.setLimbTarget('leg.L', new THREE.Vector3(hip.x, hip.y - 0.4, hip.z));
  rig.update(0);
  assert.ok(rig.jointsAtLimit().some((j) => j.name === 'leg2.L_065'), 'knee at its limit');
  assertInside(rig, 'folded leg');
});

test('random poses, blends, face, IK and look targets never leave a joint outside its limits', async () => {
  const { rig } = await loadJuggernaut();
  const rnd = mulberry(42);
  const names = rig.poseNames();
  const v = () => new THREE.Vector3((rnd() - 0.5) * 8, rnd() * 6, (rnd() - 0.5) * 8);
  // Direct writes of arbitrary rotations.
  for (let i = 0; i < 1000; i++) {
    const j = rig.joints[Math.floor(rnd() * rig.joints.length)]!;
    rig.write(j, new THREE.Quaternion(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize());
  }
  assertInside(rig, 'direct writes');
  // Whole-rig updates with random inputs.
  for (let i = 0; i < 1000; i++) {
    if (i % 25 === 0) rig.setPose(rnd() < 0.2 ? null : names[Math.floor(rnd() * names.length)]!, rnd());
    if (i % 10 === 0) rig.setFace({ jaw: rnd(), tongueExtend: rnd(), tongueCurl: rnd() });
    if (i % 15 === 0) rig.setLookTarget(rnd() < 0.2 ? null : v());
    if (i % 20 === 0) for (const s of ['arm.L', 'arm.R', 'leg.L', 'leg.R'] as const) rig.setLimbTarget(s, rnd() < 0.3 ? null : v(), { groundNormal: new THREE.Vector3(rnd() - 0.5, 2, rnd() - 0.5) });
    rig.update(rnd() * 0.1);
    if (i % 50 === 0) assertInside(rig, `update ${i}`);
  }
  assertInside(rig, 'last update');
});

/** Small seeded random generator. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { limitUse, swingTwist } from './limits.ts';
import { loadJuggernaut, METRES_PER_UNIT, skinnedMeshes } from './creatureTestKit.ts';
import type { CreatureRig, RigJoint } from './rig.ts';

// openspec rig-juggernaut D8, spec creature-rig "Jaw and tongue are posable".

const use = (rig: CreatureRig, j: RigJoint) => {
  const st = swingTwist(rig.delta(j).normalize(), j.limit);
  return { ...limitUse(st, j.limit), st };
};

/** Skinned vertices of a mesh in the head's frame, grouped by the joint each vertex follows most. */
function teethRows(scene: THREE.Object3D, rig: CreatureRig, meshName: string): Map<string, THREE.Vector3[]> {
  const head = rig.joint('head_09').bone;
  const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
  const mesh = [...skinnedMeshes(scene).get('details')!].find((m) => m.geometry.attributes.position!.count === COUNTS[meshName])!;
  const idx = mesh.geometry.attributes.skinIndex!;
  const w = mesh.geometry.attributes.skinWeight!;
  const out = new Map<string, THREE.Vector3[]>();
  for (let i = 0; i < idx.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (w.getComponent(i, k) > w.getComponent(i, best)) best = k;
    const bone = mesh.skeleton.bones[idx.getComponent(i, best)]!.name;
    const p = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    out.set(bone, [...(out.get(bone) ?? []), p]);
  }
  return out;
}
const COUNTS: Record<string, number> = { teeth: 2968, tongue: 323 };

const box = (pts: THREE.Vector3[]) => new THREE.Box3().setFromPoints(pts);
function overlap(a: THREE.Box3, b: THREE.Box3): number {
  const i = a.clone().intersect(b);
  if (i.isEmpty()) return 0;
  const s = i.getSize(new THREE.Vector3());
  return s.x * s.y * s.z;
}

test('jaw 1 opens the lower mouth and both side jaws to their open limits, mirrored, and the teeth part', async () => {
  const { scene, rig } = await loadJuggernaut();
  rig.update(0);
  const shut = teethRows(scene, rig, 'teeth');
  const centre = (pts: THREE.Vector3[]) => pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const gap0 = centre(shut.get('uppermouth_011')!).distanceTo(centre(shut.get('lowermouth_010')!));
  rig.setFace({ jaw: 1 });
  rig.update(0);
  const lower = rig.joint('lowermouth_010');
  const lu = use(rig, lower);
  assert.ok(lu.twist >= 0.995 && lu.st.twist < 0, `lower mouth at its open limit (${lu.twist.toFixed(3)})`);
  for (const n of ['jaw1', 'jaw2']) {
    const l = rig.joints.find((j) => j.name.startsWith(`${n}.L`))!;
    const r = rig.joints.find((j) => j.name.startsWith(`${n}.R`))!;
    for (const j of [l, r]) {
      const u = use(rig, j);
      assert.ok(Math.max(u.twist, u.swing) >= 0.995, `${j.name} at its open limit`);
    }
    // Mirrored about the model's midline.
    const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    const tip = (j: RigJoint) => j.bone.children.find((c) => /jaw|_end/.test(c.name))!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const pl = tip(l);
    const pr = tip(r);
    assert.ok(new THREE.Vector3(-pl.x, pl.y, pl.z).distanceTo(pr) * METRES_PER_UNIT <= 0.01, `${n} opens symmetrically`);
  }
  const open = teethRows(scene, rig, 'teeth');
  const gap1 = centre(open.get('uppermouth_011')!).distanceTo(centre(open.get('lowermouth_010')!));
  assert.ok((gap1 - gap0) * METRES_PER_UNIT > 0.05, `the lower teeth move away with the lower mouth (${((gap1 - gap0) * METRES_PER_UNIT * 100).toFixed(1)} cm)`);
  // The upper and lower rows overlap no more than they do shut.
  const o = (rows: Map<string, THREE.Vector3[]>) => overlap(box(rows.get('uppermouth_011')!), box(rows.get('lowermouth_010')!));
  assert.ok(o(open) <= o(shut) + 1e-9, `overlap ${o(open).toFixed(5)} vs shut ${o(shut).toFixed(5)}`);
});

test('with the jaw open, the fully extended tongue reaches past the front teeth, inside its limits', async () => {
  const { scene, rig } = await loadJuggernaut();
  rig.setFace({ jaw: 1, tongueExtend: 1 });
  rig.update(0);
  const forward = rig.lookAt.forward(rig.joint('head_09'), new THREE.Vector3());
  const headPos = rig.joint('head_09').bone.getWorldPosition(new THREE.Vector3());
  const front = (pts: THREE.Vector3[]) => Math.max(...pts.map((p) => p.clone().sub(headPos).dot(forward)));
  const head = rig.joint('head_09').bone;
  const toWorld = (rows: Map<string, THREE.Vector3[]>) => [...rows.values()].flat().map((p) => p.clone().applyMatrix4(head.matrixWorld));
  const teeth = front(toWorld(teethRows(scene, rig, 'teeth')));
  const tongue = front(toWorld(teethRows(scene, rig, 'tongue')));
  assert.ok(tongue > teeth, `tongue front ${tongue.toFixed(3)} m past the teeth ${teeth.toFixed(3)} m`);
  for (const j of rig.chain('tongue')) {
    const u = use(rig, j);
    assert.ok(u.twist <= 1 + 1e-6 && u.swing <= 1 + 1e-6, `${j.name} inside its limit`);
  }
  // Curling moves the tip and stays inside the limits too.
  const tip = rig.joint('tongueup_017').bone;
  const before = tip.getWorldQuaternion(new THREE.Quaternion());
  rig.setFace({ tongueCurl: 1 });
  rig.update(0);
  assert.ok(tip.getWorldQuaternion(new THREE.Quaternion()).angleTo(before) > 0.3, 'the tip curls');
  for (const j of rig.chain('tongue')) assert.ok(use(rig, j).swing <= 1 + 1e-6, `${j.name} inside its limit curled`);
});

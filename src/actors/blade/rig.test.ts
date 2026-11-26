import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAX_BONES } from '../bodyMaterial.ts';
import { prepareBodyModel } from '../bodyModel.ts';
import { JOINTS } from '../skeleton.ts';
import { creatureBody, necromorphModel, necromorphScene } from './bladeTestKit.ts';

/** rig-necromorph task 4.2 (design D3): the blade creature's segment and belly-arm bones. */

test('the creature keeps its neck and back segments and all 28 weighted belly-arm bones', async () => {
  const m = await necromorphModel();
  const segs = m.creatureBones.filter((b) => b.kind === 'segment');
  const limbs = m.creatureBones.filter((b) => b.kind === 'limb');
  assert.deepEqual(segs.map((s) => `${s.name}:${s.fraction.toFixed(2)}`), ['seg_neck_0:0.33', 'seg_neck_1:0.67', 'seg_chest_0:0.50']);
  assert.equal(limbs.length, 28, `${limbs.length} belly-arm bones`);
  // Every one of them carries skin.
  const slots = new Set<number>();
  for (const p of m.parts) {
    const si = p.geometry.getAttribute('skinIndex');
    const sw = p.geometry.getAttribute('skinWeight');
    for (let v = 0; v < si.count; v++) for (let k = 0; k < 4; k++) if (sw.getComponent(v, k) > 0.01) slots.add(si.getComponent(v, k));
  }
  m.creatureBones.forEach((b, i) => assert.ok(slots.has(JOINTS.length + m.handBones.length + i), `${b.name} carries skin`));
});

test('the body fits the bone budget', async () => {
  const h = await creatureBody('flood_elite');
  let n = 0;
  h.group.traverse((o) => (o as THREE.Bone).isBone && n++);
  assert.ok(n <= MAX_BONES, `${n} bones`);
});

test('a neck or back bend is spread over its segments, no segment taking more than half', async () => {
  const h = await creatureBody('flood_elite');
  const bend = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0.2, 0));
  h.group.getObjectByName('neck')!.quaternion.copy(bend);
  h.group.getObjectByName('chest')!.quaternion.copy(bend);
  // One update applies the shares (the animator moves the joints too, so read the shares against the joints' own turn).
  (h as unknown as { updateSegments(): void }).updateSegments();
  for (const [joint, chain] of [['neck', ['seg_neck_0', 'seg_neck_1']], ['chest', ['seg_chest_0']]] as const) {
    const full = h.group.getObjectByName(joint)!.quaternion;
    const total = 2 * Math.acos(Math.min(1, Math.abs(full.w)));
    let prev = new THREE.Quaternion();
    for (const name of [...chain, joint]) {
      const q = name === joint ? full : h.group.getObjectByName(name)!.quaternion;
      const step = prev.angleTo(q);
      assert.ok(step <= total / 2 + 1e-6, `${name} turns ${step.toFixed(3)} of ${total.toFixed(3)} rad`);
      prev = q.clone();
    }
  }
});

test('the belly arms stay rooted when the blades lift', async () => {
  const h = await creatureBody('flood_elite');
  const skinned = (): THREE.Vector3[] => {
    h.group.updateMatrixWorld(true);
    const out: THREE.Vector3[] = [];
    h.group.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.skeleton.update();
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      const limb = new Set(m.skeleton.bones.map((b, i) => (b.name.startsWith('limb_') ? i : -1)).filter((i) => i >= 0));
      for (let v = 0; v < si.count; v++) {
        let w = 0;
        for (let k = 0; k < 4; k++) if (limb.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
        if (w > 0.99) out.push(m.localToWorld(m.getVertexPosition(v, new THREE.Vector3())));
      }
    });
    return out;
  };
  const rest = skinned();
  assert.ok(rest.length > 100, `${rest.length} belly-arm vertices`);
  for (const s of ['L', 'R']) h.group.getObjectByName(`upperArm_${s}`)!.rotation.set(1.4, 0, 0);
  const lifted = skinned();
  const worst = Math.max(...rest.map((p, i) => p.distanceTo(lifted[i]!)));
  assert.ok(worst < 1e-4, `a belly-arm vertex moved ${worst} m`);
});

test('without the creature option the same model prepares exactly as before', async () => {
  const plain = prepareBodyModel(await necromorphScene());
  assert.equal(plain.creatureBones.length, 0);
  const rigged = await necromorphModel();
  for (const j of JOINTS) assert.deepEqual(rigged.jointOffsets[j.name], plain.jointOffsets[j.name], j.name);
  assert.equal(rigged.triangles, plain.triangles);
});

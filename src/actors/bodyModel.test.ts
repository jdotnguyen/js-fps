import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { bodyGeometryFromModel, normaliseBoneName, prepareBodyModel, type PreparedBodyModel } from './bodyModel.ts';
import { JOINT_INDEX, JOINT_NAMES, JOINTS, type JointName } from './skeleton.ts';
import { Humanoid } from './humanoid.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import { ctx as enemyCtx } from '../ai/enemyTestKit.ts';

/** Node has no image decoding: drop textures from the GLB's JSON chunk before parsing. */
async function loadWithoutTextures(url: URL): Promise<THREE.Group> {
  const buf = readFileSync(url);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    images?: unknown;
    textures?: unknown;
    samplers?: unknown;
    materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown }; normalTexture?: unknown; occlusionTexture?: unknown; emissiveTexture?: unknown; extensions?: unknown }>;
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.pbrMetallicRoughness?.metallicRoughnessTexture;
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    delete m.extensions; // KHR_materials_specular carries textures of its own
  }
  let text = Buffer.from(JSON.stringify(json));
  while (text.length % 4) text = Buffer.concat([text, Buffer.from(' ')]);
  const rest = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.write('glTF', 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.write('JSON', 16);
  const glb = Buffer.concat([head, text, rest]);
  const { createGltfLoader } = await import('../render/gltf.ts');
  const gltf = await (await createGltfLoader()).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  return gltf.scene;
}

const ZOMBIE = new URL('../../public/assets/models/infected/zombie_walk.glb', import.meta.url);
let cached: PreparedBodyModel | null = null;
async function zombie(): Promise<PreparedBodyModel> {
  cached ??= prepareBodyModel(await loadWithoutTextures(ZOMBIE));
  return cached;
}

function worldJoints(m: PreparedBodyModel): Record<JointName, THREE.Vector3> {
  const out = {} as Record<JointName, THREE.Vector3>;
  for (const j of JOINTS) {
    const parent = j.parent ? out[j.parent] : new THREE.Vector3();
    out[j.name] = (parent ?? new THREE.Vector3()).clone().add(new THREE.Vector3(...m.jointOffsets[j.name]));
  }
  return out;
}

test('bone names from common exporters normalise', () => {
  assert.equal(normaliseBoneName('mixamorig:LeftForeArm'), 'leftforearm');
  assert.equal(normaliseBoneName('L_Shoulder_32'), 'l_shoulder');
  assert.equal(normaliseBoneName('Spine3_4'), 'spine3');
});

test('zombie model: every game joint placed, standing straight in the rest pose, facing -Z', async () => {
  const m = await zombie();
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  // Upright, roughly human proportions at the reference height.
  assert.ok(w.pelvis.y > 0.85 && w.pelvis.y < 1.05, `pelvis at ${w.pelvis.y}`);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.7, `head at ${w.head.y}`);
  assert.ok(Math.abs(w.pelvis.x) < 1e-6 && Math.abs(w.pelvis.z) < 1e-6);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    // Arms hang: elbow and wrist below the shoulder, not out in front.
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      const d = w[b].clone().sub(w[a]).normalize();
      assert.ok(d.y < -0.98, `${a} -> ${b} points down (${d.toArray().map((x) => x.toFixed(2))})`);
    }
    assert.ok(w[`foot_${s}`].y > 0.04 && w[`foot_${s}`].y < 0.15, `ankle height ${w[`foot_${s}`].y}`);
  }
});

test('zombie model: all triangles kept, weights folded onto game joints, toes point -Z', async () => {
  const m = await zombie();
  let tris = 0;
  let toeZ = 0;
  for (const p of m.parts) {
    const g = p.geometry;
    tris += (g.getIndex()?.count ?? 0) / 3;
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    for (let v = 0; v < si.count; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        assert.ok(si.getComponent(v, k) < JOINTS.length);
        sum += sw.getComponent(v, k);
      }
      assert.ok(Math.abs(sum - 1) < 1e-4, `weights sum to ${sum}`);
    }
    if (p.joint === 'foot_L') {
      g.computeBoundingBox();
      toeZ = g.boundingBox!.min.z;
    }
  }
  assert.equal(tris, m.triangles);
  assert.ok(tris > 9000 && tris < 10000, `${tris} triangles`);
  assert.ok(toeZ < -0.1, `toes reach ${toeZ} in front of the ankle`);
  for (const j of ['head', 'chest', 'upperArm_L', 'foreArm_R', 'hand_L', 'thigh_R', 'shin_L', 'foot_R'] as const) {
    assert.ok(m.parts.some((p) => p.joint === j), `a piece for ${j}`);
  }
});

test('zombie model: a body from it has stumps for every severable joint and separate geometry', async () => {
  const m = await zombie();
  const a = bodyGeometryFromModel(m, 1.8, 7);
  const b = bodyGeometryFromModel(m, 1.8, 7);
  assert.equal(a.extraBones.filter((e) => e.kind === 'stump').length, 9);
  assert.notEqual(a.parts[0]!.geometry, b.parts[0]!.geometry);
  assert.ok(Math.abs(a.scale.y - 1.8 / 1.78) < 1e-9);
  for (const p of a.parts) {
    if (!p.surface) continue;
    for (const attr of ['aGlow', 'aRot', 'aSkin', 'color', 'normal', 'position', 'skinIndex', 'skinWeight', 'uv']) {
      assert.ok(p.geometry.getAttribute(attr), `${p.bone}/${p.surface}: ${attr}`);
    }
  }
  for (const [j, r] of Object.entries(m.stumpRadius)) assert.ok(r > 0.02 && r < 0.13, `${j} stump ${r}`);
  assert.equal(JOINT_INDEX.root, 0);
});

test('a humanoid built from the model: textured pieces, hit capsules on the body, an arm can be shot off', async () => {
  const m = await zombie();
  const library = { get: (id: string) => (id === 'zombieWalk' ? m : undefined) } as unknown as BodyModelLibrary;
  const h = new Humanoid({ seed: 'model-test', outfit: 'crew', role: 'enemy', infection: 2, model: 'zombieWalk', height: 1.78 }, { ...enemyCtx(), bodyModels: library });
  assert.equal(h.modelId, 'zombieWalk');
  const meshes = h.group.children.filter((c): c is THREE.SkinnedMesh => (c as THREE.SkinnedMesh).isSkinnedMesh);
  // One per model material, plus the wet layer (stump caps).
  assert.equal(meshes.length, Object.keys(m.surfaces).length + 1);
  for (const dt of Array(30).fill(1 / 30)) {
    h.move(new THREE.Vector3(0, 0, -1), dt);
    h.update(dt);
  }
  // Shoot the head from the front: the ray lands on the head capsule.
  const head = h.jointWorld('head');
  const from = head.clone().add(new THREE.Vector3(0, 0.08, -3).applyQuaternion(h.group.quaternion));
  const dir = head.clone().add(new THREE.Vector3(0, 0.08, 0)).sub(from).normalize();
  const hit = h.raycast(from, dir);
  assert.ok(hit, 'head hit');
  assert.equal(hit.region, 'head');
  // Take the left forearm off.
  const arm = h.bones.foreArm_L.localToWorld(new THREE.Vector3(0, -0.12, 0));
  const fromArm = arm.clone().add(new THREE.Vector3(-2, 0, 0).applyQuaternion(h.group.quaternion));
  const armHit = h.raycast(fromArm, arm.clone().sub(fromArm).normalize());
  assert.ok(armHit, 'arm hit');
  let severed = false;
  for (let i = 0; i < 20 && !severed; i++) severed = h.applyHit(armHit, 40, new THREE.Vector3(1, 0, 0)).severed !== null;
  assert.ok(severed, 'forearm severed');
  h.update(1 / 30);
  h.dispose();
});

test('procedural bodies are untouched when no model is asked for', () => {
  const h = new Humanoid({ seed: 'plain', outfit: 'crew', role: 'enemy' }, enemyCtx());
  assert.equal(h.modelId, null);
  h.dispose();
});

// August Giles' body (data/body-models.json "mechanic"): a model whose bones were renamed by scripts/fix-mechanic-glb.mjs.
test('mechanic model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/mechanic.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    // Shoes extend toward -Z from the ankle.
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.ok(m.unmapped.every((u) => /^Helper_|^Root$|^GLTF_created/.test(u)), `only helpers unmapped: ${m.unmapped.join(',')}`);
});

// Dr. Okafor's body (data/body-models.json "doctor"): BrushDip's rigged doctor, its Biped bones renamed to Mixamo names with a jaw,
// finger and forearm-twist bones added by scripts/fix-doctor-glb.mjs.
test('doctor model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/doctor.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    // Shoes extend toward -Z from the ankle.
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.ok(m.unmapped.every((u) => /^(_rootJoint|RL_BoneRoot|HipRoot|Waist|NeckUpper|FacialBone|MouthRoot|UpperJaw|Tongue|Teeth|(Left|Right)(Breast|Eye))/.test(u)), `only helpers and face bones unmapped: ${m.unmapped.join(',')}`);
});

// Priya Anand's body (data/body-models.json "priya"): the "elegant woman" Character Creator rig, bones renamed, bind pose
// repaired and repacked (not decimated) by scripts/fix-priya-glb.mjs.
test('priya model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/priya.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.ok(m.unmapped.every((u) => /^(_rootJoint|BoneRoot|HipRoot|Waist|NeckUpper|FacialBone|UpperJaw|Tongue|Teeth|(Left|Right)(Breast|Eye))/.test(u)), `only helpers and face bones unmapped: ${m.unmapped.join(',')}`);
});

// Sung's body (data/body-models.json "sung"): an unrigged scan decimated, skinned to a Mixamo-named skeleton and
// slimmed by scripts/fix-sung-glb.mjs.
test('sung model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/sung.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.deepEqual(m.unmapped, []);
});

// Bram's body (data/body-models.json "bram"): the unrigged T-pose chef scan decimated, skinned to a Mixamo-named skeleton
// and slimmed by scripts/fix-bram-glb.mjs.
test('bram model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/bram.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.deepEqual(m.unmapped, []);
});

// Ruiz's body (data/body-models.json "ruiz"): an unrigged mid-stride scan (toolbox cut away) decimated and skinned to a
// Mixamo-named skeleton by scripts/fix-ruiz-glb.mjs.
test('ruiz model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/ruiz.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.deepEqual(m.unmapped, []);
});

// Bram's body (data/body-models.json "bram"): the unrigged T-pose chef scan decimated, skinned to a Mixamo-named skeleton
// and slimmed by scripts/fix-bram-glb.mjs.
test('bram model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/bram.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.deepEqual(m.unmapped, []);
});

// Katie Heins' body (data/body-models.json "heins"): an unrigged, unanimated A-pose mesh decimated per material, skinned to a
// Mixamo-named skeleton and slimmed by scripts/fix-heins-glb.mjs.
test('heins model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/heins.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.deepEqual(m.unmapped, []);
});

// Director Hale's body (data/body-models.json "hale"): a rigged T-pose avatar, decimated and given a jaw bone by
// scripts/fix-hale-glb.mjs.
test('hale model: rig maps, stands straight facing -Z, shoes point forward, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/hale.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.75, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    for (const [a, b] of [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`], [`thigh_${s}`, `shin_${s}`], [`shin_${s}`, `foot_${s}`]] as const) {
      assert.ok(w[b].clone().sub(w[a]).normalize().y < -0.98, `${a} -> ${b} points down`);
    }
    const shoe = m.parts.filter((p) => p.joint === `foot_${s}`);
    assert.ok(shoe.length > 0, `foot_${s} has pieces`);
    let zSum = 0;
    let n = 0;
    for (const p of shoe) {
      const pos = p.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) { zSum += pos.getZ(i); n++; }
    }
    assert.ok(zSum / n < 0, `foot_${s} pieces centred ahead (-Z) of the ankle (${(zSum / n).toFixed(3)})`);
  }
  assert.deepEqual(m.unmapped, []);
});

// Scan bodies (openspec imported-body-models): unrigged scans skinned by scripts/lib/scan-body.mjs. Weights are read in the
// prepared rest pose (game frame: facing -Z, REFERENCE_HEIGHT tall), with thresholds taken from the body's own joints. Okafor's body
// is now a hand-rigged model (scripts/fix-doctor-glb.mjs) with the artist's own weights, so only the neck rule is checked on him.
const SCAN_BODIES = ['ruiz'] as const;
const NECK_BODIES = ['doctor', 'ruiz'] as const;

/** Every vertex of a prepared body in world space, with its weight per core joint slot. */
function skinnedVertices(m: PreparedBodyModel): Array<{ p: THREE.Vector3; w: Map<number, number> }> {
  const w = worldJoints(m);
  const out: Array<{ p: THREE.Vector3; w: Map<number, number> }> = [];
  for (const part of m.parts) {
    const pos = part.geometry.getAttribute('position');
    const si = part.geometry.getAttribute('skinIndex');
    const sw = part.geometry.getAttribute('skinWeight');
    const at = w[part.joint];
    for (let i = 0; i < pos.count; i++) {
      const weights = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const x = sw.getComponent(i, k);
        if (x > 0) weights.set(si.getComponent(i, k), (weights.get(si.getComponent(i, k)) ?? 0) + x);
      }
      out.push({ p: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(at), w: weights });
    }
  }
  return out;
}
const weightOf = (v: { w: Map<number, number> }, joints: readonly JointName[]): number => joints.reduce((s, j) => s + (v.w.get(JOINT_INDEX[j]) ?? 0), 0);

for (const name of NECK_BODIES) {
  test(`scan body ${name}: neck owns the neck and the lower face follows the head`, async () => {
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/assets/models/squad/${name}.glb`, import.meta.url)));
    const j = worldJoints(m);
    const verts = skinnedVertices(m);
    // Neck column: within 4.5 cm of the neck-head axis, above the collar (3 cm under the head joint). No chest or spine.
    const ax = (j.neck.x + j.head.x) / 2;
    const az = (j.neck.z + j.head.z) / 2;
    const column = verts.filter((v) => v.p.y > j.head.y - 0.03 && Math.hypot(v.p.x - ax, v.p.z - az) < 0.045);
    assert.ok(column.length >= 20, `${name}: ${column.length} neck-column vertices`);
    const torso = column.filter((v) => weightOf(v, ['chest', 'spine']) > 0.01);
    assert.equal(torso.length, 0, `${name}: ${torso.length} neck-column vertices carry chest/spine weight`);
    // Lower face: mouth and chin, 6 cm or more in front of the jaw hinge (the face is at -Z), down to the chin. Head and jaw only,
    // allowing the 1-2 cm blend where the chin meets the throat.
    const face = verts.filter((v) => v.p.y > j.jaw.y - 0.075 && v.p.y < j.jaw.y && j.jaw.z - v.p.z > 0.06 && Math.abs(v.p.x - j.jaw.x) < 0.06);
    assert.ok(face.length >= 20, `${name}: ${face.length} lower-face vertices`);
    const loose = face.filter((v) => weightOf(v, ['head', 'jaw']) < 0.97);
    assert.equal(loose.length, 0, `${name}: ${loose.length} lower-face vertices lean on joints other than head and jaw`);
  });
}

/** A prepared body as one world-space mesh: positions, triangles, and each vertex's weight on the left and right arm chains. */
function scanMesh(m: PreparedBodyModel): { p: THREE.Vector3[]; tris: number[]; arm: Array<{ L: number; R: number }> } {
  const w = worldJoints(m);
  const chain = (s: 'L' | 'R'): JointName[] => [`upperArm_${s}`, `foreArm_${s}`, `hand_${s}`];
  const p: THREE.Vector3[] = [];
  const tris: number[] = [];
  const arm: Array<{ L: number; R: number }> = [];
  for (const part of m.parts) {
    const pos = part.geometry.getAttribute('position');
    const si = part.geometry.getAttribute('skinIndex');
    const sw = part.geometry.getAttribute('skinWeight');
    const base = p.length;
    for (let i = 0; i < pos.count; i++) {
      p.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(w[part.joint]));
      const a = { L: 0, R: 0 };
      for (let k = 0; k < 4; k++) {
        const j = JOINT_NAMES[si.getComponent(i, k)];
        if (chain('L').includes(j!)) a.L += sw.getComponent(i, k);
        if (chain('R').includes(j!)) a.R += sw.getComponent(i, k);
      }
      arm.push(a);
    }
    for (const v of Array.from(part.geometry.getIndex()!.array)) tris.push(base + v);
  }
  return { p, tris, arm };
}

// Arm/torso separation (openspec fix-scan-body-skinning): below the armpit each vertex follows an arm or the torso, never both, so
// raising the arms cannot pull the coat or the coveralls off the torso. The armpit line sits 13 cm under each upper-arm joint
// (scan-body's hard mask starts a few cm lower still, under a short blend band at the top of the cut).
for (const name of SCAN_BODIES) {
  test(`scan body ${name}: arms move without dragging the torso`, async () => {
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/assets/models/squad/${name}.glb`, import.meta.url)), { detailHands: false });
    const j = worldJoints(m);
    const { p, tris, arm } = scanMesh(m);
    const line = (s: 'L' | 'R'): number => j[`upperArm_${s}`].y - 0.13;
    const sideOf = (v: THREE.Vector3): 'L' | 'R' => (v.x < j.spine.x ? 'L' : 'R');
    const mixed = (i: number): boolean => [arm[i]!.L + arm[i]!.R].some((a) => a > 0.15 && a < 0.85);
    // No mixed vertex below the armpit line; mixed triangles (the shoulder blend) are a small share of the body.
    const low = p.flatMap((v, i) => (mixed(i) && v.y < line(sideOf(v)) ? [v] : []));
    assert.equal(low.length, 0, `${name}: ${low.length} vertices below the armpit blend arm and torso, e.g. ${low[0]?.toArray().map((x) => x.toFixed(3))}`);
    let mixedTris = 0;
    for (let t = 0; t < tris.length; t += 3) if ([0, 1, 2].some((k) => mixed(tris[t + k]!))) mixedTris++;
    assert.ok(mixedTris / (tris.length / 3) <= 0.03, `${name}: ${((100 * mixedTris) / (tris.length / 3)).toFixed(1)}% of triangles blend arm and torso`);
    // Raise both upper arms 30° out to the side (linear blend skinning in the rest frame).
    const raise = (s: 'L' | 'R'): THREE.Matrix4 => {
      const o = j[`upperArm_${s}`];
      return new THREE.Matrix4().makeTranslation(o.x, o.y, o.z).multiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(s === 'L' ? -30 : 30))).multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
    };
    const R = { L: raise('L'), R: raise('R') };
    const posed = p.map((v, i) => {
      const { L, R: r } = arm[i]!;
      return v.clone().multiplyScalar(1 - L - r).add(v.clone().applyMatrix4(R.L).multiplyScalar(L)).add(v.clone().applyMatrix4(R.R).multiplyScalar(r));
    });
    // The torso stays put: every vertex below the armpit lines that lies horizontally closer to the spine than it lies to either
    // arm's bones (upper arm, forearm, hand), by 2 cm (a sleeve's fold at the elbow reaches in that far once the arm is straightened).
    const seg = new THREE.Line3();
    const closest = new THREE.Vector3();
    const armDist = (v: THREE.Vector3): number =>
      Math.min(...(['L', 'R'] as const).flatMap((s) => [[`upperArm_${s}`, `foreArm_${s}`], [`foreArm_${s}`, `hand_${s}`]] as Array<[JointName, JointName]>).map(([a, b]) => {
        seg.set(j[a], j[b]).closestPointToPoint(v, true, closest);
        return closest.distanceTo(v);
      }));
    const torso = p.flatMap((v, i) => (v.y < Math.min(line('L'), line('R')) && v.y > j.pelvis.y && Math.hypot(v.x - j.spine.x, v.z - j.spine.z) < armDist(v) - 0.02 ? [i] : []));
    assert.ok(torso.length > 500, `${name}: ${torso.length} torso vertices`);
    const moved = torso.filter((i) => posed[i]!.distanceTo(p[i]!) > 0.001);
    assert.equal(moved.length, 0, `${name}: ${moved.length} torso vertices follow the arms, e.g. ${moved.slice(0, 3).map((i) => p[i]!.toArray().map((x) => x.toFixed(3)).join(" ")).join(", ")}`);
    // No edge of 3 mm or more stretches past 2.5x (the shoulder blend stretches a little; a torn seam stretches 5-10x).
    let worst = 0;
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = tris[t + k]!, b = tris[t + ((k + 1) % 3)]!;
      const rest = p[a]!.distanceTo(p[b]!);
      if (rest >= 0.003) worst = Math.max(worst, posed[a]!.distanceTo(posed[b]!) / rest);
    }
    assert.ok(worst <= 2.5, `${name}: an edge stretches ${worst.toFixed(2)}x when the arms rise`);
    // Welded by posed position, the surface round the arms has no opening wider than a scan crack (5 mm): the cut is capped.
    const key = posed.map((v) => `${Math.round(v.x / 0.0002)},${Math.round(v.y / 0.0002)},${Math.round(v.z / 0.0002)}`);
    const weld = new Map<string, number>();
    const id = key.map((k, i) => weld.get(k) ?? (weld.set(k, i), i));
    const edges = new Map<string, number>();
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = id[tris[t + k]!]!, b = id[tris[t + ((k + 1) % 3)]!]!;
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
    const holes: string[] = [];
    const lo = Math.min(line('L'), line('R')) - 0.45, hi = Math.max(line('L'), line('R')) + 0.15;
    for (const [e, n] of edges) {
      if (n !== 1) continue;
      const [a, b] = e.split('|').map((x) => posed[+x]!);
      const mid = a!.clone().add(b!).multiplyScalar(0.5);
      if (mid.y > lo && mid.y < hi && a!.distanceTo(b!) > 0.005) holes.push(`${mid.toArray().map((x) => x.toFixed(3))} (${(a!.distanceTo(b!) * 1000).toFixed(0)} mm)`);
    }
    assert.equal(holes.length, 0, `${name}: open edges round the raised arms: ${holes.slice(0, 4).join(', ')}`);
  });
}

// Talking (ADR-0027) needs a jaw: every squad model has real jaw weights on its lower face, hinged behind and below the cheek,
// well under the eyes and ears, so the chin can drop without the skull or the throat following it.
for (const name of ['mechanic', 'doctor', 'priya', 'sung', 'ruiz', 'bram', 'heins', 'hale'] as const) {
  test(`${name} model: a jaw joint owns weight on the lower face and hinges near the ear`, async () => {
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/assets/models/squad/${name}.glb`, import.meta.url)));
    const w = worldJoints(m);
    // Hinge: below the head's top, behind the face (+Z is behind), within a head's height of the head joint.
    assert.ok(w.jaw.y > 1.45 && w.jaw.y < 1.72, `${name} jaw hinge at y ${w.jaw.y}`);
    assert.ok(Math.abs(w.jaw.x) < 0.08, `${name} jaw hinge on the midline (${w.jaw.x})`);
    // Jaw weight: some vertices lean on the jaw joint, all below the hinge and none far above it.
    const jaw = JOINT_INDEX.jaw;
    let heavy = 0;
    let highest = -Infinity;
    let lowest = Infinity;
    for (const p of m.parts) {
      const pos = p.geometry.getAttribute('position');
      const si = p.geometry.getAttribute('skinIndex');
      const sw = p.geometry.getAttribute('skinWeight');
      const at = worldJoints(m)[p.joint];
      for (let i = 0; i < pos.count; i++) {
        let wt = 0;
        for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === jaw) wt += sw.getComponent(i, k);
        if (wt < 0.5) continue;
        heavy++;
        const y = pos.getY(i) + at.y;
        highest = Math.max(highest, y);
        lowest = Math.min(lowest, y);
      }
    }
    assert.ok(heavy >= 20, `${name}: ${heavy} vertices follow the jaw`);
    assert.ok(highest < w.jaw.y + 0.07, `${name}: jaw skin reaches y ${highest}, hinge ${w.jaw.y}`);
    assert.ok(lowest > 1.4, `${name}: jaw skin does not hang down the throat (${lowest})`);
  });
}

// The hero's body (data/body-models.json "necromorph"): a 67-bone rig kept as supplied except that its animation clips were dropped.
test('necromorph model: rig maps, stands straight facing -Z, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/infected/necromorph_slasher.glb', import.meta.url)));
  const j = worldJoints(m);
  assert.ok(j.head.y > j.pelvis.y && j.pelvis.y > j.foot_L.y, 'head over pelvis over feet');
  assert.ok(j.foot_L.x < j.foot_R.x, 'left at -X');
  const parts = new Set(m.parts.map((p) => p.joint));
  for (const need of ['head', 'upperArm_L', 'upperArm_R', 'foreArm_L', 'foreArm_R', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'] as JointName[]) assert.ok(parts.has(need), `piece for ${need}`);
});

test('hero tier on the necromorph body: model used, hero gait and slam state kept, 2.15 m tall', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/infected/necromorph_slasher.glb', import.meta.url)));
  const library = { get: (id: string) => (id === 'necromorph' ? m : undefined) } as unknown as BodyModelLibrary;
  const h = new Humanoid({ seed: 'hero-model', outfit: 'lab', role: 'enemy', infection: 2, hero: true, height: 2.15, build: 1.25, pose: 'hulk', model: 'necromorph' }, { ...enemyCtx(), bodyModels: library });
  assert.equal(h.modelId, 'necromorph');
  assert.ok(h.slam, 'slam state kept');
  const box = new THREE.Box3().setFromObject(h.group);
  assert.ok(box.max.y - box.min.y > 1.9 && box.max.y - box.min.y < 2.6, `height ${box.max.y - box.min.y}`);
});

// The admin assistant's body (data/body-models.json "assistant"): the "Lady in a trenchcoat" Mixamo rig, duplicate copy dropped and
// textures re-encoded by scripts/fix-trenchcoat-glb.mjs.
test('assistant model: rig maps, stands straight, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/crew/assistant.glb', import.meta.url)));
  const w = worldJoints(m);
  for (const name of JOINT_NAMES) assert.ok(m.jointOffsets[name], name);
  assert.ok(w.head.y > 1.45 && w.head.y < 1.8, `head at ${w.head.y}`);
  for (const s of ['L', 'R'] as const) {
    const out = s === 'L' ? -1 : 1;
    assert.ok(w[`thigh_${s}`].x * out > 0.03, `thigh_${s} on its own side`);
    assert.ok(w[`upperArm_${s}`].x * out > 0.1, `upperArm_${s} on its own side`);
    assert.ok(m.parts.some((p) => p.joint === `foot_${s}`), `foot_${s} has pieces`);
  }
  assert.ok(m.unmapped.every((n) => /rootJoint$/.test(n)), `unmapped ${m.unmapped.join(', ')}`); // only the exporter's wrapper bone
  // Nothing is blown up: hair, eyes and shoes were once 6x too big after a bad skin rewrite.
  for (const p of m.parts) {
    const s = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
    assert.ok(Math.max(s.x, s.y, s.z) < 0.7, `${p.joint}/${p.surface} is ${s.toArray().map((x) => x.toFixed(2)).join(' x ')} m`);
  }
});

// Crowd necromorph (data/body-models.json "necromorphCrowd"): a Mixamo-named 34-bone rig, animation dropped and textures re-encoded.
test('necromorphCrowd model: rig maps, stands straight facing -Z, keeps every limb piece', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/infected/necromorph_crowd.glb', import.meta.url)));
  const j = worldJoints(m);
  assert.ok(j.head.y > j.pelvis.y && j.pelvis.y > j.foot_L.y, 'head over pelvis over feet');
  assert.ok(j.foot_L.x < j.foot_R.x, 'left at -X');
  const parts = new Set(m.parts.map((p) => p.joint));
  for (const need of ['head', 'upperArm_L', 'upperArm_R', 'foreArm_L', 'foreArm_R', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'] as JointName[]) assert.ok(parts.has(need), `piece for ${need}`);
  assert.ok(m.triangles > 4000, `${m.triangles} triangles`);
});

test('the crowd picks a model every time: no procedural shamblers or play-dead bodies are left', async () => {
  const { BodyModelLibrary } = await import('./bodyModelLibrary.ts');
  const { Rng } = await import('../core/rng.ts');
  const table = JSON.parse(readFileSync(new URL('../data/body-models.json', import.meta.url), 'utf8')) as ConstructorParameters<typeof BodyModelLibrary>[0];
  const lib = new BodyModelLibrary(table);
  const prepared = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/infected/necromorph_crowd.glb', import.meta.url)));
  const loaded = (lib as unknown as { loaded: Map<string, unknown> }).loaded;
  for (const id of Object.keys(table)) loaded.set(id, prepared);
  const rng = new Rng(7);
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) for (const v of ['shambler', 'playDead']) {
    const id = lib.pick(v, rng.fork(`s${i}${v}`));
    assert.ok(id, `${v} spawn ${i} got no model`);
    seen.add(id);
  }
  assert.ok(seen.has('zombieWalk') && seen.has('necromorphCrowd'));
  assert.ok(!seen.has('priya'), 'squad bodies never join the crowd');
});

// Crowd game character (data/body-models.json "gameChar"): Mixamo-named 41-bone rig, decimated by scripts/fix-gamechar-glb.mjs.
test('gameChar model: rig maps, stands straight facing -Z, keeps every limb piece, within the crowd budget', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/infected/gamechar.glb', import.meta.url)));
  const j = worldJoints(m);
  assert.ok(j.head.y > j.pelvis.y && j.pelvis.y > j.foot_L.y, 'head over pelvis over feet');
  assert.ok(j.foot_L.x < j.foot_R.x, 'left at -X');
  const parts = new Set(m.parts.map((p) => p.joint));
  // The source zombie has lost most of its right arm (a stub of shoulder and upper arm), so only the left arm is required.
  for (const need of ['head', 'upperArm_L', 'foreArm_L', 'hand_L', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'] as JointName[]) assert.ok(parts.has(need), `piece for ${need}`);
  assert.ok(m.triangles < 25000, `${m.triangles} triangles`);
});

// Scientist / botanist models (multi-skin KHR_mesh_quantization): every sub-mesh (eyeballs, mouth, glasses, body) must stay properly scaled.
for (const file of ['botanist_1.glb', 'botanist_2.glb', 'botanist_3.glb'] as const) {
  test(`${file}: multi-skin quantized sub-meshes stay properly scaled and proportioned`, async () => {
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/assets/models/crew/${file}`, import.meta.url)));
    const w = worldJoints(m);
    assert.ok(w.head.y > 1.45 && w.head.y < 1.78, `${file} head at ${w.head.y}`);
    for (const p of m.parts) {
      const s = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
      const limit = p.joint === 'head' ? 0.35 : 0.75;
      assert.ok(Math.max(s.x, s.y, s.z) < limit, `${file} ${p.joint}/${p.surface} is ${s.toArray().map((x) => x.toFixed(2)).join(' x ')} m`);
    }
  });
}

test('August Giles mechanic model is never reused on generic crew/maintenance/engineer NPCs', async () => {
  const { castSpec, CREW_LOOKS } = await import('./castLooks.ts');
  for (const look of CREW_LOOKS) {
    for (const id of ['crew_1', 'crew_2', 'crew_3', 'maint_1', 'eng_1', 'eng_2']) {
      assert.notEqual(castSpec(look, id).model, 'mechanic', `${look}/${id} should not reuse Giles' mechanic model`);
    }
  }
});

// Scan-body hands (per-character-motion task 5.5, scripts/lib/hand-rig.mjs): every finger curls into a fist without tearing the
// hand. Each phalanx turns about its own curl axis up to a fist (70, 90 and 60 degrees; the thumb 40, 40 and 30), less the bend it
// already has at rest, the mesh is skinned in the rest frame (linear blend), and no edge of 3 mm or more stretches past 2.5x its
// rest length. Ruiz and Sung keep their scans' own hands (fused fists and gloves the finger rig shreds).
for (const name of ['bram', 'heins'] as const) {
  test(`scan body ${name}: the fingers curl into a fist without stretching the hand`, async () => {
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/assets/models/squad/${name}.glb`, import.meta.url)), { detailHands: true });
    const w = worldJoints(m);
    // Rest world position and curled world transform of every detail bone (rest frames are world-aligned).
    const restAt = new Map<string, THREE.Vector3>();
    const posed = new Map<string, THREE.Matrix4>();
    const CURL = { thumb: [40, 40, 30], other: [70, 90, 60] };
    const fingers = m.handBones.filter((b) => b.kind === 'finger');
    assert.equal(fingers.length, 30, `${name}: 30 finger bones`);
    for (const b of fingers) {
      const parentAt = b.parent in w ? w[b.parent as JointName] : restAt.get(b.parent)!;
      const at = parentAt.clone().add(new THREE.Vector3(...b.offset));
      restAt.set(b.name, at);
      // Up to the fist, less the bend the phalanx already has at rest (as the hand solver curls: a scan's fist is already bent).
      const deg = Math.max(0, (b.finger === 'thumb' ? CURL.thumb : CURL.other)[b.phalanx - 1]! - THREE.MathUtils.radToDeg(b.restCurl));
      const turn = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...b.curlAxis), THREE.MathUtils.degToRad(deg)))
        .multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));
      posed.set(b.name, b.parent in w ? turn : posed.get(b.parent)!.clone().multiply(turn));
    }
    const slotMatrix = new Map<number, THREE.Matrix4>();
    m.handBones.forEach((b, k) => { if (b.kind === 'finger') slotMatrix.set(JOINTS.length + k, posed.get(b.name)!); });
    let worst = 0;
    let worstAt = '';
    let fingerVerts = 0;
    for (const part of m.parts) {
      const pos = part.geometry.getAttribute('position');
      const si = part.geometry.getAttribute('skinIndex');
      const sw = part.geometry.getAttribute('skinWeight');
      const index = part.geometry.getIndex();
      if (!index) continue;
      const rest: THREE.Vector3[] = [];
      const out: THREE.Vector3[] = [];
      const onFinger: boolean[] = [];
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(w[part.joint]);
        const o = new THREE.Vector3();
        let f = 0;
        for (let k = 0; k < 4; k++) {
          const wt = sw.getComponent(i, k);
          const mtx = slotMatrix.get(si.getComponent(i, k));
          if (mtx) f += wt;
          o.addScaledVector(mtx ? v.clone().applyMatrix4(mtx) : v, wt);
        }
        if (f > 0.05) fingerVerts++;
        rest.push(v);
        out.push(o);
        onFinger.push(f > 0.001);
      }
      for (let t = 0; t < index.count; t += 3) for (let k = 0; k < 3; k++) {
        const a = index.getX(t + k), b = index.getX(t + ((k + 1) % 3));
        if (!onFinger[a] && !onFinger[b]) continue;
        const r = rest[a]!.distanceTo(rest[b]!);
        if (r < 0.003) continue;
        const ratio = out[a]!.distanceTo(out[b]!) / r;
        if (ratio > worst) {
          worst = ratio;
          worstAt = rest[a]!.toArray().map((x) => x.toFixed(3)).join(' ');
        }
      }
    }
    assert.ok(fingerVerts > 100, `${name}: ${fingerVerts} vertices follow the fingers`);
    assert.ok(worst <= 2.5, `${name}: an edge stretches ${worst.toFixed(2)}x in a fist (at ${worstAt})`);
  });
}

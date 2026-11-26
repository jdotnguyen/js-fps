import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { bodyGeometryFromModel, mapRig, normaliseBoneName, prepareBodyModel, type PreparedBodyModel } from './bodyModel.ts';
import { JOINT_INDEX, JOINT_NAMES, JOINTS, type JointName } from './skeleton.ts';
import { Humanoid } from './humanoid.ts';
import type { BodyModelLibrary } from './bodyModelLibrary.ts';
import type { FingerBoneDef } from './handPhysics.ts';
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

const CROWD = new URL('../../public/assets/models/infected/necromorph_crowd.glb', import.meta.url);
let cached: PreparedBodyModel | null = null;
async function crowdModel(): Promise<PreparedBodyModel> {
  cached ??= prepareBodyModel(await loadWithoutTextures(CROWD));
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

test('crowd infected model: every game joint placed, standing straight in the rest pose, facing -Z', async () => {
  const m = await crowdModel();
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

test('crowd infected model: all triangles kept, weights folded onto game joints, toes point -Z', async () => {
  const m = await crowdModel();
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
  assert.ok(tris > 4000, `${tris} triangles`);
  assert.ok(toeZ < -0.1, `toes reach ${toeZ} in front of the ankle`);
  for (const j of ['head', 'chest', 'upperArm_L', 'foreArm_R', 'hand_L', 'thigh_R', 'shin_L', 'foot_R'] as const) {
    assert.ok(m.parts.some((p) => p.joint === j), `a piece for ${j}`);
  }
});

test('crowd infected model: a body from it has stumps for every severable joint and separate geometry', async () => {
  const m = await crowdModel();
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
  const m = await crowdModel();
  const library = { get: (id: string) => (id === 'necromorphCrowd' ? m : undefined) } as unknown as BodyModelLibrary;
  const h = new Humanoid({ seed: 'model-test', outfit: 'crew', role: 'enemy', infection: 2, model: 'necromorphCrowd', height: 1.78 }, { ...enemyCtx(), bodyModels: library });
  assert.equal(h.modelId, 'necromorphCrowd');
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
// Bram's scan has its own prep (scripts/fix-bram-glb.mjs, which borrows the neck rule), so likewise (fix-bram-rig).
const SCAN_BODIES = ['ruiz', 'heins'] as const;
const NECK_BODIES = ['doctor', 'ruiz', 'bram', 'heins'] as const;

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
    // Welded by posed position, raising the arms opens nothing wider than a scan crack (5 mm) round them: the cut is capped. Only
    // edges that are open when the arms rise but closed at rest count, since a body built of layered open pieces (Heins's jacket
    // over her shirt) has open edges at rest that no weighting can close (rebuild-heins-rig D10).
    const edgesOf = (pts: THREE.Vector3[]): { id: number[]; edges: Map<string, number> } => {
      const key = pts.map((v) => `${Math.round(v.x / 0.0002)},${Math.round(v.y / 0.0002)},${Math.round(v.z / 0.0002)}`);
      const weld = new Map<string, number>();
      const id = key.map((k, i) => weld.get(k) ?? (weld.set(k, i), i));
      const edges = new Map<string, number>();
      for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = id[tris[t + k]!]!, b = id[tris[t + ((k + 1) % 3)]!]!;
        if (a === b) continue;
        const e = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
      return { id, edges };
    };
    const raised = edgesOf(posed);
    const atRest = edgesOf(p);
    const holes: string[] = [];
    const lo = Math.min(line('L'), line('R')) - 0.45, hi = Math.max(line('L'), line('R')) + 0.15;
    for (const [e, n] of raised.edges) {
      if (n !== 1) continue;
      const [ia, ib] = e.split('|').map(Number) as [number, number];
      const a = posed[ia]!, b = posed[ib]!;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      if (!(mid.y > lo && mid.y < hi && a.distanceTo(b) > 0.005)) continue;
      const ra = atRest.id[ia]!, rb = atRest.id[ib]!;
      if (atRest.edges.get(ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`) === 1) continue; // already open at rest
      holes.push(`${mid.toArray().map((x) => x.toFixed(3))} (${(a.distanceTo(b) * 1000).toFixed(0)} mm)`);
    }
    assert.equal(holes.length, 0, `${name}: raising the arms opens edges round them: ${holes.slice(0, 4).join(', ')}`);
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

// Heins's jaw opens along her lips (openspec rebuild-heins-rig D6): her head is one surface whose mouth is an opening, split at its
// corners into the upper and the lower lip's edge. Opened 15 degrees (linear blend skinning in the rest frame), the upper lip stays
// within 1 mm, the lower lip and the chin follow the jaw, and the mouth's inside (teeth and lining) folds open without tearing.
test('heins model: the jaw opens the mouth along the lips', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/heins.glb', import.meta.url)));
  const j = worldJoints(m);
  const open = new THREE.Matrix4().makeTranslation(j.jaw.x, j.jaw.y, j.jaw.z)
    .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-15)))
    .multiply(new THREE.Matrix4().makeTranslation(-j.jaw.x, -j.jaw.y, -j.jaw.z));
  const surface = (name: string): { p: THREE.Vector3[]; out: THREE.Vector3[]; tris: number[] } => {
    const p: THREE.Vector3[] = [], out: THREE.Vector3[] = [], tris: number[] = [];
    for (const part of m.parts.filter((x) => x.surface === name)) {
      const pos = part.geometry.getAttribute('position'), si = part.geometry.getAttribute('skinIndex'), sw = part.geometry.getAttribute('skinWeight');
      const base = p.length;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(j[part.joint]);
        const o = new THREE.Vector3();
        for (let k = 0; k < 4; k++) o.addScaledVector(si.getComponent(i, k) === JOINT_INDEX.jaw ? v.clone().applyMatrix4(open) : v, sw.getComponent(i, k));
        p.push(v);
        out.push(o);
      }
      for (const v of Array.from(part.geometry.getIndex()!.array)) tris.push(base + v);
    }
    return { p, out, tris };
  };
  const head = surface('head');
  assert.ok(head.p.length > 1000, `${head.p.length} head vertices`);
  // Sanity: the rotation opens the mouth (the chin's end of the jaw goes down).
  const chinEnd = new THREE.Vector3(j.jaw.x, j.jaw.y - 0.08, j.jaw.z - 0.08);
  assert.ok(chinEnd.clone().applyMatrix4(open).y < chinEnd.y, 'the test opens the jaw downward');
  // The mouth: the head surface's opening in front of the jaw, below it (welded by position across the prepared parts).
  const key = head.p.map((v) => `${Math.round(v.x / 1e-4)},${Math.round(v.y / 1e-4)},${Math.round(v.z / 1e-4)}`);
  const weld = new Map<string, number>();
  const id = key.map((k, i) => weld.get(k) ?? (weld.set(k, i), i));
  const edges = new Map<string, number>();
  for (let t = 0; t < head.tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = id[head.tris[t + k]!]!, b = id[head.tris[t + ((k + 1) % 3)]!]!;
    const e = a < b ? `${a}|${b}` : `${b}|${a}`;
    edges.set(e, (edges.get(e) ?? 0) + 1);
  }
  const rim = new Map<number, number[]>();
  for (const [e, n] of edges) {
    if (n !== 1) continue;
    const [a, b] = e.split('|').map(Number) as [number, number];
    const mid = head.p[a]!.clone().add(head.p[b]!).multiplyScalar(0.5);
    if (j.jaw.z - mid.z < 0.08 || mid.y > j.jaw.y - 0.02 || mid.y < j.jaw.y - 0.09 || Math.abs(mid.x - j.jaw.x) > 0.04) continue;
    (rim.get(a) ?? rim.set(a, []).get(a)!).push(b);
    (rim.get(b) ?? rim.set(b, []).get(b)!).push(a);
  }
  assert.ok(rim.size >= 20, `${rim.size} mouth rim vertices`);
  const pts = [...rim.keys()];
  const left = pts.reduce((a, b) => (head.p[b]!.x < head.p[a]!.x ? b : a));
  const right = pts.reduce((a, b) => (head.p[b]!.x > head.p[a]!.x ? b : a));
  // Walk the rim from one corner to the other both ways round.
  const walk = (first: number): number[] => {
    const path = [left, first];
    while (path[path.length - 1] !== right) {
      const next = rim.get(path[path.length - 1]!)!.find((o) => o !== path[path.length - 2]);
      assert.ok(next !== undefined && path.length < 200, 'the mouth rim is one loop');
      path.push(next!);
    }
    return path;
  };
  const [arcA, arcB] = rim.get(left)!.slice(0, 2).map(walk) as [number[], number[]];
  const meanY = (a: number[]): number => a.reduce((s, i) => s + head.p[i]!.y, 0) / a.length;
  const [upper, lower] = meanY(arcA) > meanY(arcB) ? [arcA, arcB] : [arcB, arcA];
  const awayFromCorners = (i: number): boolean => Math.min(Math.abs(head.p[i]!.x - head.p[left]!.x), Math.abs(head.p[i]!.x - head.p[right]!.x)) > 0.01;
  const moved = (i: number): number => head.out[i]!.distanceTo(head.p[i]!);
  const rigid = (i: number): THREE.Vector3 => head.p[i]!.clone().applyMatrix4(open);
  for (const i of upper.filter(awayFromCorners)) assert.ok(moved(i) < 0.001, `upper lip at ${head.p[i]!.toArray().map((x) => x.toFixed(3))} moves ${(moved(i) * 1000).toFixed(1)} mm`);
  // The lower lip and the chin (the face's front 1.5-4 cm under the lower lip, on the midline) stay within a fifth of their jaw
  // travel of where the jaw alone would carry them.
  const lowY = Math.min(...lower.map((i) => head.p[i]!.y));
  const chin = head.p.map((_, i) => i).filter((i) => Math.abs(head.p[i]!.x - j.jaw.x) < 0.01 && head.p[i]!.y < lowY - 0.015 && head.p[i]!.y > lowY - 0.04 && j.jaw.z - head.p[i]!.z > 0.08);
  assert.ok(chin.length >= 3, `${chin.length} chin vertices`);
  for (const i of [...lower.filter(awayFromCorners), ...chin]) {
    const travel = rigid(i).distanceTo(head.p[i]!);
    const off = head.out[i]!.distanceTo(rigid(i));
    assert.ok(off < 0.2 * travel, `lower face at ${head.p[i]!.toArray().map((x) => x.toFixed(3))} lags the jaw by ${(off * 1000).toFixed(1)} of ${(travel * 1000).toFixed(1)} mm`);
  }
  // The mouth's inside: no edge of 2 mm or more stretches past 2.5x.
  const inside = surface('teeth');
  assert.ok(inside.tris.length > 0, 'teeth surface');
  let worst = 0;
  for (let t = 0; t < inside.tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = inside.tris[t + k]!, b = inside.tris[t + ((k + 1) % 3)]!;
    const r = inside.p[a]!.distanceTo(inside.p[b]!);
    if (r >= 0.002) worst = Math.max(worst, inside.out[a]!.distanceTo(inside.out[b]!) / r);
  }
  assert.ok(worst <= 2.5, `a mouth-inside edge stretches ${worst.toFixed(2)}x`);
});

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

// A blade hand piece is long and thin (0.19 x 0.63 x 0.10 m); with a belly arm fused in it was 0.61 x 0.91 x 1.03 m.
const HAND_PIECE_MID_MAX = 0.3; // m, the piece's middle dimension

// The necromorph's small belly arms (Left_Minihandbase .. L_MiniH_*) carry "hand" in their names but hang from Upper_Body, not a
// forearm. They used to bind to hand_L/R and drag the blade's wrist pivot down to the belly (openspec pin-hero-creature-minihands).
test('necromorph belly arms ride the spine, and the blade hands pivot at the blade wrists', async () => {
  const scene = await loadWithoutTextures(new URL('../../public/assets/models/infected/necromorph_slasher.glb', import.meta.url));
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  const bones = meshes[0]!.skeleton.bones;
  const rig = mapRig(bones, meshes);
  for (const s of ['L', 'R'] as const) {
    const wrist = s === 'L' ? 'Left_Hand_09' : 'Right_Hand_017';
    assert.equal(bones[rig.pivot[`hand_${s}`]!]!.name, wrist, `hand_${s} pivots at the blade wrist`);
  }
  const mini = bones.map((b, i) => ({ b, i })).filter(({ b }) => /mini/i.test(b.name));
  assert.ok(mini.length >= 30, `${mini.length} belly-arm bones`);
  for (const { b, i } of mini) {
    assert.equal(rig.jointOf[i], 'spine', `${b.name} rides the spine`);
    assert.ok(rig.unmapped.includes(b.name), `${b.name} is a detail bone`);
  }

  const m = prepareBodyModel(scene);
  const j = worldJoints(m);
  for (const s of ['L', 'R'] as const) {
    const upper = j[`foreArm_${s}`].distanceTo(j[`upperArm_${s}`]);
    const fore = j[`hand_${s}`].distanceTo(j[`foreArm_${s}`]);
    assert.ok(fore > 0.8 * upper, `blade forearm_${s} ${fore.toFixed(2)} m vs upper arm ${upper.toFixed(2)} m (was 0.19 vs 0.27)`);
  }
  for (const p of m.parts.filter((p) => p.joint.startsWith('hand_'))) {
    const size = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
    const mid = [size.x, size.y, size.z].sort((a, b) => a - b)[1]!;
    assert.ok(mid < HAND_PIECE_MID_MAX, `${p.joint} piece is ${size.toArray().map((x) => x.toFixed(2)).join(' x ')} m (belly arm fused in?)`);
  }
});

/** Bones from a GLB's node tree only (names and parents, no mesh decode): enough for mapRig. */
function rigBones(url: URL): THREE.Bone[] {
  const buf = readFileSync(url);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { nodes: Array<{ name?: string; children?: number[] }>; skins: Array<{ joints: number[] }> };
  const node = json.nodes.map((n, i) => Object.assign(new THREE.Bone(), { name: n.name ?? `node${i}` }));
  json.nodes.forEach((n, i) => n.children?.forEach((c) => node[i]!.add(node[c]!)));
  return json.skins[0]!.joints.map((i) => node[i]!);
}

// rig-necromorph (imported-body-models "Secondary limbs never drive a primary limb joint"): with its creature profile the
// belly arms get bones of their own, rooted on the joint they grow from (the spine), never on an arm.
test('with its creature profile the necromorph\'s belly arms move on their own bones, rooted on the spine', async () => {
  const { prepareOptionsFor } = await import('./bodyModelLibrary.ts');
  const defs = JSON.parse(readFileSync(new URL('../data/body-models.json', import.meta.url), 'utf8'));
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/infected/necromorph_slasher.glb', import.meta.url)), prepareOptionsFor(defs.necromorph));
  const limbs = m.creatureBones.filter((b) => b.kind === 'limb');
  assert.ok(limbs.length >= 28);
  for (const b of limbs) assert.ok(b.parent === 'spine' || b.parent.startsWith('limb_'), `${b.name} hangs from ${b.parent}`);
  assert.ok(limbs.every((b) => /mini/i.test(b.source)), 'only belly-arm bones');
  for (const p of m.parts.filter((p) => p.joint.startsWith('hand_'))) {
    const size = new THREE.Box3().setFromBufferAttribute(p.geometry.getAttribute('position') as THREE.BufferAttribute).getSize(new THREE.Vector3());
    assert.ok([size.x, size.y, size.z].sort((a, b) => a - b)[1]! < HAND_PIECE_MID_MAX, `${p.joint} holds no belly-arm skin`);
  }
});

test('the secondary-limb rule changes no rig except the necromorph', () => {
  const models = JSON.parse(readFileSync(new URL('../data/body-models.json', import.meta.url), 'utf8')) as Record<string, { url: string }>;
  for (const [id, { url }] of Object.entries(models)) {
    const bones = rigBones(new URL(`../../public/${url}`, import.meta.url));
    const now = mapRig(bones);
    const before = mapRig(bones, [], { secondaryLimbs: false });
    if (id === 'necromorph') assert.notDeepEqual(now.jointOf, before.jointOf, 'necromorph: the rule fires');
    else assert.deepEqual(now, before, `${id}: mapping unchanged`);
  }
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
  assert.ok(seen.has('necromorphCrowd') && seen.has('gameChar'));
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

// Heins's cybernetic right arm and hand are separate rigid pieces (imported-body-models "Rigid mechanical parts keep their shape",
// rebuild-heins-rig D7). Bent 90 degrees at the elbow, no piece changes an edge by more than 2%, except one that runs across the
// elbow (a cable: some of it on the upper arm, some on the forearm), and that only within 5 cm of the elbow along the arm (the
// cables wrap the elbow's outside, 4-5 cm off the arm's axis). Closed into a grip (the
// fist test's curl), every piece of the hand keeps its shape and the finger segments turn.
test('heins model: the cyber arm and hand move as rigid parts', async () => {
  const m = prepareBodyModel(await loadWithoutTextures(new URL('../../public/assets/models/squad/heins.glb', import.meta.url)), { detailHands: true });
  const w = worldJoints(m);
  const about = (at: THREE.Vector3, axis: THREE.Vector3, deg: number): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(at.x, at.y, at.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis.clone().normalize(), THREE.MathUtils.degToRad(deg)))
    .multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));
  // Rest positions of the detail bones, and the cyber pieces (welded by position across the prepared parts).
  const restAt = new Map<string, THREE.Vector3>();
  for (const b of m.handBones) restAt.set(b.name, (b.parent in w ? w[b.parent as JointName] : restAt.get(b.parent)!).clone().add(new THREE.Vector3(...b.offset)));
  const verts: Array<{ p: THREE.Vector3; w: Array<[number, number]> }> = [];
  const tris: number[] = [];
  for (const part of m.parts.filter((x) => x.surface === 'cyber_arm' || x.surface === 'cyber_hand')) {
    const pos = part.geometry.getAttribute('position'), si = part.geometry.getAttribute('skinIndex'), sw = part.geometry.getAttribute('skinWeight');
    const base = verts.length;
    for (let i = 0; i < pos.count; i++) {
      const ws: Array<[number, number]> = [];
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 0) ws.push([si.getComponent(i, k), sw.getComponent(i, k)]);
      verts.push({ p: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(w[part.joint]), w: ws });
    }
    for (const v of Array.from(part.geometry.getIndex()!.array)) tris.push(base + v);
  }
  assert.ok(verts.length > 3000, `${verts.length} cyber vertices`);
  const key = verts.map((v) => `${Math.round(v.p.x / 1e-4)},${Math.round(v.p.y / 1e-4)},${Math.round(v.p.z / 1e-4)}`);
  const weld = new Map<string, number>();
  const id = key.map((k, i) => weld.get(k) ?? (weld.set(k, i), i));
  const root = id.slice();
  const find = (a: number): number => { while (root[a] !== a) a = root[a] = root[root[a]!]!; return a; };
  for (let t = 0; t < tris.length; t += 3) for (const k of [1, 2]) root[find(id[tris[t + k]!]!)] = find(id[tris[t]!]!);
  const pieceOf = (t: number): number => find(id[tris[t]!]!);
  const posed = (slot: Map<number, THREE.Matrix4>) => verts.map((v) => v.w.reduce((o, [s, x]) => o.addScaledVector(v.p.clone().applyMatrix4(slot.get(s) ?? new THREE.Matrix4()), x), new THREE.Vector3()));
  const handSlot = (pred: (b: HandDetailBoneT) => boolean): number[] => m.handBones.flatMap((b, k) => (pred(b) ? [JOINTS.length + k] : []));
  type HandDetailBoneT = (typeof m.handBones)[number];
  // Elbow bent 90 degrees forward (-Z) about the elbow's side-to-side axis; the forearm, hand and every right detail bone follow.
  const bend = about(w.foreArm_R, new THREE.Vector3(1, 0, 0), 90);
  const elbowSlots = new Map<number, THREE.Matrix4>([[JOINT_INDEX.foreArm_R, bend], [JOINT_INDEX.hand_R, bend], ...handSlot((b) => b.side === 'R').map((s): [number, THREE.Matrix4] => [s, bend])]);
  const bent = posed(elbowSlots);
  assert.ok(bent.some((p, i) => p.distanceTo(verts[i]!.p) > 0.1), 'the forearm swings');
  const upper = new Set([JOINT_INDEX.upperArm_R]);
  const lower = new Set([JOINT_INDEX.foreArm_R, JOINT_INDEX.hand_R, ...elbowSlots.keys()]);
  const spans = new Map<number, { up: boolean; low: boolean }>();
  verts.forEach((v, i) => {
    const r = find(id[i]!);
    const s = spans.get(r) ?? spans.set(r, { up: false, low: false }).get(r)!;
    for (const [slot, x] of v.w) { if (x > 0.5 && upper.has(slot)) s.up = true; if (x > 0.5 && lower.has(slot)) s.low = true; }
  });
  const armAxis = w.hand_R.clone().sub(w.upperArm_R).normalize();
  const problems: string[] = [];
  let bending = 0;
  const bendingPieces = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k]!, b = tris[t + ((k + 1) % 3)]!;
    const r = verts[a]!.p.distanceTo(verts[b]!.p);
    if (r < 0.001) continue;
    const change = Math.abs(bent[a]!.distanceTo(bent[b]!) / r - 1);
    if (change <= 0.02) continue;
    const piece = pieceOf(t);
    const s = spans.get(piece)!;
    const near = Math.max(...[a, b].map((i) => Math.abs(verts[i]!.p.clone().sub(w.foreArm_R).dot(armAxis))));
    if (!(s.up && s.low) || near > 0.05) problems.push(`${verts[a]!.p.toArray().map((x) => x.toFixed(3))} changes ${(change * 100).toFixed(0)}% (${s.up && s.low ? `${(near * 100).toFixed(1)} cm from the elbow along the arm` : 'a rigid piece'})`);
    else if (!bendingPieces.has(piece)) { bendingPieces.add(piece); bending++; }
  }
  assert.deepEqual(problems.slice(0, 5), [], `${problems.length} edges bend at a 90-degree elbow`);
  assert.ok(bending <= 40, `${bending} pieces bend at the elbow`);
  // A grip: each right finger phalanx curled as the fist test curls it.
  const CURL = { thumb: [40, 40, 30], other: [70, 90, 60] };
  const curled = new Map<string, THREE.Matrix4>();
  for (const b of m.handBones) {
    if (b.kind !== 'finger' || b.side !== 'R') continue;
    const at = restAt.get(b.name)!;
    const deg = Math.max(0, (b.finger === 'thumb' ? CURL.thumb : CURL.other)[b.phalanx - 1]! - THREE.MathUtils.radToDeg(b.restCurl));
    const turn = about(at, new THREE.Vector3(...b.curlAxis), deg);
    curled.set(b.name, b.parent in w ? turn : curled.get(b.parent)!.clone().multiply(turn));
  }
  const gripSlots = new Map(m.handBones.flatMap((b, k): Array<[number, THREE.Matrix4]> => (curled.has(b.name) ? [[JOINTS.length + k, curled.get(b.name)!]] : [])));
  const grip = posed(gripSlots);
  const torn: string[] = [];
  const turned = new Set<number>();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tris[t + k]!, b = tris[t + ((k + 1) % 3)]!;
    if (grip[a]!.distanceTo(verts[a]!.p) > 0.005) turned.add(pieceOf(t));
    const r = verts[a]!.p.distanceTo(verts[b]!.p);
    if (r < 0.001) continue;
    const change = Math.abs(grip[a]!.distanceTo(grip[b]!) / r - 1);
    if (change > 0.02) torn.push(`${verts[a]!.p.toArray().map((x) => x.toFixed(3))} changes ${(change * 100).toFixed(0)}%`);
  }
  assert.deepEqual(torn.slice(0, 5), [], `${torn.length} edges stretch in a grip`);
  assert.ok(turned.size >= 15, `${turned.size} pieces turn with the fingers`);
});

// Both hands curl toward their own palms (imported-body-models "Thumb and fingers on their own sides", fix-bram-rig): a hand
// whose thumb side was guessed the wrong way round is labelled pinky to index, so it takes the wrong palm side and curls
// backward. In the rest pose each hand's index-to-pinky direction must match the other hand's mirrored left to right, and
// curling a finger must move its middle joint the mirrored way on both hands. Every body the game gives finger bones to
// (data/body-models.json `handRig`).
test('hand-rigged bodies: left and right hands mirror each other and curl the same way', async () => {
  const defs = JSON.parse(readFileSync(new URL('../data/body-models.json', import.meta.url), 'utf8')) as Record<string, { url: string; handRig?: boolean }>;
  const rigged = Object.entries(defs).filter(([, d]) => d.handRig);
  assert.ok(rigged.length >= 6, `${rigged.length} hand-rigged bodies`);
  const mirror = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(-v.x, v.y, v.z);
  const off = (c: number): string => THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, c)))).toFixed(0);
  const problems: string[] = [];
  for (const [name, def] of rigged) {
    const m = prepareBodyModel(await loadWithoutTextures(new URL(`../../public/${def.url}`, import.meta.url)), { detailHands: true });
    const w = worldJoints(m);
    const bone = (side: 'L' | 'R', finger: string, phalanx: number) =>
      m.handBones.find((b) => b.kind === 'finger' && b.side === side && b.finger === finger && b.phalanx === phalanx) as FingerBoneDef | undefined;
    const hand = (side: 'L' | 'R') => {
      const base = (finger: string): THREE.Vector3 | null => {
        const b = bone(side, finger, 1);
        return b ? w[b.parent as JointName].clone().add(new THREE.Vector3(...b.offset)) : null;
      };
      const index = base('index'), pinky = base('pinky') ?? base('ring'), thumb = base('thumb');
      assert.ok(index && pinky && thumb, `${name}: ${side} hand has thumb, index and pinky (or ring) bones`);
      // Curling the index's first phalanx: the way its second joint moves.
      const i1 = bone(side, 'index', 1)!, i2 = bone(side, 'index', 2)!;
      const seg = new THREE.Vector3(...i2.offset);
      const curl = seg.clone().applyAxisAngle(new THREE.Vector3(...i1.curlAxis).normalize(), THREE.MathUtils.degToRad(60)).sub(seg);
      return { across: pinky.clone().sub(index).normalize(), thumb, index, pinky, curl: curl.normalize() };
    };
    const L = hand('L'), R = hand('R');
    for (const [s, h] of [['L', L], ['R', R]] as const) {
      if (h.thumb.distanceTo(h.index) >= h.thumb.distanceTo(h.pinky)) problems.push(`${name}: the ${s} thumb grows from the pinky side`);
    }
    const across = L.across.dot(mirror(R.across));
    if (across < 0.5) problems.push(`${name}: the left hand's index-to-pinky runs ${off(across)} degrees off the right's mirrored`);
    const curl = L.curl.dot(mirror(R.curl));
    if (curl < 0.5) problems.push(`${name}: a curled left index moves ${off(curl)} degrees off the right's mirrored`);
  }
  assert.deepEqual(problems, []);
});

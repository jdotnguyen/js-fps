import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
    materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: unknown }; normalTexture?: unknown }>;
  };
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.pbrMetallicRoughness?.baseColorTexture;
    delete m.normalTexture;
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
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
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

// Dr. Okafor's body (data/body-models.json "doctor"): a Character Creator rig renamed and slimmed by scripts/fix-doctor-glb.mjs.
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

// Priya Anand's body (data/body-models.json "priya"): rigged model decimated, jaw-weighted and slimmed by scripts/fix-priya-glb.mjs.
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
  assert.deepEqual(m.unmapped, []);
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

// Talking (ADR-0027) needs a jaw: every squad model has real jaw weights on its lower face, hinged behind and below the cheek,
// well under the eyes and ears, so the chin can drop without the skull or the throat following it.
for (const name of ['mechanic', 'doctor', 'priya', 'sung'] as const) {
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

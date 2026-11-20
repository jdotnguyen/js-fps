/**
 * Retarget CC0 Quaternius Universal Animation Library (glTF) clips onto Thalassa's 21-joint
 * canonical humanoid skeleton (src/actors/skeleton.ts) and bake them into src/data/mocap-clips.json.
 *
 * Usage:
 *   node scripts/bake-mocap.mjs [path/to/AnimationLibrary_Godot_Standard.gltf]
 *
 * Source asset:
 *   Universal Animation Library (Standard) by Quaternius (CC0 1.0 Public Domain)
 *   https://quaternius.itch.io/universal-animation-library
 */

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const DEFAULT_SRC = 'C:/Users/justi/.gemini/antigravity-cli/brain/4a4164d3-2a56-4a1c-a435-1a5ae53af061/scratch/ual/AnimationLibrary_Godot_Standard.gltf';
const ZOMBIE_GLB_SRC = path.resolve('public/assets/models/infected/zombie_walk.glb');
const OUT_PATH = path.resolve('src/data/mocap-clips.json');
const SAMPLE_FPS = 24;
const REFERENCE_HEIGHT = 1.78;

/** Thalassa 21-joint layout (must stay in sync with src/actors/skeleton.ts). */
const THALASSA_JOINTS = [
  { name: 'root', parent: null, offset: [0, 0, 0] },
  { name: 'pelvis', parent: 'root', offset: [0, 0.98, 0] },
  { name: 'spine', parent: 'pelvis', offset: [0, 0.12, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.18, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.22, 0] },
  { name: 'head', parent: 'neck', offset: [0, 0.08, 0] },
  { name: 'jaw', parent: 'head', offset: [0, 0.062, 0.01] },
  { name: 'shoulder_L', parent: 'chest', offset: [-0.17, 0.2, 0] },
  { name: 'upperArm_L', parent: 'shoulder_L', offset: [-0.035, -0.01, 0] },
  { name: 'foreArm_L', parent: 'upperArm_L', offset: [0, -0.29, 0] },
  { name: 'hand_L', parent: 'foreArm_L', offset: [0, -0.26, 0] },
  { name: 'thigh_L', parent: 'pelvis', offset: [-0.095, -0.06, 0] },
  { name: 'shin_L', parent: 'thigh_L', offset: [0, -0.44, 0] },
  { name: 'foot_L', parent: 'shin_L', offset: [0, -0.42, 0] },
  { name: 'shoulder_R', parent: 'chest', offset: [0.17, 0.2, 0] },
  { name: 'upperArm_R', parent: 'shoulder_R', offset: [0.035, -0.01, 0] },
  { name: 'foreArm_R', parent: 'upperArm_R', offset: [0, -0.29, 0] },
  { name: 'hand_R', parent: 'foreArm_R', offset: [0, -0.26, 0] },
  { name: 'thigh_R', parent: 'pelvis', offset: [0.095, -0.06, 0] },
  { name: 'shin_R', parent: 'thigh_R', offset: [0, -0.44, 0] },
  { name: 'foot_R', parent: 'shin_R', offset: [0, -0.42, 0] },
];

/** Source bone in Quaternius Rigify skeleton for each Thalassa joint (jaw is procedural). */
const SRC_MAP = {
  pelvis: 'DEF-hips',
  spine: 'DEF-spine.002',
  chest: 'DEF-spine.003',
  neck: 'DEF-neck',
  head: 'DEF-head',
  shoulder_L: 'DEF-shoulder.L',
  upperArm_L: 'DEF-upper_arm.L',
  foreArm_L: 'DEF-forearm.L',
  hand_L: 'DEF-hand.L',
  thigh_L: 'DEF-thigh.L',
  shin_L: 'DEF-shin.L',
  foot_L: 'DEF-foot.L',
  shoulder_R: 'DEF-shoulder.R',
  upperArm_R: 'DEF-upper_arm.R',
  foreArm_R: 'DEF-forearm.R',
  hand_R: 'DEF-hand.R',
  thigh_R: 'DEF-thigh.R',
  shin_R: 'DEF-shin.R',
  foot_R: 'DEF-foot.R',
};

/** Clips to extract: target game clip id -> source glTF animation name + metadata. */
const CLIPS = [
  { id: 'idle', src: 'Idle_Loop', loop: true, loco: false },
  { id: 'idle_talk', src: 'Idle_Talking_Loop', loop: true, loco: false },
  { id: 'walk', src: 'Walk_Loop', loop: true, loco: true },
  { id: 'walk_formal', src: 'Walk_Formal_Loop', loop: true, loco: true },
  { id: 'jog', src: 'Jog_Fwd_Loop', loop: true, loco: true },
  { id: 'crouch_idle', src: 'Crouch_Idle_Loop', loop: true, loco: false },
  { id: 'kneel_fix', src: 'Fixing_Kneeling', loop: true, loco: false, start: 0.9, end: 3.8, seamBlend: 6 },
  { id: 'pistol_idle', src: 'Pistol_Idle_Loop', loop: true, loco: false },
];

// ---------------------------------------------------------------- glTF binary reader

function readAccessor(gltf, bin, idx) {
  const acc = gltf.accessors[idx];
  const bv = gltf.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const count = acc.count * compCount;
  const stride = bv.byteStride ?? 0;
  if (acc.componentType !== 5126) throw new Error(`unsupported componentType ${acc.componentType}`);
  if (!stride || stride === compCount * 4) {
    return new Float32Array(bin.buffer, bin.byteOffset + offset, count);
  }
  const out = new Float32Array(count);
  const dv = new DataView(bin.buffer, bin.byteOffset);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < compCount; c++) {
      out[i * compCount + c] = dv.getFloat32(offset + i * stride + c * 4, true);
    }
  }
  return out;
}

function sampleTrack(times, values, stride, t, isQuat, out) {
  const n = times.length;
  if (n === 0) return;
  if (t <= times[0] || n === 1) {
    for (let c = 0; c < stride; c++) out[c] = values[c];
    return;
  }
  if (t >= times[n - 1]) {
    const b = (n - 1) * stride;
    for (let c = 0; c < stride; c++) out[c] = values[b + c];
    return;
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - times[lo]) / Math.max(1e-6, times[hi] - times[lo]);
  const a = lo * stride;
  const b = hi * stride;
  if (isQuat) {
    const qa = new THREE.Quaternion(values[a], values[a + 1], values[a + 2], values[a + 3]);
    const qb = new THREE.Quaternion(values[b], values[b + 1], values[b + 2], values[b + 3]);
    qa.slerp(qb, f);
    out[0] = qa.x;
    out[1] = qa.y;
    out[2] = qa.z;
    out[3] = qa.w;
  } else {
    for (let c = 0; c < stride; c++) out[c] = values[a + c] + (values[b + c] - values[a + c]) * f;
  }
}

// ---------------------------------------------------------------- main

const srcPath = path.resolve(process.argv[2] ?? DEFAULT_SRC);
const gltf = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const binPath = path.resolve(path.dirname(srcPath), gltf.buffers[0].uri);
const bin = fs.readFileSync(binPath);

// Build source node hierarchy
const nodes = gltf.nodes.map((n, i) => {
  const o = new THREE.Object3D();
  o.name = n.name || `node_${i}`;
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  if (n.scale) o.scale.fromArray(n.scale);
  return o;
});
gltf.nodes.forEach((n, i) => (n.children || []).forEach((c) => nodes[i].add(nodes[c])));
const rootScene = new THREE.Group();
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) rootScene.add(nodes[r]);
// Save rest transforms so we can reset between clips
const restTransforms = nodes.map((n) => ({
  p: n.position.clone(),
  q: n.quaternion.clone(),
  s: n.scale.clone(),
}));
const resetNodes = () => {
  nodes.forEach((n, i) => {
    n.position.copy(restTransforms[i].p);
    n.quaternion.copy(restTransforms[i].q);
    n.scale.copy(restTransforms[i].s);
  });
};

const byName = new Map(nodes.map((n) => [n.name, n]));

// Global facing alignment: source faces +Z, Thalassa faces -Z -> rotate 180 deg around Y.
const R_ALIGN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

// Evaluate bind-pose world quaternions and positions (in Thalassa-facing world space)
resetNodes();
rootScene.updateMatrixWorld(true);

const bindWorldQ = {};
const bindWorldP = {};
for (const [jName, srcName] of Object.entries(SRC_MAP)) {
  const node = byName.get(srcName);
  if (!node) throw new Error(`missing source bone ${srcName}`);
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  node.getWorldQuaternion(q);
  node.getWorldPosition(p);
  bindWorldQ[jName] = R_ALIGN.clone().multiply(q);
  bindWorldP[jName] = p.applyQuaternion(R_ALIGN);
}

// Measure source character height (toe floor to head crown estimate) for pelvis displacement scaling.
const toeL = new THREE.Vector3();
byName.get('DEF-toe.L').getWorldPosition(toeL);
const headTopY = bindWorldP.head.y + 0.21;
const srcHeight = headTopY - (toeL.y - 0.015);
const heightScale = REFERENCE_HEIGHT / srcHeight;
console.log(`Source bind height ~${srcHeight.toFixed(3)} m -> scale ${heightScale.toFixed(4)}`);

/**
 * Exact anatomical world orientation A_j of each bone in the source's T-pose bind pose,
 * expressed in Thalassa's canonical rest frame (where arms hang straight down -Y, legs down -Y,
 * spine up +Y, facing -Z).
 *
 * In Thalassa (skeleton.ts / bodyModel.ts):
 * - Arms hang straight down (-Y) with elbows flexing forward (+X) and palms facing inward.
 * - Raising left arm from hanging (-Y) to horizontal T-pose (-X) with palm facing down (-Y)
 *   is Rot_Z(-90 deg) (minus slight 3.4 deg rest flare in bodyModel.ts: armDir = (+-0.06, -1, 0)).
 * - Raising right arm to +X with palm facing down (-Y) is Rot_Z(+90 deg).
 */
const D2R = Math.PI / 180;
const REST_ARM_FLARE_DEG = Math.atan2(0.06, 1) * (180 / Math.PI); // ~3.43 deg matching bodyModel.ts
const A_BIND = {};
for (const j of THALASSA_JOINTS) A_BIND[j.name] = new THREE.Quaternion();
A_BIND.upperArm_L = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -(90 - REST_ARM_FLARE_DEG) * D2R);
A_BIND.foreArm_L = A_BIND.upperArm_L.clone();
A_BIND.hand_L = A_BIND.upperArm_L.clone();
A_BIND.upperArm_R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (90 - REST_ARM_FLARE_DEG) * D2R);
A_BIND.foreArm_R = A_BIND.upperArm_R.clone();
A_BIND.hand_R = A_BIND.upperArm_R.clone();

// Precompute constant frame conversion C_j = bindWorldQ[j]^{-1} * A_BIND[j]
const C_MAT = {};
for (const jName of Object.keys(SRC_MAP)) {
  C_MAT[jName] = bindWorldQ[jName].clone().invert().multiply(A_BIND[jName]);
}

// Build a Thalassa reference skeleton for FK validation & foot-contact extraction
function buildThalassaRig() {
  const bones = {};
  for (const j of THALASSA_JOINTS) {
    const b = new THREE.Object3D();
    b.name = j.name;
    b.position.set(j.offset[0], j.offset[1], j.offset[2]);
    bones[j.name] = b;
    if (j.parent) bones[j.parent].add(b);
  }
  return bones;
}

const r3 = (v) => Math.round(v * 1000) / 1000;

const outClips = {};
const rig = buildThalassaRig();

for (const spec of CLIPS) {
  const anim = gltf.animations.find((a) => a.name === spec.src);
  if (!anim) throw new Error(`animation "${spec.src}" not found in glTF`);

  // Decode samplers once
  const tracks = anim.channels.map((ch) => {
    const smp = anim.samplers[ch.sampler];
    const times = readAccessor(gltf, bin, smp.input);
    const values = readAccessor(gltf, bin, smp.output);
    const pathName = ch.target.path;
    const stride = pathName === 'rotation' ? 4 : 3;
    return { node: ch.target.node, path: pathName, times, values, stride };
  });

  const rawDuration = Math.max(...tracks.map((tr) => tr.times[tr.times.length - 1] ?? 0));
  const tStart = spec.start ?? 0;
  const tEnd = spec.end ?? rawDuration;
  const duration = tEnd - tStart;
  const frameCount = Math.max(2, Math.round(duration * SAMPLE_FPS));
  const dt = duration / frameCount;

  // For looping clips we store `frameCount` frames at tStart + f * dt (wrapping smoothly to frame 0).
  const numFrames = spec.loop ? frameCount : frameCount + 1;
  const jointNames = THALASSA_JOINTS.map((j) => j.name).filter((n) => n !== 'root' && n !== 'jaw');
  const qFrames = {};
  for (const j of jointNames) qFrames[j] = [];
  const pelvisPos = [];
  const footPosL = [];
  const footPosR = [];

  const tmpBuf = [0, 0, 0, 0];
  const worldQ = {};

  for (let f = 0; f < numFrames; f++) {
    const t = tStart + f * dt;
    resetNodes();
    for (const tr of tracks) {
      const node = nodes[tr.node];
      if (!node) continue;
      sampleTrack(tr.times, tr.values, tr.stride, t, tr.path === 'rotation', tmpBuf);
      if (tr.path === 'rotation') node.quaternion.set(tmpBuf[0], tmpBuf[1], tmpBuf[2], tmpBuf[3]).normalize();
      else if (tr.path === 'translation') node.position.set(tmpBuf[0], tmpBuf[1], tmpBuf[2]);
      else if (tr.path === 'scale') node.scale.set(tmpBuf[0], tmpBuf[1], tmpBuf[2]);
    }
    rootScene.updateMatrixWorld(true);

    // Retargeted world quaternions
    worldQ.root = new THREE.Quaternion();
    for (const jName of jointNames) {
      const srcNode = byName.get(SRC_MAP[jName]);
      const q = new THREE.Quaternion();
      srcNode.getWorldQuaternion(q);
      worldQ[jName] = R_ALIGN.clone().multiply(q).multiply(C_MAT[jName]).normalize();
    }

    // Parent-relative local quaternions
    for (const j of THALASSA_JOINTS) {
      if (j.name === 'root' || j.name === 'jaw') continue;
      const pQ = worldQ[j.parent];
      const localQ = pQ.clone().invert().multiply(worldQ[j.name]).normalize();
      qFrames[j.name].push(localQ);
    }

    // Pelvis displacement relative to bind pose, in Thalassa coordinates
    const hipsPos = new THREE.Vector3();
    byName.get('DEF-hips').getWorldPosition(hipsPos);
    hipsPos.applyQuaternion(R_ALIGN).sub(bindWorldP.pelvis).multiplyScalar(heightScale);
    pelvisPos.push([hipsPos.x, hipsPos.y, hipsPos.z]);
  }

  // Optional loop seam blend for trimmed clips (e.g. kneel_fix)
  if (spec.seamBlend && spec.seamBlend > 0) {
    const n = Math.min(spec.seamBlend, Math.floor(numFrames / 3));
    for (let k = 0; k < n; k++) {
      const fi = numFrames - n + k;
      const s = (k + 1) / (n + 1);
      const smooth = s * s * (3 - 2 * s);
      for (const j of jointNames) {
        qFrames[j][fi].slerp(qFrames[j][0], smooth);
      }
      for (let c = 0; c < 3; c++) {
        pelvisPos[fi][c] = pelvisPos[fi][c] + (pelvisPos[0][c] - pelvisPos[fi][c]) * smooth;
      }
    }
  }

  // Hemisphere continuity & flatten tracks + run FK for foot contacts
  const tracksOut = {};
  for (const j of jointNames) {
    tracksOut[j] = [];
    for (let f = 0; f < numFrames; f++) {
      const q = qFrames[j][f];
      if (f > 0 && q.dot(qFrames[j][f - 1]) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      tracksOut[j].push(r3(q.x), r3(q.y), r3(q.z), r3(q.w));
    }
  }

  // Center mean XZ pelvis offset so looping clips never bias the character off-center
  let meanX = 0;
  let meanZ = 0;
  for (const p of pelvisPos) {
    meanX += p[0];
    meanZ += p[2];
  }
  meanX /= pelvisPos.length;
  meanZ /= pelvisPos.length;
  const pelvisFlat = [];
  for (let f = 0; f < numFrames; f++) {
    const p = pelvisPos[f];
    const px = p[0] - meanX;
    const py = p[1];
    const pz = p[2] - meanZ;
    pelvisFlat.push(r3(px), r3(py), r3(pz));
    for (const j of jointNames) rig[j].quaternion.copy(qFrames[j][f]);
    rig.pelvis.position.set(px, 0.98 + py, pz);
    rig.root.updateMatrixWorld(true);
    const fl = new THREE.Vector3();
    const fr = new THREE.Vector3();
    rig.foot_L.getWorldPosition(fl);
    rig.foot_R.getWorldPosition(fr);
    footPosL.push(fl);
    footPosR.push(fr);
  }

  // Extract foot-contact weights (0..1) and natural stride length for locomotion clips
  let contactL = null;
  let contactR = null;
  let stride = 0;
  if (spec.loco) {
    const minY = Math.min(...footPosL.map((p) => p.y), ...footPosR.map((p) => p.y));
    const maxY = Math.max(...footPosL.map((p) => p.y), ...footPosR.map((p) => p.y));
    const ySpan = Math.max(0.05, maxY - minY);
    const computeContact = (pts) => {
      const c = [];
      let stanceTravel = 0;
      for (let f = 0; f < numFrames; f++) {
        const prev = pts[(f - 1 + numFrames) % numFrames];
        const next = pts[(f + 1) % numFrames];
        const cur = pts[f];
        // Foot moving backward (+Z in Thalassa facing -Z) while low = stance!
        const vz = (next.z - prev.z) / (2 * dt);
        const hNorm = (cur.y - minY) / ySpan;
        const low = THREE.MathUtils.clamp(1 - (hNorm - 0.12) / 0.25, 0, 1);
        const back = THREE.MathUtils.clamp((vz - 0.1) / 0.6, 0, 1);
        const w = low * back;
        c.push(r3(w));
        if (w > 0.5) stanceTravel += Math.max(0, (next.z - prev.z) * 0.5);
      }
      return { c, stanceTravel };
    };
    const resL = computeContact(footPosL);
    const resR = computeContact(footPosR);
    contactL = resL.c;
    contactR = resR.c;
    // Total forward distance covered in one full two-step cycle
    stride = r3(Math.max(0.6, resL.stanceTravel + resR.stanceTravel));
  }

  // Diagnostic FK check at frame 0 and mid-cycle
  const checkFrame = (fi) => {
    for (const j of jointNames) {
      const k = fi * 4;
      rig[j].quaternion.set(tracksOut[j][k], tracksOut[j][k + 1], tracksOut[j][k + 2], tracksOut[j][k + 3]).normalize();
    }
    rig.pelvis.position.set(pelvisFlat[fi * 3], 0.98 + pelvisFlat[fi * 3 + 1], pelvisFlat[fi * 3 + 2]);
    rig.root.updateMatrixWorld(true);
    const hl = new THREE.Vector3();
    const hr = new THREE.Vector3();
    const fl = new THREE.Vector3();
    rig.hand_L.getWorldPosition(hl);
    rig.hand_R.getWorldPosition(hr);
    rig.foot_L.getWorldPosition(fl);
    const eShinL = new THREE.Euler().setFromQuaternion(rig.shin_L.quaternion, 'XYZ');
    const eForeL = new THREE.Euler().setFromQuaternion(rig.foreArm_L.quaternion, 'XYZ');
    return `handL(${hl.x.toFixed(2)},${hl.y.toFixed(2)},${hl.z.toFixed(2)}) handR(${hr.x.toFixed(2)},${hr.y.toFixed(2)},${hr.z.toFixed(2)}) footL.y=${fl.y.toFixed(2)} shinL.x=${(eShinL.x / D2R).toFixed(0)}° foreL.x=${(eForeL.x / D2R).toFixed(0)}°`;
  };

  console.log(
    `[${spec.id.padEnd(11)}] ${duration.toFixed(2)}s (${numFrames}f)` +
      (stride ? ` stride=${stride.toFixed(2)}m (${(stride / duration).toFixed(2)}m/s)` : '') +
      `\n    f0:   ${checkFrame(0)}\n    fMid: ${checkFrame(Math.floor(numFrames / 2))}`,
  );

  outClips[spec.id] = {
    duration: r3(duration),
    frames: numFrames,
    loop: spec.loop,
    ...(stride ? { stride } : {}),
    pelvis: pelvisFlat,
    ...(contactL ? { contactL, contactR } : {}),
    joints: tracksOut,
  };
}

// ---------------------------------------------------------------- zombie_walk.glb retargeting
// Extracts the authentic 3.87s slow limping zombie walk mocap (`slowB_002_strafe_walkslow_0`)
// from public/assets/models/infected/zombie_walk.glb using the exact inverse of bodyModel.ts's
// rest-pose straightening (`Poser`), plus derives a slow swaying `zombie_idle` loop.

function bakeZombieClips() {
  const buf = fs.readFileSync(ZOMBIE_GLB_SRC);
  const jsonLen = buf.readUInt32LE(12);
  const zg = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const zbin = buf.subarray(20 + jsonLen + 8);

  const zNodes = zg.nodes.map((n, i) => {
    const o = new THREE.Object3D();
    o.name = n.name || `z_${i}`;
    if (n.matrix) {
      new THREE.Matrix4().fromArray(n.matrix).decompose(o.position, o.quaternion, o.scale);
    } else {
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
    }
    return o;
  });
  zg.nodes.forEach((n, i) => (n.children || []).forEach((c) => zNodes[i].add(zNodes[c])));
  const zRoot = new THREE.Group();
  for (const r of zg.scenes[zg.scene ?? 0].nodes) zRoot.add(zNodes[r]);
  const zRest = zNodes.map((n) => ({ p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone() }));
  const zReset = () =>
    zNodes.forEach((n, i) => {
      n.position.copy(zRest[i].p);
      n.quaternion.copy(zRest[i].q);
      n.scale.copy(zRest[i].s);
    });
  const zByName = new Map(zNodes.map((n) => [n.name, n]));

  const Z_MAP = {
    pelvis: 'Pelvis_1',
    spine: 'Spine2_3',
    chest: 'Spine4_5',
    neck: 'Neck_6',
    head: 'Head_7',
    shoulder_L: 'L_Collar_31',
    upperArm_L: 'L_Shoulder_32',
    foreArm_L: 'L_Elbow_33',
    hand_L: 'L_Wrist_34',
    thigh_L: 'L_Hip_57',
    shin_L: 'L_Knee_58',
    foot_L: 'L_Ankle_59',
    shoulder_R: 'R_Collar_11',
    upperArm_R: 'R_Shoulder_12',
    foreArm_R: 'R_Elbow_13',
    hand_R: 'R_Wrist_14',
    thigh_R: 'R_Hip_53',
    shin_R: 'R_Knee_54',
    foot_R: 'R_Ankle_55',
  };

  // Build exact same Poser straightening transforms as src/actors/bodyModel.ts on the skin's bind pose
  const skin = zg.skins[0];
  const ibms = readAccessor(zg, zbin, skin.inverseBindMatrices);
  const sBones = skin.joints.map((ni) => zNodes[ni]);
  const sIndex = new Map(sBones.map((b, i) => [b, i]));
  const sByName = new Map(sBones.map((b, i) => [b.name, i]));
  const bind = [];
  const deform = [];
  const children = sBones.map(() => []);
  for (let i = 0; i < sBones.length; i++) {
    bind.push(new THREE.Matrix4().fromArray(ibms, i * 16).invert());
    deform.push(new THREE.Matrix4());
    for (let p = sBones[i].parent; p; p = p.parent) {
      const pi = sIndex.get(p);
      if (pi !== undefined) {
        children[pi].push(i);
        break;
      }
    }
  }
  const posOf = (i) => new THREE.Vector3().setFromMatrixPosition(bind[i]).applyMatrix4(deform[i]);
  const subtree = (i) => {
    const out = [i];
    for (let k = 0; k < out.length; k++) out.push(...children[out[k]]);
    return out;
  };
  const applyAll = (m) => {
    for (const d of deform) d.premultiply(m);
  };
  const aim = (i, end, dir) => {
    if (i === undefined || end === undefined || i === end) return;
    const p = posOf(i);
    const cur = posOf(end).sub(p);
    if (cur.lengthSq() < 1e-10) return;
    const q = new THREE.Quaternion().setFromUnitVectors(cur.normalize(), dir.clone().normalize());
    const g = new THREE.Matrix4()
      .makeTranslation(p.x, p.y, p.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(q))
      .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
    for (const k of subtree(i)) deform[k].premultiply(g);
  };

  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const TOE_DIR = new THREE.Vector3(0, -0.45, -0.89).normalize();

  // Align facing -Z (matching bodyModel.ts lines 242-247)
  const right = posOf(sByName.get('R_Hip_53')).sub(posOf(sByName.get('L_Hip_57')));
  right.y = 0;
  const forward = new THREE.Vector3().crossVectors(UP, right.normalize());
  const yaw = Math.atan2(-forward.x, -forward.z);
  const rAlign = new THREE.Quaternion().setFromAxisAngle(UP, -yaw);
  applyAll(new THREE.Matrix4().makeRotationY(-yaw));

  // Straighten into Thalassa's canonical rest pose (matching bodyModel.ts lines 250-260)
  aim(sByName.get('Spine1_2'), sByName.get('Neck_6'), UP);
  for (const s of ['L', 'R']) {
    const out = s === 'L' ? -1 : 1;
    const armDir = new THREE.Vector3(out * 0.06, -1, 0);
    const ua = sByName.get(s === 'L' ? 'L_Shoulder_32' : 'R_Shoulder_12');
    const fa = sByName.get(s === 'L' ? 'L_Elbow_33' : 'R_Elbow_13');
    const ha = sByName.get(s === 'L' ? 'L_Wrist_34' : 'R_Wrist_14');
    const me = sByName.get(s === 'L' ? 'L_MiddleA_38' : 'R_MiddleA_18');
    const th = sByName.get(s === 'L' ? 'L_Hip_57' : 'R_Hip_53');
    const sh = sByName.get(s === 'L' ? 'L_Knee_58' : 'R_Knee_54');
    const ft = sByName.get(s === 'L' ? 'L_Ankle_59' : 'R_Ankle_55');
    const to = sByName.get(s === 'L' ? 'L_Toe_60' : 'R_Toe_56');
    aim(ua, fa, armDir);
    aim(fa, ha, armDir);
    aim(ha, me, DOWN);
    aim(th, sh, DOWN);
    aim(sh, ft, DOWN);
    aim(ft, to, TOE_DIR);
  }

  // Canonical rest world quaternion for each mapped bone: Q_rest = Rot(deform) * Q_bind_world
  zReset();
  zRoot.updateMatrixWorld(true);
  const restWorldInv = {};
  const zRestPelvis = posOf(sByName.get('Pelvis_1'));
  const zRestToeL = posOf(sByName.get('L_Toe_60'));
  const zRestHead = posOf(sByName.get('Head_7'));
  const zHeight = zRestHead.y + (zRestPelvis.y - zRestToeL.y) * 0.24 - zRestToeL.y;
  const zScale = REFERENCE_HEIGHT / zHeight;

  const tmpPos = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  for (const [jName, srcName] of Object.entries(Z_MAP)) {
    const si = sByName.get(srcName);
    const qBind = new THREE.Quaternion();
    zByName.get(srcName).getWorldQuaternion(qBind);
    deform[si].decompose(tmpPos, tmpQuat, tmpScale);
    restWorldInv[jName] = tmpQuat.clone().multiply(qBind).normalize().invert();
  }

  // Decode animation tracks
  const anim = zg.animations[0];
  const zTracks = anim.channels.map((ch) => {
    const smp = anim.samplers[ch.sampler];
    const times = readAccessor(zg, zbin, smp.input);
    const values = readAccessor(zg, zbin, smp.output);
    const pathName = ch.target.path;
    return { node: ch.target.node, path: pathName, times, values, stride: pathName === 'rotation' ? 4 : 3 };
  });

  const duration = Math.max(...zTracks.map((tr) => tr.times[tr.times.length - 1] ?? 0));
  const numFrames = Math.max(2, Math.round(duration * SAMPLE_FPS));
  const dt = duration / numFrames;
  const jointNames = THALASSA_JOINTS.map((j) => j.name).filter((n) => n !== 'root' && n !== 'jaw');
  const qFrames = {};
  for (const j of jointNames) qFrames[j] = [];
  const pelvisPos = [];
  const tmpBuf = [0, 0, 0, 0];
  const worldQ = {};

  for (let f = 0; f < numFrames; f++) {
    const t = f * dt;
    zReset();
    for (const tr of zTracks) {
      const node = zNodes[tr.node];
      if (!node) continue;
      sampleTrack(tr.times, tr.values, tr.stride, t, tr.path === 'rotation', tmpBuf);
      if (tr.path === 'rotation') node.quaternion.set(tmpBuf[0], tmpBuf[1], tmpBuf[2], tmpBuf[3]).normalize();
      else if (tr.path === 'translation') node.position.set(tmpBuf[0], tmpBuf[1], tmpBuf[2]);
      else if (tr.path === 'scale') node.scale.set(tmpBuf[0], tmpBuf[1], tmpBuf[2]);
    }
    zRoot.updateMatrixWorld(true);

    worldQ.root = new THREE.Quaternion();
    for (const jName of jointNames) {
      const q = new THREE.Quaternion();
      zByName.get(Z_MAP[jName]).getWorldQuaternion(q);
      worldQ[jName] = rAlign.clone().multiply(q).multiply(restWorldInv[jName]).normalize();
    }
    for (const j of THALASSA_JOINTS) {
      if (j.name === 'root' || j.name === 'jaw') continue;
      const localQ = worldQ[j.parent].clone().invert().multiply(worldQ[j.name]).normalize();
      qFrames[j.name].push(localQ);
    }

    const hp = new THREE.Vector3();
    zByName.get('Pelvis_1').getWorldPosition(hp);
    hp.applyQuaternion(rAlign).sub(zRestPelvis).multiplyScalar(zScale);
    pelvisPos.push([hp.x, hp.y, hp.z]);
  }

  // Smooth 4-frame loop seam blend so the 3.87s zombie walk loops invisibly
  const seam = 4;
  for (let k = 0; k < seam; k++) {
    const fi = numFrames - seam + k;
    const s = (k + 1) / (seam + 1);
    const sm = s * s * (3 - 2 * s);
    for (const j of jointNames) qFrames[j][fi].slerp(qFrames[j][0], sm);
    for (let c = 0; c < 3; c++) pelvisPos[fi][c] += (pelvisPos[0][c] - pelvisPos[fi][c]) * sm;
  }

  // Hemisphere continuity + center pelvis XZ + extract contacts & stride
  const tracksOut = {};
  for (const j of jointNames) {
    tracksOut[j] = [];
    for (let f = 0; f < numFrames; f++) {
      const q = qFrames[j][f];
      if (f > 0 && q.dot(qFrames[j][f - 1]) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      tracksOut[j].push(r3(q.x), r3(q.y), r3(q.z), r3(q.w));
    }
  }
  let meanX = 0;
  let meanZ = 0;
  for (const p of pelvisPos) {
    meanX += p[0];
    meanZ += p[2];
  }
  meanX /= numFrames;
  meanZ /= numFrames;
  const pelvisFlat = [];
  const footPosL = [];
  const footPosR = [];
  for (let f = 0; f < numFrames; f++) {
    const p = pelvisPos[f];
    const px = p[0] - meanX;
    const py = THREE.MathUtils.clamp(p[1], -0.18, 0.08);
    const pz = p[2] - meanZ;
    pelvisFlat.push(r3(px), r3(py), r3(pz));
    for (const j of jointNames) rig[j].quaternion.copy(qFrames[j][f]);
    rig.pelvis.position.set(px, 0.98 + py, pz);
    rig.root.updateMatrixWorld(true);
    const fl = new THREE.Vector3();
    const fr = new THREE.Vector3();
    rig.foot_L.getWorldPosition(fl);
    rig.foot_R.getWorldPosition(fr);
    footPosL.push(fl);
    footPosR.push(fr);
  }

  const minY = Math.min(...footPosL.map((p) => p.y), ...footPosR.map((p) => p.y));
  const maxY = Math.max(...footPosL.map((p) => p.y), ...footPosR.map((p) => p.y));
  const ySpan = Math.max(0.05, maxY - minY);
  const extract = (pts) => {
    const c = [];
    let stanceTravel = 0;
    for (let f = 0; f < numFrames; f++) {
      const prev = pts[(f - 1 + numFrames) % numFrames];
      const next = pts[(f + 1) % numFrames];
      const cur = pts[f];
      const vz = (next.z - prev.z) / (2 * dt);
      const hNorm = (cur.y - minY) / ySpan;
      const low = THREE.MathUtils.clamp(1 - (hNorm - 0.16) / 0.3, 0, 1);
      const back = THREE.MathUtils.clamp((vz + 0.05) / 0.45, 0, 1);
      const w = low * back;
      c.push(r3(w));
      if (w > 0.5) stanceTravel += Math.max(0, (next.z - prev.z) * 0.5);
    }
    return { c, stanceTravel };
  };
  const rL = extract(footPosL);
  const rR = extract(footPosR);
  // This 3.87s clip contains multiple slow limping strides; total travel per full clip loop:
  const stride = r3(Math.max(1.2, rL.stanceTravel + rR.stanceTravel));

  console.log(
    `[zombie_walk] ${duration.toFixed(2)}s (${numFrames}f) totalLoopTravel=${stride.toFixed(2)}m (${(stride / duration).toFixed(2)}m/s)` +
      `\n    cL: ${rL.c.filter((_, i) => i % 2 === 0).map((v) => (v > 0.5 ? '#' : '.')).join('')}` +
      `\n    cR: ${rR.c.filter((_, i) => i % 2 === 0).map((v) => (v > 0.5 ? '#' : '.')).join('')}`,
  );

  outClips['zombie_walk'] = {
    duration: r3(duration),
    frames: numFrames,
    loop: true,
    stride,
    pelvis: pelvisFlat,
    contactL: rL.c,
    contactR: rR.c,
    joints: tracksOut,
  };

  // Derive a slow, eerie swaying `zombie_idle` clip by averaging the double-support hunched upper body
  // of `zombie_walk` over a relaxed wide stance with slow heavy breathing and weight-sway.
  const idleFrames = 72; // 3.0s at 24 Hz
  const idleDur = 3.0;
  const zIdleTracks = {};
  const zIdlePelvis = [];
  const qAvg = {};
  for (const j of jointNames) {
    // Average quaternion across the zombie_walk cycle for natural zombie resting angles
    let ax = 0, ay = 0, az = 0, aw = 0;
    for (let f = 0; f < numFrames; f++) {
      const q = qFrames[j][f];
      ax += q.x;
      ay += q.y;
      az += q.z;
      aw += q.w;
    }
    qAvg[j] = new THREE.Quaternion(ax, ay, az, aw).normalize();
    zIdleTracks[j] = [];
  }
  // Keep legs grounded in an uneven shambling stance (slight knee bend, wide base)
  const eTmp = new THREE.Euler();
  const qAdd = new THREE.Quaternion();
  const qRes = new THREE.Quaternion();
  for (let f = 0; f < idleFrames; f++) {
    const a = (f / idleFrames) * Math.PI * 2;
    const sway = Math.sin(a);
    const breath = Math.sin(a * 2 + 0.6);
    zIdlePelvis.push(r3(0.022 * sway), r3(-0.045 + 0.008 * breath), r3(0.008 * Math.cos(a)));
    for (const j of jointNames) {
      qRes.copy(qAvg[j]);
      // Soften leg stride average into a stable uneven standing stance
      if (j === 'thigh_L') qRes.setFromEuler(eTmp.set(0.14, 0.04, -0.06));
      else if (j === 'thigh_R') qRes.setFromEuler(eTmp.set(-0.08, -0.05, 0.07));
      else if (j === 'shin_L') qRes.setFromEuler(eTmp.set(-0.24, 0, 0));
      else if (j === 'shin_R') qRes.setFromEuler(eTmp.set(-0.14, 0, 0));
      else if (j === 'foot_L') qRes.setFromEuler(eTmp.set(0.1, 0, 0));
      else if (j === 'foot_R') qRes.setFromEuler(eTmp.set(0.12, 0, 0));

      // Layer slow heavy breathing and eerie side-to-side sway
      if (j === 'pelvis') qRes.multiply(qAdd.setFromEuler(eTmp.set(0, 0.04 * sway, 0.06 * sway)));
      else if (j === 'spine') qRes.multiply(qAdd.setFromEuler(eTmp.set(-0.03 * breath, -0.03 * sway, -0.04 * sway)));
      else if (j === 'chest') qRes.multiply(qAdd.setFromEuler(eTmp.set(0.04 * breath, 0.03 * Math.cos(a), 0.04 * sway)));
      else if (j === 'head') qRes.multiply(qAdd.setFromEuler(eTmp.set(-0.06 * breath, 0.08 * Math.sin(a - 0.5), 0.09 * Math.cos(a))));
      else if (j === 'upperArm_L') qRes.multiply(qAdd.setFromEuler(eTmp.set(0.06 * sway, 0, -0.04 * breath)));
      else if (j === 'upperArm_R') qRes.multiply(qAdd.setFromEuler(eTmp.set(-0.05 * sway, 0, 0.04 * breath)));
      qRes.normalize();
      zIdleTracks[j].push(r3(qRes.x), r3(qRes.y), r3(qRes.z), r3(qRes.w));
    }
  }
  outClips['zombie_idle'] = {
    duration: idleDur,
    frames: idleFrames,
    loop: true,
    pelvis: zIdlePelvis,
    joints: zIdleTracks,
  };
  console.log(`[zombie_idle] ${idleDur.toFixed(2)}s (${idleFrames}f) derived from zombie_walk resting posture`);
}

bakeZombieClips();

const payload = {
  version: 1,
  fps: SAMPLE_FPS,
  source: 'Quaternius Universal Animation Library (CC0 1.0) + zombie_walk.glb (CC-BY-NC 4.0)',
  clips: outClips,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(payload));
const sizeKb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
console.log(`\nWrote ${OUT_PATH} (${sizeKb} KB)`);

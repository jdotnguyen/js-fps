// Builds Katie Heins' body for bodyModel.ts (ADR-0026) from the Sketchfab "BS-V1 Cyber female Character" (Blue Spirit, CC-BY 4.0;
// the page is in CREDITS.md), openspec rebuild-heins-rig.
//   node scripts/fix-heins-glb.mjs <bs-v1_cyborg.glb> <BS-V1 Cyber female Character .obj> [public/assets/models/squad/heins.glb]
// Both sources come from that page's downloads and are kept, uncommitted, in previews/hein_src/ (D1): the 339 MB GLB (`bs-v1_cyborg.glb`,
// 16 meshes, 10 materials, 35 PNG textures at up to 4096 px, ~147k triangles, an unrigged A-pose in a Z-up root scaled 0.99) and the
// OBJ inside `source/BS-V1 Cyber female Character .zip` of the "bs-v1-cyborg" download (the same vertices, with each face's group
// naming its main bone in the artist's own Unreal-style rig: spine_01, neck_02, upperarm_twist_01_l, ...).
// What it does:
//   - bakes the root transform into Y-up metres with feet at y = 0, facing +Z, and drops the empty placeholder mesh; meshes are
//     grouped by material (Cyber_Arm, Cyber_Hand and Shoes were split over several) and every source triangle and texel is kept (D9);
//   - carries the OBJ's bone labels onto the GLB's triangles by position (scripts/lib/obj-labels.mjs, D4);
//   - builds a Mixamo-named skeleton from the J table below, measured off the mesh and checked against the label boundaries (D8);
//   - cuts the jacket's sleeves from its sides below the armpits and caps both sides (scan-body.mjs splitArms, D2);
//   - skins each vertex by distance to the bones' capsules, but only from the bones its labels name and their parents and children
//     (D4); then the neck rule (scan-body.mjs applyNeckRule) and a collar rule (D5), a jaw split along the lip opening (D6), the cyber
//     arm and hand moved as rigid pieces (D7), and finger chains and forearm twist bones (hand-rig.mjs);
//   - keeps the colour and normal maps at source resolution (the hair's re-coloured purple, D9): body materials sample only those
//     two; metallic, roughness, emissive and the eyes' and teeth's normal maps are dropped.
// Uses ImageMagick (`magick`/`convert`) where it finds it, else Windows' System.Drawing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { rigHands, splitHands } from './lib/hand-rig.mjs';
import { ELBOW_BAND, applyNeckRule, smooth, splitArms } from './lib/scan-body.mjs';
import { matchPositions, objPositionIndex, readObjLabels, triangleFaces } from './lib/obj-labels.mjs';

const [src, objSrc, dst = 'public/assets/models/squad/heins.glb'] = process.argv.slice(2);
if (!src || !objSrc) throw new Error('usage: node scripts/fix-heins-glb.mjs <source.glb> <source.obj> [out.glb]');

// ------------------------------------------------------------------ read
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);
const COMP = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
function read(ai) {
  const a = j.accessors[ai];
  const bv = j.bufferViews[a.bufferView];
  const [size, fn] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride ?? size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * n);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv[fn](base + i * stride + k * size, true);
  return out;
}

// node world matrices (column-major)
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const parent = new Map();
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const world = (i) => {
  let m = j.nodes[i].matrix ?? I4;
  for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = mul(j.nodes[p].matrix ?? I4, m);
  return m;
};

// ------------------------------------------------------------------ group meshes by material, bake transforms, carry labels
const meshNodes = [];
for (const [ni, node] of j.nodes.entries()) {
  if (node.mesh === undefined) continue;
  const prim = j.meshes[node.mesh].primitives[0];
  if (j.accessors[prim.indices].count < 3) continue; // empty placeholder
  meshNodes.push({ ni, prim, mat: prim.material });
}
let minY = Infinity;
for (const { ni, prim } of meshNodes) {
  const m = world(ni);
  const p = read(prim.attributes.POSITION);
  for (let v = 0; v < p.length / 3; v++) minY = Math.min(minY, m[1] * p[v * 3] + m[5] * p[v * 3 + 1] + m[9] * p[v * 3 + 2] + m[13]);
}
const OUT_NAME = {
  Aver: 'jacket', Body: 'skin_body', Cyber_Arm: 'cyber_arm', Cyber_Hand: 'cyber_hand', Eyes: 'eyes', Hair: 'hair',
  Head: 'head', Shirt_and_pants: 'clothes', Shoes: 'shoes', Teeth: 'teeth',
};
const obj = readObjLabels(fs.readFileSync(objSrc, 'utf8'));
const objIndex = objPositionIndex(obj);
// The OBJ is the GLB's source before Sketchfab's Z-up root: GLB mesh (x, y, z) is OBJ (x, z, -y).
const toObj = (x, y, z) => [x, z, -y];

const groups = []; // { name, pos[], nor[], uv[], idx[], label: Int16Array per triangle (index into obj.labels), count, srcTris }
for (const matIdx of [...new Set(meshNodes.map((m) => m.mat))]) {
  const name = j.materials[matIdx].name;
  const g = { matIdx, name, pos: [], nor: [], uv: [], idx: [], labels: [], objects: [] };
  for (const { ni, prim } of meshNodes.filter((m) => m.mat === matIdx)) {
    const m = world(ni);
    const pos = read(prim.attributes.POSITION);
    const nor = read(prim.attributes.NORMAL);
    const uv = read(prim.attributes.TEXCOORD_0);
    const idx = read(prim.indices);
    const keys = matchPositions(objIndex, pos, { toObj });
    const missing = keys.filter((k) => k < 0).length;
    if (missing) throw new Error(`${name}: ${missing} vertices match no OBJ vertex (is the OBJ from the same download?)`);
    const faces = triangleFaces(obj, objIndex, keys, idx);
    const base = g.pos.length / 3;
    for (let v = 0; v < pos.length / 3; v++) {
      const [x, y, z] = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      g.pos.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13] - minY, m[2] * x + m[6] * y + m[10] * z + m[14]);
      const [nx, ny, nz] = [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]];
      const wx = m[0] * nx + m[4] * ny + m[8] * nz, wy = m[1] * nx + m[5] * ny + m[9] * nz, wz = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(wx, wy, wz) || 1;
      g.nor.push(wx / l, wy / l, wz / l);
      g.uv.push(uv[v * 2], uv[v * 2 + 1]);
    }
    for (let t = 0; t < idx.length; t++) g.idx.push(base + idx[t]);
    for (const f of faces) { g.labels.push(f < 0 ? -1 : obj.faceLabel[f]); g.objects.push(f < 0 ? -1 : obj.faceObject[f]); }
  }
  g.srcTris = g.idx.length / 3;
  const labelled = g.labels.filter((l) => l >= 0).length;
  console.log(`${name.padEnd(16)} ${String(g.srcTris).padStart(6)} tris, ${g.pos.length / 3} verts, ${((100 * labelled) / g.srcTris).toFixed(1)}% labelled`);
  groups.push(g);
}
const G = Object.fromEntries(groups.map((g) => [g.name, g]));

// ------------------------------------------------------------------ skeleton (metres, Y up, facing +Z; left is +X)
// Measured off the mesh (height 1.83 m with hair; face front z = 0.13, mouth line y = 1.60) and checked against the OBJ's label
// boundaries (rebuild-heins-rig D8, table in its design): the head moved up to its neck/head boundary and the cyber right elbow onto
// its hinge disc. Everything else is mirrored from the left side.
const L = {
  LeftShoulder: [0.06, 1.42, -0.02],
  LeftArm: [0.215, 1.365, -0.03],
  LeftForeArm: [0.335, 1.18, -0.005],
  LeftHand: [0.44, 1.07, 0.12],
  LeftHandMiddle1: [0.49, 0.95, 0.2],
  LeftUpLeg: [0.105, 0.9, 0.01],
  LeftLeg: [0.13, 0.5, 0.0],
  LeftFoot: [0.155, 0.09, 0.005],
  LeftToeBase: [0.165, 0.045, 0.125],
  LeftToeEnd: [0.17, 0.025, 0.215],
};
const J = {
  Hips: [0, 0.93, 0.005],
  Spine: [0, 1.08, 0],
  Spine1: [0, 1.27, -0.01],
  Neck: [0, 1.46, -0.025],
  Head: [0, 1.584, -0.017],
  HeadTop: [0, 1.81, 0.02],
  // Jaw hinge under the ear; chin tip at y = 1.545, z = 0.107; teeth span y 1.572..1.624, z 0.03..0.11.
  Jaw: [0, 1.655, -0.005],
  JawEnd: [0, 1.545, 0.1],
};
for (const [k, v] of Object.entries(L)) {
  J[k] = v;
  J[k.replace('Left', 'Right')] = [-v[0], v[1], v[2]];
}
J.RightForeArm = [-0.307, 1.237, -0.02];
const BONES = {
  Hips: [null, 'Spine', 0.2],
  Spine: ['Hips', 'Spine1', 0.21],
  Spine1: ['Spine', 'Neck', 0.23],
  Neck: ['Spine1', 'Head', 0.07],
  Head: ['Neck', 'HeadTop', 0.15],
  Jaw: ['Head', 'JawEnd', 0.045],
  JawEnd: ['Jaw', null, 0.03],
};
for (const s of ['Left', 'Right']) {
  Object.assign(BONES, {
    [`${s}Shoulder`]: ['Spine1', `${s}Arm`, 0.08],
    [`${s}Arm`]: [`${s}Shoulder`, `${s}ForeArm`, 0.09],
    [`${s}ForeArm`]: [`${s}Arm`, `${s}Hand`, 0.075],
    [`${s}Hand`]: [`${s}ForeArm`, `${s}HandMiddle1`, 0.07],
    [`${s}HandMiddle1`]: [`${s}Hand`, null, 0.055],
    [`${s}UpLeg`]: ['Hips', `${s}Leg`, 0.12],
    [`${s}Leg`]: [`${s}UpLeg`, `${s}Foot`, 0.09],
    [`${s}Foot`]: [`${s}Leg`, `${s}ToeBase`, 0.07],
    [`${s}ToeBase`]: [`${s}Foot`, `${s}ToeEnd`, 0.06],
    [`${s}ToeEnd`]: [`${s}ToeBase`, null, 0.04],
  });
}
let names = Object.keys(BONES).filter((n) => !n.endsWith('ToeEnd') && n !== 'JawEnd');
let boneIndex = new Map(names.map((n, i) => [n, i]));
const bi = (n) => boneIndex.get(n);
const segment = (n) => {
  const [, end] = BONES[n];
  const a = J[n];
  if (end) return [a, J[end]];
  const p = J[BONES[n][0]];
  const dv2 = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
  const l = Math.hypot(...dv2) || 1;
  return [a, [a[0] + (dv2[0] / l) * 0.07, a[1] + (dv2[1] / l) * 0.07, a[2] + (dv2[2] / l) * 0.07]];
};
const segs = names.map(segment);
const rad = names.map((n) => BONES[n][2]);
const distToSegment = (x, y, z, [a, b]) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1)));
  return Math.hypot(x - (a[0] + ab[0] * t), y - (a[1] + ab[1] * t), z - (a[2] + ab[2] * t));
};

// ------------------------------------------------------------------ labels -> bones (D4)
const boneOfLabel = (l) => {
  const s = l.endsWith('_l') ? 'Left' : l.endsWith('_r') ? 'Right' : '';
  if (l === 'pelvis' || l === 'root') return 'Hips';
  if (/^spine_0[12]$/.test(l)) return 'Spine';
  if (/^spine_0\d$/.test(l)) return 'Spine1';
  if (/^neck_/.test(l)) return 'Neck';
  if (l === 'head') return 'Head';
  if (/^clavicle_/.test(l)) return `${s}Shoulder`;
  if (/^upperarm/.test(l)) return `${s}Arm`;
  if (/^lowerarm/.test(l)) return `${s}ForeArm`;
  if (/^(hand_|thumb_|index_|middle_|ring_|pinky_)/.test(l)) return `${s}Hand`; // metacarpals and finger joints: the hand rig splits them
  if (/^thigh/.test(l)) return `${s}UpLeg`;
  if (/^calf/.test(l)) return `${s}Leg`;
  if (/^foot_/.test(l)) return `${s}Foot`;
  if (/^ball_/.test(l)) return `${s}ToeBase`;
  throw new Error(`no bone for OBJ label ${l}`);
};
const labelBone = obj.labels.map((l) => bi(boneOfLabel(l)));
const childrenOf = names.map(() => []);
names.forEach((n, i) => { const p = BONES[n][0]; if (p) childrenOf[bi(p)].push(i); });
// A labelled triangle may take weight from its bone, that bone's parent and its children. An upper arm may also take the chest:
// in the armpit the artist's upper-arm faces meet chest faces directly (the clavicle, between them in the chain, covers only the
// top of the shoulder), and without the chest the shoulder blend is one edge wide and tears when the arm rises.
const gateOfBone = names.map((n, b) => [b, ...(BONES[n][0] ? [bi(BONES[n][0])] : []), ...childrenOf[b], ...(/^(Left|Right)Arm$/.test(n) ? [bi('Spine1')] : [])]);
// Unlabelled triangles by material: hair, eyes, teeth and the head's few unlabelled faces ride the head (the jaw split adds the jaw
// below); the cyber parts are placed whole by the rigid rule (D7); anything else is free.
const HEAD_ONLY = new Set(['Hair', 'Eyes', 'Teeth', 'Head']);
const CYBER = new Set(['Cyber_Arm', 'Cyber_Hand']);
const ARM_CHAIN = { Left: ['LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1'].map(bi), Right: ['RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1'].map(bi) };
const armSideOfBone = (b) => (ARM_CHAIN.Left.includes(b) ? 1 : ARM_CHAIN.Right.includes(b) ? 2 : 0);

// ------------------------------------------------------------------ jacket sleeves cut from its sides below the armpits (D2)
// The jacket is one surface: its sleeves' inner faces are joined to its sides from the armpit down to the hips (60 edges where an
// arm-labelled face meets a torso-labelled one). Cut along those edges below ARMPIT_Y and cap both sides, as on the scan bodies.
// The shirt's sleeve stubs meet its torso only above y 1.285, inside the shoulder blend, and the arm skin meets no torso, so only the
// jacket is cut. The cut's torso side is left where it is (`band: 0`): the jacket has no dents where the arms pressed in.
const ARMPIT_Y = 1.3;
const ARM_BLEND = 0.04;
const TORSO_AXIS = [0, 0.0];
let jacketArms = null;
// The artist's weights pull patches of the jacket's side panels, under each sleeve (y 1.15-1.25), with the arm: their faces are
// labelled upper arm. Cut with the sleeve, they would swing into the torso once bodyModel hangs the arms and leave holes in the
// jacket's sides. Each arm-labelled jacket face below the armpit is moved as bodyModel stands the body up (upper arm and forearm
// aimed along (+-0.06, -1, 0) about their joints); one that then lies horizontally closer to the torso's axis than to its arm's
// bones (by 1 cm) is torso cloth and takes the torso's label at its height.
{
  const g = G.Aver;
  const rotTo = (from, to) => {
    const a = from.map((x) => x / Math.hypot(...from)), b = to.map((x) => x / Math.hypot(...to));
    const ax = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const s = Math.hypot(...ax), c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (s < 1e-9) return (p) => p;
    const k = ax.map((x) => x / s), ang = Math.atan2(s, c);
    return (p) => { // Rodrigues
      const kp = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]], kd = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
      return [0, 1, 2].map((i) => p[i] * Math.cos(ang) + kp[i] * Math.sin(ang) + k[i] * kd * (1 - Math.cos(ang)));
    };
  };
  const sub = (a, b) => a.map((x, i) => x - b[i]), add = (a, b) => a.map((x, i) => x + b[i]);
  const hang = {};
  for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
    const A = J[`${side}Arm`], F = J[`${side}ForeArm`], H = J[`${side}Hand`];
    const dir = [0.06 * sg, -1, 0];
    const r1 = rotTo(sub(F, A), dir);
    const F1 = add(A, r1(sub(F, A))), H1 = add(A, r1(sub(H, A)));
    const r2 = rotTo(sub(H1, F1), dir);
    const H2 = add(F1, r2(sub(H1, F1)));
    hang[side] = {
      upper: (p) => add(A, r1(sub(p, A))),
      fore: (p) => { const q = add(A, r1(sub(p, A))); return add(F1, r2(sub(q, F1))); },
      bones: [[A, F1], [F1, H2]],
    };
  }
  const segDist = (p, [a, b]) => distToSegment(p[0], p[1], p[2], [a, b]);
  const torsoLabel = (y) => obj.labels.indexOf(y >= 1.162 ? 'spine_03' : 'spine_02');
  let moved = 0;
  for (let t = 0; t < g.idx.length / 3; t++) {
    const l = g.labels[t];
    if (l < 0) continue;
    const side = armSideOfBone(labelBone[l]);
    if (!side) continue;
    const c = [0, 1, 2].map((k) => (g.pos[g.idx[t * 3] * 3 + k] + g.pos[g.idx[t * 3 + 1] * 3 + k] + g.pos[g.idx[t * 3 + 2] * 3 + k]) / 3);
    if (c[1] >= ARMPIT_Y) continue;
    const h = hang[side === 1 ? 'Left' : 'Right'];
    const p = names[labelBone[l]].endsWith('Arm') && !names[labelBone[l]].endsWith('ForeArm') ? h.upper(c) : h.fore(c);
    if (Math.hypot(p[0] - TORSO_AXIS[0], p[2] - TORSO_AXIS[1]) < Math.min(...h.bones.map((b) => segDist(p, b))) + 0.01) {
      g.labels[t] = torsoLabel(c[1]);
      moved++;
    }
  }
  console.log(`jacket: ${moved} arm-labelled faces of the side panels go with the torso`);
}
{
  const g = G.Aver;
  const triSide = Int8Array.from(g.labels, (l) => (l >= 0 ? armSideOfBone(labelBone[l]) : 0));
  jacketArms = splitArms({ pos: g.pos, nor: g.nor, uv: g.uv, indices: g.idx }, Array.from(triSide), { armpitY: { Left: ARMPIT_Y, Right: ARMPIT_Y }, torsoAxis: TORSO_AXIS, J, band: 0, blend: ARM_BLEND });
  // Cap triangles carry no OBJ label; they are gated by the side they close.
  const capTris = jacketArms.capLabel.length;
  g.capSide = new Int8Array(g.idx.length / 3).fill(-1);
  for (let k = 0; k < capTris; k++) { g.labels.push(-1); g.objects.push(-1); g.capSide[jacketArms.capStart + k] = jacketArms.capLabel[k]; }
}

// ------------------------------------------------------------------ weld across groups (so seams stay closed)
let NB = names.length;
const weldKey = new Map();
const weldOf = groups.map((g) => {
  g.count = g.pos.length / 3;
  const a = new Int32Array(g.count);
  const piece = g === G.Aver ? jacketArms.pieceOf : null;
  for (let v = 0; v < g.count; v++) {
    const key = `${g.pos[v * 3].toFixed(5)},${g.pos[v * 3 + 1].toFixed(5)},${g.pos[v * 3 + 2].toFixed(5)}|${piece ? piece[v] : 0}`;
    let w = weldKey.get(key);
    if (w === undefined) { w = weldKey.size; weldKey.set(key, w); }
    a[v] = w;
  }
  return a;
});
const nW = weldKey.size;
let wPos = new Float32Array(nW * 3);
groups.forEach((g, gi) => { for (let v = 0; v < g.count; v++) wPos.set(g.pos.slice(v * 3, v * 3 + 3), weldOf[gi][v] * 3); });
const wSkin = new Uint8Array(nW); // head-material skin (the face and neck)
const wMat = new Array(nW);
groups.forEach((g, gi) => { for (let v = 0; v < g.count; v++) { const w = weldOf[gi][v]; wMat[w] ??= g.name; if (g.name === 'Head') wSkin[w] = 1; } });

// Gate per welded vertex: the union of its triangles' gates (free if none of its triangles is gated). Arm rule per welded vertex
// below the armpit: 1/2 for a vertex only on that arm's triangles (arm chain only), 3 for one only on torso triangles (no arm
// chain), 0 otherwise.
const gate = new Uint8Array(nW * NB);
const gated = new Uint8Array(nW);
const armRule = new Uint8Array(nW);
{
  const sides = new Uint8Array(nW); // bit 1 left arm, 2 right arm, 4 torso
  const triGate = (g, t) => {
    const l = g.labels[t];
    if (g.capSide?.[t] >= 0) {
      const s = g.capSide[t];
      return s === 0 ? gateOfBone[bi('Spine1')] : ARM_CHAIN[s === 1 ? 'Left' : 'Right'];
    }
    if (l >= 0) return gateOfBone[labelBone[l]];
    if (HEAD_ONLY.has(g.name)) return [bi('Head')];
    return null;
  };
  groups.forEach((g, gi) => {
    for (let t = 0; t < g.idx.length / 3; t++) {
      const set = triGate(g, t);
      const l = g.labels[t];
      const side = g.capSide?.[t] >= 0 ? [4, 1, 2][g.capSide[t]] : l >= 0 ? [4, 1, 2][armSideOfBone(labelBone[l])] : CYBER.has(g.name) ? 2 : 0;
      for (let k = 0; k < 3; k++) {
        const w = weldOf[gi][g.idx[t * 3 + k]];
        sides[w] |= side;
        if (!set) continue;
        gated[w] = 1;
        for (const b of set) gate[w * NB + b] = 1;
      }
    }
  });
  for (let w = 0; w < nW; w++) {
    if (!gated[w]) gate.fill(1, w * NB, (w + 1) * NB);
    const s = sides[w];
    armRule[w] = s === 1 ? 1 : s === 2 ? 2 : s === 4 ? 3 : 0;
  }
}
const armAllowed = (rule, b) => (rule === 3 ? !armSideOfBone(b) : armSideOfBone(b) === rule);
const nearestAllowed = (w, ok) => {
  let best = -1, bs = Infinity;
  for (let b = 0; b < NB; b++) {
    if (!ok(b)) continue;
    const sc = distToSegment(wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2], segs[b]) / rad[b];
    if (sc < bs) { bs = sc; best = b; }
  }
  return best;
};
const keepRow = new Float32Array(NB);
/** Zero what the gate (and below the armpits, the arm rule) forbids and renormalise; `ease` fades the arm rule in under the armpit. */
const applyGate = (W, ease = true) => {
  for (let w = 0; w < nW; w++) {
    const y = wPos[w * 3 + 1];
    const passes = [(b) => gate[w * NB + b] === 1];
    const rule = armRule[w];
    if (rule && y < ARMPIT_Y) passes.push((b) => gate[w * NB + b] === 1 && armAllowed(rule, b));
    passes.forEach((ok, p) => {
      const k = p === 1 && ease ? smooth(ARMPIT_Y - ARM_BLEND, ARMPIT_Y, y) : 0;
      if (k > 0) for (let b = 0; b < NB; b++) keepRow[b] = W[w * NB + b];
      let sum = 0;
      for (let b = 0; b < NB; b++) { if (!ok(b)) W[w * NB + b] = 0; sum += W[w * NB + b]; }
      if (sum < 1e-6) {
        const best = nearestAllowed(w, ok);
        if (best < 0) return;
        W[w * NB + best] = 1;
        sum = 1;
      }
      for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
      if (k > 0) for (let b = 0; b < NB; b++) W[w * NB + b] += (keepRow[b] - W[w * NB + b]) * k;
    });
  }
};

// ------------------------------------------------------------------ skin weights: capsules inside the gate, smoothed (D4)
let W = new Float32Array(nW * NB);
const SHARP = Number(process.env.SHARP ?? 8);
for (let w = 0; w < nW; w++) {
  const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
  const s = segs.map((sg, b) => (gate[w * NB + b] ? distToSegment(x, y, z, sg) / rad[b] : Infinity));
  const best = Math.min(...s);
  let sum = 0;
  for (let b = 0; b < NB; b++) { const e = s[b] === Infinity ? 0 : Math.exp(-(s[b] - best) * SHARP); W[w * NB + b] = e; sum += e; }
  for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
}
applyGate(W, false);
// Laplacian smoothing over mesh edges, leaving out the jacket's arm caps (they would tie the armpit to the bone axis).
let nbrs = Array.from({ length: nW }, () => new Set());
groups.forEach((g, gi) => {
  for (let t = 0; t < g.idx.length / 3; t++) {
    if (g.capSide?.[t] > 0) continue;
    const a = weldOf[gi][g.idx[t * 3]], b = weldOf[gi][g.idx[t * 3 + 1]], c = weldOf[gi][g.idx[t * 3 + 2]];
    nbrs[a].add(b).add(c); nbrs[b].add(a).add(c); nbrs[c].add(a).add(b);
  }
});
const smoothPass = (W, only = null) => {
  const next = W.slice();
  for (let w = 0; w < nW; w++) {
    if ((only && !only[w]) || !nbrs[w].size) continue;
    for (let b = 0; b < NB; b++) {
      let s = 0;
      for (const o of nbrs[w]) s += W[o * NB + b];
      next[w * NB + b] = 0.5 * W[w * NB + b] + 0.5 * (s / nbrs[w].size);
    }
  }
  return next;
};
for (let it = 0; it < 4; it++) { W = smoothPass(W); applyGate(W); }

// ------------------------------------------------------------------ neck, collar and face (D5)
// Measured off the head mesh (skin) in this frame: the neck's front runs at z 0.041-0.049 and its back at z -0.048..-0.081 between
// y 1.485 and 1.60, its sides at x +-0.05: an axis at z -0.005, radius 5.0-5.3 cm. The skin's neck labels start at y 1.49-1.50 at
// the jacket's neckline; the chin's underside meets the throat at y 1.555 (the front jumps from z 0.049 to 0.099 by y 1.56). The
// jacket's standing collar (labelled neck_01, neck_02 and head) wraps the neck 1.5-2 cm outside the skin from y 1.50 to 1.615,
// with the shirt's collar under it. The nose tip is 15 cm in front of the axis.
const NECK_AXIS = [0, -0.005];
const NECK_RADIUS = 0.058;
const COLLAR_Y = 1.5;
const COLLAR_TOP_Y = 1.615;
const JAW_LINE_Y = 1.556;
const FACE_RADIUS = 0.18;
const headB = bi('Head'), neckB = bi('Neck'), chestB = bi('Spine1'), jawB = bi('Jaw');
const trunk = ['Hips', 'Spine', 'Spine1'].map(bi);
// The column rule is gated to skin (the head material): the collars sit outside it.
const wCol = new Float32Array(nW * 3);
for (let w = 0; w < nW; w++) wCol[w * 3] = wSkin[w];
applyNeckRule({
  W, wPos, wCol, nW, NB, boneIndex, color: wCol,
  neck: { collarY: COLLAR_Y, jawLineY: JAW_LINE_Y, axis: NECK_AXIS, radius: NECK_RADIUS, margin: 0.015, faceRadius: FACE_RADIUS, include: (c) => c[0] > 0.5 },
});
// Blend passes over the neck's skin (as fix-bram-glb.mjs): the rules switch on over a centimetre or two, and neighbours on different
// rules would shear apart when the head turns. The face in front of the neck is left out so it stays rigid with the head.
{
  const inNeck = new Uint8Array(nW);
  for (let w = 0; w < nW; w++) {
    const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
    const r = Math.hypot(x - NECK_AXIS[0], z - NECK_AXIS[1]);
    inNeck[w] = wSkin[w] && y > COLLAR_Y - 0.03 && y < COLLAR_TOP_Y + 0.03 && r < 0.15 && z - NECK_AXIS[1] < 0.04 ? 1 : 0;
  }
  for (let it = 0; it < 10; it++) W = smoothPass(W, inNeck);
}
// Collar rule: the jacket's and the shirt's collars run from the chest at their base to the neck at their top, with no head weight,
// whatever their labels say (the jacket's collar is labelled neck_02 and head, and its lapels neck_01 and head out to 14 cm from
// the neck's axis at y 1.53). Clothes never take the head's weight.
const COLLAR_MATS = new Set(['Aver', 'Shirt_and_pants']);
{
  let n = 0;
  const target = new Float32Array(NB);
  for (let w = 0; w < nW; w++) {
    if (!COLLAR_MATS.has(wMat[w])) continue;
    const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
    const r = Math.hypot(x - NECK_AXIS[0], z - NECK_AXIS[1]);
    const head = W[w * NB + headB] + W[w * NB + jawB];
    if (head > 0) { W[w * NB + neckB] += head; W[w * NB + headB] = 0; W[w * NB + jawB] = 0; }
    const k = smooth(COLLAR_Y - 0.03, COLLAR_Y, y) * smooth(0.17, 0.15, r);
    if (k <= 0) continue;
    const t = smooth(COLLAR_Y, COLLAR_TOP_Y - 0.01, y);
    target.fill(0);
    target[chestB] = 1 - t;
    target[neckB] = t;
    for (let b = 0; b < NB; b++) W[w * NB + b] += (target[b] - W[w * NB + b]) * k;
    if (k > 0.5) n++;
  }
  console.log(`collar: ${n} welded vertices on the chest-to-neck blend`);
}
// Nothing above the collar follows the trunk: the neck column's skin gives its trunk weight to the neck, and anything above the
// collar's top gives it to the head.
for (let w = 0; w < nW; w++) {
  const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
  const col = wSkin[w] ? smooth(COLLAR_Y, COLLAR_Y + 0.01, y) * smooth(NECK_RADIUS + 0.012, NECK_RADIUS, Math.hypot(x - NECK_AXIS[0], z - NECK_AXIS[1])) : 0;
  const top = smooth(COLLAR_TOP_Y, COLLAR_TOP_Y + 0.01, y);
  if (col <= 0 && top <= 0) continue;
  for (const b of trunk) {
    const toNeck = W[w * NB + b] * col;
    const toHead = (W[w * NB + b] - toNeck) * top;
    W[w * NB + b] -= toNeck + toHead;
    W[w * NB + neckB] += toNeck;
    W[w * NB + headB] += toHead;
  }
}

// ------------------------------------------------------------------ jaw from the mouth opening (D6)
// The head is one surface with the mouth as one of its openings. Its rim splits at the corners (its leftmost and rightmost points)
// into the upper and the lower lip's edge. Over the face, a vertex nearer (along the surface) to the lower edge than to the upper
// goes to the jaw, full on the lower lip and chin and fading toward the hinge, to the sides and under the chin; the upper lip stays
// on the head. The mouth's inside and the teeth split at the lip line's height.
const hinge = J.Jaw;
{
  const g = G.Head, gi = groups.indexOf(g);
  const wo = weldOf[gi];
  const edgeUse = new Map();
  for (let t = 0; t < g.idx.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = wo[g.idx[t * 3 + k]], b = wo[g.idx[t * 3 + ((k + 1) % 3)]];
    const e = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeUse.set(e, (edgeUse.get(e) ?? 0) + 1);
  }
  const next = new Map();
  for (const [e, n] of edgeUse) if (n === 1) { const [a, b] = e.split('|').map(Number); (next.get(a) ?? next.set(a, []).get(a)).push(b); (next.get(b) ?? next.set(b, []).get(b)).push(a); }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let v = start, prev = -1; v !== undefined && !seen.has(v); ) { seen.add(v); loop.push(v); const nx = next.get(v).find((o) => o !== prev && !seen.has(o)); prev = v; v = nx; }
    loops.push(loop);
  }
  const P = (w) => [wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]];
  const mid = (loop) => [0, 1, 2].map((k) => loop.reduce((s, w) => s + P(w)[k], 0) / loop.length);
  const mouth = loops.filter((l) => { const c = mid(l); return l.length >= 12 && c[2] > 0.08 && c[1] > 1.57 && c[1] < 1.63 && Math.abs(c[0]) < 0.02; })
    .sort((a, b) => b.length - a.length)[0];
  if (!mouth) throw new Error('jaw: no mouth opening found on the head');
  let iL = 0, iR = 0;
  mouth.forEach((w, i) => { if (P(w)[0] < P(mouth[iL])[0]) iL = i; if (P(w)[0] > P(mouth[iR])[0]) iR = i; });
  const arc = (from, to) => { const out = []; for (let i = from; ; i = (i + 1) % mouth.length) { out.push(mouth[i]); if (i === to) break; } return out; };
  let up = arc(iL, iR), lo = arc(iR, iL);
  const meanY = (a) => a.reduce((s, w) => s + P(w)[1], 0) / a.length;
  if (meanY(up) < meanY(lo)) [up, lo] = [lo, up];
  const cornerY = (P(mouth[iL])[1] + P(mouth[iR])[1]) / 2;
  const lipMid = mid(mouth);
  console.log(`jaw: mouth opening of ${mouth.length} vertices, ${(Math.abs(P(mouth[iR])[0] - P(mouth[iL])[0]) * 100).toFixed(1)} cm wide, corners at y ${cornerY.toFixed(3)}`);
  // Surface distance from each rim half over the head's welded vertices (Dijkstra, out to 12 cm).
  const dist = (seeds) => {
    const d = new Map(seeds.map((w) => [w, 0]));
    const open = [...seeds];
    while (open.length) {
      let bi2 = 0; for (let i = 1; i < open.length; i++) if (d.get(open[i]) < d.get(open[bi2])) bi2 = i;
      const w = open.splice(bi2, 1)[0];
      const dw = d.get(w);
      if (dw > 0.12) continue;
      for (const o of nbrs[w]) {
        if (!wSkin[o]) continue;
        const nd = dw + Math.hypot(...P(o).map((x, k) => x - P(w)[k]));
        if (nd < (d.get(o) ?? Infinity)) { if (!d.has(o)) open.push(o); d.set(o, nd); }
      }
    }
    return d;
  };
  const dUp = dist(up), dLo = dist(lo);
  let n = 0;
  for (const [w, dl] of dLo) {
    const du = dUp.get(w) ?? Infinity;
    const [x, y, z] = P(w);
    // Near the mouth the surface distance tells the lips apart; under the chin both routes run round the corners and come out equal,
    // so anything 2 cm or more below the corners is on the lower side.
    const side = Math.max(smooth(-0.001, 0.004, du - dl), smooth(cornerY - 0.008, cornerY - 0.02, y));
    const m = side * smooth(hinge[2] + 0.03, hinge[2] + 0.08, z) * smooth(0.075, 0.045, Math.abs(x - hinge[0])) *
      smooth(JAW_LINE_Y - 0.03, JAW_LINE_Y + 0.005, y) * smooth(cornerY + 0.012, cornerY, y);
    if (m <= 0) continue;
    for (let b = 0; b < NB; b++) W[w * NB + b] *= 1 - m;
    W[w * NB + jawB] += m;
    if (m > 0.5) n++;
  }
  // The mouth's inside and the teeth (one material: a low block holding both rows, joined at the back, and the lining round it):
  // the gap between the rows runs level at the lip line's height, so they split at that height. A piece wholly above or below goes
  // whole to the head or the jaw; one that spans it blends over 1.8 cm either side (a 15-degree opening moves the front teeth 3 cm,
  // and a narrower blend tears the lining's short edges).
  const SPLIT_Y = lipMid[1];
  const BAND = 0.018;
  const t = G.Teeth, ti = groups.indexOf(t);
  const tw = weldOf[ti];
  const root = new Map();
  const find = (a) => { while (root.has(a) && root.get(a) !== a) a = root.get(a); return a; };
  for (let k = 0; k < t.idx.length / 3; k++) {
    const [a, b, c] = [0, 1, 2].map((q) => find(tw[t.idx[k * 3 + q]]));
    for (const x of [a, b, c]) if (!root.has(x)) root.set(x, x);
    root.set(b, a); root.set(find(c), a);
  }
  const pieces = new Map();
  for (let v = 0; v < t.count; v++) { const r = find(tw[v]); (pieces.get(r) ?? pieces.set(r, new Set()).get(r)).add(tw[v]); }
  let rigid = 0, lining = 0;
  for (const set of pieces.values()) {
    const ws = [...set];
    const ys = ws.map((w) => wPos[w * 3 + 1]);
    const spans = Math.min(...ys) < SPLIT_Y - BAND / 2 && Math.max(...ys) > SPLIT_Y + BAND / 2;
    const cy = ys.reduce((s, y) => s + y, 0) / ys.length;
    ws.forEach((w, i) => {
      const m = spans ? smooth(SPLIT_Y + BAND, SPLIT_Y - BAND, ys[i]) : cy < SPLIT_Y ? 1 : 0;
      for (let b = 0; b < NB; b++) W[w * NB + b] = 0;
      W[w * NB + headB] = 1 - m;
      W[w * NB + jawB] = m;
    });
    if (spans) lining += ws.length; else rigid++;
  }
  console.log(`jaw: ${n} face vertices mostly on the jaw; mouth inside: ${pieces.size} pieces, ${rigid} placed whole, ${lining} vertices blended across the lip line`);
}

// ------------------------------------------------------------------ rigid cyber arm and hand (D7)
// The cyber arm and hand are 150 separate pieces (plates, rings, bolts, finger segments, cables). Each piece goes whole to one bone:
// the one its labels agree on, else the bone segment nearest its middle. A cable (the OBJ names its objects `cable.001` ...) that
// crosses the elbow or the wrist blends between the two bones only within ELBOW_BAND of that joint: the cables arc round the outside
// of the elbow, no longer along the arm than the bolts round the hinge, so only their names tell them apart. Finger segments sit on
// the hand until the hand rig has placed the finger bones, then each goes whole to the finger bone it leans on most.
const chain = ['RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle1'].map((n) => J[n]);
const chainLen = chain.slice(1).map((b, i) => Math.hypot(...b.map((x, k) => x - chain[i][k])));
const sJoint = { RightForeArm: chainLen[0], RightHand: chainLen[0] + chainLen[1] };
const along = (x, y, z) => {
  let best = 0, bd = Infinity, s0 = 0;
  for (let i = 0; i < 3; i++) {
    const [a, b] = [chain[i], chain[i + 1]];
    const ab = b.map((q, k) => q - a[k]);
    const t = i === 2 ? Math.max(0, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / chainLen[i] ** 2)
      : Math.max(i === 0 ? -Infinity : 0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / chainLen[i] ** 2));
    const dd = Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t);
    if (dd < bd) { bd = dd; best = s0 + t * chainLen[i]; }
    s0 += chainLen[i];
  }
  return best;
};
const boneAt = (s) => (s < sJoint.RightForeArm ? 'RightArm' : s < sJoint.RightHand ? 'RightForeArm' : 'RightHand');
/** The cyber pieces as sets of welded vertices, with the labels of their triangles. */
const cyberPieces = () => {
  const root = new Int32Array(wPos.length / 3).fill(-1);
  const find = (a) => { while (root[a] !== a) a = root[a] = root[root[a]]; return a; };
  groups.forEach((g, gi) => {
    if (!CYBER.has(g.name)) return;
    for (let t = 0; t < g.idx.length / 3; t++) {
      const ws = [0, 1, 2].map((k) => weldOf[gi][g.idx[t * 3 + k]]);
      for (const w of ws) if (root[w] < 0) root[w] = w;
      const r = find(ws[0]);
      for (const w of ws.slice(1)) root[find(w)] = r;
    }
  });
  const pieces = new Map();
  for (let w = 0; w < root.length; w++) if (root[w] >= 0) { const r = find(w); (pieces.get(r) ?? pieces.set(r, { ws: [], votes: new Map(), cable: false }).get(r)).ws.push(w); }
  groups.forEach((g, gi) => {
    if (!CYBER.has(g.name)) return;
    for (let t = 0; t < g.idx.length / 3; t++) {
      const p = pieces.get(find(weldOf[gi][g.idx[t * 3]]));
      if (/^cable/i.test(obj.objects[g.objects[t]] ?? '')) p.cable = true;
      const l = g.labels[t] ?? -1;
      if (l < 0) continue;
      const bn = names[labelBone[l]];
      p.votes.set(bn, (p.votes.get(bn) ?? 0) + 1);
    }
  });
  return [...pieces.values()];
};
/** Where each cyber piece goes: { bone } or { span: [parent, child], at } (blend along the arm). */
const placePiece = (p) => {
  const s = p.ws.map((w) => along(wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]));
  const lo = Math.min(...s), hi = Math.max(...s);
  for (const [joint, par] of [['RightForeArm', 'RightArm'], ['RightHand', 'RightForeArm']]) {
    const sj = sJoint[joint];
    if (p.cable && lo < sj && hi > sj) return { span: [par, joint], at: sj, s };
  }
  if (p.votes.size === 1) return { bone: [...p.votes.keys()][0] };
  const c = [0, 1, 2].map((k) => p.ws.reduce((acc, w) => acc + wPos[w * 3 + k], 0) / p.ws.length);
  return { bone: boneAt(along(...c)) };
};
const rigidify = (W, NB, idx, afterHands) => {
  let whole = 0, spans = 0, fingers = 0;
  for (const p of cyberPieces()) {
    const place = placePiece(p);
    if (place.span) {
      const [a, b] = place.span.map(idx);
      p.ws.forEach((w, i) => { const f = smooth(place.at - ELBOW_BAND, place.at + ELBOW_BAND, place.s[i]); W.fill(0, w * NB, (w + 1) * NB); W[w * NB + a] = 1 - f; W[w * NB + b] = f; });
      spans++;
      continue;
    }
    let bone = idx(place.bone);
    if (afterHands && place.bone === 'RightHand') {
      // The finger bone (or the hand) the piece's vertices lean on most after the hand rig.
      const sum = new Float32Array(NB);
      for (const w of p.ws) for (let b = 0; b < NB; b++) sum[b] += W[w * NB + b];
      bone = sum.indexOf(Math.max(...sum));
      if (bone !== idx('RightHand')) fingers++;
    }
    for (const w of p.ws) { W.fill(0, w * NB, (w + 1) * NB); W[w * NB + bone] = 1; }
    whole++;
  }
  console.log(`cyber: ${whole} pieces moved whole${afterHands ? ` (${fingers} on finger bones)` : ''}, ${spans} bending across the elbow or wrist`);
};
rigidify(W, NB, bi, false);

// ------------------------------------------------------------------ finger chains and forearm twist bones (per-character-motion D7)
// Added after the body's own weights, from the hand meshes, once the fingers that touch (her right thumb rests on her index finger)
// are cut apart. The cyber hand's pieces are then put back whole on the bones the rig gave them.
{
  const parts = groups.map((g, gi) => ({ pos: g.pos, nor: g.nor, uv: g.uv, indices: g.idx, weldOf: weldOf[gi] }));
  const cut = splitHands({ parts, W, wPos, names, J, nbrs, skip: (gi, t) => groups[gi].capSide?.[t] > 0 });
  ({ W, wPos, nbrs } = cut);
  parts.forEach((p, gi) => {
    weldOf[gi] = p.weldOf;
    groups[gi].count = p.pos.length / 3;
    while (groups[gi].labels.length < groups[gi].idx.length / 3) { groups[gi].labels.push(-1); groups[gi].objects.push(-1); }
  });
  const hands = rigHands({ W, wPos, names, J, nbrs, plans: cut.plans, parentOf: Object.fromEntries(names.map((n) => [n, BONES[n][0]])) });
  W = hands.W;
  names = hands.names;
  NB = names.length;
  boneIndex = new Map(names.map((n, i) => [n, i]));
  Object.assign(J, hands.J);
  for (const n of hands.added) BONES[n] = [hands.parentOf[n], null, 0.02];
}
// Her left hand is skin with every phalanx labelled (thumb_01_l .. pinky_03_l, the metacarpals, hand_l). The hand rig places finger
// joints at fixed shares of each finger's length, up to 3 cm from the artist's knuckles here, so its finger joints move onto the
// label boundaries and the skin's hand weight is split along its own finger: the hand, then each phalanx, blended over the rig's
// band (max(4 mm, 8% of the finger's reach)) at each joint, and never further than the phalanx next to the one its labels name.
// The jacket's cuff, which a few finger labels reach, keeps its finger weight on the hand.
// Passes: the skin is dense (edges of 3-5 mm), and the thumb's web needs 16 before a fist stretches no edge past 2.5x (12: 2.6x).
const LEFT_HAND_SMOOTHING = Number(process.env.LEFT_HAND_SMOOTHING ?? 16);
{
  const g = G.Body, gi = groups.indexOf(g), wo = weldOf[gi];
  const FINGER = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' };
  const segOf = (l) => { const m = /^(thumb|index|middle|ring|pinky)_(0[123]|metacarpal)_l$/.exec(obj.labels[l] ?? ''); return m ? { f: m[1], p: m[2] === 'metacarpal' ? 0 : +m[2] } : obj.labels[l] === 'hand_l' ? { f: null, p: 0 } : null; };
  const P = (w) => [wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]];
  // Rings between labels, over the skin's welded edges.
  const edgeLabels = new Map();
  for (let t = 0; t < g.idx.length / 3; t++) {
    const l = g.labels[t];
    if (l < 0) continue;
    for (let k = 0; k < 3; k++) {
      const a = wo[g.idx[t * 3 + k]], b = wo[g.idx[t * 3 + ((k + 1) % 3)]];
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      (edgeLabels.get(e) ?? edgeLabels.set(e, new Set()).get(e)).add(obj.labels[l]);
    }
  }
  const ring = (isA, isB) => {
    const pts = [];
    for (const [e, ls] of edgeLabels) if ([...ls].some(isA) && [...ls].some(isB)) for (const w of e.split('|').map(Number)) pts.push(P(w));
    return pts.length ? [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length) : null;
  };
  const vLabel = new Map(); // welded vertex -> label counts
  for (let t = 0; t < g.idx.length / 3; t++) {
    const l = g.labels[t];
    if (l < 0 || !segOf(l)) continue;
    for (let k = 0; k < 3; k++) { const w = wo[g.idx[t * 3 + k]]; const m = vLabel.get(w) ?? vLabel.set(w, new Map()).get(w); m.set(l, (m.get(l) ?? 0) + 1); }
  }
  const chains = {};
  for (const [f, F] of Object.entries(FINGER)) {
    const lab = (p) => (n) => n === `${f}_0${p}_l`;
    const base = f === 'thumb' ? ring((n) => n === 'hand_l' || /_metacarpal_l$/.test(n), lab(1)) : ring((n) => n === `${f}_metacarpal_l` || n === 'hand_l', lab(1));
    const joints = [base, ring(lab(1), lab(2)), ring(lab(2), lab(3))];
    if (joints.some((x) => !x)) throw new Error(`left ${f}: a phalanx boundary is missing`);
    let tip = joints[2], far = 0;
    for (const [w, m] of vLabel) {
      if (![...m.keys()].some((l) => obj.labels[l] === `${f}_03_l`)) continue;
      const d = Math.hypot(...P(w).map((x, k) => x - joints[2][k]));
      if (d > far) { far = d; tip = P(w); }
    }
    const pts = [...joints, tip];
    const len = [0];
    for (let i = 1; i < 4; i++) len.push(len[i - 1] + Math.hypot(...pts[i].map((x, k) => x - pts[i - 1][k])));
    const cols = [1, 2, 3].map((k) => boneIndex.get(`LeftHand${F}${k}`));
    chains[f] = { pts, len, band: Math.max(0.004, len[3] * 0.08), cols };
    for (let k = 0; k < 3; k++) J[`LeftHand${F}${k + 1}`] = joints[k].map((x) => +x.toFixed(4));
  }
  // Place along a finger: the polyline joint 1 -> 2 -> 3 -> tip, extended back past joint 1 (negative before it).
  const along = (c, p) => {
    let best = Infinity, u = 0;
    for (let i = 0; i < 3; i++) {
      const a = c.pts[i], b = c.pts[i + 1], ab = b.map((x, k) => x - a[k]), L = c.len[i + 1] - c.len[i];
      const t = Math.min(1, Math.max(i === 0 ? -Infinity : 0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (L * L)));
      const dd = Math.hypot(...p.map((x, k) => x - a[k] - ab[k] * t));
      if (dd < best) { best = dd; u = c.len[i] + t * L; }
    }
    return u;
  };
  const handCols = names.flatMap((n, b) => (/^LeftHand/.test(n) ? [b] : []));
  const iHand = boneIndex.get('LeftHand');
  let n = 0;
  for (const [w, m] of vLabel) {
    const [l] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const s = segOf(l);
    const p = P(w);
    // A palm vertex blends into the finger whose base it lies nearest.
    const f = s.f ?? Object.keys(chains).reduce((a, b) => (Math.hypot(...p.map((x, k) => x - chains[b].pts[0][k])) < Math.hypot(...p.map((x, k) => x - chains[a].pts[0][k])) ? b : a));
    const c = chains[f];
    const u = along(c, p);
    const fk = [0, 1, 2].map((k) => smooth(c.len[k] - c.band, c.len[k] + c.band, u));
    const share = [1 - fk[0], fk[0] - fk[1], fk[1] - fk[2], fk[2]].map((x, k) => (Math.abs(k - s.p) <= 1 ? Math.max(0, x) : 0));
    const sum = share.reduce((a, b) => a + b, 0) || 1;
    let hw = 0;
    for (const b of handCols) { hw += W[w * NB + b]; W[w * NB + b] = 0; }
    W[w * NB + iHand] = (hw * share[0]) / sum;
    c.cols.forEach((b, k) => { W[w * NB + b] += (hw * share[k + 1]) / sum; });
    n++;
  }
  // The labels meet in hard lines where the fingers' webs and the thumb's web join; smooth the shares across the skin, as the hand
  // rig smooths its own membership, but only between labels that share skin: one finger's neighbouring segments, the palm and a
  // first segment, two first segments (the webs). Her middle fingertip rests on her palm and the mesh joins them there.
  const skinRows = new Set(Array.from(wo));
  const rows = [...vLabel.keys()];
  const segW = new Map(rows.map((w) => [w, segOf([...vLabel.get(w).entries()].sort((a, b) => b[1] - a[1])[0][0])]));
  const shareSkin = (a, b) => (a.f === b.f ? Math.abs(a.p - b.p) <= 1 : a.p <= 1 && b.p <= 1);
  for (let it = 0; it < LEFT_HAND_SMOOTHING; it++) {
    const next = new Map();
    for (const w of rows) {
      const hw = handCols.reduce((s, b) => s + W[w * NB + b], 0);
      if (hw < 1e-6) continue;
      const ns = [...nbrs[w]].filter((o) => vLabel.has(o) && shareSkin(segW.get(w), segW.get(o)));
      if (!ns.length) continue;
      const share = (o) => { const t = handCols.reduce((s, b) => s + W[o * NB + b], 0) || 1; return handCols.map((b) => W[o * NB + b] / t); };
      const own = share(w);
      const avg = handCols.map(() => 0);
      for (const o of ns) share(o).forEach((x, k) => { avg[k] += x / ns.length; });
      next.set(w, own.map((x, k) => hw * (0.5 * x + 0.5 * avg[k])));
    }
    for (const [w, r] of next) handCols.forEach((b, k) => { W[w * NB + b] = r[k]; });
  }
  // Anything else on the left hand's finger bones (the jacket's cuff) goes back to the hand.
  for (let w = 0; w < wPos.length / 3; w++) {
    if (skinRows.has(w)) continue;
    for (const b of handCols) if (b !== iHand && W[w * NB + b] > 0) { W[w * NB + iHand] += W[w * NB + b]; W[w * NB + b] = 0; }
  }
  console.log(`left hand: finger joints on the label boundaries, ${n} skin vertices re-weighted by phalanx`);
}
// The same rule over the cut mesh (the cut appended welded rows; pieces are found again from the current triangles).
rigidify(W, NB, (n) => boneIndex.get(n), true);

// ------------------------------------------------------------------ pack weights per vertex (top four)
const packGroup = (g, gi) => {
  const joints = new Uint8Array(g.count * 4);
  const weights = new Uint16Array(g.count * 4);
  for (let v = 0; v < g.count; v++) {
    const w = weldOf[gi][v];
    const top = Array.from(W.subarray(w * NB, (w + 1) * NB), (val, b) => [b, val]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, t) => s + t[1], 0) || 1;
    const q = top.map((t) => Math.round((t[1] / sum) * 65535));
    q[0] += 65535 - q.reduce((s, x) => s + x, 0);
    top.forEach((t, k) => { joints[v * 4 + k] = t[0]; weights[v * 4 + k] = q[k]; });
  }
  return { joints, weights };
};
const skinned = groups.map(packGroup);
const totalTris = groups.reduce((s, g) => s + g.idx.length / 3, 0);
for (const g of groups) console.log(`${g.name.padEnd(16)} ${g.idx.length / 3} tris (source ${g.srcTris}), ${g.count} verts`);

// ------------------------------------------------------------------ nodes
const nodes = names.map((n) => {
  const p = BONES[n][0];
  const o = p ? J[p] : [0, 0, 0];
  return { name: n, translation: J[n].map((x, k) => +(x - o[k]).toFixed(6)) };
});
names.forEach((n, i) => { const p = BONES[n][0]; if (p) (nodes[boneIndex.get(p)].children ??= []).push(i); });
const meshNodeIdx = groups.map((g, gi) => { nodes.push({ name: `Heins_${OUT_NAME[g.name]}`, mesh: gi, skin: 0 }); return nodes.length - 1; });
const ibm = new Float32Array(NB * 16);
names.forEach((n, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1], i * 16));

// ------------------------------------------------------------------ textures (source resolution, D9)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heins-'));
const srcImg = (texIdx) => j.textures[texIdx].source;
const matSrc = (name) => j.materials.find((m) => m.name === name);
const texJobs = []; // { key, img, q, png, recolor }
const want = (matName, kind, q, png = false, recolor = false) => {
  if (process.env.NO_TEXTURES) return; // NO_TEXTURES=1: a quick build for checking weights (the tests drop textures anyway)
  const m = matSrc(matName);
  const t = kind === 'c' ? m.pbrMetallicRoughness?.baseColorTexture : m.normalTexture;
  if (t) texJobs.push({ key: `${OUT_NAME[matName]}_${kind}`, img: srcImg(t.index), q, png, recolor });
};
// Colour as JPEG quality 90, normals 92 (smooth gradients band below that); the hair's PNG keeps its alpha for the strand cards.
for (const m of ['Aver', 'Body', 'Cyber_Arm', 'Cyber_Hand', 'Head', 'Shirt_and_pants', 'Shoes']) { want(m, 'c', 90); want(m, 'n', 92); }
want('Eyes', 'c', 90);
want('Teeth', 'c', 90);
// Heins' hair is purple (docs/characters.md): the source atlas is black roots fading to green tips, so its brightness becomes a
// root-to-tip purple -> blue gradient and the strand lines and alpha stay as they were.
const HAIR_GRADIENT = (process.env.HAIR_GRADIENT ?? '#1c0a3d,#7a2fd0,#4f8cff').split(',');
want('Hair', 'c', 0, true, HAIR_GRADIENT[0] !== 'off');
const convertBin = (() => {
  for (const b of ['magick', 'convert']) {
    try { execFileSync(b, ['-version'], { stdio: 'ignore' }); return b; } catch {}
  }
  return null;
})();
const texBytes = new Map();
let texTotal = 0;
const texSize = new Map();
if (convertBin) {
  for (const t of texJobs) {
    const im = j.images[t.img];
    const bv = j.bufferViews[im.bufferView];
    const inp = path.join(tmp, `${t.key}_in.${im.mimeType === 'image/png' ? 'png' : 'jpg'}`);
    const out = path.join(tmp, `${t.key}.${t.png ? 'png' : 'jpg'}`);
    fs.writeFileSync(inp, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    if (t.recolor) {
      // gray = brightness (root 0 .. tip 1), clut'd through the gradient, then the original alpha put back.
      const f = (n) => path.join(tmp, `${t.key}_${n}.png`);
      execFileSync(convertBin, [inp, '-alpha', 'extract', f('alpha')]);
      execFileSync(convertBin, [inp, '-alpha', 'off', '-colorspace', 'Gray', '-auto-level', f('gray')]);
      execFileSync(convertBin, [...HAIR_GRADIENT.map((c) => `xc:${c}`), '+append', '-filter', 'Cubic', '-resize', '256x1!', f('grad')]);
      execFileSync(convertBin, [f('gray'), f('grad'), '-clut', f('alpha'), '-compose', 'CopyOpacity', '-composite', '-strip', '-define', 'png:compression-level=9', `PNG32:${out}`]);
    } else {
      const args = t.png
        ? [inp, '-strip', '-define', 'png:compression-level=9', `PNG32:${out}`]
        : [inp, '-background', 'white', '-alpha', 'remove', '-quality', String(t.q), '-sampling-factor', '4:2:0', '-strip', out];
      execFileSync(convertBin, args);
    }
    const b = fs.readFileSync(out);
    texBytes.set(t.key, { bytes: b, png: t.png });
    texSize.set(t.key, execFileSync(convertBin, ['identify', '-format', '%wx%h', out]).toString().trim());
    texTotal += b.length;
  }
} else if (process.platform === 'win32') {
  const jobs = texJobs.map((t) => {
    const im = j.images[t.img];
    const bv = j.bufferViews[im.bufferView];
    const inp = path.join(tmp, `${t.key}_in.${im.mimeType === 'image/png' ? 'png' : 'jpg'}`);
    const out = path.join(tmp, `${t.key}.${t.png ? 'png' : 'jpg'}`);
    fs.writeFileSync(inp, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    return { key: t.key, inp, out, q: t.q, png: t.png, recolor: t.recolor };
  });
  const manifest = path.join(tmp, 'jobs.json');
  fs.writeFileSync(manifest, JSON.stringify(jobs));
  const gradHex = JSON.stringify(HAIR_GRADIENT);
  const ps = path.join(tmp, 'encode.ps1');
  fs.writeFileSync(ps, `
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$qParam = [System.Drawing.Imaging.Encoder]::Quality
$grad = ('${gradHex}' | ConvertFrom-Json) | ForEach-Object { [System.Drawing.ColorTranslator]::FromHtml($_) }
$jobs = Get-Content -Raw '${manifest.replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($job in $jobs) {
  $src = [System.Drawing.Bitmap]::new($job.inp)
  $w = $src.Width; $h = $src.Height
  $fmt = if ($job.png) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $dst = [System.Drawing.Bitmap]::new($w, $h, $fmt)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  if (-not $job.png) { $g.Clear([System.Drawing.Color]::White) }
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose(); $src.Dispose()
  if ($job.recolor -and $grad.Count -ge 2) {
    $minL = 255.0; $maxL = 0.0
    for ($y = 0; $y -lt $h; $y++) { for ($x = 0; $x -lt $w; $x++) {
      $p = $dst.GetPixel($x, $y); $l = 0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B
      if ($l -lt $minL) { $minL = $l }; if ($l -gt $maxL) { $maxL = $l } } }
    $span = [Math]::Max(1.0, $maxL - $minL)
    for ($y = 0; $y -lt $h; $y++) { for ($x = 0; $x -lt $w; $x++) {
      $p = $dst.GetPixel($x, $y)
      $t = [Math]::Max(0.0, [Math]::Min(1.0, (0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B - $minL) / $span)) * ($grad.Count - 1)
      $i = [Math]::Min($grad.Count - 2, [int][Math]::Floor($t)); $f = $t - $i
      $c0 = $grad[$i]; $c1 = $grad[$i + 1]
      $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($p.A, [int][Math]::Round($c0.R + ($c1.R - $c0.R) * $f), [int][Math]::Round($c0.G + ($c1.G - $c0.G) * $f), [int][Math]::Round($c0.B + ($c1.B - $c0.B) * $f))) } }
  }
  if ($job.png) { $dst.Save($job.out, [System.Drawing.Imaging.ImageFormat]::Png) }
  else { $ep = [System.Drawing.Imaging.EncoderParameters]::new(1); $ep.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new($qParam, [long]$job.q); $dst.Save($job.out, $codec, $ep); $ep.Dispose() }
  "$($job.key) $w" + 'x' + "$h"
  $dst.Dispose()
}
`);
  const sizes = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps]).toString().trim().split(/\r?\n/);
  for (const line of sizes) { const [k, s] = line.trim().split(' '); texSize.set(k, s); }
  for (const job of jobs) {
    const b = fs.readFileSync(job.out);
    texBytes.set(job.key, { bytes: b, png: job.png });
    texTotal += b.length;
  }
} else {
  throw new Error('ImageMagick (magick or convert) is required on non-Windows platforms');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`textures: ${texJobs.length} images, ${(texTotal / 1048576).toFixed(1)} MB: ${[...texSize].map(([k, s]) => `${k} ${s}`).join(', ')}`);

// ------------------------------------------------------------------ pack
const chunks = [];
const views = [];
const accessors = [];
let offset = 0;
const push = (buf, extra = {}) => {
  const pad = (4 - (buf.length % 4)) % 4;
  chunks.push(pad ? Buffer.concat([buf, Buffer.alloc(pad)]) : buf);
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...extra });
  offset += buf.length + pad;
  return views.length - 1;
};
const acc = (view, componentType, type, n, extra = {}) => { accessors.push({ bufferView: view, componentType, type, count: n, ...extra }); return accessors.length - 1; };
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const meshes = groups.map((g, gi) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < g.count; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g.pos[v * 3 + k]); max[k] = Math.max(max[k], g.pos[v * 3 + k]); }
  const attrs = {
    POSITION: acc(push(f32(g.pos), { target: 34962 }), 5126, 'VEC3', g.count, { min, max }),
    NORMAL: acc(push(f32(g.nor), { target: 34962 }), 5126, 'VEC3', g.count),
    TEXCOORD_0: acc(push(f32(g.uv), { target: 34962 }), 5126, 'VEC2', g.count),
    JOINTS_0: acc(push(Buffer.from(skinned[gi].joints), { target: 34962 }), 5121, 'VEC4', g.count),
    WEIGHTS_0: acc(push(Buffer.from(skinned[gi].weights.buffer), { target: 34962 }), 5123, 'VEC4', g.count, { normalized: true }),
  };
  // 16-bit indices where they fit, 32-bit where a mesh has more vertices (bodyModel.ts handles both).
  const wide = g.count > 65535;
  const ib = wide ? Buffer.from(Uint32Array.from(g.idx).buffer) : Buffer.from(Uint16Array.from(g.idx).buffer);
  const idx = acc(push(ib, { target: 34963 }), wide ? 5125 : 5123, 'SCALAR', g.idx.length);
  return { name: `Heins_${OUT_NAME[g.name]}`, primitives: [{ attributes: attrs, indices: idx, material: gi }] };
});
const ibmAcc = acc(push(Buffer.from(ibm.buffer)), 5126, 'MAT4', NB);
const images = [];
const textures = [];
const texIndex = new Map();
for (const [key, { bytes, png }] of texBytes) {
  const v = push(bytes);
  images.push({ bufferView: v, mimeType: png ? 'image/png' : 'image/jpeg' });
  textures.push({ sampler: 0, source: images.length - 1 });
  texIndex.set(key, textures.length - 1);
}
const ROUGH = { Aver: 0.78, Body: 0.7, Cyber_Arm: 0.5, Cyber_Hand: 0.5, Eyes: 0.35, Hair: 0.6, Head: 0.7, Shirt_and_pants: 0.8, Shoes: 0.75, Teeth: 0.5 };
const materials = groups.map((g) => {
  const src0 = matSrc(g.name);
  const k = OUT_NAME[g.name];
  const m = { name: k, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: ROUGH[g.name] } };
  if (texIndex.has(`${k}_c`)) m.pbrMetallicRoughness.baseColorTexture = { index: texIndex.get(`${k}_c`) };
  if (texIndex.has(`${k}_n`)) m.normalTexture = { index: texIndex.get(`${k}_n`) };
  if (src0.pbrMetallicRoughness?.baseColorFactor && !(g.name === 'Hair' && HAIR_GRADIENT[0] !== 'off')) m.pbrMetallicRoughness.baseColorFactor = src0.pbrMetallicRoughness.baseColorFactor;
  if (src0.alphaMode === 'MASK') { m.alphaMode = 'MASK'; m.alphaCutoff = src0.alphaCutoff ?? 0.5; }
  if (src0.doubleSided) m.doubleSided = true;
  return m;
});
const glbJson = {
  asset: { version: '2.0', generator: 'scripts/fix-heins-glb.mjs', extras: j.asset.extras },
  scene: 0,
  scenes: [{ nodes: [boneIndex.get('Hips'), ...meshNodeIdx] }],
  nodes,
  meshes,
  skins: [{ joints: names.map((_, i) => i), inverseBindMatrices: ibmAcc, skeleton: boneIndex.get('Hips') }],
  materials,
  textures,
  samplers: j.samplers,
  images,
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: offset }],
};
let js = Buffer.from(JSON.stringify(glbJson));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const glb = Buffer.alloc(12 + 8 + js.length + 8 + offset);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
glb.writeUInt32LE(offset, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length);
let at = 28 + js.length;
for (const c of chunks) { c.copy(glb, at); at += c.length; }
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, glb);
console.log('wrote', dst, `${(glb.length / 1048576).toFixed(1)} MB, ${totalTris} triangles, ${NB} bones, ${groups.length} meshes`);

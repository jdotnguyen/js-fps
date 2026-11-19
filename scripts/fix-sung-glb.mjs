// Prepares the Sketchfab "Construction Worker In Safety Gear" GLB (restore50, CC-BY 4.0) for bodyModel.ts (ADR-0026).
//   node scripts/fix-sung-glb.mjs <source.glb> [public/assets/models/squad/sung.glb]
// The source is an unrigged 17 MB photogrammetry-style scan: 3 mesh chunks (~222k triangles), KHR_texture_transform on 5
// identical UV sets, 4 1024 px PNG textures, a bent left arm, and a long rolled blueprint tube in the right hand.
// What it does (17 MB -> ~0.7 MB):
//   - bakes the node transforms into Y-up metres with feet at y = 0, facing +Z, and bakes KHR_texture_transform into TEXCOORD_0;
//   - welds the 3 chunks by (position, UV), trims the protruding ends of the blueprint tube outside the right glove and caps the two openings;
//   - decimates to TARGET_TRIS with meshoptimizer's simplifier (preserving UV seams);
//   - builds a Mixamo-named skeleton from the J table below (measured off the scan) and computes smooth skin weights + jaw mask;
//     bodyModel.ts then straightens the bent left arm and legs from those bones like any rigged model;
//   - drops TANGENT, unused UV sets, metallicRoughness and emissive textures (bodyModel.ts only uses baseColor and normalMap),
//     and re-encodes the colour (1024 px) and normal (512 px) textures as JPEG.
// Uses ImageMagick (`magick`/`convert`) when available, falling back to Windows System.Drawing via PowerShell.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

const [src, dst = 'public/assets/models/squad/sung.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-sung-glb.mjs <source.glb> [out.glb]');
const TARGET_TRIS = Number(process.env.TARGET_TRIS ?? 16000);

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

// KHR_texture_transform on baseColorTexture (all textures share the same transform)
const tt = j.materials[0].pbrMetallicRoughness.baseColorTexture.extensions?.KHR_texture_transform;
const [uOff, vOff] = tt?.offset ?? [0, 0];
const [uScale, vScale] = tt?.scale ?? [1, 1];

// ------------------------------------------------------------------ weld chunks & bake transforms
// Find minY so feet sit on y = 0.
let minY = Infinity;
for (const [ni, node] of j.nodes.entries()) {
  if (node.mesh === undefined) continue;
  const m = world(ni);
  const pos = read(j.meshes[node.mesh].primitives[0].attributes.POSITION);
  for (let v = 0; v < pos.length / 3; v++) {
    const wy = m[1] * pos[v * 3] + m[5] * pos[v * 3 + 1] + m[9] * pos[v * 3 + 2] + m[13];
    if (wy < minY) minY = wy;
  }
}

const vertMap = new Map();
let P = [], N = [], UV = [];
let tris = [];
for (const [ni, node] of j.nodes.entries()) {
  if (node.mesh === undefined) continue;
  const prim = j.meshes[node.mesh].primitives[0];
  const m = world(ni);
  const pos = read(prim.attributes.POSITION);
  const nor = read(prim.attributes.NORMAL);
  const uv = read(prim.attributes.TEXCOORD_0);
  const idx = read(prim.indices);
  const remap = new Int32Array(pos.length / 3).fill(-1);
  const vertex = (v) => {
    if (remap[v] >= 0) return remap[v];
    const u = uv[v * 2] * uScale + uOff;
    const w = uv[v * 2 + 1] * vScale + vOff;
    const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}|${u.toFixed(5)},${w.toFixed(5)}`;
    let id = vertMap.get(key);
    if (id === undefined) {
      id = P.length / 3;
      vertMap.set(key, id);
      const [x, y, z] = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      P.push(
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13] - minY,
        m[2] * x + m[6] * y + m[10] * z + m[14],
      );
      const [nx, ny, nz] = [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]];
      const wx = m[0] * nx + m[4] * ny + m[8] * nz, wy = m[1] * nx + m[5] * ny + m[9] * nz, wz = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(wx, wy, wz) || 1;
      N.push(wx / l, wy / l, wz / l);
      UV.push(u, w);
    }
    remap[v] = id;
    return id;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = vertex(idx[t]), b = vertex(idx[t + 1]), c = vertex(idx[t + 2]);
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
}
vertMap.clear();
console.log(`merged: ${P.length / 3} vertices, ${tris.length / 3} triangles`);

// ------------------------------------------------------------------ trim protruding blueprint tube & cap openings
{
  const A = [-0.3437, 0.9466, -0.3618];
  const u = [0.2506, -0.262, 0.932];
  const isTube = new Uint8Array(P.length / 3);
  for (let v = 0; v < P.length / 3; v++) {
    const dx = P[v * 3] - A[0], dy = P[v * 3 + 1] - A[1], dz = P[v * 3 + 2] - A[2];
    const t = dx * u[0] + dy * u[1] + dz * u[2];
    if (t >= 0.315 && t <= 0.46) continue;
    const r = Math.hypot(dx - t * u[0], dy - t * u[1], dz - t * u[2]);
    if (r < 0.038) isTube[v] = 1;
  }
  const kept = [];
  const cutEdges = new Set();
  const ek = (a, b) => a * 1000000 + b;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (isTube[a] || isTube[b] || isTube[c]) {
      cutEdges.add(ek(a, b)); cutEdges.add(ek(b, c)); cutEdges.add(ek(c, a));
      continue;
    }
    kept.push(a, b, c);
  }
  // Only cap boundary edges that bordered a removed tube triangle.
  const nextOf = new Map();
  for (let t = 0; t < kept.length; t += 3) {
    const e = [[kept[t], kept[t + 1]], [kept[t + 1], kept[t + 2]], [kept[t + 2], kept[t]]];
    for (const [a, b] of e) {
      if (cutEdges.has(ek(b, a))) nextOf.set(a, b);
    }
  }
  const visited = new Set();
  let caps = 0;
  for (const start of nextOf.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let cur = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      loop.push(cur);
      cur = nextOf.get(cur);
    }
    if (loop.length < 3 || cur !== start) continue;
    let cx = 0, cy = 0, cz = 0;
    for (const v of loop) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;
    // Outward normal along -u (back cut) or +u (front cut)
    const proj = (cx - A[0]) * u[0] + (cy - A[1]) * u[1] + (cz - A[2]) * u[2];
    const sign = proj < 0.39 ? -1 : 1;
    const cid = P.length / 3;
    P.push(cx, cy, cz);
    N.push(u[0] * sign, u[1] * sign, u[2] * sign);
    // Borrow UV from the boundary loop so the cap blends with the surrounding glove/cuff texture.
    UV.push(UV[loop[0] * 2], UV[loop[0] * 2 + 1]);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      // Boundary edge is a -> b in kept triangles, so reverse (b -> a -> cid) maintains outward winding.
      kept.push(b, a, cid);
    }
    caps++;
  }
  // Compact unused vertices before simplification.
  const remap = new Int32Array(P.length / 3).fill(-1);
  const nP = [], nN = [], nUV = [];
  for (let i = 0; i < kept.length; i++) {
    const v = kept[i];
    if (remap[v] < 0) {
      remap[v] = nP.length / 3;
      nP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      nN.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      nUV.push(UV[v * 2], UV[v * 2 + 1]);
    }
    kept[i] = remap[v];
  }
  P = nP; N = nN; UV = nUV; tris = kept;
  console.log(`trimmed tube (${caps} caps): ${P.length / 3} vertices, ${tris.length / 3} triangles`);
}

// ------------------------------------------------------------------ decimate
await MeshoptSimplifier.ready;
const pos0 = new Float32Array(P);
const [simp, err] = MeshoptSimplifier.simplify(new Uint32Array(tris), pos0, 3, TARGET_TRIS * 3, 0.1);
console.log(`simplified: ${simp.length / 3} triangles (error ${err.toFixed(5)})`);

// Compact surviving vertices
const used = new Int32Array(P.length / 3).fill(-1);
const pos = [], nor = [], uv = [];
const indices = [];
for (let i = 0; i < simp.length; i++) {
  const v = simp[i];
  if (used[v] < 0) {
    used[v] = pos.length / 3;
    pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
    uv.push(UV[v * 2], UV[v * 2 + 1]);
  }
  indices.push(used[v]);
}
const count = pos.length / 3;
console.log(`rebuilt: ${count} vertices`);
if (count > 65535) throw new Error('too many vertices for u16 indices: ' + count);

// ------------------------------------------------------------------ skeleton (metres, Y up, facing +Z; left is +X)
// Measured off the scan (height 1.90 m including hard hat). Hips are level in Z so bodyModel's yaw is 0.
const J = {
  Hips: [0.015, 0.94, -0.135],
  Spine: [0.015, 1.10, -0.145],
  Spine1: [0.015, 1.32, -0.155],
  Neck: [0.015, 1.53, -0.145],
  Head: [0.015, 1.62, -0.115],
  HeadTop: [0.015, 1.90, -0.115],
  // Jaw hinge near the ear/cheek and the chin tip (face sits around z = -0.02..0.00, chin at y = 1.57, mouth at y = 1.62).
  Jaw: [0.015, 1.66, -0.105],
  JawEnd: [0.015, 1.575, -0.02],
  LeftShoulder: [0.08, 1.46, -0.145],
  LeftArm: [0.20, 1.44, -0.135],
  LeftForeArm: [0.31, 1.28, -0.035],
  LeftHand: [0.295, 1.44, 0.085],
  LeftHandMiddle1: [0.255, 1.53, 0.135],
  RightShoulder: [-0.05, 1.46, -0.145],
  RightArm: [-0.19, 1.44, -0.145],
  RightForeArm: [-0.245, 1.18, -0.125],
  RightHand: [-0.245, 0.92, -0.03],
  RightHandMiddle1: [-0.24, 0.82, -0.005],
  LeftUpLeg: [0.115, 0.91, -0.135],
  LeftLeg: [0.13, 0.49, -0.15],
  LeftFoot: [0.165, 0.10, -0.14],
  LeftToeBase: [0.19, 0.035, -0.02],
  LeftToeEnd: [0.205, 0.02, 0.045],
  RightUpLeg: [-0.085, 0.91, -0.135],
  RightLeg: [-0.115, 0.49, -0.12],
  RightFoot: [-0.135, 0.10, -0.105],
  RightToeBase: [-0.155, 0.035, 0.01],
  RightToeEnd: [-0.165, 0.02, 0.075],
};
// name: [parent, segment end (null: short stub), radius in metres]
const BONES = {
  Hips: [null, 'Spine', 0.18],
  Spine: ['Hips', 'Spine1', 0.19],
  Spine1: ['Spine', 'Neck', 0.19],
  Neck: ['Spine1', 'Head', 0.07],
  Head: ['Neck', 'HeadTop', 0.15],
  Jaw: ['Head', 'JawEnd', 0.045],
  JawEnd: ['Jaw', null, 0.03],
  LeftShoulder: ['Spine1', 'LeftArm', 0.075],
  LeftArm: ['LeftShoulder', 'LeftForeArm', 0.085],
  LeftForeArm: ['LeftArm', 'LeftHand', 0.075],
  LeftHand: ['LeftForeArm', 'LeftHandMiddle1', 0.07],
  LeftHandMiddle1: ['LeftHand', null, 0.055],
  RightShoulder: ['Spine1', 'RightArm', 0.075],
  RightArm: ['RightShoulder', 'RightForeArm', 0.085],
  RightForeArm: ['RightArm', 'RightHand', 0.075],
  RightHand: ['RightForeArm', 'RightHandMiddle1', 0.07],
  RightHandMiddle1: ['RightHand', null, 0.055],
  LeftUpLeg: ['Hips', 'LeftLeg', 0.11],
  LeftLeg: ['LeftUpLeg', 'LeftFoot', 0.085],
  LeftFoot: ['LeftLeg', 'LeftToeBase', 0.07],
  LeftToeBase: ['LeftFoot', 'LeftToeEnd', 0.06],
  LeftToeEnd: ['LeftToeBase', null, 0.04],
  RightUpLeg: ['Hips', 'RightLeg', 0.11],
  RightLeg: ['RightUpLeg', 'RightFoot', 0.085],
  RightFoot: ['RightLeg', 'RightToeBase', 0.07],
  RightToeBase: ['RightFoot', 'RightToeEnd', 0.06],
  RightToeEnd: ['RightToeBase', null, 0.04],
};
const names = Object.keys(BONES).filter((n) => !n.endsWith('ToeEnd') && n !== 'JawEnd');
const boneIndex = new Map(names.map((n, i) => [n, i]));
const segment = (n) => {
  const [, end] = BONES[n];
  const a = J[n];
  if (end) return [a, J[end]];
  const p = J[BONES[n][0]];
  const dv = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
  const l = Math.hypot(...dv) || 1;
  return [a, [a[0] + (dv[0] / l) * 0.07, a[1] + (dv[1] / l) * 0.07, a[2] + (dv[2] / l) * 0.07]];
};
const segs = names.map(segment);
const rad = names.map((n) => BONES[n][2]);
const distToSegment = (x, y, z, [a, b]) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1)));
  return Math.hypot(x - (a[0] + ab[0] * t), y - (a[1] + ab[1] * t), z - (a[2] + ab[2] * t));
};

// ------------------------------------------------------------------ skin weights
const NB = names.length;
const weldKey = new Map();
const weldOf = new Int32Array(count);
for (let v = 0; v < count; v++) {
  const key = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`;
  let w = weldKey.get(key);
  if (w === undefined) { w = weldKey.size; weldKey.set(key, w); }
  weldOf[v] = w;
}
const nW = weldKey.size;
const wPos = new Float32Array(nW * 3);
for (let v = 0; v < count; v++) wPos.set(pos.slice(v * 3, v * 3 + 3), weldOf[v] * 3);
let W = new Float32Array(nW * NB);
const SHARP = Number(process.env.SHARP ?? 8);
// Keep the raised left forearm/hand from pulling torso/head vertices and vice versa: torso vertices (x < 0.195 and z < 0.02)
// get a penalty against LeftForeArm/LeftHand; left hand vertices (x > 0.19 and z > 0.02) get a penalty against torso/head.
const leftDistal = new Set([boneIndex.get('LeftForeArm'), boneIndex.get('LeftHand'), boneIndex.get('LeftHandMiddle1')]);
const torsoHead = new Set([boneIndex.get('Hips'), boneIndex.get('Spine'), boneIndex.get('Spine1'), boneIndex.get('Neck'), boneIndex.get('Head'), boneIndex.get('Jaw')]);
const rightArmBones = new Set([boneIndex.get('RightArm'), boneIndex.get('RightForeArm'), boneIndex.get('RightHand'), boneIndex.get('RightHandMiddle1')]);
for (let w = 0; w < nW; w++) {
  const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
  const s = segs.map((sg, b) => {
    let score = distToSegment(x, y, z, sg) / rad[b];
    if (x < 0.19 && z < 0.03 && leftDistal.has(b)) score += 3;
    if (x > 0.21 && z > 0.02 && torsoHead.has(b)) score += 3;
    // Keep right thigh/hip from grabbing right hand/forearm and vice versa
    if (x > -0.185 && rightArmBones.has(b)) score += 2;
    if (x < -0.21 && y < 1.15 && (b === boneIndex.get('Hips') || b === boneIndex.get('RightUpLeg'))) score += 2;
    return score;
  });
  const best = Math.min(...s);
  let sum = 0;
  for (let b = 0; b < NB; b++) { const e = Math.exp(-(s[b] - best) * SHARP); W[w * NB + b] = e; sum += e; }
  for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
}
// Laplacian smoothing over mesh edges
const nbrs = Array.from({ length: nW }, () => new Set());
for (let t = 0; t < indices.length; t += 3) {
  const a = weldOf[indices[t]], b = weldOf[indices[t + 1]], c = weldOf[indices[t + 2]];
  nbrs[a].add(b).add(c); nbrs[b].add(a).add(c); nbrs[c].add(a).add(b);
}
for (let it = 0; it < 4; it++) {
  const next = new Float32Array(W.length);
  for (let w = 0; w < nW; w++) {
    const ns = [...nbrs[w]];
    for (let b = 0; b < NB; b++) {
      let s = 0;
      for (const o of ns) s += W[o * NB + b];
      next[w * NB + b] = ns.length ? 0.5 * W[w * NB + b] + 0.5 * (s / ns.length) : W[w * NB + b];
    }
  }
  W = next;
}
// Jaw mask applied after smoothing: lower front of the face (below mouth line y = 1.625, above throat y = 1.56, in front of hinge).
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const JAW = { mouthY: 1.625, chinY: 1.565, hingeZ: J.Jaw[2], cx: J.Jaw[0] };
const jawMask = (x, y, z) =>
  smooth(JAW.mouthY + 0.015, JAW.mouthY - 0.01, y) * smooth(JAW.chinY - 0.03, JAW.chinY + 0.005, y) *
  smooth(JAW.hingeZ + 0.03, JAW.hingeZ + 0.075, z) * smooth(0.085, 0.05, Math.abs(x - JAW.cx));
const jawB = boneIndex.get('Jaw');
for (let w = 0; w < nW; w++) {
  const m = jawMask(wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]);
  if (m <= 0) continue;
  for (let b = 0; b < NB; b++) W[w * NB + b] *= 1 - m;
  W[w * NB + jawB] += m;
}
// Keep top 4 bones per vertex, renormalised to u16
const joints = new Uint8Array(count * 4);
const weights = new Uint16Array(count * 4);
for (let v = 0; v < count; v++) {
  const w = weldOf[v];
  const top = Array.from({ length: NB }, (_, b) => [b, W[w * NB + b]]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, t) => s + t[1], 0) || 1;
  const q = top.map((t) => Math.round((t[1] / sum) * 65535));
  q[0] += 65535 - q.reduce((s, x) => s + x, 0);
  top.forEach((t, k) => { joints[v * 4 + k] = t[0]; weights[v * 4 + k] = q[k]; });
}

// ------------------------------------------------------------------ nodes
const nodes = names.map((n) => {
  const p = BONES[n][0];
  const o = p ? J[p] : [0, 0, 0];
  return { name: n, translation: J[n].map((x, k) => +(x - o[k]).toFixed(6)) };
});
names.forEach((n, i) => { const p = BONES[n][0]; if (p) (nodes[boneIndex.get(p)].children ??= []).push(i); });
const meshNode = nodes.length;
nodes.push({ name: 'Sung', mesh: 0, skin: 0 });
const ibm = new Float32Array(NB * 16);
names.forEach((n, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1], i * 16));

// ------------------------------------------------------------------ textures
function encodeJpeg(pngBytes, maxDim, quality) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sung-'));
  const inp = path.join(tmp, 'in.png');
  const out = path.join(tmp, 'out.jpg');
  fs.writeFileSync(inp, pngBytes);
  try {
    // Try ImageMagick first (Linux/macOS or Windows with ImageMagick installed)
    const cmd = process.platform === 'win32' ? 'magick' : 'convert';
    execFileSync(cmd, [inp, '-resize', `${maxDim}x${maxDim}>`, '-quality', String(quality), '-sampling-factor', quality >= 90 ? '4:4:4' : '4:2:0', '-strip', out], { stdio: 'ignore' });
  } catch {
    if (process.platform !== 'win32') throw new Error('ImageMagick (convert) is required to re-encode textures');
    // Fallback to .NET System.Drawing on Windows
    const ps = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${inp.replace(/'/g, "''")}')
$w = [Math]::Min($src.Width, ${maxDim})
$h = [Math]::Min($src.Height, ${maxDim})
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose(); $src.Dispose()
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})
$bmp.Save('${out.replace(/'/g, "''")}', $codec, $ep)
$bmp.Dispose()
`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps]);
  }
  const buf = fs.readFileSync(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  return buf;
}

const getImgBytes = (imgIdx) => {
  const bv = j.bufferViews[j.images[imgIdx].bufferView];
  return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
};
const colorIdx = j.textures[j.materials[0].pbrMetallicRoughness.baseColorTexture.index].source;
const normalIdx = j.textures[j.materials[0].normalTexture.index].source;
const colorTex = encodeJpeg(getImgBytes(colorIdx), 1024, 86);
const normalTex = encodeJpeg(getImgBytes(normalIdx), 512, 90);
console.log(`textures: color ${(colorTex.length / 1024).toFixed(0)} KB, normal ${(normalTex.length / 1024).toFixed(0)} KB`);

// ------------------------------------------------------------------ pack
const chunks = [];
const views = [];
const accessors = [];
const push = (buf, extra = {}) => {
  const pad = (4 - (buf.length % 4)) % 4;
  const off = chunks.reduce((s, c) => s + c.length, 0);
  chunks.push(Buffer.concat([buf, Buffer.alloc(pad)]));
  views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...extra });
  return views.length - 1;
};
const acc = (view, componentType, type, n, extra = {}) => { accessors.push({ bufferView: view, componentType, type, count: n, ...extra }); return accessors.length - 1; };
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < count; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[v * 3 + k]); max[k] = Math.max(max[k], pos[v * 3 + k]); }
const attrs = {
  POSITION: acc(push(f32(pos), { target: 34962 }), 5126, 'VEC3', count, { min, max }),
  NORMAL: acc(push(f32(nor), { target: 34962 }), 5126, 'VEC3', count),
  TEXCOORD_0: acc(push(f32(uv), { target: 34962 }), 5126, 'VEC2', count),
  JOINTS_0: acc(push(Buffer.from(joints), { target: 34962 }), 5121, 'VEC4', count),
  WEIGHTS_0: acc(push(Buffer.from(weights.buffer), { target: 34962 }), 5123, 'VEC4', count, { normalized: true }),
};
const idx = acc(push(Buffer.from(Uint16Array.from(indices).buffer), { target: 34963 }), 5123, 'SCALAR', indices.length);
const ibmAcc = acc(push(Buffer.from(ibm.buffer)), 5126, 'MAT4', NB);
const imgViews = [push(colorTex), push(normalTex)];
const glbJson = {
  asset: { version: '2.0', generator: 'scripts/fix-sung-glb.mjs', extras: j.asset.extras },
  scene: 0,
  scenes: [{ nodes: [boneIndex.get('Hips'), meshNode] }],
  nodes,
  meshes: [{ name: 'Sung', primitives: [{ attributes: attrs, indices: idx, material: 0 }] }],
  skins: [{ joints: names.map((_, i) => i), inverseBindMatrices: ibmAcc, skeleton: boneIndex.get('Hips') }],
  materials: [{
    name: 'worker',
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 },
    normalTexture: { index: 1 },
  }],
  textures: [{ sampler: 0, source: 0 }, { sampler: 0, source: 1 }],
  samplers: j.samplers,
  images: imgViews.map((bufferView) => ({ bufferView, mimeType: 'image/jpeg' })),
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: chunks.reduce((s, c) => s + c.length, 0) }],
};
let js = Buffer.from(JSON.stringify(glbJson));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const body = Buffer.concat(chunks);
const glb = Buffer.alloc(12 + 8 + js.length + 8 + body.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
glb.writeUInt32LE(body.length, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length); body.copy(glb, 28 + js.length);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, glb);
console.log('wrote', dst, `${(glb.length / 1024).toFixed(0)} KB, ${indices.length / 3} triangles, ${NB} bones`);

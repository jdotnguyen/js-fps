// Prepares the Sketchfab "Security Officer In Tactical Gear" GLB (restore50, CC-BY 4.0) for bodyModel.ts (ADR-0026).
//   node scripts/fix-giles-glb.mjs <source.glb> [public/assets/models/squad/giles.glb]
// The source is an unrigged photogrammetry-style scan (~207k triangles, no skeleton, walking stride, head turned
// right, left hand holding a radio strap on the chest, right hand grazing the hip). What it does (15.8 MB -> < 1 MB):
//   - bakes the source's node transforms into Y-up metres facing +Z, shifts minY to 0, and bakes KHR_texture_transform into
//     TEXCOORD_0 (dropping TANGENT, TEXCOORD_1..4, and unused emissive/metallicRoughness textures);
//   - separates the fused right-hand/hip and left-arm/chest contacts and caps the small boundary loops so the arms can
//     hang cleanly in bodyModel.ts's rest pose;
//   - straightens the 25-degree head turn above the neck so the face looks forward;
//   - decimates to TARGET_TRIS with meshoptimizer's simplifier (UV seams survive as separate vertices);
//   - builds a Mixamo-named skeleton (note: his right leg steps forward across the midline while his left trails behind)
//     and skins every vertex with region isolation for the arms and crossed legs, plus a Jaw mask for ADR-0027;
//   - re-encodes the base colour (1024 px) and normal (512 px) textures as JPEG via .NET System.Drawing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

const [src, dst = 'public/assets/models/squad/giles.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-giles-glb.mjs <source.glb> [out.glb]');
const TARGET_TRIS = Number(process.env.TARGET_TRIS ?? 14000);

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

// ------------------------------------------------------------------ merge meshes & bake UVs
const mat0 = j.materials[0];
const tt = mat0.pbrMetallicRoughness.baseColorTexture.extensions?.KHR_texture_transform;
const uvScale = tt?.scale ?? [1, 1];
const uvOffset = tt?.offset ?? [0, 0];

const vertMap = new Map();
const P = [], N = [], CAND = [];
let tris = [];
let minY = Infinity;
for (const [ni, node] of j.nodes.entries()) {
  if (node.mesh === undefined) continue;
  const m = world(ni);
  const prim = j.meshes[node.mesh].primitives[0];
  const pos = read(prim.attributes.POSITION);
  const nor = read(prim.attributes.NORMAL);
  const uv = read(prim.attributes.TEXCOORD_0);
  const idx = read(prim.indices);
  const remap = new Int32Array(pos.length / 3).fill(-1);
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
    const key = `${wx.toFixed(5)},${wy.toFixed(5)},${wz.toFixed(5)}`;
    let id = vertMap.get(key);
    if (id === undefined) {
      id = P.length / 3;
      vertMap.set(key, id);
      P.push(wx, wy, wz);
      if (wy < minY) minY = wy;
      const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
      const wnx = m[0] * nx + m[4] * ny + m[8] * nz;
      const wny = m[1] * nx + m[5] * ny + m[9] * nz;
      const wnz = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(wnx, wny, wnz) || 1;
      N.push(wnx / l, wny / l, wnz / l);
      CAND.push([]);
    }
    const u = uv[v * 2] * uvScale[0] + uvOffset[0];
    const w = uv[v * 2 + 1] * uvScale[1] + uvOffset[1];
    const c = CAND[id];
    if (!c.some((t) => Math.abs(t[0] - u) < 1e-5 && Math.abs(t[1] - w) < 1e-5)) c.push([u, w]);
    remap[v] = id;
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
}
vertMap.clear();
for (let i = 0; i < P.length; i += 3) P[i + 1] -= minY;
console.log(`merged: ${P.length / 3} vertices, ${tris.length / 3} triangles`);

// ------------------------------------------------------------------ separate fused arm contacts & cap holes
const isLeftArmCut = (x, y, z) => {
  if (y >= 1.40 || y < 1.15 || x < 0.10) return false;
  return x > 0.175 || (z > 0.155 && x > 0.125 && y < 1.39);
};
const isRightHandCut = (x, y) => y < 0.98 && x < -0.185;

const keptTris = [];
for (let t = 0; t < tris.length; t += 3) {
  const a = tris[t], b = tris[t + 1], c = tris[t + 2];
  const vs = [a, b, c];
  if (vs.every((v) => P[v * 3 + 1] < 0.99 && P[v * 3] < -0.12)) {
    const c0 = isRightHandCut(P[a * 3], P[a * 3 + 1]);
    const c1 = isRightHandCut(P[b * 3], P[b * 3 + 1]);
    const c2 = isRightHandCut(P[c * 3], P[c * 3 + 1]);
    if (!(c0 === c1 && c1 === c2)) continue;
  }
  if (vs.every((v) => P[v * 3 + 1] < 1.41 && P[v * 3 + 1] > 1.14 && P[v * 3] > 0.09)) {
    const c0 = isLeftArmCut(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    const c1 = isLeftArmCut(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    const c2 = isLeftArmCut(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
    if (!(c0 === c1 && c1 === c2)) continue;
  }
  keptTris.push(a, b, c);
}

const edgeCount = new Map();
for (let t = 0; t < keptTris.length; t += 3) {
  const vs = [keptTris[t], keptTris[t + 1], keptTris[t + 2]];
  for (let k = 0; k < 3; k++) {
    const key = `${vs[k]},${vs[(k + 1) % 3]}`;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  }
}
const nextBoundary = new Map();
for (const [key] of edgeCount) {
  const [u, v] = key.split(',').map(Number);
  if (!edgeCount.has(`${v},${u}`)) {
    if (!nextBoundary.has(u)) nextBoundary.set(u, []);
    nextBoundary.get(u).push(v);
  }
}
const visitedEdges = new Set();
for (const [startU, vs] of nextBoundary) {
  for (const startV of vs) {
    if (visitedEdges.has(`${startU},${startV}`)) continue;
    const loop = [startU];
    let u = startU, v = startV;
    while (true) {
      visitedEdges.add(`${u},${v}`);
      if (v === startU) break;
      loop.push(v);
      const nxt = nextBoundary.get(v)?.find((w) => !visitedEdges.has(`${v},${w}`));
      if (nxt === undefined) break;
      u = v; v = nxt;
      if (loop.length > 500) break;
    }
    if (loop.length >= 3 && v === startU) {
      const cid = P.length / 3;
      let sx = 0, sy = 0, sz = 0, snx = 0, sny = 0, snz = 0, su = 0, sw = 0;
      for (const lv of loop) {
        sx += P[lv * 3]; sy += P[lv * 3 + 1]; sz += P[lv * 3 + 2];
        snx += N[lv * 3]; sny += N[lv * 3 + 1]; snz += N[lv * 3 + 2];
        su += CAND[lv][0][0]; sw += CAND[lv][0][1];
      }
      const n = loop.length;
      P.push(sx / n, sy / n, sz / n);
      const nl = Math.hypot(snx, sny, snz) || 1;
      N.push(snx / nl, sny / nl, snz / nl);
      CAND.push([[su / n, sw / n]]);
      for (let k = 0; k < n; k++) keptTris.push(loop[(k + 1) % n], loop[k], cid);
    }
  }
}
tris = keptTris;

// ------------------------------------------------------------------ straighten head yaw (+25 deg)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const HEAD_YAW = (25 * Math.PI) / 180;
const HCX = 0.004, HCZ = 0.088;
for (let i = 0; i < P.length / 3; i++) {
  const t = smooth(1.53, 1.60, P[i * 3 + 1]);
  if (t <= 0) continue;
  const ang = HEAD_YAW * t;
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = P[i * 3] - HCX, dz = P[i * 3 + 2] - HCZ;
  P[i * 3] = HCX + dx * c + dz * s;
  P[i * 3 + 2] = HCZ - dx * s + dz * c;
  const nx = N[i * 3], nz = N[i * 3 + 2];
  N[i * 3] = nx * c + nz * s;
  N[i * 3 + 2] = -nx * s + nz * c;
}

// ------------------------------------------------------------------ decimate
await MeshoptSimplifier.ready;
const [simp, err] = MeshoptSimplifier.simplify(new Uint32Array(tris), new Float32Array(P), 3, TARGET_TRIS * 3, 0.05);
console.log(`simplified: ${simp.length / 3} triangles (error ${err.toFixed(5)})`);

const used = new Map();
const pos = [], nor = [], uv = [], indices = [];
const uvDist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
for (let t = 0; t < simp.length; t += 3) {
  const w = [simp[t], simp[t + 1], simp[t + 2]];
  let best = null, bestD = Infinity;
  for (let i = 0; i < CAND[w[0]].length; i++) for (let k = 0; k < CAND[w[1]].length; k++) for (let l = 0; l < CAND[w[2]].length; l++) {
    const a = CAND[w[0]][i], b = CAND[w[1]][k], c = CAND[w[2]][l];
    const dd = Math.max(uvDist(a, b), uvDist(b, c), uvDist(a, c));
    if (dd < bestD) { bestD = dd; best = [i, k, l]; }
  }
  for (let c = 0; c < 3; c++) {
    const key = w[c] * 64 + best[c];
    let id = used.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      used.set(key, id);
      pos.push(P[w[c] * 3], P[w[c] * 3 + 1], P[w[c] * 3 + 2]);
      nor.push(N[w[c] * 3], N[w[c] * 3 + 1], N[w[c] * 3 + 2]);
      uv.push(...CAND[w[c]][best[c]]);
    }
    indices.push(id);
  }
}
const count = pos.length / 3;
console.log(`rebuilt: ${count} vertices`);
if (count > 65535) throw new Error('too many vertices for u16 indices: ' + count);

// ------------------------------------------------------------------ skeleton (metres, Y up, facing +Z; his left is +X)
const J = {
  Hips: [0.0, 0.92, 0.05],
  Spine: [0.0, 1.08, 0.05],
  Spine1: [0.0, 1.32, 0.05],
  Neck: [0.0, 1.54, 0.05],
  Head: [0.0, 1.62, 0.06],
  HeadTop: [0.0, 1.90, 0.06],
  Jaw: [0.0, 1.68, 0.08],
  JawEnd: [0.0, 1.58, 0.15],
  LeftShoulder: [0.08, 1.47, 0.04],
  LeftArm: [0.20, 1.42, 0.00],
  LeftForeArm: [0.24, 1.22, -0.05],
  LeftHand: [0.16, 1.32, 0.14],
  LeftHandMiddle1: [0.13, 1.33, 0.19],
  RightShoulder: [-0.08, 1.47, 0.04],
  RightArm: [-0.20, 1.43, 0.06],
  RightForeArm: [-0.26, 1.20, 0.07],
  RightHand: [-0.22, 0.96, 0.12],
  RightHandMiddle1: [-0.22, 0.84, 0.13],
  // Left leg (+X hip -> trailing leg in -Z)
  LeftUpLeg: [0.095, 0.88, 0.02],
  LeftLeg: [0.047, 0.50, -0.073],
  LeftFoot: [-0.138, 0.147, -0.253],
  LeftToeBase: [-0.115, 0.03, -0.205],
  LeftToeEnd: [-0.095, 0.02, -0.17],
  // Right leg (-X hip -> leading leg in +Z)
  RightUpLeg: [-0.097, 0.88, 0.05],
  RightLeg: [-0.027, 0.50, 0.163],
  RightFoot: [0.06, 0.11, 0.19],
  RightToeBase: [0.08, 0.035, 0.28],
  RightToeEnd: [0.085, 0.02, 0.33],
};
const BONES = {
  Hips: [null, 'Spine', 0.2],
  Spine: ['Hips', 'Spine1', 0.2],
  Spine1: ['Spine', 'Neck', 0.22],
  Neck: ['Spine1', 'Head', 0.07],
  Head: ['Neck', 'HeadTop', 0.15],
  Jaw: ['Head', 'JawEnd', 0.05],
  JawEnd: ['Jaw', null, 0.03],
  LeftShoulder: ['Spine1', 'LeftArm', 0.08],
  LeftArm: ['LeftShoulder', 'LeftForeArm', 0.1],
  LeftForeArm: ['LeftArm', 'LeftHand', 0.09],
  LeftHand: ['LeftForeArm', 'LeftHandMiddle1', 0.07],
  LeftHandMiddle1: ['LeftHand', null, 0.05],
  RightShoulder: ['Spine1', 'RightArm', 0.08],
  RightArm: ['RightShoulder', 'RightForeArm', 0.1],
  RightForeArm: ['RightArm', 'RightHand', 0.09],
  RightHand: ['RightForeArm', 'RightHandMiddle1', 0.07],
  RightHandMiddle1: ['RightHand', null, 0.05],
  LeftUpLeg: ['Hips', 'LeftLeg', 0.11],
  LeftLeg: ['LeftUpLeg', 'LeftFoot', 0.08],
  LeftFoot: ['LeftLeg', 'LeftToeBase', 0.07],
  LeftToeBase: ['LeftFoot', 'LeftToeEnd', 0.06],
  LeftToeEnd: ['LeftToeBase', null, 0.04],
  RightUpLeg: ['Hips', 'RightLeg', 0.11],
  RightLeg: ['RightUpLeg', 'RightFoot', 0.08],
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
  const d = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
  const l = Math.hypot(...d) || 1;
  return [a, [a[0] + (d[0] / l) * 0.08, a[1] + (d[1] / l) * 0.08, a[2] + (d[2] / l) * 0.08]];
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

const wAdj = Array.from({ length: nW }, () => new Set());
for (let t = 0; t < indices.length; t += 3) {
  const a = weldOf[indices[t]], b = weldOf[indices[t + 1]], c = weldOf[indices[t + 2]];
  wAdj[a].add(b).add(c); wAdj[b].add(a).add(c); wAdj[c].add(a).add(b);
}
const legTag = new Int8Array(nW); // 0=none, 1=Right(front), 2=Left(back)
{
  const vis = new Uint8Array(nW);
  for (let w = 0; w < nW; w++) {
    if (vis[w] || wPos[w * 3 + 1] > 0.72) continue;
    const q = [w]; vis[w] = 1;
    let sz = 0, zSum = 0;
    for (let h = 0; h < q.length; h++) {
      const u = q[h]; sz++; zSum += wPos[u * 3 + 2];
      for (const v of wAdj[u]) if (!vis[v] && wPos[v * 3 + 1] <= 0.72) { vis[v] = 1; q.push(v); }
    }
    if (sz > 30) {
      const tag = zSum / sz > 0 ? 1 : 2;
      for (const u of q) legTag[u] = tag;
    }
  }
}
const armTag = new Int8Array(nW); // 0=none, 1=RightArm, 2=LeftArm
{
  const seedNearest = (tx, ty, tz) => {
    let best = -1, bd = Infinity;
    for (let w = 0; w < nW; w++) {
      const dd = (wPos[w * 3] - tx) ** 2 + (wPos[w * 3 + 1] - ty) ** 2 + (wPos[w * 3 + 2] - tz) ** 2;
      if (dd < bd) { bd = dd; best = w; }
    }
    return best;
  };
  for (const [tag, seedPos, canEnter] of [
    [1, [-0.26, 1.20, 0.07], (x, y) => y <= 1.38 && x <= -0.185],
    [2, [0.24, 1.23, -0.06], (x, y, z) => y <= 1.39 && (x >= 0.185 || z >= 0.12)],
  ]) {
    const start = seedNearest(...seedPos);
    const q = [start]; armTag[start] = tag;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (const v of wAdj[u]) {
        if (armTag[v] === 0 && canEnter(wPos[v * 3], wPos[v * 3 + 1], wPos[v * 3 + 2])) {
          armTag[v] = tag; q.push(v);
        }
      }
    }
  }
}

let W = new Float32Array(nW * NB);
const SHARP = Number(process.env.SHARP ?? 7);
for (let w = 0; w < nW; w++) {
  const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
  const s = segs.map((sg, b) => {
    const nm = names[b];
    if (legTag[w] === 1 && nm.startsWith('Left') && (nm.includes('Leg') || nm.includes('Foot') || nm.includes('Toe'))) return 1e6;
    if (legTag[w] === 2 && nm.startsWith('Right') && (nm.includes('Leg') || nm.includes('Foot') || nm.includes('Toe'))) return 1e6;
    const isLArm = nm === 'LeftArm' || nm === 'LeftForeArm' || nm === 'LeftHand' || nm === 'LeftHandMiddle1';
    const isRArm = nm === 'RightArm' || nm === 'RightForeArm' || nm === 'RightHand' || nm === 'RightHandMiddle1';
    if (armTag[w] === 2 && !isLArm) return 1e6;
    if (armTag[w] !== 2 && isLArm && y < 1.40) return 1e6;
    if (armTag[w] === 1 && !isRArm) return 1e6;
    if (armTag[w] !== 1 && isRArm && y < 1.38) return 1e6;
    return distToSegment(x, y, z, sg) / rad[b];
  });
  const best = Math.min(...s);
  let sum = 0;
  for (let b = 0; b < NB; b++) { const e = Math.exp(-(s[b] - best) * SHARP); W[w * NB + b] = e; sum += e; }
  for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
}
for (let it = 0; it < 4; it++) {
  const next = new Float32Array(W.length);
  for (let w = 0; w < nW; w++) {
    const ns = [...wAdj[w]].filter((o) => armTag[o] === armTag[w] && legTag[o] === legTag[w]);
    for (let b = 0; b < NB; b++) {
      let s = 0;
      for (const o of ns) s += W[o * NB + b];
      next[w * NB + b] = ns.length ? 0.5 * W[w * NB + b] + 0.5 * (s / ns.length) : W[w * NB + b];
    }
  }
  W = next;
}

const JAW = { mouthY: 1.635, chinY: 1.58, hingeZ: J.Jaw[2], cx: J.Jaw[0] };
const jawMask = (x, y, z) =>
  smooth(JAW.mouthY + 0.02, JAW.mouthY - 0.01, y) * smooth(JAW.chinY - 0.045, JAW.chinY - 0.005, y) *
  smooth(JAW.hingeZ + 0.03, JAW.hingeZ + 0.08, z) * smooth(0.08, 0.045, Math.abs(x - JAW.cx));
const jawB = boneIndex.get('Jaw');
for (let w = 0; w < nW; w++) {
  const m = jawMask(wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]);
  if (m <= 0) continue;
  for (let b = 0; b < NB; b++) W[w * NB + b] *= 1 - m;
  W[w * NB + jawB] += m;
}

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
nodes.push({ name: 'Giles', mesh: 0, skin: 0 });
const ibm = new Float32Array(NB * 16);
names.forEach((n, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1], i * 16));

// ------------------------------------------------------------------ textures (PNG -> JPEG via .NET System.Drawing)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giles-'));
const writeSrcImg = (texObj, name) => {
  const bv = j.bufferViews[j.images[j.textures[texObj.index].source].bufferView];
  const p = path.join(tmp, name);
  fs.writeFileSync(p, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  return p;
};
const colorIn = writeSrcImg(mat0.pbrMetallicRoughness.baseColorTexture, 'color.png');
const normalIn = writeSrcImg(mat0.normalTexture, 'normal.png');
const colorOut = path.join(tmp, 'color.jpg');
const normalOut = path.join(tmp, 'normal.jpg');
const psScript = path.join(tmp, 'compress.ps1');
fs.writeFileSync(psScript, `
Add-Type -AssemblyName System.Drawing
function Convert-ToJpg([string]$inPath, [string]$outPath, [int]$maxSize, [long]$quality) {
  $src = [System.Drawing.Image]::FromFile($inPath)
  $w = $src.Width; $h = $src.Height
  if ($maxSize -gt 0 -and ($w -gt $maxSize -or $h -gt $maxSize)) {
    $scale = [Math]::Min($maxSize / $w, $maxSize / $h)
    $w = [int][Math]::Round($w * $scale); $h = [int][Math]::Round($h * $scale)
  }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose(); $src.Dispose()
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $quality)
  $bmp.Save($outPath, $codec, $ep)
  $bmp.Dispose()
}
Convert-ToJpg '${colorIn.replace(/'/g, "''")}' '${colorOut.replace(/'/g, "''")}' 1024 86
Convert-ToJpg '${normalIn.replace(/'/g, "''")}' '${normalOut.replace(/'/g, "''")}' 512 92
`);
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript]);
const colorTex = fs.readFileSync(colorOut);
const normalTex = fs.readFileSync(normalOut);
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ pack
const chunks = [], views = [], accessors = [];
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
  asset: { version: '2.0', generator: 'scripts/fix-giles-glb.mjs', extras: j.asset.extras },
  scene: 0,
  scenes: [{ nodes: [boneIndex.get('Hips'), meshNode] }],
  nodes,
  meshes: [{ name: 'Giles', primitives: [{ attributes: attrs, indices: idx, material: 0 }] }],
  skins: [{ joints: names.map((_, i) => i), inverseBindMatrices: ibmAcc, skeleton: boneIndex.get('Hips') }],
  materials: [{
    name: 'officer',
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

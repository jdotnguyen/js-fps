// Prepares the Sketchfab "Mujer 2 con bolsa" GLB (Roberto Dominguez / vmmaniac, CC-BY 4.0) for bodyModel.ts (ADR-0026).
//   node scripts/fix-priya-glb.mjs <source.glb> [public/assets/models/squad/priya.glb]
// The source is an unrigged photogrammetry-style scan: 7 body chunks of ~65k vertices (about 640k triangles), no skeleton,
// a walking pose, and a shopping bag in one hand. What it does (24 MB -> well under 1 MB):
//   - bakes the source's node transforms (Z-up, 1/10 mm units) into Y-up metres facing +Z, like the Mechanic and the doctor;
//   - drops the bag (two extra meshes and their materials), merges the chunks and welds shared vertices;
//   - decimates to TARGET_TRIS with meshoptimizer's simplifier (UV seams survive as separate vertices);
//   - builds a Mixamo-named skeleton from the JOINTS table below (measured off the scan, in its own walking pose) and skins
//     every vertex to the nearest bones by distance-to-segment / bone radius, smoothed over the mesh. bodyModel.ts then
//     straightens the pose by those bones, exactly as for a rigged model;
//   - re-encodes the 1024 px colour texture as JPEG (the source's second image belongs to the bag and is dropped).
// Needs ImageMagick (`convert`) on the PATH for the texture and `meshoptimizer` (a dependency of three) in node_modules.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

const [src, dst = 'public/assets/models/squad/priya.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-priya-glb.mjs <source.glb> [out.glb]');
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

// ------------------------------------------------------------------ merge the body chunks (the bag is mesh 7 and 8)
// Welded on position alone so the mesh is one connected surface the simplifier can work on (welding on UV too leaves every
// UV island a locked border and decimation stalls near 150k triangles). Each welded vertex keeps the list of UVs it had;
// the UVs of every surviving triangle are picked again after decimation.
const BODY_MATERIAL = 0;
const vertMap = new Map();
let P = [], N = [];
let CAND = []; // per welded vertex: [[u, v], ...]
let tris = [];
for (const [ni, node] of j.nodes.entries()) {
  if (node.mesh === undefined) continue;
  const prim = j.meshes[node.mesh].primitives[0];
  if (prim.material !== BODY_MATERIAL) continue;
  const m = world(ni);
  const pos = read(prim.attributes.POSITION);
  const nor = read(prim.attributes.NORMAL);
  const uv = read(prim.attributes.TEXCOORD_0);
  const idx = read(prim.indices);
  const remap = new Int32Array(pos.length / 3).fill(-1);
  const vertex = (v) => {
    if (remap[v] >= 0) return remap[v];
    const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let id = vertMap.get(key);
    if (id === undefined) {
      id = P.length / 3;
      vertMap.set(key, id);
      const [x, y, z] = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      P.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      const [nx, ny, nz] = [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]];
      const wx = m[0] * nx + m[4] * ny + m[8] * nz, wy = m[1] * nx + m[5] * ny + m[9] * nz, wz = m[2] * nx + m[6] * ny + m[10] * nz;
      const l = Math.hypot(wx, wy, wz) || 1;
      N.push(wx / l, wy / l, wz / l);
      CAND.push([]);
    }
    const c = CAND[id];
    const u = uv[v * 2], w = uv[v * 2 + 1];
    if (!c.some((t) => t[0] === u && t[1] === w)) c.push([u, w]);
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

// The scan is full of non-manifold fuzz (hair, cloth layers) that locks the simplifier at ~45k triangles, so first merge
// vertices on a coarse grid (CELL metres), which turns it into a clean surface, and let the simplifier take it from there.
{
  const CELL = Number(process.env.CELL ?? 0.012);
  const lo = [Infinity, Infinity, Infinity];
  for (let v = 0; v < P.length / 3; v++) for (let k = 0; k < 3; k++) lo[k] = Math.min(lo[k], P[v * 3 + k]);
  const cell = new Map();
  const cid = new Int32Array(P.length / 3);
  const sp = [], sn = [], cnt = [], cu = [];
  for (let v = 0; v < P.length / 3; v++) {
    const key = [0, 1, 2].map((k) => Math.floor((P[v * 3 + k] - lo[k]) / CELL)).join(',');
    let c = cell.get(key);
    if (c === undefined) { c = cnt.length; cell.set(key, c); sp.push(0, 0, 0); sn.push(0, 0, 0); cnt.push(0); cu.push(new Map()); }
    cid[v] = c;
    cnt[c]++;
    for (let k = 0; k < 3; k++) { sp[c * 3 + k] += P[v * 3 + k]; sn[c * 3 + k] += N[v * 3 + k]; }
    for (const [u, w] of CAND[v]) {
      const q = `${Math.round(u * 40)},${Math.round(w * 40)}`;
      const e = cu[c].get(q);
      if (e) { e[0] += u; e[1] += w; e[2]++; } else cu[c].set(q, [u, w, 1]);
    }
  }
  const nP = [], nN = [], nC = [];
  for (let c = 0; c < cnt.length; c++) {
    nP.push(sp[c * 3] / cnt[c], sp[c * 3 + 1] / cnt[c], sp[c * 3 + 2] / cnt[c]);
    const l = Math.hypot(sn[c * 3], sn[c * 3 + 1], sn[c * 3 + 2]) || 1;
    nN.push(sn[c * 3] / l, sn[c * 3 + 1] / l, sn[c * 3 + 2] / l);
    nC.push([...cu[c].values()].map(([u, w, n]) => [u / n, w / n]));
  }
  const seen = new Set();
  const nT = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = cid[tris[t]], b = cid[tris[t + 1]], c = cid[tris[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    nT.push(a, b, c);
  }
  P = nP; N = nN; CAND = nC; tris = nT;
  console.log(`clustered: ${P.length / 3} vertices, ${tris.length / 3} triangles`);
}

// ------------------------------------------------------------------ decimate
await MeshoptSimplifier.ready;
const pos0 = new Float32Array(P);
const [simp, err] = MeshoptSimplifier.simplify(new Uint32Array(tris), pos0, 3, TARGET_TRIS * 3, 0.1);
console.log(`simplified: ${simp.length / 3} triangles (error ${err.toFixed(5)})`);
// Rebuild vertices per (welded vertex, UV candidate): for each triangle take the three UVs that sit closest together, which
// keeps it inside one UV island.
const used = new Map();
const pos = [], nor = [], uv = [];
const indices = [];
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

// ------------------------------------------------------------------ skeleton (metres, Y up, facing +Z; her left is +X)
// Measured off the scan in its own walking pose. Hips are placed symmetrically about the pelvis so that bodyModel's yaw
// (taken from the hip line) is a clean 0, and the stride is straightened later by its limb aiming.
const J = {
  Hips: [-0.05, 0.86, 0.02],
  Spine: [-0.06, 1.0, -0.02],
  Spine1: [-0.07, 1.2, -0.03],
  Neck: [-0.09, 1.38, -0.03],
  Head: [-0.11, 1.46, -0.02],
  HeadTop: [-0.12, 1.74, -0.02],
  LeftShoulder: [-0.05, 1.34, -0.03],
  LeftArm: [0.14, 1.32, -0.03],
  LeftForeArm: [0.22, 1.05, -0.04],
  LeftHand: [0.21, 0.84, -0.03],
  LeftHandMiddle1: [0.2, 0.74, -0.02],
  RightShoulder: [-0.11, 1.34, -0.03],
  RightArm: [-0.2, 1.32, -0.03],
  RightForeArm: [-0.24, 1.05, -0.04],
  RightHand: [-0.25, 0.8, -0.02],
  RightHandMiddle1: [-0.26, 0.7, -0.02],
  LeftUpLeg: [0.03, 0.84, 0.02],
  LeftLeg: [0.01, 0.45, 0.1],
  LeftFoot: [0.118, 0.1, -0.045],
  LeftToeBase: [0.09, 0.035, 0.05],
  LeftToeEnd: [0.075, 0.02, 0.13],
  RightUpLeg: [-0.13, 0.84, 0.02],
  RightLeg: [-0.085, 0.45, -0.05],
  RightFoot: [-0.045, 0.1, -0.05],
  RightToeBase: [-0.11, 0.035, 0.03],
  RightToeEnd: [-0.125, 0.02, 0.1],
};
// name: [parent, segment end (null: a short stub), radius in metres]
const BONES = {
  Hips: [null, 'Spine', 0.2],
  Spine: ['Hips', 'Spine1', 0.2],
  Spine1: ['Spine', 'Neck', 0.22],
  Neck: ['Spine1', 'Head', 0.07],
  Head: ['Neck', 'HeadTop', 0.15],
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
// Bones that carry skin (the end markers and the head-top point are only there to aim and to size segments).
const names = Object.keys(BONES).filter((n) => !n.endsWith('ToeEnd'));
const boneIndex = new Map(names.map((n, i) => [n, i]));
const segment = (n) => {
  const [, end] = BONES[n];
  const a = J[n];
  if (end) return [a, J[end]];
  // No end bone: a short stub continuing the parent's direction.
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
// Per welded position (so UV seams do not split the weights): softmax over -(distance / radius), then smoothed over the mesh.
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
const SHARP = Number(process.env.SHARP ?? 7);
for (let w = 0; w < nW; w++) {
  const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
  const s = segs.map((sg, b) => distToSegment(x, y, z, sg) / rad[b]);
  const best = Math.min(...s);
  let sum = 0;
  for (let b = 0; b < NB; b++) { const e = Math.exp(-(s[b] - best) * SHARP); W[w * NB + b] = e; sum += e; }
  for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
}
// Laplacian smoothing over the mesh edges.
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
// Keep the four heaviest bones per vertex, renormalised.
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
nodes.push({ name: 'Priya', mesh: 0, skin: 0 });
const ibm = new Float32Array(NB * 16);
names.forEach((n, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1], i * 16));

// ------------------------------------------------------------------ texture
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'priya-'));
const texBv = j.bufferViews[j.images[j.textures[j.materials[BODY_MATERIAL].pbrMetallicRoughness.baseColorTexture.index].source].bufferView];
const inp = path.join(tmp, 'in.png');
const out = path.join(tmp, 'out.jpg');
fs.writeFileSync(inp, bin.subarray(texBv.byteOffset ?? 0, (texBv.byteOffset ?? 0) + texBv.byteLength));
execFileSync('convert', [inp, '-resize', '1024x1024>', '-quality', '86', '-sampling-factor', '4:2:0', '-strip', out]);
const colorTex = fs.readFileSync(out);
fs.rmSync(tmp, { recursive: true, force: true });

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
const imgView = push(colorTex);
const glbJson = {
  asset: { version: '2.0', generator: 'scripts/fix-priya-glb.mjs', extras: j.asset.extras },
  scene: 0,
  scenes: [{ nodes: [boneIndex.get('Hips'), meshNode] }],
  nodes,
  meshes: [{ name: 'Priya', primitives: [{ attributes: attrs, indices: idx, material: 0 }] }],
  skins: [{ joints: names.map((_, i) => i), inverseBindMatrices: ibmAcc, skeleton: boneIndex.get('Hips') }],
  materials: [{ name: 'skin', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
  textures: [{ sampler: 0, source: 0 }],
  samplers: j.samplers,
  images: [{ bufferView: imgView, mimeType: 'image/jpeg' }],
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

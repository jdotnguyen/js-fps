// Slims the "zombie_game_character" GLB (Mixamo-named 41-bone rig, three skinned body chunks of ~305k triangles) for use as a crowd
// body (ADR-0026). Expects a copy already stripped to its skinned chunks with UV set 0 only and JPEG textures (the first stage is
// a plain GLB rewrite: drop unskinned meshes, extra UV sets and tangents, re-encode textures); this script decimates each chunk with
// meshoptimizer and rewrites the vertex data compactly. Bones, skin, materials and textures are kept as they are.
//   node scripts/fix-gamechar-glb.mjs <stage1.glb> [public/assets/models/infected/gamechar.glb] [targetTrianglesTotal]
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

const [src, dst = 'public/assets/models/infected/gamechar.glb', totalArg = '16000'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-gamechar-glb.mjs <stage1.glb> [out.glb] [targetTriangles]');
const d = fs.readFileSync(src);
const jl = d.readUInt32LE(12);
const json = JSON.parse(d.subarray(20, 20 + jl).toString('utf8'));
const bin = d.subarray(20 + jl + 8);
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(ai) {
  const a = json.accessors[ai];
  const bv = json.bufferViews[a.bufferView];
  const [T, sz] = CT[a.componentType];
  const n = NC[a.type];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const copy = bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * sz);
  return { data: new T(copy), n, a };
}
await MeshoptSimplifier.ready;

const prims = json.meshes.flatMap((m) => m.primitives);
const totalTris = prims.reduce((s, p) => s + json.accessors[p.indices].count / 3, 0);
const budget = Number(totalArg);
const out = []; // per primitive: attribute arrays + indices
for (const p of prims) {
  const pos = read(p.attributes.POSITION).data;
  const nor = read(p.attributes.NORMAL).data;
  const uv = read(p.attributes.TEXCOORD_0).data;
  const jr = read(p.attributes.JOINTS_0);
  const wr = read(p.attributes.WEIGHTS_0);
  const idx = Uint32Array.from(read(p.indices).data);
  const target = Math.max(300, Math.round((idx.length / 3 / totalTris) * budget));
  // Borders free: the chunks are many small islands, locking them keeps ~3x the budget.
  const [simp, err] = MeshoptSimplifier.simplify(idx, pos, 3, target * 3, 0.3, []);
  console.log(`chunk: ${idx.length / 3} -> ${simp.length / 3} triangles (target ${target}, error ${err.toFixed(4)})`);
  // Compact the vertices actually used.
  const map = new Map();
  const keep = [];
  const newIdx = new Uint32Array(simp.length);
  for (let i = 0; i < simp.length; i++) {
    let m = map.get(simp[i]);
    if (m === undefined) { m = keep.length; map.set(simp[i], m); keep.push(simp[i]); }
    newIdx[i] = m;
  }
  const pick = (arr, n) => { const o = new arr.constructor(keep.length * n); keep.forEach((v, i) => { for (let k = 0; k < n; k++) o[i * n + k] = arr[v * n + k]; }); return o; };
  out.push({ pos: pick(pos, 3), nor: pick(nor, 3), uv: pick(uv, 2), joints: pick(jr.data, 4), jType: jr.a.componentType, weights: pick(wr.data, 4), wType: wr.a.componentType, wNorm: !!wr.a.normalized, idx: newIdx, p });
}

// Rebuild buffer: keep non-geometry bufferViews (images, IBM) from the source, append new geometry.
const parts = [];
let len = 0;
function add(buf) { while (len % 4) { parts.push(Buffer.alloc(1)); len++; } const o = len; parts.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)); len += buf.byteLength; return o; }
const geom = new Set();
for (const p of prims) { for (const a of Object.values(p.attributes)) geom.add(json.accessors[a].bufferView); geom.add(json.accessors[p.indices].bufferView); }
const bvMap = new Map();
const newBV = [];
json.bufferViews.forEach((bv, i) => {
  if (geom.has(i)) return;
  const o = add(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  bvMap.set(i, newBV.length);
  newBV.push({ buffer: 0, byteOffset: o, byteLength: bv.byteLength });
});
const oldAcc = json.accessors;
const newAcc = [];
const accMap = new Map();
oldAcc.forEach((a, i) => { if (geom.has(a.bufferView)) return; accMap.set(i, newAcc.length); newAcc.push({ ...a, bufferView: bvMap.get(a.bufferView) }); });
function pushAcc(typed, componentType, type, count, extra = {}, target) {
  const o = add(typed);
  newBV.push({ buffer: 0, byteOffset: o, byteLength: typed.byteLength, ...(target ? { target } : {}) });
  newAcc.push({ bufferView: newBV.length - 1, componentType, type, count, ...extra });
  return newAcc.length - 1;
}
for (const o of out) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < o.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], o.pos[i + k]); mx[k] = Math.max(mx[k], o.pos[i + k]); }
  const vc = o.pos.length / 3;
  const small = vc <= 65535;
  o.p.attributes = {
    POSITION: pushAcc(o.pos, 5126, 'VEC3', vc, { min: mn, max: mx }, 34962),
    NORMAL: pushAcc(o.nor, 5126, 'VEC3', vc, {}, 34962),
    TEXCOORD_0: pushAcc(o.uv, 5126, 'VEC2', vc, {}, 34962),
    JOINTS_0: pushAcc(o.joints, o.jType, 'VEC4', vc, {}, 34962),
    WEIGHTS_0: pushAcc(o.weights, o.wType, 'VEC4', vc, o.wNorm ? { normalized: true } : {}, 34962),
  };
  o.p.indices = pushAcc(small ? Uint16Array.from(o.idx) : o.idx, small ? 5123 : 5125, 'SCALAR', o.idx.length, {}, 34963);
}
for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
json.accessors = newAcc;
json.bufferViews = newBV;
for (const im of json.images ?? []) im.bufferView = bvMap.get(im.bufferView);
while (len % 4) { parts.push(Buffer.alloc(1)); len++; }
json.buffers = [{ byteLength: len }];
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const body = Buffer.concat(parts);
const head = Buffer.alloc(12 + 8);
head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8); head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
const binHead = Buffer.alloc(8); binHead.writeUInt32LE(body.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, Buffer.concat([head, js, binHead, body]));
console.log('wrote', dst, ((12 + 8 + js.length + 8 + body.length) / 1e6).toFixed(2), 'MB');

// Prepares the Sketchfab "BS-V1 Cyborg" GLB (Blue Spirit, CC-BY 4.0) for bodyModel.ts (ADR-0026) as Katie Heins' body.
//   node scripts/fix-heins-glb.mjs <source.glb> [public/assets/models/squad/heins.glb]
// The source is a 35 MB unrigged, unanimated A-pose mesh (~147k triangles, 16 meshes, 10 materials, 35 PNG textures incl. emissive and
// metallic-roughness maps, a Z-up root node with scale 0.99). There is no skeleton and no baked clip, so the game's procedural animator
// drives it like every other body.
// What it does (35 MB -> ~2 MB):
//   - bakes the root transform into Y-up metres with feet at y = 0, facing +Z, and drops the empty 2-index placeholder mesh;
//   - groups the meshes by material (Cyber_Arm/Cyber_Hand/Shoes were split over several meshes), welds each group by (position, UV)
//     and decimates it to its own triangle budget with meshoptimizer so the face, hands and strand cards keep more than the jacket;
//   - builds a Mixamo-named 26-bone skeleton from the J table below (measured off the mesh, which is left/right symmetric) and computes
//     smooth skin weights; bodyModel.ts then straightens the bent arms from those bones like any rigged model;
//   - adds a Jaw bone: Head-material vertices in the lower lip / chin zone and the lower teeth are weighted to it so her mouth opens
//     when she speaks (ADR-0027). The jacket collar sits at the same height, so the mask never touches it;
//   - drops TANGENT, emissive, metallic-roughness and the eyes'/teeth's normal and specular maps (bodyMaterial.ts only uses
//     baseColor + normal) and re-encodes the textures as resized JPEGs. The hair colour map keeps its alpha channel as a PNG because
//     the strand cards are alpha-tested.
// Uses ImageMagick (`convert`/`magick`) and `meshoptimizer` from node_modules.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';
import { rigHands, splitHands } from './lib/hand-rig.mjs';

const [src, dst = 'public/assets/models/squad/heins.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-heins-glb.mjs <source.glb> [out.glb]');
const SCALE = Number(process.env.BUDGET_SCALE ?? 1);

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

// ------------------------------------------------------------------ group meshes by material, bake transforms
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

// Triangle budgets per material (source total ~147k). Faces, hands and hair cards get a larger share than flat cloth.
const BUDGET = {
  Aver: 3200, Body: 700, Cyber_Arm: 1500, Cyber_Hand: 1500, Eyes: 500, Hair: 6000,
  Head: 3200, Shirt_and_pants: 3000, Shoes: 2400, Teeth: 400,
};
const OUT_NAME = {
  Aver: 'jacket', Body: 'skin_body', Cyber_Arm: 'cyber_arm', Cyber_Hand: 'cyber_hand', Eyes: 'eyes', Hair: 'hair',
  Head: 'head', Shirt_and_pants: 'clothes', Shoes: 'shoes', Teeth: 'teeth',
};

await MeshoptSimplifier.ready;
const groups = []; // { mat, name, pos[], nor[], uv[], idx[] } after decimation
for (const matIdx of [...new Set(meshNodes.map((m) => m.mat))]) {
  const matName = j.materials[matIdx].name;
  const vertMap = new Map();
  const P = [], N = [], UV = [], tris = [];
  for (const { ni, prim } of meshNodes.filter((m) => m.mat === matIdx)) {
    const m = world(ni);
    const pos = read(prim.attributes.POSITION);
    const nor = read(prim.attributes.NORMAL);
    const uv = read(prim.attributes.TEXCOORD_0);
    const idx = read(prim.indices);
    const remap = new Int32Array(pos.length / 3).fill(-1);
    const vertex = (v) => {
      if (remap[v] >= 0) return remap[v];
      const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}|${uv[v * 2].toFixed(5)},${uv[v * 2 + 1].toFixed(5)}`;
      let id = vertMap.get(key);
      if (id === undefined) {
        id = P.length / 3;
        vertMap.set(key, id);
        const [x, y, z] = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
        P.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13] - minY, m[2] * x + m[6] * y + m[10] * z + m[14]);
        const [nx, ny, nz] = [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]];
        const wx = m[0] * nx + m[4] * ny + m[8] * nz, wy = m[1] * nx + m[5] * ny + m[9] * nz, wz = m[2] * nx + m[6] * ny + m[10] * nz;
        const l = Math.hypot(wx, wy, wz) || 1;
        N.push(wx / l, wy / l, wz / l);
        UV.push(uv[v * 2], uv[v * 2 + 1]);
      }
      remap[v] = id;
      return id;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = vertex(idx[t]), b = vertex(idx[t + 1]), c = vertex(idx[t + 2]);
      if (a !== b && b !== c && a !== c) tris.push(a, b, c);
    }
  }
  const before = tris.length / 3;
  const target = Math.round(BUDGET[matName] * SCALE);
  let simp = new Uint32Array(tris);
  let err = 0;
  if (before > target) [simp, err] = MeshoptSimplifier.simplify(simp, new Float32Array(P), 3, target * 3, matName === 'Hair' ? 0.25 : 0.1);
  // compact
  const used = new Int32Array(P.length / 3).fill(-1);
  const g = { matIdx, name: matName, pos: [], nor: [], uv: [], idx: [] };
  for (let i = 0; i < simp.length; i++) {
    const v = simp[i];
    if (used[v] < 0) {
      used[v] = g.pos.length / 3;
      g.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      g.nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      g.uv.push(UV[v * 2], UV[v * 2 + 1]);
    }
    g.idx.push(used[v]);
  }
  g.count = g.pos.length / 3;
  if (g.count > 65535) throw new Error(`${matName}: too many vertices for u16 indices (${g.count})`);
  console.log(`${matName.padEnd(16)} ${String(before).padStart(6)} -> ${String(g.idx.length / 3).padStart(5)} tris, ${g.count} verts (err ${err.toFixed(4)})`);
  groups.push(g);
}
const totalTris = groups.reduce((s, g) => s + g.idx.length / 3, 0);

// ------------------------------------------------------------------ skeleton (metres, Y up, facing +Z; left is +X)
// Measured off the mesh (height 1.83 m with hair; face front z = 0.13, mouth line y = 1.60). The mesh is symmetric about x = 0.
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
  Head: [0, 1.55, -0.015],
  HeadTop: [0, 1.81, 0.02],
  // Jaw hinge under the ear; chin tip at y = 1.545, z = 0.107; teeth span y 1.572..1.624, z 0.03..0.11.
  Jaw: [0, 1.655, -0.005],
  JawEnd: [0, 1.545, 0.1],
};
for (const [k, v] of Object.entries(L)) {
  J[k] = v;
  J[k.replace('Left', 'Right')] = [-v[0], v[1], v[2]];
}
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

// ------------------------------------------------------------------ skin weights (welded across all groups so seams stay closed)
let NB = names.length;
const weldKey = new Map();
const weldOf = groups.map((g) => {
  const a = new Int32Array(g.count);
  for (let v = 0; v < g.count; v++) {
    const key = `${g.pos[v * 3].toFixed(5)},${g.pos[v * 3 + 1].toFixed(5)},${g.pos[v * 3 + 2].toFixed(5)}`;
    let w = weldKey.get(key);
    if (w === undefined) { w = weldKey.size; weldKey.set(key, w); }
    a[v] = w;
  }
  return a;
});
const nW = weldKey.size;
let wPos = new Float32Array(nW * 3);
groups.forEach((g, gi) => { for (let v = 0; v < g.count; v++) wPos.set(g.pos.slice(v * 3, v * 3 + 3), weldOf[gi][v] * 3); });
let W = new Float32Array(nW * NB);
const SHARP = Number(process.env.SHARP ?? 8);
const bi = (n) => boneIndex.get(n);
const armSet = new Set(['Arm', 'ForeArm', 'Hand', 'HandMiddle1'].flatMap((n) => [bi(`Left${n}`), bi(`Right${n}`)]));
const trunkSet = new Set(['Hips', 'Spine', 'Spine1', 'Neck', 'Head', 'Jaw'].map(bi));
for (let w = 0; w < nW; w++) {
  const x = wPos[w * 3], y = wPos[w * 3 + 1];
  const ax = Math.abs(x);
  const s = segs.map((sg, b) => {
    let score = distToSegment(x, y, wPos[w * 3 + 2], sg) / rad[b];
    // Sleeves (outside the torso line) belong to the arms; the torso flank and collar belong to the trunk.
    if (ax > 0.27 && y < 1.42 && trunkSet.has(b)) score += 3;
    if (ax < 0.19 && y < 1.5 && armSet.has(b)) score += 3;
    return score;
  });
  const best = Math.min(...s);
  let sum = 0;
  for (let b = 0; b < NB; b++) { const e = Math.exp(-(s[b] - best) * SHARP); W[w * NB + b] = e; sum += e; }
  for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
}
// Laplacian smoothing over mesh edges
let nbrs = Array.from({ length: nW }, () => new Set());
groups.forEach((g, gi) => {
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = weldOf[gi][g.idx[t]], b = weldOf[gi][g.idx[t + 1]], c = weldOf[gi][g.idx[t + 2]];
    nbrs[a].add(b).add(c); nbrs[b].add(a).add(c); nbrs[c].add(a).add(b);
  }
});
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
// Finger chains and forearm twist bones (per-character-motion D7): added after the body's own weights, from the hand mesh, once
// the fingers that touch in the scan (her right thumb rests on her index finger) are cut apart.
{
  const parts = groups.map((g, gi) => ({ pos: g.pos, nor: g.nor, uv: g.uv, indices: g.idx, weldOf: weldOf[gi] }));
  const cut = splitHands({ parts, W, wPos, names, J, nbrs });
  ({ W, wPos, nbrs } = cut);
  parts.forEach((p, gi) => {
    weldOf[gi] = p.weldOf;
    groups[gi].count = p.pos.length / 3;
    if (groups[gi].count > 65535) throw new Error(`${groups[gi].name}: too many vertices for u16 indices (${groups[gi].count})`);
  });
  const hands = rigHands({ W, wPos, names, J, nbrs, plans: cut.plans, parentOf: Object.fromEntries(names.map((n) => [n, BONES[n][0]])) });
  W = hands.W;
  names = hands.names;
  NB = names.length;
  boneIndex = new Map(names.map((n, i) => [n, i]));
  Object.assign(J, hands.J);
  for (const n of hands.added) BONES[n] = [hands.parentOf[n], null, 0.02];
}
// Jaw mask, applied after smoothing and only to face skin and teeth (the collar at the same height must not follow the jaw).
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const JAW = { mouthY: 1.6, chinY: 1.548, hingeZ: J.Jaw[2] };
const faceMask = (x, y, z) =>
  smooth(JAW.mouthY + 0.012, JAW.mouthY - 0.008, y) * smooth(JAW.chinY - 0.025, JAW.chinY + 0.004, y) *
  smooth(JAW.hingeZ + 0.03, JAW.hingeZ + 0.07, z) * smooth(0.07, 0.04, Math.abs(x));
const jawB = bi('Jaw');
// Applied per vertex below (a weld id can be shared with collar vertices at the same position).
const packGroup = (g, gi) => {
  const joints = new Uint8Array(g.count * 4);
  const weights = new Uint16Array(g.count * 4);
  const useJaw = g.name === 'Head' || g.name === 'Teeth';
  const row = new Float32Array(NB);
  for (let v = 0; v < g.count; v++) {
    const w = weldOf[gi][v];
    for (let b = 0; b < NB; b++) row[b] = W[w * NB + b];
    if (useJaw) {
      const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
      const m = g.name === 'Teeth' ? smooth(1.602, 1.594, y) : faceMask(x, y, z);
      if (m > 0) { for (let b = 0; b < NB; b++) row[b] *= 1 - m; row[jawB] += m; }
    }
    const top = Array.from(row, (val, b) => [b, val]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, t) => s + t[1], 0) || 1;
    const q = top.map((t) => Math.round((t[1] / sum) * 65535));
    q[0] += 65535 - q.reduce((s, x) => s + x, 0);
    top.forEach((t, k) => { joints[v * 4 + k] = t[0]; weights[v * 4 + k] = q[k]; });
  }
  return { joints, weights };
};
const skinned = groups.map(packGroup);

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

// ------------------------------------------------------------------ textures
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heins-'));
const srcImg = (texIdx) => j.textures[texIdx].source;
const matSrc = (name) => j.materials.find((m) => m.name === name);
const texJobs = []; // { key, img, size, q, png }
const want = (matName, kind, size, q, png = false, recolor = false) => {
  const m = matSrc(matName);
  const t = kind === 'c' ? m.pbrMetallicRoughness?.baseColorTexture : m.normalTexture;
  if (t) texJobs.push({ key: `${OUT_NAME[matName]}_${kind}`, img: srcImg(t.index), size, q, png, recolor });
};
want('Aver', 'c', 512, 82); want('Aver', 'n', 256, 84);
want('Body', 'c', 512, 82); want('Body', 'n', 256, 84);
want('Cyber_Arm', 'c', 512, 84); want('Cyber_Arm', 'n', 256, 84);
want('Cyber_Hand', 'c', 512, 84); want('Cyber_Hand', 'n', 256, 84);
want('Eyes', 'c', 256, 84);
// Heins' hair is purple (docs/characters.md): the source atlas is black roots fading to green tips, so its brightness becomes a
// root-to-tip purple -> blue gradient and the strand lines and alpha stay as they were.
const HAIR_GRADIENT = (process.env.HAIR_GRADIENT ?? '#1c0a3d,#7a2fd0,#4f8cff').split(',');
want('Hair', 'c', 512, 0, true, HAIR_GRADIENT[0] !== 'off');
want('Head', 'c', 768, 84); want('Head', 'n', 512, 86);
want('Shirt_and_pants', 'c', 512, 82); want('Shirt_and_pants', 'n', 256, 84);
want('Shoes', 'c', 512, 82); want('Shoes', 'n', 256, 84);
want('Teeth', 'c', 128, 80);
const convertBin = (() => {
  for (const bin of ['convert', 'magick']) {
    try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return bin; } catch {}
  }
  return null;
})();
const texBytes = new Map();
let texTotal = 0;
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
      execFileSync(convertBin, [f('gray'), f('grad'), '-clut', f('alpha'), '-compose', 'CopyOpacity', '-composite', '-resize', `${t.size}x${t.size}>`, '-strip', '-define', 'png:compression-level=9', `PNG32:${out}`]);
    } else {
      const args = t.png
        ? [inp, '-resize', `${t.size}x${t.size}>`, '-strip', '-define', 'png:compression-level=9', `PNG32:${out}`]
        : [inp, '-background', 'white', '-alpha', 'remove', '-resize', `${t.size}x${t.size}>`, '-quality', String(t.q), '-sampling-factor', '4:2:0', '-strip', out];
      execFileSync(convertBin, args);
    }
    const b = fs.readFileSync(out);
    texBytes.set(t.key, { bytes: b, png: t.png });
    texTotal += b.length;
  }
} else if (process.platform === 'win32') {
  const jobs = texJobs.map((t) => {
    const im = j.images[t.img];
    const bv = j.bufferViews[im.bufferView];
    const inp = path.join(tmp, `${t.key}_in.${im.mimeType === 'image/png' ? 'png' : 'jpg'}`);
    const out = path.join(tmp, `${t.key}.${t.png ? 'png' : 'jpg'}`);
    fs.writeFileSync(inp, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    return { key: t.key, inp, out, size: t.size, q: t.q, png: t.png, recolor: t.recolor };
  });
  const manifest = path.join(tmp, 'jobs.json');
  fs.writeFileSync(manifest, JSON.stringify(jobs));
  const gradHex = JSON.stringify(HAIR_GRADIENT);
  const ps = path.join(tmp, 'resize.ps1');
  fs.writeFileSync(ps, `
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$qParam = [System.Drawing.Imaging.Encoder]::Quality
$grad = ('${gradHex}' | ConvertFrom-Json) | ForEach-Object { [System.Drawing.ColorTranslator]::FromHtml($_) }
$jobs = Get-Content -Raw '${manifest.replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($job in $jobs) {
  $src = [System.Drawing.Bitmap]::new($job.inp)
  $s = [Math]::Min(1.0, [double]$job.size / [Math]::Max($src.Width, $src.Height))
  $w = [Math]::Max(1, [int][Math]::Round($src.Width * $s))
  $h = [Math]::Max(1, [int][Math]::Round($src.Height * $s))
  $fmt = if ($job.png) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $dst = [System.Drawing.Bitmap]::new($w, $h, $fmt)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if (-not $job.png) { $g.Clear([System.Drawing.Color]::White) }
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose(); $src.Dispose()
  if ($job.recolor -and $grad.Count -ge 2) {
    $minL = 255.0; $maxL = 0.0
    for ($y = 0; $y -lt $h; $y++) {
      for ($x = 0; $x -lt $w; $x++) {
        $p = $dst.GetPixel($x, $y)
        $l = 0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B
        if ($l -lt $minL) { $minL = $l }; if ($l -gt $maxL) { $maxL = $l }
      }
    }
    $span = [Math]::Max(1.0, $maxL - $minL)
    for ($y = 0; $y -lt $h; $y++) {
      for ($x = 0; $x -lt $w; $x++) {
        $p = $dst.GetPixel($x, $y)
        $t = [Math]::Max(0.0, [Math]::Min(1.0, (0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B - $minL) / $span)) * ($grad.Count - 1)
        $i = [Math]::Min($grad.Count - 2, [int][Math]::Floor($t))
        $f = $t - $i
        $c0 = $grad[$i]; $c1 = $grad[$i + 1]
        $r = [int][Math]::Round($c0.R + ($c1.R - $c0.R) * $f)
        $gg = [int][Math]::Round($c0.G + ($c1.G - $c0.G) * $f)
        $b = [int][Math]::Round($c0.B + ($c1.B - $c0.B) * $f)
        $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($p.A, $r, $gg, $b))
      }
    }
  }
  if ($job.png) {
    $dst.Save($job.out, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    $ep = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $ep.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new($qParam, [long]$job.q)
    $dst.Save($job.out, $codec, $ep); $ep.Dispose()
  }
  $dst.Dispose()
}
`);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps]);
  for (const job of jobs) {
    const b = fs.readFileSync(job.out);
    texBytes.set(job.key, { bytes: b, png: job.png });
    texTotal += b.length;
  }
} else {
  throw new Error('ImageMagick (convert or magick) is required on non-Windows platforms');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`textures: ${texJobs.length} images, ${(texTotal / 1024).toFixed(0)} KB total`);

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
  const idx = acc(push(Buffer.from(Uint16Array.from(g.idx).buffer), { target: 34963 }), 5123, 'SCALAR', g.idx.length);
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
console.log('wrote', dst, `${(glb.length / 1024).toFixed(0)} KB, ${totalTris} triangles, ${NB} bones, ${groups.length} meshes`);

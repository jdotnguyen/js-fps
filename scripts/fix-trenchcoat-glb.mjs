// Prepares the Sketchfab "Lady in a trenchcoat" GLB (Mixamo rig, 6 skinned meshes, 2 duplicate copies in one file) for bodyModel.ts
// (ADR-0026) as the admin assistant's body.
//   node scripts/fix-trenchcoat-glb.mjs <source.glb> [public/assets/models/crew/assistant.glb]
// What it does (6.1 MB -> ~1 MB):
//   - drops the second, duplicated copy of the character (own armature, meshes and skin, offset 2 m to the side) and every node, mesh,
//     material and image only that copy used;
//   - drops tangents, TEXCOORD_1..3, metallic-roughness maps and the normal maps (the author set their scale to 0 on the body and hair);
//   - repacks vertex buffers (u16 indices, normalised u16 weights) and re-encodes the textures resized: opaque ones as JPEG, the hair and
//     eyelash sheet (alphaMode BLEND, which bodyModel.ts turns into an alpha-tested cut-out) as a resized PNG so its alpha survives.
// Bone names (`mixamorig:Hips_64`...) and the node hierarchy are left alone (the exporter's `*_rootJoint` wrapper bone stays in the skin: taking it out blows up the hair, eyes and shoes; bodyModel.ts just logs it as unmapped): bodyModel.ts maps and re-poses them itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [src, dst = 'public/assets/models/crew/assistant.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-trenchcoat-glb.mjs <source.glb> [out.glb]');

// ------------------------------------------------------------------ read source GLB
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);
const COMP = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
function read(ai) {
  const a = j.accessors[ai];
  const bv = j.bufferViews[a.bufferView];
  const [size, fn] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride ?? size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv[fn](base + i * stride + k * size, true);
  return out;
}

// ------------------------------------------------------------------ keep one copy of the character
// The file holds the character twice under GLTF_SceneRootNode: the first child is the real armature, the second a duplicate.
const rootIdx = j.nodes.findIndex((n) => n.name === 'GLTF_SceneRootNode');
if (rootIdx < 0 || j.nodes[rootIdx].children.length < 2) console.warn('expected two copies under GLTF_SceneRootNode; keeping everything reachable');
else j.nodes[rootIdx].children = [j.nodes[rootIdx].children[0]];

const nodeMap = new Map(); // old -> new
const keepNodes = [];
(function walk(i) {
  nodeMap.set(i, keepNodes.length);
  keepNodes.push(i);
  for (const c of j.nodes[i].children ?? []) walk(c);
})(j.scenes[j.scene ?? 0].nodes[0]);
const skinOld = keepNodes.map((i) => j.nodes[i].skin).find((s) => s !== undefined);
const meshOldList = [...new Set(keepNodes.map((i) => j.nodes[i].mesh).filter((m) => m !== undefined))];
const meshMap = new Map(meshOldList.map((m, k) => [m, k]));
const skinSrc = j.skins[skinOld];

// ------------------------------------------------------------------ buffers
const chunks = [];
let total = 0;
const bufferViews = [];
const accessors = [];
function addView(buf, target) {
  const pad = (4 - (total % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); total += pad; }
  bufferViews.push({ buffer: 0, byteOffset: total, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf);
  total += buf.length;
  return bufferViews.length - 1;
}
function addAccessor(typed, componentType, type, target, extra = {}) {
  const bv = addView(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), target);
  accessors.push({ bufferView: bv, componentType, count: typed.length / NCOMP[type], type, ...extra });
  return accessors.length - 1;
}

// materials actually used by the kept meshes
const matOldList = [...new Set(meshOldList.flatMap((mi) => j.meshes[mi].primitives.map((p) => p.material)))];
const matMap = new Map(matOldList.map((m, k) => [m, k]));

const meshes = meshOldList.map((mi) => ({
  name: j.meshes[mi].name,
  primitives: j.meshes[mi].primitives.map((p) => {
    const pos = Float32Array.from(read(p.attributes.POSITION));
    const nor = Float32Array.from(read(p.attributes.NORMAL));
    const nv = pos.length / 3;
    const jr = read(p.attributes.JOINTS_0);
    const wr = read(p.attributes.WEIGHTS_0);
    const joints = new Uint8Array(nv * 4);
    const weights = new Uint16Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += wr[v * 4 + k];
      let q = 0, big = 0;
      for (let k = 0; k < 4; k++) {
        joints[v * 4 + k] = jr[v * 4 + k];
        weights[v * 4 + k] = Math.round((wr[v * 4 + k] / (sum || 1)) * 65535);
        q += weights[v * 4 + k];
        if (weights[v * 4 + k] > weights[v * 4 + big]) big = k;
      }
      weights[v * 4 + big] += 65535 - q;
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[v * 3 + k]); max[k] = Math.max(max[k], pos[v * 3 + k]); }
    const idxSrc = read(p.indices);
    const idx = nv < 65536 ? Uint16Array.from(idxSrc) : Uint32Array.from(idxSrc);
    const attributes = {
      POSITION: addAccessor(pos, 5126, 'VEC3', 34962, { min, max }),
      NORMAL: addAccessor(nor, 5126, 'VEC3', 34962),
      TEXCOORD_0: addAccessor(Float32Array.from(read(p.attributes.TEXCOORD_0)), 5126, 'VEC2', 34962),
      JOINTS_0: addAccessor(joints, 5121, 'VEC4', 34962),
      WEIGHTS_0: addAccessor(weights, 5123, 'VEC4', 34962, { normalized: true }),
    };
    return { attributes, indices: addAccessor(idx, nv < 65536 ? 5123 : 5125, 'SCALAR', 34963), material: matMap.get(p.material), mode: p.mode ?? 4 };
  }),
}));

// inverse bind matrices
const ibm = Float32Array.from(read(skinSrc.inverseBindMatrices));
const newSkin = {
  joints: skinSrc.joints.map((n) => nodeMap.get(n)),
  inverseBindMatrices: addAccessor(ibm, 5126, 'MAT4'),
  ...(skinSrc.skeleton !== undefined ? { skeleton: nodeMap.get(skinSrc.skeleton) } : {}),
};

// nodes
const nodes = keepNodes.map((oi) => {
  const o = { ...j.nodes[oi] };
  if (o.children) o.children = o.children.map((c) => nodeMap.get(c));
  if (o.mesh !== undefined) o.mesh = meshMap.get(o.mesh);
  if (o.skin !== undefined) o.skin = 0;
  return o;
});

// ------------------------------------------------------------------ materials and textures (base colour only)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcl-'));
const newImages = [];
const imgCache = new Map(); // old image index + settings -> new image index
function encode(imageIdx, size, alpha) {
  const key = `${imageIdx}:${size}:${alpha}`;
  if (imgCache.has(key)) return imgCache.get(key);
  const bv = j.bufferViews[j.images[imageIdx].bufferView];
  const raw = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const inp = path.join(tmp, `in${imageIdx}`);
  fs.writeFileSync(inp, raw);
  let outp, mime;
  if (alpha) {
    outp = path.join(tmp, `out${imageIdx}.png`);
    mime = 'image/png';
    execFileSync('convert', [inp, '-resize', `${size}x${size}>`, '-strip', '-define', 'png:compression-level=9', outp]);
  } else {
    outp = path.join(tmp, `out${imageIdx}.jpg`);
    mime = 'image/jpeg';
    execFileSync('convert', [inp, '-background', 'white', '-alpha', 'remove', '-resize', `${size}x${size}>`, '-strip', '-sampling-factor', '4:2:0', '-quality', '84', outp]);
  }
  const buf = fs.readFileSync(outp);
  newImages.push({ bufferView: addView(buf), mimeType: mime });
  imgCache.set(key, newImages.length - 1);
  return newImages.length - 1;
}
const mats = matOldList.map((mo) => {
  const m = j.materials[mo];
  const pbr = m.pbrMetallicRoughness ?? {};
  const cut = m.alphaMode === 'BLEND' || m.alphaMode === 'MASK';
  const out = {
    name: m.name,
    doubleSided: true,
    ...(cut ? { alphaMode: 'MASK', alphaCutoff: 0.5 } : {}),
    pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.8, ...(pbr.baseColorFactor ? { baseColorFactor: pbr.baseColorFactor } : {}) },
  };
  if (pbr.baseColorTexture) {
    const im = j.textures[pbr.baseColorTexture.index].source;
    // Eyes are tiny on screen; the body/outfit atlas gets the most pixels.
    const isEyes = /mat\.001/.test(m.name ?? '');
    out.pbrMetallicRoughness.baseColorTexture = { index: encode(im, isEyes ? 256 : cut ? 1024 : 1024, cut) };
  }
  return out;
});
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ write
const out = {
  asset: { version: '2.0', generator: 'scripts/fix-trenchcoat-glb.mjs' },
  scene: 0,
  scenes: [{ name: 'Scene', nodes: [0] }],
  nodes,
  meshes,
  skins: [newSkin],
  materials: mats,
  textures: newImages.map((_, k) => ({ sampler: 0, source: k })),
  images: newImages,
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: 0 }],
};
const binOut = Buffer.concat(chunks);
const padBin = Buffer.concat([binOut, Buffer.alloc((4 - (binOut.length % 4)) % 4)]);
out.buffers[0].byteLength = padBin.length;
let js = Buffer.from(JSON.stringify(out));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const glb = Buffer.alloc(12 + 8 + js.length + 8 + padBin.length);
glb.writeUInt32LE(0x46546c67, 0);
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(js.length, 12);
glb.writeUInt32LE(0x4e4f534a, 16);
js.copy(glb, 20);
glb.writeUInt32LE(padBin.length, 20 + js.length);
glb.writeUInt32LE(0x004e4942, 24 + js.length);
padBin.copy(glb, 28 + js.length);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, glb);
const tris = meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + accessors[p.indices].count / 3, 0), 0);
console.log(`wrote ${dst}: ${(glb.length / 1024).toFixed(0)} KB, ${tris} triangles, ${meshes.length} meshes, ${mats.length} materials, ${newImages.length} textures`);

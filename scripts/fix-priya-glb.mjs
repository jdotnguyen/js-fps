// Prepares the Sketchfab "elegant woman" GLB (adri8restuz, CC-BY 4.0; a Character Creator rig) as Priya Anand's body for bodyModel.ts.
//   node scripts/fix-priya-glb.mjs <source.glb> [public/assets/models/squad/priya.glb]
// The source is a rigged, unanimated A-pose avatar: 24 meshes / materials, ~76k triangles, 102 CC_Base_* bones, 40 textures (24 MB).
// Nothing visible is simplified: no decimation, every texture keeps its size. What it does:
//   - bakes the Sketchfab/FBX wrapper nodes (Z-up centimetres) into the skeleton root, so the bones sit in Y-up metres;
//   - rebuilds the 17 inverse bind matrices the source wrote as identity (i.e. wrong) from the node pose, keeps the other 85,
//     sets the rest pose to the bind pose and moves the vertices into the same frame (Y-up metres);
//   - renames the CC_Base_* bones to names bodyModel.ts maps (as the retired fix-doctor-glb.mjs did for the old Okafor body):
//     JawRoot becomes Jaw, so the lower face, lower teeth and tongue follow the game's jaw joint when she talks;
//   - drops layers the body shader cannot draw (it alpha-tests, never blends): tear lines, eye-occlusion shadows and the
//     brow base are soft transparent films that would render as hard-edged patches, and the corneas are an extra layer over
//     the eyeballs (Priya's old corneas hid the iris);
//   - converts the specular-glossiness materials (no longer read by three.js) to metal-rough: diffuse -> base colour,
//     roughness = 1 - glossiness, metallic 0; soft-edged cards (hair, scalp, brows, lashes) become alpha cut-outs;
//   - drops data nothing reads (vertex colours, tangents, extra UV sets), moves each part's UV tile (CC lays the skin
//     out in tiles 1..5) back into 0..1, and packs the geometry like the other bodies (meshopt + quantised normals/UVs);
//   - re-encodes the textures as WebP at their full size (colour q92, normal maps q95, alpha kept).
// Needs ImageMagick (`convert`, with WebP) on the PATH.
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer/meshopt_encoder.module.js';
import { encodeWebp } from './lib/scan-body.mjs';

const [src, dst = 'public/assets/models/squad/priya.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-priya-glb.mjs <source.glb> [out.glb]');

// ------------------------------------------------------------------ read
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const COMP = { 5121: [1, 'getUint8', 255], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 0], 5126: [4, 'getFloat32', 0] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(ai) {
  const a = j.accessors[ai];
  const bv = j.bufferViews[a.bufferView];
  const [size, fn, norm] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride ?? size * n;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) {
      const v = dv[fn](base + i * stride + k * size, true);
      out[i * n + k] = a.normalized && norm ? v / norm : v;
    }
  }
  return out;
}
const imageBytes = (imageIndex) => {
  const bv = j.bufferViews[j.images[imageIndex].bufferView];
  return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
};

// ------------------------------------------------------------------ matrices (column-major)
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const local = (n) => {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
};
const inv = (m) => {
  const a = [];
  for (let r = 0; r < 4; r++) a.push([m[r], m[4 + r], m[8 + r], m[12 + r], r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const dd = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= dd;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][4 + c];
  return o;
};
const parentOf = new Map();
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const worldOf = (i) => { let m = local(j.nodes[i]); for (let p = parentOf.get(i); p !== undefined; p = parentOf.get(p)) m = mul(local(j.nodes[p]), m); return m; };

// ------------------------------------------------------------------ skeleton
const skin = j.skins[0];
const jointNodes = skin.joints;
const jointSet = new Set(jointNodes);
const srcIbm = read(skin.inverseBindMatrices);
const world = jointNodes.map(worldOf);
const ibmOf = (k) => Array.from(srcIbm.subarray(k * 16, k * 16 + 16));
const isIdentity = (m) => m.every((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0)) < 1e-6);
// Mesh space -> node-pose world: W_j * IBM_j, the same for every joint whose inverse bind matrix is real.
let meshToWorld = null;
let spread = 0;
jointNodes.forEach((_, k) => {
  const m = ibmOf(k);
  if (isIdentity(m)) return;
  const t = mul(world[k], m);
  if (!meshToWorld) meshToWorld = t;
  else spread = Math.max(spread, ...t.map((x, i) => Math.abs(x - meshToWorld[i])));
});
// The jaw, teeth and eye bones are posed up to 1.5 mm off their bind pose; anything larger means a different frame.
if (!meshToWorld || spread > 5e-3) throw new Error(`inverse bind matrices disagree with the node pose (spread ${spread})`);
// Bind pose in world: from the real inverse bind matrices, from the node pose where the source wrote identity.
const bindWorld = jointNodes.map((_, k) => (isIdentity(ibmOf(k)) ? world[k] : mul(meshToWorld, inv(ibmOf(k)))));
console.log(`bind frame: ${jointNodes.filter((_, k) => isIdentity(ibmOf(k))).length} identity inverse bind matrices rebuilt from the node pose; ` +
  `the rest agree with it within ${(spread * 1000).toFixed(1)} mm`);

const special = {
  Hip: 'HipRoot', // CC has Hip above Pelvis: the pelvis is the pivot the thighs hang from
  Pelvis: 'Hips',
  Waist: 'Waist',
  Spine01: 'Spine',
  Spine02: 'Spine1',
  NeckTwist01: 'Neck', // CC has no Neck bone; its first twist bone sits at the neck base
  NeckTwist02: 'NeckUpper',
  JawRoot: 'Jaw',
};
const sided = (base) =>
  base
    .replace(/^Mid(\d)/, 'Middle$1')
    .replace(/^ToeBaseShareBone$/, 'FootShare')
    .replace(/^BigToe1$/, 'FootT1').replace(/^IndexToe1$/, 'FootT2').replace(/^MidToe1$/, 'FootT3')
    .replace(/^RingToe1$/, 'FootT4').replace(/^PinkyToe1$/, 'FootT5');
const rename = (name) => {
  if (!name.startsWith('CC_Base_')) return name;
  const n = name.slice(8).replace(/_\d+$/, '');
  const m = /^([LR])_(.+)$/.exec(n);
  if (m) return (m[1] === 'L' ? 'Left' : 'Right') + sided(m[2]);
  return special[n] ?? n;
};
const boneNames = jointNodes.map((i) => rename(j.nodes[i].name));
if (new Set(boneNames).size !== boneNames.length) throw new Error('duplicate bone names after renaming');
const outIndex = new Map(jointNodes.map((n, k) => [n, k]));
const rootK = jointNodes.findIndex((n) => !jointSet.has(parentOf.get(n)));
const parentK = jointNodes.map((n) => outIndex.get(parentOf.get(n)));
const outBones = jointNodes.map((n, k) => {
  // Rest pose = bind pose: each bone's local transform is taken between bind poses; the root carries the wrapper chain.
  const m = parentK[k] === undefined ? bindWorld[k] : mul(inv(bindWorld[parentK[k]]), bindWorld[k]);
  const children = (j.nodes[n].children ?? []).filter((c) => jointSet.has(c)).map((c) => outIndex.get(c));
  return { name: boneNames[k], matrix: m.map((x) => +x.toFixed(7)), ...(children.length ? { children } : {}) };
});
const ibm = new Float32Array(jointNodes.length * 16);
bindWorld.forEach((w, k) => ibm.set(inv(w), k * 16));

// ------------------------------------------------------------------ parts
const DROP = /^(Std_Tearline_[LR]|Std_Eye_Occlusion_[LR]|Std_Cornea_[LR]|Female_Brow_Base_Transparency)$/;
const meshNodes = j.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.mesh !== undefined);
const L3 = meshToWorld; // affine, applied to positions; its upper 3x3 (renormalised) to normals
const parts = [];
for (const { n } of meshNodes) {
  if (n.skin !== 0) throw new Error('unexpected unskinned or second-skin mesh node ' + n.name);
  for (const p of j.meshes[n.mesh].primitives) {
    const mat = j.materials[p.material];
    if (DROP.test(mat.name)) { console.log('dropped', mat.name); continue; }
    if ((p.mode ?? 4) !== 4) throw new Error('non-triangle primitive in ' + mat.name);
    const P = read(p.attributes.POSITION), N = read(p.attributes.NORMAL), UV = read(p.attributes.TEXCOORD_0);
    const JN = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0);
    const idx = p.indices !== undefined ? read(p.indices) : Float64Array.from({ length: P.length / 3 }, (_, i) => i);
    const count = P.length / 3;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let u0 = Infinity, v0 = Infinity;
    for (let v = 0; v < count; v++) { u0 = Math.min(u0, UV[v * 2]); v0 = Math.min(v0, UV[v * 2 + 1]); }
    u0 = Math.floor(u0); v0 = Math.floor(v0);
    for (let v = 0; v < count; v++) {
      const [x, y, z] = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      for (let r = 0; r < 3; r++) pos[v * 3 + r] = L3[r] * x + L3[4 + r] * y + L3[8 + r] * z + L3[12 + r];
      const [nx, ny, nz] = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
      let a = L3[0] * nx + L3[4] * ny + L3[8] * nz, b = L3[1] * nx + L3[5] * ny + L3[9] * nz, c = L3[2] * nx + L3[6] * ny + L3[10] * nz;
      const len = Math.hypot(a, b, c) || 1;
      nor[v * 3] = a / len; nor[v * 3 + 1] = b / len; nor[v * 3 + 2] = c / len;
      uv[v * 2] = UV[v * 2] - u0; uv[v * 2 + 1] = UV[v * 2 + 1] - v0;
    }
    const joints = new Uint8Array(count * 4), weights = new Uint16Array(count * 4);
    for (let v = 0; v < count; v++) {
      const s = W[v * 4] + W[v * 4 + 1] + W[v * 4 + 2] + W[v * 4 + 3] || 1;
      let acc = 0, heavy = 0;
      for (let k = 0; k < 4; k++) {
        joints[v * 4 + k] = JN[v * 4 + k];
        weights[v * 4 + k] = Math.round((W[v * 4 + k] / s) * 65535);
        acc += weights[v * 4 + k];
        if (weights[v * 4 + k] > weights[v * 4 + heavy]) heavy = k;
      }
      weights[v * 4 + heavy] += 65535 - acc; // exact sum
    }
    parts.push({ mat, pos, nor, uv, joints, weights, indices: Uint32Array.from(idx), uvShift: [u0, v0] });
  }
}

// ------------------------------------------------------------------ materials and textures
const textureOf = (info) => (info ? j.textures[info.index].source : null);
const images = []; // { bytes }
const imageSlot = new Map();
const addImage = (imageIndex, quality) => {
  const key = `${imageIndex}:${quality}`;
  if (!imageSlot.has(key)) {
    imageSlot.set(key, images.length);
    images.push(encodeWebp(imageBytes(imageIndex), 8192, quality));
  }
  return imageSlot.get(key);
};
const CUTOUT = /Eyelash|Brow|Scalp|Hair/;
const outMaterials = [];
const matSlot = new Map();
for (const part of parts) {
  const m = part.mat;
  if (matSlot.has(m)) { part.material = matSlot.get(m); continue; }
  const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness ?? {};
  const diffuse = textureOf(sg.diffuseTexture);
  const normal = textureOf(m.normalTexture);
  const cutout = CUTOUT.test(m.name);
  const out = {
    name: m.name,
    pbrMetallicRoughness: {
      ...(diffuse !== null ? { baseColorTexture: { index: addImage(diffuse, 92) } } : {}),
      ...(sg.diffuseFactor && sg.diffuseFactor.some((x) => x !== 1) ? { baseColorFactor: sg.diffuseFactor } : {}),
      metallicFactor: 0,
      roughnessFactor: +(1 - (sg.glossinessFactor ?? 0.2)).toFixed(3),
    },
    ...(normal !== null ? { normalTexture: { index: addImage(normal, 95) } } : {}),
    ...(cutout ? { alphaMode: 'MASK', alphaCutoff: 0.4, doubleSided: true } : {}),
    ...(m.doubleSided && !cutout ? { doubleSided: true } : {}),
  };
  part.material = outMaterials.length;
  matSlot.set(m, part.material);
  outMaterials.push(out);
}

// ------------------------------------------------------------------ pack (EXT_meshopt_compression + KHR_mesh_quantization + EXT_texture_webp)
await MeshoptEncoder.ready;
const chunks = [];
const views = [];
const accessors = [];
let packed = 0, raw = 0;
const pad4 = (n) => (n + 3) & ~3;
const addRaw = (bytes) => {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  chunks.push(b, Buffer.alloc(pad4(b.length) - b.length));
  views.push({ buffer: 0, byteOffset: packed, byteLength: b.length });
  packed += pad4(b.length);
  return views.length - 1;
};
const addCompressed = (typed, n, stride, mode, target) => {
  const srcBytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const enc = Buffer.from(MeshoptEncoder.encodeGltfBuffer(srcBytes, n, stride, mode));
  chunks.push(enc, Buffer.alloc(pad4(enc.length) - enc.length));
  views.push({
    buffer: 1, byteOffset: raw, byteLength: n * stride, ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}), target,
    extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: packed, byteLength: enc.length, byteStride: stride, mode, count: n } },
  });
  packed += pad4(enc.length);
  raw += pad4(n * stride);
  return views.length - 1;
};
const acc = (view, componentType, type, n, extra = {}) => { accessors.push({ bufferView: view, componentType, type, count: n, ...extra }); return accessors.length - 1; };

let triangles = 0, vertices = 0;
const primitives = parts.map((part) => {
  const count = part.pos.length / 3;
  const [remap, unique] = MeshoptEncoder.reorderMesh(part.indices, true, false);
  const P = new Float32Array(unique * 3), Nq = new Int8Array(unique * 4), Uq = new Uint16Array(unique * 2);
  const Jq = new Uint8Array(unique * 4), Wq = new Uint16Array(unique * 4);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < count; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) {
      P[r * 3 + k] = part.pos[v * 3 + k];
      min[k] = Math.min(min[k], part.pos[v * 3 + k]); max[k] = Math.max(max[k], part.pos[v * 3 + k]);
      Nq[r * 4 + k] = Math.round(Math.max(-1, Math.min(1, part.nor[v * 3 + k])) * 127);
    }
    for (let k = 0; k < 2; k++) Uq[r * 2 + k] = Math.round(Math.max(0, Math.min(1, part.uv[v * 2 + k])) * 65535);
    for (let k = 0; k < 4; k++) { Jq[r * 4 + k] = part.joints[v * 4 + k]; Wq[r * 4 + k] = part.weights[v * 4 + k]; }
  }
  const index = unique > 65535 ? part.indices : Uint16Array.from(part.indices);
  triangles += part.indices.length / 3;
  vertices += unique;
  return {
    attributes: {
      POSITION: acc(addCompressed(P, unique, 12, 'ATTRIBUTES', 34962), 5126, 'VEC3', unique, { min, max }),
      NORMAL: acc(addCompressed(Nq, unique, 4, 'ATTRIBUTES', 34962), 5120, 'VEC3', unique, { normalized: true }),
      TEXCOORD_0: acc(addCompressed(Uq, unique, 4, 'ATTRIBUTES', 34962), 5123, 'VEC2', unique, { normalized: true }),
      JOINTS_0: acc(addCompressed(Jq, unique, 4, 'ATTRIBUTES', 34962), 5121, 'VEC4', unique),
      WEIGHTS_0: acc(addCompressed(Wq, unique, 8, 'ATTRIBUTES', 34962), 5123, 'VEC4', unique, { normalized: true }),
    },
    indices: acc(addCompressed(index, index.length, index.BYTES_PER_ELEMENT, 'TRIANGLES', 34963), index.BYTES_PER_ELEMENT === 2 ? 5123 : 5125, 'SCALAR', index.length),
    material: part.material,
  };
});
const ibmAcc = acc(addRaw(ibm), 5126, 'MAT4', jointNodes.length);
const imageViews = images.map((b) => addRaw(b));

const meshNode = outBones.length;
const json = {
  asset: {
    version: '2.0',
    generator: 'scripts/fix-priya-glb.mjs',
    extras: { ...j.asset.extras, note: 'Repacked by scripts/fix-priya-glb.mjs' },
  },
  extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization'],
  extensionsRequired: ['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: [rootK, meshNode] }],
  nodes: [...outBones, { name: 'Priya', mesh: 0, skin: 0 }],
  meshes: [{ name: 'Priya', primitives }],
  skins: [{ joints: outBones.map((_, k) => k), inverseBindMatrices: ibmAcc, skeleton: rootK }],
  materials: outMaterials,
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  textures: images.map((_, k) => ({ sampler: 0, extensions: { EXT_texture_webp: { source: k } } })),
  images: imageViews.map((bufferView) => ({ bufferView, mimeType: 'image/webp' })),
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: packed }, { byteLength: raw, extensions: { EXT_meshopt_compression: { fallback: true } } }],
};
let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const body = Buffer.concat(chunks);
const glb = Buffer.alloc(12 + 8 + js.length + 8 + body.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
glb.writeUInt32LE(body.length, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length); body.copy(glb, 28 + js.length);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, glb);
console.log('wrote', dst, `${(glb.length / 1024 / 1024).toFixed(2)} MB (${(d.length / 1024 / 1024).toFixed(1)} MB source), ` +
  `${triangles} triangles, ${vertices} vertices, ${parts.length} parts, ${outMaterials.length} materials, ${images.length} textures, ${outBones.length} bones`);

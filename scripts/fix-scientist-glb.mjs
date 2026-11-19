// Prepares a Sketchfab Half-Life-style "scientist" GLB (ValveBiped rig, ~5k triangles) for bodyModel.ts (ADR-0026) as a botanist crew body.
//   node scripts/fix-scientist-glb.mjs <source.glb> <out.glb>
// The three sources (Geont "scientist", "source scientist", Scientist Broken "Scientist") share one rig: 60-80 ValveBiped.* bones, Z-up wrapper
// node, one baked clip (ragdoll / MorphBake) in two of them. What it does (1.8-7.6 MB -> ~0.3-0.5 MB each):
//   - renames the ValveBiped bones to Mixamo-style names bodyModel.ts can map (twist, end, attachment and tie bones become Helper_N and
//     follow their parent joint);
//   - drops animations, tangents, TEXCOORD_1/2, metallic-roughness maps and any normal map that needs UV1;
//   - skins the (unskinned, head-parented) glasses of "Scientist" to the Head bone, baking the node's bind-pose world matrix into the vertices;
//   - repacks vertex buffers (u16 indices, u8 joints, normalised u16 weights) and re-encodes textures as resized JPEGs (ImageMagick `convert`).
// The node hierarchy (including the Z-up wrapper) is left alone: bodyModel.ts re-poses the model itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error('usage: node scripts/fix-scientist-glb.mjs <source.glb> <out.glb>');

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

// ------------------------------------------------------------------ matrices (column-major)
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const localMat = (n) => {
  if (n.matrix) return n.matrix;
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
const parent = new Map();
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const worldMat = (i) => {
  let m = localMat(j.nodes[i]);
  for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = mul(localMat(j.nodes[p]), m);
  return m;
};

// ------------------------------------------------------------------ bones: ValveBiped -> Mixamo-style
const skin = j.skins[0];
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
function renameBone(raw, i) {
  const s = raw.replace(/^ValveBiped\./, '').replace(/(_\d+)+$/, '');
  const side = (c) => (c === 'L' ? 'Left' : 'Right');
  let m;
  if (s === 'Bip01_Pelvis') return 'Hips';
  if ((m = /^Bip01_(L|R)_(Thigh|Calf|Foot|Toe0)$/.exec(s))) return side(m[1]) + { Thigh: 'UpLeg', Calf: 'Leg', Foot: 'Foot', Toe0: 'ToeBase' }[m[2]];
  if ((m = /^Bip01_(Spine|Spine1|Spine2|Spine4)$/.exec(s))) return m[1] === 'Spine4' ? 'Spine3' : m[1];
  if (s === 'Bip01_Neck1') return 'Neck';
  if (s === 'Bip01_Head1') return 'Head';
  if ((m = /^Bip01_(L|R)_(Clavicle|UpperArm|Forearm|Hand)$/.exec(s))) return side(m[1]) + { Clavicle: 'Clavicle', UpperArm: 'Arm', Forearm: 'ForeArm', Hand: 'Hand' }[m[2]];
  if ((m = /^Bip01_(L|R)_Finger(\d)(\d?)$/.exec(s))) return `${side(m[1])}Hand${FINGERS[Number(m[2])]}${Number(m[3] || 0) + 1}`;
  return `Helper_${i}`; // root, end, wrist twist, attachment, tie and forward bones follow their parent joint
}
const used = new Set();
for (const ji of skin.joints) {
  const n = j.nodes[ji];
  n.name = renameBone(n.name ?? '', ji);
  if (used.has(n.name)) throw new Error('duplicate bone ' + n.name);
  used.add(n.name);
}
const headJoint = skin.joints.findIndex((ji) => j.nodes[ji].name === 'Head');
if (headJoint < 0) throw new Error('no Head bone');

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

// meshes
const GLASSES_NODE = j.nodes.findIndex((n) => n.mesh !== undefined && n.skin === undefined);
const meshes = j.meshes.map((mesh, mi) => ({
  name: mesh.name,
  primitives: mesh.primitives.map((p) => {
    const unskinned = !p.attributes.JOINTS_0;
    let pos = Float32Array.from(read(p.attributes.POSITION));
    let nor = Float32Array.from(read(p.attributes.NORMAL));
    const nv = pos.length / 3;
    let joints, weights;
    if (unskinned) {
      // Bake the node's bind-pose world matrix (the frame the skinned vertices live in) and bind everything to the Head.
      const node = j.nodes.findIndex((n) => n.mesh === mi);
      const w = worldMat(node);
      for (let v = 0; v < nv; v++) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        pos[v * 3] = w[0] * x + w[4] * y + w[8] * z + w[12];
        pos[v * 3 + 1] = w[1] * x + w[5] * y + w[9] * z + w[13];
        pos[v * 3 + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
        const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
        const ox = w[0] * nx + w[4] * ny + w[8] * nz, oy = w[1] * nx + w[5] * ny + w[9] * nz, oz = w[2] * nx + w[6] * ny + w[10] * nz;
        const l = Math.hypot(ox, oy, oz) || 1;
        nor[v * 3] = ox / l; nor[v * 3 + 1] = oy / l; nor[v * 3 + 2] = oz / l;
      }
      joints = new Uint8Array(nv * 4);
      weights = new Uint16Array(nv * 4);
      for (let v = 0; v < nv; v++) { joints[v * 4] = headJoint; weights[v * 4] = 65535; }
    } else {
      const jr = read(p.attributes.JOINTS_0);
      const wr = read(p.attributes.WEIGHTS_0);
      joints = new Uint8Array(nv * 4);
      weights = new Uint16Array(nv * 4);
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
    return { attributes, indices: addAccessor(idx, nv < 65536 ? 5123 : 5125, 'SCALAR', 34963), material: p.material, mode: p.mode ?? 4 };
  }),
}));
if (GLASSES_NODE >= 0) {
  // Make the glasses a skinned mesh node beside the others (they were parented under the head bone).
  const n = j.nodes[GLASSES_NODE];
  const sibling = j.nodes.findIndex((m) => m.skin !== undefined);
  const p = parent.get(sibling);
  n.skin = 0;
  const par = parent.get(GLASSES_NODE);
  j.nodes[par].children = j.nodes[par].children.filter((c) => c !== GLASSES_NODE);
  delete n.translation; delete n.rotation; delete n.scale; delete n.matrix;
  j.nodes[p].children.push(GLASSES_NODE);
}

// inverse bind matrices
const ibm = Float32Array.from(read(skin.inverseBindMatrices));
const newSkin = { joints: skin.joints, inverseBindMatrices: addAccessor(ibm, 5126, 'MAT4'), ...(skin.skeleton !== undefined ? { skeleton: skin.skeleton } : {}) };

// ------------------------------------------------------------------ materials and textures (base colour + UV0 normal map only)
const imageOf = (ti) => j.textures[ti].source;
const keepImages = new Map(); // old image index -> { role }
const mats = j.materials.map((m) => {
  const out = { name: m.name, doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: m.pbrMetallicRoughness?.roughnessFactor ?? 0.5 } };
  const pbr = m.pbrMetallicRoughness ?? {};
  if (pbr.baseColorFactor) out.pbrMetallicRoughness.baseColorFactor = pbr.baseColorFactor;
  if (pbr.baseColorTexture) {
    const im = imageOf(pbr.baseColorTexture.index);
    keepImages.set(im, { role: /eye/i.test(m.name ?? '') ? 'eye' : 'color' });
    out.pbrMetallicRoughness.baseColorTexture = { index: im };
  }
  if (m.normalTexture && !m.normalTexture.texCoord) {
    const im = imageOf(m.normalTexture.index);
    keepImages.set(im, { role: 'normal' });
    out.normalTexture = { index: im };
  }
  return out;
});
const MAX = { color: 1024, normal: 512, eye: 128 };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-'));
const newImages = [];
const imgMap = new Map();
for (const [im, { role }] of keepImages) {
  const bv = j.bufferViews[j.images[im].bufferView];
  const raw = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  const inp = path.join(tmp, `in${im}`);
  const outp = path.join(tmp, `out${im}.jpg`);
  fs.writeFileSync(inp, raw);
  execFileSync('convert', [inp, '-background', 'white', '-alpha', 'remove', '-resize', `${MAX[role]}x${MAX[role]}>`, '-strip', '-sampling-factor', '4:2:0', '-quality', role === 'normal' ? '86' : '84', outp]);
  const jpg = fs.readFileSync(outp);
  imgMap.set(im, newImages.length);
  newImages.push({ bufferView: addView(jpg), mimeType: 'image/jpeg' });
}
fs.rmSync(tmp, { recursive: true, force: true });
const textures = newImages.map((_, k) => ({ sampler: 0, source: k }));
for (const m of mats) {
  if (m.pbrMetallicRoughness.baseColorTexture) m.pbrMetallicRoughness.baseColorTexture.index = imgMap.get(m.pbrMetallicRoughness.baseColorTexture.index);
  if (m.normalTexture) m.normalTexture.index = imgMap.get(m.normalTexture.index);
}

// ------------------------------------------------------------------ write
const out = {
  asset: j.asset,
  scene: j.scene ?? 0,
  scenes: j.scenes,
  nodes: j.nodes,
  meshes,
  skins: [newSkin],
  materials: mats,
  textures,
  images: newImages,
  samplers: [j.samplers?.[0] ?? { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: 0 }],
};
// Point the glasses node at its mesh (the node index is unchanged) and keep every node's mesh/skin references valid.
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
console.log(`wrote ${dst}: ${(glb.length / 1024).toFixed(0)} KB, ${tris} triangles, ${newImages.length} textures, glasses ${GLASSES_NODE >= 0 ? 'skinned to Head' : 'none'}`);

// Prepares the Sketchfab "doctor" GLB (Chenchanchong, CC-BY 4.0; a Character Creator rig) for bodyModel.ts (ADR-0026).
//   node scripts/fix-doctor-glb.mjs <source.glb> [public/assets/models/squad/doctor.glb]
// What it does (19.7 MB -> well under 1 MB):
//   - renames the CC_Base_* bones to the names bodyModel.ts maps (LeftArm, RightThigh, Spine, Neck ...). The extra toe,
//     jaw and pelvis bones are renamed so they follow their parent instead of being taken for hands or a second pelvis;
//   - folds the 90 "scaleCompensation" helper nodes into the bones below them (bodyModel needs bone -> bone parents);
//   - rebuilds the inverse bind matrices from the node pose (35 of the 102 in the source are identity, i.e. wrong), and bakes
//     the model's Z-up centimetre frame into Y-up metres facing +Z, like the Mechanic, with the wrapper nodes cleared;
//   - drops the baked animation (the game animates procedurally), TANGENT and the two unused UV sets;
//   - repacks vertex data (u16 indices, u8 joints, normalised u16 weights) and re-encodes both 1024 px PNGs as JPEG.
// Needs ImageMagick (`convert`) on the PATH for the textures.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const [src, dst = 'public/assets/models/squad/doctor.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-doctor-glb.mjs <source.glb> [out.glb]');
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);

// ------------------------------------------------------------------ accessors
const COMP = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
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
const prim = j.meshes[0].primitives[0];
const at = prim.attributes;
const pos = read(at.POSITION);
const nor = read(at.NORMAL);
const uv = read(at.TEXCOORD_0);
const joints = read(at.JOINTS_0);
const weights = read(at.WEIGHTS_0);
const indices = read(prim.indices);
const count = pos.length / 3;
if (count > 65535) throw new Error('too many vertices for u16 indices');
if (joints.some((x) => x > 255)) throw new Error('joint index over 255');

// ------------------------------------------------------------------ node matrices (column-major)
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const local = (n) => {
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

const inv = (m) => {
  // General 4x4 inverse (column-major), by Gauss-Jordan.
  const a = [];
  for (let r = 0; r < 4; r++) a.push([m[r], m[4 + r], m[8 + r], m[12 + r], r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][4 + c];
  return o;
};

// ------------------------------------------------------------------ bone names
const special = {
  Hip: 'HipRoot', // CC has Hip above Pelvis: the pelvis is the pivot the thighs hang from
  Pelvis: 'Hips',
  Waist: 'Waist',
  Spine01: 'Spine',
  Spine02: 'Spine1',
  NeckTwist01: 'Neck', // CC has no Neck bone; its first twist bone sits at the neck base
  NeckTwist02: 'NeckUpper',
  JawRoot: 'MouthRoot', // keep the jaw out of the game's jaw joint: it follows the head
};
const sided = (base) =>
  base
    .replace(/^Mid(\d)/, 'Middle$1')
    .replace(/^ToeBaseShareBone$/, 'FootShare')
    .replace(/^BigToe1$/, 'FootT1').replace(/^IndexToe1$/, 'FootT2').replace(/^MidToe1$/, 'FootT3')
    .replace(/^RingToe1$/, 'FootT4').replace(/^PinkyToe1$/, 'FootT5')
    .replace(/^Upperarm/, 'Upperarm');
const rename = (name) => {
  if (!name.startsWith('CC_Base_')) return name;
  const n = name.slice(8).replace(/_\d+$/, '');
  const m = /^([LR])_(.+)$/.exec(n);
  if (m) return (m[1] === 'L' ? 'Left' : 'Right') + sided(m[2]);
  return special[n] ?? n;
};

// ------------------------------------------------------------------ node graph without the scaleCompensation helpers
const isSc = (n) => n.extras?.scaleCompensation;
const nodes = j.nodes.map((n) => ({ ...n }));
// Fold each helper into its single child: the child's local matrix becomes helper * child.
for (const n of nodes) {
  if (!isSc(n)) continue;
  if ((n.children ?? []).length !== 1) throw new Error('helper with ' + (n.children ?? []).length + ' children: ' + n.name);
  const child = nodes[n.children[0]];
  child.matrix = mul(local(n), local(child));
  delete child.translation; delete child.rotation; delete child.scale;
}
const remap = new Map();
const kept = [];
nodes.forEach((n, i) => { if (!isSc(n)) { remap.set(i, kept.length); kept.push(i); } });
const resolve = (i) => { let k = i; while (isSc(nodes[k])) k = nodes[k].children[0]; return remap.get(k); };
const outNodes = kept.map((i) => {
  const n = { ...nodes[i] };
  if (n.children) n.children = n.children.map(resolve);
  if (n.name) n.name = rename(n.name);
  return n;
});
const skinJoints = j.skins[0].joints.map(resolve);
const seen = new Set();
for (const i of skinJoints) { const nm = outNodes[i].name; if (seen.has(nm)) throw new Error('duplicate bone ' + nm); seen.add(nm); }

// ------------------------------------------------------------------ frame: Z-up cm -> Y-up m, facing +Z
// The source's wrapper nodes (Sketchfab_model, the .fbx node, ...) carry the up-axis flip and the 0.01 scale while the
// mesh and bones stay in the raw frame. Bake all of it in and clear the wrappers; the pose in the nodes is the bind pose.
const parentOf = new Map();
outNodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
const skelRoot = j.skins[0].skeleton !== undefined ? resolve(j.skins[0].skeleton) : skinJoints[0];
for (let a = parentOf.get(skelRoot); a !== undefined; a = parentOf.get(a)) { for (const k of ['matrix', 'translation', 'rotation', 'scale']) delete outNodes[a][k]; }
const scaleTree = (i) => {
  const n = outNodes[i];
  if (n.matrix) { n.matrix = n.matrix.slice(); for (let k = 12; k < 15; k++) n.matrix[k] *= 0.01; }
  else if (n.translation) n.translation = n.translation.map((x) => x * 0.01);
  (n.children ?? []).forEach(scaleTree);
};
scaleTree(skelRoot);
const ROT = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]; // (x, y, z) -> (x, z, -y)
outNodes[skelRoot].matrix = mul(ROT, local(outNodes[skelRoot]));
for (const k of ['translation', 'rotation', 'scale']) delete outNodes[skelRoot][k];
const worldOf = (i) => { let m = local(outNodes[i]); for (let p = parentOf.get(i); p !== undefined; p = parentOf.get(p)) m = mul(local(outNodes[p]), m); return m; };
const ibm = new Float32Array(skinJoints.length * 16);
skinJoints.forEach((ji, k) => ibm.set(inv(worldOf(ji)), k * 16));
for (let v = 0; v < count; v++) {
  const [x, y, z] = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  pos[v * 3] = x * 0.01; pos[v * 3 + 1] = z * 0.01; pos[v * 3 + 2] = -y * 0.01;
  const [nx, ny, nz] = [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]];
  nor[v * 3] = nx; nor[v * 3 + 1] = nz; nor[v * 3 + 2] = -ny;
}

// ------------------------------------------------------------------ textures
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
const image = (k, args) => {
  const bv = j.bufferViews[j.images[k].bufferView];
  const inp = path.join(tmp, `in${k}.png`);
  const out = path.join(tmp, `out${k}.jpg`);
  fs.writeFileSync(inp, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  execFileSync('convert', [inp, ...args, '-strip', out]);
  return fs.readFileSync(out);
};
const colorTex = image(0, ['-quality', '86', '-sampling-factor', '4:2:0']);
const normalTex = image(1, ['-resize', '512x512', '-quality', '92', '-sampling-factor', '4:4:4']);
fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ repack
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
const mm = (a, n) => {
  const min = new Array(n).fill(Infinity), max = new Array(n).fill(-Infinity);
  for (let i = 0; i < a.length; i++) { const k = i % n; if (a[i] < min[k]) min[k] = a[i]; if (a[i] > max[k]) max[k] = a[i]; }
  return { min, max };
};
const w16 = new Uint16Array(weights.length);
for (let v = 0; v < count; v++) {
  const s = weights[v * 4] + weights[v * 4 + 1] + weights[v * 4 + 2] + weights[v * 4 + 3] || 1;
  for (let k = 0; k < 4; k++) w16[v * 4 + k] = Math.round((weights[v * 4 + k] / s) * 65535);
}
const attrs = {
  POSITION: acc(push(f32(pos), { target: 34962 }), 5126, 'VEC3', count, mm(pos, 3)),
  NORMAL: acc(push(f32(nor), { target: 34962 }), 5126, 'VEC3', count),
  TEXCOORD_0: acc(push(f32(uv), { target: 34962 }), 5126, 'VEC2', count),
  JOINTS_0: acc(push(Buffer.from(Uint8Array.from(joints)), { target: 34962 }), 5121, 'VEC4', count),
  WEIGHTS_0: acc(push(Buffer.from(w16.buffer), { target: 34962 }), 5123, 'VEC4', count, { normalized: true }),
};
const idx = acc(push(Buffer.from(Uint16Array.from(indices).buffer), { target: 34963 }), 5123, 'SCALAR', indices.length);
const ibmAcc = acc(push(Buffer.from(ibm.buffer)), 5126, 'MAT4', ibm.length / 16);
const imgViews = [push(colorTex), push(normalTex)];

const mat = j.materials[0];
const out = {
  asset: { ...j.asset, extras: { ...j.asset.extras, note: 'Repacked by scripts/fix-doctor-glb.mjs' } },
  scene: 0,
  scenes: j.scenes,
  nodes: outNodes.map((n) => { const { extras, ...rest } = n; return rest; }),
  meshes: [{ name: j.meshes[0].name, primitives: [{ attributes: attrs, indices: idx, material: 0 }] }],
  skins: [{ joints: skinJoints, inverseBindMatrices: ibmAcc, ...(j.skins[0].skeleton !== undefined ? { skeleton: resolve(j.skins[0].skeleton) } : {}) }],
  // The source marks the whole body alpha-BLEND although its textures have no alpha: opaque keeps it a plain surface.
  materials: [{
    name: mat.name,
    pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: mat.pbrMetallicRoughness.roughnessFactor },
    normalTexture: { index: 1 },
  }],
  textures: [{ sampler: 0, source: 0 }, { sampler: 0, source: 1 }],
  samplers: j.samplers,
  images: imgViews.map((bufferView) => ({ bufferView, mimeType: 'image/jpeg' })),
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: chunks.reduce((s, c) => s + c.length, 0) }],
};
let js = Buffer.from(JSON.stringify(out));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const body = Buffer.concat(chunks);
const glb = Buffer.alloc(12 + 8 + js.length + 8 + body.length);
glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
glb.writeUInt32LE(body.length, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length); body.copy(glb, 28 + js.length);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, glb);
console.log('wrote', dst, `${(glb.length / 1024).toFixed(0)} KB, ${indices.length / 3} triangles, ${skinJoints.length} bones`);

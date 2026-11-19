// Prepares the Sketchfab "A Man in suit" GLB (anuragk1229, CC-BY 4.0) for bodyModel.ts (ADR-0026) as Director Hale's body.
//   node scripts/fix-hale-glb.mjs <source.glb> [public/assets/models/squad/hale.glb]
// The source is a 15 MB rigged avatar (~119k triangles, 11 meshes, 14 images, no animation, no jaw bone, T-pose, Mixamo-style bone names with
// numeric suffixes). Same exporter family as the old Priya model.
// What it does (15 MB -> ~1 MB):
//   - drops TANGENT, TEXCOORD_1 and unused maps (bodyMaterial.ts uses baseColor + normal);
//   - clears the Sketchfab/FBX wrapper nodes so the skeleton sits directly in Y-up metres facing +Z, drops unused _rootJoint and end-marker
//     bones, folds LeftEye/RightEye into Head, adds a Jaw bone under Head, and rebuilds inverseBindMatrices from the node bind pose;
//   - weights AvatarTeethLower 100% to Jaw and weights AvatarHead's lower lip and chin (below the mouth line) smoothly to Jaw so the mouth
//     opens cleanly when speaking (ADR-0027);
//   - drops AvatarLeftCornea/AvatarRightCornea (opaque layers that hide the real eyeball texture);
//   - merges Left+Right eyeballs and Upper+Lower teeth, decimates with meshoptimizer, repacks vertex buffers (u16 indices, u8 joints,
//     normalised u16 weights), and re-encodes textures as resized JPEGs.
// Uses System.Drawing via PowerShell on Windows (or ImageMagick `convert` elsewhere) and `meshoptimizer` from node_modules.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

const [src, dst = 'public/assets/models/squad/hale.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-hale-glb.mjs <source.glb> [out.glb]');

// ------------------------------------------------------------------ read source GLB
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);
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

// ------------------------------------------------------------------ matrix math (column-major)
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
const invMat = (m) => {
  const a = [];
  for (let r = 0; r < 4; r++) a.push([m[r], m[4 + r], m[8 + r], m[12 + r], r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const div = a[c][c];
    for (let k = 0; k < 8; k++) a[c][k] /= div;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const o = new Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r][4 + c];
  return o;
};

// ------------------------------------------------------------------ skeleton cleanup + Jaw bone
const srcSkin = j.skins[0];
const srcJoints = srcSkin.joints;
const cleanName = (nm) => nm.replace(/_\d+$/, '');
const DROP_BONE = /^(_rootJoint|.*_End|.*Hand(Thumb|Index|Middle|Ring|Pinky)4|(Left|Right)Eye)$/;

// Collect kept skeleton nodes (preserving parent->child relationships below Hips).
const srcParent = new Map();
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => srcParent.set(c, i)));
const keptSrcNodes = [];
const srcToOutNode = new Map();
for (const ni of srcJoints) {
  const nm = cleanName(j.nodes[ni].name);
  if (DROP_BONE.test(nm)) continue;
  srcToOutNode.set(ni, keptSrcNodes.length);
  keptSrcNodes.push(ni);
}
const outNodes = keptSrcNodes.map((ni) => {
  const n = j.nodes[ni];
  const out = { name: cleanName(n.name) };
  if (n.translation) out.translation = n.translation;
  if (n.rotation) out.rotation = n.rotation;
  if (n.scale) out.scale = n.scale;
  if (n.matrix) out.matrix = n.matrix;
  const kids = (n.children ?? []).map((c) => srcToOutNode.get(c)).filter((c) => c !== undefined);
  if (kids.length) out.children = kids;
  return out;
});
const outNodeByName = new Map(outNodes.map((n, i) => [n.name, i]));
const hipsIdx = outNodeByName.get('Hips');
const headIdx = outNodeByName.get('Head');
if (hipsIdx === undefined || headIdx === undefined) throw new Error('missing Hips or Head bone');

// Compute world matrices for kept bones (Hips is the root, already in Y-up metres facing +Z).
const outParent = new Map();
outNodes.forEach((n, i) => (n.children ?? []).forEach((c) => outParent.set(c, i)));
const worldOf = (i) => {
  let m = localMat(outNodes[i]);
  for (let p = outParent.get(i); p !== undefined; p = outParent.get(p)) m = mul(localMat(outNodes[p]), m);
  return m;
};

// Add a Jaw bone as a child of Head, hinged near the ear/TMJ (mouth slit at y=1.606, teeth y 1.594..1.638, face front z=0.125).
const headWorld = worldOf(headIdx);
const headInv = invMat(headWorld);
const JAW_WORLD = [0, 1.595, 0.0];
const jawLocal = [
  headInv[0] * JAW_WORLD[0] + headInv[4] * JAW_WORLD[1] + headInv[8] * JAW_WORLD[2] + headInv[12],
  headInv[1] * JAW_WORLD[0] + headInv[5] * JAW_WORLD[1] + headInv[9] * JAW_WORLD[2] + headInv[13],
  headInv[2] * JAW_WORLD[0] + headInv[6] * JAW_WORLD[1] + headInv[10] * JAW_WORLD[2] + headInv[14],
];
const jawIdx = outNodes.length;
outNodes.push({ name: 'Jaw', translation: jawLocal.map((x) => +x.toFixed(6)) });
(outNodes[headIdx].children ??= []).push(jawIdx);
outParent.set(jawIdx, headIdx);

// Map source skin joint index -> new skin joint index (dropped eyes fold into Head; dropped leaves fold into nearest kept ancestor).
const jointRemap = new Int32Array(srcJoints.length);
srcJoints.forEach((ni, k) => {
  let cur = ni;
  while (cur !== undefined && !srcToOutNode.has(cur)) cur = srcParent.get(cur);
  jointRemap[k] = cur !== undefined ? srcToOutNode.get(cur) : hipsIdx;
});

const skinJoints = outNodes.map((_, i) => i); // 0..jawIdx are all joints
const NB = skinJoints.length;
const ibm = new Float32Array(NB * 16);
for (let i = 0; i < NB; i++) ibm.set(invMat(worldOf(i)), i * 16);

// ------------------------------------------------------------------ mesh helpers
function readMesh(meshIdx, filterFn = null) {
  const prim = j.meshes[meshIdx].primitives[0];
  const pos = read(prim.attributes.POSITION);
  const nor = read(prim.attributes.NORMAL);
  const uv = read(prim.attributes.TEXCOORD_0);
  const jts = read(prim.attributes.JOINTS_0);
  const wts = read(prim.attributes.WEIGHTS_0);
  const idx = read(prim.indices);
  const nV = pos.length / 3;
  // Remap skin joints and merge duplicate joint entries per vertex.
  const rJ = new Uint8Array(nV * 4);
  const rW = new Float32Array(nV * 4);
  for (let v = 0; v < nV; v++) {
    const acc = new Map();
    for (let k = 0; k < 4; k++) {
      const w = wts[v * 4 + k];
      if (w <= 0) continue;
      const nj = jointRemap[jts[v * 4 + k]];
      acc.set(nj, (acc.get(nj) ?? 0) + w);
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, t) => s + t[1], 0) || 1;
    top.forEach(([b, w], k) => { rJ[v * 4 + k] = b; rW[v * 4 + k] = w / sum; });
    if (top.length === 0) { rJ[v * 4] = hipsIdx; rW[v * 4] = 1; }
  }
  let outIdx = idx;
  if (filterFn) {
    const keep = filterFn(pos, idx, nV);
    const f = [];
    for (let t = 0; t < idx.length; t += 3) {
      if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) f.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    outIdx = Uint32Array.from(f);
  }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), uv: Float32Array.from(uv), jts: rJ, wts: rW, idx: Uint32Array.from(outIdx) };
}

function mergeMeshes(list) {
  let totalV = 0, totalI = 0;
  for (const m of list) { totalV += m.pos.length / 3; totalI += m.idx.length; }
  const pos = new Float32Array(totalV * 3);
  const nor = new Float32Array(totalV * 3);
  const uv = new Float32Array(totalV * 2);
  const jts = new Uint8Array(totalV * 4);
  const wts = new Float32Array(totalV * 4);
  const idx = new Uint32Array(totalI);
  let vo = 0, io = 0;
  for (const m of list) {
    const nv = m.pos.length / 3;
    pos.set(m.pos, vo * 3);
    nor.set(m.nor, vo * 3);
    uv.set(m.uv, vo * 2);
    jts.set(m.jts, vo * 4);
    wts.set(m.wts, vo * 4);
    for (let i = 0; i < m.idx.length; i++) idx[io + i] = m.idx[i] + vo;
    vo += nv;
    io += m.idx.length;
  }
  return { pos, nor, uv, jts, wts, idx };
}

function compactAndSimplify(m, targetTris, maxErr = 0.05) {
  let idx = m.idx;
  if (targetTris && idx.length / 3 > targetTris) {
    const [simp] = MeshoptSimplifier.simplify(idx, m.pos, 3, targetTris * 3, maxErr);
    idx = simp;
  }
  const nV = m.pos.length / 3;
  const remap = new Int32Array(nV).fill(-1);
  const order = [];
  const newIdx = new Uint16Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    let id = remap[v];
    if (id < 0) { id = order.length; remap[v] = id; order.push(v); }
    newIdx[i] = id;
  }
  const cnt = order.length;
  if (cnt > 65535) throw new Error('too many vertices for u16 indices: ' + cnt);
  const pos = new Float32Array(cnt * 3);
  const nor = new Float32Array(cnt * 3);
  const uv = new Float32Array(cnt * 2);
  const jts = new Uint8Array(cnt * 4);
  const wts = new Uint16Array(cnt * 4);
  for (let i = 0; i < cnt; i++) {
    const v = order[i];
    pos.set(m.pos.subarray(v * 3, v * 3 + 3), i * 3);
    nor.set(m.nor.subarray(v * 3, v * 3 + 3), i * 3);
    uv.set(m.uv.subarray(v * 2, v * 2 + 2), i * 2);
    jts.set(m.jts.subarray(v * 4, v * 4 + 4), i * 4);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += m.wts[v * 4 + k];
    sum ||= 1;
    const q = [0, 1, 2, 3].map((k) => Math.round((m.wts[v * 4 + k] / sum) * 65535));
    q[0] += 65535 - q.reduce((s, x) => s + x, 0);
    for (let k = 0; k < 4; k++) wts[i * 4 + k] = q[k];
  }
  return { pos, nor, uv, jts, wts, idx: newIdx, count: cnt, tris: newIdx.length / 3 };
}

function setAllWeight(m, bone) {
  const nV = m.pos.length / 3;
  for (let v = 0; v < nV; v++) {
    m.jts[v * 4] = bone; m.jts[v * 4 + 1] = 0; m.jts[v * 4 + 2] = 0; m.jts[v * 4 + 3] = 0;
    m.wts[v * 4] = 1; m.wts[v * 4 + 1] = 0; m.wts[v * 4 + 2] = 0; m.wts[v * 4 + 3] = 0;
  }
}

// Smooth jaw weights for AvatarHead: lower lip, lower mouth interior and chin (below the mouth line at y~1.606; chin underside ~1.557).
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function applyHeadJawWeights(m) {
  const nV = m.pos.length / 3;
  let weighted = 0;
  for (let v = 0; v < nV; v++) {
    const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
    // Mouth line sits at y=1.606 at the midline and rises slightly toward the corners.
    const mouthY = 1.606 + Math.min(1, (Math.abs(x) / 0.035) ** 2) * 0.004;
    const belowMouth = smooth(mouthY + 0.002, mouthY - 0.003, y);
    const aboveThroat = smooth(1.545, 1.565, y);
    const inFront = smooth(0.015, 0.055, z);
    const inWidth = smooth(0.072, 0.038, Math.abs(x));
    const wJaw = belowMouth * aboveThroat * inFront * inWidth;
    if (wJaw < 0.01) continue;
    if (wJaw >= 0.5) weighted++;
    // Blend existing weights with Jaw.
    const acc = new Map([[jawIdx, wJaw]]);
    for (let k = 0; k < 4; k++) {
      const w = m.wts[v * 4 + k] * (1 - wJaw);
      if (w <= 0) continue;
      const b = m.jts[v * 4 + k];
      acc.set(b, (acc.get(b) ?? 0) + w);
    }
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, t) => s + t[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      m.jts[v * 4 + k] = top[k]?.[0] ?? 0;
      m.wts[v * 4 + k] = top[k] ? top[k][1] / sum : 0;
    }
  }
  console.log(`head jaw weights: ${weighted} vertices with w>=0.5`);
}

// ------------------------------------------------------------------ build & decimate meshes
await MeshoptSimplifier.ready;
const byMat = (name) => j.meshes.findIndex((m) => j.materials[m.primitives[0].material].name === name);

const headM = readMesh(byMat('AvatarHead'));
applyHeadJawWeights(headM);

const teethLowerM = readMesh(byMat('AvatarTeethLower'));
setAllWeight(teethLowerM, jawIdx);
const teethUpperM = readMesh(byMat('AvatarTeethUpper'));
setAllWeight(teethUpperM, headIdx);

const lashesM = readMesh(byMat('AvatarEyelashes'));

const builtMeshes = [
  { name: 'AvatarBody', matKey: 'body', data: compactAndSimplify(readMesh(byMat('AvatarBody')), 1800) },
  { name: 'AvatarHead', matKey: 'head', data: compactAndSimplify(headM, 3400) },
  { name: 'AvatarEyeballs', matKey: 'eyeballs', data: compactAndSimplify(mergeMeshes([readMesh(byMat('AvatarLeftEyeball')), readMesh(byMat('AvatarRightEyeball'))]), 500) },
  { name: 'AvatarTeeth', matKey: 'teeth', data: compactAndSimplify(mergeMeshes([teethUpperM, teethLowerM]), 500) },
  { name: 'Eyelashes', matKey: 'lashes', data: compactAndSimplify(lashesM, 600) },
  { name: 'Haircut', matKey: 'haircut', data: compactAndSimplify(readMesh(byMat('haircut')), 4500, 0.08) },
  { name: 'Outfit', matKey: 'outfit', data: compactAndSimplify(readMesh(byMat('outfit')), 7000) },
];

let totalTris = 0, totalVerts = 0;
for (const bm of builtMeshes) {
  totalTris += bm.data.tris;
  totalVerts += bm.data.count;
  console.log(`  ${bm.name.padEnd(16)} ${String(bm.data.count).padStart(5)} verts, ${String(bm.data.tris).padStart(5)} tris`);
}
console.log(`total geometry: ${totalVerts} verts, ${totalTris} tris`);

// ------------------------------------------------------------------ re-encode textures as resized JPEGs
const srcMat = (name) => j.materials.find((m) => m.name === name);
const texSpecs = [
  { key: 'body_c', img: j.textures[srcMat('AvatarBody').pbrMetallicRoughness.baseColorTexture.index].source, size: 512, q: 80 },
  { key: 'body_n', img: j.textures[srcMat('AvatarBody').normalTexture.index].source, size: 256, q: 82 },
  { key: 'head_c', img: j.textures[srcMat('AvatarHead').pbrMetallicRoughness.baseColorTexture.index].source, size: 768, q: 82 },
  { key: 'head_n', img: j.textures[srcMat('AvatarHead').normalTexture.index].source, size: 512, q: 84 },
  { key: 'eye_c', img: j.textures[srcMat('AvatarLeftEyeball').pbrMetallicRoughness.baseColorTexture.index].source, size: 256, q: 82 },
  { key: 'teeth_c', img: j.textures[srcMat('AvatarTeethUpper').pbrMetallicRoughness.baseColorTexture.index].source, size: 256, q: 78 },
  { key: 'hair_c', img: j.textures[srcMat('haircut').pbrMetallicRoughness.baseColorTexture.index].source, size: 512, q: 80 },
  { key: 'hair_n', img: j.textures[srcMat('haircut').normalTexture.index].source, size: 256, q: 82 },
  { key: 'outfit_c', img: j.textures[srcMat('outfit').pbrMetallicRoughness.baseColorTexture.index].source, size: 1024, q: 82 },
  { key: 'outfit_n', img: j.textures[srcMat('outfit').normalTexture.index].source, size: 512, q: 82 },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hale-'));
const jobs = texSpecs.map((t) => {
  const im = j.images[t.img];
  const bv = j.bufferViews[im.bufferView];
  const ext = im.mimeType === 'image/png' ? 'png' : 'jpg';
  const inp = path.join(tmp, `${t.key}_in.${ext}`);
  const out = path.join(tmp, `${t.key}.jpg`);
  fs.writeFileSync(inp, bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
  return { ...t, inp, out };
});

if (process.platform === 'win32') {
  const manifest = path.join(tmp, 'jobs.json');
  fs.writeFileSync(manifest, JSON.stringify(jobs.map(({ inp, out, size, q }) => ({ inp, out, size, q }))));
  const psScript = path.join(tmp, 'encode.ps1');
  fs.writeFileSync(psScript, `
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$qParam = [System.Drawing.Imaging.Encoder]::Quality
$jobs = Get-Content -Raw '${manifest.replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($job in $jobs) {
  $src = [System.Drawing.Bitmap]::new($job.inp)
  $w = [Math]::Min($src.Width, [int]$job.size)
  $h = [Math]::Min($src.Height, [int]$job.size)
  $dst = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $w, $h)
  $g.Dispose()
  $src.Dispose()
  $ep = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $ep.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new($qParam, [long]$job.q)
  $dst.Save($job.out, $codec, $ep)
  $dst.Dispose()
}
`);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript]);
} else {
  for (const job of jobs) {
    execFileSync('convert', [job.inp, '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-resize', `${job.size}x${job.size}>`, '-quality', String(job.q), '-sampling-factor', '4:2:0', '-strip', job.out]);
  }
}

const texBytes = new Map();
let totalTexBytes = 0;
for (const job of jobs) {
  const b = fs.readFileSync(job.out);
  texBytes.set(job.key, b);
  totalTexBytes += b.length;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`textures: ${jobs.length} JPEGs, ${(totalTexBytes / 1024).toFixed(0)} KB total`);

// ------------------------------------------------------------------ pack GLB
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
const acc = (view, componentType, type, n, extra = {}) => {
  accessors.push({ bufferView: view, componentType, type, count: n, ...extra });
  return accessors.length - 1;
};
const mm = (a, n) => {
  const min = new Array(n).fill(Infinity), max = new Array(n).fill(-Infinity);
  for (let i = 0; i < a.length; i++) { const k = i % n; if (a[i] < min[k]) min[k] = a[i]; if (a[i] > max[k]) max[k] = a[i]; }
  return { min, max };
};

const texIdx = new Map();
const images = [];
const textures = [];
for (const t of texSpecs) {
  const v = push(texBytes.get(t.key));
  texIdx.set(t.key, textures.length);
  images.push({ bufferView: v, mimeType: 'image/jpeg' });
  textures.push({ sampler: 0, source: images.length - 1 });
}

const matList = [
  ['body', { name: 'AvatarBody', pbrMetallicRoughness: { baseColorTexture: { index: texIdx.get('body_c') }, metallicFactor: 0, roughnessFactor: 0.72 }, normalTexture: { index: texIdx.get('body_n') } }],
  ['head', { name: 'AvatarHead', pbrMetallicRoughness: { baseColorTexture: { index: texIdx.get('head_c') }, metallicFactor: 0, roughnessFactor: 0.72 }, normalTexture: { index: texIdx.get('head_n') } }],
  ['eyeballs', { name: 'AvatarEyeballs', pbrMetallicRoughness: { baseColorTexture: { index: texIdx.get('eye_c') }, metallicFactor: 0, roughnessFactor: 0.45 } }],
  ['teeth', { name: 'AvatarTeeth', pbrMetallicRoughness: { baseColorTexture: { index: texIdx.get('teeth_c') }, metallicFactor: 0, roughnessFactor: 0.5 } }],
  ['lashes', { name: 'Eyelashes', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.05, 0.04, 0.04, 1], metallicFactor: 0, roughnessFactor: 0.5 } }],
  ['haircut', { name: 'haircut', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: texIdx.get('hair_c') }, metallicFactor: 0, roughnessFactor: 0.81 }, normalTexture: { index: texIdx.get('hair_n') } }],
  ['outfit', { name: 'outfit', doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: texIdx.get('outfit_c') }, metallicFactor: 0, roughnessFactor: 0.7 }, normalTexture: { index: texIdx.get('outfit_n') } }],
];
const matIndex = new Map(matList.map(([k], i) => [k, i]));
const materials = matList.map(([, m]) => m);

const meshes = [];
const sceneNodes = [hipsIdx];
for (const bm of builtMeshes) {
  const m = bm.data;
  const attrs = {
    POSITION: acc(push(Buffer.from(m.pos.buffer), { target: 34962 }), 5126, 'VEC3', m.count, mm(m.pos, 3)),
    NORMAL: acc(push(Buffer.from(m.nor.buffer), { target: 34962 }), 5126, 'VEC3', m.count),
    TEXCOORD_0: acc(push(Buffer.from(m.uv.buffer), { target: 34962 }), 5126, 'VEC2', m.count),
    JOINTS_0: acc(push(Buffer.from(m.jts.buffer), { target: 34962 }), 5121, 'VEC4', m.count),
    WEIGHTS_0: acc(push(Buffer.from(m.wts.buffer), { target: 34962 }), 5123, 'VEC4', m.count, { normalized: true }),
  };
  const idxAcc = acc(push(Buffer.from(m.idx.buffer), { target: 34963 }), 5123, 'SCALAR', m.idx.length);
  const meshId = meshes.length;
  meshes.push({ name: bm.name, primitives: [{ attributes: attrs, indices: idxAcc, material: matIndex.get(bm.matKey) }] });
  const nodeId = outNodes.length;
  outNodes.push({ name: bm.name, mesh: meshId, skin: 0 });
  sceneNodes.push(nodeId);
}

const ibmAcc = acc(push(Buffer.from(ibm.buffer)), 5126, 'MAT4', NB);
const glbJson = {
  asset: { version: '2.0', generator: 'scripts/fix-hale-glb.mjs', extras: j.asset.extras },
  scene: 0,
  scenes: [{ nodes: sceneNodes }],
  nodes: outNodes,
  meshes,
  skins: [{ joints: skinJoints, inverseBindMatrices: ibmAcc, skeleton: hipsIdx }],
  materials,
  textures,
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
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
console.log('wrote', dst, `${(glb.length / 1024).toFixed(0)} KB, ${totalTris} triangles, ${NB} bones`);

// Prepares BrushDip's "Doctor - Sketchfab Weekly - 13 Mar'23" GLB (CC-BY 4.0) for bodyModel.ts (ADR-0026) as Dr. Tomas Okafor's body.
//   node scripts/fix-doctor-glb.mjs <source.glb> [public/assets/models/squad/doctor.glb]
// The source is a hand-modelled, rigged character (3ds Max Biped, 33 joints, ~11.6k triangles, 4 materials, one 3.4 s clipboard
// animation that the game does not use). Its arms are modelled apart from the body, so it needs none of the scan pipeline's
// cutting; it keeps the artist's own skin weights. What it does:
//   - bakes the bind pose (Sketchfab's Z-up/FBX wrapper included) into metres, facing +Z, left at +X, feet at y = 0, 1.80 m tall;
//   - renames the Biped bones to the Mixamo names bodyModel maps (Bip001/Pelvis -> Hips, Clavicle -> Shoulder, Calf -> Leg, ...);
//   - adds a Jaw bone and weights the lower lip, chin and beard below the mouth to it (ADR-0027);
//   - replaces the mitten fingers (one bone for all four) with thumb/index/middle/ring/pinky chains measured off the modelled
//     fingers, left unweighted so bodyModel's finger auto-skin splits the hand (hand rig, ADR-0026), plus a forearm twist bone;
//     the fingers, modelled bent at the knuckles around the clipboard, are opened to a relaxed hand first;
//   - drops the glasses' lenses (a transmission material the game does not render), the clipboard and the pen (unskinned props);
//   - packs both texture sets (body 1024, head 512) side by side into one atlas at full resolution, re-encoded as WebP q95
//     (visually lossless), and the mesh with meshopt compression and quantised attributes. No triangle is removed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { readGlb, packBody, smooth } from './lib/scan-body.mjs';

const [src, dst = 'public/assets/models/squad/doctor.glb'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-doctor-glb.mjs <source.glb> [out.glb]');
const glb = readGlb(src);
const { j, read } = glb;

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
const xf = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const xfDir = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2]);
const parent = new Map();
j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const world = (i) => { let m = localMat(j.nodes[i]); for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = mul(localMat(j.nodes[p]), m); return m; };

// ------------------------------------------------------------------ bind pose in the source frame
const skin = j.skins[0];
// (scan-body's reader has no MAT4 type, so the inverse bind matrices are read directly.)
const ibmArr = (() => {
  const a = j.accessors[skin.inverseBindMatrices], bv = j.bufferViews[a.bufferView];
  const off = glb.bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return new Float32Array(glb.bin.buffer.slice(off, off + a.count * 64));
})();
const srcNames = skin.joints.map((n) => j.nodes[n].name.replace(/_\d+$/, ''));
const meshNodes = j.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined && n.skin !== undefined);
const Wm = world(meshNodes[0][1]); // every skinned mesh node shares the Sketchfab wrapper transform
const bindJoint = srcNames.map((_, k) => xf(mul(Wm, invMat(Array.from(ibmArr.subarray(k * 16, k * 16 + 16)))), [0, 0, 0]));

// Gather the meshes (lenses use material 0, the clipboard and pen are unskinned).
const MAT_BODY = j.materials.findIndex((m) => m.name === 'Material_4');
const MAT_HEAD = j.materials.findIndex((m) => m.name === 'Material_3');
const parts = [];
for (const [n] of meshNodes) {
  const mesh = j.meshes[n.mesh];
  const prim = mesh.primitives[0];
  if (prim.material !== MAT_BODY && prim.material !== MAT_HEAD) { console.log(`dropped ${mesh.name}`); continue; }
  parts.push({
    name: mesh.name, head: prim.material === MAT_HEAD,
    P: read(prim.attributes.POSITION), N: read(prim.attributes.NORMAL), UV: read(prim.attributes.TEXCOORD_0),
    JT: read(prim.attributes.JOINTS_0), WT: read(prim.attributes.WEIGHTS_0), I: read(prim.indices),
  });
}

// Final frame: metres, feet at 0, centred on the pelvis, 1.80 m tall (facing +Z and left at +X already hold).
let minY = Infinity, maxY = -Infinity;
for (const p of parts) for (let v = 0; v < p.P.length / 3; v++) { const y = xf(Wm, [p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]])[1]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const pelvisSrc = bindJoint[srcNames.indexOf('Bip001 Pelvis')];
const S = 1.8 / (maxY - minY);
const toFinal = (p) => [(p[0] - pelvisSrc[0]) * S, (p[1] - minY) * S, (p[2] - pelvisSrc[2]) * S];
const r4 = (p) => p.map((x) => +x.toFixed(4));

// ------------------------------------------------------------------ skeleton
const RENAME = {
  'Bip001 Pelvis': 'Hips', 'Bip001 Spine': 'Spine', 'Bip001 Spine1': 'Spine1', 'Bip001 Neck': 'Neck', 'Bip001 Head': 'Head',
  'Bip001 L Clavicle': 'LeftShoulder', 'Bip001 L UpperArm': 'LeftArm', 'Bip001 L Forearm': 'LeftForeArm', 'Bip001 L Hand': 'LeftHand',
  'Bip001 R Clavicle': 'RightShoulder', 'Bip001 R UpperArm': 'RightArm', 'Bip001 R Forearm': 'RightForeArm', 'Bip001 R Hand': 'RightHand',
  'Bip001 L Thigh': 'LeftUpLeg', 'Bip001 L Calf': 'LeftLeg', 'Bip001 L Foot': 'LeftFoot', 'Bip001 L Toe0': 'LeftToeBase',
  'Bip001 R Thigh': 'RightUpLeg', 'Bip001 R Calf': 'RightLeg', 'Bip001 R Foot': 'RightFoot', 'Bip001 R Toe0': 'RightToeBase',
};
// Everything else folds into its owner: the root and Bip001 into Hips, fingers and the prop dummies into their hand.
const owner = (nm) => RENAME[nm] ?? (/ L (Finger|Hand)|Dummy001/.test(nm) ? 'LeftHand' : / R (Finger|Hand)|Dummy002/.test(nm) ? 'RightHand' : 'Hips');
const J = {};
for (const [s, t] of Object.entries(RENAME)) J[t] = r4(toFinal(bindJoint[srcNames.indexOf(s)]));
const PARENT = {
  Hips: null, Spine: 'Hips', Spine1: 'Spine', Neck: 'Spine1', Head: 'Neck', Jaw: 'Head',
  LeftShoulder: 'Spine1', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm', LeftForeArmTwist1: 'LeftForeArm', LeftHand: 'LeftForeArm',
  RightShoulder: 'Spine1', RightArm: 'RightShoulder', RightForeArm: 'RightArm', RightForeArmTwist1: 'RightForeArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToeBase: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg', RightToeBase: 'RightFoot',
};

// ------------------------------------------------------------------ geometry in the final frame
// UVs that tile (mirrored shoe and hand, buttons) are moved into [0, 1] per triangle; a vertex shared by triangles in different
// tiles is split. The body texture fills the atlas's left 1024 px, the head's 512 px sit at its top right.
const ATLAS_W = 1536, ATLAS_H = 1024;
const pos = [], nor = [], uv = [], indices = [], vJ = [], isHead = [], vPart = [], vDom = [];
const srcJointName = srcNames.map(owner);
for (const p of parts) {
  const map = new Map();
  for (let t = 0; t < p.I.length; t += 3) {
    const tri = [p.I[t], p.I[t + 1], p.I[t + 2]];
    const su = Math.floor(Math.min(...tri.map((v) => p.UV[v * 2]))), sv = Math.floor(Math.min(...tri.map((v) => p.UV[v * 2 + 1])));
    for (const v of tri) {
      const key = `${v}|${su}|${sv}`;
      let id = map.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        map.set(key, id);
        pos.push(...toFinal(xf(Wm, [p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]])));
        const n = xfDir(Wm, [p.N[v * 3], p.N[v * 3 + 1], p.N[v * 3 + 2]]), nl = Math.hypot(...n) || 1;
        nor.push(n[0] / nl, n[1] / nl, n[2] / nl);
        const u = p.UV[v * 2] - su, w = p.UV[v * 2 + 1] - sv;
        if (p.head) uv.push((1024 + u * 512) / ATLAS_W, (w * 512) / ATLAS_H); else uv.push((u * 1024) / ATLAS_W, w);
        const acc = new Map();
        for (let k = 0; k < 4; k++) { const wt = p.WT[v * 4 + k]; if (wt > 0) { const b = srcJointName[p.JT[v * 4 + k]]; acc.set(b, (acc.get(b) ?? 0) + wt); } }
        vJ.push(acc); isHead.push(p.head); vPart.push(p.name);
        let dom = 0;
        for (let k = 1; k < 4; k++) if (p.WT[v * 4 + k] > p.WT[v * 4 + dom]) dom = k;
        vDom.push(srcNames[p.JT[v * 4 + dom]]);
      }
      indices.push(id);
    }
  }
}
const nV = pos.length / 3;
const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];

// ------------------------------------------------------------------ jaw
// Measured off the head mesh (final frame): mouth slit y 1.601 at the midline, chin underside 1.546, face front z 0.13. The hinge
// sits ahead of the ear, a little below the mouth line, as on Hale.
J.Jaw = r4([0, 1.592, 0.02]);
const MOUTH_Y = 1.601;
let jawCount = 0;
for (let v = 0; v < nV; v++) {
  if (!isHead[v]) continue;
  const [x, y, z] = P(v);
  const mouthY = MOUTH_Y + Math.min(1, (Math.abs(x) / 0.03) ** 2) * 0.004;
  const w = smooth(mouthY + 0.002, mouthY - 0.004, y) * smooth(1.52, 1.545, y) * smooth(0.03, 0.075, z) * smooth(0.075, 0.045, Math.abs(x));
  if (w < 0.01) continue;
  const acc = vJ[v];
  for (const [b, wt] of acc) acc.set(b, wt * (1 - w));
  acc.set('Jaw', (acc.get('Jaw') ?? 0) + w);
  if (w >= 0.5) jawCount++;
}
console.log(`jaw: ${jawCount} vertices mostly on the jaw`);

// ------------------------------------------------------------------ fingers
// The source hand has one bone for all four fingers. Each finger is found from the modelled mesh: the finger vertices (beyond the
// source's finger joint) are split along the palm's width into four, and each finger's chain (knuckle, middle, end, tip) is the
// centroid of slices along it. The fingers are modelled bent 40-70° at the knuckles (a holding pose); the hand rig curls fingers
// but cannot open a bend baked into the mesh (and the bend tilts the calibrated curl axes), so each finger swings about its knuckle
// toward the hand's axis (wrist -> middle knuckle), keeping a fifth of the bend: a relaxed hand. The thumb keeps its own joints plus
// a fitted end and tip. Chains are left unweighted for bodyModel's finger auto-skin.
const KEEP_BEND = 0.2;
const pca = (pts) => {
  const c = [0, 1, 2].map((k) => pts.reduce((s2, p) => s2 + p[k], 0) / pts.length);
  const C = [0, 1, 2].map((a) => [0, 1, 2].map((b) => pts.reduce((s2, p) => s2 + (p[a] - c[a]) * (p[b] - c[b]), 0)));
  let e = [1, 0.3, 0.2];
  for (let it = 0; it < 60; it++) { e = [0, 1, 2].map((r) => C[r][0] * e[0] + C[r][1] * e[1] + C[r][2] * e[2]); const l = Math.hypot(...e); e = e.map((x) => x / l); }
  return { c, e };
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rotate = (v, axis, ang) => {
  const c = Math.cos(ang), s2 = Math.sin(ang), d = dot(axis, v), x = cross(axis, v);
  return [0, 1, 2].map((k) => v[k] * c + x[k] * s2 + axis[k] * d * (1 - c));
};
const centroidOf = (ps) => [0, 1, 2].map((k) => ps.reduce((s2, p) => s2 + p[k], 0) / ps.length);
for (const side of ['Left', 'Right']) {
  const s = side[0];
  const handVerts = [];
  for (let v = 0; v < nV; v++) if (vPart[v].startsWith(`hand_${s}`)) handVerts.push(v);
  const jt = (nm) => toFinal(bindJoint[srcNames.indexOf(nm)]);
  const hand = J[`${side}Hand`], f1 = jt(`Bip001 ${s} Finger1`), t1 = jt(`Bip001 ${s} Finger0`), t2 = jt(`Bip001 ${s} Finger01`);
  const axis = norm(sub(f1, hand));
  // Finger vertices: the mitten finger bones' vertices plus hand vertices past the knuckle line (the source paints the proximal
  // phalanges partly on the hand, and the right hand's fingers entirely).
  const knuckleT = dot(sub(f1, hand), axis) - 0.012;
  const fingers = handVerts.filter((v) => /Finger1/.test(vDom[v]) || (/Hand$/.test(vDom[v]) && dot(sub(P(v), hand), axis) > knuckleT));
  const across = pca(fingers.map((v) => { const d = sub(P(v), f1), t = dot(d, axis); return [d[0] - axis[0] * t, d[1] - axis[1] * t, d[2] - axis[2] * t]; })).e;
  const c = fingers.map((v) => dot(sub(P(v), f1), across));
  const sorted = [...c].sort((a, b) => a - b);
  let means = [0.125, 0.375, 0.625, 0.875].map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
  let label = c.map(() => 0);
  for (let it = 0; it < 30; it++) {
    label = c.map((x) => means.reduce((bi, m, i) => (Math.abs(x - m) < Math.abs(x - means[bi]) ? i : bi), 0));
    means = means.map((m, i) => { const xs = c.filter((_, k) => label[k] === i); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : m; });
  }
  const order = [0, 1, 2, 3].sort((a, b) => means[a] - means[b]);
  const clusterPts = (i) => fingers.filter((_, k) => label[k] === i).map(P);
  if (Math.hypot(...sub(centroidOf(clusterPts(order[3])), t1)) < Math.hypot(...sub(centroidOf(clusterPts(order[0])), t1))) order.reverse();
  const NAMES = ['Index', 'Middle', 'Ring', 'Pinky'];
  const chainOf = (ps, handPt) => {
    const { e } = pca(ps);
    const dir = dot(e, axis) < 0 ? e.map((x) => -x) : e;
    const ts = ps.map((p) => dot(sub(p, handPt), dir));
    const t0 = Math.min(...ts), L = Math.max(...ts) - t0;
    const slice = (a, b) => centroidOf(ps.filter((_, k) => ts[k] >= t0 + a * L && ts[k] <= t0 + b * L));
    return [slice(0, 0.12), slice(0.4, 0.5), slice(0.68, 0.76), slice(0.93, 1)];
  };
  let chains = NAMES.map((_, fi) => chainOf(clusterPts(order[fi]), hand));
  // Fingers splay and converge, so a single across-the-palm split mislabels the tips: reassign each vertex to the nearest fitted
  // centreline and refit, twice.
  const segDist = (p, a, b) => { const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1))); return Math.hypot(...sub(p, a.map((x, k) => x + ab[k] * t))); };
  const lineDist = (p, ch) => Math.min(segDist(p, ch[0], ch[1]), segDist(p, ch[1], ch[2]), segDist(p, ch[2], ch[3]));
  for (let pass = 0; pass < 2; pass++) {
    label = fingers.map((v) => { const p = P(v); let bi = 0; chains.forEach((ch, fi) => { if (lineDist(p, ch) < lineDist(p, chains[bi])) bi = fi; }); return order[bi]; });
    chains = NAMES.map((_, fi) => chainOf(clusterPts(order[fi]), hand));
  }
  // Open each finger about its knuckle toward the hand's axis (wrist -> middle knuckle).
  const handAxis = norm(sub(chains[1][0], hand));
  const report = [];
  NAMES.forEach((name, fi) => {
    const [k1, k2] = chains[fi];
    const d1 = norm(sub(k2, k1));
    const bend = Math.acos(Math.min(1, dot(d1, handAxis)));
    const rotAxis = norm(cross(d1, handAxis));
    const ang = bend * (1 - KEEP_BEND);
    const verts = fingers.filter((_, k) => label[k] === order[fi]);
    for (const v of verts) {
      const p = P(v), t = dot(sub(p, k1), d1), w = smooth(-0.006, 0.01, t);
      if (w <= 0) continue;
      const q = rotate(sub(p, k1), rotAxis, ang * w);
      for (let k = 0; k < 3; k++) pos[v * 3 + k] = k1[k] + q[k];
      const n = rotate([nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]], rotAxis, ang * w);
      for (let k = 0; k < 3; k++) nor[v * 3 + k] = n[k];
    }
    const chain = chains[fi].map((p, k) => (k === 0 ? p : rotate(sub(p, k1), rotAxis, ang).map((x, a) => x + k1[a])));
    chain.forEach((p, k) => { const nm = `${side}Hand${name}${k + 1}`; J[nm] = r4(p); PARENT[nm] = k ? `${side}Hand${name}${k}` : `${side}Hand`; });
    report.push(`${name} ${verts.length} verts ${Math.round((bend * 180) / Math.PI)}°`);
  });
  const thumbTip = handVerts.filter((v) => /Finger01/.test(vDom[v])).map(P).reduce((b, p) => (Math.hypot(...sub(p, t1)) > Math.hypot(...sub(b, t1)) ? p : b), t2);
  [t1, t2, t2.map((x, k) => x + (thumbTip[k] - x) * 0.55), thumbTip].forEach((p, k) => {
    const nm = `${side}HandThumb${k + 1}`; J[nm] = r4(p); PARENT[nm] = k ? `${side}HandThumb${k}` : `${side}Hand`;
  });
  J[`${side}ForeArmTwist1`] = r4(J[`${side}ForeArm`].map((x, k) => (x + J[`${side}Hand`][k]) / 2));
  console.log(`${side} fingers opened (${KEEP_BEND * 100}% of the knuckle bend kept): ${report.join(', ')}`);
}

// ------------------------------------------------------------------ skin
const names = Object.keys(PARENT);
const boneIndex = new Map(names.map((n, i) => [n, i]));
const joints = new Uint8Array(nV * 4), weights = new Uint16Array(nV * 4);
for (let v = 0; v < nV; v++) {
  const top = [...vJ[v].entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = top.reduce((s, t) => s + t[1], 0) || 1;
  const q = top.map(([, w]) => Math.round((w / sum) * 65535));
  if (q.length) q[0] += 65535 - q.reduce((s, x) => s + x, 0);
  top.forEach(([b, w], k) => { joints[v * 4 + k] = boneIndex.get(b); weights[v * 4 + k] = q[k]; });
}

// ------------------------------------------------------------------ textures: one atlas, full resolution
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
const imgFile = (texIndex, key) => { const f = path.join(tmp, `${key}.png`); fs.writeFileSync(f, glb.imageBytes(texIndex)); return f; };
const bodyMat = j.materials[MAT_BODY], headMat = j.materials[MAT_HEAD];
const atlas = (bodyTex, headTex, fill, key) => {
  const out = path.join(tmp, `${key}.webp`);
  execFileSync('convert', ['-size', `${ATLAS_W}x${ATLAS_H}`, `xc:${fill}`,
    imgFile(bodyTex, `${key}_b`), '-geometry', '+0+0', '-composite',
    imgFile(headTex, `${key}_h`), '-geometry', '+1024+0', '-composite',
    '-quality', '95', '-define', 'webp:method=6', '-strip', out]);
  return fs.readFileSync(out);
};
const color = atlas(bodyMat.pbrMetallicRoughness.baseColorTexture.index, headMat.pbrMetallicRoughness.baseColorTexture.index, '#808080', 'color');
const normal = atlas(bodyMat.normalTexture.index, headMat.normalTexture.index, '#8080ff', 'normal');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`textures: color ${(color.length / 1024).toFixed(0)} KB, normal ${(normal.length / 1024).toFixed(0)} KB (${ATLAS_W}x${ATLAS_H} WebP q95)`);

await packBody({
  dst,
  meshName: 'Okafor',
  materialName: 'doctor',
  generator: 'scripts/fix-doctor-glb.mjs',
  extras: j.asset.extras,
  body: { pos, nor, uv, indices },
  skin: { names, parentOf: (n) => PARENT[n], joints, weights },
  J,
  color,
  normal,
  // The coat's lapels, hem and cuffs are single sheets, modelled to be seen from both sides (as in the source material).
  doubleSided: true,
});

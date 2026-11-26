// Shared pipeline for turning an unrigged scan GLB (Sketchfab photogrammetry/AI exports such as restore50's) into a skinned
// body for bodyModel.ts (ADR-0026). Used by the scan scripts (scripts/fix-ruiz-glb.mjs, ...); scripts/fix-doctor-glb.mjs borrows
// its reader and packer for a rigged model.
//
//   readGlb -> bakeScan (Y-up metres, feet on y = 0, facing +Z, left at +X; chunks welded by position + UV)
//   -> optional edits (vertexColors / removeTriangles / dropIslands / capHoles / rotateRegion)
//   -> decimate -> skinScan (Mixamo-named skeleton, distance-field weights, Laplacian smoothing, jaw mask)
//   -> packBody (EXT_meshopt_compression + KHR_mesh_quantization + EXT_texture_webp, like the gltf-transform output of the
//      other squad bodies).
// Needs ImageMagick (`convert`, with WebP support) for texture decoding and re-encoding.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rigHands, splitHands } from './hand-rig.mjs';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';
import { MeshoptEncoder } from 'meshoptimizer/meshopt_encoder.module.js';

// ------------------------------------------------------------------ read
const COMP = { 5121: [1, 'getUint8'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readGlb(file) {
  const d = fs.readFileSync(file);
  const jsonLen = d.readUInt32LE(12);
  const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = d.subarray(20 + jsonLen + 8);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = (ai) => {
    const a = j.accessors[ai];
    const bv = j.bufferViews[a.bufferView];
    const [size, fn] = COMP[a.componentType];
    const n = NCOMP[a.type];
    const stride = bv.byteStride ?? size * n;
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * n);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) out[i * n + k] = dv[fn](base + i * stride + k * size, true);
    return out;
  };
  const imageBytes = (textureIndex) => {
    const bv = j.bufferViews[j.images[j.textures[textureIndex].source].bufferView];
    return bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  };
  return { j, bin, read, imageBytes };
}

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Bakes every mesh node's world transform (Sketchfab's Z-up wrapper included) and the base colour's KHR_texture_transform into
 * one welded triangle soup: P/N (xyz), UV (uv), tris (indices). Vertices are welded by exact (position, UV), so chunk borders join
 * but UV seams stay split. Feet are moved to y = 0.
 */
export function bakeScan({ j, read }) {
  const parent = new Map();
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const local = (n) => {
    if (n.matrix) return n.matrix;
    if (n.translation || n.rotation || n.scale) throw new Error('bakeScan: TRS nodes are not supported (Sketchfab exports use matrices)');
    return I4;
  };
  const world = (i) => {
    let m = local(j.nodes[i]);
    for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = mul(local(j.nodes[p]), m);
    return m;
  };
  const tt = j.materials[0].pbrMetallicRoughness.baseColorTexture?.extensions?.KHR_texture_transform;
  const [uOff, vOff] = tt?.offset ?? [0, 0];
  const [uScale, vScale] = tt?.scale ?? [1, 1];

  const meshNodes = j.nodes.map((n, i) => [n, i]).filter(([n]) => n.mesh !== undefined);
  let minY = Infinity;
  for (const [node, ni] of meshNodes) {
    const m = world(ni);
    for (const prim of j.meshes[node.mesh].primitives) {
      const pos = read(prim.attributes.POSITION);
      for (let v = 0; v < pos.length / 3; v++) minY = Math.min(minY, m[1] * pos[v * 3] + m[5] * pos[v * 3 + 1] + m[9] * pos[v * 3 + 2] + m[13]);
    }
  }
  const vertMap = new Map();
  const P = [], N = [], UV = [], tris = [];
  for (const [node, ni] of meshNodes) {
    const m = world(ni);
    for (const prim of j.meshes[node.mesh].primitives) {
      const pos = read(prim.attributes.POSITION);
      const nor = read(prim.attributes.NORMAL);
      const uv = read(prim.attributes.TEXCOORD_0);
      const idx = read(prim.indices);
      const remap = new Int32Array(pos.length / 3).fill(-1);
      const vertex = (v) => {
        if (remap[v] >= 0) return remap[v];
        const u = uv[v * 2] * uScale + uOff;
        const w = uv[v * 2 + 1] * vScale + vOff;
        const key = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}|${u.toFixed(5)},${w.toFixed(5)}`;
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
          UV.push(u, w);
        }
        remap[v] = id;
        return id;
      };
      for (let t = 0; t < idx.length; t += 3) {
        const a = vertex(idx[t]), b = vertex(idx[t + 1]), c = vertex(idx[t + 2]);
        if (a !== b && b !== c && a !== c) tris.push(a, b, c);
      }
    }
  }
  console.log(`baked: ${P.length / 3} vertices, ${tris.length / 3} triangles`);
  return { P, N, UV, tris };
}

// ------------------------------------------------------------------ textures
let imagemagickCmd = null;
/**
 * Runs ImageMagick: `magick` (version 7, the only command its Windows installer adds by default, where `convert` is the system's
 * disk tool) when it is on the path, otherwise the legacy `convert`.
 */
function imagemagick(args, input) {
  if (!imagemagickCmd) {
    try {
      execFileSync('magick', ['-version'], { stdio: 'ignore' });
      imagemagickCmd = 'magick';
    } catch {
      imagemagickCmd = 'convert';
    }
  }
  return execFileSync(imagemagickCmd, args, { input, maxBuffer: 1 << 28 });
}

/** Decodes any image ImageMagick reads into 8-bit RGB. */
export function decodeImage(bytes) {
  const ppm = imagemagick(['-', '-depth', '8', 'ppm:-'], bytes);
  // P6\n<w> <h>\n<max>\n<data>
  let off = 0;
  const tok = () => {
    while (/\s/.test(String.fromCharCode(ppm[off]))) off++;
    if (ppm[off] === 0x23) { while (ppm[off] !== 0x0a) off++; return tok(); }
    const s = off;
    while (!/\s/.test(String.fromCharCode(ppm[off]))) off++;
    return ppm.subarray(s, off).toString('latin1');
  };
  if (tok() !== 'P6') throw new Error('decodeImage: expected P6');
  const w = Number(tok()), h = Number(tok());
  tok();
  off++;
  return { w, h, data: ppm.subarray(off, off + w * h * 3) };
}

/** Per-vertex base colour (0..1 RGB, nearest texel; glTF UVs have their origin at the image's top left). */
export function vertexColors(img, UV) {
  const n = UV.length / 2;
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const u = UV[v * 2] - Math.floor(UV[v * 2]), w = UV[v * 2 + 1] - Math.floor(UV[v * 2 + 1]);
    const x = Math.min(img.w - 1, Math.floor(u * img.w)), y = Math.min(img.h - 1, Math.floor(w * img.h));
    const p = (y * img.w + x) * 3;
    out[v * 3] = img.data[p] / 255; out[v * 3 + 1] = img.data[p + 1] / 255; out[v * 3 + 2] = img.data[p + 2] / 255;
  }
  return out;
}

/** Re-encodes an image as WebP no larger than `maxDim` px. */
export function encodeWebp(bytes, maxDim, quality) {
  return imagemagick(['-', '-resize', `${maxDim}x${maxDim}>`, '-quality', String(quality), '-strip', 'webp:-'], bytes);
}

// ------------------------------------------------------------------ mesh edits (all operate on { P, N, UV, tris } in place)
const posKeyer = (P) => {
  const ids = new Int32Array(P.length / 3);
  const map = new Map();
  for (let v = 0; v < ids.length; v++) {
    const key = `${P[v * 3]},${P[v * 3 + 1]},${P[v * 3 + 2]}`;
    let id = map.get(key);
    if (id === undefined) { id = map.size; map.set(key, id); }
    ids[v] = id;
  }
  return ids;
};

function compact(mesh) {
  const { P, N, UV, tris } = mesh;
  const remap = new Int32Array(P.length / 3).fill(-1);
  const nP = [], nN = [], nUV = [];
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    if (remap[v] < 0) {
      remap[v] = nP.length / 3;
      nP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      nN.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
      nUV.push(UV[v * 2], UV[v * 2 + 1]);
    }
    tris[i] = remap[v];
  }
  mesh.P = nP; mesh.N = nN; mesh.UV = nUV;
  return remap;
}

/** Drops every triangle for which `pred(a, b, c)` (vertex indices) is true. Returns the set of removed edge keys for capHoles. */
export function removeTriangles(mesh, pred, label = 'removed') {
  const pid = posKeyer(mesh.P);
  const kept = [];
  const cut = new Set();
  let n = 0;
  for (let t = 0; t < mesh.tris.length; t += 3) {
    const [a, b, c] = [mesh.tris[t], mesh.tris[t + 1], mesh.tris[t + 2]];
    if (pred(a, b, c)) {
      n++;
      for (const [x, y] of [[a, b], [b, c], [c, a]]) cut.add(`${pid[x]}_${pid[y]}`);
      continue;
    }
    kept.push(a, b, c);
  }
  mesh.tris = kept;
  console.log(`${label}: ${n} triangles`);
  return cut;
}

/** Position-connected islands; drops each island for which `drop({ count, min, max })` is true. */
export function dropIslands(mesh, drop, label = 'islands dropped') {
  const pid = posKeyer(mesh.P);
  const n = pid.reduce((m, x) => Math.max(m, x), 0) + 1;
  const par = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const tris = mesh.tris;
  for (let t = 0; t < tris.length; t += 3) {
    const a = find(pid[tris[t]]), b = find(pid[tris[t + 1]]), c = find(pid[tris[t + 2]]);
    par[b] = a; par[find(c)] = a;
  }
  const info = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    const r = find(pid[tris[t]]);
    let s = info.get(r);
    if (!s) info.set(r, (s = { count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    s.count++;
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
      const x = mesh.P[tris[t + k] * 3 + a];
      s.min[a] = Math.min(s.min[a], x); s.max[a] = Math.max(s.max[a], x);
    }
  }
  const dead = new Set([...info].filter(([, s]) => drop(s)).map(([r]) => r));
  let removed = 0;
  const kept = [];
  for (let t = 0; t < tris.length; t += 3) {
    if (dead.has(find(pid[tris[t]]))) { removed++; continue; }
    kept.push(tris[t], tris[t + 1], tris[t + 2]);
  }
  mesh.tris = kept;
  console.log(`${label}: ${dead.size} of ${info.size} islands, ${removed} triangles`);
}

/**
 * Closes the openings left by removeTriangles: walks boundary loops (by position, so UV seams do not break them) made of edges
 * that bordered a removed triangle, and fans each loop of at most `maxLoop` metres around its centroid. The cap borrows the UV of
 * the loop vertex nearest the centroid for every cap vertex, so it is one flat patch of the surrounding cloth colour.
 * `pick(rimVertices, centroid)` may choose that vertex instead (e.g. by texture colour), or return undefined to leave the loop open.
 */
export function capHoles(mesh, cut, { maxLoop = 1.0, label = 'capped', pick } = {}) {
  const pid = posKeyer(mesh.P);
  const edgeCount = new Map();
  const tris = mesh.tris;
  for (let t = 0; t < tris.length; t += 3) {
    for (const [x, y] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) {
      const k = `${pid[x]}_${pid[y]}`;
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  }
  // Boundary: directed edge a->b with no b->a. Map position id -> next position id, and to a representative vertex index.
  const next = new Map();
  const rep = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    for (const [x, y] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) {
      const a = pid[x], b = pid[y];
      if (edgeCount.has(`${b}_${a}`)) continue;
      if (!cut.has(`${a}_${b}`) && !cut.has(`${b}_${a}`)) continue;
      next.set(a, b);
      rep.set(a, x);
      if (!rep.has(b)) rep.set(b, y);
    }
  }
  const seen = new Set();
  let caps = 0, skipped = 0;
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let cur = start;
    while (cur !== undefined && !seen.has(cur)) { seen.add(cur); loop.push(cur); cur = next.get(cur); }
    if (loop.length < 3 || cur !== start) { skipped++; continue; }
    const vs = loop.map((p) => rep.get(p));
    let len = 0;
    const c = [0, 0, 0];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      len += Math.hypot(mesh.P[a * 3] - mesh.P[b * 3], mesh.P[a * 3 + 1] - mesh.P[b * 3 + 1], mesh.P[a * 3 + 2] - mesh.P[b * 3 + 2]);
      for (let k = 0; k < 3; k++) c[k] += mesh.P[a * 3 + k] / vs.length;
    }
    if (len > maxLoop) { skipped++; continue; }
    let best = vs[0], bd = Infinity;
    const nrm = [0, 0, 0];
    for (const v of vs) {
      const d = Math.hypot(mesh.P[v * 3] - c[0], mesh.P[v * 3 + 1] - c[1], mesh.P[v * 3 + 2] - c[2]);
      if (d < bd) { bd = d; best = v; }
      for (let k = 0; k < 3; k++) nrm[k] += mesh.N[v * 3 + k];
    }
    if (pick) {
      best = pick(vs, c);
      if (best === undefined) { skipped++; continue; }
    }
    const l = Math.hypot(...nrm) || 1;
    const n = [nrm[0] / l, nrm[1] / l, nrm[2] / l];
    const u = [mesh.UV[best * 2], mesh.UV[best * 2 + 1]];
    // The cap is its own flat patch: rim duplicates (same positions, so no crack) all share the one cloth texel.
    const add = (p) => { mesh.P.push(...p); mesh.N.push(...n); mesh.UV.push(...u); return mesh.P.length / 3 - 1; };
    const cid = add(c);
    const rim = vs.map((v) => add([mesh.P[v * 3], mesh.P[v * 3 + 1], mesh.P[v * 3 + 2]]));
    for (let i = 0; i < rim.length; i++) tris.push(rim[(i + 1) % rim.length], rim[i], cid);
    caps++;
  }
  console.log(`${label}: ${caps} openings (${skipped} open or oversized loops left)`);
}

/** Turns vertices about a vertical axis through (pivot[0], *, pivot[1]) by `angle * weight(x, y, z)` radians; a positive angle swings +Z toward +X. */
export function rotateRegion(mesh, angle, pivot, weight) {
  let n = 0;
  for (let v = 0; v < mesh.P.length / 3; v++) {
    const [x, y, z] = [mesh.P[v * 3], mesh.P[v * 3 + 1], mesh.P[v * 3 + 2]];
    const w = weight(x, y, z);
    if (w <= 0) continue;
    n++;
    const a = angle * w, c = Math.cos(a), s = Math.sin(a);
    const dx = x - pivot[0], dz = z - pivot[1];
    mesh.P[v * 3] = pivot[0] + dx * c + dz * s;
    mesh.P[v * 3 + 2] = pivot[1] - dx * s + dz * c;
    const nx = mesh.N[v * 3], nz = mesh.N[v * 3 + 2];
    mesh.N[v * 3] = nx * c + nz * s;
    mesh.N[v * 3 + 2] = -nx * s + nz * c;
  }
  console.log(`rotated: ${n} vertices`);
}

// ------------------------------------------------------------------ decimate
/**
 * Simplifies region by region and compacts. Returns { pos, nor, uv, indices }.
 * regions: [{ name, test(x, y, z) on the triangle centroid, error }] (first match wins; the last region should match everything).
 * `error` is meshopt's relative error (fraction of the mesh extent), so a region keeps whatever detail that error bound allows:
 * smooth skin no longer collapses to a few big facets while noisy hair keeps the budget. Region borders are locked, so the pieces
 * stitch back without cracks. UV seams are preserved by the simplifier (these scans' atlases are fragmented, so seams, not the
 * error bound, are often what stops it).
 */
export async function decimate(mesh, regions) {
  compact(mesh);
  await MeshoptSimplifier.ready;
  const P = new Float32Array(mesh.P);
  const buckets = regions.map(() => []);
  const t = mesh.tris;
  for (let i = 0; i < t.length; i += 3) {
    const c = [0, 1, 2].map((k) => (P[t[i] * 3 + k] + P[t[i + 1] * 3 + k] + P[t[i + 2] * 3 + k]) / 3);
    const r = regions.findIndex((g) => g.test(c[0], c[1], c[2]));
    if (r < 0) throw new Error('decimate: a triangle matched no region');
    buckets[r].push(t[i], t[i + 1], t[i + 2]);
  }
  const out = [];
  regions.forEach((g, r) => {
    const idx = new Uint32Array(buckets[r]);
    if (!idx.length) return;
    const [simp, err] = MeshoptSimplifier.simplify(idx, P, 3, 0, g.error, ['LockBorder']);
    console.log(`simplified ${g.name}: ${idx.length / 3} -> ${simp.length / 3} triangles (error ${err.toFixed(5)})`);
    for (const v of simp) out.push(v);
  });
  const m = { P: mesh.P, N: mesh.N, UV: mesh.UV, tris: out };
  compact(m);
  const count = m.P.length / 3;
  console.log(`decimated: ${out.length / 3} triangles, ${count} vertices`);
  if (count > 65535) throw new Error('too many vertices for u16 indices: ' + count);
  return { pos: m.P, nor: m.N, uv: m.UV, indices: m.tris };
}

// ------------------------------------------------------------------ arm / body separation
// openspec imported-body-models, "Scan bodies move their arms without dragging the torso": the scans are one closed shell, so
// wherever an arm touched the body the surface runs torso -> crease -> arm with nothing behind it. labelArms decides which
// triangles belong to each arm; splitArms (below) cuts the shared surface below the armpit and caps both openings.
export const ARM_SIDES = ['Left', 'Right'];
export const armChain = (side) => [`${side}Arm`, `${side}ForeArm`, `${side}Hand`];

/** Capsule set used for skinning and labelling: skinned bone names, their segments and radii (see skinScan). */
export function capsuleSet(J, BONES) {
  const skinned = Object.keys(BONES).filter((n) => !n.endsWith('End'));
  const segs = skinned.map((n) => {
    const [, end] = BONES[n];
    const a = J[n];
    if (end) return [a, J[end]];
    const p = J[BONES[n][0]];
    const d = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
    const l = Math.hypot(...d) || 1;
    return [a, [a[0] + (d[0] / l) * 0.07, a[1] + (d[1] / l) * 0.07, a[2] + (d[2] / l) * 0.07]];
  });
  return { skinned, segs, rad: skinned.map((n) => BONES[n][2]) };
}

/** Exact-position weld ids for a { pos } body. */
function weldIds(pos) {
  const n = pos.length / 3, ids = new Int32Array(n), map = new Map();
  for (let v = 0; v < n; v++) {
    const k = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
    let id = map.get(k);
    if (id === undefined) { id = map.size; map.set(k, id); }
    ids[v] = id;
  }
  return ids;
}

/** Triangle neighbours across welded edges: Int32Array(nTri * 3), -1 where an edge has no (or more than one) neighbour. */
function triNeighbours(indices, wid) {
  const nT = indices.length / 3, edge = new Map(), nb = new Int32Array(nT * 3).fill(-1);
  for (let t = 0; t < nT; t++) {
    for (let k = 0; k < 3; k++) {
      const a = wid[indices[t * 3 + k]], b = wid[indices[t * 3 + ((k + 1) % 3)]];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      (edge.get(key) ?? edge.set(key, []).get(key)).push(t * 3 + k);
    }
  }
  for (const list of edge.values()) {
    if (list.length !== 2) continue;
    nb[list[0]] = Math.floor(list[1] / 3);
    nb[list[1]] = Math.floor(list[0] / 3);
  }
  return nb;
}

/**
 * Labels each triangle of a decimated body: 0 body, 1 left arm, 2 right arm.
 *   seed: the centroid's lowest capsule score (distance / radius + adjust) among the arm chain vs the rest of the skeleton;
 *         override(x, y, z, rgb) -> 0 | 1 | 2 | undefined forces a label (tool pouches, coat panels);
 *   cleanup: `passes` rounds of majority vote across edges; per side, only the arm component nearest the hand joint stays arm;
 *            body islands cut off from the main body join the arm around them.
 * Set SCAN_DEBUG=<prefix> to write <prefix>_labels.json (pos, uv, indices, labels) for previews/scan-labels.py.
 */
export function labelArms(body, { J, BONES, color, adjust = () => 0, override, passes = 3 }) {
  const { pos, indices } = body;
  const nT = indices.length / 3;
  const { skinned, segs, rad } = capsuleSet(J, BONES);
  const sideOf = skinned.map((n) => ARM_SIDES.findIndex((s) => armChain(s).includes(n)) + 1);
  const label = new Int8Array(nT);
  const c = [0, 0, 0], rgb = new Float32Array(3);
  for (let t = 0; t < nT; t++) {
    c.fill(0); rgb.fill(0);
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      for (let a = 0; a < 3; a++) { c[a] += pos[v * 3 + a] / 3; if (color) rgb[a] += color[v * 3 + a] / 3; }
    }
    const forced = override?.(c[0], c[1], c[2], color ? rgb : undefined);
    if (forced !== undefined) { label[t] = forced; continue; }
    const best = [Infinity, Infinity, Infinity];
    for (let b = 0; b < skinned.length; b++) {
      const sc = distToSegment(c[0], c[1], c[2], segs[b]) / rad[b] + adjust(c[0], c[1], c[2], skinned[b], color ? rgb : undefined);
      best[sideOf[b]] = Math.min(best[sideOf[b]], sc);
    }
    label[t] = best[1] < best[0] && best[1] <= best[2] ? 1 : best[2] < best[0] ? 2 : 0;
  }
  const wid = weldIds(pos);
  const nb = triNeighbours(indices, wid);
  for (let pass = 0; pass < passes; pass++) {
    const next = label.slice();
    for (let t = 0; t < nT; t++) {
      const votes = [0, 0, 0];
      for (let k = 0; k < 3; k++) { const o = nb[t * 3 + k]; if (o >= 0) votes[label[o]]++; }
      const top = votes.indexOf(Math.max(...votes));
      if (top !== label[t] && votes[top] >= 2) next[t] = top;
    }
    label.set(next);
  }
  // Connected components of one label.
  const components = (lab) => {
    const comp = new Int32Array(nT).fill(-1), list = [];
    for (let t = 0; t < nT; t++) {
      if (label[t] !== lab || comp[t] >= 0) continue;
      const tris = [t]; comp[t] = list.length;
      for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++) {
        const o = nb[tris[i] * 3 + k];
        if (o >= 0 && label[o] === lab && comp[o] < 0) { comp[o] = list.length; tris.push(o); }
      }
      list.push(tris);
    }
    return list;
  };
  const centroidDist = (t, p) => {
    let d = 0;
    for (let a = 0; a < 3; a++) {
      const m = (pos[indices[t * 3] * 3 + a] + pos[indices[t * 3 + 1] * 3 + a] + pos[indices[t * 3 + 2] * 3 + a]) / 3 - p[a];
      d += m * m;
    }
    return d;
  };
  let strays = 0;
  ARM_SIDES.forEach((side, i) => {
    const comps = components(i + 1);
    if (!comps.length) return;
    const hand = J[`${side}Hand`];
    const near = comps.map((tris) => Math.min(...tris.map((t) => centroidDist(t, hand))));
    const keep = near.indexOf(Math.min(...near));
    comps.forEach((tris, k) => { if (k !== keep) for (const t of tris) { label[t] = 0; strays++; } });
  });
  const bodies = components(0);
  const main = bodies.reduce((m, tris, k) => (tris.length > bodies[m].length ? k : m), 0);
  bodies.forEach((tris, k) => {
    if (k === main) return;
    const around = [0, 0, 0];
    for (const t of tris) for (let j = 0; j < 3; j++) { const o = nb[t * 3 + j]; if (o >= 0) around[label[o]]++; }
    const to = around[1] >= around[2] ? 1 : 2;
    if (around[to] === 0) return;
    for (const t of tris) { label[t] = to; strays++; }
  });
  const count = [0, 0, 0];
  for (const l of label) count[l]++;
  console.log(`arm labels: body ${count[0]}, left arm ${count[1]}, right arm ${count[2]} triangles (${strays} stray triangles relabelled)`);
  if (process.env.SCAN_DEBUG) {
    fs.writeFileSync(`${process.env.SCAN_DEBUG}_labels.json`, JSON.stringify({ pos: Array.from(pos, (x) => +x.toFixed(5)), uv: Array.from(body.uv, (x) => +x.toFixed(5)), indices: Array.from(indices), labels: Array.from(label) }));
  }
  return label;
}

/**
 * A smooth patch over an opening, for caps that stay in view. `rungs` is a zipper across the opening: pairs [a, b] of rim indices
 * (0..n-1) from one end to the other, each advancing one side. Every rung gets interior points about `h` apart, consecutive rungs
 * are zipped together, edges are flipped toward a Delaunay mesh and the interior points relaxed (umbrella smoothing, rim fixed)
 * into a membrane. Returns the interior points (3D) and triangles indexing rim points 0..n-1 then the interior points n.., wound
 * like the zipper triangles (a0, a1, b0) and (a1, b1, b0).
 */
export function membraneCap(pts, rungs, { h = 0.015, iterations = 40, openFirst = false, axis = null } = {}) {
  const n = pts.length;
  const P = pts.map((p) => p.slice());
  // With a vertical `axis` [x, z] (the torso's), interior points are placed and relaxed in cylindrical coordinates about it
  // (angle, height, radius), so the patch follows the torso's curve instead of sagging into it like a flat membrane.
  const a0 = axis ? Math.atan2(pts.reduce((s, p) => s + p[2] - axis[1], 0), pts.reduce((s, p) => s + p[0] - axis[0], 0)) : 0;
  const toC = (p) => {
    if (!axis) return p;
    let t = Math.atan2(p[2] - axis[1], p[0] - axis[0]) - a0;
    t = Math.atan2(Math.sin(t), Math.cos(t));
    return [t, p[1], Math.hypot(p[0] - axis[0], p[2] - axis[1])];
  };
  const fromC = (c) => (axis ? [axis[0] + c[2] * Math.cos(c[0] + a0), c[1], axis[1] + c[2] * Math.sin(c[0] + a0)] : c);
  const C = P.map(toC);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const lines = rungs.map(([a, b], r) => {
    // openFirst: the first rung is an open U's closing segment, a boundary of the piece: it gets no interior points.
    const k = a === b || (openFirst && r === 0) ? 0 : Math.max(0, Math.round(len(sub(P[a], P[b])) / h) - 1);
    const line = [a];
    for (let i = 1; i <= k; i++) { const t = i / (k + 1); const c = [0, 1, 2].map((j) => C[a][j] + (C[b][j] - C[a][j]) * t); C.push(c); P.push(fromC(c)); line.push(P.length - 1); }
    if (b !== a) line.push(b);
    return line;
  });
  const tris = [];
  const add = (x, y, z) => { if (x !== y && y !== z && z !== x) tris.push([x, y, z]); };
  for (let r = 1; r < lines.length; r++) {
    const R0 = lines[r - 1], R1 = lines[r];
    let p = 0, q = 0;
    while (p < R0.length - 1 || q < R1.length - 1) {
      const advP = q >= R1.length - 1 || (p < R0.length - 1 && len(sub(P[R0[p + 1]], P[R1[q]])) <= len(sub(P[R0[p]], P[R1[q + 1]])));
      if (advP) { add(R0[p], R1[q], R0[p + 1]); p++; } else { add(R0[p], R1[q], R1[q + 1]); q++; }
    }
  }
  const edgeMap = () => {
    const m = new Map();
    tris.forEach((t, ti) => { for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3]; const key = a < b ? `${a}|${b}` : `${b}|${a}`; (m.get(key) ?? m.set(key, []).get(key)).push(ti); } });
    return m;
  };
  const isRim = (a, b) => a < n && b < n && (Math.abs(a - b) === 1 || Math.abs(a - b) === n - 1);
  // Delaunay flips (angles opposite an interior edge sum to more than pi -> flip), then relax, then flip again.
  const angleAt = (o, x, y) => { const u = sub(P[x], P[o]), v = sub(P[y], P[o]); return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (len(u) * len(v) || 1)))); };
  const flips = () => {
    for (let pass = 0; pass < 10; pass++) {
      let changed = 0;
      const m = edgeMap();
      const used = new Set();
      for (const [key, ts] of m) {
        if (ts.length !== 2 || used.has(ts[0]) || used.has(ts[1])) continue;
        const [a, b] = key.split('|').map(Number);
        if (isRim(a, b)) continue;
        const t1 = tris[ts[0]], t2 = tris[ts[1]];
        const r1 = [0, 1, 2].find((k) => t1[k] !== a && t1[k] !== b), r2 = [0, 1, 2].find((k) => t2[k] !== a && t2[k] !== b);
        const c = t1[r1], d = t2[r2];
        if (c === d || m.has(c < d ? `${c}|${d}` : `${d}|${c}`)) continue;
        if (angleAt(c, a, b) + angleAt(d, a, b) <= Math.PI + 1e-6) continue;
        // t1 = (x, y, c) in its winding; the flipped pair keeps that winding.
        const x = t1[(r1 + 1) % 3], y = t1[(r1 + 2) % 3];
        tris[ts[0]] = [c, x, d];
        tris[ts[1]] = [c, d, y];
        used.add(ts[0]); used.add(ts[1]);
        changed++;
      }
      if (!changed) break;
    }
  };
  flips();
  const nbr = () => {
    const nb = Array.from({ length: P.length }, () => new Set());
    for (const [a, b, c] of tris) { nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
    return nb;
  };
  let nb = nbr();
  for (let it = 0; it < iterations; it++) {
    for (let v = n; v < P.length; v++) {
      const s = [0, 0, 0];
      for (const o of nb[v]) for (let a = 0; a < 3; a++) s[a] += C[o][a];
      for (let a = 0; a < 3; a++) C[v][a] = s[a] / nb[v].size;
      P[v] = fromC(C[v]);
    }
    if (it === iterations >> 1) { flips(); nb = nbr(); }
  }
  flips();
  return { inner: P.slice(n), tris };
}

/**
 * Cuts each arm off the torso below its armpit and closes both openings (design.md decisions 3-4).
 *   labels: per triangle (labelArms); armpitY: { Left, Right } heights in the scan frame; torsoAxis: [x, z] of the torso centre line.
 *   J: joint positions (Mixamo names); each arm's cap folds onto its bone axis (upper arm, forearm, hand), see below.
 *   pick(rim, centroid, { piece, side }) -> vertex index whose UV (one cloth or skin texel) the whole cap uses; default: the rim
 *   vertex nearest the centroid. bulge: cap middle pushed out by this fraction of its width (0 = flat strip).
 *   blend: height of the band under each armpit where skinScan eases from the hard arm/body mask into the shoulder blend, so the
 *   top corner of the cut (where the pieces still share vertices) does not tear when the arm rises. Keep `armpitY` this much above
 *   the real armpit.
 * Below the armpit, every vertex used by both an arm and the body is duplicated for the arm. The cut leaves a U-shaped opening per
 * contact (down the front crease, round the far end of the contact, up the back crease; ends at the armpit) or a closed loop for a
 * contact wholly below the armpit. Each piece's opening is closed with a straight segment between its ends and filled with a zipper
 * strip whose two sides meet at the far end of the opening (the body's cap: the torso does not bend there). The arm's cap instead
 * joins each rim vertex to the nearest point of the arm's bone axis (on a 5 mm grid shared by both sides of the opening, so the cap
 * is watertight), so it folds into the sleeve as a shallow groove whose every point rides on its own bone: a flat strip across a bent elbow would turn into a fin once bodyModel straightens the arm.
 * Mutates body (pos, nor, uv, indices) and returns per vertex: labelOf (0 body, 1 left arm, 2 right arm) and pieceOf (the label for
 * vertices at the cut, else 0) for skinScan's `arms` option.
 */
export function splitArms(body, labels, { armpitY, torsoAxis, J, pick, bulge = 0, blend = 0.04, band = 0.04 }) {
  const { pos, nor, uv, indices } = body;
  const nT = indices.length / 3;
  const wid = weldIds(pos);
  const armpit = (lab) => (lab === 1 ? armpitY.Left : lab === 2 ? armpitY.Right : -Infinity);
  // Labels touching each welded position.
  const groupMask = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const g = wid[indices[t * 3 + k]];
    groupMask.set(g, (groupMask.get(g) ?? 0) | (1 << labels[t]));
  }
  const groupY = new Map();
  for (let v = 0; v < pos.length / 3; v++) groupY.set(wid[v], pos[v * 3 + 1]);
  const cutGroup = (g) => {
    const m = groupMask.get(g) ?? 0;
    if (!(m & 1) || !(m & 6)) return false;
    const y = groupY.get(g);
    return ((m & 2) && y < armpit(1)) || ((m & 4) && y < armpit(2));
  };
  // Duplicate cut vertices for the arm triangles.
  const copyOf = new Map();
  const addVertex = (from) => {
    pos.push(pos[from * 3], pos[from * 3 + 1], pos[from * 3 + 2]);
    nor.push(nor[from * 3], nor[from * 3 + 1], nor[from * 3 + 2]);
    uv.push(uv[from * 2], uv[from * 2 + 1]);
    return pos.length / 3 - 1;
  };
  const widOf = Array.from(wid);
  let dup = 0;
  for (let t = 0; t < nT; t++) {
    if (labels[t] === 0) continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      if (!cutGroup(widOf[v])) continue;
      const key = `${v}_${labels[t]}`;
      let c = copyOf.get(key);
      if (c === undefined) { c = addVertex(v); widOf[c] = widOf[v]; copyOf.set(key, c); dup++; }
      indices[t * 3 + k] = c;
    }
  }
  // Body vertices that only arm triangles used are now unused by the body; that is fine (they were copied, the originals stay as
  // the body's side of the seam if any body triangle uses them, and unused vertices are dropped by packBody's reorder).
  const nV = () => pos.length / 3;
  let labelOf = new Int8Array(nV()), pieceOf = new Int8Array(nV());
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = indices[t * 3 + k];
    labelOf[v] = labels[t];
    if (cutGroup(widOf[v])) pieceOf[v] = labels[t];
  }
  // Openings: per arm side and piece, the edges that used to join an arm triangle to a body triangle with a cut end.
  const nb = triNeighbours(indices.map((v) => v), Int32Array.from(widOf));
  const capTris = [];
  const capLabel = [];
  const newVerts = [];
  const bodyRim = [], capInner = new Set();
  let caps = 0, open = 0;
  for (const side of [1, 2]) {
    for (const piece of [side, 0]) {
      const next = new Map(), rep = new Map();
      for (let t = 0; t < nT; t++) {
        if (labels[t] !== piece) continue;
        for (let k = 0; k < 3; k++) {
          // The edge (a -> b) used to join this piece to the other side of the seam (arm <-> body) and has a cut end.
          const o = nb[t * 3 + k];
          if (o < 0 || labels[o] !== (piece === 0 ? side : 0)) continue;
          const a = indices[t * 3 + k], b = indices[t * 3 + ((k + 1) % 3)];
          const ga = widOf[a], gb = widOf[b];
          if (!cutGroup(ga) && !cutGroup(gb)) continue;
          next.set(ga, gb); rep.set(ga, a); if (!rep.has(gb)) rep.set(gb, b);
        }
      }
      const hasIn = new Set(next.values());
      const seen = new Set();
      const paths = [];
      for (const start of [...next.keys()].filter((g) => !hasIn.has(g)).concat([...next.keys()])) {
        if (seen.has(start)) continue;
        const path = [];
        let g = start;
        while (g !== undefined && !seen.has(g)) { seen.add(g); path.push(g); g = next.get(g); }
        if (process.env.SCAN_DEBUG_PATHS) console.log('path', { side, piece, n: path.length, closed: g === start, start: path[0], end: path[path.length - 1] });
        if (path.length >= 3) paths.push({ nodes: path, closed: g === start });
        else open++;
      }
      // A crack in the scan (two rim vertices a millimetre apart that never welded) breaks one opening into two traces: chain an
      // open trace onto another that starts where it ends, so the opening gets one cap instead of two overlapping ones.
      const at = (g) => { const v = rep.get(g); return [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]; };
      const gap = (g, h) => { const p = at(g), q = at(h); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
      for (let joined = true; joined; ) {
        joined = false;
        for (const x of paths) {
          if (x.closed) continue;
          const y = paths.find((o) => o !== x && !o.closed && gap(x.nodes[x.nodes.length - 1], o.nodes[0]) < 0.004);
          if (!y) continue;
          x.nodes.push(...y.nodes);
          paths.splice(paths.indexOf(y), 1);
          if (gap(x.nodes[x.nodes.length - 1], x.nodes[0]) < 0.004) x.closed = true;
          joined = true;
          break;
        }
      }
      for (const { nodes, closed } of paths) {
        const P = (g) => { const v = rep.get(g); return [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]; };
        const pts = nodes.map(P);
        // Two chains that meet at the far end of the opening: for an open U, the arc-length midpoint of the path (the bottom of the
        // U, wherever the contact ends: a forearm across the coat ends at the hand, not at the elbow); for a closed loop, the two
        // points furthest apart. Pairing by height instead would join the upper arm to the forearm across a bent elbow.
        const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        let A, B;
        if (closed) {
          const n = nodes.length;
          let i0 = 0, i1 = 0, far = -1;
          for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) { const d = dist(pts[i], pts[k]); if (d > far) { far = d; i0 = i; i1 = k; } }
          A = []; for (let i = i0; ; i = (i + 1) % n) { A.push(i); if (i === i1) break; }
          B = []; for (let i = i0; ; i = (i - 1 + n) % n) { B.push(i); if (i === i1) break; }
        } else {
          const L = [0];
          for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + dist(pts[i - 1], pts[i]));
          let iMid = 0;
          L.forEach((l, i) => { if (Math.abs(l - L[L.length - 1] / 2) < Math.abs(L[iMid] - L[L.length - 1] / 2)) iMid = i; });
          A = []; for (let i = 0; i <= iMid; i++) A.push(i);
          B = []; for (let i = nodes.length - 1; i >= iMid; i--) B.push(i);
        }
        // Cap normal: horizontal, from the torso centre line toward the contact (the body's cap faces the arm, the arm's faces in).
        const cen = [0, 0, 0];
        pts.forEach((p) => { for (let a = 0; a < 3; a++) cen[a] += p[a] / pts.length; });
        let out = [cen[0] - torsoAxis[0], 0, cen[2] - torsoAxis[1]];
        const ol = Math.hypot(...out) || 1;
        out = out.map((x) => (x / ol) * (piece === 0 ? 1 : -1));
        const rim = nodes.map((g) => rep.get(g));
        const texel = pick ? pick(rim, cen, { piece, side }) : rim.reduce((b, v) => {
          const d = (u) => Math.hypot(pos[u * 3] - cen[0], pos[u * 3 + 1] - cen[1], pos[u * 3 + 2] - cen[2]);
          return d(v) < d(b) ? v : b;
        }, rim[0]);
        const tu = [uv[texel * 2], uv[texel * 2 + 1]];
        const capVert = new Map();
        const cv = (i) => {
          if (capVert.has(i)) return capVert.get(i);
          const v = rim[i];
          pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); nor.push(...out); uv.push(...tu);
          const c = pos.length / 3 - 1;
          newVerts.push([c, labelOf[v], pieceOf[v]]);
          capVert.set(i, c);
          return c;
        };
        // Both cap shapes wind every triangle the same way round the opening; the whole cap is flipped at the end if it faces inward
        // (per-triangle tests fail on collinear rims).
        const loopTris = [];
        const tri = (a, b, c) => loopTris.push(a, b, c);
        if (piece !== 0 && J) {
          const sideName = ARM_SIDES[side - 1];
          const end = J[`${sideName}HandMiddle1`] ?? J[`${sideName}HandEnd`];
          const chain = [[J[`${sideName}Arm`], J[`${sideName}ForeArm`]], [J[`${sideName}ForeArm`], J[`${sideName}Hand`]]];
          if (end) chain.push([J[`${sideName}Hand`], end]);
          // The axis is walked by arc length on a 5 mm grid; every rim vertex joins the grid point nearest its projection, and the
          // grid points between two neighbours' projections are fanned in, so both sides of the opening share the axis vertices
          // and the cap is watertight (no open edges along the fold).
          const segLen = chain.map(([a, b]) => dist(a, b));
          const sOf = (p) => {
            let best = 0, bd = Infinity, s0 = 0;
            chain.forEach(([a, b], i) => {
              const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
              const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
              const d = dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
              if (d < bd) { bd = d; best = s0 + t * segLen[i]; }
              s0 += segLen[i];
            });
            return best;
          };
          const at = (s) => {
            for (let i = 0; i < chain.length; i++) {
              if (s <= segLen[i] || i === chain.length - 1) {
                const [a, b] = chain[i], t = Math.min(1, s / segLen[i]);
                return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
              }
              s -= segLen[i];
            }
          };
          const GRID = 0.005;
          const total = segLen.reduce((x, y) => x + y, 0);
          const gridVert = new Map();
          const gv = (g) => {
            if (!gridVert.has(g)) {
              pos.push(...at(Math.min(total, g * GRID))); nor.push(...out); uv.push(...tu);
              const c = pos.length / 3 - 1;
              newVerts.push([c, piece, piece]);
              gridVert.set(g, c);
            }
            return gridVert.get(g);
          };
          const g = pts.map((p) => Math.round(sOf(p) / GRID));
          // Rim edge a -> b: triangle (a, b, axis of b), then a fan from a back along the axis to a's own grid point.
          const step = (a, b, ga, gb) => {
            tri(a, b, gv(gb));
            for (let x = gb; x !== ga; x += ga > gb ? 1 : -1) tri(a, gv(x), gv(x + (ga > gb ? 1 : -1)));
          };
          const n = nodes.length;
          for (let k = 0; k < (closed ? n : n - 1); k++) step(cv(k), cv((k + 1) % n), g[k], g[(k + 1) % n]);
          // An open U is closed across the armpit too: its two ends fan to the axis as well.
          if (!closed) step(cv(n - 1), cv(0), g[n - 1], g[0]);
        } else {
        // Body side: a zipper strip across the opening (each step advances the side whose new diagonal is shorter, so rungs stay
        // short when one side is longer than the other), relaxed into a membrane: the patch stays in view once bodyModel straightens
        // the arm away from it, and a bare zipper reads as a fan of splinters. Pushed out along `out` by `bulge` times each point's
        // distance to the rim.
        const rungs = [[0, 0]];
        let i = 0, j = 0;
        while (i < A.length - 1 || j < B.length - 1) {
          if (j >= B.length - 1) i++;
          else if (i >= A.length - 1) j++;
          else if (dist(pts[A[i + 1]], pts[B[j]]) <= dist(pts[A[i]], pts[B[j + 1]])) i++;
          else j++;
          rungs.push([i, j]);
        }
        const cap = membraneCap(pts, rungs.map(([a, b]) => [A[a], B[b]]), { h: 0.02, openFirst: !closed, axis: torsoAxis });
        bodyRim.push(...pts);
        const inner = cap.inner.map((p) => {
          const d = Math.min(...pts.map((r) => dist(p, r)));
          pos.push(p[0] + out[0] * bulge * d, p[1], p[2] + out[2] * bulge * d); nor.push(...out); uv.push(...tu);
          const c = pos.length / 3 - 1;
          newVerts.push([c, piece, piece]);
          capInner.add(c);
          return c;
        });
        const vid = (i) => (i < pts.length ? cv(i) : inner[i - pts.length]);
        for (const [x, y, z] of cap.tris) tri(vid(x), vid(y), vid(z));
        }
        let facing = 0;
        for (let k = 0; k < loopTris.length; k += 3) {
          const p = [0, 1, 2].map((q) => { const v = loopTris[k + q]; return [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]; });
          const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
          facing += (u[1] * w[2] - u[2] * w[1]) * out[0] + (u[2] * w[0] - u[0] * w[2]) * out[1] + (u[0] * w[1] - u[1] * w[0]) * out[2];
        }
        for (let k = 0; k < loopTris.length; k += 3) {
          if (facing < 0) capTris.push(loopTris[k], loopTris[k + 2], loopTris[k + 1]); else capTris.push(loopTris[k], loopTris[k + 1], loopTris[k + 2]);
          capLabel.push(piece);
        }
        caps++;
      }
    }
  }
  indices.push(...capTris);
  labelOf = Int8Array.from({ length: nV() }, (_, v) => (v < labelOf.length ? labelOf[v] : 0));
  pieceOf = Int8Array.from({ length: nV() }, (_, v) => (v < pieceOf.length ? pieceOf[v] : 0));
  for (const [c, l, p] of newVerts) { labelOf[c] = l; pieceOf[c] = p; }
  // The torso's side of a cut sits at the bottom of the crease where the arm pressed in, so even a smooth cap reads as a dent once
  // the arm swings away. Within `band` of the body's rim (and over the body caps), the torso's radius about its axis is relaxed
  // toward the surface around it (an ellipse fitted per height plus a harmonic correction; outward only on the scan's own vertices), fading out under the
  // armpit where the pieces still join. Normals there are recomputed from the new surface.
  if (band > 0 && bodyRim.length) {
    const top = Math.min(armpitY.Left, armpitY.Right);
    const key = new Map(), grp = new Int32Array(nV()).fill(-1);
    for (let v = 0; v < nV(); v++) {
      if (labelOf[v] !== 0) continue;
      const k = `${pos[v * 3]},${pos[v * 3 + 1]},${pos[v * 3 + 2]}`;
      grp[v] = key.get(k) ?? key.set(k, key.size).get(k);
    }
    const G = key.size, gp = new Float64Array(G * 3), free = new Uint8Array(G), inner = new Uint8Array(G), w = new Float64Array(G);
    for (let v = 0; v < nV(); v++) if (grp[v] >= 0) { gp.set([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], grp[v] * 3); if (capInner.has(v)) inner[grp[v]] = 1; }
    for (let g = 0; g < G; g++) {
      const p = [gp[g * 3], gp[g * 3 + 1], gp[g * 3 + 2]];
      if (p[1] > top) continue;
      let d = Infinity;
      for (const r of bodyRim) { const e = Math.hypot(p[0] - r[0], p[1] - r[1], p[2] - r[2]); if (e < d) d = e; }
      if (d < band || inner[g]) { free[g] = 1; w[g] = smooth(top, top - 0.03, p[1]); }
    }
    const nbr = Array.from({ length: G }, () => new Set());
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [grp[indices[t]], grp[indices[t + 1]], grp[indices[t + 2]]];
      if (a < 0 || b < 0 || c < 0) continue;
      nbr[a].add(b).add(c); nbr[b].add(a).add(c); nbr[c].add(a).add(b);
    }
    // Radius about the torso axis relative to an ellipse fitted to the torso at each height (1/r^2 = A cos^2 + B sin^2 + C sin cos,
    // least squares over the fixed body vertices in 2 cm slices), so the harmonic fill keeps the torso's oval: a plain harmonic
    // radius sags at the sides, where the torso is widest.
    const R0 = new Float64Array(G), TH = new Float64Array(G);
    for (let g = 0; g < G; g++) { R0[g] = Math.hypot(gp[g * 3] - torsoAxis[0], gp[g * 3 + 2] - torsoAxis[1]); TH[g] = Math.atan2(gp[g * 3 + 2] - torsoAxis[1], gp[g * 3] - torsoAxis[0]); }
    const slice = 0.02, y0 = Math.min(...Array.from({ length: G }, (_, g) => (free[g] ? gp[g * 3 + 1] : Infinity))) - 0.06;
    const ns = Math.max(1, Math.ceil((top - y0) / slice) + 1), fit = [];
    for (let k = 0; k < ns; k++) {
      const yc = y0 + k * slice, M = [0, 0, 0, 0, 0, 0, 0, 0, 0], rhs = [0, 0, 0];
      for (let g = 0; g < G; g++) {
        if (free[g] || Math.abs(gp[g * 3 + 1] - yc) > slice || R0[g] < 0.05) continue;
        const c = Math.cos(TH[g]), s = Math.sin(TH[g]), f = [c * c, s * s, s * c], t = 1 / (R0[g] * R0[g]);
        for (let i = 0; i < 3; i++) { rhs[i] += f[i] * t; for (let j = 0; j < 3; j++) M[i * 3 + j] += f[i] * f[j]; }
      }
      const det = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
      const D = det(M);
      if (Math.abs(D) < 1e-12) { fit.push(null); continue; }
      fit.push([0, 1, 2].map((i) => det(M.map((v, j) => (j % 3 === i ? rhs[(j / 3) | 0] : v))) / D));
    }
    for (let k = 0; k < ns; k++) if (!fit[k]) fit[k] = fit.slice(k).find(Boolean) ?? fit.slice(0, k).reverse().find(Boolean) ?? null;
    // Smooth the fits over 5 slices (a slice's fit swings with whatever pocket or fold it caught), then interpolate between slices.
    const sm = fit.map((_, k) => {
      const win = fit.slice(Math.max(0, k - 2), k + 3).filter(Boolean);
      return win.length ? [0, 1, 2].map((i) => win.reduce((t, f) => t + f[i], 0) / win.length) : null;
    });
    const ell = (g) => {
      const u = Math.max(0, Math.min(ns - 1, (gp[g * 3 + 1] - y0) / slice)), k0 = Math.floor(u), k1 = Math.min(ns - 1, k0 + 1), t = u - k0;
      const f = sm[k0] && sm[k1] ? [0, 1, 2].map((i) => sm[k0][i] * (1 - t) + sm[k1][i] * t) : sm[k0] ?? sm[k1];
      if (!f) return R0[g];
      const c = Math.cos(TH[g]), s = Math.sin(TH[g]), q = f[0] * c * c + f[1] * s * s + f[2] * s * c;
      return q > 0 ? 1 / Math.sqrt(q) : R0[g];
    };
    const E = Float64Array.from({ length: G }, (_, g) => ell(g));
    const D = Float64Array.from({ length: G }, (_, g) => R0[g] - E[g]);
    for (let it = 0; it < 150; it++) {
      for (let g = 0; g < G; g++) {
        if (!free[g] || !nbr[g].size) continue;
        let sum = 0;
        for (const o of nbr[g]) sum += D[o];
        D[g] = sum / nbr[g].size;
      }
    }
    // Plain harmonic radius too: the ellipse may only add up to `bulgeMax` (2.5 cm) on top of it, so a bad fit cannot balloon.
    const Rh = Float64Array.from(R0);
    for (let it = 0; it < 150; it++) {
      for (let g = 0; g < G; g++) {
        if (!free[g] || !nbr[g].size) continue;
        let sum = 0;
        for (const o of nbr[g]) sum += Rh[o];
        Rh[g] = sum / nbr[g].size;
      }
    }
    const bulgeMax = 0.025;
    const R = Float64Array.from({ length: G }, (_, g) => Math.max(Rh[g], Math.min(Rh[g] + bulgeMax, E[g] + D[g])));
    let moved = 0;
    for (let g = 0; g < G; g++) {
      if (!free[g]) continue;
      const target = inner[g] ? R[g] : Math.max(R0[g], Math.min(R0[g] + bulgeMax, R[g]));
      const r = R0[g] + (target - R0[g]) * w[g];
      if (Math.abs(r - R0[g]) < 1e-6) continue;
      const dx = gp[g * 3] - torsoAxis[0], dz = gp[g * 3 + 2] - torsoAxis[1], k = r / (R0[g] || 1);
      gp[g * 3] = torsoAxis[0] + dx * k; gp[g * 3 + 2] = torsoAxis[1] + dz * k;
      moved++;
    }
    const N = new Float64Array(G * 3);
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [grp[indices[t]], grp[indices[t + 1]], grp[indices[t + 2]]];
      if (a < 0 || b < 0 || c < 0 || !(free[a] || free[b] || free[c])) continue;
      const u = [0, 1, 2].map((k) => gp[b * 3 + k] - gp[a * 3 + k]), v = [0, 1, 2].map((k) => gp[c * 3 + k] - gp[a * 3 + k]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const g of [a, b, c]) for (let k = 0; k < 3; k++) N[g * 3 + k] += n[k];
    }
    for (let v = 0; v < nV(); v++) {
      const g = grp[v];
      if (g < 0 || !free[g]) continue;
      pos[v * 3] = gp[g * 3]; pos[v * 3 + 2] = gp[g * 3 + 2];
      const l = Math.hypot(N[g * 3], N[g * 3 + 1], N[g * 3 + 2]);
      if (l > 0) for (let k = 0; k < 3; k++) nor[v * 3 + k] = N[g * 3 + k] / l;
    }
    console.log(`arm split: torso side relaxed over ${moved} welded vertices`);
  }
  console.log(`arm split: ${dup} vertices duplicated, ${caps} openings capped with ${capTris.length / 3} triangles${open ? `, ${open} short edge runs left open` : ''}`);
  if (process.env.SCAN_DEBUG) {
    const allLabels = Array.from(labels).concat(capLabel.map((l) => l + 3));
    fs.writeFileSync(`${process.env.SCAN_DEBUG}_split.json`, JSON.stringify({ pos: Array.from(pos, (x) => +x.toFixed(5)), uv: Array.from(uv, (x) => +x.toFixed(5)), indices: Array.from(indices), labels: allLabels }));
  }
  // capStart: index of the first cap triangle; capLabel: the piece (0 body, 1/2 arm) each cap triangle closes.
  return { labelOf, pieceOf, armpitY, blend, capStart: nT, capLabel: Int8Array.from(capLabel) };
}

// ------------------------------------------------------------------ skeleton & skin
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const distToSegment = (x, y, z, [a, b]) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1)));
  return Math.hypot(x - (a[0] + ab[0] * t), y - (a[1] + ab[1] * t), z - (a[2] + ab[2] * t));
};

/**
 * Distance-field skinning against capsule segments.
 *   J: joint positions; BONES: name -> [parent, segment end (null: short stub along the parent direction), radius]. Names ending in
 *   "End" are segment-end markers only (no node). `extra`: zero-weight bones (fingers, twists) name -> parent, positioned from J.
 *   color: optional per-vertex RGB (vertexColors) handed to `adjust`.
 *   adjust(x, y, z, boneName, rgb) -> extra score (higher = less likely) to keep touching parts apart.
 *   post({ W, wPos, wCol, nW, NB, boneIndex, segment, distToSegment }) may rewrite the (smoothed) weights before the jaw mask.
 *   neck: { collarY, jawLineY, axis: [x, z], radius, margin, faceRadius, include(rgb) } neck and lower-face ownership (below).
 *   arms: splitArms' result. Vertices weld by position and piece (so the two sides of the cut never share weights), and below each
 *   armpit a hard mask keeps arm vertices on their arm chain (upper arm, forearm, hand) and body vertices off it, applied before,
 *   during and after smoothing.
 *   jaw: { mouthY, chinY, hingeZ, cx, halfWidth } lower-face mask moved onto the Jaw bone.
 *
 * Neck rule (openspec imported-body-models, "The neck joint owns the neck" / "The lower face moves with the head"): capsules
 * alone let the wide chest capsule win up to the chin, so after smoothing two explicit masks replace the capsule weights where
 * `include(rgb)` holds (skin, or skin and hair; never the collar or the stethoscope):
 *   - neck column (horizontal distance to `axis` < `radius`, above `collarY`): neck -> head gradient from `collarY` to `jawLineY`,
 *     nothing else;
 *   - lower face (2.5 cm or more in front of the axis, within `faceRadius`, above `jawLineY - margin`, outside the column, any
 *     colour): head only (the jaw mask then moves the mouth and chin onto the jaw).
 * Both blend in over ~1-2 cm so the boundary does not crease.
 */
export function skinScan({ pos, nor, uv, indices, J, BONES, extra = {}, color, adjust = () => 0, post, neck, arms, jaw, sharp = 8, iterations = 4, elbowBand = ELBOW_BAND, hands = false }) {
  // `hands`: true, or { thumbToward } for rigHands (per side, the rough world direction each thumb points in the scan). The hands
  // are cut apart first (splitHands), which appends vertices and triangles to pos, nor, uv and indices (all three are then needed).
  const skinned = Object.keys(BONES).filter((n) => !n.endsWith('End'));
  let names = [...skinned, ...Object.keys(extra)];
  const boneIndex = new Map(names.map((n, i) => [n, i]));
  let NB = skinned.length;
  const segs = skinned.map((n) => {
    const [, end] = BONES[n];
    const a = J[n];
    if (end) return [a, J[end]];
    const p = J[BONES[n][0]];
    const d = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
    const l = Math.hypot(...d) || 1;
    return [a, [a[0] + (d[0] / l) * 0.07, a[1] + (d[1] / l) * 0.07, a[2] + (d[2] / l) * 0.07]];
  });
  const rad = skinned.map((n) => BONES[n][2]);

  let count = pos.length / 3;
  let weldOf = new Int32Array(count);
  const weldKey = new Map();
  for (let v = 0; v < count; v++) {
    const key = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}${arms ? `|${arms.pieceOf[v]}` : ''}`;
    let w = weldKey.get(key);
    if (w === undefined) { w = weldKey.size; weldKey.set(key, w); }
    weldOf[v] = w;
  }
  const nW = weldKey.size;
  let wPos = new Float32Array(nW * 3);
  const wCol = new Float32Array(nW * 3);
  for (let v = 0; v < count; v++) {
    wPos.set(pos.slice(v * 3, v * 3 + 3), weldOf[v] * 3);
    if (color) wCol.set(color.subarray(v * 3, v * 3 + 3), weldOf[v] * 3);
  }
  let W = new Float32Array(nW * NB);
  const s = new Float32Array(NB);
  for (let w = 0; w < nW; w++) {
    const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
    const rgb = color ? wCol.subarray(w * 3, w * 3 + 3) : undefined;
    let best = Infinity;
    for (let b = 0; b < NB; b++) { s[b] = distToSegment(x, y, z, segs[b]) / rad[b] + adjust(x, y, z, skinned[b], rgb); best = Math.min(best, s[b]); }
    let sum = 0;
    for (let b = 0; b < NB; b++) { const e = Math.exp(-(s[b] - best) * sharp); W[w * NB + b] = e; sum += e; }
    for (let b = 0; b < NB; b++) W[w * NB + b] /= sum;
  }
  const armMask = arms ? makeArmMask({ arms, weldOf, count, nW, wPos, skinned, segs, rad }) : null;
  armMask?.(W, false);
  let nbrs = Array.from({ length: nW }, () => new Set());
  // Smoothing follows the surface: the scan's own triangles and the body's caps (membranes that continue the torso). The arm caps
  // (capLabel 1/2) are left out: they would tie the armpit corner to points on the bone axis and drag the shoulder blend toward
  // the arm; their axis points keep their capsule weights.
  const armCapTri = (t) => arms?.capStart != null && t / 3 >= arms.capStart && t / 3 < arms.capStart + arms.capLabel.length && arms.capLabel[t / 3 - arms.capStart] !== 0;
  for (let t = 0; t < indices.length; t += 3) {
    if (armCapTri(t)) continue;
    const a = weldOf[indices[t]], b = weldOf[indices[t + 1]], c = weldOf[indices[t + 2]];
    nbrs[a].add(b).add(c); nbrs[b].add(a).add(c); nbrs[c].add(a).add(b);
  }
  for (let it = 0; it < iterations; it++) {
    const next = new Float32Array(W.length);
    for (let w = 0; w < nW; w++) {
      const ns = [...nbrs[w]];
      for (let b = 0; b < NB; b++) {
        let acc = 0;
        for (const o of ns) acc += W[o * NB + b];
        next[w * NB + b] = ns.length ? 0.5 * W[w * NB + b] + 0.5 * (acc / ns.length) : W[w * NB + b];
      }
    }
    W = next;
    armMask?.(W);
  }
  post?.({ W, wPos, wCol, nW, NB, boneIndex, segment: (n) => segs[boneIndex.get(n)], distToSegment });
  armMask?.(W);
  if (elbowBand > 0) applyElbowRule({ W, wPos, nW, NB, boneIndex, J, band: elbowBand });
  if (neck) applyNeckRule({ W, wPos, wCol, nW, NB, boneIndex, color, neck });
  if (jaw) {
    const hw = jaw.halfWidth ?? 0.085;
    const jawMask = (x, y, z) =>
      smooth(jaw.mouthY + 0.015, jaw.mouthY - 0.01, y) * smooth(jaw.chinY - 0.03, jaw.chinY + 0.005, y) *
      smooth(jaw.hingeZ + 0.03, jaw.hingeZ + 0.075, z) * smooth(hw, hw - 0.035, Math.abs(x - jaw.cx));
    const jb = boneIndex.get('Jaw');
    let n = 0;
    for (let w = 0; w < nW; w++) {
      const m = jawMask(wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]);
      if (m <= 0) continue;
      if (m > 0.5) n++;
      for (let b = 0; b < NB; b++) W[w * NB + b] *= 1 - m;
      W[w * NB + jb] += m;
    }
    console.log(`jaw: ${n} welded vertices mostly on the jaw`);
  }
  // Finger chains and forearm twist bones (hand-rig.mjs, per-character-motion D7): new skinned bones after the body's own, `J`
  // gains their positions (the caller's object, which packBody reads).
  const handParents = {};
  if (hands) {
    if (!nor || !uv) throw new Error('skinScan: hands need nor and uv (the hand split adds vertices)');
    const opts = typeof hands === 'object' ? hands : {};
    const part = { pos, nor, uv, indices, weldOf };
    const cut = splitHands({ parts: [part], W, wPos, names: skinned, J, nbrs, skip: (_, t) => armCapTri(t * 3), ...opts });
    ({ W, wPos, nbrs } = cut);
    weldOf = part.weldOf;
    count = pos.length / 3;
    if (count > 65535) throw new Error('too many vertices for u16 indices: ' + count);
    const r = rigHands({ W, wPos, names: skinned, J, nbrs, plans: cut.plans, parentOf: Object.fromEntries(skinned.map((n) => [n, BONES[n][0]])), ...opts });
    W = r.W;
    NB = r.names.length;
    names = [...r.names, ...Object.keys(extra)];
    Object.assign(J, r.J);
    for (const n of r.added) handParents[n] = r.parentOf[n];
  }
  const joints = new Uint8Array(count * 4);
  const weights = new Uint16Array(count * 4);
  for (let v = 0; v < count; v++) {
    const w = weldOf[v];
    const top = Array.from({ length: NB }, (_, b) => [b, W[w * NB + b]]).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((acc, t) => acc + t[1], 0) || 1;
    const q = top.map((t) => Math.round((t[1] / sum) * 65535));
    q[0] += 65535 - q.reduce((acc, x) => acc + x, 0);
    top.forEach((t, k) => { joints[v * 4 + k] = t[0]; weights[v * 4 + k] = q[k]; });
  }
  const parentOf = (n) => (n in BONES ? BONES[n][0] : n in handParents ? handParents[n] : extra[n]);
  return { names, parentOf, joints, weights };
}

function makeArmMask({ arms, weldOf, count, nW, wPos, skinned, segs, rad }) {
  const NB = skinned.length;
  // An arm's chain is its upper arm, forearm and every hand bone (Hand, HandMiddle1, fingers): bodyModel maps them all onto the arm.
  const chainIdx = ARM_SIDES.map((side) => new Set(skinned.flatMap((n, i) => (armChain(side).includes(n) || n.startsWith(`${side}Hand`) ? [i] : []))));
  const armpit = [arms.armpitY.Left, arms.armpitY.Right];
  // Label per welded vertex (-1 where the members disagree: only above an armpit, where no mask applies).
  const gLabel = new Int8Array(nW).fill(-2);
  for (let v = 0; v < count; v++) {
    const g = weldOf[v], l = arms.labelOf[v];
    gLabel[g] = gLabel[g] === -2 || gLabel[g] === l ? l : -1;
  }
  let masked = 0;
  for (let g = 0; g < nW; g++) if (gLabel[g] >= 0 && wPos[g * 3 + 1] < Math.max(...armpit)) masked++;
  console.log(`arm mask: ${masked} welded vertices below an armpit`);
  const band = arms.blend ?? 0;
  const keep = new Float32Array(NB);
  // ease: false for the first pass (hard everywhere), so weights in the band only come from what diffuses in from the corner.
  return (W, ease = true) => {
    for (let g = 0; g < nW; g++) {
      const l = gLabel[g];
      if (l < 0) continue;
      const y = wPos[g * 3 + 1];
      // Just under the armpit the mask fades out, so the cut's top corner meets the shoulder blend smoothly.
      const near = l > 0 ? armpit[l - 1] : Math.max(...armpit.filter((a) => y < a).concat([-Infinity]));
      const k = ease && band > 0 ? smooth(near - band, near, y) : 0;
      if (k > 0) for (let b = 0; b < NB; b++) keep[b] = W[g * NB + b];
      const allowed = (b) => (l > 0 ? (y >= armpit[l - 1] || chainIdx[l - 1].has(b)) : !((y < armpit[0] && chainIdx[0].has(b)) || (y < armpit[1] && chainIdx[1].has(b))));
      if (l > 0 && y >= armpit[l - 1]) continue;
      if (l === 0 && y >= armpit[0] && y >= armpit[1]) continue;
      let sum = 0;
      for (let b = 0; b < NB; b++) { if (!allowed(b)) W[g * NB + b] = 0; sum += W[g * NB + b]; }
      if (sum < 1e-6) {
        // Nothing allowed left: the nearest allowed capsule takes it.
        let best = -1, bs = Infinity;
        for (let b = 0; b < NB; b++) {
          if (!allowed(b)) continue;
          const sc = distToSegment(wPos[g * 3], y, wPos[g * 3 + 2], segs[b]) / rad[b];
          if (sc < bs) { bs = sc; best = b; }
        }
        W[g * NB + best] = 1;
        sum = 1;
      }
      for (let b = 0; b < NB; b++) W[g * NB + b] /= sum;
      if (k > 0) for (let b = 0; b < NB; b++) W[g * NB + b] += (keep[b] - W[g * NB + b]) * k;
    }
  };
}

/** Half-width of the elbow's upper-arm/forearm blend along the arm (metres). */
export const ELBOW_BAND = 0.035;

/**
 * Elbow rule: the upper arm and forearm meet at the elbow joint over a short band, so a bent elbow bends there. Capsule distances
 * and the surface smoothing alone spread the hand-over across most of the arm (on Ruiz, forearm weight rose from 30% to 70% of the
 * arm's length and was 18% at the joint), so any elbow bend curved the whole sleeve like a noodle. For every welded vertex on an
 * arm, the weight it gives that arm's upper arm and forearm together is re-split by its signed distance from the elbow along the
 * arm (up the upper arm negative, down the forearm positive), eased over +-band. Hand, shoulder and body weights are untouched.
 */
function applyElbowRule({ W, wPos, nW, NB, boneIndex, J, band }) {
  let n = 0;
  for (const side of ARM_SIDES) {
    const u = boneIndex.get(`${side}Arm`), f = boneIndex.get(`${side}ForeArm`);
    const S = J[`${side}Arm`], E = J[`${side}ForeArm`], H = J[`${side}Hand`];
    if (u === undefined || f === undefined || !S || !E || !H) continue;
    const seg = (a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; return { a, d, len: Math.hypot(...d) }; };
    const up = seg(S, E), lo = seg(E, H);
    const at = (s, x, y, z) => {
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * s.d[0] + (y - s.a[1]) * s.d[1] + (z - s.a[2]) * s.d[2]) / (s.len * s.len || 1)));
      return { t, dist: Math.hypot(x - (s.a[0] + s.d[0] * t), y - (s.a[1] + s.d[1] * t), z - (s.a[2] + s.d[2] * t)) };
    };
    for (let w = 0; w < nW; w++) {
      const arm = W[w * NB + u] + W[w * NB + f];
      if (arm < 1e-4) continue;
      const x = wPos[w * 3], y = wPos[w * 3 + 1], z = wPos[w * 3 + 2];
      const a = at(up, x, y, z), b = at(lo, x, y, z);
      const s = a.dist < b.dist ? -(1 - a.t) * up.len : b.t * lo.len;
      const fore = smooth(-band, band, s);
      W[w * NB + u] = arm * (1 - fore);
      W[w * NB + f] = arm * fore;
      if (Math.abs(s) < band) n++;
    }
  }
  console.log(`elbow: ${n} welded vertices in the elbow blends`);
}

export function applyNeckRule({ W, wPos, wCol, nW, NB, boneIndex, color, neck }) {
  const { collarY, jawLineY, axis, radius, margin = 0.02, faceRadius = 0.12, include = () => true } = neck;
  const nb = boneIndex.get('Neck'), hb = boneIndex.get('Head');
  const lerpTo = (w, target, k) => { for (let b = 0; b < NB; b++) W[w * NB + b] += (target[b] - W[w * NB + b]) * k; };
  const target = new Float32Array(NB);
  let col = 0, face = 0;
  for (let w = 0; w < nW; w++) {
    const [x, y, z] = [wPos[w * 3], wPos[w * 3 + 1], wPos[w * 3 + 2]];
    if (y < collarY - 0.03 || y > jawLineY + 0.12) continue;
    const ok = !color || include(wCol.subarray(w * 3, w * 3 + 3));
    const d = Math.hypot(x - axis[0], z - axis[1]);
    const inCol = ok ? smooth(radius + 0.012, radius - 0.008, d) * smooth(collarY - 0.02, collarY, y) * (y < jawLineY + 0.06 ? 1 : 0) : 0;
    // The face rule ignores colour (lips and the mouth's shadows fail a skin test) and starts in front of the neck axis, where no
    // collar or stethoscope reaches.
    const inFace = (1 - inCol) * smooth(faceRadius, faceRadius - 0.02, d) * smooth(0.005, 0.025, z - axis[1]) *
      smooth(jawLineY - margin - 0.015, jawLineY - margin, y);
    if (inFace > 0) {
      // Head only: keep whatever head share there is, give the rest to the head too.
      target.fill(0);
      target[hb] = 1;
      lerpTo(w, target, inFace);
      if (inFace > 0.5) face++;
    }
    if (inCol > 0) {
      const t = smooth(collarY, jawLineY, y);
      target.fill(0);
      target[nb] = 1 - t;
      target[hb] = t;
      lerpTo(w, target, inCol);
      if (inCol > 0.5) col++;
    }
  }
  console.log(`neck: ${col} welded vertices in the neck column, ${face} on the lower face`);
}

// ------------------------------------------------------------------ pack
/**
 * Writes the skinned body as a GLB: float positions, int8 normals and u16 UVs (KHR_mesh_quantization), u8 joints, u16 weights,
 * vertex-cache-ordered and EXT_meshopt_compression-encoded buffers, WebP textures (EXT_texture_webp).
 */
export async function packBody({ dst, meshName, materialName, generator, extras, body, skin, J, color, normal, doubleSided = false }) {
  await MeshoptEncoder.ready;
  const { pos, nor, uv } = body;
  const { names, parentOf, joints, weights } = skin;
  const count = pos.length / 3;
  // Vertex cache / fetch order (compresses better).
  const idx32 = new Uint32Array(body.indices);
  const [remap, unique] = MeshoptEncoder.reorderMesh(idx32, true, false);
  const P = new Float32Array(unique * 3), Nq = new Int8Array(unique * 4), Uq = new Uint16Array(unique * 2);
  const Jq = new Uint8Array(unique * 4), Wq = new Uint16Array(unique * 4);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < count; v++) {
    const r = remap[v];
    if (r === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) {
      P[r * 3 + k] = pos[v * 3 + k];
      min[k] = Math.min(min[k], pos[v * 3 + k]); max[k] = Math.max(max[k], pos[v * 3 + k]);
      Nq[r * 4 + k] = Math.round(Math.max(-1, Math.min(1, nor[v * 3 + k])) * 127);
    }
    for (let k = 0; k < 2; k++) Uq[r * 2 + k] = Math.round(Math.max(0, Math.min(1, uv[v * 2 + k])) * 65535);
    for (let k = 0; k < 4; k++) { Jq[r * 4 + k] = joints[v * 4 + k]; Wq[r * 4 + k] = weights[v * 4 + k]; }
  }
  const I16 = Uint16Array.from(idx32);

  const chunks = [];
  let packed = 0, raw = 0;
  const views = [];
  const accessors = [];
  const pad4 = (n) => (n + 3) & ~3;
  const addRaw = (buf) => {
    const bytes = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    chunks.push(bytes, Buffer.alloc(pad4(bytes.length) - bytes.length));
    views.push({ buffer: 0, byteOffset: packed, byteLength: bytes.length });
    packed += pad4(bytes.length);
    return views.length - 1;
  };
  const addCompressed = (typed, n, stride, mode, target) => {
    const src = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const enc = Buffer.from(MeshoptEncoder.encodeGltfBuffer(src, n, stride, mode));
    chunks.push(enc, Buffer.alloc(pad4(enc.length) - enc.length));
    const view = {
      buffer: 1, byteOffset: raw, byteLength: n * stride, ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}), target,
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: packed, byteLength: enc.length, byteStride: stride, mode, count: n } },
    };
    packed += pad4(enc.length);
    raw += pad4(n * stride);
    views.push(view);
    return views.length - 1;
  };
  const acc = (view, componentType, type, n, extra = {}) => { accessors.push({ bufferView: view, componentType, type, count: n, ...extra }); return accessors.length - 1; };
  const attrs = {
    POSITION: acc(addCompressed(P, unique, 12, 'ATTRIBUTES', 34962), 5126, 'VEC3', unique, { min, max }),
    NORMAL: acc(addCompressed(Nq, unique, 4, 'ATTRIBUTES', 34962), 5120, 'VEC3', unique, { normalized: true }),
    TEXCOORD_0: acc(addCompressed(Uq, unique, 4, 'ATTRIBUTES', 34962), 5123, 'VEC2', unique, { normalized: true }),
    JOINTS_0: acc(addCompressed(Jq, unique, 4, 'ATTRIBUTES', 34962), 5121, 'VEC4', unique),
    WEIGHTS_0: acc(addCompressed(Wq, unique, 8, 'ATTRIBUTES', 34962), 5123, 'VEC4', unique, { normalized: true }),
  };
  const indexAcc = acc(addCompressed(I16, I16.length, 2, 'TRIANGLES', 34963), 5123, 'SCALAR', I16.length);
  const ibm = new Float32Array(names.length * 16);
  names.forEach((n, i) => ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -J[n][0], -J[n][1], -J[n][2], 1], i * 16));
  const ibmAcc = acc(addRaw(ibm), 5126, 'MAT4', names.length);
  const colorView = addRaw(color);
  const normalView = addRaw(normal);

  const boneIndex = new Map(names.map((n, i) => [n, i]));
  const nodes = names.map((n) => {
    const p = parentOf(n);
    const o = p ? J[p] : [0, 0, 0];
    return { name: n, translation: J[n].map((x, k) => +(x - o[k]).toFixed(6)) };
  });
  names.forEach((n, i) => { const p = parentOf(n); if (p) (nodes[boneIndex.get(p)].children ??= []).push(i); });
  const root = boneIndex.get('Hips');
  const meshNode = nodes.length;
  nodes.push({ name: meshName, mesh: 0, skin: 0 });
  const json = {
    asset: { version: '2.0', generator, extras },
    extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization'],
    extensionsRequired: ['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [root, meshNode] }],
    nodes,
    meshes: [{ name: meshName, primitives: [{ attributes: attrs, indices: indexAcc, material: 0 }] }],
    skins: [{ joints: names.map((_, i) => i), inverseBindMatrices: ibmAcc, skeleton: root }],
    materials: [{
      name: materialName,
      ...(doubleSided ? { doubleSided: true } : {}),
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 },
      normalTexture: { index: 1 },
    }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [0, 1].map((source) => ({ sampler: 0, extensions: { EXT_texture_webp: { source } } })),
    images: [{ bufferView: colorView, mimeType: 'image/webp' }, { bufferView: normalView, mimeType: 'image/webp' }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: packed }, { byteLength: raw, extensions: { EXT_meshopt_compression: { fallback: true } } }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const body2 = Buffer.concat(chunks);
  const glb = Buffer.alloc(12 + 8 + js.length + 8 + body2.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(js.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); js.copy(glb, 20);
  glb.writeUInt32LE(body2.length, 20 + js.length); glb.writeUInt32LE(0x004e4942, 24 + js.length); body2.copy(glb, 28 + js.length);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, glb);
  console.log('wrote', dst, `${(glb.length / 1024).toFixed(0)} KB, ${I16.length / 3} triangles, ${unique} vertices, ${names.length} bones`);
}

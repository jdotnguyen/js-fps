// Prepares the Sketchfab "Location underground laboratory" GLB (bazz4r, CC-BY 4.0) for src/world/labWorld.ts.
//   node scripts/fix-lab-glb.mjs <source.glb> [public/assets/models/lab/underground_lab]
// The source is an 18.6 MB static scene (~223k triangles, 630 single-primitive meshes, 1,691 nodes, no textures, white vertex colours,
// KHR_materials_pbrSpecularGlossiness materials, already in metres, Y up). What it does:
//   - bakes every node transform into the vertices and re-centres the map on x/z = 0 (y is left alone: the main floor sits near y = 0);
//   - drops UVs and vertex colours, converts the three spec/gloss materials to metallic/roughness, and merges the 630 meshes into
//     one mesh per (material, 16 m x/z tile) so frustum culling still works while draw calls drop to a few dozen;
//   - voxelizes every surface (0.25 m horizontally, 0.1 m vertically) and greedily merges the voxels into axis-aligned collider boxes,
//     written as quantised int16 (1 cm) to <out>.colliders.bin because the game's CollisionWorld only knows boxes (ADR-0003/0004);
//   - finds a spawn point on the main floor and a sparse set of ceiling-lamp positions, written with the bounds to <out>.json.
// Output: <out>.glb, <out>.colliders.bin, <out>.json
import fs from 'node:fs';
import path from 'node:path';

const [src, outBase = 'public/assets/models/lab/underground_lab'] = process.argv.slice(2);
if (!src) throw new Error('usage: node scripts/fix-lab-glb.mjs <source.glb> [out-base]');

const VX = 0.25; // collider voxel size, x and z
const VY = 0.1; // collider voxel size, y
const TILE = 16; // render tile size, x and z
const SKIP_BELOW = 0.18; // pieces with every bounding-box side under this are ignored for collision

// ------------------------------------------------------------------ read source GLB
const d = fs.readFileSync(src);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);
const COMP = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
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
const world = new Map();
const walk = (i, parent) => {
  const m = mul(parent, localMat(j.nodes[i]));
  world.set(i, m);
  for (const c of j.nodes[i].children ?? []) walk(c, m);
};
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const r of j.scenes[j.scene ?? 0].nodes) walk(r, I4);

// ------------------------------------------------------------------ bake
/** @type {{mat:number, pos:Float32Array, nrm:Float32Array, idx:Uint32Array, name:string}[]} */
const prims = [];
let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (const [ni, m] of world) {
  const node = j.nodes[ni];
  if (node.mesh === undefined) continue;
  // Normal matrix: inverse transpose of the upper 3x3 (cheap general form via cofactors).
  const a = m[0], b = m[4], c = m[8], dd = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i2 = m[10];
  const nm = [
    e * i2 - f * h, f * g - dd * i2, dd * h - e * g,
    c * h - b * i2, a * i2 - c * g, b * g - a * h,
    b * f - c * e, c * dd - a * f, a * e - b * dd,
  ]; // row-major cofactor matrix == inverse transpose up to a positive scale (determinant sign handled below)
  const det = a * (e * i2 - f * h) - b * (dd * i2 - f * g) + c * (dd * h - e * g);
  const flip = det < 0;
  for (const p of j.meshes[node.mesh].primitives) {
    const P = read(p.attributes.POSITION);
    const N = read(p.attributes.NORMAL);
    const n = P.length / 3;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      pos[v * 3] = wx; pos[v * 3 + 1] = wy; pos[v * 3 + 2] = wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      const nx0 = N[v * 3], ny0 = N[v * 3 + 1], nz0 = N[v * 3 + 2];
      let nx = nm[0] * nx0 + nm[3] * ny0 + nm[6] * nz0;
      let ny = nm[1] * nx0 + nm[4] * ny0 + nm[7] * nz0;
      let nz = nm[2] * nx0 + nm[5] * ny0 + nm[8] * nz0;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[v * 3] = nx / l; nrm[v * 3 + 1] = ny / l; nrm[v * 3 + 2] = nz / l;
    }
    let idx;
    if (p.indices !== undefined) idx = read(p.indices);
    else idx = Uint32Array.from({ length: n }, (_, k) => k);
    if (flip) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    prims.push({ mat: p.material ?? 0, pos, nrm, idx, name: node.name ?? '' });
  }
}
const cx = (minX + maxX) / 2;
const cz = (minZ + maxZ) / 2;
for (const p of prims) for (let v = 0; v < p.pos.length; v += 3) { p.pos[v] -= cx; p.pos[v + 2] -= cz; }
minX -= cx; maxX -= cx; minZ -= cz; maxZ -= cz;
console.log(`baked ${prims.length} primitives; bounds x ${minX.toFixed(1)}..${maxX.toFixed(1)} y ${minY.toFixed(1)}..${maxY.toFixed(1)} z ${minZ.toFixed(1)}..${maxZ.toFixed(1)}`);

// ------------------------------------------------------------------ materials (spec/gloss -> metal/rough)
const materials = j.materials.map((m) => {
  const sg = m.extensions?.KHR_materials_pbrSpecularGlossiness ?? {};
  const df = sg.diffuseFactor ?? [0.6, 0.6, 0.6, 1];
  const out = {
    name: m.name,
    pbrMetallicRoughness: { baseColorFactor: df, metallicFactor: 0, roughnessFactor: Math.min(1, Math.max(0.2, 1 - (sg.glossinessFactor ?? 0.4))) },
  };
  if (m.alphaMode === 'BLEND') { out.alphaMode = 'BLEND'; out.doubleSided = true; }
  return out;
});

// ------------------------------------------------------------------ render tiles
const tiles = new Map(); // key -> builder
for (const p of prims) {
  const remaps = new Map();
  for (let t = 0; t < p.idx.length; t += 3) {
    const i0 = p.idx[t], i1 = p.idx[t + 1], i2 = p.idx[t + 2];
    const tx = (p.pos[i0 * 3] + p.pos[i1 * 3] + p.pos[i2 * 3]) / 3;
    const tz = (p.pos[i0 * 3 + 2] + p.pos[i1 * 3 + 2] + p.pos[i2 * 3 + 2]) / 3;
    const key = `${p.mat}|${Math.floor((tx - minX) / TILE)}|${Math.floor((tz - minZ) / TILE)}`;
    let b = tiles.get(key);
    if (!b) tiles.set(key, (b = { mat: p.mat, key, pos: [], nrm: [], idx: [], map: new Map() }));
    let rm = b.map.get(p);
    if (!rm) b.map.set(p, (rm = new Map()));
    for (const vi of [i0, i1, i2]) {
      let ni = rm.get(vi);
      if (ni === undefined) {
        ni = b.pos.length / 3;
        rm.set(vi, ni);
        b.pos.push(p.pos[vi * 3], p.pos[vi * 3 + 1], p.pos[vi * 3 + 2]);
        b.nrm.push(p.nrm[vi * 3], p.nrm[vi * 3 + 1], p.nrm[vi * 3 + 2]);
      }
      b.idx.push(ni);
    }
  }
}

const chunks = [];
let offset = 0;
const bufferViews = [];
const accessors = [];
const meshes = [];
const nodes = [];
const pad = (n) => (4 - (n % 4)) % 4;
function addView(typed, target) {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const p = pad(buf.length);
  chunks.push(buf, Buffer.alloc(p));
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
  offset += buf.length + p;
  return bufferViews.length - 1;
}
let triOut = 0;
for (const b of [...tiles.values()].sort((a, c) => a.key.localeCompare(c.key))) {
  const nv = b.pos.length / 3;
  const pos = new Float32Array(b.pos);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < pos.length; v += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v + k]); hi[k] = Math.max(hi[k], pos[v + k]); }
  const small = nv < 65536;
  const idx = small ? new Uint16Array(b.idx) : new Uint32Array(b.idx);
  accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: nv, type: 'VEC3', min: lo, max: hi });
  const aPos = accessors.length - 1;
  accessors.push({ bufferView: addView(new Float32Array(b.nrm), 34962), componentType: 5126, count: nv, type: 'VEC3' });
  const aNrm = accessors.length - 1;
  accessors.push({ bufferView: addView(idx, 34963), componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
  const aIdx = accessors.length - 1;
  meshes.push({ name: `lab_${b.key.replace(/\|/g, '_')}`, primitives: [{ attributes: { POSITION: aPos, NORMAL: aNrm }, indices: aIdx, material: b.mat }] });
  nodes.push({ name: meshes.at(-1).name, mesh: meshes.length - 1 });
  triOut += idx.length / 3;
}
const total = Buffer.concat(chunks);
const outJson = {
  asset: { version: '2.0', generator: 'fix-lab-glb.mjs', copyright: 'Location underground laboratory by bazz4r (CC-BY-4.0), https://sketchfab.com/3d-models/location-underground-laboratory-7f70eebd1f044277b91c197fb17c513e' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes, meshes, materials, accessors, bufferViews,
  buffers: [{ byteLength: total.length }],
};
const js = Buffer.from(JSON.stringify(outJson));
const jp = Buffer.concat([js, Buffer.alloc(pad(js.length), 0x20)]);
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jp.length + 8 + total.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jp.length, 0); jh.write('JSON', 4, 'ascii');
const bh = Buffer.alloc(8); bh.writeUInt32LE(total.length, 0); bh.write('BIN\0', 4, 'ascii');
fs.mkdirSync(path.dirname(outBase), { recursive: true });
fs.writeFileSync(`${outBase}.glb`, Buffer.concat([header, jh, jp, bh, total]));
console.log(`wrote ${outBase}.glb: ${meshes.length} meshes, ${triOut} triangles, ${((12 + 16 + jp.length + total.length) / 1048576).toFixed(1)} MB`);

// ------------------------------------------------------------------ voxelize for collision
const ox = Math.floor(minX / VX) * VX - VX;
const oy = Math.floor(minY / VY) * VY - VY;
const oz = Math.floor(minZ / VX) * VX - VX;
const NX = Math.ceil((maxX - ox) / VX) + 2;
const NY = Math.ceil((maxY - oy) / VY) + 2;
const NZ = Math.ceil((maxZ - oz) / VX) + 2;
const grid = new Uint8Array(NX * NY * NZ);
const at = (x, y, z) => (y * NZ + z) * NX + x;
const EPS_Y = 1e-3; // a face exactly on a voxel boundary belongs to the voxel below, so floors keep their true top height
function mark(x, y, z) {
  const ix = Math.floor((x - ox) / VX), iy = Math.floor((y - EPS_Y - oy) / VY), iz = Math.floor((z - oz) / VX);
  grid[at(ix, iy, iz)] = 1;
}
let skipped = 0;
for (const p of prims) {
  let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
  for (let v = 0; v < p.pos.length; v += 3) {
    lx = Math.min(lx, p.pos[v]); hx = Math.max(hx, p.pos[v]);
    ly = Math.min(ly, p.pos[v + 1]); hy = Math.max(hy, p.pos[v + 1]);
    lz = Math.min(lz, p.pos[v + 2]); hz = Math.max(hz, p.pos[v + 2]);
  }
  if (Math.max(hx - lx, hy - ly, hz - lz) < SKIP_BELOW) { skipped++; continue; }
  for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t] * 3, b = p.idx[t + 1] * 3, c = p.idx[t + 2] * 3;
    const e = Math.max(
      Math.hypot(p.pos[b] - p.pos[a], p.pos[b + 1] - p.pos[a + 1], p.pos[b + 2] - p.pos[a + 2]),
      Math.hypot(p.pos[c] - p.pos[a], p.pos[c + 1] - p.pos[a + 1], p.pos[c + 2] - p.pos[a + 2]),
      Math.hypot(p.pos[c] - p.pos[b], p.pos[c + 1] - p.pos[b + 1], p.pos[c + 2] - p.pos[b + 2]),
    );
    const n = Math.max(1, Math.ceil(e / 0.06));
    for (let i = 0; i <= n; i++) {
      for (let k = 0; k <= n - i; k++) {
        const u = i / n, v = k / n, w = 1 - u - v;
        mark(p.pos[a] * w + p.pos[b] * u + p.pos[c] * v, p.pos[a + 1] * w + p.pos[b + 1] * u + p.pos[c + 1] * v, p.pos[a + 2] * w + p.pos[b + 2] * u + p.pos[c + 2] * v);
      }
    }
  }
}
console.log(`voxelized (${skipped} tiny pieces skipped), grid ${NX}x${NY}x${NZ}`);

// Snapshot the solids before merging consumes them: spawn and lamps look at this.
const solid = grid.slice();

// Greedy merge: extend along x, then z, then y.
const boxes = [];
for (let y = 0; y < NY; y++) for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
  if (grid[at(x, y, z)] !== 1) continue;
  let x1 = x; while (x1 + 1 < NX && grid[at(x1 + 1, y, z)] === 1) x1++;
  let z1 = z;
  grow: while (z1 + 1 < NZ) { for (let xi = x; xi <= x1; xi++) if (grid[at(xi, y, z1 + 1)] !== 1) break grow; z1++; }
  let y1 = y;
  grow2: while (y1 + 1 < NY) { for (let zi = z; zi <= z1; zi++) for (let xi = x; xi <= x1; xi++) if (grid[at(xi, y1 + 1, zi)] !== 1) break grow2; y1++; }
  for (let yi = y; yi <= y1; yi++) for (let zi = z; zi <= z1; zi++) for (let xi = x; xi <= x1; xi++) grid[at(xi, yi, zi)] = 2;
  boxes.push([x, y, z, x1 + 1, y1 + 1, z1 + 1]);
}
// Boxes as int16 centimetres relative to the grid origin (ox, oy, oz).
const q = new Int16Array(boxes.length * 6);
boxes.forEach((b, i) => {
  q[i * 6] = Math.round(b[0] * VX * 100); q[i * 6 + 1] = Math.round(b[1] * VY * 100); q[i * 6 + 2] = Math.round(b[2] * VX * 100);
  q[i * 6 + 3] = Math.round(b[3] * VX * 100); q[i * 6 + 4] = Math.round(b[4] * VY * 100); q[i * 6 + 5] = Math.round(b[5] * VX * 100);
});
fs.writeFileSync(`${outBase}.colliders.bin`, Buffer.from(q.buffer));
console.log(`merged into ${boxes.length} collider boxes (${(q.byteLength / 1024).toFixed(0)} KB)`);

// ------------------------------------------------------------------ spawn and lamps
const isSolid = (x, y, z) => x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ || solid[at(x, y, z)] === 1;
const HEAD = Math.ceil(1.9 / VY);
/** Ground voxel row (top of the highest solid with HEAD free voxels above it) for a column, searching from `fromY` down; -1 if none. */
function groundRow(x, z, fromY) {
  for (let y = Math.min(fromY, NY - HEAD - 1); y >= 0; y--) {
    if (!solid[at(x, y, z)]) continue;
    let free = true;
    for (let k = 1; k <= HEAD; k++) if (solid[at(x, y + k, z)]) { free = false; break; }
    if (free) return y;
  }
  return -1;
}
const yToRow = (y) => Math.floor((y - oy) / VY);
const rowTop = (r) => oy + (r + 1) * VY;
// Main floor: the highest-count floor height of walkable columns.
const hist = new Map();
for (let z = 0; z < NZ; z += 2) for (let x = 0; x < NX; x += 2) {
  // Every walkable surface in the column (solid with HEAD free voxels above), not just the topmost.
  for (let y = NY - HEAD - 1; y >= 0; y--) {
    if (!solid[at(x, y, z)]) continue;
    let free = true;
    for (let k = 1; k <= HEAD; k++) if (solid[at(x, y + k, z)]) { free = false; break; }
    if (free) hist.set(y, (hist.get(y) ?? 0) + 1);
  }
}
const mainRow = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
// Every floor level with real walkable area (>= 40 m2), nearby rows merged: the map is multi-level, so nav needs them all.
const AREA = (2 * VX) ** 2; // m2 per sampled column
const smooth = (r) => ((hist.get(r - 1) ?? 0) + (hist.get(r) ?? 0) + (hist.get(r + 1) ?? 0)) * AREA;
// A flat floor piles its area into one or two rows; stairs spread thinly across many, so they never qualify.
const floorRows = [...hist.keys()].filter((r) => smooth(r) >= 40 && (hist.get(r) ?? 0) * AREA >= 15).sort((a, b) => a - b);
const floorLevels = [];
for (const r of floorRows) {
  const last = floorLevels.at(-1);
  if (last && r - last.rows.at(-1) <= 1) last.rows.push(r); else floorLevels.push({ rows: [r] });
}
const floors = floorLevels.map((l) => {
  const best = l.rows.reduce((a, b) => (hist.get(b) > hist.get(a) ? b : a));
  return { y: +rowTop(best).toFixed(2), area: Math.round(l.rows.reduce((t, r) => t + hist.get(r), 0) * AREA) };
});
console.log('floor levels', JSON.stringify(floors));
// Spawn: the column on the main floor with the most open floor around it, nearest the middle among the roomiest.
function clearance(x, z) {
  for (let r = 1; r <= 16; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const xx = x + dx, zz = z + dz;
      if (xx < 0 || zz < 0 || xx >= NX || zz >= NZ) return r;
      const g = groundRow(xx, zz, mainRow + 4);
      if (g < mainRow - 1 || g > mainRow + 1) return r;
    }
  }
  return 16;
}
let best = null;
for (let z = 0; z < NZ; z += 2) for (let x = 0; x < NX; x += 2) {
  const g = groundRow(x, z, mainRow + 4);
  if (g < mainRow - 1 || g > mainRow + 1) continue;
  const c = clearance(x, z);
  const dist = Math.hypot(ox + x * VX - 0, oz + z * VX - 0);
  const score = c * 100 - dist;
  if (!best || score > best.score) best = { score, c, x, z, g };
}
const spawn = { x: +(ox + (best.x + 0.5) * VX).toFixed(2), y: +rowTop(best.g).toFixed(2), z: +(oz + (best.z + 0.5) * VX).toFixed(2) };
console.log(`main floor y=${rowTop(mainRow).toFixed(2)}, spawn`, spawn, `clearance ${(best.c * VX).toFixed(1)} m`);

// Ceiling lamp candidates every 6 m on any walkable floor with a ceiling 2.4..6 m above it.
const lamps = [];
const STEP = Math.round(6 / VX);
for (let z = STEP / 2; z < NZ; z += STEP) for (let x = STEP / 2; x < NX; x += STEP) {
  for (let from = NY; from > 0;) {
    const g = groundRow(x, z, from - 1);
    if (g < 0) break;
    let top = -1;
    for (let y = g + HEAD; y < Math.min(NY, g + Math.ceil(6 / VY)); y++) if (solid[at(x, y, z)]) { top = y; break; }
    if (top >= 0 && (top - g) * VY >= 2.4) lamps.push({ x: +(ox + (x + 0.5) * VX).toFixed(2), y: +(oy + top * VY - 0.35).toFixed(2), z: +(oz + (z + 0.5) * VX).toFixed(2) });
    from = g - 1;
  }
}
console.log(`${lamps.length} lamp candidates`);

fs.writeFileSync(
  `${outBase}.json`,
  JSON.stringify({
    source: 'Location underground laboratory by bazz4r, CC-BY-4.0',
    bounds: { min: [+minX.toFixed(2), +minY.toFixed(2), +minZ.toFixed(2)], max: [+maxX.toFixed(2), +maxY.toFixed(2), +maxZ.toFixed(2)] },
    colliders: { file: `${path.basename(outBase)}.colliders.bin`, count: boxes.length, origin: [+ox.toFixed(3), +oy.toFixed(3), +oz.toFixed(3)], unit: 0.01 },
    mainFloorY: +rowTop(mainRow).toFixed(2),
    floors,
    spawn,
    lamps,
  }),
);

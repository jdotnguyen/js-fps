// Post-processes public/assets/models/lab/underground_lab.glb to add world-space box-projected UVs (TEXCOORD_0)
// and split the single opaque material (base_mat) into zone + surface-role primitives per 16 m tile.
// Idempotent: safe to re-run on the already-baked underground_lab.glb without needing the original Sketchfab source.
//   node scripts/texture-lab-glb.mjs [public/assets/models/lab/underground_lab]
import fs from 'node:fs';

const base = process.argv[2] ?? 'public/assets/models/lab/underground_lab';
const glbPath = `${base}.glb`;
const metaPath = `${base}.json`;

const TILE = 16;

const d = fs.readFileSync(glbPath);
const jsonLen = d.readUInt32LE(12);
const j = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = d.subarray(20 + jsonLen + 8);
const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const floorYs = meta.floors.map((f) => f.y);

const COMP = { 5120: [1, 'getInt8'], 5121: [1, 'getUint8'], 5122: [2, 'getInt16'], 5123: [2, 'getUint16'], 5125: [4, 'getUint32'], 5126: [4, 'getFloat32'] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readAccessor(ai) {
  const a = j.accessors[ai];
  const bv = j.bufferViews[a.bufferView];
  const [size, fn] = COMP[a.componentType];
  const n = NCOMP[a.type];
  const stride = bv.byteStride ?? size * n;
  const offset = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new (a.componentType === 5126 ? Float32Array : Uint32Array)(a.count * n);
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < n; k++) out[i * n + k] = dv[fn](offset + i * stride + k * size, true);
  }
  return out;
}

const MAT_NAMES = [
  'lab_hub_floor',
  'lab_hub_wall',
  'lab_hub_ceiling',
  'lab_hub_prop',
  'lab_east_floor',
  'lab_east_upper_floor',
  'lab_east_wall',
  'lab_east_ceiling',
  'lab_east_prop',
  'lab_west_floor',
  'lab_west_wall',
  'lab_west_ceiling',
  'lab_west_prop',
  'lab_north_floor',
  'lab_north_wall',
  'lab_north_ceiling',
  'lab_north_prop',
  'glass',
  'Material_44',
];
const MAT_IDX = Object.fromEntries(MAT_NAMES.map((name, i) => [name, i]));

const outMaterials = MAT_NAMES.map((name) => {
  if (name === 'glass') {
    return { name, pbrMetallicRoughness: { baseColorFactor: [0.58, 0.58, 0.58, 0.29], metallicFactor: 0, roughnessFactor: 0.63 }, alphaMode: 'BLEND', doubleSided: true };
  }
  if (name === 'Material_44') {
    return { name, pbrMetallicRoughness: { baseColorFactor: [0.55, 0.68, 0.88, 0.28], metallicFactor: 0, roughnessFactor: 0.79 }, alphaMode: 'BLEND', doubleSided: true };
  }
  return { name, pbrMetallicRoughness: { baseColorFactor: [0.6, 0.6, 0.6, 1], metallicFactor: 0.1, roughnessFactor: 0.65 } };
});

function classifySourceMaterial(matIndex) {
  const name = j.materials[matIndex]?.name ?? '';
  if (name.startsWith('lab_roof')) return 'skip';
  if (name === 'glass') return 'glass';
  if (name === 'Material_44') return 'blue_glass';
  return 'opaque';
}

function isNearFloorY(y) {
  for (const fy of floorYs) {
    if (Math.abs(y - fy) <= 0.2) return true;
  }
  return false;
}

function classifyZone(cx, cy, cz) {
  if (cx >= -10 && cx <= 10 && cz >= 0 && cy < -1.0) return 'hub';
  if (cx > 10) return 'east';
  if (cz < 0 && cx >= -10 && cx <= 10) return 'north';
  return 'west';
}

function pickMaterialIndex(srcKind, cx, cy, cz, fny) {
  if (srcKind === 'glass') return MAT_IDX.glass;
  if (srcKind === 'blue_glass') return MAT_IDX.Material_44;

  const zone = classifyZone(cx, cy, cz);
  let role = 'prop';
  if (fny > 0.7 && isNearFloorY(cy)) role = 'floor';
  else if (fny < -0.7) role = 'ceiling';
  else if (Math.abs(fny) <= 0.35) role = 'wall';

  if (zone === 'east' && role === 'floor' && cy >= -2.5) return MAT_IDX.lab_east_upper_floor;
  return MAT_IDX[`lab_${zone}_${role}`];
}

/**
 * Box-project UV (1 UV unit = 1 m) from world position and dominant face normal axis.
 * Returns [axisId, u, v] so vertices with different projection axes do not share UVs.
 */
function projectUv(x, y, z, fnx, fny, fnz) {
  const ax = Math.abs(fnx);
  const ay = Math.abs(fny);
  const az = Math.abs(fnz);
  if (ay >= ax && ay >= az) return [0, x, z];
  if (ax >= az) return [1, fnx > 0 ? -z : z, y];
  return [2, fnz > 0 ? x : -x, y];
}

const minX = meta.bounds.min[0];
const minZ = meta.bounds.min[2];
const tileMap = new Map();

function getPrimBuilder(tileKey, matIdx) {
  let mats = tileMap.get(tileKey);
  if (!mats) tileMap.set(tileKey, (mats = new Map()));
  let b = mats.get(matIdx);
  if (!b) mats.set(matIdx, (b = { pos: [], nrm: [], uv: [], idx: [], vmap: new Map() }));
  return b;
}

let totalTris = 0;
const roleCounts = new Array(outMaterials.length).fill(0);

for (let mi = 0; mi < j.meshes.length; mi++) {
  const mesh = j.meshes[mi];
  for (const p of mesh.primitives) {
    const srcKind = classifySourceMaterial(p.material ?? 0);
    if (srcKind === 'skip') continue;
    const pos = readAccessor(p.attributes.POSITION);
    const nrm = readAccessor(p.attributes.NORMAL);
    const idx = p.indices !== undefined ? readAccessor(p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);

    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t];
      const i1 = idx[t + 1];
      const i2 = idx[t + 2];

      const x0 = pos[i0 * 3], y0 = pos[i0 * 3 + 1], z0 = pos[i0 * 3 + 2];
      const x1 = pos[i1 * 3], y1 = pos[i1 * 3 + 1], z1 = pos[i1 * 3 + 2];
      const x2 = pos[i2 * 3], y2 = pos[i2 * 3 + 1], z2 = pos[i2 * 3 + 2];

      const ex1 = x1 - x0, ey1 = y1 - y0, ez1 = z1 - z0;
      const ex2 = x2 - x0, ey2 = y2 - y0, ez2 = z2 - z0;
      let fnx = ey1 * ez2 - ez1 * ey2;
      let fny = ez1 * ex2 - ex1 * ez2;
      let fnz = ex1 * ey2 - ey1 * ex2;
      const fl = Math.hypot(fnx, fny, fnz) || 1;
      fnx /= fl;
      fny /= fl;
      fnz /= fl;

      const cx = (x0 + x1 + x2) / 3;
      const cy = (y0 + y1 + y2) / 3;
      const cz = (z0 + z1 + z2) / 3;

      const matIdx = pickMaterialIndex(srcKind, cx, cy, cz, fny);
      const tx = Math.floor((cx - minX) / TILE);
      const tz = Math.floor((cz - minZ) / TILE);
      const tileKey = `${tx}_${tz}`;
      const b = getPrimBuilder(tileKey, matIdx);

      const [axis] = projectUv(cx, cy, cz, fnx, fny, fnz);
      for (const vi of [i0, i1, i2]) {
        const vx = pos[vi * 3], vy = pos[vi * 3 + 1], vz = pos[vi * 3 + 2];
        const [, u, v] = projectUv(vx, vy, vz, fnx, fny, fnz);
        const key = `${mi}_${vi}_${axis}`;
        let ni = b.vmap.get(key);
        if (ni === undefined) {
          ni = b.pos.length / 3;
          b.vmap.set(key, ni);
          b.pos.push(vx, vy, vz);
          b.nrm.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
          b.uv.push(u, v);
        }
        b.idx.push(ni);
      }
      totalTris++;
      roleCounts[matIdx]++;
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

for (const tileKey of [...tileMap.keys()].sort()) {
  const mats = tileMap.get(tileKey);
  const primitives = [];
  for (const matIdx of [...mats.keys()].sort((a, b) => a - b)) {
    const b = mats.get(matIdx);
    const nv = b.pos.length / 3;
    const pos = new Float32Array(b.pos);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < pos.length; v += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], pos[v + k]);
        hi[k] = Math.max(hi[k], pos[v + k]);
      }
    }
    const small = nv < 65536;
    const idx = small ? new Uint16Array(b.idx) : new Uint32Array(b.idx);

    accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: nv, type: 'VEC3', min: lo, max: hi });
    const aPos = accessors.length - 1;
    accessors.push({ bufferView: addView(new Float32Array(b.nrm), 34962), componentType: 5126, count: nv, type: 'VEC3' });
    const aNrm = accessors.length - 1;
    accessors.push({ bufferView: addView(new Float32Array(b.uv), 34962), componentType: 5126, count: nv, type: 'VEC2' });
    const aUv = accessors.length - 1;
    accessors.push({ bufferView: addView(idx, 34963), componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
    const aIdx = accessors.length - 1;

    primitives.push({ attributes: { POSITION: aPos, NORMAL: aNrm, TEXCOORD_0: aUv }, indices: aIdx, material: matIdx });
  }
  const name = `lab_tile_${tileKey}`;
  meshes.push({ name, primitives });
  nodes.push({ name, mesh: meshes.length - 1 });
}

const total = Buffer.concat(chunks);
const outJson = {
  asset: j.asset ?? { version: '2.0', generator: 'texture-lab-glb.mjs' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, i) => i) }],
  nodes,
  meshes,
  materials: outMaterials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: total.length }],
};

const js = Buffer.from(JSON.stringify(outJson));
const jp = Buffer.concat([js, Buffer.alloc(pad(js.length), 0x20)]);
const header = Buffer.alloc(12);
header.write('glTF', 0, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jp.length + 8 + total.length, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(jp.length, 0);
jh.write('JSON', 4, 'ascii');
const bh = Buffer.alloc(8);
bh.writeUInt32LE(total.length, 0);
bh.write('BIN\0', 4, 'ascii');

fs.writeFileSync(glbPath, Buffer.concat([header, jh, jp, bh, total]));

console.log(`wrote ${glbPath}: ${meshes.length} tile meshes, ${totalTris} triangles, ${((12 + 16 + jp.length + total.length) / 1048576).toFixed(1)} MB`);
outMaterials.forEach((m, i) => console.log(`  ${m.name}: ${roleCounts[i]} tris`));

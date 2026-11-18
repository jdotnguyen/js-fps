import * as THREE from 'three';

/**
 * Signed-distance modelling for organic shapes (hands). Primitives are smooth-unioned into
 * one field, then meshed once at boot with surface nets. Negative = inside.
 */

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export type Bounds = [number, number, number, number, number, number];

interface Prim {
  d: (x: number, y: number, z: number) => number;
  bb: Bounds;
  k: number;
  carve: boolean;
}

/** Collection of smooth-unioned (and carved) primitives with bounding-box rejection. */
export class Field {
  private readonly prims: Prim[] = [];

  add(d: Prim['d'], bb: Bounds, k = 0.004): this {
    this.prims.push({ d, bb, k, carve: false });
    return this;
  }

  carve(d: Prim['d'], bb: Bounds, k = 0.002): this {
    this.prims.push({ d, bb, k, carve: true });
    return this;
  }

  capsule(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, k = 0.004): this {
    const r = Math.max(r0, r1);
    const bb: Bounds = [
      Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.min(a.z, b.z) - r,
      Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, Math.max(a.z, b.z) + r,
    ];
    const ax = a.x, ay = a.y, az = a.z;
    const bax = b.x - ax, bay = b.y - ay, baz = b.z - az;
    const inv = 1 / Math.max(1e-9, bax * bax + bay * bay + baz * baz);
    return this.add((x, y, z) => {
      const pax = x - ax, pay = y - ay, paz = z - az;
      const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) * inv));
      return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (r0 + (r1 - r0) * h);
    }, bb, k);
  }

  sphere(c: THREE.Vector3, r: number, k = 0.004): this {
    return this.add((x, y, z) => Math.hypot(x - c.x, y - c.y, z - c.z) - r, [c.x - r, c.y - r, c.z - r, c.x + r, c.y + r, c.z + r], k);
  }

  ellipsoid(c: THREE.Vector3, rx: number, ry: number, rz: number, k = 0.004): this {
    const m = Math.min(rx, ry, rz);
    return this.add(
      (x, y, z) => (Math.hypot((x - c.x) / rx, (y - c.y) / ry, (z - c.z) / rz) - 1) * m,
      [c.x - rx, c.y - ry, c.z - rz, c.x + rx, c.y + ry, c.z + rz],
      k,
    );
  }

  bounds(margin = 0.004): Bounds {
    const out: Bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of this.prims) {
      if (p.carve) continue;
      for (let i = 0; i < 3; i++) {
        out[i] = Math.min(out[i]!, p.bb[i]!);
        out[i + 3] = Math.max(out[i + 3]!, p.bb[i + 3]!);
      }
    }
    for (let i = 0; i < 3; i++) {
      out[i] = out[i]! - margin;
      out[i + 3] = out[i + 3]! + margin;
    }
    return out;
  }

  eval(x: number, y: number, z: number): number {
    let best = 1;
    for (const p of this.prims) {
      const bb = p.bb;
      const dx = Math.max(bb[0] - x, 0, x - bb[3]);
      const dy = Math.max(bb[1] - y, 0, y - bb[4]);
      const dz = Math.max(bb[2] - z, 0, z - bb[5]);
      const lb = Math.hypot(dx, dy, dz);
      if (p.carve) {
        if (lb > p.k) continue;
        best = -smin(-best, p.d(x, y, z), p.k); // smax(best, -d)
        continue;
      }
      if (lb - best > p.k) continue;
      best = smin(best, p.d(x, y, z), p.k);
    }
    return best;
  }
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/** Surface nets over a regular grid; vertex normals come from the sampled gradient. */
export function meshField(field: (x: number, y: number, z: number) => number, bounds: Bounds, h: number): MeshData {
  const nx = Math.ceil((bounds[3] - bounds[0]) / h) + 1;
  const ny = Math.ceil((bounds[4] - bounds[1]) / h) + 1;
  const nz = Math.ceil((bounds[5] - bounds[2]) / h) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const idx = (i: number, j: number, k: number): number => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        vals[idx(i, j, k)] = field(bounds[0] + i * h, bounds[1] + j * h, bounds[2] + k * h);
      }
    }
  }
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const nor: number[] = [];
  const corner = new Float32Array(8);
  const EDGES: Array<[number, number]> = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cx = [0, 1, 0, 1, 0, 1, 0, 1];
  const cy = [0, 0, 1, 1, 0, 0, 1, 1];
  const cz = [0, 0, 0, 0, 1, 1, 1, 1];
  const grad = (i: number, j: number, k: number, out: number[]): void => {
    const ii = Math.min(nx - 1, Math.max(0, i));
    const jj = Math.min(ny - 1, Math.max(0, j));
    const kk = Math.min(nz - 1, Math.max(0, k));
    out[0] = vals[idx(Math.min(nx - 1, ii + 1), jj, kk)]! - vals[idx(Math.max(0, ii - 1), jj, kk)]!;
    out[1] = vals[idx(ii, Math.min(ny - 1, jj + 1), kk)]! - vals[idx(ii, Math.max(0, jj - 1), kk)]!;
    out[2] = vals[idx(ii, jj, Math.min(nz - 1, kk + 1))]! - vals[idx(ii, jj, Math.max(0, kk - 1))]!;
  };
  const g = [0, 0, 0];
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = vals[idx(i + cx[c]!, j + cy[c]!, k + cz[c]!)]!;
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a]!, vb = corner[b]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += cx[a]! + (cx[b]! - cx[a]!) * t;
          sy += cy[a]! + (cy[b]! - cy[a]!) * t;
          sz += cz[a]! + (cz[b]! - cz[a]!) * t;
          n++;
        }
        const px = sx / n, py = sy / n, pz = sz / n;
        let gx = 0, gy = 0, gz = 0;
        for (let c = 0; c < 8; c++) {
          grad(i + cx[c]!, j + cy[c]!, k + cz[c]!, g);
          const wx = cx[c] ? px : 1 - px;
          const wy = cy[c] ? py : 1 - py;
          const wz = cz[c] ? pz : 1 - pz;
          const w = wx * wy * wz;
          gx += g[0]! * w; gy += g[1]! * w; gz += g[2]! * w;
        }
        const gl = Math.hypot(gx, gy, gz) || 1;
        cellVert[idx(i, j, k)] = pos.length / 3;
        pos.push(bounds[0] + (i + px) * h, bounds[1] + (j + py) * h, bounds[2] + (k + pz) * h);
        nor.push(gx / gl, gy / gl, gz / gl);
      }
    }
  }
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c);
    else tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[idx(i, j, k)]!;
        const inside = v0 < 0;
        // x edge (i,j,k)-(i+1,j,k)
        if (i < nx - 1 && vals[idx(i + 1, j, k)]! < 0 !== inside) {
          quad(cellVert[idx(i, j - 1, k - 1)]!, cellVert[idx(i, j, k - 1)]!, cellVert[idx(i, j, k)]!, cellVert[idx(i, j - 1, k)]!, !inside);
        }
        // y edge: cyclic (z, x)
        if (j < ny - 1 && vals[idx(i, j + 1, k)]! < 0 !== inside) {
          quad(cellVert[idx(i - 1, j, k - 1)]!, cellVert[idx(i - 1, j, k)]!, cellVert[idx(i, j, k)]!, cellVert[idx(i, j, k - 1)]!, !inside);
        }
        // z edge: cyclic (x, y)
        if (k < nz - 1 && vals[idx(i, j, k + 1)]! < 0 !== inside) {
          quad(cellVert[idx(i - 1, j - 1, k)]!, cellVert[idx(i, j - 1, k)]!, cellVert[idx(i, j, k)]!, cellVert[idx(i - 1, j, k)]!, !inside);
        }
      }
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(tris) };
}

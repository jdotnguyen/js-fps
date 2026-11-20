import { DEFAULT_MOTOR, floorHeight, type Aabb, type ColliderQuery } from '../actors/motor.ts';
import type { P3 } from './nav.ts';
import { blockedLegs, catmullRom } from './walkPath.ts';

/**
 * Authoring help for curve walks (ADR-0028), used by `npm run walks:suggest`: a route that keeps
 * a comfortable distance from walls (people walk down the middle of a corridor and swing wide of
 * door frames, unlike a shortest path that hugs every corner), boiled down to a few control points
 * whose curve is checked clear at body radius plus a margin. Offline only (a fine grid search).
 */

export interface SuggestOptions {
  /** Body radius the curve must clear. */
  radius?: number;
  /** Extra clearance on top of the radius. */
  margin?: number;
  /** Grid cell, metres. */
  cell?: number;
  /** Clearance beyond which a spot counts as open floor (no further pull to the middle), metres. */
  comfort?: number;
}

export interface Suggestion {
  /** Control points: the given start and end, and the bends between (feet positions). */
  points: P3[];
  /** Length of the curve, metres. */
  length: number;
  /** Least clearance from the body's edge to a collider along the curve, metres. */
  minGap: number;
}

const BODY_LOW = 0.3;
const BODY_HIGH = 1.7;

/** Distance from (x, z) to the nearest box standing at body height, capped at `cap`. */
function clearance(world: ColliderQuery, x: number, z: number, y: number, cap: number, scratch: Aabb[]): number {
  scratch.length = 0;
  const boxes = world.query(x - cap, z - cap, x + cap, z + cap, scratch);
  let best = cap;
  for (const b of boxes) {
    if (b.max[1] <= y + BODY_LOW || b.min[1] >= y + BODY_HIGH) continue;
    const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
    const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/**
 * Suggest a curve walk through `via` (start, any points it must pass, end). Throws if some leg has
 * no comfortable route.
 */
export function suggestWalk(world: ColliderQuery, via: P3[], opts: SuggestOptions = {}): Suggestion {
  const r = opts.radius ?? DEFAULT_MOTOR.radius;
  const margin = opts.margin ?? 0.06;
  const cell = opts.cell ?? 0.1;
  const comfort = opts.comfort ?? 1.1;
  const floorY = via[0]!.y;
  const pad = 4;
  const minX = Math.min(...via.map((p) => p.x)) - pad;
  const maxX = Math.max(...via.map((p) => p.x)) + pad;
  const minZ = Math.min(...via.map((p) => p.z)) - pad;
  const maxZ = Math.max(...via.map((p) => p.z)) + pad;
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const clr = new Float32Array(nx * nz);
  const scratch: Aabb[] = [];
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x = minX + i * cell;
      const z = minZ + k * cell;
      const y = floorHeight(x, z, floorY + 0.4, DEFAULT_MOTOR, world);
      clr[i * nz + k] = Number.isFinite(y) && Math.abs(y - floorY) < 0.3 ? clearance(world, x, z, floorY, comfort + 0.5, scratch) : -1;
    }
  }
  const idx = (p: P3): number => Math.round((p.x - minX) / cell) * nz + Math.round((p.z - minZ) / cell);
  const at = (n: number): P3 => ({ x: minX + Math.floor(n / nz) * cell, y: floorY, z: minZ + (n % nz) * cell });
  /** Nearest cell a body fits in (anchors right against a counter or a wall). */
  const snap = (p: P3): number => {
    const c = idx(p);
    if (clr[c]! >= r) return c;
    let best = c;
    let bd = Infinity;
    const R = Math.ceil(0.6 / cell);
    const ci = Math.floor(c / nz);
    const ck = c % nz;
    for (let di = -R; di <= R; di++)
      for (let dk = -R; dk <= R; dk++) {
        const n = (ci + di) * nz + (ck + dk);
        if (ci + di < 0 || ci + di >= nx || ck + dk < 0 || ck + dk >= nz || clr[n]! < r) continue;
        const d = Math.hypot(di, dk);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
    return best;
  };
  const weight = (c: number): number => {
    const v = Math.min(clr[c]!, comfort);
    const t = (comfort - v) / (comfort - r);
    return 1 + 3 * t * t;
  };
  const dense: P3[] = [{ ...via[0]! }];
  for (let leg = 1; leg < via.length; leg++) {
    const s = snap(via[leg - 1]!);
    const g = snap(via[leg]!);
    const cost = new Float64Array(nx * nz).fill(Infinity);
    const came = new Int32Array(nx * nz).fill(-1);
    const gp = at(g);
    const h = (c: number): number => {
      const p = at(c);
      return Math.hypot(p.x - gp.x, p.z - gp.z);
    };
    const heap = new MinHeap();
    cost[s] = 0;
    heap.push(h(s), s);
    const nb = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2],
    ] as const;
    let found = false;
    while (heap.size) {
      const c = heap.pop();
      if (c === g) {
        found = true;
        break;
      }
      const ci = Math.floor(c / nz);
      const ck = c % nz;
      for (const [di, dk] of nb) {
        const ni = ci + di;
        const nk = ck + dk;
        if (ni < 0 || ni >= nx || nk < 0 || nk >= nz) continue;
        const n = ni * nz + nk;
        if (clr[n]! < r && n !== g) continue;
        const step = Math.hypot(di, dk) * cell;
        const t = cost[c]! + step * (weight(c) + weight(n)) * 0.5;
        if (t < cost[n]!) {
          cost[n] = t;
          came[n] = c;
          heap.push(t + h(n), n);
        }
      }
    }
    if (!found) throw new Error(`no comfortable route from ${fmt(via[leg - 1]!)} to ${fmt(via[leg]!)}`);
    const chain: P3[] = [];
    for (let c = g; c !== s && c >= 0; c = came[c]!) chain.push(at(c));
    chain.reverse();
    dense.push(...chain.slice(0, -1), { ...via[leg]! });
  }
  // Fewest control points whose curve still clears with the margin.
  for (const tol of [0.35, 0.25, 0.18, 0.12, 0.08, 0.05]) {
    const ctrl = simplify(dense, tol, via);
    const curve = catmullRom(ctrl);
    // The very ends may sit against furniture (a counter): check those legs at plain body radius.
    const inner = curve.slice(2, -2);
    if (blockedLegs(world, inner, r + margin).length || blockedLegs(world, curve, r).length) continue;
    let length = 0;
    let minGap = Infinity;
    for (let i = 1; i < curve.length; i++) length += Math.hypot(curve[i]!.x - curve[i - 1]!.x, curve[i]!.z - curve[i - 1]!.z);
    for (const p of inner) minGap = Math.min(minGap, clearance(world, p.x, p.z, floorY, comfort + 0.5, scratch) - r);
    return { points: ctrl, length, minGap };
  }
  throw new Error('could not fit a clear curve; add a via point at the tight spot');
}

/** Douglas-Peucker on the dense route, always keeping the via points. */
function simplify(dense: P3[], tol: number, keep: P3[]): P3[] {
  const keepIdx = keep.map((k) => dense.findIndex((p) => Math.hypot(p.x - k.x, p.z - k.z) < 1e-6));
  const out: P3[] = [];
  for (let i = 1; i < keepIdx.length; i++) {
    const part = dp(dense.slice(keepIdx[i - 1]!, keepIdx[i]! + 1), tol);
    out.push(...(i === 1 ? part : part.slice(1)));
  }
  return out.map((p, i) => (i === 0 || i === out.length - 1 ? p : { x: round2(p.x), y: p.y, z: round2(p.z) }));
}

function dp(pts: P3[], tol: number): P3[] {
  if (pts.length < 3) return pts;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const L = Math.hypot(ex, ez) || 1e-9;
  let md = 0;
  let mi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const d = Math.abs((p.x - a.x) * ez - (p.z - a.z) * ex) / L;
    if (d > md) {
      md = d;
      mi = i;
    }
  }
  if (md <= tol) return [a, b];
  return [...dp(pts.slice(0, mi + 1), tol).slice(0, -1), ...dp(pts.slice(mi), tol)];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const fmt = (p: P3): string => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;

class MinHeap {
  private readonly k: number[] = [];
  private readonly v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0]!;
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l]! < k[m]!) m = l;
        if (r < k.length && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

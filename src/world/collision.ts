import type { Aabb, ColliderQuery } from '../actors/motor.ts';

/**
 * Static and door collision (ADR-0003): axis-aligned boxes in a 2 m spatial hash.
 * Implements the ADR-0004 motor's ColliderQuery, so the player (actors/motor.ts) and
 * later actors move against it directly; also answers rays and footstep surfaces.
 * No three.js, so it runs in Node tests.
 */

export type ColliderSurface = 'metal' | 'grate' | 'rubber' | 'water';

export interface Collider extends Aabb {
  readonly id: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  /** Disabled colliders (open doors) are ignored by every query. */
  enabled: boolean;
  /** Free-form owner label, e.g. "static", "door:D_R01_R02". */
  tag: string;
  surface: ColliderSurface | null;
}

export interface BoxLike {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface RayHit {
  collider: Collider;
  distance: number;
}

const EPS = 1e-4;

export class CollisionWorld implements ColliderQuery {
  readonly cellSize: number;
  readonly colliders: Collider[] = [];
  private readonly cells = new Map<number, Collider[]>();
  private stamp = 0;
  private readonly stamps = new Map<number, number>();
  private readonly scratch: Collider[] = [];
  private readonly found: Collider[] = [];

  constructor(cellSize = 2) {
    this.cellSize = cellSize;
  }

  add(box: BoxLike, tag = 'static', surface: ColliderSurface | null = null): Collider {
    const minX = Math.min(box.min[0], box.max[0]);
    const minY = Math.min(box.min[1], box.max[1]);
    const minZ = Math.min(box.min[2], box.max[2]);
    const maxX = Math.max(box.min[0], box.max[0]);
    const maxY = Math.max(box.min[1], box.max[1]);
    const maxZ = Math.max(box.min[2], box.max[2]);
    const c: Collider = {
      id: this.colliders.length,
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      enabled: true,
      tag,
      surface,
    };
    this.colliders.push(c);
    this.forCells(c.minX, c.minZ, c.maxX, c.maxZ, (key) => {
      let list = this.cells.get(key);
      if (!list) {
        list = [];
        this.cells.set(key, list);
      }
      list.push(c);
    });
    return c;
  }

  /** ColliderQuery for the ADR-0004 motor: append overlapping enabled boxes to `out`. */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Aabb[]): Aabb[] {
    for (const c of this.find(minX, minZ, maxX, maxZ, this.found)) out.push(c);
    return out;
  }

  /** Enabled colliders whose footprint overlaps the rectangle (clears and fills `out`). */
  find(minX: number, minZ: number, maxX: number, maxZ: number, out: Collider[] = []): Collider[] {
    out.length = 0;
    const stamp = ++this.stamp;
    this.forCells(minX, minZ, maxX, maxZ, (key) => {
      const list = this.cells.get(key);
      if (!list) return;
      for (const c of list) {
        if (!c.enabled || this.stamps.get(c.id) === stamp) continue;
        this.stamps.set(c.id, stamp);
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        out.push(c);
      }
    });
    return out;
  }

  /** Nearest enabled collider along a ray (direction need not be normalised). */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number): RayHit | null {
    const len = Math.hypot(dx, dy, dz);
    if (len < EPS) return null;
    dx /= len;
    dy /= len;
    dz /= len;
    let best: RayHit | null = null;
    // Walk the ray in half-cell steps and slab-test what each step's cells hold.
    const step = this.cellSize * 0.5;
    const seen = new Set<number>();
    for (let t = 0; t <= maxDistance + step; t += step) {
      if (best && t - step > best.distance) break;
      const x = ox + dx * t;
      const z = oz + dz * t;
      const list = this.find(x - step, z - step, x + step, z + step, this.scratch);
      for (const c of list) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const d = rayBox(ox, oy, oz, dx, dy, dz, c);
        if (d !== null && d <= maxDistance && (!best || d < best.distance)) best = { collider: c, distance: d };
      }
    }
    return best;
  }

  /** Surface of the highest collider top just under (x, y, z), for footsteps. */
  surfaceAt(x: number, y: number, z: number): ColliderSurface | null {
    let best: Collider | null = null;
    for (const c of this.find(x, z, x, z, this.scratch)) {
      if (c.maxY > y + 0.05 || c.maxY < y - 0.3) continue;
      if (!best || c.maxY >= best.maxY) best = c;
    }
    return best?.surface ?? null;
  }

  private forCells(minX: number, minZ: number, maxX: number, maxZ: number, fn: (key: number) => void): void {
    const s = this.cellSize;
    const x0 = Math.floor(minX / s);
    const x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s);
    const z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) fn((ix + 32768) * 65536 + (iz + 32768));
  }
}

/** Ray vs box slab test; returns the entry distance (0 if the origin is inside). */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, c: Collider): number | null {
  let tmin = 0;
  let tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [ox, dx, c.minX, c.maxX],
    [oy, dy, c.minY, c.maxY],
    [oz, dz, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

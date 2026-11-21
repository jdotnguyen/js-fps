import type { Aabb, ColliderQuery } from '../actors/motor.ts';

/**
 * Static and door collision (ADR-0003): axis-aligned boxes in a 2 m spatial hash.
 * Implements the ADR-0004 motor's ColliderQuery, so the player (actors/motor.ts) and
 * later actors move against it directly; also answers rays and footstep surfaces.
 * No three.js, so it runs in Node tests.
 */

export type ColliderSurface = 'concrete' | 'metal' | 'grate' | 'rubber' | 'water';

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
  /** `'glass'`: a see-through partition that muffles sound only lightly (in-world-audio: Glass muffles lightly). */
  acoustic?: 'glass';
}

export interface BoxLike {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  acoustic?: 'glass';
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
  private stamps = new Uint32Array(256);
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
      ...(box.acoustic ? { acoustic: box.acoustic } : {}),
    };
    this.colliders.push(c);
    if (c.id >= this.stamps.length) {
      const next = new Uint32Array(this.stamps.length * 2);
      next.set(this.stamps);
      this.stamps = next;
    }
    const s = this.cellSize;
    const x0 = Math.floor(c.minX / s);
    const x1 = Math.floor(c.maxX / s);
    const z0 = Math.floor(c.minZ / s);
    const z1 = Math.floor(c.maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const key = (ix + 32768) * 65536 + (iz + 32768);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(c);
      }
    }
    return c;
  }

  /** Move an existing collider to a new world box, updating the spatial hash cleanly. */
  move(c: Collider, box: BoxLike): void {
    const s = this.cellSize;
    for (let ix = Math.floor(c.minX / s); ix <= Math.floor(c.maxX / s); ix++) {
      for (let iz = Math.floor(c.minZ / s); iz <= Math.floor(c.maxZ / s); iz++) {
        const list = this.cells.get((ix + 32768) * 65536 + (iz + 32768));
        if (!list) continue;
        const idx = list.indexOf(c);
        if (idx >= 0) list.splice(idx, 1);
      }
    }
    const minX = Math.min(box.min[0], box.max[0]);
    const minY = Math.min(box.min[1], box.max[1]);
    const minZ = Math.min(box.min[2], box.max[2]);
    const maxX = Math.max(box.min[0], box.max[0]);
    const maxY = Math.max(box.min[1], box.max[1]);
    const maxZ = Math.max(box.min[2], box.max[2]);
    c.minX = minX;
    c.minY = minY;
    c.minZ = minZ;
    c.maxX = maxX;
    c.maxY = maxY;
    c.maxZ = maxZ;
    c.min = [minX, minY, minZ];
    c.max = [maxX, maxY, maxZ];
    for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++) {
      for (let iz = Math.floor(minZ / s); iz <= Math.floor(maxZ / s); iz++) {
        const key = (ix + 32768) * 65536 + (iz + 32768);
        let list = this.cells.get(key);
        if (!list) {
          list = [];
          this.cells.set(key, list);
        }
        list.push(c);
      }
    }
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
    const stamps = this.stamps;
    const s = this.cellSize;
    const x0 = Math.floor(minX / s);
    const x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s);
    const z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get((ix + 32768) * 65536 + (iz + 32768));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          if (!c.enabled || stamps[c.id] === stamp) continue;
          stamps[c.id] = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
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
    const s = this.cellSize;
    const step = s * 0.5;
    const stamp = ++this.stamp;
    const stamps = this.stamps;
    for (let t = 0; t <= maxDistance + step; t += step) {
      if (best && t - step > best.distance) break;
      const x = ox + dx * t;
      const z = oz + dz * t;
      const x0 = Math.floor((x - step) / s);
      const x1 = Math.floor((x + step) / s);
      const z0 = Math.floor((z - step) / s);
      const z1 = Math.floor((z + step) / s);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const list = this.cells.get((ix + 32768) * 65536 + (iz + 32768));
          if (!list) continue;
          for (let i = 0; i < list.length; i++) {
            const c = list[i]!;
            if (!c.enabled || stamps[c.id] === stamp) continue;
            stamps[c.id] = stamp;
            const d = rayBox(ox, oy, oz, dx, dy, dz, c);
            if (d !== null && d <= maxDistance && (!best || d < best.distance)) best = { collider: c, distance: d };
          }
        }
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
}

/** Ray vs box slab test; returns the entry distance (0 if the origin is inside). */
function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, c: Collider): number | null {
  let tmin = 0;
  let tmax = Infinity;

  if (Math.abs(dx) < 1e-12) {
    if (ox < c.minX || ox > c.maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (c.minX - ox) * inv;
    let t2 = (c.maxX - ox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (Math.abs(dy) < 1e-12) {
    if (oy < c.minY || oy > c.maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (c.minY - oy) * inv;
    let t2 = (c.maxY - oy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (Math.abs(dz) < 1e-12) {
    if (oz < c.minZ || oz > c.maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (c.minZ - oz) * inv;
    let t2 = (c.maxZ - oz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  return tmin;
}

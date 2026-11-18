import type { Aabb } from './motor.ts';

/**
 * E-to-use (ADR-0004): a 2 m ray from the eye against registered interactables. Some
 * need a hold (0.6 s by default) with radial progress. The nearest hit wins.
 * Doors, lockers, pickups, valves, consoles and med stations all register here.
 */
export interface Interactable {
  id: string;
  /** Verb phrase shown after the key, e.g. "Swipe badge". */
  prompt: string;
  /** World-space box the ray is tested against. */
  box: Aabb;
  /** Seconds to hold; omit (or a getter returning undefined) for a tap. */
  hold?: number | undefined;
  enabled?: () => boolean;
  use: () => void;
}

export interface InteractFocus {
  target: Interactable;
  distance: number;
  /** 0..1 hold progress; 0 for taps. */
  progress: number;
}

export const INTERACT_RANGE = 2;
export const DEFAULT_HOLD = 0.6;

export class Interactions {
  focus: InteractFocus | null = null;
  private readonly items = new Map<string, Interactable>();
  private holding: string | null = null;
  private held = 0;

  add(item: Interactable): () => void {
    this.items.set(item.id, item);
    return () => {
      if (this.items.get(item.id) === item) this.items.delete(item.id);
    };
  }

  clear(): void {
    this.items.clear();
    this.focus = null;
    this.holding = null;
  }

  /**
   * One fixed step. `origin`/`dir` are the eye ray (dir normalised); `pressed` and `down`
   * are the interact key's edge and level. Returns the item used this step, if any.
   */
  update(dt: number, origin: Vec3, dir: Vec3, pressed: boolean, down: boolean, allowed: boolean): Interactable | null {
    const hit = allowed ? this.pick(origin, dir) : null;
    if (!hit) {
      this.focus = null;
      this.holding = null;
      return null;
    }
    const { item, distance } = hit;
    let used: Interactable | null = null;
    let progress = 0;
    if (item.hold === undefined) {
      if (pressed) used = item;
    } else {
      if (pressed) {
        this.holding = item.id;
        this.held = 0;
      }
      if (this.holding === item.id && down) {
        this.held += dt;
        progress = Math.min(1, this.held / item.hold);
        if (this.held >= item.hold) {
          used = item;
          this.holding = null;
          progress = 0;
        }
      } else {
        this.holding = null;
      }
    }
    this.focus = { target: item, distance, progress };
    if (used) used.use();
    return used;
  }

  /** Nearest enabled item along the ray within range. */
  pick(origin: Vec3, dir: Vec3, range = INTERACT_RANGE): { item: Interactable; distance: number } | null {
    let best: { item: Interactable; distance: number } | null = null;
    for (const item of this.items.values()) {
      if (item.enabled && !item.enabled()) continue;
      const t = rayAabb(origin, dir, item.box);
      if (t === null || t > range) continue;
      if (!best || t < best.distance) best = { item, distance: t };
    }
    return best;
  }
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Slab test: distance along a normalised ray to the box, 0 if inside, null if missed. */
export function rayAabb(o: Vec3, d: Vec3, b: Aabb): number | null {
  let tMin = 0;
  let tMax = Infinity;
  const os = [o.x, o.y, o.z] as const;
  const ds = [d.x, d.y, d.z] as const;
  for (let a = 0; a < 3; a++) {
    const oa = os[a]!;
    const da = ds[a]!;
    const lo = b.min[a]!;
    const hi = b.max[a]!;
    if (Math.abs(da) < 1e-9) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

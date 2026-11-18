/**
 * Body-vs-body separation (ADR-0018). Pure, no three.js, so it runs in unit tests.
 *
 * Every humanoid has a footprint circle on the ground (XZ). After movement each frame, overlapping
 * circles are pushed apart along the line between their centres. The push is shared by inverse mass,
 * so a hero shoves crowd bodies aside and barely moves itself, and an immovable body (a corpse, a
 * seated NPC, the player) never moves at all. The pass is a soft constraint, not a rigid solver:
 * a little overlap (the slop) is allowed and the push per frame is capped, so nothing pops.
 */

export interface SepBody {
  x: number;
  z: number;
  /** Footprint radius in metres. */
  r: number;
  /** Relative mass. `Infinity` means immovable. */
  mass: number;
}

export interface SepOptions {
  /** Relaxation passes per call. */
  iterations?: number;
  /** Fraction of a pair's overlap resolved per pass (below 1 keeps the push soft). */
  stiffness?: number;
  /** Overlap in metres that is tolerated, so touching shoulders do not jitter. */
  slop?: number;
  /** Largest push on one pair in one pass, in metres. */
  maxPush?: number;
}

export const DEFAULT_SEPARATION: Required<SepOptions> = {
  iterations: 3,
  stiffness: 0.8,
  slop: 0.02,
  maxPush: 0.08,
};

/** Crowd body footprint radius at build 1 (about shoulder reach with arms hanging), metres. [Assumed] */
export const CROWD_FOOTPRINT = 0.28;
/** Hero footprint radius at build 1: wider than a crowd body because the arms hang out. [Assumed] */
export const HERO_FOOTPRINT = 0.36;
export const CROWD_MASS = 1;
export const HERO_MASS = 4;

/** Footprint and mass for a humanoid of this build. */
export function footprintOf(hero: boolean, build: number): { r: number; mass: number } {
  return hero ? { r: HERO_FOOTPRINT * build, mass: HERO_MASS } : { r: CROWD_FOOTPRINT * build, mass: CROWD_MASS };
}

/** Golden angle: gives each exactly-coincident pair its own, deterministic escape direction. */
const GOLDEN_ANGLE = 2.399963229728653;

const inverseMass = (m: number): number => (Number.isFinite(m) && m > 0 ? 1 / m : 0);

/**
 * Push overlapping bodies apart in place (x and z). Returns the deepest overlap left, in metres
 * (0 when everyone fits), so callers and tests can see whether the pass converged.
 * The pair loop is O(n²); the ADR-0007 spawn limit keeps n small. A spatial hash replaces it if n grows.
 */
export function separate(bodies: SepBody[], options: SepOptions = {}): number {
  const o = { ...DEFAULT_SEPARATION, ...options };
  const n = bodies.length;
  for (let pass = 0; pass < o.iterations; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      if (!a) continue;
      const wa = inverseMass(a.mass);
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (!b) continue;
        const wb = inverseMass(b.mass);
        const total = wa + wb;
        if (total === 0) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const overlap = a.r + b.r - d - o.slop;
        if (overlap <= 0) continue;
        if (d < 1e-6) {
          const ang = (i * 31 + j) * GOLDEN_ANGLE;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        }
        const push = Math.min(overlap * o.stiffness, o.maxPush);
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push * (wa / total);
        a.z -= nz * push * (wa / total);
        b.x += nx * push * (wb / total);
        b.z += nz * push * (wb / total);
        moved = true;
      }
    }
    if (!moved) break;
  }
  let worst = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = bodies[i];
      const b = bodies[j];
      if (!a || !b || (inverseMass(a.mass) === 0 && inverseMass(b.mass) === 0)) continue;
      worst = Math.max(worst, a.r + b.r - Math.hypot(b.x - a.x, b.z - a.z));
    }
  }
  return Math.max(0, worst);
}

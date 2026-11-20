import type { P3 } from './nav.ts';

/**
 * Enemy perception (ADR-0007): a sight cone with line of sight through the level colliders,
 * hearing from noise events, and a short memory of where the target was last sensed.
 * Pure maths over callbacks, no three.js, so it runs in Node tests.
 */

/** [Assumed] numbers from ADR-0007. */
export const PERCEPTION = {
  /** Full sight cone, radians (110 degrees). */
  fov: (110 * Math.PI) / 180,
  /** Sight range when the target is lit (or the enemy stands in the flashlight beam), and in the dark. */
  sightLit: 18,
  sightDark: 8,
  /** Anything this close is noticed whatever the cone (bumping into someone). */
  touch: 1.6,
  /** Flashlight beam: half-angle (rad) and reach that counts as "shining at" an enemy. */
  beamHalfAngle: 0.3,
  beamRange: 20,
  /** Hearing radii (metres). */
  hear: { gunshot: 25, impact: 8, footstep: 4, sprint: 8 },
  /** Sound around corners is allowed this much longer path than its radius. */
  pathSlack: 1.15,
  /** An alerted enemy wakes others within this radius. */
  share: 6,
  /** Seconds a sensed position stays "fresh" (chase it); after that the enemy searches, then gives up. */
  memory: 6,
  forget: 14,
  eyeHeight: 1.55,
} as const;

export type NoiseKind = keyof typeof PERCEPTION.hear;

export interface Noise {
  kind: NoiseKind;
  x: number;
  y: number;
  z: number;
  /** Who made it (a target id), so the hearer knows whom to chase. */
  source: string | null;
}

/** Is the flat direction (dx, dz) inside a cone of `fov` around `heading` (0 faces -Z)? */
export function inCone(heading: number, dx: number, dz: number, fov: number = PERCEPTION.fov): boolean {
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  return (dx * fx + dz * fz) / d >= Math.cos(fov / 2);
}

export interface SightArgs {
  /** Enemy eye (world). */
  eye: P3;
  heading: number;
  /** Target point to check (its chest or eye). */
  target: P3;
  /** Is the target lit (flashlight on, bright room)? */
  lit: boolean;
  /** Is the enemy in the target's flashlight beam? Counts as light (ADR-0007). */
  inBeam: boolean;
  /** True when the segment eye -> target crosses a collider. */
  blocked(a: P3, b: P3): boolean;
  blind?: boolean;
}

/** Sight check: range by light, cone, then line of sight. */
export function canSee(a: SightArgs): boolean {
  if (a.blind) return false;
  const dx = a.target.x - a.eye.x;
  const dz = a.target.z - a.eye.z;
  const d = Math.hypot(dx, dz);
  if (d <= PERCEPTION.touch) return !a.blocked(a.eye, a.target);
  const range = a.lit || a.inBeam ? PERCEPTION.sightLit : PERCEPTION.sightDark;
  if (d > range) return false;
  if (!inCone(a.heading, dx, dz)) return false;
  return !a.blocked(a.eye, a.target);
}

/** Is `p` inside a flashlight beam from `origin` along normalised `dir`? */
export function inBeam(origin: P3, dir: P3, p: P3, halfAngle: number = PERCEPTION.beamHalfAngle, range: number = PERCEPTION.beamRange): boolean {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dz = p.z - origin.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return true;
  if (d > range) return false;
  return (dx * dir.x + dy * dir.y + dz * dir.z) / d >= Math.cos(halfAngle);
}

/**
 * Can a noise at `from` be heard at `to`? Straight-line distance first; then sound must reach
 * through open space: a clear straight line, or a walkable route (through open doors only) no
 * longer than the radius plus a little slack. `route` returns that route length or Infinity.
 */
export function hears(kind: NoiseKind, from: P3, to: P3, clear: (a: P3, b: P3) => boolean, route: (a: P3, b: P3) => number): boolean {
  const radius = PERCEPTION.hear[kind];
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  if (d > radius) return false;
  if (clear(from, to)) return true;
  return route(from, to) <= radius * PERCEPTION.pathSlack;
}

export type SenseSource = 'sight' | 'sound' | 'ally' | 'touch';

/** Where the current target was last sensed, and how long ago. */
export class Memory {
  readonly last: P3 = { x: 0, y: 0, z: 0 };
  /** Seconds since the last sensing; Infinity = never. */
  age = Infinity;
  source: SenseSource | null = null;
  targetId: string | null = null;

  sense(p: P3, source: SenseSource, targetId: string | null): void {
    this.last.x = p.x;
    this.last.y = p.y;
    this.last.z = p.z;
    this.age = 0;
    this.source = source;
    if (targetId !== null) this.targetId = targetId;
  }

  update(dt: number): void {
    this.age += dt;
  }

  /** Recent enough to chase. */
  get fresh(): boolean {
    return this.age <= PERCEPTION.memory;
  }

  /** Old enough to give up searching. */
  get forgotten(): boolean {
    return this.age > PERCEPTION.forget;
  }

  clear(): void {
    this.age = Infinity;
    this.source = null;
    this.targetId = null;
  }
}

/**
 * Target choice (ADR-0007): score = threat weight / distance among targets the enemy knows about.
 * Player 1.0, teammates 0.6, a working teammate 0.9 (ADR-0011 adds the medic numbers).
 */
export function pickTarget<T extends { weight: number; x: number; z: number }>(from: P3, candidates: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const d = Math.max(1, Math.hypot(c.x - from.x, c.z - from.z));
    const s = c.weight / d;
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/**
 * Whether Jay could see a body at `p` (its feet): in front of him (`forward` is his flat view direction) and
 * with a clear line from his eye to the body's chest, by the caller's `clear` test. Used before moving a
 * squadmate out of sight (restart placement) and before removing an enemy that can't reach anyone.
 */
export function inPlayerView(eye: P3, forward: { x: number; z: number }, p: P3, clear: (a: P3, b: P3) => boolean): boolean {
  const tx = p.x - eye.x;
  const tz = p.z - eye.z;
  if (tx * forward.x + tz * forward.z < 0) return false;
  return clear({ x: eye.x, y: eye.y - 1.25, z: eye.z }, { x: p.x, y: p.y, z: p.z });
}

/**
 * Moving through standing water (player-movement spec, overhaul-flooded-tunnel D8): how depth slows Jay, makes him
 * heavier to start and stop, stops his sprint, shapes a jump that starts in water, and keeps his view above the surface
 * when he is downed.
 */

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const WADING = {
  /** Speed at thigh depth (and deeper), as a share of the speed on a dry floor. */
  deepScale: 0.5,
  /** Depths (m) between which the slowdown builds: ankle-deep is almost free, thigh-deep is full. */
  from: 0.1,
  to: 0.7,
  /** No sprinting deeper than this (m, about knee height). */
  sprintMaxDepth: 0.45,
  /** Highest top (m above the floor under the water) a jump from the water gets onto. */
  jumpReach: 0.9,
  /** Takeoff speed of a jump from the water, as a share of a dry jump. */
  jumpSpeedScale: 0.86,
  /** Seconds after landing in water before the next jump. */
  jumpRecovery: 0.35,
  /** How far above the surface the view stays when downed in water (m). */
  downedClearance: 0.12,
} as const;

/** Speed (and acceleration) multiplier at this depth: 1 when dry, down to WADING.deepScale at thigh depth. */
export function wadeScale(depth: number): number {
  return 1 + (WADING.deepScale - 1) * smoothstep(WADING.from, WADING.to, depth);
}

export function canSprintAt(depth: number): boolean {
  return depth <= WADING.sprintMaxDepth;
}

/** Eye height above the floor while downed: never under the surface. */
export function downedEye(baseEye: number, depth: number): number {
  return depth > 0 ? Math.max(baseEye, depth + WADING.downedClearance) : baseEye;
}

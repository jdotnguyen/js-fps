export interface MisterCycleState {
  /** Monotonic cycle index (increments each time a new burst starts). */
  readonly cycle: number;
  /** Seconds elapsed inside the current cycle (`0 <= localT < period`). */
  readonly localT: number;
  /** Active nozzle jet intensity `0..1` (drives spray cones and valve LED). */
  readonly spray: number;
  /** Lingering vapor cloud intensity `0..1` (ramps in and fades gradually after shutoff). */
  readonly cloud: number;
  /** True while the solenoid valve is open and actively spraying. */
  readonly active: boolean;
  /** `'sputter'` on occasional double-puff cycles of an "opinionated" rail. */
  readonly kind: 'normal' | 'sputter';
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Normal spray burst length (s), matched to `oneshot-mister-spray-*.mp3` (~3.5 s). */
export const MISTER_BURST_DUR = 3.2;
/** Post-shutoff vapor dissipation window (s). */
export const MISTER_CLOUD_LINGER = 2.0;

/**
 * Deterministic burst envelope for an overhead Grow Hall mister rail.
 * Produces smooth valve ramp-in, gradual lingering vapor fade after shutoff,
 * and an optional double-puff sputter every third cycle.
 */
export function evaluateMisterCycle(t: number, period: number, offset = 0, sputter = false): MisterCycleState {
  const safePeriod = Math.max(6.0, period);
  const shifted = Math.max(0, t + offset);
  const cycle = Math.floor(shifted / safePeriod);
  const localT = shifted - cycle * safePeriod;

  if (sputter && cycle % 3 === 1) {
    // Two quick pressurized puffs (~0.0–0.55 s and ~0.85–1.95 s) matching `oneshot-mister-sputter.mp3` (2.2 s).
    const puff1 = smoothstep(0, 0.12, localT) * (1 - smoothstep(0.42, 0.56, localT));
    const puff2 = smoothstep(0.84, 0.98, localT) * (1 - smoothstep(1.75, 1.98, localT));
    const spray = Math.min(1, puff1 + puff2);
    const cloud = smoothstep(0.06, 0.45, localT) * (1 - smoothstep(1.9, 1.9 + MISTER_CLOUD_LINGER * 0.85, localT));
    const active = localT < 0.55 || (localT >= 0.85 && localT < 1.96);
    return { cycle, localT, spray, cloud, active, kind: 'sputter' };
  }

  const spray = smoothstep(0, 0.25, localT) * (1 - smoothstep(MISTER_BURST_DUR - 0.35, MISTER_BURST_DUR, localT));
  const cloud = smoothstep(0.08, 0.6, localT) * (1 - smoothstep(MISTER_BURST_DUR, MISTER_BURST_DUR + MISTER_CLOUD_LINGER, localT));
  const active = localT < MISTER_BURST_DUR;
  return { cycle, localT, spray, cloud, active, kind: 'normal' };
}

import * as THREE from 'three';

/**
 * Giles's concealed injury (character-motion spec, design D12): how much of the favouring, protective left-arm motion shows.
 * Watched or talking, he hides it; unwatched, under load or after a ladder tell it comes through; it grows with the infection
 * stage and is full at the reveal (stage 4).
 */

/** Weight while he is hiding it, by stage 0..3 and the reveal (4). */
export const INJURY_CONCEALED = [0, 0.05, 0.15, 0.35, 1] as const;
/** Weight when it comes through, by stage. */
export const INJURY_UNHIDDEN = [0.3, 0.45, 0.6, 0.8, 1] as const;
/** Seconds unwatched before he stops hiding it. */
export const INJURY_UNWATCHED_DELAY = 4;
/** Seconds for exposure to rise to 1 once unwatched, and to fall back to 0 when looked at. */
export const INJURY_RISE = 1.5;
export const INJURY_FALL = 1;

const at = (table: readonly number[], stage: number): number => {
  const s = THREE.MathUtils.clamp(stage, 0, table.length - 1);
  const i = Math.floor(s);
  const f = s - i;
  return (table[i] ?? 0) + ((table[Math.min(table.length - 1, i + 1)] ?? 0) - (table[i] ?? 0)) * f;
};

/** Injury weight for a stage (fractions blend) and exposure 0..1. */
export function injuryWeight(stage: number, exposure: number): number {
  const c = at(INJURY_CONCEALED, stage);
  const u = at(INJURY_UNHIDDEN, stage);
  return c + (u - c) * THREE.MathUtils.clamp(exposure, 0, 1);
}

export interface ExposureInput {
  /** The player or a squadmate has him in view. */
  watched: boolean;
  /** He is talking (he performs for whoever he talks to). */
  talking: boolean;
  /** A task or tell loads the arm or shows it (spikes exposure to 1). */
  spike: boolean;
}

/** How exposed the injury is (0 hidden .. 1 showing), from who is watching and what he is doing. */
export class InjuryExposure {
  exposure = 0;
  private unwatched = 0;

  update(dt: number, i: ExposureInput): number {
    if (i.spike) {
      this.exposure = Math.min(1, this.exposure + dt / 0.3);
      return this.exposure;
    }
    if (i.watched || i.talking) {
      this.unwatched = 0;
      this.exposure = Math.max(0, this.exposure - dt / INJURY_FALL);
    } else {
      this.unwatched += dt;
      if (this.unwatched >= INJURY_UNWATCHED_DELAY) this.exposure = Math.min(1, this.exposure + dt / INJURY_RISE);
    }
    return this.exposure;
  }
}

const tmp = new THREE.Vector3();

/** Is `target` in the view of an eye at `eye` looking along `dir` (unit), within `range` metres and `halfAngle` radians? */
export function inView(eye: THREE.Vector3, dir: THREE.Vector3, target: THREE.Vector3, range: number, halfAngle: number): boolean {
  tmp.subVectors(target, eye);
  const d = tmp.length();
  if (d < 1e-3) return true;
  if (d > range) return false;
  return tmp.dot(dir) / d >= Math.cos(halfAngle);
}

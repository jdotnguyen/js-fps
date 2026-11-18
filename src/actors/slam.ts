/**
 * Hero slam attack (ADR-0021). Pure timing and hit rules, no three.js.
 *
 * windup (arms raised, body still tracking the target) -> strike (arms come down) -> impact
 * -> recover (stuck, open to punishment) -> cooldown. The impact lands `reach` metres in front
 * of the body and hurts anything inside `radius`, falling off toward the edge.
 */

export type SlamPhase = 'idle' | 'windup' | 'strike' | 'recover';

export interface SlamTuning {
  /** Seconds per phase. The windup is the player's warning; the recovery is their window. */
  windup: number;
  strike: number;
  recover: number;
  /** Seconds after recovering before the next slam. */
  cooldown: number;
  /** Start a slam when the target is this close (metres) and roughly in front. */
  range: number;
  /** Largest heading error (radians) at which a slam starts. */
  arc: number;
  /** Impact point distance in front of the body origin, metres. */
  reach: number;
  /** Impact radius, metres; full damage within `radius * core`. */
  radius: number;
  core: number;
  /** Damage at the centre. */
  damage: number;
  /** Turn speed while winding up (rad/s): the hero can re-aim but not spin round. */
  windupTurn: number;
}

/** [Assumed] */
export const SLAM: SlamTuning = {
  windup: 0.8, strike: 0.16, recover: 1.0, cooldown: 2.6,
  range: 2.2, arc: 0.5, reach: 1.25, radius: 1.3, core: 0.5, damage: 45, windupTurn: 0.9,
};

export class SlamState {
  phase: SlamPhase = 'idle';
  /** Seconds spent in the current phase. */
  t = 0;
  cooldown = 0;
  readonly tuning: SlamTuning;
  constructor(tuning: SlamTuning = SLAM) {
    this.tuning = tuning;
  }

  /** True from windup to the end of recovery: the body must not walk. */
  get busy(): boolean {
    return this.phase !== 'idle';
  }

  canStart(distance: number, headingError: number): boolean {
    return this.phase === 'idle' && this.cooldown <= 0 && distance <= this.tuning.range && Math.abs(headingError) <= this.tuning.arc;
  }

  /** Begin a slam if allowed. Returns whether it started. */
  start(distance: number, headingError: number): boolean {
    if (!this.canStart(distance, headingError)) return false;
    this.phase = 'windup';
    this.t = 0;
    return true;
  }

  /** Abort (stunned, lost a limb, died). Puts the slam on cooldown. */
  cancel(): void {
    if (this.phase === 'idle') return;
    this.phase = 'idle';
    this.t = 0;
    this.cooldown = this.tuning.cooldown;
  }

  /** Advance; returns true on the step the arms hit the ground (exactly once per slam). */
  update(dt: number): boolean {
    if (this.phase === 'idle') {
      this.cooldown = Math.max(0, this.cooldown - dt);
      return false;
    }
    this.t += dt;
    const k = this.tuning;
    if (this.phase === 'windup' && this.t >= k.windup) {
      this.phase = 'strike';
      this.t -= k.windup;
    }
    if (this.phase === 'strike' && this.t >= k.strike) {
      this.phase = 'recover';
      this.t -= k.strike;
      return true;
    }
    if (this.phase === 'recover' && this.t >= k.recover) {
      this.phase = 'idle';
      this.t = 0;
      this.cooldown = k.cooldown;
    }
    return false;
  }
}

/** Share of the slam's damage a target at distance `d` from the impact point takes (1 in the core, 0 outside). */
export function slamFalloff(d: number, tuning: SlamTuning = SLAM): number {
  const inner = tuning.radius * tuning.core;
  if (d <= inner) return 1;
  if (d >= tuning.radius) return 0;
  const t = (d - inner) / (tuning.radius - inner);
  return 1 - t * t * (3 - 2 * t);
}

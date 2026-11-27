/**
 * The health bar's animation (visor-hud design D3, D5): where the bright fill and the pale chip reach, in health
 * points. It follows the health it is given each step and counts only the time it is given, so a frozen scene holds it.
 */
import { LOW_HP, MAX_HP } from '../../../actors/vitals.ts';

export const HEALTH_SEGMENTS = 4;
/** Seconds the lost span stays before it drains, and seconds the drain takes. */
export const CHIP_HOLD = 0.4;
export const CHIP_DRAIN = 0.5;
/** A heal fills at this many points a second, and never faster than `MIN_FILL` seconds from end to end. */
export const FILL_RATE = 50;
export const MIN_FILL = 0.25;

/** How full segment `i` (0 at the left) is when the bar reaches `hp`: 0..1. */
export function segmentFill(hp: number, i: number): number {
  const per = MAX_HP / HEALTH_SEGMENTS;
  return Math.min(1, Math.max(0, (hp - per * i) / per));
}

/** Whether the bar takes its warning colour, judged on the whole number the panel shows. */
export function healthLow(hp: number): boolean {
  return Math.ceil(hp) <= LOW_HP;
}

export class HealthModel {
  /** Where the bright fill reaches. It trails the real health only while a heal fills up. */
  fill = MAX_HP;
  /** Where the chip trail reaches; never below `fill`, and equal to it when no chip shows. */
  chip = MAX_HP;
  private hp = MAX_HP;
  private hold = 0;
  private drain = 0;
  private rise = 0;

  /** Show `hp` as it is, with no chip and no fill-up: the first frame, a load, a restore. */
  snap(hp: number): void {
    this.hp = this.fill = this.chip = hp;
    this.hold = this.drain = this.rise = 0;
  }

  /** One step of `dt` seconds. Returns the points gained since the last step, for the `+N`, or 0. */
  step(hp: number, dt: number): number {
    const was = this.hp;
    this.hp = hp;
    if (hp < was) {
      // A further hit extends the chip from where it stands.
      this.chip = Math.max(this.chip, was);
      this.fill = Math.min(this.fill, hp);
      this.hold = CHIP_HOLD;
      this.drain = (this.chip - hp) / CHIP_DRAIN;
    } else if (hp > was) {
      this.chip = this.fill;
      this.hold = 0;
      this.rise = (hp - this.fill) / Math.max(MIN_FILL, (hp - this.fill) / FILL_RATE);
    }
    let left = dt;
    if (this.hold > 0) {
      const held = Math.min(this.hold, left);
      this.hold -= held;
      left -= held;
    }
    if (this.fill < hp) this.fill = Math.min(hp, this.fill + this.rise * dt);
    if (this.hold <= 0 && this.chip > hp) this.chip = Math.max(hp, this.chip - this.drain * left);
    this.chip = Math.max(this.chip, this.fill);
    return hp > was ? Math.ceil(hp) - Math.ceil(was) : 0;
  }
}

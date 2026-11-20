/**
 * Hold-to-skip (intro-sequence spec). Pure state machine: feed it the skip key's state each
 * simulation step and it reports progress 0..1 and fires once at 1.
 *
 * - Hold mode: progress fills while the key is held and drains at 3x speed when released,
 *   so a slip is forgiven but a skip cannot be built up by tapping.
 * - Assist mode: one press arms the countdown (it fills by itself), a second press cancels.
 */
export interface SkipInput {
  held: boolean;
  /** Pressed this step (edge). */
  pressed: boolean;
}

export interface SkipOptions {
  seconds: number;
  assist: boolean;
}

const DRAIN = 3;

export class SkipHold {
  progress = 0;
  armed = false;
  private fired = false;

  /** Returns true on the one step where the skip fires. */
  update(dt: number, input: SkipInput, opts: SkipOptions): boolean {
    if (this.fired) return false;
    const seconds = Math.max(0.1, opts.seconds);
    let filling: boolean;
    if (opts.assist) {
      if (input.pressed) this.armed = !this.armed;
      filling = this.armed;
    } else {
      this.armed = false;
      filling = input.held;
    }
    this.progress = filling ? this.progress + dt / seconds : Math.max(0, this.progress - (DRAIN * dt) / seconds);
    if (this.progress >= 1) {
      this.progress = 1;
      this.fired = true;
      return true;
    }
    return false;
  }

  /** New scene, pause, or load. */
  reset(): void {
    this.progress = 0;
    this.armed = false;
    this.fired = false;
  }
}

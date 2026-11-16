/**
 * Fixed-timestep simulation with variable-rate rendering (ADR-0001).
 */
export interface Clock {
  /** Simulation step in seconds. */
  readonly step: number;
  /** 1 = normal, 0 = paused, <1 = slow motion. */
  scale: number;
  /** Simulated seconds since start. */
  elapsed: number;
  /** Simulation steps run since start. */
  steps: number;
}

export interface LoopHooks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

/** Longest real frame we accept, so a backgrounded tab doesn't explode the sim. */
const MAX_FRAME = 0.25;

export class Loop {
  readonly clock: Clock;
  private readonly hooks: LoopHooks;
  private readonly maxSteps: number;
  private acc = 0;
  private last = -1;
  private raf = 0;

  constructor(hooks: LoopHooks, step = 1 / 60, maxSteps = 5) {
    this.hooks = hooks;
    this.maxSteps = maxSteps;
    this.clock = { step, scale: 1, elapsed: 0, steps: 0 };
  }

  /**
   * Advance by one real frame. Pure apart from hook calls, so it is unit-testable.
   * Returns the number of simulation steps run.
   */
  advance(frameDt: number): number {
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME);
    const { step } = this.clock;
    this.acc += dt * this.clock.scale;
    let n = 0;
    while (this.acc >= step && n < this.maxSteps) {
      this.hooks.update(step);
      this.acc -= step;
      this.clock.elapsed += step;
      this.clock.steps++;
      n++;
    }
    // Spiral-of-death guard: drop backlog we could not catch up on.
    if (n === this.maxSteps && this.acc >= step) this.acc = 0;
    this.hooks.render(this.acc / step, dt);
    return n;
  }

  start(): void {
    if (this.raf) return;
    const tick = (now: number): void => {
      const frameDt = this.last < 0 ? 0 : (now - this.last) / 1000;
      this.last = now;
      this.advance(frameDt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = -1;
  }
}

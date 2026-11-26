/**
 * Delays counted in play time (game-pause): the simulation steps them, so a frozen scene holds them. Cleared when the
 * moment is left (restart, load, quit).
 */

interface Entry {
  /** Play time (s) it falls due. */
  at: number;
  run: () => void;
  dropped: (() => void) | undefined;
}

/** Slack for float sums of step times. */
const SLACK = 1e-9;

export class SceneTimers {
  private now = 0;
  private pending: Entry[] = [];

  /**
   * Run `run` after `seconds` of play. `dropped` runs instead if the timers are cleared first (to put something away).
   * Returns the cancel call, which runs neither.
   */
  after(seconds: number, run: () => void, dropped?: () => void): () => void {
    const entry: Entry = { at: this.now + Math.max(0, seconds), run, dropped };
    this.pending.push(entry);
    return () => {
      this.pending = this.pending.filter((e) => e !== entry);
    };
  }

  /** One step of play. What falls due runs in due order; a timer set by one of them waits for a later step. */
  update(dt: number): void {
    this.now += dt;
    const due = this.pending.filter((e) => e.at <= this.now + SLACK).sort((a, b) => a.at - b.at);
    for (const entry of due) {
      // An earlier one may have cancelled it, or cleared everything.
      if (!this.pending.includes(entry)) continue;
      this.pending = this.pending.filter((e) => e !== entry);
      entry.run();
    }
  }

  clear(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const e of dropped) e.dropped?.();
  }
}

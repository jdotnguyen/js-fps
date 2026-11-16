import type { Rng } from '../core/rng.ts';

interface Entry {
  every: readonly [number, number];
  fire: () => void;
  next: number;
}

/** Fires callbacks at random intervals; the backbone of the ambience (ADR-0013). */
export class Scheduler {
  private readonly entries: Entry[] = [];
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  /** `every` is [min, max] seconds between firings. The first firing comes sooner. */
  add(every: readonly [number, number], fire: () => void): void {
    this.entries.push({ every, fire, next: Number.NaN });
  }

  update(t: number): void {
    for (const e of this.entries) {
      if (Number.isNaN(e.next)) e.next = t + this.rng.range(e.every[0], e.every[1]) * 0.5;
      if (t >= e.next) {
        e.fire();
        e.next = t + this.rng.range(e.every[0], e.every[1]);
      }
    }
  }
}

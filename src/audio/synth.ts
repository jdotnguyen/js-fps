/** Helpers shared by the procedural generators in ./sounds/. */
import type { Rng } from '../core/rng.ts';
import { Biquad, TAU, type Buf } from './dsp.ts';

export interface SoundSpec {
  make: (sr: number, rng: Rng) => Buf;
  loop: boolean;
  variants: number;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Decaying modal partials: a cheap struck-metal model. */
export function modal(t: number, base: number, ratios: readonly number[], amps: readonly number[], decays: readonly number[], phases: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < ratios.length; k++) {
    s += (amps[k] ?? 0) * Math.exp(-t / (decays[k] ?? 1)) * Math.sin(TAU * base * (ratios[k] ?? 1) * t + (phases[k] ?? 0));
  }
  return s;
}

/**
 * A bank of damped band-pass resonators at log-random frequencies. Excited by a noise
 * burst it sounds like a struck plate: metallic but not pitched (no single "clank" tone).
 */
export class ResonatorBank {
  private readonly filters: Biquad[] = [];
  private readonly gains: number[] = [];
  constructor(sr: number, rng: Rng, count: number, fMin: number, fMax: number, qMin: number, qMax: number) {
    for (let k = 0; k < count; k++) {
      const f = fMin * Math.pow(fMax / fMin, rng.next());
      this.filters.push(new Biquad('bandpass', f, rng.range(qMin, qMax), sr));
      this.gains.push(rng.range(0.5, 1) / Math.sqrt(f / fMin));
    }
  }
  process(x: number): number {
    let y = 0;
    for (let k = 0; k < this.filters.length; k++) y += this.filters[k]!.process(x) * this.gains[k]!;
    return y;
  }
}

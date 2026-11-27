/**
 * Jay's heart on the biomonitor (visor-hud design D5): a rate that follows health and the trace it draws, as a ring of
 * `ECG_SAMPLES` heights (0 on the baseline, 1 at the top of an R spike). It advances only by the time it is given.
 */
import type { VitalState } from '../../../actors/vitals.ts';
import { LOW_HP, MAX_HP } from '../../../actors/vitals.ts';

export const ECG_SAMPLES = 96;
/** Seconds of trace the ring holds. */
export const ECG_SECONDS = 2.5;
export const REST_BPM = 72;
export const PEAK_BPM = 148;
export const DOWNED_BPM = 44;
/** The rate closes on its target this fast, so a hit does not make it jump. */
export const BPM_EASE = 20;
const SAMPLE_SECONDS = ECG_SECONDS / ECG_SAMPLES;
/** Each sample takes the strongest of this many looks across its interval, so a thin R spike keeps its height. */
const LOOKS = 4;
/** One beat: where in the beat each wave sits, how high it is and how wide. */
const WAVES: ReadonlyArray<readonly [at: number, height: number, width: number]> = [
  [0.18, 0.14, 0.035],
  [0.34, -0.14, 0.022],
  [0.4, 1, 0.036],
  [0.47, -0.3, 0.028],
  [0.68, 0.28, 0.065],
];
/** An irregular beat: every third, early or late by up to this share of a beat, with a smaller spike. */
const JITTER = 0.14;
const WEAK_BEAT = 0.55;
const DOWNED_HEIGHT = 0.35;

export function targetBpm(hp: number, state: VitalState): number {
  if (state === 'dead') return 0;
  if (state === 'downed') return DOWNED_BPM;
  const hurt = 1 - Math.min(1, Math.max(0, hp / MAX_HP));
  return REST_BPM + (PEAK_BPM - REST_BPM) * hurt;
}

function beatHeight(phase: number): number {
  let sum = 0;
  for (const [at, height, width] of WAVES) sum += height * Math.exp(-(((phase - at) / width) ** 2));
  return sum;
}

export class HeartModel {
  bpm = REST_BPM;
  private readonly ring = new Float32Array(ECG_SAMPLES);
  private readonly out = new Float32Array(ECG_SAMPLES);
  /** Index of the oldest sample, which the next one overwrites. */
  private head = 0;
  /** Play time not yet turned into a sample. */
  private pending = 0;
  /** Beats since the start; the fraction is the place within the beat. */
  private beats = 0;
  private shift = 0;
  private weak = false;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /** The samples, oldest first. The array is reused by the next call. */
  trace(): Float32Array {
    const tail = ECG_SAMPLES - this.head;
    this.out.set(this.ring.subarray(this.head), 0);
    this.out.set(this.ring.subarray(0, this.head), tail);
    return this.out;
  }

  /** Settle on the rate for this health at once and draw a full trace of it. */
  snap(hp: number, state: VitalState): void {
    this.bpm = targetBpm(hp, state);
    this.pending = 0;
    this.beats = 0.15;
    this.shift = 0;
    this.weak = false;
    for (let i = 0; i < ECG_SAMPLES; i++) this.sample(hp, state);
  }

  /** Advance by `dt` seconds of play. Returns true when the trace moved. */
  step(hp: number, state: VitalState, dt: number): boolean {
    const target = targetBpm(hp, state);
    if (state === 'dead') this.bpm = 0;
    else this.bpm += Math.min(BPM_EASE * dt, Math.max(-BPM_EASE * dt, target - this.bpm));
    this.pending += dt;
    let moved = false;
    // The epsilon keeps a step of exactly one interval from slipping a frame to rounding.
    while (this.pending >= SAMPLE_SECONDS - 1e-9) {
      this.pending -= SAMPLE_SECONDS;
      this.sample(hp, state);
      moved = true;
    }
    return moved;
  }

  private sample(hp: number, state: VitalState): void {
    const irregular = state === 'alive' && hp <= LOW_HP;
    const size = state === 'dead' ? 0 : state === 'downed' ? DOWNED_HEIGHT : 1;
    const advance = ((this.bpm / 60) * SAMPLE_SECONDS) / LOOKS;
    let strongest = 0;
    for (let i = 0; i < LOOKS; i++) {
      const before = Math.floor(this.beats);
      this.beats += advance;
      const index = Math.floor(this.beats);
      if (index !== before) {
        this.weak = irregular && index % 3 === 2;
        this.shift = this.weak ? (this.random() * 2 - 1) * JITTER : 0;
      }
      const height = beatHeight(this.beats - index - this.shift) * size * (this.weak ? WEAK_BEAT : 1);
      if (Math.abs(height) > Math.abs(strongest)) strongest = height;
    }
    this.ring[this.head] = strongest;
    this.head = (this.head + 1) % ECG_SAMPLES;
  }
}

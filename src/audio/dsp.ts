/**
 * Tiny offline DSP kit for procedural sounds (fallbacks; spec audio-assets). Pure functions over
 * Float32Arrays: runs in Node for tests/previews and in the browser before upload
 * to AudioBuffers.
 */
import type { Rng } from '../core/rng.ts';

export type Buf = Float32Array<ArrayBuffer>;
export const TAU = Math.PI * 2;

export function makeBuf(sr: number, seconds: number): Buf {
  return new Float32Array(Math.max(1, Math.round(sr * seconds)));
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** RBJ biquad, transposed direct form II. Call `set` to sweep. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  private readonly sr: number;
  private readonly type: FilterType;

  constructor(type: FilterType, freq: number, q: number, sr: number) {
    this.type = type;
    this.sr = sr;
    this.set(freq, q);
  }

  set(freq: number, q: number): void {
    const f = Math.min(Math.max(freq, 10), this.sr * 0.45);
    const w0 = (TAU * f) / this.sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const coeffs: Record<FilterType, [number, number, number]> = {
      lowpass: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2],
      highpass: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2],
      bandpass: [alpha, 0, -alpha],
    };
    const [b0, b1, b2] = coeffs[this.type];
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** One-pole lowpass smoother. */
export class OnePole {
  private y = 0;
  private a: number;
  private readonly sr: number;
  constructor(cutoff: number, sr: number) {
    this.sr = sr;
    this.a = 0;
    this.setCutoff(cutoff);
  }
  setCutoff(cutoff: number): void {
    this.a = 1 - Math.exp((-TAU * cutoff) / this.sr);
  }
  process(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

export function white(rng: Rng): () => number {
  return () => rng.next() * 2 - 1;
}

/** Paul Kellet's pink noise approximation. */
export function pink(rng: Rng): () => number {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return out * 0.11;
  };
}

/** Brown (red) noise: integrated white with a leak. */
export function brown(rng: Rng): () => number {
  let last = 0;
  return () => {
    last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
    return last * 3.5;
  };
}

/** Scale so the loudest sample hits `peak`. */
export function normalize(buf: Buf, peak: number): Buf {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]!));
  if (m > 0) {
    const k = peak / m;
    for (let i = 0; i < buf.length; i++) buf[i] = buf[i]! * k;
  }
  return buf;
}

/** Linear fade-in/out (seconds) to avoid clicks at the edges of one-shots. */
export function fadeEdges(buf: Buf, sr: number, inS: number, outS: number): Buf {
  const fi = Math.round(inS * sr);
  const fo = Math.round(outS * sr);
  for (let i = 0; i < fi && i < buf.length; i++) buf[i] = buf[i]! * (i / fi);
  for (let i = 0; i < fo && i < buf.length; i++) {
    const j = buf.length - 1 - i;
    buf[j] = buf[j]! * (i / fo);
  }
  return buf;
}

/**
 * Make a seamless loop: the last `fadeSeconds` are crossfaded into the start and
 * dropped. Periodic parts should complete whole cycles over (length - fade).
 */
export function seamless(buf: Buf, sr: number, fadeSeconds: number): Buf {
  const f = Math.round(fadeSeconds * sr);
  const n = buf.length - f;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[i]!;
  for (let i = 0; i < f; i++) {
    const t = i / f;
    out[i] = buf[i]! * t + buf[n + i]! * (1 - t);
  }
  return out;
}

export function stats(buf: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]!;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, buf.length)) };
}

/** Colour and early-reflection pattern of an impulse response (see audio/reverb.ts). */
export interface IrShape {
  /** Low-pass cutoff at the start of the tail, Hz. */
  cutoff: number;
  /** How fast the tail darkens, per second (higher = duller late tail). */
  darken: number;
  /** Cutoff the tail settles towards, Hz. */
  floor: number;
  /** Silence before the tail begins, seconds. */
  predelay: number;
  /** Early reflections: [time s, amplitude, side 0|1]. */
  taps: ReadonlyArray<readonly [number, number, number]>;
}

export const DEFAULT_IR_SHAPE: IrShape = {
  cutoff: 6000,
  darken: 2.2,
  floor: 300,
  predelay: 0,
  taps: [
    [0.007, 0.7, 0], [0.011, 0.55, 1], [0.017, 0.45, 0], [0.023, 0.4, 1], [0.031, 0.3, 0], [0.043, 0.25, 1],
  ],
};

/**
 * Stereo impulse response for the convolution reverb: early reflections plus a
 * decaying, darkening noise tail. rt60 in seconds. The default shape is the metal corridor.
 */
export function impulseResponse(sr: number, rt60: number, rng: Rng, shape: IrShape = DEFAULT_IR_SHAPE): [Buf, Buf] {
  const pre = Math.round(shape.predelay * sr);
  const len = Math.round(sr * rt60 * 1.1) + pre;
  const out: [Buf, Buf] = [new Float32Array(len), new Float32Array(len)];
  for (let ch = 0; ch < 2; ch++) {
    const buf = out[ch]!;
    const noise = white(rng.fork(`ir${ch}`));
    const lp = new OnePole(shape.cutoff, sr);
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      if (i % 64 === 0) lp.setCutoff(shape.cutoff * Math.exp(-t * shape.darken) + shape.floor);
      const env = Math.exp((-t * 6.9) / rt60) * Math.min(1, t / 0.012);
      buf[i] = lp.process(noise()) * env * 0.5;
    }
    for (const [time, amp, side] of shape.taps) {
      const i = Math.round((time + (ch === side ? 0 : 0.0015)) * sr) + pre;
      if (i < len) buf[i] = buf[i]! + amp * (ch === side ? 1 : 0.6);
    }
  }
  return out;
}

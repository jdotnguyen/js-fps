/**
 * Building blocks for generated scores (adaptive-music spec): band-limited oscillators, loop-safe event writing,
 * steady-state reverb for loops, and the percussion voices the scores share. Everything is deterministic.
 */
import type { Rng } from '../../core/rng.ts';
import { Biquad, OnePole, TAU, seamless, white, type Buf } from '../dsp.ts';
import { reverb } from '../music.ts';

export interface Stereo {
  l: Buf;
  r: Buf;
}

export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
export const cents = (c: number): number => Math.pow(2, c / 1200);
export const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function stereo(n: number): Stereo {
  return { l: new Float32Array(n), r: new Float32Array(n) };
}

/** Equal-power pan gains for pan in -1..1. */
export function pan(p: number): [number, number] {
  return [Math.sqrt(0.5 - 0.5 * p), Math.sqrt(0.5 + 0.5 * p)];
}

/** Snap a frequency to whole cycles per loop, so it wraps cleanly. */
export function snapper(loopSeconds: number): (f: number) => number {
  return (f) => Math.max(1, Math.round(f * loopSeconds)) / loopSeconds;
}

/** PolyBLEP sawtooth: a cheap, mostly alias-free saw. */
export class Saw {
  private phase: number;
  private readonly sr: number;
  constructor(sr: number, phase = 0) {
    this.sr = sr;
    this.phase = phase % 1;
  }
  next(freq: number): number {
    const dt = freq / this.sr;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= Math.floor(this.phase);
    const t = this.phase;
    let y = 2 * t - 1;
    if (t < dt) {
      const x = t / dt;
      y -= x + x - x * x - 1;
    } else if (t > 1 - dt) {
      const x = (t - 1) / dt;
      y -= x * x + x + x + 1;
    }
    return y;
  }
}

/** Add `v` at sample `i` of a loop of length n (wrapping, so tails ring across the seam). */
export function put(buf: Buf, i: number, v: number): void {
  const n = buf.length;
  buf[((i % n) + n) % n]! += v;
}

/**
 * Reverb for a loop: run the loop twice through the room and keep the second pass, so the tail of the end rings into
 * the start and the result loops seamlessly.
 */
export function loopReverb(dry: Stereo, sr: number, rt60: number, damp: number): Stereo {
  const n = dry.l.length;
  const twice = (b: Buf): Buf => {
    const o = new Float32Array(n * 2);
    o.set(b, 0);
    o.set(b, n);
    return o;
  };
  const wet = reverb(twice(dry.l), twice(dry.r), sr, rt60, damp);
  return { l: wet.l.slice(n), r: wet.r.slice(n) };
}

/** Dry + room for a loop. */
export function withRoom(dry: Stereo, sr: number, wet: number, rt60 = 4.5, damp = 0.45): Stereo {
  const w = loopReverb(dry, sr, rt60, damp);
  const n = dry.l.length;
  const out = stereo(n);
  for (let i = 0; i < n; i++) {
    out.l[i] = dry.l[i]! + w.l[i]! * wet;
    out.r[i] = dry.r[i]! + w.r[i]! * wet;
  }
  return out;
}

/** Room for a one-shot (the tail is part of the buffer). */
export function oneShotRoom(dry: Stereo, sr: number, wet: number, rt60 = 3.5, damp = 0.45): Stereo {
  const w = reverb(dry.l, dry.r, sr, rt60, damp);
  const n = dry.l.length;
  const out = stereo(n);
  for (let i = 0; i < n; i++) {
    out.l[i] = dry.l[i]! + w.l[i]! * wet;
    out.r[i] = dry.r[i]! + w.r[i]! * wet;
  }
  return out;
}

/** Crossfade a rendered `n + fade` stereo pair into a seamless loop of n. */
export function seamlessStereo(s: Stereo, sr: number, fadeSeconds: number): Stereo {
  return { l: seamless(s.l, sr, fadeSeconds), r: seamless(s.r, sr, fadeSeconds) };
}

export function rms(s: Stereo): number {
  let sum = 0;
  for (let i = 0; i < s.l.length; i++) sum += s.l[i]! * s.l[i]! + s.r[i]! * s.r[i]!;
  return Math.sqrt(sum / Math.max(1, s.l.length * 2));
}

export function peak(s: Stereo): number {
  let p = 0;
  for (let i = 0; i < s.l.length; i++) p = Math.max(p, Math.abs(s.l[i]!), Math.abs(s.r[i]!));
  return p;
}

export function scale(s: Stereo, k: number): Stereo {
  for (let i = 0; i < s.l.length; i++) {
    s.l[i] = s.l[i]! * k;
    s.r[i] = s.r[i]! * k;
  }
  return s;
}

/** Soft-clip in place. */
export function saturate(s: Stereo, drive = 1): Stereo {
  for (let i = 0; i < s.l.length; i++) {
    s.l[i] = Math.tanh(s.l[i]! * drive) / drive;
    s.r[i] = Math.tanh(s.r[i]! * drive) / drive;
  }
  return s;
}

/** Short fades at the ends of a one-shot so it never clicks. */
export function edges(s: Stereo, sr: number, inS = 0.002, outS = 0.05): Stereo {
  const fi = Math.max(1, Math.round(inS * sr));
  const fo = Math.max(1, Math.round(outS * sr));
  const n = s.l.length;
  for (let i = 0; i < fi && i < n; i++) {
    const g = i / fi;
    s.l[i] = s.l[i]! * g;
    s.r[i] = s.r[i]! * g;
  }
  for (let i = 0; i < fo && i < n; i++) {
    const g = i / fo;
    s.l[n - 1 - i] = s.l[n - 1 - i]! * g;
    s.r[n - 1 - i] = s.r[n - 1 - i]! * g;
  }
  return s;
}

// ------------------------------------------------------------------ percussion

/** The heartbeat thump of "Pressure": a falling low sine, double-struck. */
export function thump(out: Stereo, sr: number, at: number, amp: number): void {
  const start = Math.round(at * sr);
  const len = Math.round(0.6 * sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const dt = i / sr;
    ph += (TAU * (32 + 22 * Math.exp(-dt / 0.06))) / sr;
    const v = Math.sin(ph) * Math.exp(-dt / 0.12) * amp * Math.min(1, dt / 0.004);
    put(out.l, start + i, v);
    put(out.r, start + i, v);
  }
}

/** A deep tom: pitch falls from f0 to half, with a short noisy skin. */
export function tom(out: Stereo, sr: number, rng: Rng, at: number, f0: number, amp: number, p = 0, decay = 0.35): void {
  const start = Math.round(at * sr);
  const len = Math.round((decay * 3 + 0.05) * sr);
  const noise = white(rng);
  const skin = new Biquad('lowpass', 900, 0.8, sr);
  const [gl, gr] = pan(p);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const dt = i / sr;
    const f = f0 * (0.5 + 0.5 * Math.exp(-dt / 0.08));
    ph += (TAU * f) / sr;
    const body = Math.sin(ph) * Math.exp(-dt / decay);
    const hit = skin.process(noise()) * Math.exp(-dt / 0.02) * 0.8;
    const v = Math.tanh((body + hit) * 1.6) * amp * Math.min(1, dt / 0.002);
    put(out.l, start + i, v * gl);
    put(out.r, start + i, v * gr);
  }
}

/** A huge downbeat: sub drop, noise blast and an inharmonic metal clang. */
export function impact(out: Stereo, sr: number, rng: Rng, at: number, amp: number, clangHz = 110, length = 2.2): void {
  const start = Math.round(at * sr);
  const len = Math.round(length * sr);
  const noise = white(rng);
  const lpL = new Biquad('lowpass', 3000, 0.9, sr);
  const lpR = new Biquad('lowpass', 3000, 0.9, sr);
  const partials = [1, 2.76, 5.4, 8.93, 13.34].map((m, k) => ({ f: clangHz * m, a: 0.5 / (k + 1), d: 1.6 / (1 + k * 0.45), ph: k * 1.3 }));
  let subPh = 0;
  for (let i = 0; i < len; i++) {
    const dt = i / sr;
    const fs = 30 + 45 * Math.exp(-dt / 0.15);
    subPh += (TAU * fs) / sr;
    const sub = Math.sin(subPh) * Math.exp(-dt / 0.7) * 1.1;
    if ((i & 31) === 0) {
      const c = 200 + 2800 * Math.exp(-dt / 0.08);
      lpL.set(c, 0.9);
      lpR.set(c * 1.08, 0.9);
    }
    const blastEnv = Math.exp(-dt / 0.22);
    const nl = lpL.process(noise()) * blastEnv;
    const nr = lpR.process(noise()) * blastEnv;
    let clang = 0;
    for (const p of partials) clang += Math.sin(TAU * p.f * dt + p.ph) * p.a * Math.exp(-dt / p.d);
    const attack = Math.min(1, dt / 0.0015);
    const l = Math.tanh((sub + nl * 0.9 + clang * 0.55) * 1.4) * amp * attack;
    const r = Math.tanh((sub + nr * 0.9 + clang * 0.5) * 1.4) * amp * attack;
    put(out.l, start + i, l);
    put(out.r, start + i, r);
  }
}

/** A dry, distorted snare-like crack. */
export function crack(out: Stereo, sr: number, rng: Rng, at: number, amp: number): void {
  const start = Math.round(at * sr);
  const len = Math.round(0.5 * sr);
  const noise = white(rng);
  const hp = new Biquad('highpass', 420, 0.7, sr);
  const bp = new Biquad('bandpass', 1800, 1.2, sr);
  for (let i = 0; i < len; i++) {
    const dt = i / sr;
    const n = noise();
    const body = Math.sin(TAU * 185 * dt) * Math.exp(-dt / 0.05);
    const v = Math.tanh((hp.process(n) * 0.9 + bp.process(n) * 1.4) * Math.exp(-dt / 0.13) * 2.4 + body) * amp * Math.min(1, dt / 0.001);
    put(out.l, start + i, v * 0.95);
    put(out.r, start + i, v);
  }
}

/** A filtered noise that a OnePole has smoothed into a rough "bow". */
export function bowNoise(rng: Rng, sr: number, cutoff = 30): () => number {
  const n = white(rng);
  const f = new OnePole(cutoff, sr);
  return () => f.process(n()) * 6;
}

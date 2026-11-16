/**
 * Procedural sound library (ADR-0013). Each generator renders a mono buffer from a
 * seeded RNG, so sounds are identical on every machine and need no audio files.
 * Loops are seamless; periodic parts complete whole cycles over the loop length.
 */
import type { Rng } from '../core/rng.ts';
import { Biquad, brown, fadeEdges, makeBuf, normalize, OnePole, pink, seamless, TAU, white, type Buf } from './dsp.ts';

const LOOP_FADE = 0.5;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Decaying modal partials: a cheap struck-metal model. */
function modal(t: number, base: number, ratios: readonly number[], amps: readonly number[], decays: readonly number[], phases: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < ratios.length; k++) {
    s += (amps[k] ?? 0) * Math.exp(-t / (decays[k] ?? 1)) * Math.sin(TAU * base * (ratios[k] ?? 1) * t + (phases[k] ?? 0));
  }
  return s;
}

// ------------------------------------------------------------------ loops

/** Station room tone: low rumble, 60 Hz mains hum, faint air. */
export function roomTone(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 8 + LOOP_FADE);
  const br = brown(rng);
  const lp = new Biquad('lowpass', 180, 0.7, sr);
  const air = pink(rng.fork('air'));
  const bp = new Biquad('bandpass', 2500, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const wobble = 1 + 0.15 * Math.sin(TAU * 0.125 * t);
    const hum = (Math.sin(TAU * 60 * t) * 0.12 + Math.sin(TAU * 120 * t + 1) * 0.06 + Math.sin(TAU * 180 * t + 2) * 0.03) * wobble;
    b[i] = lp.process(br()) * 0.6 + hum + bp.process(air()) * 0.05;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.5);
}

/** Wall vent: motor whine plus air chopped by four fan blades. */
export function ventFan(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 4 + LOOP_FADE);
  const air = pink(rng);
  const bp = new Biquad('bandpass', 900, 0.8, sr);
  const br = brown(rng.fork('low'));
  const lp = new Biquad('lowpass', 120, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const blade = Math.sin(TAU * 5.75 * t);
    const phase = TAU * 180 * t + 0.3 * Math.sin(TAU * 0.5 * t);
    b[i] =
      bp.process(air()) * 0.5 * (0.7 + 0.3 * blade) +
      Math.sin(phase) * 0.05 +
      Math.sin(phase * 2) * 0.025 +
      lp.process(br()) * 0.3 * (0.8 + 0.2 * blade);
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.6);
}

/** Fluorescent ballast buzz (120 Hz and harmonics) with occasional crackle. */
export function fluorescentBuzz(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2 + LOOP_FADE);
  const phases = Array.from({ length: 13 }, () => rng.next() * TAU);
  const bp = new Biquad('bandpass', 1400, 0.7, sr);
  const hp = new Biquad('highpass', 3000, 0.7, sr);
  const noise = white(rng.fork('crackle'));
  const crackRng = rng.fork('crackle-timing');
  let crack = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 1; k <= 12; k++) s += Math.sin(TAU * 120 * k * t + phases[k]!) / Math.pow(k, 0.7);
    if (crackRng.next() < 0.0006) crack = 1;
    crack *= 0.995;
    const buzz = bp.process(s) * 0.5 + Math.sin(TAU * 120 * t) * 0.25 + Math.sin(TAU * 240 * t) * 0.1;
    b[i] = buzz * (0.85 + 0.15 * Math.sin(TAU * t)) + hp.process(noise()) * crack * 0.6;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.5);
}

/** Ocean pressure on the hull: sub rumble that swells, with muffled bubbles. */
export function waterRumble(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 8 + LOOP_FADE);
  const br = brown(rng);
  const lp = new Biquad('lowpass', 90, 0.7, sr);
  const bubbleLp = new Biquad('lowpass', 600, 0.7, sr);
  const bubbles: Array<{ age: number; f0: number; phase: number }> = [];
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    if (rng.next() < 1 / (sr * 1.4) && bubbles.length < 4) bubbles.push({ age: 0, f0: rng.range(150, 380), phase: 0 });
    let bub = 0;
    for (const bb of bubbles) {
      bb.phase += (bb.f0 * (1 + bb.age * 3)) / sr;
      bub += Math.sin(TAU * bb.phase) * Math.exp(-bb.age / 0.07);
      bb.age += 1 / sr;
    }
    for (let k = bubbles.length - 1; k >= 0; k--) if (bubbles[k]!.age > 0.4) bubbles.splice(k, 1);
    b[i] = lp.process(br()) * (1 + 0.35 * Math.sin((TAU * t) / 8)) + bubbleLp.process(bub) * 0.25;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.6);
}

/** Electronics hum and fan hiss from the console. */
export function consoleHum(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2 + LOOP_FADE);
  const hiss = pink(rng);
  const bp = new Biquad('bandpass', 5000, 1.5, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] = Math.sin(TAU * 100 * t) * 0.3 + Math.sin(TAU * 200 * t) * 0.12 + bp.process(hiss()) * 0.08;
  }
  return normalize(seamless(b, sr, LOOP_FADE), 0.25);
}

// ------------------------------------------------------------------ one-shots

/** Long hull stress groan with stick-slip creaks riding on it. */
export function hullGroan(sr: number, rng: Rng): Buf {
  const dur = rng.range(4.5, 6.5);
  const b = makeBuf(sr, dur);
  const f0 = rng.range(38, 52);
  const bp = new Biquad('bandpass', 100, 5, sr);
  const lp = new Biquad('lowpass', 700, 0.7, sr);
  const creak1 = new Biquad('bandpass', rng.range(380, 650), 14, sr);
  const creak2 = new Biquad('bandpass', rng.range(1000, 1300), 9, sr);
  const rough = brown(rng.fork('rough'));
  const ph1 = rng.next() * TAU;
  let phase = 0;
  let nextImpulse = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    const env = clamp01(t / 1.2) * clamp01((dur - t) / 1.8);
    const f = f0 * (1 + 0.18 * Math.sin(TAU * 0.31 * t + ph1) + 0.06 * Math.sin(TAU * 1.7 * t));
    phase += f / sr;
    const saw = 2 * (phase % 1) - 1;
    if (i % 64 === 0) bp.set(90 + 70 * Math.sin(Math.PI * p), 5);
    const body = lp.process(bp.process(saw * (0.7 + 0.6 * rough()))) * 1.8;
    let impulse = 0;
    if (t >= nextImpulse) {
      impulse = 1;
      nextImpulse = t + 0.007 + 0.009 * rng.next() + 0.01 * (1 - Math.sin(Math.PI * p));
    }
    const creak = (creak1.process(impulse) + 0.5 * creak2.process(impulse)) * Math.sin(Math.PI * p) ** 2 * 0.9;
    b[i] = (body + creak) * env;
  }
  return fadeEdges(normalize(b, 0.85), sr, 0.01, 0.05);
}

/** A distant struck bulkhead: inharmonic decaying partials plus a thud. */
export function metalKnock(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2);
  const base = rng.range(90, 170);
  const ratios = [1, 2.32, 4.25, 6.63, 9.38, 12.1].map((r) => r * (1 + (rng.next() - 0.5) * 0.04));
  const phases = ratios.map(() => rng.next() * TAU);
  const noise = white(rng.fork('n'));
  const lp = new Biquad('lowpass', 500, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] =
      modal(t, base, ratios, [1, 0.7, 0.45, 0.3, 0.2, 0.12], [1.4, 0.9, 0.6, 0.4, 0.28, 0.2], phases) * Math.min(1, t / 0.002) +
      lp.process(noise()) * Math.exp(-t / 0.012) * 0.8;
  }
  return fadeEdges(normalize(b, 0.9), sr, 0, 0.1);
}

/** Sonar-like pressure ping from outside, with echoes. */
export function pressurePing(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 3.2);
  const f = rng.range(1050, 1400);
  const echoes: Array<[number, number]> = [[0, 1], [0.5, 0.45], [1.0, 0.2], [1.5, 0.08]];
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let s = 0;
    for (const [delay, g] of echoes) {
      const te = t - delay;
      if (te < 0) continue;
      s += g * Math.exp(-te / 0.5) * Math.sin(TAU * f * (1 - 0.02 * Math.min(te, 1)) * te) * Math.min(1, te / 0.004);
    }
    b[i] = s;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0, 0.1);
}

/** Water drip: a rising "bloop" with a tiny impact click. */
export function drip(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.3);
  const f0 = rng.range(550, 1100);
  const noise = white(rng);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    phase += (f0 * (1 + (2.2 * Math.min(t, 0.03)) / 0.03)) / sr;
    b[i] = Math.sin(TAU * phase) * Math.exp(-t / 0.035) * Math.min(1, t / 0.001) + noise() * Math.exp(-t / 0.0015) * 0.3;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0, 0.02);
}

/** Metal creak: stick-slip impulse train exciting narrow resonances. */
export function creak(sr: number, rng: Rng): Buf {
  const dur = rng.range(1, 1.8);
  const b = makeBuf(sr, dur);
  const r1 = new Biquad('bandpass', rng.range(300, 520), 16, sr);
  const r2 = new Biquad('bandpass', rng.range(900, 1300), 10, sr);
  const ph = rng.next() * TAU;
  let next = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    let imp = 0;
    if (t >= next) {
      imp = 1;
      next = t + lerp(0.006, 0.016, 0.5 + 0.5 * Math.sin(TAU * 0.7 * t + ph)) + rng.next() * 0.003;
    }
    b[i] = (r1.process(imp) + 0.4 * r2.process(imp)) * Math.sin(Math.PI * p) ** 1.5;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0.005, 0.05);
}

/** Electrical arc when a failing light kicks back on. */
export function zap(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.4);
  const hp = new Biquad('highpass', 1800, 0.7, sr);
  const lp = new Biquad('lowpass', 2000, 0.7, sr);
  const noise = white(rng);
  let gate = 1;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    if (i % Math.round(sr * 0.003) === 0) gate = rng.next() < 0.55 ? 1 : 0.1;
    const env = Math.exp(-t / 0.12);
    b[i] = (hp.process(noise()) * gate + lp.process(Math.sign(Math.sin(TAU * 120 * t))) * 0.4) * env;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0.001, 0.03);
}

/** Two-tone console chirp. */
export function consoleBeep(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.3);
  const f1 = rng.pick([1568, 1760]);
  const f2 = rng.pick([2093, 2349]);
  const tone = (t: number, start: number, f: number): number => {
    const tt = t - start;
    if (tt < 0 || tt > 0.07) return 0;
    const env = Math.min(1, tt / 0.004) * Math.min(1, (0.07 - tt) / 0.004);
    return (Math.sin(TAU * f * tt) + 0.2 * Math.sin(TAU * 3 * f * tt)) * env;
  };
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    b[i] = tone(t, 0, f1) + tone(t, 0.11, f2);
  }
  return normalize(b, 0.35);
}

/** Lockdown klaxon (heard muffled through the door). */
export function klaxon(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 2.4);
  const lp = new Biquad('lowpass', 2200, 0.7, sr);
  const lo = rng.range(280, 320);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let env = 0;
    let f = lo;
    for (const start of [0, 1.15]) {
      const tw = t - start;
      if (tw >= 0 && tw < 1) {
        env = Math.min(1, tw / 0.05) * Math.min(1, (1 - tw) / 0.2);
        f = lo + 240 * Math.pow(tw, 0.7);
      }
    }
    phase += f / sr;
    b[i] = lp.process(Math.tanh(1.5 * (2 * (phase % 1) - 1))) * env;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0, 0.05);
}

/** Something enormous, far out in the dark: a slow, gliding, formant-y moan. */
export function distantMoan(sr: number, rng: Rng): Buf {
  const dur = 7.5;
  const b = makeBuf(sr, dur);
  const fa = new Biquad('bandpass', 240, 4, sr);
  const fb = new Biquad('bandpass', 520, 6, sr);
  const lp = new Biquad('lowpass', 900, 0.7, sr);
  const grit = brown(rng);
  const start = rng.range(54, 62);
  let phase = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    if (i % 64 === 0) {
      fa.set(lerp(240, 180, p), 4);
      fb.set(lerp(520, 380, p), 6);
    }
    phase += (lerp(start, 36, p) * (1 + 0.04 * Math.sin(TAU * 0.35 * t))) / sr;
    const saw = 2 * (phase % 1) - 1;
    const env = clamp01(t / 2.2) * clamp01((dur - t) / 3);
    b[i] = lp.process((fa.process(saw) + fb.process(saw) * 0.6) * (0.7 + 0.3 * grit())) * env;
  }
  return fadeEdges(normalize(b, 0.8), sr, 0.01, 0.1);
}

/**
 * A bank of damped band-pass resonators at log-random frequencies. Excited by a noise
 * burst it sounds like a struck plate: metallic but not pitched (no single "clank" tone).
 */
class ResonatorBank {
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

interface StepOptions {
  /** Plate resonances. */
  modes: { count: number; fMin: number; fMax: number; qMin: number; qMax: number; level: number };
  /** Extra light impacts after the step (loose grating bars knocking). */
  rattles: number;
  rattleWindow: number;
  grit: number;
  thud: number;
}

/**
 * Boot step: heel strike then toe, each a short rubber-filtered noise burst that excites
 * the plate resonances, plus a low body thud, gravel-like grit crunching under the sole,
 * and a brief scuff as the foot rolls.
 */
function bootStep(sr: number, rng: Rng, o: StepOptions): Buf {
  const dur = 0.5;
  const b = makeBuf(sr, dur);
  const noise = white(rng.fork('noise'));
  const gritNoise = white(rng.fork('grit'));
  const sole = new OnePole(rng.range(1800, 2800), sr); // rubber sole damps the highs
  const bank = new ResonatorBank(sr, rng.fork('modes'), o.modes.count, o.modes.fMin, o.modes.fMax, o.modes.qMin, o.modes.qMax);
  const thudLp = new Biquad('lowpass', rng.range(110, 160), 0.9, sr);
  const gritHp = new Biquad('highpass', rng.range(2500, 4000), 0.7, sr);
  const scuffBp = new Biquad('bandpass', rng.range(1800, 3200), 0.8, sr);
  const out = new Biquad('lowpass', 7000, 0.7, sr);
  const toe = rng.range(0.065, 0.11);
  const impacts: Array<[number, number]> = [[0, 1], [toe, rng.range(0.45, 0.65)]];
  for (let k = 0; k < o.rattles; k++) impacts.push([rng.range(0.02, o.rattleWindow), rng.range(0.08, 0.25)]);
  const gritRate = o.grit * 0.035;

  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let excite = 0;
    let weight = 0;
    let gritEnv = 0;
    for (const [at, g] of impacts) {
      const dt = t - at;
      if (dt < 0) continue;
      excite += g * Math.exp(-dt / 0.005) * Math.min(1, dt / 0.0004);
      weight += g * Math.exp(-dt / 0.028);
      gritEnv += g * Math.exp(-dt / 0.035);
    }
    const n = noise();
    const strike = sole.process(n * excite);
    const plate = bank.process(strike) * o.modes.level;
    const thud = thudLp.process(n * weight) * o.thud;
    // Grit: sparse sharp crackles while weight is coming down.
    const crackle = gritNoise() < 1 - 2 * gritRate * gritEnv ? 0 : gritNoise() * gritEnv;
    const grit = gritHp.process(crackle) * o.grit;
    // Scuff: a soft sliding hiss between heel and toe.
    const scuffEnv = Math.max(0, Math.sin((Math.PI * Math.min(Math.max(t - 0.01, 0), toe)) / toe)) * (t < toe + 0.01 ? 1 : 0);
    const scuff = scuffBp.process(n) * scuffEnv * 0.06;
    b[i] = out.process(strike * 0.35 + plate + thud + grit + scuff);
  }
  return fadeEdges(normalize(b, 0.8), sr, 0.0005, 0.05);
}

/** Boot on diamond plate: dense damped plate resonance, heavy thud, some grit. */
export function footPlate(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 16, fMin: 160, fMax: 3400, qMin: 5, qMax: 12, level: 2.2 },
    rattles: 0,
    rattleWindow: 0,
    grit: 0.9,
    thud: 2.6,
  });
}

/** Boot on grating: lighter thud, ringier bar resonances, loose bars rattling after. */
export function footGrate(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 12, fMin: 420, fMax: 4200, qMin: 14, qMax: 26, level: 2.6 },
    rattles: rng.int(3, 6),
    rattleWindow: 0.16,
    grit: 1.2,
    thud: 1.6,
  });
}

/** Flashlight switch: two clicks. */
export function click(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.06);
  const noise = white(rng);
  const hp = new Biquad('highpass', 2000, 0.7, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    let s = 0;
    for (const [at, g] of [[0, 1], [0.022, 0.6]] as const) {
      const dt = t - at;
      if (dt >= 0) s += g * (Math.exp(-dt / 0.0012) * 1.0 + Math.sin(TAU * 3200 * dt) * Math.exp(-dt / 0.004) * 0.4);
    }
    b[i] = hp.process(noise()) * s * 0.7 + s * 0.1;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0, 0.005);
}

// ------------------------------------------------------------------ registry

export interface SoundSpec {
  make: (sr: number, rng: Rng) => Buf;
  loop: boolean;
  variants: number;
}

export const SOUND_SPECS = {
  roomTone: { make: roomTone, loop: true, variants: 1 },
  ventFan: { make: ventFan, loop: true, variants: 1 },
  fluorescentBuzz: { make: fluorescentBuzz, loop: true, variants: 2 },
  waterRumble: { make: waterRumble, loop: true, variants: 1 },
  consoleHum: { make: consoleHum, loop: true, variants: 1 },
  hullGroan: { make: hullGroan, loop: false, variants: 3 },
  metalKnock: { make: metalKnock, loop: false, variants: 4 },
  pressurePing: { make: pressurePing, loop: false, variants: 2 },
  drip: { make: drip, loop: false, variants: 4 },
  creak: { make: creak, loop: false, variants: 3 },
  zap: { make: zap, loop: false, variants: 3 },
  consoleBeep: { make: consoleBeep, loop: false, variants: 2 },
  klaxon: { make: klaxon, loop: false, variants: 1 },
  distantMoan: { make: distantMoan, loop: false, variants: 2 },
  footPlate: { make: footPlate, loop: false, variants: 6 },
  footGrate: { make: footGrate, loop: false, variants: 6 },
  click: { make: click, loop: false, variants: 1 },
} as const satisfies Record<string, SoundSpec>;

export type SoundName = keyof typeof SOUND_SPECS;

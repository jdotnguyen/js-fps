/**
 * Procedural sound library: fallbacks until recorded files load (spec audio-assets). Each generator renders a mono buffer from a
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

/** Menu hover: a low, dissonant descending groan with a breath of rasp, something stirring in the dark. */
export function uiHover(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.24);
  const f0 = rng.range(150, 175);
  const noise = white(rng);
  const bp = new Biquad('bandpass', 420, 2.5, sr);
  const lp = new Biquad('lowpass', 1100, 0.8, sr);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const glide = 1 - 0.22 * Math.min(1, t / 0.2);
    // A minor-second pair beats against itself, which reads as wrong rather than pleasant.
    p1 += (TAU * f0 * glide) / sr;
    p2 += (TAU * f0 * 1.0595 * glide) / sr;
    const env = Math.min(1, t / 0.02) * Math.exp(-t / 0.09);
    const tone = Math.tanh(3 * (Math.sin(p1) + Math.sin(p2)) * 0.6);
    const rasp = bp.process(noise()) * Math.min(1, t / 0.03) * Math.exp(-t / 0.07) * 0.9;
    b[i] = lp.process(tone + rasp) * env;
  }
  return fadeEdges(normalize(b, 0.6), sr, 0.003, 0.05);
}

/** Menu select: a heavy, detuned downward lurch with a metallic scrape and a tritone sting, dread, not a chime. */
export function uiSelect(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.7);
  const noise = white(rng);
  const lpThud = new Biquad('lowpass', 1500, 0.7, sr);
  const lpTone = new Biquad('lowpass', 1400, 0.8, sr);
  const scrapeBp = new Biquad('bandpass', 1900, 3, sr);
  let pa = 0;
  let pb = 0;
  let pc = 0;
  let drop = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    // Falling groan: root and a detuned tritone, both sliding down.
    const slide = Math.exp(-t / 0.35);
    const root = 200 * (0.55 + 0.45 * slide);
    pa += (TAU * root) / sr;
    pb += (TAU * root * 1.4142) / sr;
    pc += (TAU * root * 1.0595 * 0.5) / sr;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.2);
    const groan = Math.tanh(3.5 * (Math.sin(pa) + 0.7 * Math.sin(pb) + 0.8 * Math.sin(pc))) * env;
    // Ring-modulated metal scrape, like a bulkhead dragging.
    const scrape = scrapeBp.process(noise()) * (0.5 + 0.5 * Math.sin(TAU * 37 * t)) * Math.exp(-t / 0.12) * 0.9;
    drop += (TAU * (60 + 150 * Math.exp(-t / 0.06))) / sr;
    const sub = Math.sin(drop) * Math.min(1, t / 0.004) * Math.exp(-t / 0.2) * 1.3;
    const thud = lpThud.process(noise()) * Math.exp(-t / 0.008) * 0.7;
    b[i] = lpTone.process(groan) * 0.8 + scrape + sub + thud;
  }
  return fadeEdges(normalize(b, 0.7), sr, 0.0005, 0.1);
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

// ------------------------------------------------------------------ set-piece one-shots (ADR-0014 beats 5 and 8)

/** Wet tearing: a run of crackling noise bursts through a sweeping band-pass, with a low, meaty thump under it. */
export function fleshTear(sr: number, rng: Rng): Buf {
  const dur = rng.range(0.9, 1.3);
  const b = makeBuf(sr, dur);
  const n = white(rng);
  const bp = new Biquad('bandpass', 900, 1.4, sr);
  const lp = new Biquad('lowpass', 220, 0.8, sr);
  const thump = brown(rng.fork('thump'));
  let crackle = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const p = t / dur;
    if (i % 64 === 0) bp.set(lerp(1500, 500, p) * (1 + 0.3 * Math.sin(TAU * 7 * t)), 1.4);
    // Stick-slip: random sharp clicks, denser in the middle of the rip.
    if (rng.next() < 0.004 * Math.sin(Math.PI * p) + 0.0004) crackle = 1;
    crackle *= 0.985;
    const wet = bp.process(n()) * (0.35 + 0.65 * Math.sin(Math.PI * p) ** 0.5) * (0.6 + crackle);
    const low = lp.process(thump()) * Math.exp(-t / 0.25) * 1.4;
    b[i] = (wet + low) * clamp01(t / 0.01) * clamp01((dur - t) / 0.2);
  }
  return fadeEdges(normalize(b, 0.85), sr, 0.002, 0.05);
}

/** A palm slapping thick glass: a dull thump and a short glassy ring. */
export function glassThud(sr: number, rng: Rng): Buf {
  const b = makeBuf(sr, 0.9);
  const base = rng.range(380, 520);
  const ratios = [1, 2.71, 5.4, 8.9];
  const phases = ratios.map(() => rng.next() * TAU);
  const noise = white(rng.fork('n'));
  const lp = new Biquad('lowpass', 260, 0.9, sr);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const ring = modal(t, base, ratios, [0.25, 0.14, 0.07, 0.04], [0.18, 0.12, 0.08, 0.05], phases);
    const thud = lp.process(noise()) * Math.exp(-t / 0.04) * 2.2;
    b[i] = (ring + thud) * Math.min(1, t / 0.0015);
  }
  return fadeEdges(normalize(b, 0.9), sr, 0, 0.08);
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

/** Boot on painted concrete: dense damped low-mid thud, fine dry grit, no metallic ring. */
export function footConcrete(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 10, fMin: 120, fMax: 950, qMin: 1.5, qMax: 3.2, level: 0.75 },
    rattles: 0,
    rattleWindow: 0,
    grit: 1.15,
    thud: 3.2,
  });
}

/** Boot on rubber or carpet: soft, muffled low thump with minimal grit or ring. */
export function footRubber(sr: number, rng: Rng): Buf {
  return bootStep(sr, rng, {
    modes: { count: 6, fMin: 90, fMax: 420, qMin: 1.1, qMax: 2.0, level: 0.35 },
    rattles: 0,
    rattleWindow: 0,
    grit: 0.15,
    thud: 2.6,
  });
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

// ------------------------------------------------------------------ weapons

/** Adds lowpassed, decaying echoes of the whole buffer: the "slap" off nearby walls that makes a shot feel big. */
function slapback(buf: Buf, sr: number, taps: ReadonlyArray<readonly [delay: number, gain: number]>, cutoff: number): Buf {
  const out = makeBuf(sr, buf.length / sr);
  out.set(buf);
  for (const [delay, gain] of taps) {
    const lp = new Biquad('lowpass', cutoff, 0.7, sr);
    const off = Math.round(delay * sr);
    for (let i = 0; i + off < out.length; i++) out[i + off] = out[i + off]! + lp.process(buf[i]!) * gain;
  }
  return out;
}

/** Simple feed-forward compressor: pulls the loud transient down so the tail comes up with it. */
function squash(buf: Buf, sr: number, amount: number, releaseS: number): Buf {
  const out = makeBuf(sr, buf.length / sr);
  const rel = Math.exp(-1 / (releaseS * sr));
  let env = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    env = Math.max(Math.abs(x), env * rel);
    out[i] = x / (1 + amount * env);
  }
  return out;
}

/**
 * Security pistol (9 mm). Layered like a produced game weapon: a mechanical click, a bright
 * snap, a mid-range "pop", a tight low punch, a darkening air tail, slapback echoes off the
 * walls, then a brass casing tinkling on the floor.
 */
export function pistolShot(sr: number, rng: Rng): Buf {
  const dur = 1.0;
  const shot = makeBuf(sr, dur);
  const clickN = white(rng.fork('click'));
  const snapN = white(rng.fork('snap'));
  const popN = white(rng.fork('pop'));
  const airN = white(rng.fork('air'));
  const slideN = white(rng.fork('slide'));
  const clickHp = new Biquad('highpass', 4000, 0.7, sr);
  const snapHp = new Biquad('highpass', rng.range(1800, 2400), 0.7, sr);
  const snapBp = new Biquad('bandpass', rng.range(4200, 5600), 1.2, sr);
  const popBp = new Biquad('bandpass', rng.range(750, 1050), 1.3, sr);
  const airLp = new Biquad('lowpass', 6000, 0.7, sr);
  const slide = new ResonatorBank(sr, rng.fork('slide-modes'), 8, 900, 5200, 8, 18);
  const slideAt = rng.range(0.05, 0.065);
  const popTone = rng.range(340, 420);
  const f0 = rng.range(200, 240);
  let phase = 0;
  for (let i = 0; i < shot.length; i++) {
    const t = i / sr;
    if (i % 32 === 0) airLp.set(Math.max(500, 6000 * Math.exp(-t / 0.09)), 0.7);
    const click = clickHp.process(clickN()) * Math.exp(-t / 0.0012) * 2.2;
    const snap = (snapHp.process(snapN()) * Math.exp(-t / 0.0045) + snapBp.process(snapN()) * Math.exp(-t / 0.014) * 0.6) * 1.5;
    const pop = popBp.process(popN()) * Math.exp(-t / 0.028) * 2.0 + Math.sin(TAU * popTone * t) * Math.exp(-t / 0.02) * 0.5;
    phase += (f0 * (0.3 + 0.7 * Math.exp(-t / 0.025))) / sr;
    const punch = Math.sin(TAU * phase) * Math.exp(-t / 0.055) * 1.1;
    const air = airLp.process(airN()) * Math.exp(-t / 0.2) * 0.55;
    const ts = t - slideAt;
    const rack = ts > 0 ? slide.process(slideN() * Math.exp(-ts / 0.003)) * 0.09 : 0;
    shot[i] = Math.tanh(1.8 * (click + snap + pop + punch + air) * Math.min(1, t / 0.0003)) + rack;
  }
  const withSlap = slapback(shot, sr, [[0.038, 0.32], [0.092, 0.2], [0.17, 0.11], [0.29, 0.06]], 2600);
  // Brass casing bouncing on the floor, a little after the shot.
  const tink = rng.range(0.3, 0.42);
  for (const [at, g, f] of [[tink, 1, rng.range(4300, 5000)], [tink + 0.07, 0.5, rng.range(4300, 5000)], [tink + 0.115, 0.22, rng.range(4300, 5000)]] as const) {
    for (let i = Math.round(at * sr); i < withSlap.length; i++) {
      const dt = i / sr - at;
      if (dt > 0.12) break;
      withSlap[i] = withSlap[i]! + (Math.sin(TAU * f * dt) + 0.4 * Math.sin(TAU * f * 2.7 * dt)) * Math.exp(-dt / 0.02) * g * 0.05;
    }
  }
  return fadeEdges(normalize(squash(withSlap, sr, 1.5, 0.12), 0.93), sr, 0, 0.1);
}

/**
 * 12-gauge shotgun. Built for weight: a crushing, saturated sub boom, a gritty metallic
 * crunch from resonating steel, a hard noise blast, a long rumbling tail that darkens, and
 * big slapback echoes. Compressed so the tail swells up under the blast.
 */
export function shotgunShot(sr: number, rng: Rng): Buf {
  const dur = 2.2;
  const shot = makeBuf(sr, dur);
  const clickN = white(rng.fork('click'));
  const crackN = white(rng.fork('crack'));
  const blastN = white(rng.fork('blast'));
  const ringN = white(rng.fork('ring'));
  const rumbleN = brown(rng.fork('rumble'));
  const airN = white(rng.fork('air'));
  const tickN = white(rng.fork('tick'));
  const clickHp = new Biquad('highpass', 3000, 0.7, sr);
  const crackHp = new Biquad('highpass', rng.range(1400, 1900), 0.7, sr);
  const blastLp = new Biquad('lowpass', 3000, 0.7, sr);
  const blastLp2 = new Biquad('lowpass', 800, 0.8, sr);
  const ring = new ResonatorBank(sr, rng.fork('ring-modes'), 14, 180, 3200, 7, 18);
  const rumbleLp = new Biquad('lowpass', 170, 0.7, sr);
  const airLp = new Biquad('lowpass', 4500, 0.7, sr);
  const tickHp = new Biquad('highpass', 3500, 0.7, sr);
  const tickRng = rng.fork('tick-timing');
  const fEnd = rng.range(34, 42);
  let phase = 0;
  let tick = 0;
  for (let i = 0; i < shot.length; i++) {
    const t = i / sr;
    if (i % 32 === 0) {
      blastLp.set(Math.max(400, 3000 * Math.exp(-t / 0.06)), 0.7);
      airLp.set(Math.max(300, 4500 * Math.exp(-t / 0.25)), 0.7);
    }
    const click = clickHp.process(clickN()) * Math.exp(-t / 0.0015) * 2;
    const crack = crackHp.process(crackN()) * Math.exp(-t / 0.011) * 1.3;
    const blast = blastLp.process(blastN()) * Math.exp(-t / 0.055) * 2.2 + blastLp2.process(blastN()) * Math.exp(-t / 0.16) * 1.4;
    const crunch = ring.process(ringN() * Math.exp(-t / 0.006)) * 0.75;
    phase += (fEnd + 95 * Math.exp(-t / 0.05)) / sr;
    // Overdriven so the boom has harmonics and still reads on laptop speakers.
    const boom = Math.tanh(2.6 * Math.sin(TAU * phase)) * Math.exp(-t / 0.2) * 1.4;
    const rumble = rumbleLp.process(rumbleN()) * Math.exp(-t / 0.55) * 5;
    const air = airLp.process(airN()) * Math.exp(-t / 0.5) * 0.5;
    if (t > 0.05 && t < 0.6 && tickRng.next() < 0.003) tick = 1;
    tick *= 0.985;
    const pellets = tickHp.process(tickN()) * tick * Math.exp(-t / 0.3) * 0.3;
    shot[i] = Math.tanh(1.9 * (click + crack + blast + crunch + boom + rumble + air) * Math.min(1, t / 0.0005)) + pellets;
  }
  const withSlap = slapback(shot, sr, [[0.065, 0.42], [0.15, 0.3], [0.28, 0.2], [0.46, 0.12], [0.7, 0.06]], 1800);
  return fadeEdges(normalize(squash(withSlap, sr, 2.2, 0.25), 0.95), sr, 0, 0.2);
}

/** Pump action: rack back, then forward, each a metallic clack plus a rattle of the slide. */
export function shotgunPump(sr: number, rng: Rng): Buf {
  const dur = 0.55;
  const b = makeBuf(sr, dur);
  const noise = white(rng.fork('noise'));
  const bank = new ResonatorBank(sr, rng.fork('modes'), 10, 500, 4500, 10, 22);
  const thudLp = new Biquad('lowpass', 180, 0.8, sr);
  const hp = new Biquad('highpass', 1200, 0.7, sr);
  const back = 0;
  const fwd = rng.range(0.19, 0.24);
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const n = noise();
    let excite = 0;
    let weight = 0;
    for (const [at, g] of [[back, 0.85], [fwd, 1]] as const) {
      const dt = t - at;
      if (dt < 0) continue;
      excite += g * Math.exp(-dt / 0.004) * Math.min(1, dt / 0.0004);
      weight += g * Math.exp(-dt / 0.03);
    }
    // Slide friction between the two clacks.
    const slideEnv = t > 0.01 && t < fwd ? Math.sin((Math.PI * (t - 0.01)) / (fwd - 0.01)) : 0;
    const slide = hp.process(n) * slideEnv * 0.05;
    b[i] = bank.process(hp.process(n * excite)) * 1.6 + thudLp.process(n * weight) * 2 + slide;
  }
  return fadeEdges(normalize(b, 0.8), sr, 0.0005, 0.06);
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
  uiHover: { make: uiHover, loop: false, variants: 3 },
  uiSelect: { make: uiSelect, loop: false, variants: 2 },
  distantMoan: { make: distantMoan, loop: false, variants: 2 },
  fleshTear: { make: fleshTear, loop: false, variants: 3 },
  glassThud: { make: glassThud, loop: false, variants: 3 },
  footConcrete: { make: footConcrete, loop: false, variants: 6 },
  footRubber: { make: footRubber, loop: false, variants: 6 },
  footPlate: { make: footPlate, loop: false, variants: 6 },
  footGrate: { make: footGrate, loop: false, variants: 6 },
  click: { make: click, loop: false, variants: 1 },
  pistolShot: { make: pistolShot, loop: false, variants: 4 },
  shotgunShot: { make: shotgunShot, loop: false, variants: 4 },
  shotgunPump: { make: shotgunPump, loop: false, variants: 2 },
} as const satisfies Record<string, SoundSpec>;

/** `casing-<bank>-1.mp3` .. `-<count>.mp3` under assets/audio/weapons/casings/ (scripts/casings-generate.ts names them). */
function casingFiles(bank: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `assets/audio/weapons/casings/casing-${bank}-${i + 1}.mp3`);
}

/**
 * Recorded one-shots loaded from public/assets/audio/. A sample with the same name as a procedural
 * sound replaces it once loaded (the procedural version stays as the fallback until then). An array
 * of URLs loads as variants, one picked at random per play.
 */
export const SAMPLE_URLS = {
  pistolShot: 'assets/audio/weapons/pistol-shot.mp3',
  pistolReloadOut: 'assets/audio/weapons/pistol-reload-out.mp3',
  pistolReloadIn: 'assets/audio/weapons/pistol-reload-in.mp3',
  pistolReloadSlide: 'assets/audio/weapons/pistol-reload-slide.mp3',
  shotgunShot: 'assets/audio/weapons/shotgun-shot.mp3',
  shotgunPump: 'assets/audio/weapons/shotgun-pump-fit.mp3', // stretched x1.1 to match the old PostFire clip (scripts/fit-weapon-audio.mjs); the new Shoot racks quicker, see swap-viewmodels-to-just-models
  shotgunShell: 'assets/audio/weapons/shotgun-shell.mp3',
  dryFire: 'assets/audio/weapons/dry-fire.mp3',
  // Giles's and Okafor's covering fire (squad-sidearms D5): "pistol shot" by mrfriends (Pixabay Content License, see CREDITS.md),
  // trimmed and level-matched. Recorded only, played positionally from the mate's muzzle, its pitch varied per shot.
  squadPistolShot: 'assets/audio/weapons/squad-pistol-shot.mp3',
  // Spent casings landing (in-world-audio spec: Spent casings; src/audio/casings.ts). Built by scripts/casings-generate.ts:
  // CC0 cuts (GrayJoy, GryffDavid, BlondPanda, MrGungus, lumikon, magnuswaker, Metrolynn; see CREDITS.md) for brass on
  // concrete and soft floors and hulls on concrete, ElevenLabs for the rest. Every clip peaks at -6 dB; play gain sets the surface.
  casingBrassConcrete: casingFiles('brass-concrete', 10),
  casingBrassMetal: casingFiles('brass-metal', 5),
  casingBrassGrate: casingFiles('brass-grate', 4),
  casingBrassSoft: casingFiles('brass-soft', 7),
  casingHullConcrete: casingFiles('hull-concrete', 4),
  casingHullMetal: casingFiles('hull-metal', 4),
  casingHullGrate: casingFiles('hull-grate', 4),
  casingHullSoft: casingFiles('hull-soft', 4),
  casingWater: casingFiles('water', 5),
  // Menu UI one-shots (trimmed from Universfield "interface click" and Dragon Studio "menu open").
  // uiHover / uiSelect replace the procedural versions once loaded; uiMenuOpen has no procedural fallback.
  uiHover: 'assets/audio/ui/ui-hover.mp3',
  uiSelect: 'assets/audio/ui/ui-click.mp3',
  uiMenuOpen: 'assets/audio/ui/ui-menu-open.mp3',
  // Zombie voices (Dragon Studio, see CREDITS.md). Variant order is [sound-2, call, sfx]; src/audio/zombieVoices.ts
  // plays them in turn and the boot splash uses ZOMBIE_SPLASH_VARIANT.
  zombieVoice: [
    'assets/audio/zombies/zombie-sound-2.mp3',
    'assets/audio/zombies/zombie-call.mp3',
    'assets/audio/zombies/zombie-sfx.mp3',
  ],
  // Seven boot steps on painted concrete (ElevenLabs, scripts/footsteps-generate.ts).
  footConcrete: [1, 2, 3, 4, 5, 6, 7].map((i) => `assets/audio/footsteps/foot-concrete-${i}.mp3`),
  // Seven boot steps cut from the first ~4 s of freesound_community "metal footsteps" (14727).
  footPlate: [1, 2, 3, 4, 5, 6, 7].map((i) => `assets/audio/footsteps/foot-metal-${i}.mp3`),
  // Wading in standing water (in-world-audio spec; ElevenLabs, scripts/footsteps-generate.ts): ankle-to-knee and thigh deep.
  footWadeShallow: [1, 2, 3].map((i) => `assets/audio/footsteps/foot-wade-shallow-${i}.mp3`),
  footWadeDeep: [1, 2, 3].map((i) => `assets/audio/footsteps/foot-wade-deep-${i}.mp3`),
  // Splashes (standing-water spec; CC0, rubberduck on OpenGameArt, see CREDITS.md).
  waterSplashStep: [1, 2, 3].map((i) => `assets/audio/water/splash-step-${i}.mp3`),
  waterSplashBullet: [1, 2, 3].map((i) => `assets/audio/water/splash-bullet-${i}.mp3`),
  waterSplashLand: [1, 2, 3].map((i) => `assets/audio/water/splash-land-${i}.mp3`),
  waterSplashTakeoff: [1, 2].map((i) => `assets/audio/water/splash-takeoff-${i}.mp3`),
  waterSplashBody: [1, 2].map((i) => `assets/audio/water/splash-body-${i}.mp3`),
  // The flooded tunnel and pump room (overhaul-flooded-tunnel; ElevenLabs, scripts/ambience-generate.ts).
  waterSlosh: 'assets/audio/ambience/emitter-water-slosh.mp3',
  pipePour: 'assets/audio/ambience/emitter-pipe-pour.mp3',
  waterLap: 'assets/audio/ambience/emitter-water-lap.mp3',
  pumpRoom: 'assets/audio/ambience/emitter-pump-room.mp3',
  klaxon: 'assets/audio/ambience/emitter-klaxon.mp3',
  sparkHiss: [1, 2].map((i) => `assets/audio/ambience/oneshot-spark-hiss-${i}.mp3`),
  tubeStrike: 'assets/audio/ambience/oneshot-tube-strike.mp3',
  floodDoorSlam: 'assets/audio/ambience/oneshot-flood-door-slam.mp3',
  bodyDrip: 'assets/audio/ambience/oneshot-body-drip.mp3',
  // The flood cutscene: the alarm with the beacon, and the sting as the shambler charges the door.
  valveTurn: 'assets/audio/ambience/oneshot-valve-turn.mp3',
  creatureCharge: 'assets/audio/ambience/oneshot-creature-charge.mp3',
  // The elite's scream from far down the R09 hall as the flood cutscene opens (overhaul-valve-cutscene; downloaded, see CREDITS.md).
  creatureScreamFar: 'assets/audio/ambience/oneshot-creature-scream-far.mp3',
  creatureSeverShriek: 'assets/audio/ambience/oneshot-creature-sever-shriek.mp3',
  ambushSting: 'assets/audio/ambience/oneshot-ambush-sting.mp3',
  doorPound: 'assets/audio/ambience/oneshot-door-pound.mp3',
  alarmBlast: 'assets/audio/ambience/oneshot-alarm-blast.mp3',
  // One hit on the valve cutscene's slam (impact at 0.9 s, the door's slide), and the elite prying the door at R11.
  floodSlamHit: 'assets/audio/ambience/oneshot-flood-slam-hit.mp3',
  doorPry: 'assets/audio/ambience/oneshot-door-pry.mp3',
  // The Lab B creature's escape through the vents (trim-lab-wing-encounters; ElevenLabs, scripts/ambience-generate.ts).
  ventCoverRip: 'assets/audio/ambience/oneshot-vent-cover-rip.mp3',
  ventCoverBurst: 'assets/audio/ambience/oneshot-vent-cover-burst.mp3',
  ductBang: [1, 2, 3, 4].map((i) => `assets/audio/ambience/oneshot-duct-bang-${i}.mp3`),
  ductScrape: [1, 2].map((i) => `assets/audio/ambience/oneshot-duct-scrape-${i}.mp3`),
  creatureLand: [1, 2].map((i) => `assets/audio/ambience/oneshot-creature-land-${i}.mp3`),
  grateClatter: 'assets/audio/ambience/oneshot-grate-clatter.mp3',
  // The station blackout (station-power spec; ElevenLabs, scripts/ambience-generate.ts). Recorded only, no procedural fallback.
  lockdownAlarm: 'assets/audio/ambience/oneshot-lockdown-alarm.mp3',
  powerDown: 'assets/audio/ambience/oneshot-power-down.mp3',
  backupHum: 'assets/audio/ambience/emitter-backup-hum.mp3',

  // Infected-kill body sounds (ElevenLabs, scripts/gore-generate.ts; infection-kills spec, data/kills.json).
  kill_crunch: ['assets/audio/gore/kill-crunch-1.mp3', 'assets/audio/gore/kill-crunch-2.mp3', 'assets/audio/gore/kill-crunch-3.mp3', 'assets/audio/gore/kill-crunch-4.mp3'],
  kill_tear: 'assets/audio/gore/kill-tear.mp3',
  kill_burst: 'assets/audio/gore/kill-burst.mp3',
  blood_splat_glass: ['assets/audio/gore/blood-splat-glass-1.mp3', 'assets/audio/gore/blood-splat-glass-2.mp3', 'assets/audio/gore/blood-splat-glass-3.mp3'],
  blood_drip: 'assets/audio/gore/blood-drip.mp3',
  creature_clicks: 'assets/audio/gore/creature-clicks.mp3',
  // The R08 kill (medbay-attack spec): three head-impact crunches with names of their own, so the slams can play them in
  // turn (never the same one twice running); the recorded kill crunches stand in until head-impact takes are made.
  head_crunch_1: 'assets/audio/gore/kill-crunch-2.mp3',
  head_crunch_2: 'assets/audio/gore/kill-crunch-4.mp3',
  head_crunch_3: 'assets/audio/gore/kill-crunch-1.mp3',
  // Not generated yet (`npm run gore:generate -- --id <name>`): until they exist the kill plays the next id it names.
  // The slam on the cart is two downloaded clips played together (CREDITS.md): a door slam and breaking glass.
  cart_impact: 'assets/audio/gore/cart-impact.mp3',
  cart_glass_break: 'assets/audio/gore/cart-glass-break.mp3',
  body_glass_hit: 'assets/audio/gore/body-glass-hit.mp3',
  // overhaul-priya-r08-death D26: the dark surgery, heard through the rescue.
  surgery_rattle: 'assets/audio/gore/surgery-rattle.mp3',
  surgery_tray_fall: 'assets/audio/gore/surgery-tray-fall.mp3',
  surgery_breath: 'assets/audio/gore/surgery-breath.mp3',
  surgery_scrape: 'assets/audio/gore/surgery-scrape.mp3',
  surgery_latch: 'assets/audio/gore/surgery-latch.mp3',
  // overhaul-priya-r08-death 9.4: the impale (data/kills.json mauled), two variants each.
  // The lab creature charging Priya in R08 (ElevenLabs, scripts/gore-generate.ts).
  creature_rush: 'assets/audio/gore/creature-rush.mp3',
  impale_stab: ['assets/audio/gore/impale-stab-1.mp3', 'assets/audio/gore/impale-stab-2.mp3'],
  impale_wet: ['assets/audio/gore/impale-wet-1.mp3', 'assets/audio/gore/impale-wet-2.mp3'],
  // The blade piercing her and her choking as it goes in: two downloaded clips (CREDITS.md); the choke is raised 2x.
  impale_blade: 'assets/audio/gore/impale-blade.mp3',
  impale_choke: 'assets/audio/gore/impale-choke.mp3',
  glass_squeak: 'assets/audio/gore/glass-squeak.mp3',
  // The creature hammering on the Lab B glass, and Voss's palms on it (ElevenLabs, scripts/gore-generate.ts).
  creature_glass_hit: [1, 2, 3, 4].map((i) => `assets/audio/gore/creature-glass-hit-${i}.mp3`),
  palm_glass_hit: [1, 2, 3].map((i) => `assets/audio/gore/palm-glass-hit-${i}.mp3`),
  // Voss panting and whimpering as it crawls up her arm (Gemini TTS, scripts/vo-reactions.ts --only react_voss_panic).
  voss_panic_breath: ['assets/vo/react_voss_panic_01.mp3', 'assets/vo/react_voss_panic_02.mp3', 'assets/vo/react_voss_panic_03.mp3'],

  // Environmental ambient beds, spatial emitters, and foley one-shots (ElevenLabs, scripts/ambience-generate.ts).
  // Keys matching SOUND_SPECS replace their procedural fallback once loaded; amb* beds power AmbienceDirector.
  roomTone: 'assets/audio/ambience/bed-hull-hum.mp3',
  ambHullHum: 'assets/audio/ambience/bed-hull-hum.mp3',
  ambCommons: 'assets/audio/ambience/bed-commons-murmur.mp3',
  ambLabHum: 'assets/audio/ambience/bed-lab-hum.mp3',
  ambHullGroan: 'assets/audio/ambience/bed-hull-groan.mp3',
  ambOfficeHvac: 'assets/audio/ambience/bed-office-hvac.mp3',
  ambMedBay: 'assets/audio/ambience/bed-med-bay.mp3',
  ambFlooded: 'assets/audio/ambience/bed-flooded-tunnel.mp3',
  ambValveRoom: 'assets/audio/ambience/bed-valve-room.mp3',
  ambHydroMisters: 'assets/audio/ambience/bed-hydro-misters.mp3',
  ambHydroVestibule: 'assets/audio/ambience/bed-hydro-vestibule.mp3',
  ambHydroSeedLab: 'assets/audio/ambience/bed-hydro-seed-lab.mp3',
  ambHydroPlantRoom: 'assets/audio/ambience/bed-hydro-plant-room.mp3',
  ambHydroStoreroom: 'assets/audio/ambience/bed-hydro-storeroom.mp3',
  ambDiveBay: 'assets/audio/ambience/bed-dive-bay.mp3',
  ventFan: 'assets/audio/ambience/emitter-vent-fan.mp3',
  fluorescentBuzz: 'assets/audio/ambience/emitter-fluorescent-buzz.mp3',
  waterRumble: 'assets/audio/ambience/emitter-water-rumble.mp3',
  consoleHum: 'assets/audio/ambience/emitter-console-hum.mp3',
  hydroTrickle: 'assets/audio/ambience/emitter-hydro-trickle.mp3',
  dehumidifierHum: 'assets/audio/ambience/emitter-dehumidifier-hum.mp3',
  fertigationPump: 'assets/audio/ambience/emitter-fertigation-pump.mp3',
  kettleSimmer: 'assets/audio/ambience/emitter-kettle-simmer.mp3',
  hullGroan: ['assets/audio/ambience/oneshot-hull-groan-1.mp3', 'assets/audio/ambience/oneshot-hull-groan-2.mp3'],
  metalKnock: ['assets/audio/ambience/oneshot-metal-knock-1.mp3', 'assets/audio/ambience/oneshot-metal-knock-2.mp3'],
  creak: ['assets/audio/ambience/oneshot-creak-1.mp3', 'assets/audio/ambience/oneshot-creak-2.mp3'],
  drip: ['assets/audio/ambience/oneshot-drip-1.mp3', 'assets/audio/ambience/oneshot-drip-2.mp3'],
  hydroDrip: ['assets/audio/ambience/oneshot-hydro-drip-1.mp3', 'assets/audio/ambience/oneshot-hydro-drip-2.mp3'],
  misterValve: ['assets/audio/ambience/oneshot-mister-valve-1.mp3', 'assets/audio/ambience/oneshot-mister-valve-2.mp3'],
  misterSpray: ['assets/audio/ambience/oneshot-mister-spray-1.mp3', 'assets/audio/ambience/oneshot-mister-spray-2.mp3'],
  misterSputter: 'assets/audio/ambience/oneshot-mister-sputter.mp3',
  humidityAlarm: 'assets/audio/ambience/oneshot-humidity-alarm.mp3',
  hydroLogSign: 'assets/audio/ambience/oneshot-hydro-log-sign.mp3',
  hydroAlarmReset: 'assets/audio/ambience/oneshot-hydro-alarm-reset.mp3',
  pressurePing: 'assets/audio/ambience/oneshot-pressure-ping.mp3',
  distantMoan: 'assets/audio/ambience/oneshot-distant-moan.mp3',
  medBeep: 'assets/audio/ambience/oneshot-med-beep.mp3',
  // overhaul-priya-r08-death D25/D31: the medbay intercom's switch and static; the vitals monitor's steady single beep.
  intercomClick: 'assets/audio/ambience/oneshot-intercom-click.mp3',
  intercomStatic: 'assets/audio/ambience/oneshot-intercom-static.mp3',
  monitorBeep: 'assets/audio/ambience/oneshot-monitor-beep.mp3',
  // Dock checkpoint (dock-checkpoint spec): the walk-through arch and the guard's hand wand. Generate with
  // `npm run ambience:generate -- --id archPass` (and archAlarm, wandBeep). Until the files exist, scans play with light only.
  archPass: 'assets/audio/ambience/oneshot-arch-pass.mp3',
  archAlarm: 'assets/audio/ambience/oneshot-arch-alarm.mp3',
  wandBeep: 'assets/audio/ambience/oneshot-wand-beep.mp3',
  // Dive bay launch hall (rebuild-dive-bay): `npm run ambience:generate -- --id <name>` for each. Until a file exists
  // the `launch_bay` bed falls back to the procedural water rumble and the trunk / leak one-shots stay silent.
  ambLaunchBay: 'assets/audio/ambience/bed-launch-bay.mp3',
  winchClunk: 'assets/audio/ambience/oneshot-winch-clunk.mp3',
  trunkChirp: 'assets/audio/ambience/oneshot-trunk-chirp.mp3',
  trunkHatch: 'assets/audio/ambience/oneshot-trunk-hatch.mp3',
  trunkVent: 'assets/audio/ambience/oneshot-trunk-vent.mp3',
  // Supply sub docking (intro-sequence spec, fix-supply-sub-docking): muffled underwater ElevenLabs SFX.
  subPass: 'assets/audio/ambience/oneshot-sub-pass.mp3',
  subClamp: 'assets/audio/ambience/oneshot-sub-clamp.mp3',
  // R11 Power Bay (detail-r11-power-bay / r11-power-bay-narrative): switchgear breaker throw, turbine spin-up, phased generator rumbles, and hum loop.
  breakerClunk: 'assets/audio/ambience/oneshot-breaker-clunk.mp3',
  turbineSpinUp: 'assets/audio/ambience/oneshot-turbine-spinup.mp3',
  generatorHum: 'assets/audio/ambience/emitter-generator-hum.mp3',
  generatorPhase1: 'assets/audio/ambience/oneshot-generator-phase-1.mp3',
  generatorPhase2: 'assets/audio/ambience/oneshot-generator-phase-2.mp3',
  generatorPhase3: 'assets/audio/ambience/oneshot-generator-phase-3.mp3',
  heavyBulkheadOpen: 'assets/audio/ambience/oneshot-heavy-bulkhead-open.mp3',
  powerBayHum: 'assets/audio/ambience/emitter-power-bay-hum.mp3',
  // R15a Departure Bay & 3-stage abyssal transit ride (r15a-train-ride-narrative).
  trainDoorClose: 'assets/audio/ambience/oneshot-train-door-close.mp3',
  blastGateOpen: 'assets/audio/ambience/oneshot-blast-gate-open.mp3',
  blastGateClose: 'assets/audio/ambience/oneshot-blast-gate-close.mp3',
  trainPullout: 'assets/audio/ambience/oneshot-train-pullout.mp3',
  trainTunnelCruise: 'assets/audio/ambience/emitter-train-tunnel-cruise.mp3',
  trainBrakeStop: 'assets/audio/ambience/oneshot-train-brake-stop.mp3',
  trainCommsRing: 'assets/audio/ambience/oneshot-train-comms-ring.mp3',
  trainPowerDown: 'assets/audio/ambience/oneshot-train-power-down.mp3',
  r16HorrorHit: 'assets/audio/ambience/oneshot-r16-horror-hit.mp3',
  r16MonsterRoar: 'assets/audio/ambience/oneshot-r16-monster-roar-cctv.wav',

  // Door motion and access feedback (ElevenLabs, scripts/doors-generate.ts).
  doorPressureOpen: 'assets/audio/doors/door-pressure-open.mp3',
  doorPressureClose: 'assets/audio/doors/door-pressure-close.mp3',
  doorGlassOpen: 'assets/audio/doors/door-glass-open.mp3',
  doorGlassClose: 'assets/audio/doors/door-glass-close.mp3',
  doorBulkheadOpen: 'assets/audio/doors/door-bulkhead-open.mp3',
  doorBulkheadClose: 'assets/audio/doors/door-bulkhead-close.mp3',
  doorDenied: 'assets/audio/doors/door-denied.mp3',
  doorUnlocked: 'assets/audio/doors/door-unlocked.mp3',
} as const satisfies Record<string, string | readonly string[]>;

/** The `zombieVoice` clip the boot splash plays while the logo shambles in. */
export const ZOMBIE_SPLASH_VARIANT = 2;

export type SampleName = keyof typeof SAMPLE_URLS;
export type SoundName = keyof typeof SOUND_SPECS | SampleName;
